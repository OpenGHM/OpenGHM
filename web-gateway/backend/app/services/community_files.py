"""Files an admin uploads for the Community page: images, slides, notebooks.

Kept in a GridFS bucket (`community_files`) in the gateway's own database, not
on Anvil S3: the backend holds no S3 credentials by decision, and these are
editable site content rather than published artifacts (ADR 0034).

`get_bucket()` is the one place the driver is touched, so a test can swap it
for a stand-in with the same methods (tests/test_community.py).
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import quote

from bson import ObjectId
from bson.errors import InvalidId
from gridfs.errors import NoFile
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.requests import Request

from app.core.database import get_db
from app.services.community_content import FILE_URL_PREFIX

BUCKET = "community_files"
#: What one upload may weigh. Anything larger belongs on a video host or a data
#: repository and is linked from the page (ADR 0034).
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
CHUNK_BYTES = 256 * 1024
FILENAME_MAX = 200

_FILE_ID_RE = re.compile(r"^[0-9a-f]{24}$")
_OLE2 = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_MP4_BOXES = (b"ftyp", b"moov", b"mdat", b"free", b"wide", b"skip")


class UploadRefused(Exception):
    """An upload the gateway will not store; `status` is the HTTP status for it."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@dataclass(frozen=True)
class FileKind:
    content_type: str
    #: What a browser may legitimately declare for this extension. A declared
    #: type outside it (text/html for a .png) refuses the upload; none, or
    #: application/octet-stream, is accepted since some systems send nothing better.
    declared: frozenset[str]
    #: Does the start of the file look like this kind of file?
    sniff: Any


def _magic(*prefixes: bytes, at: int = 0):
    return lambda head: any(head[at : at + len(p)] == p for p in prefixes)


def _text(head: bytes) -> bool:
    """Plain text: UTF-8 without NUL bytes. `head` may end inside a character."""
    if b"\x00" in head:
        return False
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as exc:
        return exc.start >= len(head) - 3
    return True


def _json_text(head: bytes) -> bool:
    return _text(head) and head.lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"{")


def _webp(head: bytes) -> bool:
    return head[:4] == b"RIFF" and head[8:12] == b"WEBP"


def _mp4(head: bytes) -> bool:
    return head[4:8] in _MP4_BOXES


_ZIP = _magic(b"PK\x03\x04", b"PK\x05\x06")
_OLE = _magic(_OLE2)
_OCTET = "application/octet-stream"


def _kind(content_type: str, *declared: str, sniff) -> FileKind:
    return FileKind(content_type, frozenset(declared) | {content_type}, sniff)


#: Extension -> what the file must be. No SVG: it is a document that can carry
#: script, and served from our origin it would run.
KINDS: dict[str, FileKind] = {
    "jpg": _kind("image/jpeg", sniff=_magic(b"\xff\xd8\xff")),
    "jpeg": _kind("image/jpeg", sniff=_magic(b"\xff\xd8\xff")),
    "png": _kind("image/png", sniff=_magic(b"\x89PNG\r\n\x1a\n")),
    "webp": _kind("image/webp", sniff=_webp),
    "gif": _kind("image/gif", sniff=_magic(b"GIF87a", b"GIF89a")),
    "pdf": _kind("application/pdf", "application/x-pdf", sniff=_magic(b"%PDF-")),
    "ppt": _kind("application/vnd.ms-powerpoint", sniff=_OLE),
    "pptx": _kind(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation", sniff=_ZIP
    ),
    "key": _kind("application/vnd.apple.keynote", "application/x-iwork-keynote-sffkey", sniff=_ZIP),
    "doc": _kind("application/msword", sniff=_OLE),
    "docx": _kind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sniff=_ZIP
    ),
    "xls": _kind("application/vnd.ms-excel", sniff=_OLE),
    "xlsx": _kind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sniff=_ZIP),
    "csv": _kind("text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", sniff=_text),
    "zip": _kind("application/zip", "application/x-zip-compressed", "multipart/x-zip", sniff=_ZIP),
    "gz": _kind("application/gzip", "application/x-gzip", "application/x-gzip-compressed",
                sniff=_magic(b"\x1f\x8b")),
    "tar": _kind("application/x-tar", "application/tar", sniff=_magic(b"ustar", at=257)),
    "ipynb": _kind("application/x-ipynb+json", "application/json", sniff=_json_text),
    "mp4": _kind("video/mp4", "application/mp4", sniff=_mp4),
    "mov": _kind("video/quicktime", sniff=_mp4),
    "webm": _kind("video/webm", sniff=_magic(b"\x1a\x45\xdf\xa3")),
    "txt": _kind("text/plain", sniff=_text),
    "md": _kind("text/markdown", "text/x-markdown", "text/plain", sniff=_text),
}
_ANY_DECLARED = {"", _OCTET}


def clean_filename(raw: str | None) -> str:
    """A name safe to put in a header and to show: no directories, no control
    characters or quotes, at most FILENAME_MAX characters, extension kept."""
    name = (raw or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[\x00-\x1f\x7f\"]", "", name).strip().lstrip(".")
    if len(name) > FILENAME_MAX:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: FILENAME_MAX - len(ext) - 1] + "." + ext) if dot and len(ext) < 16 else name[:FILENAME_MAX]
    return name


def check_upload(filename: str, declared: str | None, head: bytes) -> FileKind:
    """The kind of file this is, or UploadRefused (415): its extension must be
    allowed, the type the browser declared must fit it, and the first bytes
    must look like it. Whatever the client claims, what is stored and served is
    the extension's own type."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    kind = KINDS.get(ext)
    if kind is None:
        allowed = ", ".join(sorted(KINDS))
        raise UploadRefused(
            415, "unsupported_file_type",
            f"Files of type '.{ext}' are not accepted. Allowed: {allowed}." if ext
            else f"The file needs an extension. Allowed: {allowed}.",
        )
    declared = (declared or "").split(";")[0].strip().lower()
    if declared not in _ANY_DECLARED and declared not in kind.declared:
        raise UploadRefused(
            415, "file_type_mismatch",
            f"The file is named .{ext} but was sent as '{declared}'.",
        )
    if not head or not kind.sniff(head):
        raise UploadRefused(
            415, "file_type_mismatch",
            f"The contents of '{filename}' do not look like a .{ext} file.",
        )
    return kind


def file_url(file_id: Any) -> str:
    return f"{FILE_URL_PREFIX}{file_id}"


def parse_file_id(file_id: str) -> ObjectId | None:
    """The ObjectId for a 24-hex string, else None (so a path that is not an id is a 404)."""
    if not _FILE_ID_RE.fullmatch(file_id):
        return None
    try:
        return ObjectId(file_id)
    except InvalidId:
        return None


def get_bucket() -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(get_db(), bucket_name=BUCKET)


def describe(grid_out: Any) -> dict:
    """A stored file as the API lists it."""
    meta = grid_out.metadata or {}
    return {
        "id": str(grid_out._id),
        "url": file_url(grid_out._id),
        "filename": grid_out.filename,
        "content_type": meta.get("content_type") or _OCTET,
        "size": grid_out.length,
        "uploaded_at": grid_out.upload_date,
    }


#: Multipart framing and the other form fields, on top of the file itself.
_BODY_OVERHEAD = 1024 * 1024


def _too_large() -> UploadRefused:
    return UploadRefused(
        413, "file_too_large",
        f"The file is over {MAX_UPLOAD_BYTES // 1024 // 1024} MiB. Host large media "
        "elsewhere (a video site, a data repository) and link to it.",
    )


async def read_upload(request: Request) -> UploadFile:
    """The `file` part of a multipart request, read from the wire with the limit
    applied as the bytes arrive.

    FastAPI's own `UploadFile` parameter would spool the whole body to a
    temporary file before the route ran, whatever its size; this reads the
    stream itself and stops at MAX_UPLOAD_BYTES (plus framing). The caller
    closes the returned file.
    """
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
        raise UploadRefused(415, "multipart_required", "Send the file as multipart/form-data, in the field 'file'.")
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_UPLOAD_BYTES + _BODY_OVERHEAD:
        raise _too_large()

    async def limited():
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES + _BODY_OVERHEAD:
                raise _too_large()
            yield chunk

    try:
        form = await MultiPartParser(request.headers, limited()).parse()
    except MultiPartException as exc:
        raise UploadRefused(400, "invalid_upload", exc.message) from exc
    upload = form.get("file")
    if not isinstance(upload, UploadFile):
        await form.close()
        raise UploadRefused(422, "file_required", "Send the file in the multipart field 'file'.")
    return upload


async def _chunks(upload: UploadFile, first: bytes) -> AsyncIterator[bytes]:
    """The upload's bytes after what was already read, one chunk at a time, and
    never more than MAX_UPLOAD_BYTES in all: past it the read stops, so an
    oversize body is not buffered, let alone stored."""
    total = len(first)
    yield first
    while chunk := await upload.read(CHUNK_BYTES):
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise _too_large()
        yield chunk


async def store_upload(upload: UploadFile, uploaded_by: str) -> dict:
    """Check and store one uploaded file; returns it as `describe` does.

    UploadRefused 415 before anything is written, and 413 as soon as the
    stream passes the limit, in which case the partial file is removed.
    """
    filename = clean_filename(upload.filename)
    first = await upload.read(CHUNK_BYTES)
    kind = check_upload(filename, upload.content_type, first)

    bucket = get_bucket()
    stream = bucket.open_upload_stream(
        filename,
        metadata={"content_type": kind.content_type, "uploaded_by": uploaded_by},
    )
    try:
        async for chunk in _chunks(upload, first):
            await stream.write(chunk)
        await stream.close()
    except BaseException:
        await stream.abort()
        raise
    grid_out = await bucket.open_download_stream(stream._id)
    return describe(grid_out)


async def list_files() -> list[dict]:
    """Every stored file, newest first."""
    cursor = get_bucket().find({}).sort("uploadDate", -1)
    return [describe(f) async for f in cursor]


async def open_file(file_id: str) -> Any | None:
    """The stored file for `file_id`, open for reading, or None when there is none."""
    oid = parse_file_id(file_id)
    if oid is None:
        return None
    try:
        return await get_bucket().open_download_stream(oid)
    except NoFile:
        return None


async def delete_file(file_id: str) -> bool:
    """Remove a stored file; False when there was none."""
    oid = parse_file_id(file_id)
    if oid is None:
        return False
    try:
        await get_bucket().delete(oid)
    except NoFile:
        return False
    return True


async def stream_chunks(grid_out: Any) -> AsyncIterator[bytes]:
    while chunk := await grid_out.readchunk():
        yield chunk


def content_disposition(filename: str, inline: bool) -> str:
    """`inline; filename="…"`, with the UTF-8 form too when the name is not ASCII."""
    ascii_name = filename.encode("ascii", "replace").decode().replace("?", "_")
    value = f'{"inline" if inline else "attachment"}; filename="{ascii_name}"'
    if ascii_name != filename:
        value += f"; filename*=UTF-8''{quote(filename, safe='')}"
    return value


def is_inline(content_type: str) -> bool:
    """Images and PDFs are shown in the page; everything else is downloaded."""
    return content_type.startswith("image/") or content_type == "application/pdf"
