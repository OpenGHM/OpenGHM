"""Entries of a folder of a published tree as one ZIP, streamed (ADR 0036).

The second case of bytes passing through the gateway, after the output subset
(ADR 0033): the browser cannot read the bucket (no CORS headers) and a ZIP is not
an object in it, so the backend reads each object anonymously, as `tree_browse`
does, and writes the archive as the browser takes it. No object is held whole in
memory (a small one may be: see below), and nothing is written to disk.

The standard library writes it. Handed a file object with no `tell()`, `zipfile`
writes each entry's sizes and checksum after its data (a data descriptor) rather
than seeking back, which is what a stream needs. Entries are stored, not
deflated: the output is NetCDF, already compressed, and storing is what keeps the
stream as fast as the bucket. A stored archive's length follows from the listed
sizes and the names alone, so it is sent as `Content-Length` and the browser shows
real progress.

Reading the objects one after another costs a round trip each, which for a folder
of hundreds of small files is most of the time. So up to `PREFETCH` objects are
requested ahead of the one being written, over the one client, and an object is
buffered whole only if it is at most `_PREFETCH_OBJECT_BYTES` and the buffered
total stays within `_PREFETCH_TOTAL_BYTES`; a larger one is streamed in its turn.
Output order is the listing's, whatever order the reads finish in. A failed read
ends the response, and whatever is still in flight is cancelled with it.

What goes in the ZIP is a selection: names of files and folders directly inside one
folder, as ticked in the browser. A file is stored as its name, a folder as its
name and what is under it at any depth.

A selection over `ARCHIVE_LIMIT_BYTES` is refused before anything is sent, and only
`MAX_ARCHIVES` archives are written at once per process: one more is refused, not
queued, since a waiting request would hold a browser's download open for nothing.

The writer does not know where the bytes come from. It is given a `connect`: an async
context manager that yields a reader, `read(obj)`, which gives the bytes of one
`FolderObject`. The default reads a published object over HTTPS by `obj.url`; a run's
output on Anvil scratch (ADR 0040, `run_files`) reads over SFTP by `obj.key`. The limit,
the slot count, the stored entries, the read-ahead and the failed-stream behaviour are
the one set, whatever the source.
"""

from __future__ import annotations

import asyncio
import logging
import zipfile
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, aclosing, asynccontextmanager
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

from app.services import tree_browse
from app.services.tree_browse import Kind

logger = logging.getLogger(__name__)

MAX_ARCHIVES = 3
_CHUNK = 64 * 1024
#: Objects requested ahead of the one being written, buffered or in flight.
PREFETCH = 8
_PREFETCH_OBJECT_BYTES = 16 * 1024 * 1024
# Per archive. With MAX_ARCHIVES at once that is 192 MiB of buffered objects,
# well inside the backend pod's 1 GiB limit (it idles near 128 MiB);
# output files are mostly under 1 MiB, so 64 MiB still fills the window.
_PREFETCH_TOTAL_BYTES = 64 * 1024 * 1024
#: Between two reads of one object, not for the whole of it.
_READ_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
#: What a stored entry costs beyond its name and data, without ZIP64: a local
#: header (30 + name), a data descriptor (16), a central directory entry (46 +
#: name); and the end-of-archive record (22).
_ENTRY_FIXED = 30 + 16 + 46
_END_RECORD = 22


class SelectionTooLarge(Exception):
    """The selection is over the limit, or too large to have been listed whole."""

    def __init__(self, size: int):
        super().__init__(f"{size} bytes")
        self.size = size


class ArchiveBusy(Exception):
    """`MAX_ARCHIVES` archives are being written already."""


class ArchiveError(Exception):
    """An object could not be read, or was not the size the listing gave."""


#: The bytes of one object, as they arrive.
Reader = Callable[[tree_browse.FolderObject], AsyncIterator[bytes]]
#: Opens whatever the reads share (one HTTP client, one SFTP channel) for an archive's
#: length and closes it at the end.
Connect = Callable[[], AbstractAsyncContextManager[Reader]]

_active = 0


class _Slot:
    """One of the `MAX_ARCHIVES`. Released by the stream's end and, should the
    stream never start, by the response's background task: whichever is first."""

    def __init__(self) -> None:
        self._held = True

    def release(self) -> None:
        global _active
        if self._held:
            self._held = False
            _active -= 1


def acquire() -> _Slot:
    """A place among the `MAX_ARCHIVES`, shared by every source; `ArchiveBusy` when none is free."""
    global _active
    if _active >= MAX_ARCHIVES:
        raise ArchiveBusy
    _active += 1
    return _Slot()


class _Sink:
    """What `zipfile` writes to: a buffer the stream empties after each write.
    It has no `tell()`, which is what makes `zipfile` use data descriptors."""

    def __init__(self) -> None:
        self._parts: list[bytes] = []

    def write(self, data: bytes) -> int:
        self._parts.append(bytes(data))
        return len(data)

    def flush(self) -> None:
        pass

    def take(self) -> list[bytes]:
        """What was written since the last call, in the pieces it came in."""
        parts = [part for part in self._parts if part]
        self._parts.clear()
        return parts


def _date_time(modified: str) -> tuple[int, int, int, int, int, int]:
    """The ZIP's own timestamp for an object, from its `LastModified` (UTC);
    the format starts in 1980."""
    try:
        when = datetime.fromisoformat(modified.replace("Z", "+00:00")).astimezone(
            timezone.utc
        )
    except ValueError:
        return (1980, 1, 1, 0, 0, 0)
    if when.year < 1980:
        return (1980, 1, 1, 0, 0, 0)
    return (when.year, when.month, when.day, when.hour, when.minute, when.second)


def archive_length(entries: list[tuple[str, int]]) -> int | None:
    """The exact size of the stored archive of `entries` (ZIP name, size), or
    `None` when ZIP64 would be needed, which changes the records' sizes and is
    left to the stream: more than 65535 entries, or a size near 2 GiB."""
    total = _END_RECORD
    for name, size in entries:
        if size * 1.05 > zipfile.ZIP64_LIMIT:
            return None
        total += _ENTRY_FIXED + 2 * len(name.encode("utf-8")) + size
    if len(entries) > zipfile.ZIP_FILECOUNT_LIMIT or total > zipfile.ZIP64_LIMIT:
        return None
    return total


def _client() -> httpx.AsyncClient:
    """One client for all the objects of an archive, which keeps the connection."""
    return httpx.AsyncClient(timeout=_READ_TIMEOUT, follow_redirects=True)


async def _read(client: httpx.AsyncClient, url: str) -> AsyncIterator[bytes]:
    # `aiter_raw`: the object's bytes as stored, never decoded.
    async with client.stream("GET", url) as response:
        if response.status_code != 200:
            raise ArchiveError(f"HTTP {response.status_code}")
        async with aclosing(response.aiter_raw(_CHUNK)) as raw:
            async for chunk in raw:
                yield chunk


@asynccontextmanager
async def http_source() -> AsyncIterator[Reader]:
    """The default `Connect`: a published object, read anonymously by its URL."""
    async with _client() as client:
        yield lambda obj: _read(client, obj.url)


async def _fetch(read: Reader, obj: tree_browse.FolderObject) -> bytes:
    """The whole object, for one that is read ahead of its turn."""
    parts: list[bytes] = []
    got = 0
    try:
        async with aclosing(read(obj)) as chunks:
            async for chunk in chunks:
                got += len(chunk)
                if (
                    got > obj.size
                ):  # more than listed: not kept in memory to find the end
                    raise ArchiveError(f"more than the {obj.size} bytes listed")
                parts.append(chunk)
        if got != obj.size:
            raise ArchiveError(f"{got} bytes read, {obj.size} listed")
    except Exception as exc:
        # It fails while another object is being written: say which one it was.
        raise ArchiveError(f"{obj.key}: {exc}") from exc
    return b"".join(parts)


class _Ahead:
    """The reads started before their turn: a task per object, at most `PREFETCH`
    at a time, holding at most `_PREFETCH_TOTAL_BYTES` of listed sizes between
    them. An object too large to buffer is not read ahead."""

    def __init__(
        self,
        read: Reader,
        entries: list[tuple[str, tree_browse.FolderObject]],
    ) -> None:
        self._read = read
        self._entries = entries
        self._tasks: dict[int, asyncio.Task[bytes]] = {}
        self._held = 0
        self._scan = 0
        #: The task being waited for, which is no longer among `_tasks`.
        self._waiting: asyncio.Task[bytes] | None = None

    def fill(self, current: int) -> None:
        """Start reads from `current` on, as far as the limits allow."""
        self.check()
        self._scan = max(self._scan, current)
        while len(self._tasks) < PREFETCH and self._scan < len(self._entries):
            obj = self._entries[self._scan][1]
            if obj.size <= _PREFETCH_OBJECT_BYTES:
                if self._held + obj.size > _PREFETCH_TOTAL_BYTES:
                    break
                self._held += obj.size
                self._tasks[self._scan] = asyncio.create_task(_fetch(self._read, obj))
            self._scan += 1

    def check(self) -> None:
        """Raise what a finished read raised, without waiting for its turn: a
        failure should end the response when it happens, not when it is reached."""
        for task in self._tasks.values():
            if task.done() and not task.cancelled() and task.exception() is not None:
                raise task.exception()  # type: ignore[misc]

    async def take(self, index: int) -> bytes | None:
        """The object's bytes, when it was read ahead, else `None` (to be streamed)."""
        task = self._tasks.pop(index, None)
        if task is None:
            return None
        self._held -= self._entries[index][1].size
        self._waiting = task
        # While it is awaited, a failure of any other read still ends the response.
        while not task.done():
            waiting = {task} | {t for t in self._tasks.values() if not t.done()}
            await asyncio.wait(waiting, return_when=asyncio.FIRST_COMPLETED)
            self.check()
        data = await task
        self.fill(index + 1)
        return data

    async def close(self) -> None:
        """Cancel what is in flight and wait until it has stopped."""
        tasks = list(self._tasks.values())
        if self._waiting is not None:
            tasks.append(self._waiting)
        self._tasks.clear()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def _write(
    entries: list[tuple[str, tree_browse.FolderObject]],
    slot: _Slot,
    connect: Connect | None = None,
) -> AsyncIterator[bytes]:
    sink = _Sink()
    archive = zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED, allowZip64=True)
    current = ""
    try:
        async with (connect or http_source)() as read:
            ahead = _Ahead(read, entries)
            try:
                for index, (name, obj) in enumerate(entries):
                    current = obj.key
                    ahead.fill(index)
                    info = zipfile.ZipInfo(name, _date_time(obj.modified))
                    info.compress_type = zipfile.ZIP_STORED
                    info.external_attr = 0o644 << 16
                    # ZIP64 records are written when the size says they are needed.
                    info.file_size = obj.size
                    with archive.open(info, "w") as out:
                        data = await ahead.take(index)
                        if data is not None:
                            out.write(data)
                        else:
                            sent = 0
                            async with aclosing(read(obj)) as chunks:
                                async for chunk in chunks:
                                    out.write(chunk)
                                    sent += len(chunk)
                                    for part in sink.take():
                                        yield part
                                    ahead.check()
                            if sent != obj.size:
                                raise ArchiveError(
                                    f"{sent} bytes read, {obj.size} listed"
                                )
                    for part in sink.take():
                        yield part
            finally:
                # On a failure and on the client leaving alike: nothing stays in flight.
                await ahead.close()
        archive.close()
        for part in sink.take():
            yield part
    except Exception as exc:
        # The response has begun, so its status cannot change. Raising rather than
        # returning is what ends the connection without a clean finish: with no
        # `Content-Length`, a stream that merely stopped would read as complete.
        logger.warning("Archive stopped at %s: %s", current, exc)
        raise
    finally:
        slot.release()


class Archive:
    """A folder's ZIP, ready to stream. `release` frees its place among the
    `MAX_ARCHIVES`; the stream does it itself when it ends. `connect` is where
    the bytes come from (published objects over HTTPS unless given)."""

    def __init__(
        self,
        filename: str,
        entries: list[tuple[str, tree_browse.FolderObject]],
        slot: _Slot,
        connect: Connect | None = None,
    ) -> None:
        self.filename = filename
        self.length = archive_length([(name, obj.size) for name, obj in entries])
        self._entries = entries
        self._slot = slot
        self._connect = connect

    def stream(self) -> AsyncIterator[bytes]:
        return _write(self._entries, self._slot, self._connect)

    def release(self) -> None:
        self._slot.release()


async def _select(
    kind: Kind, artifact_id: str, folder: str, names: list[str]
) -> tuple[list[tuple[str, tree_browse.FolderObject]], bool]:
    """The ZIP's entries (name, object) for `names` in `folder`, and whether the
    selection was listed whole. The names are found by listing `folder` a page at
    a time, to the end or until all are found; a name not found is not published.
    The listing of the folders selected shares one page budget
    (`tree_browse.folder_page_cap()`), and stops as soon as the total is over the
    limit: either way the answer is incomplete, which is too large."""
    root = tree_browse.artifact_prefix(kind, artifact_id)
    wanted_files = {n for n in names if not n.endswith("/")}
    wanted_folders = {n.removesuffix("/") for n in names if n.endswith("/")}
    files: dict[str, tree_browse.TreeFile] = {}
    folders: set[str] = set()
    cursor: str | None = None
    for _ in range(tree_browse.folder_page_cap()):
        page = await tree_browse.list_folder(kind, artifact_id, folder, cursor)
        files.update({f.name: f for f in page.files if f.name in wanted_files})
        folders.update(f.name for f in page.folders if f.name in wanted_folders)
        if (
            len(files) == len(wanted_files) and len(folders) == len(wanted_folders)
        ) or (page.nextCursor is None):
            break
        cursor = page.nextCursor
    for name in names:
        if name.endswith("/"):
            found = name.removesuffix("/") in folders
        else:
            found = name in files
        if not found:
            raise tree_browse.PathNotFound(f"{folder}{name}")

    entries: list[tuple[str, tree_browse.FolderObject]] = []
    total = 0
    pages = 0
    for name in names:
        if not name.endswith("/"):
            file = files[name]
            obj = tree_browse.FolderObject(
                key=f"{root}{file.path}",
                size=file.size,
                modified=file.lastModified,
                url=file.url,
            )
            entries.append((name, obj))
            total += obj.size
            continue
        if (
            pages >= tree_browse.folder_page_cap()
            or total > tree_browse.ARCHIVE_LIMIT_BYTES
        ):
            return entries, False
        path = f"{folder}{name}"
        objects, complete, used = await tree_browse.scan_folder_pages(
            kind, artifact_id, path, tree_browse.folder_page_cap() - pages
        )
        pages += used
        entries.extend((f"{name}{o.key[len(root) + len(path) :]}", o) for o in objects)
        total += sum(o.size for o in objects)
        if not complete:
            return entries, False
    return entries, True


async def open_archive(
    kind: Kind, artifact_id: str, folder: str, names: list[str]
) -> Archive:
    """The archive of `names` (from `tree_browse.validate_names`) in `folder`
    (from `validate_path`): each file under its name, each folder under its name
    with what it holds. Raises `ArchiveBusy`, `PathNotFound` (the folder or a
    name), `ListingUnavailable`, and `SelectionTooLarge` when the selection's
    size, listed afresh, is over the limit."""
    slot = acquire()
    try:
        entries, complete = await _select(kind, artifact_id, folder, names)
        total = sum(obj.size for _, obj in entries)
        if not complete or total > tree_browse.ARCHIVE_LIMIT_BYTES:
            raise SelectionTooLarge(total)
        safe = []
        for name, obj in entries:
            if any(part in ("", ".", "..") for part in name.split("/")):
                logger.warning(
                    "Leaving %s out of its archive: not a safe name", obj.key
                )
                continue
            safe.append((name, obj))
        if not safe:
            raise tree_browse.PathNotFound(folder)
        if len(names) == 1:
            stem = names[0].removesuffix("/")
        else:
            stem = folder.removesuffix("/").rpartition("/")[2] or "files"
        return Archive(f"{artifact_id}-{stem}.zip", safe, slot)
    except BaseException:
        slot.release()
        raise


def content_disposition(filename: str) -> str:
    """An attachment header for `filename`: a plain name of safe characters for
    every browser, and the real one in `filename*` when it differs."""
    plain = "".join(
        c if c.isascii() and (c.isalnum() or c in "._-") else "_" for c in filename
    )
    if plain == filename:
        return f'attachment; filename="{plain}"'
    return (
        f"attachment; filename=\"{plain}\"; filename*=UTF-8''{quote(filename, safe='')}"
    )
