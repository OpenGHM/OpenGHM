"""Browsing a published snapshot's or model input's tree, one folder at a time
(mission 2026-10-07-a-published-tree-can-be-browsed, gateway.md sections 4 and 5).

The bucket answers anonymous `ListObjectsV2` and ranged `GET`s but sends no CORS
headers, so the browser cannot read it; the backend does, with no credentials,
as `published_answer` lists output. Downloads stay links to the object's public
URL.

A listing is one S3 page of one folder (`delimiter=/`, `max-keys=1000`): a model
input folder can hold thousands of day files, so paging is passed through to the
caller as `cursor` rather than followed to the end. A published tree is
immutable by id, so a non-empty page is kept by (prefix, cursor), bounded. A
preview is one `GET` of the object's first 256 KiB and is not kept.

A folder's total (`folder_summary`) is the other way a listing is followed: with
no delimiter, page after page, up to a cap, so that the page can say before a
click whether the folder is small enough to be downloaded as a ZIP
(`tree_archive`, which reads the same objects).
"""

from __future__ import annotations

import asyncio
import codecs
import logging
import re
import xml.etree.ElementTree as ET
from collections import OrderedDict
from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.models.repository import (
    FolderSummary,
    OutputFolder,
    TreeFile,
    TreeFolder,
    TreeListing,
    TreePreview,
    s3_url,
)

logger = logging.getLogger(__name__)

Kind = Literal["snapshots", "model-inputs"]

_TIMEOUT = 10.0
_SIZE_TIMEOUT = 3.0
_MAX_KEYS = "1000"
#: `output_folders` reads at most this many listing pages (objects / 1000).
_OUTPUT_MAX_PAGES = 20
#: `scan_folder` reads at most this many listing pages (objects / 1000), so a
#: folder of millions of objects is not listed to its end for a yes or no.
_FOLDER_MAX_PAGES = 20
#: What a folder's ZIP may hold before compression (ADR 0036).
ARCHIVE_LIMIT_BYTES = 500 * 1024 * 1024
PREVIEW_BYTES = 256 * 1024
_CACHE_SIZE = 512
_MAX_PATH = 900  # an S3 key is at most 1024 bytes; the prefix takes the rest

#: Names ending in one of these are not offered as text.
_BINARY_EXTENSIONS = (
    ".nc .nc4 .tif .tiff .dat .gz .tgz .zip .tar .sif .bin .png .jpg .jpeg "
    ".gif .h5 .hdf .shp .shx .dbf .npy .pkl"
).split()
_CONTENT_RANGE_RE = re.compile(r"^bytes (?:\d+-\d+|\*)/(\d+)$")


class InvalidPath(ValueError):
    """The path is not a relative folder or file path."""


class InvalidSelection(InvalidPath):
    """The names asked for are too few, too many, or not entries of a folder."""


class PathNotFound(Exception):
    """Nothing is published at the path."""


class ListingUnavailable(Exception):
    """The public bucket could not be listed: network, HTTP status or XML."""


class PreviewUnavailable(Exception):
    """The object could not be read, for a reason other than being absent."""


#: (prefix, cursor) -> the page. Only non-empty, successful reads.
_pages: OrderedDict[tuple[str, str | None], TreeListing] = OrderedDict()
#: Public URL -> the object's size. Only successful reads.
_sizes: OrderedDict[str, int] = OrderedDict()
#: Snapshot id -> its output's folders. Only complete, successful listings.
_outputs: OrderedDict[str, list[OutputFolder]] = OrderedDict()
#: Folder prefix -> its summary. Only complete, successful listings.
_folder_summaries: OrderedDict[str, FolderSummary] = OrderedDict()


def reset() -> None:
    """Forget what was listed and sized (tests)."""
    _pages.clear()
    _sizes.clear()
    _outputs.clear()
    _folder_summaries.clear()


def artifact_prefix(kind: Kind, artifact_id: str) -> str:
    return f"{kind}/{artifact_id}/"


def validate_path(path: str, *, file: bool = False) -> str:
    """The path as a folder (a trailing `/` added, `""` the root) or, with
    `file`, as one file. Raises `InvalidPath` for a leading `/`, an empty, `.`
    or `..` segment, a backslash, a control character, or a file path that is
    empty or ends with `/`."""
    if len(path) > _MAX_PATH:
        raise InvalidPath("The path is too long.")
    if "\\" in path or any(ord(c) < 32 or ord(c) == 127 for c in path):
        raise InvalidPath("The path holds a backslash or a control character.")
    if file:
        if path.endswith("/"):
            raise InvalidPath("A file path must not end with '/'.")
        segments = path.split("/")
    else:
        if path == "":
            return ""
        segments = path.removesuffix("/").split("/")
        path = path.removesuffix("/") + "/"
    if any(segment in ("", ".", "..") for segment in segments):
        raise InvalidPath("The path must be relative, with no empty, '.' or '..' segment.")
    return path


#: A ZIP is made of 1..`MAX_SELECTED` entries of one folder.
MAX_SELECTED = 1000
_MAX_NAME = 255


def validate_names(names: list[str]) -> list[str]:
    """The entries named, each a file name or a folder name ending in `/`,
    without repeats and in the order given. Raises `InvalidSelection` for none,
    for more than `MAX_SELECTED`, and for a name that is not one entry of the
    folder: empty, `.`, `..`, holding a `/` other than a folder's last, a
    backslash or a control character, or over 255 characters."""
    if not 1 <= len(names) <= MAX_SELECTED:
        raise InvalidSelection(f"Select between 1 and {MAX_SELECTED} entries.")
    for name in names:
        base = name.removesuffix("/")
        if (
            base in ("", ".", "..")
            or "/" in base
            or "\\" in base
            or any(ord(c) < 32 or ord(c) == 127 for c in base)
            or len(name) > _MAX_NAME
        ):
            raise InvalidSelection(f"'{name}' is not a file or folder name.")
    return list(dict.fromkeys(names))


def _is_previewable(name: str) -> bool:
    return not name.lower().endswith(tuple(_BINARY_EXTENSIONS))


def _object_url(key: str) -> str:
    return s3_url(settings.S3_PUBLIC_BASE_URL, settings.S3_BUCKET, quote(key))


async def _get(url: str, *, params: dict[str, str]) -> httpx.Response:
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
        return await client.get(url, params=params)


async def _get_head(url: str, *, headers: dict[str, str]) -> tuple[int, httpx.Headers, bytes]:
    """A `GET`'s status, headers and at most `PREVIEW_BYTES` of its body: a
    bucket that ignores the `Range` is not read past what the preview needs."""
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
        async with client.stream("GET", url, headers=headers) as response:
            data = bytearray()
            async for chunk in response.aiter_raw():
                data += chunk
                if len(data) >= PREVIEW_BYTES:
                    break
            return response.status_code, response.headers, bytes(data[:PREVIEW_BYTES])


def _parse_page(
    xml: str, kind: Kind, artifact_id: str, path: str
) -> TreeListing:
    """One `ListObjectsV2` page of the folder at `path`. The folders are the
    `CommonPrefixes`; the root `<Prefix>` is not one of them."""
    root_prefix = artifact_prefix(kind, artifact_id)
    prefix = f"{root_prefix}{path}"
    root = ET.fromstring(xml)
    folders = [
        TreeFolder(name=key[len(prefix) :].rstrip("/"), path=key[len(root_prefix) :])
        for key in (
            item.findtext("{*}Prefix") or "" for item in root.iterfind("{*}CommonPrefixes")
        )
        if key.startswith(prefix) and key != prefix
    ]
    files = []
    for item in root.iterfind("{*}Contents"):
        key = item.findtext("{*}Key") or ""
        if not key.startswith(prefix) or key == prefix:  # a zero-byte folder marker
            continue
        name = key[len(prefix) :]
        files.append(
            TreeFile(
                name=name,
                path=key[len(root_prefix) :],
                size=int(item.findtext("{*}Size") or 0),
                lastModified=item.findtext("{*}LastModified") or "",
                url=_object_url(key),
                previewable=_is_previewable(name),
            )
        )
    next_cursor = None
    if root.findtext("{*}IsTruncated") == "true":
        next_cursor = root.findtext("{*}NextContinuationToken")
        if not next_cursor:
            raise ValueError("truncated listing without a continuation token")
    folders.sort(key=lambda f: f.name)
    files.sort(key=lambda f: f.name)
    return TreeListing(
        id=artifact_id, path=path, folders=folders, files=files, nextCursor=next_cursor
    )


async def list_folder(
    kind: Kind, artifact_id: str, path: str, cursor: str | None = None
) -> TreeListing:
    """One page of the folder at `path` (already validated by `validate_path`).
    Raises `PathNotFound` for a non-root folder with nothing in it and
    `ListingUnavailable` when the bucket cannot be read."""
    prefix = f"{artifact_prefix(kind, artifact_id)}{path}"
    cursor = cursor or None
    cached = _pages.get((prefix, cursor))
    if cached is not None:
        _pages.move_to_end((prefix, cursor))
        return cached
    params = {
        "list-type": "2",
        "delimiter": "/",
        "max-keys": _MAX_KEYS,
        "prefix": prefix,
    }
    if cursor:
        params["continuation-token"] = cursor
    url = f"{settings.S3_PUBLIC_BASE_URL.rstrip('/')}/{settings.S3_BUCKET}"
    try:
        response = await _get(url, params=params)
        response.raise_for_status()
        page = _parse_page(response.text, kind, artifact_id, path)
    except Exception as exc:  # network, HTTP status, XML: all mean "could not list"
        logger.warning("Could not list %s: %s", prefix, exc)
        raise ListingUnavailable(str(exc)) from exc
    if not (page.folders or page.files or page.nextCursor):
        if path:
            raise PathNotFound(path)
        return page  # an empty root is not kept: nothing is known yet
    _pages[(prefix, cursor)] = page
    if len(_pages) > _CACHE_SIZE:
        _pages.popitem(last=False)
    return page


def _size_of(status: int, headers: httpx.Headers, data: bytes) -> int:
    """The object's whole size: from `Content-Range` on a ranged answer; on a
    `200` (the range ignored) the body's length, or `Content-Length` when the
    body was cut at the preview size."""
    if status == 200:
        if len(data) < PREVIEW_BYTES:
            return len(data)
        return int(headers["Content-Length"])
    match = _CONTENT_RANGE_RE.match(headers.get("Content-Range", ""))
    if match is None:
        raise ValueError("no usable Content-Range")
    return int(match.group(1))


async def _head(url: str) -> tuple[int, httpx.Headers]:
    async with httpx.AsyncClient(timeout=_SIZE_TIMEOUT, follow_redirects=True) as client:
        response = await client.head(url)
        return response.status_code, response.headers


async def _head_size(url: str) -> int | None:
    if url in _sizes:
        _sizes.move_to_end(url)
        return _sizes[url]
    try:
        status, headers = await _head(url)
        size = int(headers["Content-Length"]) if status == 200 else None
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.warning("could not size %s: %s", url, exc)
        return None
    if size is not None:
        _sizes[url] = size
        if len(_sizes) > _CACHE_SIZE:
            _sizes.popitem(last=False)
    return size


async def sizes(urls: list[str]) -> dict[str, int]:
    """The size of each public object, by one `HEAD` each, in parallel. A URL
    that does not answer `200` in time is left out: a size is a courtesy, and
    the Download card shows the file without one. Published objects are
    immutable, so a size is kept, bounded."""
    found = await asyncio.gather(*(_head_size(u) for u in urls))
    return {url: size for url, size in zip(urls, found) if size is not None}


async def output_folders(snapshot_id: str) -> list[OutputFolder]:
    """What a published snapshot's `wbm_output/` holds, one entry per
    `<run>/<folder>/` with the count and bytes of the files under it at any
    depth; a file directly under `<run>/` (the MT, the log) is not counted.
    Read by a listing with no delimiter, at most `_OUTPUT_MAX_PAGES` pages.
    Empty when the bucket could not be read or the output is larger than
    that: the summary is a courtesy, and the Download card links to the files
    page without it. A published tree is immutable, so a summary is kept."""
    if snapshot_id in _outputs:
        _outputs.move_to_end(snapshot_id)
        return _outputs[snapshot_id]
    prefix = f"{artifact_prefix('snapshots', snapshot_id)}wbm_output/"
    url = f"{settings.S3_PUBLIC_BASE_URL.rstrip('/')}/{settings.S3_BUCKET}"
    totals: dict[tuple[str, str], list[int]] = {}
    cursor: str | None = None
    try:
        for _ in range(_OUTPUT_MAX_PAGES):
            params = {"list-type": "2", "max-keys": _MAX_KEYS, "prefix": prefix}
            if cursor:
                params["continuation-token"] = cursor
            response = await _get(url, params=params)
            response.raise_for_status()
            root = ET.fromstring(response.text)
            for item in root.iterfind("{*}Contents"):
                parts = (item.findtext("{*}Key") or "")[len(prefix) :].split("/")
                if len(parts) < 3 or not parts[-1]:  # a run's own file, or a folder marker
                    continue
                total = totals.setdefault((parts[0], parts[1]), [0, 0])
                total[0] += 1
                total[1] += int(item.findtext("{*}Size") or 0)
            cursor = root.findtext("{*}NextContinuationToken") if root.findtext("{*}IsTruncated") == "true" else None
            if not cursor:
                break
        else:
            logger.warning("Not summing %s: over %d listing pages", prefix, _OUTPUT_MAX_PAGES)
            return []
    except Exception as exc:  # network, HTTP status, XML
        logger.warning("Could not list %s: %s", prefix, exc)
        return []
    folders = [
        OutputFolder(run=run, name=name, path=f"wbm_output/{run}/{name}/", files=n, bytes=size)
        for (run, name), (n, size) in sorted(totals.items())
    ]
    _outputs[snapshot_id] = folders
    if len(_outputs) > _CACHE_SIZE:
        _outputs.popitem(last=False)
    return folders


@dataclass(frozen=True)
class FolderObject:
    """One object under a folder: its key, size, `LastModified` as the bucket
    lists it, and public URL."""

    key: str
    size: int
    modified: str
    url: str


def folder_page_cap() -> int:
    """How many listing pages `scan_folder` reads at most, in all."""
    return _FOLDER_MAX_PAGES


async def scan_folder(
    kind: Kind, artifact_id: str, path: str, max_pages: int | None = None
) -> tuple[list[FolderObject], bool]:
    """Every object under the folder at `path` (already validated by
    `validate_path`, `""` the root), at any depth, by a listing with no
    delimiter of at most `max_pages` pages (`folder_page_cap()` unless given),
    and whether it reached the end. A zero-byte folder marker is not an object.
    Raises `PathNotFound` for a folder with nothing in it and `ListingUnavailable`
    when the bucket cannot be read."""
    objects, complete, _ = await scan_folder_pages(kind, artifact_id, path, max_pages)
    return objects, complete


async def scan_folder_pages(
    kind: Kind, artifact_id: str, path: str, max_pages: int | None = None
) -> tuple[list[FolderObject], bool, int]:
    """`scan_folder`, and how many listing pages it read."""
    prefix = f"{artifact_prefix(kind, artifact_id)}{path}"
    url = f"{settings.S3_PUBLIC_BASE_URL.rstrip('/')}/{settings.S3_BUCKET}"
    objects: list[FolderObject] = []
    cursor: str | None = None
    complete = False
    pages = 0
    try:
        for _ in range(_FOLDER_MAX_PAGES if max_pages is None else max_pages):
            pages += 1
            params = {"list-type": "2", "max-keys": _MAX_KEYS, "prefix": prefix}
            if cursor:
                params["continuation-token"] = cursor
            response = await _get(url, params=params)
            response.raise_for_status()
            root = ET.fromstring(response.text)
            for item in root.iterfind("{*}Contents"):
                key = item.findtext("{*}Key") or ""
                if not key.startswith(prefix) or key.endswith("/"):  # a folder marker
                    continue
                objects.append(
                    FolderObject(
                        key=key,
                        size=int(item.findtext("{*}Size") or 0),
                        modified=item.findtext("{*}LastModified") or "",
                        url=_object_url(key),
                    )
                )
            if root.findtext("{*}IsTruncated") != "true":
                complete = True
                break
            cursor = root.findtext("{*}NextContinuationToken")
            if not cursor:
                raise ValueError("truncated listing without a continuation token")
    except Exception as exc:  # network, HTTP status, XML: all mean "could not list"
        logger.warning("Could not list %s: %s", prefix, exc)
        raise ListingUnavailable(str(exc)) from exc
    if not objects:
        raise PathNotFound(path)
    return objects, complete, pages


def summarize(
    kind: Kind, artifact_id: str, path: str, objects: list[FolderObject], complete: bool
) -> FolderSummary:
    total = sum(o.size for o in objects)
    return FolderSummary(
        path=path,
        url=s3_url(
            settings.S3_PUBLIC_BASE_URL,
            settings.S3_BUCKET,
            f"{artifact_prefix(kind, artifact_id)}{path}",
        ),
        files=len(objects),
        bytes=total,
        limit_bytes=ARCHIVE_LIMIT_BYTES,
        fits=complete and total <= ARCHIVE_LIMIT_BYTES,
        complete=complete,
    )


async def folder_summary(kind: Kind, artifact_id: str, path: str) -> FolderSummary:
    """What the folder at `path` holds and whether a ZIP of it is allowed. A
    listing cut off at the page cap answers `fits=false` with the counts it
    reached: it is not read on to learn the exact total. A published tree is
    immutable, so a complete summary is kept."""
    prefix = f"{artifact_prefix(kind, artifact_id)}{path}"
    if prefix in _folder_summaries:
        _folder_summaries.move_to_end(prefix)
        return _folder_summaries[prefix]
    objects, complete = await scan_folder(kind, artifact_id, path)
    summary = summarize(kind, artifact_id, path, objects, complete)
    if complete:
        _folder_summaries[prefix] = summary
        if len(_folder_summaries) > _CACHE_SIZE:
            _folder_summaries.popitem(last=False)
    return summary


def _decode(data: bytes, truncated: bool) -> str | None:
    """The text of `data`, or `None` when it is not text: a NUL byte, or bytes
    that are not UTF-8. A character cut at the end of a truncated range is
    left out rather than counted as invalid."""
    if b"\x00" in data:
        return None
    try:
        return codecs.getincrementaldecoder("utf-8")().decode(data, final=not truncated)
    except UnicodeDecodeError:
        return None


async def preview(kind: Kind, artifact_id: str, path: str) -> TreePreview:
    """The first `PREVIEW_BYTES` of the file at `path` (already validated with
    `file=True`). Raises `PathNotFound` for an absent object and
    `PreviewUnavailable` when it cannot be read."""
    key = f"{artifact_prefix(kind, artifact_id)}{path}"
    try:
        status, headers, data = await _get_head(
            _object_url(key), headers={"Range": f"bytes=0-{PREVIEW_BYTES - 1}"}
        )
        if status == 404:
            raise PathNotFound(path)
        if status == 416:  # a range into an empty object
            data = b""
        elif status not in (200, 206):
            raise ValueError(f"HTTP {status}")
        size = _size_of(status, headers, data)
    except PathNotFound:
        raise
    except Exception as exc:  # network, HTTP status, a missing Content-Range
        logger.warning("Could not read %s: %s", key, exc)
        raise PreviewUnavailable(str(exc)) from exc
    truncated = size > len(data)
    text = _decode(data, truncated)
    return TreePreview(
        path=path,
        size=size,
        kind="text" if text is not None else "binary",
        text=text,
        truncated=truncated,
    )
