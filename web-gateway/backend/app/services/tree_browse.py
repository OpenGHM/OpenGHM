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
"""

from __future__ import annotations

import codecs
import logging
import re
import xml.etree.ElementTree as ET
from collections import OrderedDict
from typing import Literal
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.models.repository import (
    TreeFile,
    TreeFolder,
    TreeListing,
    TreePreview,
    s3_url,
)

logger = logging.getLogger(__name__)

Kind = Literal["snapshots", "model-inputs"]

_TIMEOUT = 10.0
_MAX_KEYS = "1000"
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


class PathNotFound(Exception):
    """Nothing is published at the path."""


class ListingUnavailable(Exception):
    """The public bucket could not be listed: network, HTTP status or XML."""


class PreviewUnavailable(Exception):
    """The object could not be read, for a reason other than being absent."""


#: (prefix, cursor) -> the page. Only non-empty, successful reads.
_pages: OrderedDict[tuple[str, str | None], TreeListing] = OrderedDict()


def reset() -> None:
    """Forget what was listed (tests)."""
    _pages.clear()


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
