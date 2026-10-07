"""Browsing a published tree (mission 2026-10-07-a-published-tree-can-be-browsed):
path validation, one listing page of one folder, the bounded cache, one file's
preview (`app.services.tree_browse`), and the four routes
(`GET /repository/{datasets,model-inputs}/{id}/files[/preview]`).

No network: `tree_browse._get` and `_get_head` are replaced by a fake bucket
that answers `ListObjectsV2` pages and ranged `GET`s.
"""

from __future__ import annotations

import asyncio
from urllib.parse import quote, unquote

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import repository as repository_router
from app.core.config import settings
from app.services import tree_browse
from app.services.tree_browse import (
    InvalidPath,
    ListingUnavailable,
    PathNotFound,
    PreviewUnavailable,
    validate_path,
)

from route_helpers import FakeDB

SNAPSHOT_ID = "fc66a2cdeee9d456f83bc0b0a6f00cd447b0194c124a3bb4008a02990779ec89"
MODEL_INPUT_ID = "52585562109e15bd7b06fad0e6deb17d1f4fa72a38474828adac5e74c169bc5d"
ROOT = f"snapshots/{SNAPSHOT_ID}/"
BASE = "https://s3.example.test"
BUCKET = "openghm"
STAMP = "2026-09-28T18:00:17.851Z"


def _xml(prefix, folders=(), files=(), *, token=None):
    """A `ListObjectsV2` answer: `files` are (key, size), `folders` prefixes."""
    contents = "".join(
        f"<Contents><Key>{k}</Key><LastModified>{STAMP}</LastModified>"
        f"<ETag>&quot;x&quot;</ETag><Size>{size}</Size><StorageClass>STANDARD</StorageClass></Contents>"
        for k, size in files
    )
    common = "".join(f"<CommonPrefixes><Prefix>{p}</Prefix></CommonPrefixes>" for p in folders)
    more = (
        f"<IsTruncated>true</IsTruncated><NextContinuationToken>{token}</NextContinuationToken>"
        if token
        else "<IsTruncated>false</IsTruncated>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
        f"<Name>openghm</Name><Prefix>{prefix}</Prefix><Delimiter>/</Delimiter>"
        f"<MaxKeys>1000</MaxKeys>{more}{contents}{common}</ListBucketResult>"
    )


class Bucket:
    """The public bucket as the two network calls see it. `pages` maps
    (prefix, continuation token) to an answer: XML text, or an `int` for an
    HTTP error status. `objects` maps a key to its bytes, for the preview.
    `calls` is every request made."""

    def __init__(self):
        self.pages: dict[tuple[str, str | None], str | int] = {}
        self.objects: dict[str, bytes] = {}
        self.calls: list[tuple] = []
        self.fail: Exception | None = None

    async def get(self, url, *, params):
        self.calls.append(("list", url, dict(params)))
        if self.fail:
            raise self.fail
        answer = self.pages.get((params["prefix"], params.get("continuation-token")), 404)
        request = httpx.Request("GET", url)
        if isinstance(answer, int):
            return httpx.Response(answer, request=request)
        return httpx.Response(200, text=answer, request=request)

    async def get_head(self, url, *, headers):
        self.calls.append(("preview", url, dict(headers)))
        if self.fail:
            raise self.fail
        key = unquote(httpx.URL(url).path.removeprefix(f"/{BUCKET}/"))
        data = self.objects.get(key)
        if data is None:
            return 404, httpx.Headers(), b""
        limit = tree_browse.PREVIEW_BYTES
        if not data:
            return 416, httpx.Headers({"Content-Range": "bytes */0"}), b""
        head = data[:limit]
        return (
            206,
            httpx.Headers({"Content-Range": f"bytes 0-{len(head) - 1}/{len(data)}"}),
            head,
        )


@pytest.fixture(autouse=True)
def bucket(monkeypatch) -> Bucket:
    fake = Bucket()
    monkeypatch.setattr(tree_browse, "_get", fake.get)
    monkeypatch.setattr(tree_browse, "_get_head", fake.get_head)
    monkeypatch.setattr(settings, "S3_PUBLIC_BASE_URL", BASE)
    monkeypatch.setattr(settings, "S3_BUCKET", BUCKET)
    tree_browse.reset()
    yield fake
    tree_browse.reset()


def list_folder(path="", cursor=None, kind="snapshots", artifact_id=SNAPSHOT_ID):
    return asyncio.run(tree_browse.list_folder(kind, artifact_id, validate_path(path), cursor))


def preview(path, kind="snapshots", artifact_id=SNAPSHOT_ID):
    return asyncio.run(tree_browse.preview(kind, artifact_id, validate_path(path, file=True)))


# ---- paths --------------------------------------------------------------------


@pytest.mark.parametrize(
    "path,expected",
    [("", ""), ("wbm_init", "wbm_init/"), ("wbm_init/", "wbm_init/"), ("a/b c/d", "a/b c/d/")],
)
def test_a_folder_path_gets_its_trailing_slash(path, expected):
    assert validate_path(path) == expected


@pytest.mark.parametrize(
    "path",
    ["/", "/a", "a//b", "//", ".", "..", "a/./b", "a/../b", "../a", "a/..", "a\\b", "a\nb", "a\x00b", "a\x7fb", "x" * 1000],
)
def test_a_bad_folder_path_is_invalid(path):
    with pytest.raises(InvalidPath):
        validate_path(path)


def test_a_file_path_is_kept_as_it_is():
    assert validate_path("wbm_init/wbm_test.init", file=True) == "wbm_init/wbm_test.init"


@pytest.mark.parametrize("path", ["", "a/", "/a", "a//b", "..", "a/../b", "a\\b", "a\tb"])
def test_a_bad_file_path_is_invalid(path):
    with pytest.raises(InvalidPath):
        validate_path(path, file=True)


# ---- one listing page ---------------------------------------------------------


def seed_root(bucket):
    bucket.pages[(ROOT, None)] = _xml(
        ROOT,
        folders=[f"{ROOT}wbm_output/", f"{ROOT}model/", f"{ROOT}wbm_init/"],
        files=[(f"{ROOT}metadata.json", 9000), (f"{ROOT}SHA256SUMS", 400)],
    )


def test_the_root_lists_folders_then_files_sorted_by_name(bucket):
    seed_root(bucket)
    page = list_folder()
    assert page.id == SNAPSHOT_ID and page.path == ""
    assert [f.name for f in page.folders] == ["model", "wbm_init", "wbm_output"]
    assert [f.path for f in page.folders] == ["model/", "wbm_init/", "wbm_output/"]
    assert [f.name for f in page.files] == ["SHA256SUMS", "metadata.json"]
    meta = page.files[1]
    assert meta.path == "metadata.json"
    assert meta.size == 9000 and meta.lastModified == STAMP
    assert meta.url == f"{BASE}/{BUCKET}/{ROOT}metadata.json"
    assert page.nextCursor is None


def test_a_listing_asks_for_one_page_of_one_folder(bucket):
    seed_root(bucket)
    list_folder()
    ((_, url, params),) = bucket.calls
    assert url == f"{BASE}/{BUCKET}"
    assert params == {"list-type": "2", "delimiter": "/", "max-keys": "1000", "prefix": ROOT}


def test_the_root_prefix_element_is_not_a_folder(bucket):
    # `<Prefix>` of the answer is the listed prefix; only `CommonPrefixes` are folders.
    seed_root(bucket)
    assert all(f.path != "" for f in list_folder().folders)


def test_a_subfolder_has_names_relative_to_it_and_paths_to_the_root(bucket):
    prefix = f"{ROOT}wbm_output/WBM_test/"
    bucket.pages[(prefix, None)] = _xml(
        prefix,
        folders=[f"{prefix}daily/"],
        files=[(f"{prefix}wbm_test.log", 114652)],
    )
    page = list_folder("wbm_output/WBM_test")  # no trailing slash
    assert page.path == "wbm_output/WBM_test/"
    assert [(f.name, f.path) for f in page.folders] == [("daily", "wbm_output/WBM_test/daily/")]
    assert [(f.name, f.path) for f in page.files] == [
        ("wbm_test.log", "wbm_output/WBM_test/wbm_test.log")
    ]
    assert bucket.calls[0][2]["prefix"] == prefix


def test_a_trailing_slash_asks_the_same_page_as_none(bucket):
    prefix = f"{ROOT}wbm_init/"
    bucket.pages[(prefix, None)] = _xml(prefix, files=[(f"{prefix}wbm_test.init", 1858)])
    assert list_folder("wbm_init") == list_folder("wbm_init/")
    assert len(bucket.calls) == 1  # the second read came from the cache


def test_a_zero_byte_folder_marker_is_skipped(bucket):
    prefix = f"{ROOT}wbm_init/"
    bucket.pages[(prefix, None)] = _xml(
        prefix, files=[(prefix, 0), (f"{prefix}wbm_test.init", 1858)]
    )
    assert [f.name for f in list_folder("wbm_init").files] == ["wbm_test.init"]


def test_a_folder_holding_only_its_marker_is_not_found(bucket):
    prefix = f"{ROOT}empty/"
    bucket.pages[(prefix, None)] = _xml(prefix, files=[(prefix, 0)])
    with pytest.raises(PathNotFound):
        list_folder("empty")


def test_a_key_with_a_space_is_quoted_in_its_url(bucket):
    prefix = f"{ROOT}a b/"
    bucket.pages[(prefix, None)] = _xml(prefix, files=[(f"{prefix}c d.txt", 1)])
    (file,) = list_folder("a b").files
    assert file.name == "c d.txt"
    assert file.url == f"{BASE}/{BUCKET}/{quote(f'{prefix}c d.txt')}"


@pytest.mark.parametrize(
    "name,expected",
    [
        ("wbm_2000.nc", False), ("a.NC4", False), ("a.tif", False), ("a.tiff", False),
        ("a.dat", False), ("a.gz", False), ("a.tar.gz", False), ("a.tgz", False),
        ("a.zip", False), ("a.tar", False), ("a.sif", False), ("a.bin", False),
        ("a.PNG", False), ("a.jpg", False), ("a.jpeg", False), ("a.gif", False),
        ("a.h5", False), ("a.hdf", False), ("a.shp", False), ("a.shx", False),
        ("a.dbf", False), ("a.npy", False), ("a.pkl", False),
        ("wbm_test.init", True), ("metadata.json", True), ("SHA256SUMS", True),
        ("wbm_test.log", True), ("a.csv", True), ("README", True), ("nc", True),
    ],
)
def test_previewable_follows_the_extension(bucket, name, expected):
    bucket.pages[(ROOT, None)] = _xml(ROOT, files=[(f"{ROOT}{name}", 1)])
    assert list_folder().files[0].previewable is expected


# ---- paging ---------------------------------------------------------------------


def test_the_cursor_is_passed_through_and_next_cursor_comes_back(bucket):
    prefix = f"{ROOT}model/"
    bucket.pages[(prefix, None)] = _xml(prefix, files=[(f"{prefix}a", 1)], token="tok/1+x=")
    bucket.pages[(prefix, "tok/1+x=")] = _xml(prefix, files=[(f"{prefix}b", 2)])
    first = list_folder("model")
    assert first.nextCursor == "tok/1+x="
    second = list_folder("model", first.nextCursor)
    assert [f.name for f in second.files] == ["b"] and second.nextCursor is None
    assert bucket.calls[1][2]["continuation-token"] == "tok/1+x="
    assert "continuation-token" not in bucket.calls[0][2]


def test_a_blank_cursor_is_no_cursor(bucket):
    seed_root(bucket)
    list_folder(cursor="")
    assert "continuation-token" not in bucket.calls[0][2]


def test_a_truncated_page_without_a_token_is_unavailable(bucket):
    bucket.pages[(ROOT, None)] = _xml(ROOT, files=[(f"{ROOT}a", 1)]).replace(
        "<IsTruncated>false", "<IsTruncated>true"
    )
    with pytest.raises(ListingUnavailable):
        list_folder()


# ---- errors ---------------------------------------------------------------------


def test_a_non_root_folder_with_nothing_is_not_found(bucket):
    prefix = f"{ROOT}nope/"
    bucket.pages[(prefix, None)] = _xml(prefix)
    with pytest.raises(PathNotFound):
        list_folder("nope")


def test_an_empty_root_is_an_empty_page_not_an_error_and_not_kept(bucket):
    bucket.pages[(ROOT, None)] = _xml(ROOT)
    page = list_folder()
    assert page.folders == [] and page.files == [] and page.nextCursor is None
    list_folder()
    assert len(bucket.calls) == 2


@pytest.mark.parametrize("answer", [500, 403, 404, "<not xml", ""])
def test_a_bucket_that_fails_is_unavailable(bucket, answer):
    bucket.pages[(ROOT, None)] = answer
    with pytest.raises(ListingUnavailable):
        list_folder()


def test_a_network_error_is_unavailable(bucket):
    bucket.fail = httpx.ConnectError("down")
    with pytest.raises(ListingUnavailable):
        list_folder()


def test_a_failure_is_not_kept(bucket):
    bucket.pages[(ROOT, None)] = 500
    with pytest.raises(ListingUnavailable):
        list_folder()
    seed_root(bucket)
    assert list_folder().files


# ---- the cache -------------------------------------------------------------------


def test_a_page_is_read_once_per_prefix_and_cursor(bucket):
    seed_root(bucket)
    assert list_folder() == list_folder()
    assert len(bucket.calls) == 1


def test_the_cache_is_per_prefix(bucket):
    seed_root(bucket)
    other = f"model-inputs/{MODEL_INPUT_ID}/"
    bucket.pages[(other, None)] = _xml(other, files=[(f"{other}metadata.json", 1)])
    list_folder()
    page = list_folder(kind="model-inputs", artifact_id=MODEL_INPUT_ID)
    assert page.id == MODEL_INPUT_ID and len(bucket.calls) == 2
    assert bucket.calls[1][2]["prefix"] == other


def test_the_cache_is_bounded_and_drops_the_least_recently_used(bucket, monkeypatch):
    monkeypatch.setattr(tree_browse, "_CACHE_SIZE", 2)
    for name in "abc":
        prefix = f"{ROOT}{name}/"
        bucket.pages[(prefix, None)] = _xml(prefix, files=[(f"{prefix}f", 1)])
    list_folder("a")
    list_folder("b")
    list_folder("a")  # a is now the most recent
    list_folder("c")  # b goes
    assert len(tree_browse._pages) == 2
    n = len(bucket.calls)
    list_folder("a")
    assert len(bucket.calls) == n
    list_folder("b")
    assert len(bucket.calls) == n + 1


# ---- preview ----------------------------------------------------------------------


def test_a_text_file_is_returned_whole(bucket):
    bucket.objects[f"{ROOT}wbm_init/wbm_test.init"] = b"[run]\nname = test\n"
    result = preview("wbm_init/wbm_test.init")
    assert result.model_dump() == {
        "path": "wbm_init/wbm_test.init",
        "size": 18,
        "kind": "text",
        "text": "[run]\nname = test\n",
        "truncated": False,
    }
    ((_, url, headers),) = bucket.calls
    assert url == f"{BASE}/{BUCKET}/{ROOT}wbm_init/wbm_test.init"
    assert headers == {"Range": "bytes=0-262143"}


def test_a_large_text_file_is_cut_with_its_whole_size(bucket):
    bucket.objects[f"{ROOT}big.log"] = b"x" * (tree_browse.PREVIEW_BYTES + 5000)
    result = preview("big.log")
    assert result.kind == "text" and result.truncated is True
    assert result.size == tree_browse.PREVIEW_BYTES + 5000
    assert len(result.text) == tree_browse.PREVIEW_BYTES


def test_a_file_of_exactly_the_preview_size_is_not_truncated(bucket):
    bucket.objects[f"{ROOT}edge.txt"] = b"y" * tree_browse.PREVIEW_BYTES
    result = preview("edge.txt")
    assert result.truncated is False and result.size == tree_browse.PREVIEW_BYTES


def test_a_nul_byte_makes_a_file_binary(bucket):
    bucket.objects[f"{ROOT}a.dat"] = b"CDF\x01\x00\x00abc"
    result = preview("a.dat")
    assert result.kind == "binary" and result.text is None and result.size == 9


def test_bytes_that_are_not_utf8_are_binary(bucket):
    bucket.objects[f"{ROOT}latin1.txt"] = "caf\xe9 ok".encode("latin-1")
    assert preview("latin1.txt").kind == "binary"


def test_multibyte_text_is_text(bucket):
    bucket.objects[f"{ROOT}u.txt"] = "café 水 \U0001f4a7".encode()
    result = preview("u.txt")
    assert result.kind == "text" and result.text == "café 水 \U0001f4a7"


@pytest.mark.parametrize("cut", [1, 2, 3])
def test_a_character_cut_at_the_end_of_a_truncated_range_is_still_text(bucket, cut):
    # The range ends inside a four-byte emoji, `cut` bytes into it.
    head = b"a" * (tree_browse.PREVIEW_BYTES - cut)
    emoji = "\U0001f4a7".encode()
    bucket.objects[f"{ROOT}cut.txt"] = head + emoji + b"tail"
    result = preview("cut.txt")
    assert result.truncated is True and result.kind == "text"
    assert result.text == "a" * (tree_browse.PREVIEW_BYTES - cut)


def test_a_cut_character_in_a_whole_file_is_binary(bucket):
    bucket.objects[f"{ROOT}broken.txt"] = b"abc" + "\U0001f4a7".encode()[:2]
    assert preview("broken.txt").kind == "binary"


def test_an_invalid_byte_before_the_end_of_a_truncated_range_is_binary(bucket):
    bucket.objects[f"{ROOT}bad.txt"] = b"abc\xffdef" + b"z" * tree_browse.PREVIEW_BYTES
    assert preview("bad.txt").kind == "binary"


def test_an_empty_file_is_empty_text(bucket):
    bucket.objects[f"{ROOT}empty.txt"] = b""  # the bucket answers 416, `bytes */0`
    result = preview("empty.txt")
    assert (result.size, result.kind, result.text, result.truncated) == (0, "text", "", False)


@pytest.mark.parametrize(
    "header,size",
    [("bytes 0-9/10", 10), ("bytes 0-262143/700000000", 700000000), ("bytes */0", 0)],
)
def test_the_size_comes_from_content_range(header, size):
    assert tree_browse._size_of(206, httpx.Headers({"Content-Range": header}), b"") == size


@pytest.mark.parametrize("header", ["", "bytes 0-9/*", "items 0-9/10", "bytes 0-9/x"])
def test_an_unusable_content_range_is_an_error(header):
    with pytest.raises(ValueError):
        tree_browse._size_of(206, httpx.Headers({"Content-Range": header} if header else {}), b"")


def test_a_200_takes_the_body_length_as_the_size():
    assert tree_browse._size_of(200, httpx.Headers(), b"hello") == 5


def test_a_200_cut_at_the_preview_size_takes_content_length():
    data = b"x" * tree_browse.PREVIEW_BYTES
    assert tree_browse._size_of(200, httpx.Headers({"Content-Length": "999999"}), data) == 999999


def test_a_missing_object_is_not_found():
    with pytest.raises(PathNotFound):
        preview("nope.txt")


@pytest.mark.parametrize("status", [403, 500, 503, 302, 400])
def test_another_status_is_unavailable(monkeypatch, status):
    async def answer(url, *, headers):
        return status, httpx.Headers(), b""

    monkeypatch.setattr(tree_browse, "_get_head", answer)
    with pytest.raises(PreviewUnavailable):
        preview("a.txt")


def test_a_206_without_a_content_range_is_unavailable(monkeypatch):
    async def answer(url, *, headers):
        return 206, httpx.Headers(), b"abc"

    monkeypatch.setattr(tree_browse, "_get_head", answer)
    with pytest.raises(PreviewUnavailable):
        preview("a.txt")


def test_a_network_error_on_preview_is_unavailable(bucket):
    bucket.fail = httpx.ReadTimeout("slow")
    with pytest.raises(PreviewUnavailable):
        preview("a.txt")


def test_a_preview_is_not_cached(bucket):
    bucket.objects[f"{ROOT}a.txt"] = b"hi"
    preview("a.txt")
    preview("a.txt")
    assert len(bucket.calls) == 2


def test_a_key_with_a_space_is_quoted_in_the_preview_request(bucket):
    bucket.objects[f"{ROOT}a b.txt"] = b"hi"
    assert preview("a b.txt").text == "hi"
    assert bucket.calls[0][1] == f"{BASE}/{BUCKET}/{quote(f'{ROOT}a b.txt')}"


# ---- the routes -------------------------------------------------------------------


@pytest.fixture
def mongo(monkeypatch) -> FakeDB:
    fake = FakeDB()
    monkeypatch.setattr(repository_router, "get_db", lambda: fake)
    fake.datasets.docs[SNAPSHOT_ID] = {"_id": SNAPSHOT_ID, "document": {"id": SNAPSHOT_ID}}
    fake.model_inputs.docs[MODEL_INPUT_ID] = {"_id": MODEL_INPUT_ID, "document": {"id": MODEL_INPUT_ID}}
    return fake


@pytest.fixture
def http(mongo) -> TestClient:
    app = FastAPI()
    app.include_router(repository_router.router, prefix="/api/v1")
    return TestClient(app)


KINDS = [
    pytest.param("datasets", SNAPSHOT_ID, "snapshots", id="snapshot"),
    pytest.param("model-inputs", MODEL_INPUT_ID, "model-inputs", id="model-input"),
]


def files_url(group, artifact_id):
    return f"/api/v1/repository/{group}/{artifact_id}/files"


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_files_route_answers_the_planned_shape(http, bucket, group, artifact_id, kind):
    root = f"{kind}/{artifact_id}/"
    bucket.pages[(root, None)] = _xml(
        root, folders=[f"{root}daily/"], files=[(f"{root}metadata.json", 12)], token="next"
    )
    response = http.get(files_url(group, artifact_id))
    assert response.status_code == 200
    assert response.json() == {
        "id": artifact_id,
        "path": "",
        "folders": [{"name": "daily", "path": "daily/"}],
        "files": [
            {
                "name": "metadata.json",
                "path": "metadata.json",
                "size": 12,
                "lastModified": STAMP,
                "url": f"{BASE}/{BUCKET}/{root}metadata.json",
                "previewable": True,
            }
        ],
        "nextCursor": "next",
    }


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_files_route_passes_path_and_cursor(http, bucket, group, artifact_id, kind):
    prefix = f"{kind}/{artifact_id}/daily/"
    bucket.pages[(prefix, "tok+/=")] = _xml(prefix, files=[(f"{prefix}wbm_2000.nc", 5)])
    response = http.get(files_url(group, artifact_id), params={"path": "daily", "cursor": "tok+/="})
    assert response.status_code == 200
    body = response.json()
    assert body["path"] == "daily/" and body["files"][0]["previewable"] is False
    assert bucket.calls[0][2]["continuation-token"] == "tok+/="


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
@pytest.mark.parametrize("path", ["/etc", "a/../b", "a//b", "a\\b", "..", "."])
def test_files_route_rejects_a_bad_path_with_422(http, bucket, group, artifact_id, kind, path):
    response = http.get(files_url(group, artifact_id), params={"path": path})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_path"
    assert bucket.calls == []


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_files_route_404_for_an_empty_folder(http, bucket, group, artifact_id, kind):
    prefix = f"{kind}/{artifact_id}/nope/"
    bucket.pages[(prefix, None)] = _xml(prefix)
    response = http.get(files_url(group, artifact_id), params={"path": "nope"})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "path_not_found"


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_files_route_503_when_the_bucket_cannot_be_listed(http, bucket, group, artifact_id, kind):
    bucket.fail = httpx.ConnectError("down")
    response = http.get(files_url(group, artifact_id))
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "listing_unavailable"


@pytest.mark.parametrize("group", ["datasets", "model-inputs"])
def test_files_route_404_for_an_unknown_id(http, bucket, group):
    response = http.get(files_url(group, "unknown"))
    assert response.status_code == 404
    assert isinstance(response.json()["detail"], str)  # as the detail route's
    assert bucket.calls == []


def test_a_snapshot_id_is_not_a_model_input_id(http, bucket):
    assert http.get(files_url("model-inputs", SNAPSHOT_ID)).status_code == 404
    assert http.get(files_url("datasets", MODEL_INPUT_ID)).status_code == 404


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_preview_route_answers_the_planned_shape(http, bucket, group, artifact_id, kind):
    bucket.objects[f"{kind}/{artifact_id}/wbm_init/wbm_test.init"] = b"abc\n"
    response = http.get(
        files_url(group, artifact_id) + "/preview", params={"path": "wbm_init/wbm_test.init"}
    )
    assert response.status_code == 200
    assert response.json() == {
        "path": "wbm_init/wbm_test.init",
        "size": 4,
        "kind": "text",
        "text": "abc\n",
        "truncated": False,
    }


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_preview_route_of_a_binary_file(http, bucket, group, artifact_id, kind):
    bucket.objects[f"{kind}/{artifact_id}/a.nc"] = b"\x89HDF\x00\x00"
    body = http.get(files_url(group, artifact_id) + "/preview", params={"path": "a.nc"}).json()
    assert body["kind"] == "binary" and body["text"] is None and body["size"] == 6


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
@pytest.mark.parametrize("path", ["", "a/", "/a", "a/../b", "a\\b"])
def test_preview_route_rejects_a_bad_path_with_422(http, bucket, group, artifact_id, kind, path):
    response = http.get(files_url(group, artifact_id) + "/preview", params={"path": path})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_path"
    assert bucket.calls == []


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_preview_route_needs_a_path(http, group, artifact_id, kind):
    assert http.get(files_url(group, artifact_id) + "/preview").status_code == 422


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_preview_route_404_for_a_missing_object(http, bucket, group, artifact_id, kind):
    response = http.get(files_url(group, artifact_id) + "/preview", params={"path": "nope.txt"})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "path_not_found"


@pytest.mark.parametrize("group,artifact_id,kind", KINDS)
def test_preview_route_503_when_the_bucket_cannot_be_read(http, bucket, group, artifact_id, kind):
    bucket.fail = httpx.ConnectError("down")
    response = http.get(files_url(group, artifact_id) + "/preview", params={"path": "a.txt"})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "preview_unavailable"


@pytest.mark.parametrize("group", ["datasets", "model-inputs"])
def test_preview_route_404_for_an_unknown_id(http, bucket, group):
    response = http.get(files_url(group, "unknown") + "/preview", params={"path": "a.txt"})
    assert response.status_code == 404
    assert bucket.calls == []


def test_the_routes_need_no_session(http, bucket):
    seed_root(bucket)
    assert http.get(files_url("datasets", SNAPSHOT_ID)).status_code == 200  # no Authorization header
