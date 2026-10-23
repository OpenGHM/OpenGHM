"""Reading the files a run reads, from the published snapshot and model input.

A run init names its files as the container sees them (`/wbm/data/...`,
`/wbm/data_init/...`, `/wbm/wbm_init/...`, docs/reference/wbm-init.md section 6). The bytes
behind them are public objects of Anvil S3: `/wbm/data/x` and `/wbm/data_init/x` are the
model input's `x` and `data_init/x`, and `/wbm/wbm_init/x` is the snapshot's `wbm_init/x`.
This module maps a container path to its object and answers what the checks before a submit
(`cross_rules`) and the dataset choices after them need to know:

* `read_init`   a data `.init` or block file, parsed (and its raw text, for the checks of its
                bytes: ASCII, `Code_Name`);
* `read_text`   any small text file the run reads (a crop parameter CSV);
* `list_names`  which names a folder holds, files and sub-folders;
* `file_exists` whether one file is there, from the listing of its folder;
* `metadata` / `datasets`  the model input's `metadata.json` and its `datasets[]`.

It reads with `tree_browse`'s listing and ranged `GET`, with no credentials, as the file
browser does. Published artifacts are immutable by id, so what was read is kept for the life
of the process, bounded by count. An object that is not there is remembered for
`_RETRY_AFTER` seconds, and so is a read that failed, so a bucket that is down is not asked
again by every check in a row.

Every function raises `NotFound` (nothing is published at the path) or `Unavailable` (the
bucket could not be read), and `read_init` also `BadInit` (the file is not an init this reader
understands). They are all `ModelInputError`.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Awaitable, Iterable, NamedTuple, TypeVar

from app.services import tree_browse
from app.wbm_init import reader

T = TypeVar("T")

#: How long a missing object, or a read that failed, is not asked for again.
_RETRY_AFTER = 60.0
#: How many reads of each kind are kept.
_CACHE_SIZE = 2048
#: A listing is read to its end, at most this many pages (1000 names each): a folder of more
#: names than that is not listed to its end for a yes or no.
_MAX_PAGES = 20
#: Requests in flight at once for `gather`: the bucket answers many, a small limit keeps one
#: check from taking all the sockets.
PARALLEL = 8


class ModelInputError(Exception):
    """A file of the run could not be had."""


class NotFound(ModelInputError):
    """Nothing is published at the path."""


class Unavailable(ModelInputError):
    """The bucket could not be read, or answered with something unusable."""


class BadInit(ModelInputError):
    """The file is there but is not an init this reader understands."""


class Source(NamedTuple):
    """Where a run's files are published: the snapshot (its `wbm_init/`) and the model input
    (everything else it reads). `model_input_id` is None for a snapshot that names none."""

    snapshot_id: str
    model_input_id: str | None


class Location(NamedTuple):
    """One object or folder of a published artifact: `kind` is `snapshots` or `model-inputs`,
    `path` is relative to the artifact's root (a folder ends with `/` or is empty)."""

    kind: tree_browse.Kind
    artifact_id: str
    path: str


def source_of(snapshot_id: str, snapshot: dict) -> Source:
    """The `Source` of a snapshot's catalogue document: its `uses.modelInput.id`."""
    uses = snapshot.get("uses")
    model_input = uses.get("modelInput") if isinstance(uses, dict) else None
    mi_id = model_input.get("id") if isinstance(model_input, dict) else None
    return Source(snapshot_id, mi_id if isinstance(mi_id, str) and mi_id else None)


#: Container prefix -> (artifact it is bound from, the path inside it that the prefix stands for).
#: `/wbm/data/` is the model input's root, which holds `data_init/`, so `/wbm/data/data_init/x`
#: and `/wbm/data_init/x` are one object.
_PREFIXES: tuple[tuple[str, tuple[tree_browse.Kind, str]], ...] = (
    ("/wbm/data_init/", ("model-inputs", "data_init/")),
    ("/wbm/data/", ("model-inputs", "")),
    ("/wbm/wbm_init/", ("snapshots", "wbm_init/")),
)


def locate(source: Source, container_path: str, *, folder: bool = False) -> Location | None:
    """The object a container path reads, or None when it is not one of the published
    artifacts: another `/wbm/` folder (the run's own spool and output, the snapshot's model),
    a relative path, a snapshot with no model input, or a path that climbs out with `..`.
    `folder` says the path is a folder."""
    for prefix, (kind, base) in _PREFIXES:
        if container_path.startswith(prefix):
            artifact_id = source.snapshot_id if kind == "snapshots" else source.model_input_id
            if not artifact_id:
                return None
            rest = container_path[len(prefix) :]
            try:
                path = tree_browse.validate_path(base + rest, file=not folder)
            except tree_browse.InvalidPath:
                return None
            return Location(kind, artifact_id, path)
    return None


def parent_of(location: Location) -> tuple[Location, str]:
    """The folder that holds a file, and the file's name in it."""
    folder, _, name = location.path.rpartition("/")
    return Location(location.kind, location.artifact_id, folder + "/" if folder else ""), name


# ---------------------------------------------------------------------------
# What was read
# ---------------------------------------------------------------------------

_Key = tuple[str, str, str]

#: Location -> the file's text. Only successful reads.
_texts: OrderedDict[_Key, str] = OrderedDict()
#: Location -> the parsed init, from `_texts`.
_inits: OrderedDict[_Key, "InitFile"] = OrderedDict()
#: Folder -> its names. Only complete, successful listings of a folder that holds something.
_folders: OrderedDict[_Key, "FolderNames"] = OrderedDict()
#: (kind, id, path or folder) -> monotonic time of the last failed read or missing object.
_failed: dict[_Key, tuple[float, ModelInputError]] = {}


def reset() -> None:
    """Forget what was read (tests)."""
    _texts.clear()
    _inits.clear()
    _folders.clear()
    _failed.clear()


def _remember(cache: OrderedDict, key: _Key, value) -> None:
    cache[key] = value
    if len(cache) > _CACHE_SIZE:
        cache.popitem(last=False)


def _recently_failed(key: _Key) -> ModelInputError | None:
    failed = _failed.get(key)
    if failed is None:
        return None
    if time.monotonic() - failed[0] >= _RETRY_AFTER:
        del _failed[key]
        return None
    return failed[1]


def _fail(key: _Key, exc: ModelInputError) -> ModelInputError:
    _failed[key] = (time.monotonic(), exc)
    return exc


async def gather(coros: Iterable[Awaitable[T]], limit: int = PARALLEL) -> list[T]:
    """The results of `coros` in order, at most `limit` running at once. The first exception
    is raised and the rest are cancelled, which is what a check wants when the bucket is down:
    one answer, not one timeout per file."""
    semaphore = asyncio.Semaphore(limit)

    async def run(coro: Awaitable[T]) -> T:
        async with semaphore:
            return await coro

    pending = list(coros)
    tasks = [asyncio.ensure_future(run(c)) for c in pending]
    try:
        return list(await asyncio.gather(*tasks))
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for coro in pending:  # one that never got to start would warn that it was never awaited
            if inspect.iscoroutine(coro) and inspect.getcoroutinestate(coro) == inspect.CORO_CREATED:
                coro.close()
        raise


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------


async def read_text(location: Location) -> str:
    """The text of a small file: at most `tree_browse.PREVIEW_BYTES`, which no data init or
    parameter table is near. Raises `NotFound`, `Unavailable`, and `BadInit` for a file that
    is binary or larger than that."""
    key = (location.kind, location.artifact_id, location.path)
    if key in _texts:
        _texts.move_to_end(key)
        return _texts[key]
    failed = _recently_failed(key)
    if failed is not None:
        raise failed
    try:
        preview = await tree_browse.preview(location.kind, location.artifact_id, location.path)
    except tree_browse.PathNotFound:
        raise _fail(key, NotFound(location.path)) from None
    except tree_browse.PreviewUnavailable as exc:
        raise _fail(key, Unavailable(str(exc))) from exc
    if preview.kind != "text" or preview.truncated or preview.text is None:
        raise BadInit(
            f"{location.path} is not a text file of at most {tree_browse.PREVIEW_BYTES // 1024} KiB."
        )
    _failed.pop(key, None)
    _remember(_texts, key, preview.text)
    return preview.text


@dataclass(frozen=True)
class InitFile:
    """A data `.init` or block file as read: where it is, its text and its values."""

    location: Location
    text: str
    #: The init as nested dicts of strings (`reader.read`).
    values: dict

    @property
    def name(self) -> str:
        """The file's name without `.init`, which WBM 23.9.0 requires `Code_Name` to equal."""
        base = self.location.path.rsplit("/", 1)[-1]
        return base.removesuffix(".init")

    @property
    def is_ascii(self) -> bool:
        """Whether every byte is ASCII, which WBM 23.9.0 requires of any init it reads."""
        return self.text.isascii()

    def get(self, key: str) -> str:
        """A top-level key's text; empty when it is absent or holds a block."""
        value = self.values.get(key)
        return value if isinstance(value, str) else ""


async def read_init(location: Location) -> InitFile:
    """The init at `location`, parsed. Raises `NotFound`, `Unavailable`, `BadInit`."""
    key = (location.kind, location.artifact_id, location.path)
    cached = _inits.get(key)
    if cached is not None:
        _inits.move_to_end(key)
        return cached
    text = await read_text(location)
    try:
        values = reader.read(text)
    except reader.InitSyntaxError as exc:
        raise BadInit(f"{location.path}: {exc}") from exc
    found = InitFile(location, text, values)
    _remember(_inits, key, found)
    return found


async def read_container_init(source: Source, container_path: str) -> InitFile:
    """`read_init` of a container path. Raises `NotFound` also for a path that is not a
    published artifact (`locate` is None)."""
    location = locate(source, container_path)
    if location is None:
        raise NotFound(container_path)
    return await read_init(location)


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FolderNames:
    """The names directly in a folder, not their paths. A folder with nothing in it, or that
    does not exist, has none."""

    files: frozenset[str]
    folders: frozenset[str]

    def __contains__(self, name: str) -> bool:
        return name in self.files or name in self.folders


async def list_names(location: Location) -> FolderNames:
    """The names in the folder at `location` (a folder path, `""` the root), read page by page
    to the end. Raises `Unavailable` also for a folder of more than `_MAX_PAGES` pages: what
    is not listed to its end cannot say a name is missing."""
    key = (location.kind, location.artifact_id, location.path)
    if key in _folders:
        _folders.move_to_end(key)
        return _folders[key]
    failed = _recently_failed(key)
    if failed is not None:
        raise failed
    files: set[str] = set()
    folders: set[str] = set()
    cursor: str | None = None
    for _ in range(_MAX_PAGES):
        try:
            page = await tree_browse.list_folder(
                location.kind, location.artifact_id, location.path, cursor
            )
        except tree_browse.PathNotFound:
            break  # nothing is published under it: no names
        except tree_browse.ListingUnavailable as exc:
            raise _fail(key, Unavailable(str(exc))) from exc
        files.update(f.name for f in page.files)
        folders.update(f.name for f in page.folders)
        cursor = page.nextCursor
        if not cursor:
            break
    else:
        raise _fail(key, Unavailable(f"{location.path} holds too many names to list."))
    names = FolderNames(frozenset(files), frozenset(folders))
    _failed.pop(key, None)
    if files or folders:  # nothing at a folder is not kept: it may be published later
        _remember(_folders, key, names)
    return names


async def container_names(source: Source, container_folder: str) -> FolderNames:
    """`list_names` of a container folder (`/wbm/data/climate/precip/`). Raises `NotFound` for a
    path that is not a published artifact."""
    location = locate(source, container_folder, folder=True)
    if location is None:
        raise NotFound(container_folder)
    return await list_names(location)


async def file_exists(location: Location) -> bool:
    """Whether the file at `location` is published, from the listing of its folder (one read
    for every file of a folder)."""
    folder, name = parent_of(location)
    return name in (await list_names(folder)).files


# ---------------------------------------------------------------------------
# The model input's own description
# ---------------------------------------------------------------------------


async def metadata(model_input_id: str) -> dict:
    """The model input's `metadata.json`. Raises `NotFound`, `Unavailable`, `BadInit` for a
    file that is not a JSON object."""
    text = await read_text(Location("model-inputs", model_input_id, "metadata.json"))
    try:
        doc = json.loads(text)
    except ValueError as exc:
        raise BadInit(f"metadata.json of {model_input_id[:8]} is not JSON: {exc}") from exc
    if not isinstance(doc, dict):
        raise BadInit(f"metadata.json of {model_input_id[:8]} is not an object.")
    return doc


async def datasets(model_input_id: str) -> list[dict]:
    """The model input's `datasets[]`: `code`, `init` (relative to the model input's root, as
    `data_init/climate/x.init`), `timeSeries`, `temporalCoverage`, `unit`... as published. The
    entries declare what the model input is meant to hold; the files are the truth
    (`cross_rules` judges coverage from them, never from this)."""
    found = (await metadata(model_input_id)).get("datasets")
    return [d for d in found if isinstance(d, dict)] if isinstance(found, list) else []


def container_path(location: Location) -> str | None:
    """The path a run init writes for a model-input object (`/wbm/data/<path>`), the inverse of
    `locate` for the model input's files; None for any other artifact. `data_init/` is written
    `/wbm/data_init/` as the published inits do."""
    if location.kind != "model-inputs":
        return None
    if location.path.startswith("data_init/"):
        return "/wbm/" + location.path
    return "/wbm/data/" + location.path
