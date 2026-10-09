"""A read-only, seekable file over HTTP range requests, with a block cache.

:class:`RangeFile` is what lets h5py open a NetCDF-4 file that lives on Anvil S3 without
downloading it: HDF5 reads the header and the chunks it needs, each a few seeks and reads, and each
read becomes at most one ``Range`` request for the blocks the cache lacks. h5py accepts any object
with ``read``/``readinto``, ``seek`` and ``tell``.

:class:`Http` keeps one connection per origin open (TLS costs more than a small range read does)
and reconnects when the server closes it. A transient failure (a dropped connection, a 5xx) is
tried again; a 4xx is :class:`HttpStatusError` at once.

Pure standard library: the optional extra is not needed to import this.
"""

from __future__ import annotations

import http.client
import io
import time
import urllib.parse
from collections import OrderedDict
from typing import Dict, List, Optional, Tuple

from ..errors import OpenghmError
from . import limits


class HttpStatusError(OpenghmError):
    """The server answered a request with a status that is not a success."""

    def __init__(self, url: str, status: int, reason: str = "") -> None:
        super().__init__(f"{url}: HTTP {status} {reason}".rstrip())
        self.url = url
        self.status = status


class Http:
    """Anonymous ``GET``/``HEAD`` over keep-alive connections, one per origin. Not thread-safe."""

    def __init__(self, timeout: float = limits.HTTP_TIMEOUT, attempts: int = limits.HTTP_ATTEMPTS,
                 backoff: float = limits.HTTP_BACKOFF) -> None:
        self.timeout, self.attempts, self.backoff = timeout, attempts, backoff
        self._conns: Dict[Tuple[str, str], http.client.HTTPConnection] = {}
        #: Requests sent, for tests and for a caller that reports what a call cost.
        self.requests = 0

    def _conn(self, scheme: str, netloc: str) -> http.client.HTTPConnection:
        key = (scheme, netloc)
        if key not in self._conns:
            cls = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
            self._conns[key] = cls(netloc, timeout=self.timeout)
        return self._conns[key]

    def close(self) -> None:
        for c in self._conns.values():
            c.close()
        self._conns.clear()

    def request(self, url: str, method: str = "GET", headers: Optional[Dict[str, str]] = None,
                ok: Tuple[int, ...] = (200, 206)) -> Tuple[int, Dict[str, str], bytes]:
        """``(status, headers, body)`` of one request, headers lower-cased. A status not in ``ok``
        raises :class:`HttpStatusError`; a connection failure or a 5xx is tried again."""
        parts = urllib.parse.urlsplit(url)
        target = parts.path + (f"?{parts.query}" if parts.query else "")
        last: Optional[BaseException] = None
        for attempt in range(1, self.attempts + 1):
            conn = self._conn(parts.scheme, parts.netloc)
            self.requests += 1
            try:
                conn.request(method, target, headers=headers or {})
                resp = conn.getresponse()
                body = resp.read()
                got = {k.lower(): v for k, v in resp.getheaders()}
                status = resp.status
                if resp.will_close:
                    conn.close()
            except (OSError, http.client.HTTPException) as e:
                conn.close()
                last = e
            else:
                if status in ok:
                    return status, got, body
                if status < 500:
                    raise HttpStatusError(url, status, resp.reason)
                last = HttpStatusError(url, status, resp.reason)
            if attempt < self.attempts:
                time.sleep(self.backoff * attempt)
        if isinstance(last, HttpStatusError):
            raise last
        raise OpenghmError(f"cannot reach {url}: {last}")

    def get(self, url: str) -> bytes:
        return self.request(url, ok=(200,))[2]


class RangeFile(io.RawIOBase):
    """``url`` as a read-only file of ``size`` bytes (a ``HEAD`` finds it when not given).

    A read asks for the blocks it needs that are not cached, as one ``Range`` request per run of
    adjacent blocks, and keeps the last ``cache_blocks`` blocks used. A server that ignores
    ``Range`` (answers 200 with the whole object) is an error: the file would be downloaded whole
    by every read.
    """

    def __init__(self, url: str, size: Optional[int] = None, http_client: Optional[Http] = None,
                 block_size: int = limits.BLOCK_SIZE, cache_blocks: int = limits.CACHE_BLOCKS) -> None:
        super().__init__()
        self.url = url
        self._http = http_client or Http()
        self._own_http = http_client is None
        if size is None:
            _, headers, _ = self._http.request(url, "HEAD", ok=(200,))
            try:
                size = int(headers["content-length"])
            except (KeyError, ValueError):
                raise OpenghmError(f"{url}: the server did not say how big the object is")
        self.size = size
        self.block_size, self.cache_blocks = block_size, cache_blocks
        self._blocks: "OrderedDict[int, bytes]" = OrderedDict()
        self._pos = 0
        #: Range requests sent and bytes they returned, for tests and reporting.
        self.fetches = 0
        self.fetched_bytes = 0

    # io.RawIOBase
    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self._pos, io.SEEK_END: self.size}[whence]
        self._pos = max(0, base + offset)
        return self._pos

    def close(self) -> None:
        if not self.closed and self._own_http:
            self._http.close()
        super().close()

    def _fetch_run(self, first: int, last: int) -> None:
        """Download blocks ``first..last`` (inclusive) in one request and cache each."""
        start = first * self.block_size
        end = min((last + 1) * self.block_size, self.size) - 1
        status, _, body = self._http.request(self.url, headers={"Range": f"bytes={start}-{end}"})
        if status != 206 or len(body) != end - start + 1:
            raise OpenghmError(
                f"{self.url}: asked for bytes {start}-{end} and got HTTP {status} with {len(body)} bytes; "
                "the server must support range requests"
            )
        self.fetches += 1
        self.fetched_bytes += len(body)
        for i in range(first, last + 1):
            lo = (i - first) * self.block_size
            self._blocks[i] = body[lo:lo + self.block_size]
            self._blocks.move_to_end(i)
        while len(self._blocks) > self.cache_blocks:
            self._blocks.popitem(last=False)

    def read_at(self, start: int, end: int) -> bytes:
        """The bytes ``[start, end)``, fetching the blocks the cache lacks."""
        end = min(end, self.size)
        if start >= end:
            return b""
        first, last = start // self.block_size, (end - 1) // self.block_size
        missing: List[int] = [i for i in range(first, last + 1) if i not in self._blocks]
        run_start = prev = None
        for i in missing:
            if run_start is None:
                run_start = prev = i
            elif i == prev + 1:
                prev = i
            else:
                self._fetch_run(run_start, prev)
                run_start = prev = i
        if run_start is not None:
            self._fetch_run(run_start, prev)
        # A block fetched for this read may be evicted by a later run of the same read when the
        # read is wider than the cache; take the pieces as they are used.
        out = []
        for i in range(first, last + 1):
            block = self._blocks.get(i)
            if block is None:
                self._fetch_run(i, i)
                block = self._blocks[i]
            self._blocks.move_to_end(i)
            lo = max(start, i * self.block_size) - i * self.block_size
            hi = min(end, (i + 1) * self.block_size) - i * self.block_size
            out.append(block[lo:hi])
        return b"".join(out)

    def readinto(self, b) -> int:
        data = self.read_at(self._pos, self._pos + len(b))
        b[:len(data)] = data
        self._pos += len(data)
        return len(data)

    def read(self, size: int = -1) -> bytes:
        end = self.size if size is None or size < 0 else self._pos + size
        data = self.read_at(self._pos, end)
        self._pos += len(data)
        return data
