"""A folder of a published tree as a ZIP (ADR 0036): its summary
(`tree_browse.folder_summary`), the archive (`app.services.tree_archive`) and the
four routes (`GET /repository/{datasets,model-inputs}/{id}/files/{folder,archive}`).

No network: the listing goes through `test_tree_browse`'s fake bucket, and the
objects are read through an `httpx.MockTransport` that serves `Bucket.objects`.
"""

from __future__ import annotations

import asyncio
import io
import zipfile
from urllib.parse import quote, unquote

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import repository as repository_router
from app.core.config import settings
from app.services import tree_archive, tree_browse
from app.services.tree_browse import ARCHIVE_LIMIT_BYTES
from route_helpers import FakeDB

# The fake bucket and its page builder are the browsing tests'.
from test_tree_browse import (
    BASE,
    BUCKET,
    KINDS,
    MODEL_INPUT_ID,
    SNAPSHOT_ID,
    STAMP,
    Bucket,
    _xml,
    files_url,
)


class ListingBucket(Bucket):
    """The browsing tests' fake bucket, which also lists `objects` for a prefix
    no page was given for: with a `delimiter` as one folder's entries, without as
    everything under it, `per_page` keys to a page (the token is the offset)."""

    per_page = 1000

    async def get(self, url, *, params):
        key = (params["prefix"], params.get("continuation-token"))
        if key in self.pages or self.fail:
            return await super().get(url, params=params)
        self.calls.append(("list", url, dict(params)))
        prefix = params["prefix"]
        keys = sorted(k for k in self.objects if k.startswith(prefix) and k != prefix)
        start = int(params.get("continuation-token") or 0)
        if "delimiter" in params:
            rest = [k[len(prefix) :] for k in keys]
            folders = sorted({prefix + r.split("/")[0] + "/" for r in rest if "/" in r})
            files = [
                (k, len(self.objects[k])) for k, r in zip(keys, rest) if "/" not in r
            ]
            entries = [(f, None) for f in folders] + files
            page = entries[start : start + self.per_page]
            more = (
                str(start + self.per_page)
                if start + self.per_page < len(entries)
                else None
            )
            text = _xml(
                prefix,
                [e[0] for e in page if e[1] is None],
                [e for e in page if e[1] is not None],
                token=more,
            )
            return httpx.Response(200, text=text, request=httpx.Request("GET", url))
        page = keys[start : start + self.per_page]
        more = str(start + self.per_page) if start + self.per_page < len(keys) else None
        files = [(k, len(self.objects[k])) for k in page]
        return httpx.Response(
            200,
            text=_xml(prefix, files=files, token=more),
            request=httpx.Request("GET", url),
        )


@pytest.fixture(autouse=True)
def bucket(monkeypatch) -> Bucket:
    fake = ListingBucket()
    monkeypatch.setattr(tree_browse, "_get", fake.get)
    monkeypatch.setattr(settings, "S3_PUBLIC_BASE_URL", BASE)
    monkeypatch.setattr(settings, "S3_BUCKET", BUCKET)
    tree_browse.reset()
    yield fake
    tree_browse.reset()


@pytest.fixture
def http(monkeypatch) -> TestClient:
    mongo = FakeDB()
    monkeypatch.setattr(repository_router, "get_db", lambda: mongo)
    mongo.datasets.docs[SNAPSHOT_ID] = {
        "_id": SNAPSHOT_ID,
        "document": {"id": SNAPSHOT_ID},
    }
    mongo.model_inputs.docs[MODEL_INPUT_ID] = {
        "_id": MODEL_INPUT_ID,
        "document": {"id": MODEL_INPUT_ID},
    }
    app = FastAPI()
    app.include_router(repository_router.router, prefix="/api/v1")
    return TestClient(app)


def put(bucket, prefix, objects, *, per_page=1000):
    """Make `objects` (key -> bytes) readable, and listed under `prefix` (no
    delimiter) `per_page` to a page, the pages chained by tokens `t1`, `t2`..."""
    bucket.objects.update(objects)
    keys = sorted(objects)
    pages = [keys[i : i + per_page] for i in range(0, len(keys), per_page)] or [[]]
    for n, page in enumerate(pages):
        token = f"t{n + 1}" if n + 1 < len(pages) else None
        bucket.pages[(prefix, f"t{n}" if n else None)] = _xml(
            prefix, files=[(k, len(objects[k])) for k in page], token=token
        )


class Reads:
    """The object reads the archive made, and what to break."""

    def __init__(self):
        self.urls: list[str] = []
        self.status: dict[str, int] = {}
        self.truncated: set[str] = set()
        #: A key with an event in `gates` is answered only once it is set.
        self.gates: dict[str, asyncio.Event] = {}
        #: Keys whose request has reached the bucket, in order, and those whose
        #: request or body is still open.
        self.started: list[str] = []
        self.open: set[str] = set()


class _Body(httpx.AsyncByteStream):
    """A response body that arrives as a network's would, in pieces."""

    def __init__(self, data: bytes, on_close=None):
        self.data = data
        self.on_close = on_close

    async def __aiter__(self):
        for start in range(0, len(self.data), 40_000):
            yield self.data[start : start + 40_000]

    async def aclose(self):
        if self.on_close:
            self.on_close()


class _Broken(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield b"x"
        raise httpx.ReadError("connection reset")


@pytest.fixture(autouse=True)
def reads(monkeypatch, bucket) -> Reads:
    seen = Reads()

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.urls.append(str(request.url))
        key = unquote(request.url.path.removeprefix(f"/{BUCKET}/"))
        seen.started.append(key)
        seen.open.add(key)
        try:
            if key in seen.gates:
                await seen.gates[key].wait()
            if key in seen.truncated:
                seen.open.discard(key)
                return httpx.Response(200, stream=_Broken())
            if key in seen.status:
                seen.open.discard(key)
                return httpx.Response(seen.status[key])
            if key not in bucket.objects:
                seen.open.discard(key)
                return httpx.Response(404)
        except BaseException:
            seen.open.discard(key)  # cancelled while waiting
            raise
        return httpx.Response(
            200, stream=_Body(bucket.objects[key], lambda: seen.open.discard(key))
        )

    monkeypatch.setattr(
        tree_archive,
        "_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    monkeypatch.setattr(tree_archive, "_active", 0)
    return seen


def summary_url(group, artifact_id):
    return f"{files_url(group, artifact_id)}/folder"


def archive_url(group, artifact_id):
    return f"{files_url(group, artifact_id)}/archive"


def pick(path: str) -> dict:
    """The form that asks for the folder at `path` as one entry of its parent."""
    head, _, name = path.removesuffix("/").rpartition("/")
    return {"folder": f"{head}/" if head else "", "names": [f"{name}/"]}


def post_folder(http, path, *, group="datasets", artifact_id=SNAPSHOT_ID):
    return http.post(archive_url(group, artifact_id), data=pick(path))


def opened(body: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(body))


# ---- the summary ----------------------------------------------------------------


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_a_summary_counts_the_folder_at_any_depth(
    http, bucket, group, artifact_id, kind
):
    prefix = f"{kind}/{artifact_id}/wbm_output/run/daily/"
    put(
        bucket,
        prefix,
        {
            f"{prefix}a.nc": b"x" * 10,
            f"{prefix}deeper/b.nc": b"x" * 5,
            f"{prefix}deeper/still/c.nc": b"x" * 1,
        },
    )
    bucket.pages[(prefix, None)] = _xml(
        prefix,
        files=[
            (f"{prefix}", 0),  # a folder marker
            (f"{prefix}a.nc", 10),
            (f"{prefix}deeper/b.nc", 5),
            (f"{prefix}deeper/still/c.nc", 1),
            (f"{prefix}deeper/", 0),
            (f"{prefix[:-1]}2/other.nc", 99),  # a sibling that shares the name's start
        ],
    )
    response = http.get(
        summary_url(group, artifact_id), params={"path": "wbm_output/run/daily"}
    )
    assert response.status_code == 200
    assert response.json() == {
        "path": "wbm_output/run/daily/",
        "url": f"{BASE}/{BUCKET}/{kind}/{artifact_id}/wbm_output/run/daily/",
        "files": 3,
        "bytes": 16,
        "limit_bytes": 500 * 1024 * 1024,
        "fits": True,
        "complete": True,
    }
    listing = bucket.calls[0][2]
    assert listing["prefix"] == prefix and "delimiter" not in listing


def test_a_summary_follows_the_listing_pages(http, bucket):
    prefix = f"snapshots/{SNAPSHOT_ID}/daily/"
    put(bucket, prefix, {f"{prefix}{n}.nc": b"xx" for n in range(5)}, per_page=2)
    body = http.get(
        summary_url("datasets", SNAPSHOT_ID), params={"path": "daily"}
    ).json()
    assert (body["files"], body["bytes"], body["complete"]) == (5, 10, True)
    assert [c[2].get("continuation-token") for c in bucket.calls] == [None, "t1", "t2"]


def test_the_limit_is_five_hundred_mebibytes_inclusive(http, bucket):
    assert ARCHIVE_LIMIT_BYTES == 500 * 1024 * 1024
    prefix = f"snapshots/{SNAPSHOT_ID}/"
    bucket.pages[(f"{prefix}at/", None)] = _xml(
        f"{prefix}at/", files=[(f"{prefix}at/a.nc", ARCHIVE_LIMIT_BYTES)]
    )
    bucket.pages[(f"{prefix}over/", None)] = _xml(
        f"{prefix}over/",
        files=[
            (f"{prefix}over/a.nc", ARCHIVE_LIMIT_BYTES - 1),
            (f"{prefix}over/b.nc", 2),
        ],
    )
    at = http.get(summary_url("datasets", SNAPSHOT_ID), params={"path": "at"}).json()
    over = http.get(
        summary_url("datasets", SNAPSHOT_ID), params={"path": "over"}
    ).json()
    assert (at["fits"], at["complete"]) == (True, True)
    assert (over["fits"], over["complete"], over["bytes"]) == (
        False,
        True,
        ARCHIVE_LIMIT_BYTES + 1,
    )


def test_a_listing_past_the_page_cap_does_not_fit_and_says_it_is_incomplete(
    http, bucket, monkeypatch
):
    monkeypatch.setattr(tree_browse, "_FOLDER_MAX_PAGES", 2)
    prefix = f"snapshots/{SNAPSHOT_ID}/many/"
    put(bucket, prefix, {f"{prefix}{n}.nc": b"x" for n in range(6)}, per_page=2)
    body = http.get(
        summary_url("datasets", SNAPSHOT_ID), params={"path": "many"}
    ).json()
    assert body["complete"] is False and body["fits"] is False
    assert body["url"] == f"{BASE}/{BUCKET}/snapshots/{SNAPSHOT_ID}/many/"
    assert (body["files"], body["bytes"]) == (4, 4)  # what the two pages held
    assert len(bucket.calls) == 2
    http.get(summary_url("datasets", SNAPSHOT_ID), params={"path": "many"})
    assert len(bucket.calls) == 4  # not kept


def test_a_complete_summary_is_kept(http, bucket):
    prefix = f"snapshots/{SNAPSHOT_ID}/daily/"
    put(bucket, prefix, {f"{prefix}a.nc": b"x"})
    for _ in range(2):
        assert (
            http.get(
                summary_url("datasets", SNAPSHOT_ID), params={"path": "daily"}
            ).status_code
            == 200
        )
    assert len(bucket.calls) == 1


def test_the_root_of_a_tree_has_a_summary(http, bucket):
    root = f"snapshots/{SNAPSHOT_ID}/"
    put(bucket, root, {f"{root}metadata.json": b"{}", f"{root}wbm_init/a.init": b"x"})
    body = http.get(summary_url("datasets", SNAPSHOT_ID)).json()
    assert (body["path"], body["files"]) == ("", 2)
    assert body["url"] == f"{BASE}/{BUCKET}/snapshots/{SNAPSHOT_ID}/"


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
@pytest.mark.parametrize("path", ["/etc", "a/../b", "a//b", "a\\b", ".."])
def test_a_bad_path_is_422_and_nothing_is_read(
    http, bucket, reads, group, artifact_id, kind, path
):
    summary = http.get(summary_url(group, artifact_id), params={"path": path})
    archive = http.post(
        archive_url(group, artifact_id), data={"folder": path, "names": ["a"]}
    )
    for response in (summary, archive):
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_path"
    assert bucket.calls == [] and reads.urls == []


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_a_folder_with_nothing_in_it_is_404(http, bucket, group, artifact_id, kind):
    prefix = f"{kind}/{artifact_id}/nope/"
    bucket.pages[(prefix, None)] = _xml(prefix)
    summary = http.get(summary_url(group, artifact_id), params={"path": "nope"})
    archive = http.post(
        archive_url(group, artifact_id), data={"folder": "nope", "names": ["a"]}
    )
    for response in (summary, archive):
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "path_not_found"


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_a_bucket_that_cannot_be_listed_is_503(http, bucket, group, artifact_id, kind):
    bucket.fail = httpx.ConnectError("down")
    summary = http.get(summary_url(group, artifact_id), params={"path": "daily"})
    archive = http.post(
        archive_url(group, artifact_id), data={"folder": "", "names": ["daily/"]}
    )
    for response in (summary, archive):
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "listing_unavailable"
    assert tree_archive._active == 0


@pytest.mark.parametrize("group", ["datasets", "model-inputs"])
def test_an_unknown_id_is_404_and_nothing_is_read(http, bucket, group):
    summary = http.get(summary_url(group, "unknown"), params={"path": "daily"})
    archive = http.post(
        archive_url(group, "unknown"), data={"folder": "", "names": ["daily/"]}
    )
    for response in (summary, archive):
        assert response.status_code == 404
    assert bucket.calls == []


def test_the_archive_route_is_a_post_only(http):
    assert (
        http.get(
            archive_url("datasets", SNAPSHOT_ID), params={"path": "daily"}
        ).status_code
        == 405
    )


# ---- the archive ----------------------------------------------------------------

FILES = {
    "daily/wbm_2000.nc": b"\x89HDF" * 1000,
    "daily/wbm_2001.nc": bytes(range(256)) * 300,
    "daily/notes/readme.txt": "Grüße, 世界\n".encode(),
    "daily/empty.dat": b"",
}


def seed(bucket, kind, artifact_id, files=FILES):
    root = f"{kind}/{artifact_id}/"
    put(bucket, f"{root}daily/", {f"{root}{k}": v for k, v in files.items()})


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_an_archive_holds_every_object_under_its_folder_name(
    http, bucket, group, artifact_id, kind
):
    seed(bucket, kind, artifact_id)
    response = post_folder(http, "daily/", group=group, artifact_id=artifact_id)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    archive = opened(response.content)
    assert archive.testzip() is None
    assert sorted(archive.namelist()) == sorted(FILES)
    for name, data in FILES.items():
        assert archive.read(name) == data
    assert {i.compress_type for i in archive.infolist()} == {zipfile.ZIP_STORED}


def test_names_are_relative_to_the_folders_parent(http, bucket):
    root = f"snapshots/{SNAPSHOT_ID}/"
    put(
        bucket,
        f"{root}wbm_output/run1/daily/",
        {
            f"{root}wbm_output/run1/daily/a.nc": b"a",
            f"{root}wbm_output/run1/daily/y/b.nc": b"b",
        },
    )
    response = post_folder(http, "wbm_output/run1/daily")
    assert sorted(opened(response.content).namelist()) == ["daily/a.nc", "daily/y/b.nc"]


def test_a_top_level_folder_is_its_own_first_name(http, bucket):
    root = f"snapshots/{SNAPSHOT_ID}/"
    put(bucket, f"{root}wbm_init/", {f"{root}wbm_init/a.init": b"a"})
    response = post_folder(http, "wbm_init/")
    assert opened(response.content).namelist() == ["wbm_init/a.init"]


def seed_root(bucket, kind=None, artifact_id=None, extra=None):
    """A small tree: two files at the root and a folder, plus `extra` (key -> bytes)."""
    root = f"{kind or 'snapshots'}/{artifact_id or SNAPSHOT_ID}/"
    objects = {
        "metadata.json": b'{"id": 1}',
        "SHA256SUMS": b"abc  metadata.json\n",
        "wbm_init/a.init": b"a" * 20,
        "wbm_init/deep/b.init": b"b" * 30,
        "wbm_output/x.nc": b"x" * 40,
    } | (extra or {})
    bucket.objects.update({f"{root}{k}": v for k, v in objects.items()})
    return objects


def select(http, folder, names, *, group="datasets", artifact_id=SNAPSHOT_ID, **kwargs):
    return http.post(
        archive_url(group, artifact_id),
        data={"folder": folder, "names": names},
        **kwargs,
    )


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_files_and_a_folder_of_the_root_come_down_as_one_zip(
    http, bucket, group, artifact_id, kind
):
    objects = seed_root(bucket, kind, artifact_id)
    response = select(
        http, "", ["metadata.json", "wbm_init/"], group=group, artifact_id=artifact_id
    )
    assert response.status_code == 200
    archive = opened(response.content)
    assert archive.namelist() == [
        "metadata.json",
        "wbm_init/a.init",
        "wbm_init/deep/b.init",
    ]
    assert archive.read("wbm_init/deep/b.init") == objects["wbm_init/deep/b.init"]
    assert archive.testzip() is None
    assert int(response.headers["content-length"]) == len(response.content)
    assert (
        response.headers["content-disposition"]
        == f'attachment; filename="{artifact_id}-files.zip"'
    )


def test_files_inside_a_folder_are_stored_by_their_own_names(http, bucket):
    seed_root(bucket)
    root = f"snapshots/{SNAPSHOT_ID}/"
    bucket.objects.update(
        {f"{root}wbm_output/run/yearly/{n}.nc": n.encode() for n in "abc"}
    )
    response = select(http, "wbm_output/run/yearly/", ["c.nc", "a.nc"])
    assert opened(response.content).namelist() == ["c.nc", "a.nc"]  # as asked
    assert (
        response.headers["content-disposition"]
        == f'attachment; filename="{SNAPSHOT_ID}-yearly.zip"'
    )


def test_a_selected_subfolder_is_stored_under_its_name(http, bucket):
    seed_root(bucket)
    response = select(http, "wbm_init/", ["deep/", "a.init"])
    assert opened(response.content).namelist() == ["deep/b.init", "a.init"]


def test_one_item_names_the_file_for_it(http, bucket):
    seed_root(bucket)
    file = select(http, "", ["metadata.json"])
    folder = select(http, "", ["wbm_init/"])
    assert (
        file.headers["content-disposition"]
        == f'attachment; filename="{SNAPSHOT_ID}-metadata.json.zip"'
    )
    assert (
        folder.headers["content-disposition"]
        == f'attachment; filename="{SNAPSHOT_ID}-wbm_init.zip"'
    )
    assert opened(folder.content).namelist() == [
        "wbm_init/a.init",
        "wbm_init/deep/b.init",
    ]


def test_a_name_asked_twice_is_in_the_zip_once(http, bucket):
    seed_root(bucket)
    response = select(http, "", ["SHA256SUMS", "SHA256SUMS", "metadata.json"])
    assert opened(response.content).namelist() == ["SHA256SUMS", "metadata.json"]


def test_the_body_may_be_json(http, bucket):
    seed_root(bucket)
    response = http.post(
        archive_url("datasets", SNAPSHOT_ID),
        json={"folder": "", "names": ["metadata.json", "wbm_init/"]},
    )
    assert response.status_code == 200 and len(opened(response.content).namelist()) == 3


def test_a_name_on_a_later_page_of_the_folder_is_found(http, bucket):
    root = f"snapshots/{SNAPSHOT_ID}/"
    bucket.per_page = 2
    bucket.objects.update({f"{root}d/{n:02d}.nc": bytes([n]) for n in range(7)})
    response = select(http, "d/", ["06.nc", "00.nc"])
    assert opened(response.content).namelist() == ["06.nc", "00.nc"]
    assert [c[2].get("continuation-token") for c in bucket.calls[:4]] == [
        None,
        "2",
        "4",
        "6",
    ]


def test_a_thousand_names_fit_in_a_form(http, bucket):
    root = f"snapshots/{SNAPSHOT_ID}/d/"
    names = [f"{n:04d}.nc" for n in range(1000)]
    bucket.objects.update({f"{root}{n}": b"x" for n in names})
    response = select(http, "d/", names)
    assert (
        response.status_code == 200 and len(opened(response.content).namelist()) == 1000
    )


@pytest.mark.parametrize(
    "names",
    [[], [""], ["a/b"], ["a/b/"], [".."], ["../"], ["."], ["/"], ["a\\b"], ["x" * 256]],
)
def test_names_that_are_not_entries_of_a_folder_are_422_and_nothing_is_read(
    http, bucket, reads, names
):
    response = select(http, "", names)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] in ("invalid_path", "invalid_selection")
    assert bucket.calls == [] and reads.urls == []


def test_more_than_a_thousand_names_are_refused(http, bucket):
    response = select(http, "d/", [f"{n}.nc" for n in range(1001)])
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_selection"
    assert bucket.calls == []


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"folder": ""},
        {"names": "a"},
        {"folder": 3, "names": ["a"]},
        {"folder": "", "names": [1]},
        [1],
    ],
)
def test_a_body_of_another_shape_is_422(http, body):
    response = http.post(archive_url("datasets", SNAPSHOT_ID), json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_selection"


def test_a_name_that_is_not_in_the_folder_is_404(http, bucket, reads):
    seed_root(bucket)
    for names in (
        ["nope.json"],
        ["metadata.json", "nope/"],
        ["wbm_init"],
        ["metadata.json/"],
    ):
        response = select(http, "", names)
        assert response.status_code == 404, names
        assert response.json()["detail"]["code"] == "path_not_found"
    assert reads.urls == [] and tree_archive._active == 0


def test_the_size_of_the_whole_selection_is_what_the_limit_judges(http, bucket, reads):
    seed_root(bucket)
    root = f"snapshots/{SNAPSHOT_ID}/"
    half = tree_browse.ARCHIVE_LIMIT_BYTES // 2 + 1
    prefix = f"{root}wbm_output/"
    bucket.pages[(prefix, None)] = _xml(
        prefix, files=[(f"{prefix}a.nc", half), (f"{prefix}b.nc", half)]
    )
    bucket.pages[(root, None)] = _xml(root, folders=[prefix], files=[])
    # Each alone fits; together they do not.
    response = select(http, "wbm_output/", ["a.nc", "b.nc"])
    assert response.status_code == 413
    assert response.json()["detail"] == {
        "code": "selection_too_large",
        "message": response.json()["detail"]["message"],
        "bytes": 2 * half,
        "limit_bytes": tree_browse.ARCHIVE_LIMIT_BYTES,
    }
    assert tree_archive._active == 0


def test_a_folder_among_files_counts_with_them(http, bucket, reads):
    seed_root(bucket)
    root = f"snapshots/{SNAPSHOT_ID}/"
    big = f"{root}wbm_output/"
    bucket.pages[(big, None)] = _xml(
        big, files=[(f"{big}x.nc", tree_browse.ARCHIVE_LIMIT_BYTES)]
    )
    over = select(http, "", ["wbm_output/", "metadata.json"])
    assert over.status_code == 413
    assert over.json()["detail"]["bytes"] == tree_browse.ARCHIVE_LIMIT_BYTES + len(
        b'{"id": 1}'
    )
    assert reads.urls == []


def test_a_selected_folder_too_big_to_list_whole_is_413(
    http, bucket, reads, monkeypatch
):
    monkeypatch.setattr(tree_browse, "_FOLDER_MAX_PAGES", 2)
    bucket.per_page = 2
    root = f"snapshots/{SNAPSHOT_ID}/"
    bucket.objects.update({f"{root}many/{n}.nc": b"x" for n in range(9)})
    response = select(http, "", ["many/"])
    assert response.status_code == 413 and reads.urls == []


def test_the_folders_selected_share_one_listing_budget(
    http, bucket, reads, monkeypatch
):
    monkeypatch.setattr(tree_browse, "_FOLDER_MAX_PAGES", 3)
    bucket.per_page = 2
    root = f"snapshots/{SNAPSHOT_ID}/"
    for folder in "abcd":
        bucket.objects.update({f"{root}{folder}/{n}.nc": b"x" for n in range(3)})
    # a, b: two pages each would be 4 > 3, so the second one is cut off.
    assert select(http, "", ["a/"]).status_code == 200
    assert select(http, "", ["a/", "b/"]).status_code == 413
    assert select(http, "", ["a/", "b/", "c/", "d/"]).status_code == 413


def test_the_exact_length_is_sent_and_is_the_archives(http, bucket):
    seed(bucket, "snapshots", SNAPSHOT_ID)
    response = post_folder(http, "daily")
    assert int(response.headers["content-length"]) == len(response.content) > 0


def test_the_length_holds_for_many_entries_and_long_non_ascii_names(http, bucket):
    files = {
        f"daily/{'é' * 40}/{n:04d}-{'日本' * 10}.nc": bytes([n % 256]) * n
        for n in range(120)
    }
    seed(bucket, "snapshots", SNAPSHOT_ID, files)
    response = post_folder(http, "daily")
    assert int(response.headers["content-length"]) == len(response.content)
    archive = opened(response.content)
    assert archive.testzip() is None and sorted(archive.namelist()) == sorted(files)


def test_the_file_is_named_for_the_artifact_and_the_folder(http, bucket):
    seed(bucket, "snapshots", SNAPSHOT_ID)
    response = post_folder(http, "daily")
    assert (
        response.headers["content-disposition"]
        == f'attachment; filename="{SNAPSHOT_ID}-daily.zip"'
    )
    assert response.headers["cache-control"] == "no-store"


def test_an_unusual_folder_name_gets_a_safe_name_and_its_own_in_filename_star():
    header = tree_archive.content_disposition('id-ré "x".zip')
    assert header == (
        'attachment; filename="id-r___x_.zip"; '
        f"filename*=UTF-8''{quote('id-ré "x".zip', safe='')}"
    )


def test_an_unsafe_name_is_left_out(http, bucket):
    seed(bucket, "snapshots", SNAPSHOT_ID, {"daily/a.nc": b"a"})
    prefix = f"snapshots/{SNAPSHOT_ID}/daily/"
    bucket.pages[(prefix, None)] = _xml(
        prefix,
        files=[
            (f"{prefix}a.nc", 1),
            (f"{prefix}../evil.nc", 1),
            (f"{prefix}x//y.nc", 1),
        ],
    )
    response = post_folder(http, "daily")
    assert opened(response.content).namelist() == ["daily/a.nc"]
    assert int(response.headers["content-length"]) == len(response.content)


def test_a_folder_over_the_limit_is_413_before_anything_is_read(http, bucket, reads):
    prefix = f"snapshots/{SNAPSHOT_ID}/daily/"
    bucket.objects[f"{prefix}a.nc"] = b""  # so that the folder is there to be selected
    bucket.pages[(prefix, None)] = _xml(
        prefix, files=[(f"{prefix}a.nc", ARCHIVE_LIMIT_BYTES), (f"{prefix}b.nc", 1)]
    )
    response = post_folder(http, "daily")
    assert response.status_code == 413
    assert response.json()["detail"] == {
        "code": "selection_too_large",
        "message": response.json()["detail"]["message"],
        "bytes": ARCHIVE_LIMIT_BYTES + 1,
        "limit_bytes": ARCHIVE_LIMIT_BYTES,
    }
    assert reads.urls == [] and tree_archive._active == 0


def test_a_folder_too_big_to_list_whole_is_413_too(http, bucket, reads, monkeypatch):
    monkeypatch.setattr(tree_browse, "_FOLDER_MAX_PAGES", 1)
    prefix = f"snapshots/{SNAPSHOT_ID}/daily/"
    put(bucket, prefix, {f"{prefix}{n}.nc": b"x" for n in range(4)}, per_page=2)
    response = post_folder(http, "daily")
    assert response.status_code == 413 and reads.urls == []


def test_the_size_is_listed_afresh_even_when_a_summary_said_it_fits(
    http, bucket, reads
):
    seed(bucket, "snapshots", SNAPSHOT_ID)
    assert http.get(
        summary_url("datasets", SNAPSHOT_ID), params={"path": "daily"}
    ).json()["fits"]
    prefix = f"snapshots/{SNAPSHOT_ID}/daily/"
    bucket.pages[(prefix, None)] = _xml(
        prefix, files=[(f"{prefix}a.nc", ARCHIVE_LIMIT_BYTES + 1)]
    )
    assert post_folder(http, "daily").status_code == 413


def test_a_busy_process_answers_429_and_does_not_list(http, bucket, reads, monkeypatch):
    seed(bucket, "snapshots", SNAPSHOT_ID)
    monkeypatch.setattr(tree_archive, "_active", tree_archive.MAX_ARCHIVES)
    response = post_folder(http, "daily")
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "archive_busy"
    assert bucket.calls == [] and tree_archive._active == tree_archive.MAX_ARCHIVES


def test_a_finished_archive_frees_its_place(http, bucket):
    seed(bucket, "snapshots", SNAPSHOT_ID)
    for _ in range(tree_archive.MAX_ARCHIVES + 2):
        assert post_folder(http, "daily").status_code == 200
    assert tree_archive._active == 0


def test_a_place_is_taken_while_an_archive_is_open_and_freed_by_either_end(bucket):
    seed(bucket, "snapshots", SNAPSHOT_ID)

    async def run():
        first = await tree_archive.open_archive(
            "snapshots", SNAPSHOT_ID, "", ["daily/"]
        )
        assert tree_archive._active == 1
        first.release()  # the stream never began: the response's background task
        first.release()  # and releasing twice takes only one place back
        assert tree_archive._active == 0
        second = await tree_archive.open_archive(
            "snapshots", SNAPSHOT_ID, "", ["daily/"]
        )
        async for _ in second.stream():
            pass
        assert tree_archive._active == 0
        second.release()
        assert tree_archive._active == 0

    asyncio.run(run())


def test_an_object_that_cannot_be_read_ends_the_response_with_an_error(
    http, bucket, reads, caplog
):
    seed(bucket, "snapshots", SNAPSHOT_ID)
    broken = f"snapshots/{SNAPSHOT_ID}/daily/wbm_2001.nc"
    reads.status[broken] = 500
    with pytest.raises(tree_archive.ArchiveError), caplog.at_level("WARNING"):
        post_folder(http, "daily")
    assert broken in caplog.text and "HTTP 500" in caplog.text
    assert tree_archive._active == 0


def test_a_read_that_breaks_midway_ends_the_response_with_an_error(http, bucket, reads):
    seed(bucket, "snapshots", SNAPSHOT_ID)
    reads.truncated.add(f"snapshots/{SNAPSHOT_ID}/daily/wbm_2000.nc")
    with pytest.raises(tree_archive.ArchiveError, match="wbm_2000.nc") as raised:
        post_folder(http, "daily")
    assert isinstance(raised.value.__cause__, httpx.ReadError)
    assert tree_archive._active == 0


def test_an_object_that_is_not_the_listed_size_ends_the_response_with_an_error(
    http, bucket
):
    seed(bucket, "snapshots", SNAPSHOT_ID)
    prefix = f"snapshots/{SNAPSHOT_ID}/daily/"
    bucket.pages[(prefix, None)] = _xml(prefix, files=[(f"{prefix}wbm_2000.nc", 7)])
    with pytest.raises(tree_archive.ArchiveError, match="listed"):
        post_folder(http, "daily")
    assert tree_archive._active == 0


def test_the_objects_are_read_by_their_quoted_public_urls(http, bucket, reads):
    seed(bucket, "snapshots", SNAPSHOT_ID, {"daily/a b.nc": b"a"})
    post_folder(http, "daily")
    assert reads.urls == [f"{BASE}/{BUCKET}/snapshots/{SNAPSHOT_ID}/daily/a%20b.nc"]


def test_an_object_too_large_to_buffer_is_written_in_pieces_not_whole(
    bucket, monkeypatch
):
    monkeypatch.setattr(tree_archive, "_PREFETCH_OBJECT_BYTES", 1000)
    big = b"z" * (tree_archive._CHUNK * 5 + 17)
    seed(bucket, "snapshots", SNAPSHOT_ID, {"daily/big.nc": big})

    async def run():
        archive = await tree_archive.open_archive(
            "snapshots", SNAPSHOT_ID, "", ["daily/"]
        )
        return [piece async for piece in archive.stream()]

    pieces = asyncio.run(run())
    assert len(pieces) > 5 and max(len(p) for p in pieces) < len(big) // 2
    assert b"".join(pieces)[:4] == b"PK\x03\x04"


# ---- ZIP64 -----------------------------------------------------------------------


def test_the_length_is_left_out_when_zip64_would_change_it():
    assert tree_archive.archive_length([("a/b", 3), ("a/c", 4)]) is not None
    assert tree_archive.archive_length([("a/b", 3 * 1024**3)]) is None
    assert tree_archive.archive_length([(f"a/{n}", 0) for n in range(65536)]) is None
    assert (
        tree_archive.archive_length([(f"a/{n}", 0) for n in range(65535)]) is not None
    )


def test_more_than_65535_entries_still_make_a_valid_archive(bucket):
    count = zipfile.ZIP_FILECOUNT_LIMIT + 2
    entries = [
        (
            f"d/{n}",
            tree_browse.FolderObject(
                key=f"k{n}", size=0, modified=STAMP, url=f"{BASE}/{BUCKET}/k{n}"
            ),
        )
        for n in range(count)
    ]
    for n in range(count):
        bucket.objects[f"k{n}"] = b""

    async def run():
        archive = tree_archive.Archive("x.zip", entries, tree_archive._acquire())
        assert archive.length is None
        return b"".join([piece async for piece in archive.stream()])

    body = asyncio.run(run())
    with opened(body) as archive:
        assert len(archive.namelist()) == count and archive.testzip() is None


# ---- reading ahead ---------------------------------------------------------------


def names(n, size=10):
    """`n` objects of `size` bytes under `daily/`, each its own byte, and their keys."""
    root = f"snapshots/{SNAPSHOT_ID}/"
    files = {f"daily/f{i:02d}.nc": bytes([65 + i]) * size for i in range(n)}
    return files, [f"{root}{name}" for name in files]


async def settle():
    await asyncio.sleep(0.05)


def strays():
    return [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]


def test_the_output_keeps_the_listings_order_when_the_reads_finish_in_another(
    bucket, reads
):
    files, keys = names(6)
    seed(bucket, "snapshots", SNAPSHOT_ID, files)

    async def run():
        reads.gates = {k: asyncio.Event() for k in keys}
        archive = await tree_archive.open_archive(
            "snapshots", SNAPSHOT_ID, "", ["daily/"]
        )
        body = asyncio.create_task(_collect(archive.stream()))
        await settle()
        assert len(reads.started) == 6  # all of them are in flight at once
        for key in reversed(keys):  # the last finishes first
            reads.gates[key].set()
            await asyncio.sleep(0)
        return archive, await body

    archive, body = asyncio.run(run())
    zf = opened(body)
    assert zf.namelist() == list(files)
    assert [zf.read(n) for n in files] == list(files.values())
    assert len(body) == archive.length  # and the length is the same as ever


async def _collect(stream) -> bytes:
    return b"".join([piece async for piece in stream])


def test_no_more_than_the_window_is_requested_ahead(bucket, reads, monkeypatch):
    monkeypatch.setattr(tree_archive, "PREFETCH", 3)
    files, keys = names(10)
    seed(bucket, "snapshots", SNAPSHOT_ID, files)

    async def run():
        reads.gates = {k: asyncio.Event() for k in keys}
        archive = await tree_archive.open_archive(
            "snapshots", SNAPSHOT_ID, "", ["daily/"]
        )
        body = asyncio.create_task(_collect(archive.stream()))
        await settle()
        assert reads.started == keys[:3]
        reads.gates[keys[0]].set()
        await settle()
        assert reads.started == keys[:4]  # one finished and written, one more asked
        for gate in reads.gates.values():
            gate.set()
        return await body

    assert opened(asyncio.run(run())).namelist() == list(files)


def test_what_is_buffered_stays_within_its_bounds(bucket, reads, monkeypatch):
    monkeypatch.setattr(tree_archive, "_PREFETCH_OBJECT_BYTES", 10)
    monkeypatch.setattr(tree_archive, "_PREFETCH_TOTAL_BYTES", 25)
    files, keys = names(6)
    seed(bucket, "snapshots", SNAPSHOT_ID, files)

    async def run():
        reads.gates = {k: asyncio.Event() for k in keys}
        archive = await tree_archive.open_archive(
            "snapshots", SNAPSHOT_ID, "", ["daily/"]
        )
        body = asyncio.create_task(_collect(archive.stream()))
        await settle()
        assert reads.started == keys[:2]  # 3 x 10 bytes would be over the 25
        reads.gates[keys[0]].set()
        await settle()
        assert reads.started == keys[:3]  # its 10 bytes are free again
        for gate in reads.gates.values():
            gate.set()
        return await body

    assert opened(asyncio.run(run())).namelist() == list(files)


def test_an_object_over_the_buffer_limit_is_read_in_its_turn_and_those_after_it_still_ahead(
    bucket, reads, monkeypatch
):
    monkeypatch.setattr(tree_archive, "_PREFETCH_OBJECT_BYTES", 10)
    root = f"snapshots/{SNAPSHOT_ID}/"
    files = {
        "daily/a.nc": b"a" * 5,
        "daily/b.nc": b"b" * 50,  # too large to buffer
        "daily/c.nc": b"c" * 5,
        "daily/d.nc": b"d" * 5,
    }
    seed(bucket, "snapshots", SNAPSHOT_ID, files)

    async def run():
        reads.gates = {f"{root}{n}": asyncio.Event() for n in files}
        archive = await tree_archive.open_archive(
            "snapshots", SNAPSHOT_ID, "", ["daily/"]
        )
        body = asyncio.create_task(_collect(archive.stream()))
        await settle()
        assert reads.started == [f"{root}daily/{c}.nc" for c in "acd"]
        reads.gates[f"{root}daily/a.nc"].set()
        await settle()
        assert f"{root}daily/b.nc" in reads.started  # its turn
        for gate in reads.gates.values():
            gate.set()
        return await body

    zf = opened(asyncio.run(run()))
    assert zf.namelist() == list(files) and zf.read("daily/b.nc") == b"b" * 50


def test_a_failure_in_an_object_read_ahead_ends_the_response_at_once(
    bucket, reads, caplog
):
    files, keys = names(5)
    seed(bucket, "snapshots", SNAPSHOT_ID, files)
    reads.status[keys[3]] = 500

    async def run():
        # The first object is held back: the failure is not left waiting for its turn.
        reads.gates = {keys[0]: asyncio.Event()}
        archive = await tree_archive.open_archive(
            "snapshots", SNAPSHOT_ID, "", ["daily/"]
        )
        with pytest.raises(tree_archive.ArchiveError, match="f03.nc: HTTP 500"):
            await asyncio.wait_for(_collect(archive.stream()), timeout=2)
        assert reads.open == set() and strays() == []
        assert tree_archive._active == 0

    with caplog.at_level("WARNING"):
        asyncio.run(run())
    assert "f03.nc" in caplog.text


def test_a_failure_read_ahead_is_not_a_zip_that_looks_complete(http, bucket, reads):
    files, keys = names(4)
    seed(bucket, "snapshots", SNAPSHOT_ID, files)
    reads.truncated.add(keys[2])
    with pytest.raises(tree_archive.ArchiveError, match="f02.nc"):
        post_folder(http, "daily")


def test_an_object_of_another_size_than_listed_read_ahead_ends_the_response(
    bucket, reads
):
    files, keys = names(3)
    seed(bucket, "snapshots", SNAPSHOT_ID, files)
    prefix = f"snapshots/{SNAPSHOT_ID}/daily/"
    bucket.pages[(prefix, None)] = _xml(
        prefix, files=[(keys[0], 10), (keys[1], 4), (keys[2], 10)]
    )

    async def run():
        archive = await tree_archive.open_archive(
            "snapshots", SNAPSHOT_ID, "", ["daily/"]
        )
        with pytest.raises(
            tree_archive.ArchiveError, match="more than the 4 bytes listed"
        ):
            await _collect(archive.stream())
        assert reads.open == set() and strays() == []

    asyncio.run(run())


def test_a_client_that_leaves_cancels_what_is_in_flight(bucket, reads):
    files, keys = names(6)
    seed(bucket, "snapshots", SNAPSHOT_ID, files)

    async def run():
        reads.gates = {k: asyncio.Event() for k in keys}
        archive = await tree_archive.open_archive(
            "snapshots", SNAPSHOT_ID, "", ["daily/"]
        )
        body = asyncio.create_task(_collect(archive.stream()))
        await settle()
        assert len(reads.open) == 6
        body.cancel()  # what the server does when the connection drops
        with pytest.raises(asyncio.CancelledError):
            await body
        assert reads.open == set() and strays() == []
        assert tree_archive._active == 0

    asyncio.run(run())


def test_a_stream_closed_between_pieces_cancels_what_is_in_flight(bucket, reads):
    files, keys = names(6)
    seed(bucket, "snapshots", SNAPSHOT_ID, files)

    async def run():
        reads.gates = {k: asyncio.Event() for k in keys[1:]}  # the first is free
        archive = await tree_archive.open_archive(
            "snapshots", SNAPSHOT_ID, "", ["daily/"]
        )
        stream = archive.stream()
        await anext(stream)  # the first piece: the next objects are in flight
        await settle()
        assert len(reads.open) == 5
        await stream.aclose()
        assert reads.open == set() and strays() == []
        assert tree_archive._active == 0

    asyncio.run(run())
