"""A run's output on Anvil scratch, listed and packed as a ZIP over SFTP (ADR 0040).

The output directory is `ANVIL_OUTPUT_BASE/<sim_id>/wbm_output/<sim_id>` (the directory the
job's outcome record walks), built from the job's own `sim_id` as `wbm_output.run_source`
does and never from a request. Everything here reads over one SFTP channel on the connection
the backend already holds for jobs (`slurm.sftp_session`) and writes nothing, on Anvil or here.

What is listed is only real files and real folders: a symbolic link is never listed, followed
or packed. A path is checked as text by `tree_browse.validate_path` (no `..`) and then on
Anvil: the viewed folder's `realpath` must be the path asked for, so no part of it is a link.

The ZIP is `tree_archive`'s writer, which is given this module's SFTP reader (`sftp_source`):
its limit (`ARCHIVE_LIMIT_BYTES`), its places (`MAX_ARCHIVES`, shared with the published
case), its stored entries, its read-ahead and its failed-stream behaviour are not repeated
here. A folder is totalled by walking it, at most `SCAN_MAX_FILES` files (the 20 pages of 1000
keys a published folder gets) in at most `SCAN_TIMEOUT_SECONDS`; past either, the folder
counts as too large, as in ADR 0036.
"""

from __future__ import annotations

import asyncio
import logging
import posixpath
from collections import deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncssh
from slurmly.exceptions import SlurmlyError

from app.core.config import settings
from app.models.repository import TreeFolder
from app.models.run_files import RunFile, RunFolderSummary, RunListing
from app.services import slurm, tree_archive, tree_browse
from app.services.tree_browse import FolderObject

logger = logging.getLogger(__name__)

#: Entries of one folder in a page of the listing.
PAGE_SIZE = 1000
SCAN_MAX_FILES = 20_000
SCAN_TIMEOUT_SECONDS = 60
#: Bytes per SFTP read of an entry, and how many reads of one entry are asked for at once.
READ_CHUNK = 1024 * 1024
READ_AHEAD = 2
_UNREACHABLE = "Anvil could not be reached. Try again in a few minutes."
_NOT_CONFIGURED = "This gateway is not set up to run anything on Anvil yet."


class PathNotFound(Exception):
    """The folder, or a name asked for in it, is not in the run's output."""


class OutputMissing(Exception):
    """The run's output directory is not there (nothing written yet, or purged)."""


class AnvilUnavailable(Exception):
    """Anvil could not be reached, or did not answer in time. `code` is the route's
    `anvil_unreachable`, or `anvil_not_configured`; `message` is for the person."""

    def __init__(self, code: str = "anvil_unreachable", message: str = _UNREACHABLE) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class _Entry:
    name: str
    is_dir: bool
    size: int
    modified: str


def output_root(sim_id: str) -> str:
    """The run's output directory, from its id (which the caller has checked is a plain
    id: `job_script.is_valid_id`)."""
    return posixpath.join(settings.ANVIL_OUTPUT_BASE, sim_id, "wbm_output", sim_id)


def _iso(mtime: int | None) -> str:
    when = datetime.fromtimestamp(mtime or 0, tz=timezone.utc)
    return when.strftime("%Y-%m-%dT%H:%M:%SZ")


@asynccontextmanager
async def _session():
    """An SFTP channel, with what can go wrong in reaching Anvil as `AnvilUnavailable`."""
    try:
        async with slurm.sftp_session() as sftp:
            yield sftp
    except slurm.AnvilNotConfigured as exc:
        raise AnvilUnavailable("anvil_not_configured", _NOT_CONFIGURED) from exc
    except (SlurmlyError, OSError, asyncssh.Error) as exc:
        logger.warning("Run files: Anvil unreachable: %s", exc)
        raise AnvilUnavailable() from exc


async def _real(sftp, path: str) -> str:
    try:
        return await sftp.realpath(path)
    except asyncssh.SFTPNoSuchFile as exc:
        raise PathNotFound(path) from exc


async def _viewed(sftp, sim_id: str, folder: str) -> str:
    """The real path of `folder` (`validate_path`'s: `""` or ending with `/`) of the run's
    output. `OutputMissing` when the output directory is not there, `PathNotFound` when the
    folder is not, or when any part of its path is a link: the path asked for must be the path
    it resolves to, so a link is never followed, inside the output or out of it. (The output
    directory's own path may have links above it: scratch often does.)"""
    try:
        real_root = await sftp.realpath(output_root(sim_id))
    except asyncssh.SFTPNoSuchFile as exc:
        raise OutputMissing(sim_id) from exc
    if not folder:
        return real_root
    wanted = posixpath.join(real_root, folder.removesuffix("/"))
    if await _real(sftp, wanted) != wanted:
        raise PathNotFound(folder)
    return wanted


async def _entries(sftp, directory: str) -> list[_Entry]:
    """What is directly in `directory`, sorted by name: regular files and folders only
    (a link, a socket or the like is left out)."""
    try:
        names = await sftp.readdir(directory)
    except (
        asyncssh.SFTPNoSuchFile,
        asyncssh.SFTPNoSuchPath,
        asyncssh.SFTPNotADirectory,
        asyncssh.SFTPFailure,  # what a server answers for a path that is a file
    ) as exc:
        raise PathNotFound(directory) from exc
    found: list[_Entry] = []
    for item in names:
        name = item.filename
        if isinstance(name, bytes):
            name = name.decode("utf-8", "replace")
        if name in (".", ".."):
            continue
        kind = item.attrs.type
        if kind == asyncssh.FILEXFER_TYPE_DIRECTORY:
            found.append(_Entry(name, True, 0, _iso(item.attrs.mtime)))
        elif kind == asyncssh.FILEXFER_TYPE_REGULAR:
            found.append(_Entry(name, False, item.attrs.size or 0, _iso(item.attrs.mtime)))
    return sorted(found, key=lambda e: e.name)


async def list_folder(sim_id: str, folder: str, cursor: str | None) -> RunListing:
    """One page of the folder, folders first and then files, as many as `PAGE_SIZE`.
    The cursor is the offset of the next entry; a listing that changed meanwhile can
    repeat or skip an entry, which a finished run's does not."""
    try:
        offset = int(cursor) if cursor else 0
        if offset < 0:
            raise ValueError
    except ValueError as exc:
        raise tree_browse.InvalidPath("The cursor is not one this listing gave.") from exc
    async with _session() as sftp:
        real = await _viewed(sftp, sim_id, folder)
        entries = await _entries(sftp, real)
    ordered = [e for e in entries if e.is_dir] + [e for e in entries if not e.is_dir]
    page = ordered[offset : offset + PAGE_SIZE]
    more = offset + PAGE_SIZE < len(ordered)
    return RunListing(
        id=sim_id,
        path=folder,
        folders=[TreeFolder(name=e.name, path=f"{folder}{e.name}/") for e in page if e.is_dir],
        files=[
            RunFile(name=e.name, path=f"{folder}{e.name}", size=e.size, lastModified=e.modified)
            for e in page
            if not e.is_dir
        ],
        nextCursor=str(offset + PAGE_SIZE) if more else None,
    )


async def _scan(
    sftp, directory: str, *, max_files: int, stop_over: int | None = None
) -> tuple[list[tuple[str, FolderObject]], bool]:
    """Every file under `directory`, at any depth, as (path relative to it, object with
    its real path as `key`), depth first in name order, and whether the walk reached the
    end: it stops at `max_files` files, and, given `stop_over`, as soon as the bytes so far
    are over it."""
    found: list[tuple[str, FolderObject]] = []
    total = 0
    pending: list[tuple[str, str]] = [("", directory)]
    while pending:
        prefix, current = pending.pop()
        children = await _entries(sftp, current)
        subfolders: list[tuple[str, str]] = []
        for entry in children:
            if entry.is_dir:
                subfolders.append((f"{prefix}{entry.name}/", posixpath.join(current, entry.name)))
                continue
            if len(found) >= max_files:
                return found, False
            found.append(
                (
                    f"{prefix}{entry.name}",
                    FolderObject(
                        key=posixpath.join(current, entry.name),
                        size=entry.size,
                        modified=entry.modified,
                        url="",
                    ),
                )
            )
            total += entry.size
            if stop_over is not None and total > stop_over:
                return found, False
        pending.extend(reversed(subfolders))
    return found, True


async def folder_summary(sim_id: str, folder: str) -> RunFolderSummary:
    """What the folder holds at any depth and whether a ZIP of it is allowed."""

    async def walk():
        async with _session() as sftp:
            real = await _viewed(sftp, sim_id, folder)
            return await _scan(sftp, real, max_files=SCAN_MAX_FILES)

    try:
        found, complete = await asyncio.wait_for(walk(), SCAN_TIMEOUT_SECONDS)
    except asyncio.TimeoutError as exc:
        logger.warning("Run files: totalling %s of %s took over %s s", folder, sim_id, SCAN_TIMEOUT_SECONDS)
        raise AnvilUnavailable("anvil_unreachable", "Anvil took too long to list this folder.") from exc
    total = sum(obj.size for _, obj in found)
    return RunFolderSummary(
        path=folder,
        files=len(found),
        bytes=total,
        limit_bytes=tree_browse.ARCHIVE_LIMIT_BYTES,
        fits=complete and total <= tree_browse.ARCHIVE_LIMIT_BYTES,
        complete=complete,
    )


async def _read_exact(remote, offset: int, size: int) -> bytes:
    """`size` bytes at `offset`, fewer only at the end of the file. asyncssh answers a read in
    one piece normally; this keeps asking when a server answers with less."""
    parts: list[bytes] = []
    got = 0
    while got < size:
        data = await remote.read(size - got, offset + got)
        if not data:
            break
        parts.append(data)
        got += len(data)
    return parts[0] if len(parts) == 1 else b"".join(parts)


async def _read(sftp, obj: FolderObject) -> AsyncIterator[bytes]:
    """The bytes of one file, exactly `obj.size` of them, `READ_CHUNK` at a time with
    `READ_AHEAD` reads asked for at once: a read waits a round trip for its answer, so one
    at a time moves a fraction of what the link carries (measured from the local stack to
    Anvil: 1.0 MB/s one at a time, 2.5 MB/s with two in flight, the speed of `ssh cat`). A
    file that has shrunk ends the read short (the writer sees the count is wrong), one that
    has grown is an error here, so no byte beyond the length already promised is sent. A file
    that is gone, or a lost connection, is an `ArchiveError`."""
    pending: deque[asyncio.Task[bytes]] = deque()
    try:
        async with sftp.open(obj.key, "rb") as remote:
            asked = 0

            def ask() -> None:
                nonlocal asked
                if asked < obj.size:
                    size = min(READ_CHUNK, obj.size - asked)
                    pending.append(asyncio.ensure_future(_read_exact(remote, asked, size)))
                    asked += size

            for _ in range(READ_AHEAD):
                ask()
            sent = 0
            while pending:
                data = await pending.popleft()
                ask()
                if not data:
                    return
                sent += len(data)
                yield data
            if await remote.read(1, sent):
                raise tree_archive.ArchiveError(f"more than the {obj.size} bytes listed")
    except tree_archive.ArchiveError:
        raise
    except Exception as exc:
        raise tree_archive.ArchiveError(f"{posixpath.basename(obj.key)}: {exc}") from exc
    finally:
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


@asynccontextmanager
async def sftp_source() -> AsyncIterator[tree_archive.Reader]:
    """The `Connect` of a run's ZIP: one SFTP channel for all of its entries."""
    async with _session() as sftp:
        yield lambda obj: _read(sftp, obj)


async def open_archive(sim_id: str, folder: str, names: list[str]) -> tree_archive.Archive:
    """The ZIP of `names` (`validate_names`'s) in `folder` (`validate_path`'s) of the run's
    output: each file under its name, each folder under its name with what it holds. Raises
    `tree_archive.ArchiveBusy` (before Anvil is asked anything), `OutputMissing`,
    `PathNotFound` (the folder or a name), `AnvilUnavailable`, and
    `tree_archive.SelectionTooLarge` when the selection, listed afresh, is over the limit or
    could not be totalled within the walk's limits."""

    async def list_selection():
        async with _session() as sftp:
            real = await _viewed(sftp, sim_id, folder)
            return await _select(sftp, real, folder, names)

    slot = tree_archive.acquire()
    try:
        entries, _total = await asyncio.wait_for(list_selection(), SCAN_TIMEOUT_SECONDS)
        safe = []
        for name, obj in entries:
            if any(part in ("", ".", "..") for part in name.split("/")):
                logger.warning("Leaving %s out of its archive: not a safe name", obj.key)
                continue
            safe.append((name, obj))
        if not safe:
            raise PathNotFound(folder)
        if len(names) == 1:
            stem = names[0].removesuffix("/")
        else:
            stem = folder.removesuffix("/").rpartition("/")[2] or "files"
        return tree_archive.Archive(f"{sim_id}-{stem}.zip", safe, slot, sftp_source)
    except asyncio.TimeoutError as exc:
        slot.release()
        logger.warning("Run files: listing for a ZIP of %s took over %s s", sim_id, SCAN_TIMEOUT_SECONDS)
        raise AnvilUnavailable("anvil_unreachable", "Anvil took too long to list these files.") from exc
    except BaseException:
        slot.release()
        raise


async def _select(
    sftp, real_folder: str, folder: str, names: list[str]
) -> tuple[list[tuple[str, FolderObject]], int]:
    """The ZIP's entries (name, object) for `names` in the folder, and their total size.
    Raises `PathNotFound` for a name the folder does not hold, and `SelectionTooLarge` as
    soon as the total is over the limit or the files to total are over `SCAN_MAX_FILES`."""
    here = {e.name: e for e in await _entries(sftp, real_folder)}
    for name in names:
        entry = here.get(name.removesuffix("/"))
        if entry is None or entry.is_dir != name.endswith("/"):
            raise PathNotFound(f"{folder}{name}")
    limit = tree_browse.ARCHIVE_LIMIT_BYTES
    entries: list[tuple[str, FolderObject]] = []
    total = 0
    for name in names:
        entry = here[name.removesuffix("/")]
        path = posixpath.join(real_folder, entry.name)
        if not entry.is_dir:
            entries.append((name, FolderObject(key=path, size=entry.size, modified=entry.modified, url="")))
            total += entry.size
            if total > limit:
                raise tree_archive.SelectionTooLarge(total)
            continue
        found, complete = await _scan(
            sftp, path, max_files=SCAN_MAX_FILES - len(entries), stop_over=limit - total
        )
        entries.extend((f"{name}{relative}", obj) for relative, obj in found)
        total += sum(obj.size for _, obj in found)
        if not complete or total > limit:
            raise tree_archive.SelectionTooLarge(total)
    return entries, total
