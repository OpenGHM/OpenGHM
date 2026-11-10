"""The gateway's own SSH connection to Anvil for files (`app.services.anvil_files`).

No SSH: `asyncssh.connect` is replaced by a fake that records the keyword arguments it was
given and returns a `FakeConn`, whose SFTP channel is an in-memory file store.
"""

from __future__ import annotations

import ast
import asyncio
import json
import os
import struct
import subprocess
import sys

import asyncssh
import pytest

from types import SimpleNamespace

from app.core.config import settings
from app.services import anvil_files, slurm

KEY = asyncssh.generate_private_key("ssh-ed25519")
KEY_PEM = KEY.export_private_key().decode()


class FakeFile:
    def __init__(self, data: bytes) -> None:
        self.data, self.pos, self.reads = data, 0, []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def read(self, size):
        self.reads.append(size)
        chunk = self.data[self.pos:self.pos + size]
        self.pos += len(chunk)
        return chunk


class FakeSftp:
    def __init__(self, files: dict[str, bytes]) -> None:
        self.files, self.removed, self.opened, self.entered, self.exited = files, [], [], 0, 0

    async def __aenter__(self):
        self.entered += 1
        return self

    async def __aexit__(self, *exc):
        self.exited += 1
        return False

    def open(self, path, mode="r", *, block_size=-1):
        self.opened.append((path, mode, block_size))
        if path not in self.files:
            raise asyncssh.SFTPNoSuchFile("no such file")
        return FakeFile(self.files[path])

    async def remove(self, path):
        if path not in self.files:
            raise asyncssh.SFTPNoSuchFile("no such file")
        self.removed.append(path)
        del self.files[path]


class FakeConn:
    def __init__(self, files: dict[str, bytes]) -> None:
        self.sftp = FakeSftp(files)
        self.closed = False
        self.close_calls = 0
        self.waited = 0
        self.commands: list[tuple[str, dict]] = []
        self.process = None
        self.runs: list[str] = []
        self.run_result = None    # what `run` answers: a SimpleNamespace, or an exception to raise

    def is_closed(self) -> bool:
        return self.closed

    def close(self) -> None:
        self.close_calls += 1
        self.closed = True

    async def wait_closed(self) -> None:
        self.waited += 1

    def start_sftp_client(self):
        return self.sftp

    async def run(self, command, **kwargs):
        self.runs.append(command)
        assert kwargs.get("check") is False
        if isinstance(self.run_result, BaseException):
            raise self.run_result
        if self.run_result == "hang":
            await asyncio.sleep(3600)
        return self.run_result

    async def create_process(self, command, **kwargs):
        self.commands.append((command, kwargs))
        return self.process


class Connects:
    """What `asyncssh.connect` was asked, and the connections it handed out."""

    def __init__(self) -> None:
        self.kwargs: list[dict] = []
        self.conns: list[FakeConn] = []
        self.files: dict[str, bytes] = {"/a/b.nc": b"0123456789" * 10}
        self.delay = 0.0

    async def __call__(self, **kwargs):
        self.kwargs.append(kwargs)
        await asyncio.sleep(self.delay)
        conn = FakeConn(self.files)
        self.conns.append(conn)
        return conn


@pytest.fixture
def connects(monkeypatch) -> Connects:
    fake = Connects()
    monkeypatch.setattr(asyncssh, "connect", fake)
    monkeypatch.setattr(anvil_files, "_conn", None)
    monkeypatch.setattr(anvil_files, "_lock", asyncio.Lock())
    monkeypatch.setattr(anvil_files, "_python_checked", set())
    monkeypatch.setattr(settings, "ANVIL_REMOTE_PYTHON", "/usr/bin/python3")
    monkeypatch.setattr(settings, "ANVIL_SSH_HOST", "anvil.example.org")
    monkeypatch.setattr(settings, "ANVIL_SSH_PORT", 2222)
    monkeypatch.setattr(settings, "ANVIL_SSH_USERNAME", "x-openghm")
    monkeypatch.setattr(settings, "ANVIL_SSH_KEY_CONTENT", KEY_PEM)
    monkeypatch.setattr(settings, "ANVIL_SSH_KEY_PATH", "")
    return fake


async def _touch():
    async with anvil_files.sftp_session() as sftp:
        return sftp


# ---- configuration -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "username, content, path",
    [("", KEY_PEM, ""), ("x-openghm", "", ""), ("", "", "")],
)
def test_without_a_username_or_a_key_it_is_not_configured_and_connects_to_nothing(
    connects, monkeypatch, username, content, path
):
    monkeypatch.setattr(settings, "ANVIL_SSH_USERNAME", username)
    monkeypatch.setattr(settings, "ANVIL_SSH_KEY_CONTENT", content)
    monkeypatch.setattr(settings, "ANVIL_SSH_KEY_PATH", path)
    with pytest.raises(slurm.AnvilNotConfigured):
        asyncio.run(_touch())
    assert connects.kwargs == []


def test_the_connection_carries_the_host_user_key_keepalive_and_ciphers(connects):
    asyncio.run(_touch())
    (kw,) = connects.kwargs
    assert (kw["host"], kw["port"], kw["username"]) == ("anvil.example.org", 2222, "x-openghm")
    assert len(kw["client_keys"]) == 1 and isinstance(kw["client_keys"][0], asyncssh.SSHKey)
    assert kw["known_hosts"] is None
    assert kw["keepalive_interval"] == anvil_files.KEEPALIVE_INTERVAL_SECONDS == 30
    assert kw["keepalive_count_max"] == anvil_files.KEEPALIVE_COUNT_MAX == 3


def test_a_key_path_is_used_when_there_is_no_key_content_and_content_wins_when_both(connects, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_SSH_KEY_CONTENT", "")
    monkeypatch.setattr(settings, "ANVIL_SSH_KEY_PATH", "~/keys/anvil")
    asyncio.run(_touch())
    assert connects.kwargs[-1]["client_keys"] == [os.path.expanduser("~/keys/anvil")]
    monkeypatch.setattr(anvil_files, "_conn", None)
    monkeypatch.setattr(settings, "ANVIL_SSH_KEY_CONTENT", KEY_PEM)
    asyncio.run(_touch())
    assert isinstance(connects.kwargs[-1]["client_keys"][0], asyncssh.SSHKey)


def test_the_preferred_ciphers_come_first_and_asyncssh_s_other_defaults_follow(connects):
    asyncio.run(_touch())
    algs = connects.kwargs[0]["encryption_algs"]
    assert algs[:3] == ["aes128-gcm@openssh.com", "aes256-gcm@openssh.com", "chacha20-poly1305@openssh.com"]
    assert tuple(algs[:3]) == anvil_files.PREFERRED_ENCRYPTION_ALGS
    defaults = {a.decode() for a in asyncssh.encryption.get_default_encryption_algs()}
    assert set(algs) == defaults and len(algs) == len(set(algs))
    assert "aes256-ctr" in algs                    # a server without GCM can still be spoken to


# ---- the one connection -----------------------------------------------------------------------


def test_two_concurrent_first_callers_open_exactly_one_connection(connects):
    connects.delay = 0.05

    async def both():
        return await asyncio.gather(_touch(), _touch(), _touch())

    asyncio.run(both())
    assert len(connects.conns) == 1


def test_a_later_session_reuses_the_connection(connects):
    async def twice():
        await _touch()
        await _touch()

    asyncio.run(twice())
    assert len(connects.conns) == 1 and connects.conns[0].sftp.entered == 2


def test_a_closed_connection_is_replaced_on_the_next_call(connects):
    async def scenario():
        await _touch()
        connects.conns[0].closed = True            # the keepalive gave up, or the server hung up
        await _touch()

    asyncio.run(scenario())
    assert len(connects.conns) == 2 and not connects.conns[1].closed


@pytest.mark.parametrize(
    "error",
    [
        asyncssh.ConnectionLost("gone"),
        asyncssh.DisconnectError(11, "bye"),
        asyncssh.SFTPConnectionLost("sftp gone"),
        ConnectionResetError("reset"),
    ],
)
def test_a_connection_level_error_drops_the_connection_and_the_next_call_reconnects(connects, error):
    async def scenario():
        with pytest.raises(type(error)):
            async with anvil_files.sftp_session():
                raise error
        await _touch()

    asyncio.run(scenario())
    assert len(connects.conns) == 2
    assert connects.conns[0].close_calls == 1       # the dropped one was closed, not leaked


def test_an_error_about_a_file_does_not_drop_the_connection(connects):
    async def scenario():
        with pytest.raises(asyncssh.SFTPNoSuchFile):
            async with anvil_files.sftp_session():
                raise asyncssh.SFTPNoSuchFile("no such file")
        await _touch()

    asyncio.run(scenario())
    assert len(connects.conns) == 1 and connects.conns[0].close_calls == 0


def test_a_failed_connect_is_raised_and_the_next_call_tries_again(connects, monkeypatch):
    calls = []

    async def flaky(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise OSError("network unreachable")
        return FakeConn({})

    monkeypatch.setattr(asyncssh, "connect", flaky)

    async def scenario():
        with pytest.raises(OSError):
            await _touch()
        await _touch()

    asyncio.run(scenario())
    assert len(calls) == 2


# ---- close ----------------------------------------------------------------------------------


def test_close_closes_the_connection_once_and_twice_is_harmless(connects):
    async def scenario():
        await _touch()
        await anvil_files.close()
        await anvil_files.close()

    asyncio.run(scenario())
    conn = connects.conns[0]
    assert conn.close_calls == 1 and conn.waited == 1


def test_close_when_nothing_was_ever_opened_is_harmless(connects):
    asyncio.run(anvil_files.close())
    assert connects.conns == []


def test_a_call_after_close_opens_a_new_connection(connects):
    async def scenario():
        await _touch()
        await anvil_files.close()
        await _touch()

    asyncio.run(scenario())
    assert len(connects.conns) == 2


# ---- reading and removing -----------------------------------------------------------------------


def test_open_for_read_asks_for_the_read_block_size():
    assert anvil_files.READ_BLOCK_BYTES == 64 * 1024
    sftp = FakeSftp({"/a/b.nc": b"x"})
    anvil_files.open_for_read(sftp, "/a/b.nc")
    assert sftp.opened == [("/a/b.nc", "rb", 65536)]


def test_stream_file_yields_the_file_in_chunks_with_the_read_block_size(connects):
    async def collect():
        return [c async for c in anvil_files.stream_file("/a/b.nc", chunk_size=30)]

    chunks = asyncio.run(collect())
    assert [len(c) for c in chunks] == [30, 30, 30, 10] and b"".join(chunks) == b"0123456789" * 10
    assert connects.conns[0].sftp.opened == [("/a/b.nc", "rb", 65536)]


def test_stream_file_raises_for_a_file_that_is_not_there(connects):
    async def collect():
        return [c async for c in anvil_files.stream_file("/a/missing.nc")]

    with pytest.raises(asyncssh.SFTPNoSuchFile):
        asyncio.run(collect())
    assert connects.conns[0].close_calls == 0       # a missing file is not a lost connection


def test_closing_a_stream_early_closes_its_channel(connects):
    async def scenario():
        gen = anvil_files.stream_file("/a/b.nc", chunk_size=30)
        assert len(await gen.__anext__()) == 30
        await gen.aclose()

    asyncio.run(scenario())
    sftp = connects.conns[0].sftp
    assert sftp.entered == 1 and sftp.exited == 1


def test_stream_file_that_loses_the_connection_drops_it(connects):
    class Breaks(FakeFile):
        async def read(self, size):
            raise asyncssh.ConnectionLost("lost")

    async def scenario():
        await _touch()
        connects.conns[0].sftp.open = lambda *a, **k: Breaks(b"")
        with pytest.raises(asyncssh.ConnectionLost):
            [c async for c in anvil_files.stream_file("/a/b.nc")]
        await _touch()

    asyncio.run(scenario())
    assert len(connects.conns) == 2


def test_remove_file_removes_and_ignores_a_file_already_gone(connects):
    asyncio.run(anvil_files.remove_file("/a/b.nc"))
    assert connects.conns[0].sftp.removed == ["/a/b.nc"]
    asyncio.run(anvil_files.remove_file("/a/b.nc"))                  # a second removal is not an error
    assert connects.conns[0].sftp.removed == ["/a/b.nc"]


def test_anvil_not_configured_is_slurms_own_class():
    assert anvil_files.AnvilNotConfigured is slurm.AnvilNotConfigured
    assert not hasattr(slurm, "anvil_files")                           # slurm must not import this module


# ---- the framed stream of many files -------------------------------------------------------

MiB = 1024 * 1024


def entry_lines(entries) -> bytes:
    return b"".join(json.dumps({"path": p, "size": n}).encode() + b"\n" for p, n in entries)


END_LINE = b'{"end": true}\n'


def credit_line(count: int) -> bytes:
    return json.dumps({"credit": count}).encode() + b"\n"


def run_script(entries, cwd=None, raw: bytes | None = None, credit: int = 1 << 40):
    """The remote script, run here as the login node runs it, with ample credit unless told
    otherwise: (frames, exit status, stderr)."""
    stdin = raw if raw is not None else entry_lines(entries) + END_LINE + credit_line(credit)
    done = subprocess.run([sys.executable, "-I", "-c", anvil_files.REMOTE_SCRIPT], input=stdin,
                          capture_output=True, cwd=cwd, timeout=60)
    return done.stdout, done.returncode, done.stderr


def parse(frames: bytes):
    """A list of ("data", bytes) / ("end",) / ("error", message), as the format says."""
    out, at = [], 0
    while at < len(frames):
        (length,) = struct.unpack(">I", frames[at:at + 4])
        at += 4
        if length == 0:
            out.append(("end",))
        elif length == anvil_files.FRAME_ERROR:
            (count,) = struct.unpack(">I", frames[at:at + 4])
            out.append(("error", frames[at + 4:at + 4 + count].decode()))
            at += 4 + count
        else:
            assert length <= anvil_files.FRAME_MAX_BYTES
            out.append(("data", frames[at:at + length]))
            at += length
    return out


def joined(frames):
    """The files in a parsed stream: a list of the bytes between ENDs."""
    files, current = [], b""
    for frame in frames:
        if frame[0] == "data":
            current += frame[1]
        elif frame[0] == "end":
            files.append(current)
            current = b""
    return files


def test_the_remote_script_is_plain_python_3_6():
    ast.parse(anvil_files.REMOTE_SCRIPT, feature_version=(3, 6))
    compile(anvil_files.REMOTE_SCRIPT, "<remote>", "exec")
    assert anvil_files.remote_command().startswith("/usr/bin/python3 -I -c ")


def test_the_interpreter_is_a_setting_and_is_quoted(monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_REMOTE_PYTHON", "/opt/my py/bin/python3.9")
    assert anvil_files.remote_command().startswith("'/opt/my py/bin/python3.9' -I -c ")


def test_the_script_checks_its_interpreter_first_and_says_so_in_an_error_frame(tmp_path):
    """The real script, run with `sys.version_info` replaced by 3.5 before it starts: it must
    write an ERROR frame and exit 3 without reading stdin."""
    driver = (
        "import sys\n"
        "sys.version_info = (3, 5, 2, 'final', 0)\n"
        "exec(compile(sys.argv[1], '<remote>', 'exec'))\n"
    )
    proc = subprocess.run(
        [sys.executable, "-I", "-c", driver, anvil_files.REMOTE_SCRIPT],
        input=b"", capture_output=True, timeout=30,
    )
    assert proc.returncode == anvil_files.REMOTE_FAILURE_STATUS
    assert parse(proc.stdout) == [("error", "python 3.6 or newer is needed, this is 3.5")]


def test_the_scripts_guard_lets_the_current_interpreter_through(tmp_path):
    assert run_script([])[1] == 0


def test_the_script_sends_each_file_as_data_frames_then_an_end(tmp_path):
    big = os.urandom(MiB + 12345)
    files = {"a.nc": b"hello", "empty.nc": b"", "big.nc": big, "b.nc": b"x" * 10}
    for name, data in files.items():
        (tmp_path / name).write_bytes(data)
    frames, status, err = run_script([(str(tmp_path / n), len(d)) for n, d in files.items()])
    assert status == 0 and err == b""
    parsed = parse(frames)
    assert joined(parsed) == list(files.values())
    assert [f[0] for f in parsed].count("end") == 4
    sizes = [len(f[1]) for f in parsed if f[0] == "data"]
    assert max(sizes) == MiB and all(n > 0 for n in sizes)
    assert parsed[0] == ("data", b"hello") and parsed[1] == ("end",) and parsed[2] == ("end",)   # the empty one: END only


def test_no_entries_is_no_output_and_status_0(tmp_path):
    assert run_script([]) == (b"", 0, b"")


def test_a_file_of_another_size_than_listed_is_an_error_frame_and_status_3(tmp_path):
    (tmp_path / "a").write_bytes(b"12345")
    (tmp_path / "b").write_bytes(b"zz")
    for listed in (4, 6):
        frames, status, _ = run_script([(str(tmp_path / "a"), listed), (str(tmp_path / "b"), 2)])
        parsed = parse(frames)
        assert status == 3 and len(parsed) == 1 and parsed[0][0] == "error"
        assert "5 bytes" in parsed[0][1] and f"{listed} expected" in parsed[0][1]


def test_a_missing_file_and_a_bad_line_are_errors(tmp_path):
    frames, status, _ = run_script([(str(tmp_path / "nope"), 1)])
    assert status == 3 and parse(frames)[0][0] == "error" and "FileNotFoundError" in parse(frames)[0][1]
    frames, status, _ = run_script([], raw=b"not json\n")
    assert status == 3 and parse(frames)[0][0] == "error"
    frames, status, _ = run_script([], raw=b'{"path": "/x", "size": -1}\n')
    assert status == 3 and "bad entry" in parse(frames)[0][1]


def test_a_symbolic_link_is_refused_and_a_folder_is_not_a_file(tmp_path):
    (tmp_path / "real").write_bytes(b"secret")
    os.symlink(tmp_path / "real", tmp_path / "link")
    frames, status, _ = run_script([(str(tmp_path / "link"), 6)])
    parsed = parse(frames)
    assert status == 3 and parsed[0][0] == "error" and not any(f[0] == "data" for f in parsed)
    frames, status, _ = run_script([(str(tmp_path), 0)])
    assert status == 3 and "not a regular file" in parse(frames)[0][1]


def test_a_file_that_grew_or_shrank_after_it_was_listed_is_an_error_not_a_wrong_file(tmp_path):
    (tmp_path / "f").write_bytes(b"x" * 100)
    for listed in (99, 101):                       # grown since listed / shrunk since listed
        frames, status, _ = run_script([(str(tmp_path / "f"), listed)])
        assert status == 3 and parse(frames)[0][0] == "error"


def test_a_file_that_changes_while_it_is_read_is_caught(tmp_path):
    """Grown or shrunk in the middle of a read, which the size check at the start cannot see:
    a FIFO-free way is a file the script reads while another process appends and truncates."""
    target = tmp_path / "f"
    target.write_bytes(b"x" * (3 * MiB))
    script = anvil_files.REMOTE_SCRIPT.replace(
        "left = size\n", "left = size\n        hook(fd)\n").replace("import json\n", "import json\n", 1)

    def run(mutate: str):
        code = ("def hook(fd):\n    " + mutate + "\n" + script)
        done = subprocess.run([sys.executable, "-I", "-c", code],
                              input=entry_lines([(str(target), 3 * MiB)]) + END_LINE + credit_line(1 << 40),
                              capture_output=True, timeout=60)
        return done.stdout, done.returncode

    for mutate, word in (("open(%r, 'ab').write(b'y')" % str(target), "grew"),
                         ("os.truncate(%r, 10)" % str(target), "early")):
        target.write_bytes(b"x" * (3 * MiB))
        frames, status = run(mutate if "os." not in mutate else "import os; " + mutate)
        parsed = parse(frames)
        assert status == 3 and parsed[-1][0] == "error" and word in parsed[-1][1], parsed[-1]


class Process:
    """An asyncssh process that runs the real script locally, for the client's end to end."""

    def __init__(self, proc, command):
        self._proc, self.command = proc, command
        self.stdin, self.stdout, self.stderr = proc.stdin, proc.stdout, proc.stderr
        self.terminated = self.closed = False

    @classmethod
    async def start(cls, command=None):
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-I", "-c", anvil_files.REMOTE_SCRIPT,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        return cls(proc, command)

    @property
    def exit_status(self):
        return self._proc.returncode

    def terminate(self):
        self.terminated = True
        if self._proc.returncode is None:
            self._proc.terminate()

    def close(self):
        self.closed = True
        if self._proc.returncode is None:
            self._proc.kill()

    async def wait_closed(self):
        await self._proc.wait()


class Scripted:
    """A process with nothing behind it: stdout and stderr are bytes it was given."""

    def __init__(self, out: bytes = b"", err: bytes = b"", status: int | None = 0, eof: bool = True):
        self._given = (out, err, eof)
        self.exit_status = status
        self.written = b""
        self.eof_written = False
        self.terminated = self.closed = False
        process = self

        class Stdin:
            def write(self, data):
                process.written += data

            async def drain(self):
                pass

            def write_eof(self):
                process.eof_written = True

        self.stdin = Stdin()

    def bind(self):
        """Create the readers, which need the running loop."""
        out, err, eof = self._given
        self.stdout, self.stderr = asyncio.StreamReader(), asyncio.StreamReader()
        self.stdout.feed_data(out)
        self.stderr.feed_data(err)
        if eof:
            self.stdout.feed_eof()
            self.stderr.feed_eof()

    def terminate(self):
        self.terminated = True

    def close(self):
        self.closed = True

    async def wait_closed(self):
        return None


def frame(data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + data


END = struct.pack(">I", 0)


def error_frame(message: str) -> bytes:
    raw = message.encode()
    return struct.pack(">II", anvil_files.FRAME_ERROR, len(raw)) + raw


async def collect(files, path, size):
    return [chunk async for chunk in files.read_file(path, size)]


def test_stream_files_reads_real_files_through_the_script_in_order(connects, tmp_path):
    big = os.urandom(MiB + 7)
    (tmp_path / "a").write_bytes(b"abc")
    (tmp_path / "e").write_bytes(b"")
    (tmp_path / "b").write_bytes(big)
    entries = [(str(tmp_path / n), len(d)) for n, d in (("a", b"abc"), ("e", b""), ("b", big))]

    async def go():
        # the connection must exist before its process can be set: open it, then stream
        await _touch()
        conn = connects.conns[0]
        process = await Process.start()
        conn.process = process
        async with anvil_files.stream_files(entries) as files:
            got = [b"".join(await collect(files, p, n)) for p, n in entries]
        return got, process

    got, process = asyncio.run(go())
    assert got == [b"abc", b"", big]
    command, kwargs = connects.conns[0].commands[0]
    assert command == anvil_files.remote_command()
    assert kwargs == {"encoding": None, "window": 16 * MiB, "max_pktsize": 256 * 1024}
    assert process.terminated and process.closed          # the channel is ended on leaving


def test_a_file_that_changed_size_is_an_error_through_the_client_and_later_files_are_not_sent(connects, tmp_path):
    (tmp_path / "a").write_bytes(b"abcd")
    (tmp_path / "b").write_bytes(b"zz")
    entries = [(str(tmp_path / "a"), 3), (str(tmp_path / "b"), 2)]

    async def go():
        await _touch()
        connects.conns[0].process = await Process.start()
        async with anvil_files.stream_files(entries) as files:
            with pytest.raises(anvil_files.RemoteReadError, match="4 bytes, 3 expected"):
                await collect(files, *entries[0])

    asyncio.run(go())


async def _with_process(connects, process, entries):
    await _touch()
    process.bind()
    connects.conns[0].process = process
    return anvil_files.stream_files(entries)


def test_the_client_writes_the_entries_the_end_and_the_first_credit_and_keeps_stdin_open(connects):
    process = Scripted(frame(b"hi") + END)
    entries = [("/a/é.nc", 2)]

    async def go():
        async with await _with_process(connects, process, entries) as files:
            assert await collect(files, "/a/é.nc", 2) == [b"hi"]
            await asyncio.sleep(0)

    asyncio.run(go())
    assert [json.loads(line) for line in process.written.splitlines()] == [
        {"path": "/a/é.nc", "size": 2}, {"end": True}, {"credit": anvil_files.STREAM_CREDIT_BYTES}]
    assert not process.eof_written and process.written.isascii()


def test_data_arrives_in_the_frames_it_was_sent_and_the_end_is_checked(connects):
    process = Scripted(frame(b"ab") + frame(b"cde") + END + END)

    async def go():
        async with await _with_process(connects, process, [("/a", 5), ("/b", 0)]) as files:
            assert await collect(files, "/a", 5) == [b"ab", b"cde"]
            assert await collect(files, "/b", 0) == []

    asyncio.run(go())


@pytest.mark.parametrize("out, match", [
    (frame(b"ab") + END, "2 bytes read, 5 listed"),                      # END too early
    (frame(b"abcdef") + END, "data frame"),                              # more than listed
    (frame(b"ab") + error_frame("a.nc grew while it was read"), "grew while it was read"),
    (frame(b"ab"), "stream ended"),                                      # truncated
    (frame(b"ab")[:3], "stream ended"),                                  # truncated in a header
    (struct.pack(">I", anvil_files.FRAME_MAX_BYTES + 1), "data frame"),
])
def test_what_the_stream_gets_wrong_is_a_clear_error(connects, out, match):
    process = Scripted(out, err=b"Traceback: boom\n", status=3)

    async def go():
        async with await _with_process(connects, process, [("/a", 5)]) as files:
            with pytest.raises(anvil_files.RemoteReadError, match=match) as info:
                await collect(files, "/a", 5)
            return str(info.value)

    message = asyncio.run(go())
    if "stream ended" in match:
        assert "exit status 3" in message and "boom" in message


def test_a_non_zero_exit_with_no_frames_names_the_status_and_the_stderr_tail(connects):
    process = Scripted(b"", err=b"python3: command not found\n", status=127)

    async def go():
        async with await _with_process(connects, process, [("/a", 1)]) as files:
            with pytest.raises(anvil_files.RemoteReadError) as info:
                await collect(files, "/a", 1)
            return str(info.value)

    message = asyncio.run(go())
    assert "exit status 127" in message and "command not found" in message


def test_files_must_be_asked_for_in_the_order_listed_and_one_at_a_time(connects):
    process = Scripted(frame(b"a") + END + frame(b"b") + END)

    async def go():
        async with await _with_process(connects, process, [("/a", 1), ("/b", 1)]) as files:
            with pytest.raises(anvil_files.RemoteReadError, match="not the next"):
                files.read_file("/b", 1)
            with pytest.raises(anvil_files.RemoteReadError, match="not the next"):
                files.read_file("/a", 2)                      # same path, another size
            first = files.read_file("/a", 1)
            with pytest.raises(anvil_files.RemoteReadError, match="before the file before"):
                files.read_file("/b", 1)
            assert [c async for c in first] == [b"a"]
            assert await collect(files, "/b", 1) == [b"b"]
            with pytest.raises(anvil_files.RemoteReadError, match="not the next"):
                files.read_file("/b", 1)

    asyncio.run(go())


def test_leaving_in_the_middle_of_a_file_ends_the_process_and_the_background_tasks(connects):
    process = Scripted(frame(b"ab"), eof=False)

    async def go():
        async with await _with_process(connects, process, [("/a", 5)]) as files:
            reader = files.read_file("/a", 5)
            assert await reader.__anext__() == b"ab"
            await reader.aclose()                              # the browser went away
            tasks = list(files._tasks)
        return tasks

    tasks = asyncio.run(go())
    assert process.terminated and process.closed and all(t.done() for t in tasks)


def test_a_cancelled_reader_ends_the_process_too(connects):
    process = Scripted(b"", eof=False)

    async def go():
        async def read():
            async with await _with_process(connects, process, [("/a", 5)]) as files:
                await collect(files, "/a", 5)

        task = asyncio.ensure_future(read())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(go())
    assert process.terminated and process.closed


def test_a_connection_level_failure_drops_the_connection(connects):
    process = Scripted(b"", eof=False)

    async def go():
        with pytest.raises(asyncssh.ConnectionLost):
            async with await _with_process(connects, process, [("/a", 1)]):
                raise asyncssh.ConnectionLost("gone")

    asyncio.run(go())
    assert connects.conns[0].closed and anvil_files._conn is None


def test_a_failure_to_open_the_channel_drops_the_connection_and_a_file_error_does_not(connects):
    async def go():
        await _touch()
        conn = connects.conns[0]

        async def boom(command, **kwargs):
            raise asyncssh.ConnectionLost("gone")

        conn.create_process = boom
        with pytest.raises(asyncssh.ConnectionLost):
            async with anvil_files.stream_files([("/a", 1)]):
                pass
        assert conn.closed

    asyncio.run(go())
    connects.conns.clear()

    async def other():
        await _touch()
        scripted = Scripted(error_frame("nope"))
        scripted.bind()
        connects.conns[0].process = scripted
        async with anvil_files.stream_files([("/a", 1)]) as files:
            with pytest.raises(anvil_files.RemoteReadError, match="nope"):
                await collect(files, "/a", 1)
        assert not connects.conns[0].closed

    asyncio.run(other())


# ---- credit: the script writes only what it was granted -----------------------------------------


async def start_script():
    return await asyncio.create_subprocess_exec(
        sys.executable, "-I", "-c", anvil_files.REMOTE_SCRIPT,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)


async def read_until_quiet(proc, quiet=0.5) -> bytes:
    """Everything the script writes until it has been silent for `quiet` seconds (or ends)."""
    got = b""
    while True:
        try:
            data = await asyncio.wait_for(proc.stdout.read(65536), quiet)
        except asyncio.TimeoutError:
            return got
        if not data:
            return got
        got += data


def test_the_script_writes_no_more_than_its_credit_then_waits_and_continues_on_more(tmp_path):
    big = os.urandom(5 * MiB)
    (tmp_path / "f").write_bytes(big)

    async def go():
        proc = await start_script()
        proc.stdin.write(entry_lines([(str(tmp_path / "f"), len(big))]) + END_LINE + credit_line(MiB))
        await proc.stdin.drain()
        first = await read_until_quiet(proc)
        assert proc.returncode is None                       # blocked, not finished
        assert await read_until_quiet(proc, 0.3) == b""      # and still nothing more
        proc.stdin.write(credit_line(100 * MiB))
        await proc.stdin.drain()
        rest = b""
        while True:
            data = await proc.stdout.read(65536)
            if not data:
                break
            rest += data
        return first, rest, await proc.wait()

    first, rest, status = asyncio.run(go())
    assert len(first) == MiB                                 # all of it used, header included
    assert status == 0
    assert joined(parse(first + rest)) == [big]
    assert [f[0] for f in parse(first + rest)].count("end") == 1


def test_a_credit_of_a_few_bytes_splits_data_into_small_frames_that_fit(tmp_path):
    (tmp_path / "f").write_bytes(b"hello")
    entries = [(str(tmp_path / "f"), 5)]
    # 5 bytes per grant: a 1-byte DATA frame is 5 bytes; the END needs 4
    stdin = entry_lines(entries) + END_LINE + credit_line(5) * 6
    done = subprocess.run([sys.executable, "-I", "-c", anvil_files.REMOTE_SCRIPT], input=stdin,
                          capture_output=True, timeout=60)
    assert done.returncode == 0
    parsed = parse(done.stdout)
    assert [f for f in parsed if f[0] == "data"] == [("data", b"h"), ("data", b"e"), ("data", b"l"),
                                                     ("data", b"l"), ("data", b"o")]
    assert joined(parsed) == [b"hello"]


def test_stdin_ending_while_the_script_needs_credit_is_a_quiet_exit_with_status_4(tmp_path):
    (tmp_path / "f").write_bytes(b"x" * 100)
    entries = [(str(tmp_path / "f"), 100)]
    assert anvil_files.REMOTE_GONE_STATUS == 4
    for stdin in (entry_lines(entries) + END_LINE,                       # no credit at all
                  entry_lines(entries) + END_LINE + credit_line(50),     # runs out part way
                  entry_lines(entries)):                                 # the list never ends
        done = subprocess.run([sys.executable, "-I", "-c", anvil_files.REMOTE_SCRIPT], input=stdin,
                              capture_output=True, timeout=60)
        assert done.returncode == 4 and done.stderr == b""
        assert not any(f[0] == "error" for f in parse(done.stdout))
        assert len(done.stdout) <= 50


def test_a_script_run_needs_credit_even_for_an_empty_file_s_end(tmp_path):
    (tmp_path / "e").write_bytes(b"")
    done = subprocess.run([sys.executable, "-I", "-c", anvil_files.REMOTE_SCRIPT],
                          input=entry_lines([(str(tmp_path / "e"), 0)]) + END_LINE + credit_line(3),
                          capture_output=True, timeout=60)
    assert done.returncode == 4 and done.stdout == b""


class MeteredOut:
    """stdout of a local script behind a pump that counts what the script wrote (`produced`)
    and what the reader took (`taken`); `peak` is the most that was ever written and not taken.
    The pump's own buffer is unbounded, so a script that ignored its credit would show it."""

    def __init__(self, source) -> None:
        self._source, self._reader = source, asyncio.StreamReader(limit=1 << 40)
        self.produced = self.taken = self.peak = 0
        self.task = asyncio.ensure_future(self._pump())

    async def _pump(self):
        while True:
            data = await self._source.read(65536)
            if not data:
                self._reader.feed_eof()
                return
            self.produced += len(data)
            self._reader.feed_data(data)
            self.peak = max(self.peak, self.produced - self.taken)

    async def readexactly(self, count):
        data = await self._reader.readexactly(count)
        self.taken += len(data)
        return data

    async def read(self, count):
        data = await self._reader.read(count)
        self.taken += len(data)
        return data


def test_a_slow_consumer_never_has_more_than_the_credit_written_and_not_consumed(connects, tmp_path):
    files = {"a": os.urandom(20 * MiB + 11), "b": os.urandom(3 * MiB), "c": b"", "d": os.urandom(9 * MiB)}
    for name, data in files.items():
        (tmp_path / name).write_bytes(data)
    entries = [(str(tmp_path / n), len(d)) for n, d in files.items()]

    async def go():
        await _touch()
        process = await Process.start()
        meter = MeteredOut(process.stdout)
        process.stdout = meter
        connects.conns[0].process = process
        got = []
        async with anvil_files.stream_files(entries) as stream:
            for path, size in entries:
                chunks = []
                async for chunk in stream.read_file(path, size):
                    chunks.append(chunk)
                    await asyncio.sleep(0.02)               # a slow reader: the script is far ahead
                got.append(b"".join(chunks))
        return got, meter

    got, meter = asyncio.run(go())
    assert got == list(files.values())
    assert meter.peak <= anvil_files.STREAM_CREDIT_BYTES
    assert meter.peak > anvil_files.STREAM_CREDIT_BYTES // 2   # the credit really was used


def test_credit_goes_out_as_data_is_consumed_and_never_more_than_the_bound_is_outstanding(connects, monkeypatch):
    monkeypatch.setattr(anvil_files, "STREAM_CREDIT_BYTES", 100)
    monkeypatch.setattr(anvil_files, "STREAM_CREDIT_STEP_BYTES", 50)
    chunks = [bytes([i]) * 30 for i in range(20)]
    process = Scripted(b"".join(frame(c) for c in chunks) + END)
    size = 30 * len(chunks)

    def granted():
        total = 0
        for line in process.written.splitlines():
            entry = json.loads(line)
            total += entry.get("credit", 0)
        return total

    async def go():
        seen = []
        async with await _with_process(connects, process, [("/a", size)]) as files:
            consumed = 0
            async for chunk in files.read_file("/a", size):
                consumed += 4 + len(chunk)
                await asyncio.sleep(0.01)                     # let the writer task send
                seen.append((granted(), consumed))
        return seen

    seen = asyncio.run(go())
    assert seen[0][0] >= 100                                  # the initial credit
    for grant, consumed in seen:
        assert grant - consumed <= 100                        # never more than the bound outstanding
        assert grant - consumed > 100 - 50                    # and credit does keep flowing
    assert seen[-1][0] > 100


# ---- the pre-flight ------------------------------------------------------------------------


def answer(status=0, stdout="3.6\n", stderr=""):
    return SimpleNamespace(exit_status=status, stdout=stdout, stderr=stderr)


async def _preflight(connects, result):
    """Run the check on a connection whose `run` answers `result`; the connection."""
    conn = await anvil_files._connection()
    conn.run_result = result
    await anvil_files.check_remote_python()
    return conn


def test_a_good_interpreter_passes_and_the_command_is_the_quoted_isolated_query(connects):
    conn = asyncio.run(_preflight(connects, answer(stdout="3.6\n")))
    assert conn.runs == ["/usr/bin/python3 -I -c " + __import__("shlex").quote(anvil_files._VERSION_PROGRAM)]
    assert anvil_files._python_checked == {"/usr/bin/python3"}


def test_a_success_is_remembered_so_the_second_check_runs_nothing(connects):
    async def go():
        conn = await _preflight(connects, answer(stdout="3.9"))
        await anvil_files.check_remote_python()
        return conn

    assert len(asyncio.run(go()).runs) == 1


def test_the_setting_is_honoured_and_a_changed_one_is_checked_afresh(connects, monkeypatch):
    async def go():
        conn = await _preflight(connects, answer())
        monkeypatch.setattr(settings, "ANVIL_REMOTE_PYTHON", "/opt/py 3/bin/python3")
        await anvil_files.check_remote_python()
        return conn

    conn = asyncio.run(go())
    assert len(conn.runs) == 2 and conn.runs[1].startswith("'/opt/py 3/bin/python3' -I -c ")


def test_status_127_says_python_is_not_there_and_names_the_setting(connects):
    with pytest.raises(anvil_files.RemoteUnavailable) as err:
        asyncio.run(_preflight(connects, answer(status=127, stdout="", stderr="bash: command not found")))
    assert str(err.value) == "python3 not found at /usr/bin/python3 on the login node; set ANVIL_REMOTE_PYTHON"


def test_another_failing_status_carries_the_end_of_stderr(connects):
    with pytest.raises(anvil_files.RemoteUnavailable) as err:
        asyncio.run(_preflight(connects, answer(status=1, stdout="", stderr="boom\nlibpython missing\n")))
    assert str(err.value) == (
        "/usr/bin/python3 on the login node failed with exit status 1: boom\nlibpython missing"
    )
    with pytest.raises(anvil_files.RemoteUnavailable) as err:
        asyncio.run(_preflight(connects, answer(status=2, stdout="", stderr=b"")))
    assert str(err.value) == "/usr/bin/python3 on the login node failed with exit status 2"


@pytest.mark.parametrize("text", ["", "hello", "3", "3.6.8", "a.b"])
def test_an_answer_that_is_not_major_dot_minor_is_refused(connects, text):
    with pytest.raises(anvil_files.RemoteUnavailable, match="not major.minor"):
        asyncio.run(_preflight(connects, answer(stdout=text)))


def test_a_version_older_than_3_6_is_refused_and_3_6_and_newer_pass(connects):
    with pytest.raises(anvil_files.RemoteUnavailable) as err:
        asyncio.run(_preflight(connects, answer(stdout="3.5\n")))
    assert str(err.value) == "/usr/bin/python3 on the login node is 3.5, 3.6 or newer is needed"
    assert anvil_files._python_checked == set()
    for version in ("3.6", "3.10", "4.0"):
        anvil_files._python_checked.clear()
        asyncio.run(_preflight(connects, answer(stdout=version)))


def test_a_query_that_does_not_answer_in_time_is_refused(connects, monkeypatch):
    monkeypatch.setattr(anvil_files, "_PREFLIGHT_TIMEOUT_SECONDS", 0.05)
    with pytest.raises(anvil_files.RemoteUnavailable, match="did not answer in 0.05 s"):
        asyncio.run(_preflight(connects, "hang"))


def test_a_failure_is_not_remembered_and_the_next_check_asks_again(connects):
    async def go():
        conn = await _preflight(connects, answer())
        anvil_files._python_checked.clear()
        conn.run_result = answer(status=127)
        with pytest.raises(anvil_files.RemoteUnavailable):
            await anvil_files.check_remote_python()
        assert anvil_files._python_checked == set()
        conn.run_result = answer()       # fixed on the login node
        await anvil_files.check_remote_python()
        return conn

    conn = asyncio.run(go())
    assert len(conn.runs) == 3 and anvil_files._python_checked == {"/usr/bin/python3"}


def test_the_remembered_check_goes_with_the_connection(connects):
    async def go():
        await _preflight(connects, answer())
        assert anvil_files._python_checked
        anvil_files._discard(anvil_files._conn)
        assert anvil_files._python_checked == set()
        conn = await _preflight(connects, answer())     # a new connection is asked again
        assert conn.runs and connects.conns[0] is not conn
        await anvil_files.close()
        assert anvil_files._python_checked == set()

    asyncio.run(go())


def test_a_connection_that_closed_by_itself_forgets_the_check_when_replaced(connects):
    async def go():
        conn = await _preflight(connects, answer())
        conn.closed = True
        await anvil_files._connection()
        assert anvil_files._python_checked == set()

    asyncio.run(go())


def test_a_connection_level_failure_in_the_check_drops_the_connection_and_propagates(connects):
    async def go():
        conn = await anvil_files._connection()
        conn.run_result = asyncssh.ConnectionLost("gone")
        with pytest.raises(asyncssh.ConnectionLost):
            await anvil_files.check_remote_python()
        return conn

    conn = asyncio.run(go())
    assert conn.closed and anvil_files._conn is None and anvil_files._python_checked == set()
