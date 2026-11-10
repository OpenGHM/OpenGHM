"""The gateway's own SSH connection to Anvil, for moving files over SFTP.

A run's output ZIP (`run_files`) and a NetCDF subset (`wbm_output`) are read here, not through
slurmly. slurmly keeps one asyncssh connection for job management (sbatch, squeue, sacct); a
multi-GiB download on that connection would share it with job polling and leave no say over its
settings. This module opens a connection of its own, lazily, one per process, from the same
settings slurmly is given (`ANVIL_SSH_*`), and hands out SFTP channels on it.

Two settings are the reason this is tuned rather than default (measured on the dev cluster, one
ZIP stream: 48 MB/s with asyncssh's defaults, about 160 MB/s with these):

* reads are asked for in `READ_BLOCK_BYTES` pieces; asyncssh's default is 16 KiB per request;
* AES-GCM is preferred to ChaCha20-Poly1305, which is slower on a CPU with AES instructions.

A connection that is closed, or that fails with a connection-level error, is dropped and the next
call opens a new one. Nothing else is shared: each `sftp_session` is its own SFTP channel.

`stream_files` is the fast path for many files in a row (a run's ZIP): one remote process on the
login node reads every file and writes them back framed on one exec channel (measured on the dev
pod, 2.5 GiB: SFTP 157 MB/s and 6.0 CPU-s/GiB; one process for all files 336 MB/s and 3.0
CPU-s/GiB). Plain `cat` would be faster to write and unsafe: a file that shrinks or grows while
it is read would put bytes of the next file in the wrong ZIP entry. The frames say where each
file ends and the script checks every file's size, so such a file is an error, never a wrong ZIP.

Frame format, shared by `REMOTE_SCRIPT` and `FileStream` (all lengths are 4-byte big-endian
unsigned integers):

* DATA: a length from 1 to `FRAME_MAX_BYTES`, then that many bytes of the current file;
* END: length 0, the current file is complete (it had exactly the size asked for);
* ERROR: length `FRAME_ERROR` (0xFFFFFFFF), then a length and a UTF-8 message. It is the last
  frame; the script exits with status `REMOTE_FAILURE_STATUS`.

Each file is a run of DATA frames and one END.

Stdin protocol, one definition for `REMOTE_SCRIPT` and `FileStream`: each stdin line is one JSON
object.

* `{"path": ..., "size": N}`: an entry, in archive order. All entries come first;
* `{"end": true}`: the list is complete;
* `{"credit": K}`: after the list, K more bytes the script may write to stdout. Credit counts
  every byte written, frame headers and payloads alike. The client sends `STREAM_CREDIT_BYTES`
  with the list and, as it consumes frames, `{"credit": n}` for what it consumed, so that at
  most `STREAM_CREDIT_BYTES` are granted and not yet consumed.

The script reads the whole list, then streams: before each write it makes sure it holds the
credit for it, blocking on stdin when it does not. It splits a DATA chunk to fit the credit it
has (a DATA frame stays between 1 byte and `FRAME_MAX_BYTES`). When stdin ends while it needs
credit (or before the list is complete), the client has gone: it exits quietly with status
`REMOTE_GONE_STATUS`. An ERROR frame needs no credit; it is small and final.
"""

from __future__ import annotations

import asyncio
import logging
import json
import os
import shlex
import struct
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncssh
import asyncssh.encryption

from app.core.config import settings
from app.services.slurm import AnvilNotConfigured

logger = logging.getLogger(__name__)

#: The size of one SFTP read request. Anvil's sftp-server (OpenSSH 8.0p1) answers 64 KiB per read
#: whatever is asked (measured: 256 KiB and 1 MiB requests were answered with 65 536 bytes), so a
#: larger value gains nothing; asyncssh's own default is 16 KiB, four times the round trips.
READ_BLOCK_BYTES = 64 * 1024

#: Ciphers tried first, in this order. A server that offers none of them still connects: they
#: are put in front of everything else asyncssh would offer (`_encryption_algs`).
PREFERRED_ENCRYPTION_ALGS = (
    "aes128-gcm@openssh.com",
    "aes256-gcm@openssh.com",
    "chacha20-poly1305@openssh.com",
)

#: A keepalive is sent after this many seconds without traffic, and the connection is declared
#: dead after `KEEPALIVE_COUNT_MAX` unanswered ones (so one that went silent is noticed in
#: about 90 s instead of at the next read that hangs).
KEEPALIVE_INTERVAL_SECONDS = 30
KEEPALIVE_COUNT_MAX = 3

#: What marks an operation's failure as the connection's, not the file's: the connection was
#: lost or the server hung up, the SFTP channel was lost, or the transport raised an
#: `OSError` (reset, broken pipe, timeout). The connection is dropped on any of these. An
#: `OSError` raised by the caller's own code inside `sftp_session` is dropped on too, which
#: costs one reconnect.
_CONNECTION_ERRORS = (
    asyncssh.ConnectionLost,
    asyncssh.DisconnectError,
    asyncssh.SFTPConnectionLost,
    OSError,
)

#: The interpreter of the login node (Python 3.6.8 there), run isolated (`-I`).
REMOTE_PYTHON = "/usr/bin/python3"
#: The exec channel's window and packet size for `stream_files` (measured: 235 MB/s with these,
#: against asyncssh's 2 MiB and 32 KiB defaults, for the same single file). The window is NOT what
#: bounds the bytes in flight: when a slow consumer makes asyncssh pause a channel and then resume
#: it, `SSHChannel._deliver_data` sends a WINDOW_ADJUST that refills the window to its full size
#: while megabytes are still held in the channel's own receive buffer (measured in 2.24.1: 410 MiB
#: buffered with a 16 MiB window), so the server keeps being granted room. The bound is the credit
#: of the stdin protocol: the script writes only what the client has asked for.
STREAM_WINDOW_BYTES = 16 * 1024 * 1024
STREAM_MAX_PACKET_BYTES = 256 * 1024
#: The longest DATA frame, and the marker length of an ERROR frame.
FRAME_MAX_BYTES = 1024 * 1024
FRAME_ERROR = 0xFFFFFFFF
#: The script's exit status when it stopped on an error (after writing an ERROR frame).
REMOTE_FAILURE_STATUS = 3
#: The script's exit status when stdin ended while it still needed the list or credit (the
#: client has gone); it writes nothing then.
REMOTE_GONE_STATUS = 4
#: The most bytes granted to the script and not yet consumed by the client, and the amount
#: consumed before the next grant is sent. 8 MiB keeps a few full frames in flight, enough to
#: cover the SSH round trip at the measured 336 MB/s (about 25 ms) several times over, while
#: the memory per stream stays small; 4 MiB steps keep the credit lines few (about 250 per GiB).
STREAM_CREDIT_BYTES = 8 * 1024 * 1024
STREAM_CREDIT_STEP_BYTES = 4 * 1024 * 1024
#: The longest error message the script writes, and how much of stderr is kept for a failure.
_ERROR_MESSAGE_MAX = 4000
_STDERR_TAIL_BYTES = 2000
#: How long a closing process is waited for.
_CLOSE_TIMEOUT_SECONDS = 5
#: Entry lines written to stdin between two drains.
_STDIN_BATCH_BYTES = 64 * 1024

#: The program that serves `stream_files`. Plain Python 3.6 (no walrus, no f-string `=`): it is
#: tested by running it (`tests/test_anvil_files.py`) and by parsing it as 3.6. It opens each
#: file without following a symbolic link, writes nothing but frames to stdout (and no more than
#: it has credit for), and refuses a file that is not a regular file, is not the size it was
#: told, shrinks or grows.
REMOTE_SCRIPT = """\
import json
import os
import stat
import struct
import sys

MAX = %d
ERROR = %d
FAILED = %d
GONE = %d
out = sys.stdout.buffer
stdin = sys.stdin.buffer
credit = 0


def fail(message):
    data = message.encode("utf-8", "replace")[:%d]
    try:
        out.write(struct.pack(">II", ERROR, len(data)))
        out.write(data)
        out.flush()
    except Exception:
        pass
    sys.exit(FAILED)


def read_line():
    while True:
        line = stdin.readline()
        if not line:
            sys.exit(GONE)
        line = line.strip()
        if line:
            return json.loads(line.decode("utf-8"))


def need(count):
    global credit
    if credit >= count:
        return
    out.flush()
    while credit < count:
        grant = read_line()["credit"]
        if not isinstance(grant, int) or grant < 0:
            fail("bad credit: " + repr(grant))
        credit += grant


def send(path, size):
    global credit
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            fail("not a regular file: " + path)
        if st.st_size != size:
            fail("%%s is %%d bytes, %%d expected" %% (path, st.st_size, size))
        left = size
        while left:
            need(5)
            chunk = os.read(fd, min(left, MAX, credit - 4))
            if not chunk:
                fail("%%s ended %%d bytes early" %% (path, left))
            out.write(struct.pack(">I", len(chunk)) + chunk)
            credit -= 4 + len(chunk)
            left -= len(chunk)
        if os.read(fd, 1):
            fail("%%s grew while it was read" %% path)
    finally:
        os.close(fd)
    need(4)
    out.write(struct.pack(">I", 0))
    credit -= 4


def main():
    global credit
    entries = []
    while True:
        entry = read_line()
        if entry.get("end") is True:
            break
        if "credit" in entry:
            credit += entry["credit"]
            continue
        path = entry["path"]
        size = entry["size"]
        if not isinstance(path, str) or not isinstance(size, int) or size < 0:
            fail("bad entry: " + repr(entry))
        entries.append((path, size))
    for path, size in entries:
        send(path, size)
    out.flush()


try:
    main()
except Exception as exc:
    fail("%%s: %%s" %% (type(exc).__name__, exc))
""" % (FRAME_MAX_BYTES, FRAME_ERROR, REMOTE_FAILURE_STATUS, REMOTE_GONE_STATUS, _ERROR_MESSAGE_MAX)

_conn: asyncssh.SSHClientConnection | None = None
_lock = asyncio.Lock()


def _encryption_algs() -> list[str]:
    """`PREFERRED_ENCRYPTION_ALGS` that this asyncssh supports, then every other algorithm it
    offers by default, so a server without AES-GCM still connects."""
    defaults = [a.decode() if isinstance(a, bytes) else a for a in asyncssh.encryption.get_default_encryption_algs()]
    preferred = [a for a in PREFERRED_ENCRYPTION_ALGS if a in defaults]
    return preferred + [a for a in defaults if a not in preferred]


def _connect_kwargs() -> dict:
    """The arguments of `asyncssh.connect`, from the settings slurmly is given in
    `slurm.get_slurm_client`. `AnvilNotConfigured` when there is no username or no key. A key's
    content wins over its path, as in slurmly."""
    has_key = settings.ANVIL_SSH_KEY_CONTENT or settings.ANVIL_SSH_KEY_PATH
    if not settings.ANVIL_SSH_USERNAME or not has_key:
        raise AnvilNotConfigured(
            "ANVIL_SSH_USERNAME and one of ANVIL_SSH_KEY_CONTENT / ANVIL_SSH_KEY_PATH must be configured"
        )
    if settings.ANVIL_SSH_KEY_CONTENT:
        client_keys = [asyncssh.import_private_key(settings.ANVIL_SSH_KEY_CONTENT)]
    else:
        client_keys = [os.path.expanduser(settings.ANVIL_SSH_KEY_PATH)]
    return {
        "host": settings.ANVIL_SSH_HOST,
        "port": settings.ANVIL_SSH_PORT,
        "username": settings.ANVIL_SSH_USERNAME,
        "client_keys": client_keys,
        # The same posture as slurmly's connect (its `accept_unknown_hosts` defaults to true):
        # the server's host key is not checked against a known_hosts file.
        "known_hosts": None,
        "keepalive_interval": KEEPALIVE_INTERVAL_SECONDS,
        "keepalive_count_max": KEEPALIVE_COUNT_MAX,
        "encryption_algs": _encryption_algs(),
    }


async def _connection() -> asyncssh.SSHClientConnection:
    """The shared connection, opened on first use and again after it has closed. Concurrent
    first callers open exactly one."""
    global _conn
    conn = _conn
    if conn is not None and not conn.is_closed():
        return conn
    async with _lock:
        conn = _conn
        if conn is not None and not conn.is_closed():
            return conn
        _conn = None
        kwargs = _connect_kwargs()
        _conn = await asyncssh.connect(**kwargs)
        logger.info("Anvil files: connected (host=%s user=%s)", kwargs["host"], kwargs["username"])
        return _conn


def _discard(conn: asyncssh.SSHClientConnection) -> None:
    """Forget `conn` (if it is still the shared one) and close it, so the next call
    reconnects."""
    global _conn
    if _conn is conn:
        _conn = None
    try:
        conn.close()
    except Exception:  # noqa: BLE001 - already broken; nothing more to do
        pass


@asynccontextmanager
async def sftp_session():
    """One SFTP channel on the shared connection, for a caller that reads many files or lists
    folders (a run's ZIP, `run_files`): an async context manager that yields asyncssh's
    `SFTPClient`. Raises `AnvilNotConfigured` when there are no credentials, and asyncssh's
    errors or `OSError` when no connection can be had; a connection-level failure drops the
    connection so the next session opens a new one."""
    conn = await _connection()
    try:
        async with conn.start_sftp_client() as sftp:
            yield sftp
    except _CONNECTION_ERRORS:
        _discard(conn)
        raise


def open_for_read(sftp: asyncssh.SFTPClient, path: str):
    """`sftp.open` for reading, asking for `READ_BLOCK_BYTES` per request: an async context
    manager that yields the remote file."""
    return sftp.open(path, "rb", block_size=READ_BLOCK_BYTES)


async def stream_file(path: str, *, chunk_size: int = 1024 * 1024) -> AsyncIterator[bytes]:
    """The bytes of a file on Anvil, `chunk_size` at a time, over SFTP: an async generator, so
    the file is never held whole. A file that is not there, or a transport failure, raises
    when the generator is advanced (asyncssh's `SFTPNoSuchFile` for the file). Closing the
    generator early (a client that went away) closes the channel."""
    async with sftp_session() as sftp:
        async with open_for_read(sftp, path) as remote:
            while True:
                data = await remote.read(chunk_size)
                if not data:
                    return
                yield data


def _credit_line(count: int) -> bytes:
    return json.dumps({"credit": count}).encode("ascii") + b"\n"


class RemoteReadError(Exception):
    """`stream_files` could not deliver a file: the remote script refused it (not a regular
    file, another size than listed, gone, shrunk, grown), the stream broke or was not
    understood, or a file was asked for out of order. The message says which and why."""


def remote_command() -> str:
    """The command line `stream_files` runs on the login node."""
    return f"{REMOTE_PYTHON} -I -c {shlex.quote(REMOTE_SCRIPT)}"


class FileStream:
    """The files of one remote process, in the order they were listed. `read_file` must be
    called for each entry in turn and its bytes consumed to the end before the next call."""

    def __init__(self, process, entries: list[tuple[str, int]]) -> None:
        self._process = process
        self._entries = entries
        self._next = 0
        self._busy = False
        self._stderr = b""
        self._tasks: list[asyncio.Task] = []
        self._credits: asyncio.Queue[int] = asyncio.Queue()
        self._unreported = 0

    def _start(self) -> None:
        self._tasks = [
            asyncio.ensure_future(self._feed()),
            asyncio.ensure_future(self._drain_stderr()),
        ]

    async def _feed(self) -> None:
        """Tell the script the files, that the list is complete and the first credit, then send
        credit as the reader queues it. A failure here is not raised: the script's side of it
        (no output, a status) is what the reader reports. Stdin stays open until `_close`."""
        stdin = self._process.stdin
        try:
            batch = b""
            for path, size in self._entries:
                batch += json.dumps({"path": path, "size": size}).encode("ascii") + b"\n"
                if len(batch) >= _STDIN_BATCH_BYTES:
                    stdin.write(batch)
                    await stdin.drain()
                    batch = b""
            batch += b'{"end": true}\n' + _credit_line(STREAM_CREDIT_BYTES)
            stdin.write(batch)
            await stdin.drain()
            while True:
                grant = await self._credits.get()
                while not self._credits.empty():
                    grant += self._credits.get_nowait()
                stdin.write(_credit_line(grant))
                await stdin.drain()
        except Exception as exc:  # noqa: BLE001 - reported by the reader as a broken stream
            logger.debug("Anvil files: writing to the script stopped: %s", exc)

    def _consumed(self, count: int) -> None:
        """Note `count` bytes taken from stdout and queue a grant of as many once
        `STREAM_CREDIT_STEP_BYTES` are unreported. Never waits: the writer task sends it."""
        self._unreported += count
        if self._unreported >= STREAM_CREDIT_STEP_BYTES:
            self._credits.put_nowait(self._unreported)
            self._unreported = 0

    async def _drain_stderr(self) -> None:
        try:
            while True:
                data = await self._process.stderr.read(4096)
                if not data:
                    return
                self._stderr = (self._stderr + data)[-_STDERR_TAIL_BYTES:]
        except Exception:  # noqa: BLE001 - only for the message of a failure
            return

    async def _broken(self, what: str) -> RemoteReadError:
        """The error for a stream that ended or made no sense: with the exit status and the
        end of stderr, once the process has stopped."""
        status = None
        try:
            await asyncio.wait_for(self._process.wait_closed(), _CLOSE_TIMEOUT_SECONDS)
            status = self._process.exit_status
        except Exception:  # noqa: BLE001
            pass
        if len(self._tasks) > 1:  # stderr ends with the channel: let the tail be complete
            await asyncio.wait({self._tasks[1]}, timeout=_CLOSE_TIMEOUT_SECONDS)
        tail = self._stderr.decode("utf-8", "replace").strip()
        detail = f"{what} (exit status {status})"
        return RemoteReadError(f"{detail}: {tail}" if tail else detail)

    async def _exactly(self, count: int, what: str) -> bytes:
        try:
            data = await self._process.stdout.readexactly(count)
        except asyncio.IncompleteReadError as exc:
            raise await self._broken(f"the stream ended in {what}") from exc
        self._consumed(count)
        return data

    def read_file(self, path: str, size: int) -> AsyncIterator[bytes]:
        """The bytes of the next entry, exactly `size` of them, as they arrive. Raises
        `RemoteReadError` at once when it is not the next entry or the one before is not
        finished, and when the generator is advanced for everything the stream can get wrong."""
        if self._busy:
            raise RemoteReadError(f"{path}: asked for before the file before it was finished")
        if self._next >= len(self._entries) or self._entries[self._next] != (path, size):
            raise RemoteReadError(f"{path}: not the next file of the stream")
        self._next += 1
        self._busy = True
        return self._read(path, size)

    async def _read(self, path: str, size: int) -> AsyncIterator[bytes]:
        got = 0
        while True:
            (length,) = struct.unpack(">I", await self._exactly(4, path))
            if length == 0:
                if got != size:
                    raise RemoteReadError(f"{path}: {got} bytes read, {size} listed")
                self._busy = False
                return
            if length == FRAME_ERROR:
                (count,) = struct.unpack(">I", await self._exactly(4, path))
                if count > _ERROR_MESSAGE_MAX:
                    raise await self._broken(f"{path}: an error frame of {count} bytes")
                message = (await self._exactly(count, path)).decode("utf-8", "replace")
                raise RemoteReadError(f"{path}: {message}")
            if length > FRAME_MAX_BYTES or got + length > size:
                raise await self._broken(f"{path}: a data frame of {length} bytes after {got} of {size}")
            data = await self._exactly(length, path)
            got += length
            yield data

    async def _close(self) -> None:
        for task in self._tasks:
            task.cancel()
        process = self._process
        try:
            process.terminate()
        except Exception:  # noqa: BLE001 - a server may refuse the signal; closing ends it
            pass
        try:
            process.close()
            await asyncio.wait_for(process.wait_closed(), _CLOSE_TIMEOUT_SECONDS)
        except Exception:  # noqa: BLE001
            pass
        await asyncio.gather(*self._tasks, return_exceptions=True)


@asynccontextmanager
async def stream_files(entries: list[tuple[str, int]]):
    """Many files of Anvil, in order, through one remote process on the shared connection: an
    async context manager that yields a `FileStream`, whose `read_file(path, size)` gives each
    entry's bytes (see the module docstring for the frames). `entries` are (absolute path,
    size) as listed; a file of another size is an error, not a short read. Leaving the block,
    early or not, ends the process and the channel. Raises `AnvilNotConfigured` and asyncssh's
    errors or `OSError` when no channel can be had; a connection-level failure drops the
    connection so the next call opens a new one."""
    conn = await _connection()
    try:
        process = await conn.create_process(
            remote_command(),
            encoding=None,
            window=STREAM_WINDOW_BYTES,
            max_pktsize=STREAM_MAX_PACKET_BYTES,
        )
        stream = FileStream(process, list(entries))
        stream._start()
        try:
            yield stream
        finally:
            await stream._close()
    except _CONNECTION_ERRORS:
        _discard(conn)
        raise


async def remove_file(path: str) -> None:
    """Delete one file on Anvil over SFTP; a file that is already gone is not an error. It
    removes whatever path it is given: the caller decides which paths are its own to remove."""
    async with sftp_session() as sftp:
        try:
            await sftp.remove(path)
        except asyncssh.SFTPNoSuchFile:
            pass


async def close() -> None:
    """Close the connection if one is open (called from the FastAPI lifespan shutdown). Safe
    to call twice, and when none was ever opened."""
    global _conn
    conn, _conn = _conn, None
    if conn is None:
        return
    try:
        conn.close()
        await conn.wait_closed()
    except Exception as exc:  # noqa: BLE001 - shutting down
        logger.warning("Anvil files: closing the connection failed: %s", exc)
