"""In-memory stand-in for motor's AsyncIOMotorGridFSBucket, with the methods
app.services.community_files calls and the same shape: `open_upload_stream`
(synchronous, returns something with `write`/`close`/`abort`/`_id`),
`open_download_stream` (a coroutine; `NoFile` when there is none),
`find().sort()` (async-iterable) and `delete`.

`written` counts the bytes the fake was handed, so a test can show that an
oversize upload stopped being read at the limit.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from bson import ObjectId
from gridfs.errors import NoFile


class FakeGridOut:
    def __init__(self, oid: ObjectId, filename: str, metadata: dict, data: bytes, uploaded: datetime):
        self._id = oid
        self.filename = filename
        self.metadata = metadata
        self.length = len(data)
        self.upload_date = uploaded
        self._data = data
        self._pos = 0

    async def readchunk(self, size: int = 64 * 1024) -> bytes:
        chunk = self._data[self._pos : self._pos + size]
        self._pos += len(chunk)
        return chunk


class FakeGridIn:
    def __init__(self, bucket: "FakeBucket", filename: str, metadata: dict | None):
        self._bucket = bucket
        self._id = ObjectId()
        self._filename = filename
        self._metadata = metadata or {}
        self._parts: list[bytes] = []
        self.closed = False
        self.aborted = False

    async def write(self, data: bytes) -> None:
        self._bucket.written += len(data)
        self._parts.append(bytes(data))

    async def close(self) -> None:
        self.closed = True
        self._bucket.files[self._id] = FakeGridOut(
            self._id, self._filename, self._metadata, b"".join(self._parts),
            self._bucket.next_upload_date(),
        )

    async def abort(self) -> None:
        self.aborted = True
        self._parts.clear()
        self._bucket.aborted += 1


class _Cursor:
    def __init__(self, files: list[FakeGridOut]):
        self._files = files

    def sort(self, key: str, direction: int = 1):
        assert key == "uploadDate"
        self._files.sort(key=lambda f: f.upload_date, reverse=direction < 0)
        return self

    def __aiter__(self):
        async def gen():
            for f in self._files:
                yield f

        return gen()


class FakeBucket:
    def __init__(self) -> None:
        self.files: dict[ObjectId, FakeGridOut] = {}
        self.written = 0
        self.aborted = 0
        self._last_upload: datetime | None = None

    def next_upload_date(self) -> datetime:
        """Now, but always after the previous upload: two uploads in one clock
        tick would otherwise tie, and "newest first" would be a coin toss."""
        now = datetime.now(timezone.utc)
        if self._last_upload is not None and now <= self._last_upload:
            now = self._last_upload + timedelta(milliseconds=1)
        self._last_upload = now
        return now

    def open_upload_stream(self, filename: str, chunk_size_bytes=None, metadata=None, session=None):
        return FakeGridIn(self, filename, metadata)

    async def open_download_stream(self, file_id: ObjectId) -> FakeGridOut:
        if file_id not in self.files:
            raise NoFile(f"no file in gridfs for _id {file_id!r}")
        stored = self.files[file_id]
        # Each reader gets its own position.
        return FakeGridOut(stored._id, stored.filename, stored.metadata, stored._data, stored.upload_date)

    def find(self, filter: dict | None = None):
        assert not filter, "fake GridFS: only find({}) is supported"
        return _Cursor(list(self.files.values()))

    async def delete(self, file_id: ObjectId) -> None:
        if file_id not in self.files:
            raise NoFile(f"no file in gridfs for _id {file_id!r}")
        del self.files[file_id]
