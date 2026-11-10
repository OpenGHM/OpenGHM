"""A run's output on Anvil scratch, listed over SFTP and packed as a ZIP (ADR 0040).

The output directory is `ANVIL_OUTPUT_BASE/<sim_id>/wbm_output/<sim_id>` (the directory the
job's outcome record walks), built from the job's own `sim_id` as `wbm_output.run_source`
does and never from a request. Listing, totalling and path checks go over one SFTP channel on
the gateway's own connection for files (`anvil_files.sftp_session`; the one slurmly keeps for jobs
is not used); the ZIP's bytes come over a second, exec channel on the same connection
(`anvil_files.stream_files`): one remote process per archive reads every file, in the archive's
order, and sends them framed, each with the size the listing gave. Nothing is written, on Anvil
or here.

What is listed is only real files and real folders: a symbolic link is never listed, followed
or packed. A path is checked as text by `tree_browse.validate_path` (no `..`) and then on
Anvil: the viewed folder's `realpath` must be the path asked for, so no part of it is a link.

The ZIP is `tree_archive`'s writer, which is given this module's framed reader
(`framed_source`) and told to read in order with no read-ahead (`sequential`, since the stream
is one ordered process): its limit (`ARCHIVE_LIMIT_BYTES`), its places (`MAX_ARCHIVES`, shared
with the published case), its stored entries and its failed-stream behaviour are not repeated
here. A file that is gone, another size than listed, shrinks or grows while it is read, or a
broken stream, is a `tree_archive.ArchiveError`, and the response ends short. A folder is totalled by walking it, at most `SCAN_MAX_FILES` files (the 20 pages of 1000
keys a published folder gets) in at most `SCAN_TIMEOUT_SECONDS`; past either, the folder
counts as too large, as in ADR 0036.
"""

from __future__ import annotations

import asyncio
import logging
import posixpath
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncssh
from slurmly.exceptions import SlurmlyError

from app.core.config import settings
from app.models.repository import TreeFolder
from app.models.run_files import RunFile, RunFolderSummary, RunListing
from app.services import anvil_files, slurm, tree_archive, tree_browse
from app.services.tree_browse import FolderObject

logger = logging.getLogger(__name__)

#: Entries of one folder in a page of the listing.
PAGE_SIZE = 1000
SCAN_MAX_FILES = 20_000
SCAN_TIMEOUT_SECONDS = 60
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
        async with anvil_files.sftp_session() as sftp:
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


async def _read(files: anvil_files.FileStream, obj: FolderObject) -> AsyncIterator[bytes]:
    """The bytes of one file from the framed stream, exactly `obj.size` of them. Whatever the
    stream says is wrong with it (the file is gone, has another size, is not a regular file,
    the connection broke) is an `ArchiveError` naming the file."""
    try:
        async for data in files.read_file(obj.key, obj.size):
            yield data
    except tree_archive.ArchiveError:
        raise
    except Exception as exc:
        raise tree_archive.ArchiveError(f"{posixpath.basename(obj.key)}: {exc}") from exc


def framed_source(entries: list[tuple[str, int]]):
    """The `Connect` of a run's ZIP: one remote process that sends all of `entries` (real path,
    listed size), in order. Reads must follow that order (`Archive(sequential=True)`). A
    stream that cannot be opened is an `ArchiveError` too, raised where the first read is."""

    @asynccontextmanager
    async def connect() -> AsyncIterator[tree_archive.Reader]:
        try:
            async with anvil_files.stream_files(entries) as files:
                yield lambda obj: _read(files, obj)
        except tree_archive.ArchiveError:
            raise
        except Exception as exc:
            raise tree_archive.ArchiveError(f"the file stream: {exc}") from exc

    return connect


async def _check_remote_python() -> None:
    """`anvil_files.check_remote_python`, with what can go wrong as `AnvilUnavailable`: the
    detail (it names paths) goes to the log, the person is told the login node cannot pack a
    ZIP."""
    try:
        await anvil_files.check_remote_python()
    except anvil_files.RemoteUnavailable as exc:
        logger.warning("Run files: the login node cannot stream files: %s", exc)
        raise AnvilUnavailable(
            "anvil_unreachable", "Anvil's login node cannot prepare this ZIP right now. Try again later or contact the operators."
        ) from exc
    except slurm.AnvilNotConfigured as exc:
        raise AnvilUnavailable("anvil_not_configured", _NOT_CONFIGURED) from exc
    except (SlurmlyError, OSError, asyncssh.Error) as exc:
        logger.warning("Run files: Anvil unreachable: %s", exc)
        raise AnvilUnavailable() from exc


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
        await _check_remote_python()
        if len(names) == 1:
            stem = names[0].removesuffix("/")
        else:
            stem = folder.removesuffix("/").rpartition("/")[2] or "files"
        connect = framed_source([(obj.key, obj.size) for _, obj in safe])
        return tree_archive.Archive(f"{sim_id}-{stem}.zip", safe, slot, connect, sequential=True)
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
