"""A public Anvil S3 bucket in memory, for the tests of the model-input reader and the checks
before a submit.

`tree_browse` reads the bucket with two calls (`_get`: a `ListObjectsV2` page, `_get_head`: a
ranged `GET`); `FakeBucket.install` puts this in their place. The two published model inputs the
tests use are recorded in `tests/fixtures/model_input/<prefix>/`:

* `keys.txt`  every key of the model input as it was listed on 2026-10-23, relative to its root.
  A line `@days <folder> <stem> <first> <last>` stands for one file per day under
  `<folder>/<year>/<stem><date>.nc`, which the listing had without a gap (the 52585562 listing
  has them for 2000-01-01 to 2001-12-31, the ff0ba2e5 one from 1980 to 2024).
* `files/`    the `.init` files, the crop parameter table and the `metadata.json`, as published.

Every object that is not a recorded file holds the byte `x`.
"""

from __future__ import annotations

import datetime as dt
import functools
from pathlib import Path
from urllib.parse import unquote
from xml.sax.saxutils import escape

import httpx

from app.core.config import settings
from app.services import tree_browse

FIXTURES = Path(__file__).parent / "fixtures" / "model_input"
BASE = "https://s3.example.test"
BUCKET = "openghm"

#: the model inputs of the three published snapshots, by fixture folder.
MODEL_INPUTS = {
    "52585562": "52585562109e15bd7b06fad0e6deb17d1f4fa72a38474828adac5e74c169bc5d",
    "ff0ba2e5": "ff0ba2e5d840027f9d6440c5cb922e01f730403b0227fdad4ced7e1dd3bc422d",
}


@functools.lru_cache(maxsize=None)
def _recorded(fixture: str) -> dict[str, bytes]:
    """The objects of a recorded model input, by key relative to its root: what a recorded
    `keys.txt` stands for (`@days` lines expanded), each with its recorded bytes or `x`."""
    recorded = FIXTURES / fixture / "files"
    out: dict[str, bytes] = {}

    def add(key: str) -> None:
        file = recorded / key
        out[key] = file.read_bytes() if file.is_file() else b"x"

    for line in (FIXTURES / fixture / "keys.txt").read_text().splitlines():
        if not line:
            continue
        if line.startswith("@days "):
            _, folder, stem, first, last = line.split()
            day, end = dt.date.fromisoformat(first), dt.date.fromisoformat(last)
            while day <= end:
                add(f"{folder}{day.year}/{stem}{day.isoformat()}.nc")
                day += dt.timedelta(days=1)
        else:
            add(line)
    return out


class FakeBucket:
    """`objects` maps a full key to its bytes; `calls` is every request made; `fail` makes every
    request raise it; `max_keys` caps a listing page below what the request asks (a small one
    makes a listing take several pages)."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.calls: list[tuple] = []
        self.fail: Exception | None = None
        self.max_keys: int | None = None

    # ---- what is published -------------------------------------------------------------

    def put(self, key: str, data: bytes | str = b"x") -> None:
        self.objects[key] = data.encode() if isinstance(data, str) else data

    def add_model_input(self, prefix: str) -> str:
        """The recorded model input `prefix` (`52585562`), under its own id; returns the id."""
        artifact_id = MODEL_INPUTS[prefix]
        root = f"model-inputs/{artifact_id}/"
        self.objects.update({root + key: data for key, data in _recorded(prefix).items()})
        return artifact_id

    def install(self, monkeypatch) -> "FakeBucket":
        monkeypatch.setattr(tree_browse, "_get", self.get)
        monkeypatch.setattr(tree_browse, "_get_head", self.get_head)
        monkeypatch.setattr(settings, "S3_PUBLIC_BASE_URL", BASE)
        monkeypatch.setattr(settings, "S3_BUCKET", BUCKET)
        return self

    # ---- the two calls -----------------------------------------------------------------

    async def get(self, url, *, params):
        self.calls.append(("list", params["prefix"], params.get("continuation-token")))
        if self.fail:
            raise self.fail
        prefix = params["prefix"]
        delimiter = params.get("delimiter")
        size = min(int(params["max-keys"]), self.max_keys or 10**9)
        entries: list[tuple[str, bool]] = []  # (key or common prefix, is_folder)
        seen: set[str] = set()
        for key in sorted(k for k in self.objects if k.startswith(prefix)):
            rest = key[len(prefix) :]
            if delimiter and delimiter in rest:
                folder = prefix + rest.split(delimiter)[0] + delimiter
                if folder not in seen:
                    seen.add(folder)
                    entries.append((folder, True))
            else:
                entries.append((key, False))
        start = int(params.get("continuation-token") or 0)
        page = entries[start : start + size]
        more = start + size < len(entries)
        contents = "".join(
            f"<Contents><Key>{escape(k)}</Key><LastModified>2026-10-23T00:00:00.000Z</LastModified>"
            f"<ETag>&quot;x&quot;</ETag><Size>{len(self.objects[k])}</Size>"
            "<StorageClass>STANDARD</StorageClass></Contents>"
            for k, folder in page
            if not folder
        )
        common = "".join(
            f"<CommonPrefixes><Prefix>{escape(k)}</Prefix></CommonPrefixes>" for k, folder in page if folder
        )
        token = f"<NextContinuationToken>{start + size}</NextContinuationToken>" if more else ""
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
            f"<Name>{BUCKET}</Name><Prefix>{escape(prefix)}</Prefix><MaxKeys>{size}</MaxKeys>"
            f"<IsTruncated>{'true' if more else 'false'}</IsTruncated>{token}{contents}{common}"
            "</ListBucketResult>"
        )
        return httpx.Response(200, text=xml, request=httpx.Request("GET", url))

    async def get_head(self, url, *, headers):
        key = unquote(httpx.URL(url).path.removeprefix(f"/{BUCKET}/"))
        self.calls.append(("get", key, None))
        if self.fail:
            raise self.fail
        data = self.objects.get(key)
        if data is None:
            return 404, httpx.Headers(), b""
        if not data:
            return 416, httpx.Headers({"Content-Range": "bytes */0"}), b""
        head = data[: tree_browse.PREVIEW_BYTES]
        return 206, httpx.Headers({"Content-Range": f"bytes 0-{len(head) - 1}/{len(data)}"}), head

    def listings(self) -> list[str]:
        """The prefixes listed, in order."""
        return [prefix for kind, prefix, _ in self.calls if kind == "list"]
