"""``GET /repository/datasets/{id}/links`` and
``GET /repository/model-inputs/{id}/links`` (gateway.md §5, "links, not bytes").

Same harness as test_repository.py: no Mongo and no TestClient. The real
route coroutines are called with ``get_db`` monkeypatched to a fake collection
holding an envelope built from a shipped spec example, and with the S3
settings pinned so the expected strings are exact whatever ``.env`` says.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.api.v1 import repository as repository_router
from app.services import tree_browse
from app.models.repository import OutputFolder, build_envelope, model_input_links, snapshot_links

SCHEMAS = Path(__file__).resolve().parents[3] / "schemas"
SNAPSHOT_EXAMPLE = SCHEMAS / "snapshot-spec" / "examples" / "wbm_storage_v2.0.0.json"
MODEL_INPUT_EXAMPLE = SCHEMAS / "model-input-spec" / "examples" / "wbm_ancillary_data_v2.0.0.json"

BASE = "https://s3.example.test"
BUCKET = "openghm"

SNAPSHOT_ID = "fc66a2cdeee9d456f83bc0b0a6f00cd447b0194c124a3bb4008a02990779ec89"
MODEL_INPUT_ID = "52585562109e15bd7b06fad0e6deb17d1f4fa72a38474828adac5e74c169bc5d"


class _FakeCollection:
    def __init__(self, envelope: dict) -> None:
        self._envelope = envelope

    async def find_one(self, query: dict) -> dict | None:
        return self._envelope if query == {"_id": self._envelope["_id"]} else None


class _FakeDB:
    def __init__(self, collections: dict[str, _FakeCollection]) -> None:
        self._collections = collections

    def __getitem__(self, name: str) -> _FakeCollection:
        return self._collections[name]


@pytest.fixture
def catalogue(monkeypatch: pytest.MonkeyPatch) -> None:
    snapshot = build_envelope(json.loads(SNAPSHOT_EXAMPLE.read_text()))
    model_input = build_envelope(json.loads(MODEL_INPUT_EXAMPLE.read_text()))
    db = _FakeDB({"datasets": _FakeCollection(snapshot), "model_inputs": _FakeCollection(model_input)})
    monkeypatch.setattr(repository_router, "get_db", lambda: db)
    monkeypatch.setattr(repository_router.settings, "S3_PUBLIC_BASE_URL", BASE)
    monkeypatch.setattr(repository_router.settings, "S3_BUCKET", BUCKET)
    # No network: the bucket can size no file and list no output.
    async def no_sizes(urls: list[str]) -> dict[str, int]:
        return {}

    async def no_output(snapshot_id: str) -> list:
        return []

    monkeypatch.setattr(tree_browse, "sizes", no_sizes)
    monkeypatch.setattr(tree_browse, "output_folders", no_output)


def test_snapshot_links_are_exact(catalogue):
    links = asyncio.run(repository_router.get_dataset_links(SNAPSHOT_ID))
    assert links.model_dump() == {
        "id": SNAPSHOT_ID,
        "treeUrl": f"{BASE}/openghm/snapshots/{SNAPSHOT_ID}/",
        "metadataUrl": f"{BASE}/openghm/snapshots/{SNAPSHOT_ID}/metadata.json",
        "sha256sumsUrl": f"{BASE}/openghm/snapshots/{SNAPSHOT_ID}/SHA256SUMS",
        "fetchCommand": f"openghm snapshot fetch {SNAPSHOT_ID}",
        # verbatim from the document's uses.container.https
        "containerUrl": "https://s3.anvil.rcac.purdue.edu/openghm/containers/wbm-v2-lite/2.0.0/wbm-v2-lite-2.0.0.sif",
        "modelInputId": MODEL_INPUT_ID,
        "modelInputTreeUrl": f"{BASE}/openghm/model-inputs/{MODEL_INPUT_ID}/",
        "containerSize": None,
        "output": [],
    }


def test_model_input_links_are_exact(catalogue):
    links = asyncio.run(repository_router.get_model_input_links(MODEL_INPUT_ID))
    assert links.model_dump() == {
        "id": MODEL_INPUT_ID,
        "treeUrl": f"{BASE}/openghm/model-inputs/{MODEL_INPUT_ID}/",
        "metadataUrl": f"{BASE}/openghm/model-inputs/{MODEL_INPUT_ID}/metadata.json",
        "sha256sumsUrl": f"{BASE}/openghm/model-inputs/{MODEL_INPUT_ID}/SHA256SUMS",
        "fetchCommand": f"openghm model-input fetch {MODEL_INPUT_ID}",
    }


def test_unknown_snapshot_is_404(catalogue):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(repository_router.get_dataset_links("0" * 64))
    assert exc.value.status_code == 404
    assert exc.value.detail == f"Dataset '{'0' * 64}' not found"


def test_unknown_model_input_is_404(catalogue):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(repository_router.get_model_input_links("0" * 64))
    assert exc.value.status_code == 404
    assert exc.value.detail == f"Model input '{'0' * 64}' not found"


def test_a_trailing_slash_on_the_base_url_does_not_double_up():
    doc = json.loads(MODEL_INPUT_EXAMPLE.read_text())
    a = model_input_links(doc, base_url=BASE, bucket=BUCKET)
    b = model_input_links(doc, base_url=BASE + "/", bucket=BUCKET)
    assert a == b


def test_links_are_pure_over_the_document():
    doc = json.loads(SNAPSHOT_EXAMPLE.read_text())
    links = snapshot_links(doc, base_url=BASE, bucket="other")
    assert links.treeUrl == f"{BASE}/other/snapshots/{SNAPSHOT_ID}/"
    assert links.modelInputTreeUrl == f"{BASE}/other/model-inputs/{MODEL_INPUT_ID}/"


def test_the_snapshot_route_sizes_the_container_and_sums_the_output(catalogue, monkeypatch: pytest.MonkeyPatch):
    folder = OutputFolder(run="r", name="yearly", path="wbm_output/r/yearly/", files=2, bytes=10)

    async def some_sizes(urls: list[str]) -> dict[str, int]:
        return {urls[0]: 328179712}

    async def some_output(snapshot_id: str) -> list[OutputFolder]:
        return [folder] if snapshot_id == SNAPSHOT_ID else []

    monkeypatch.setattr(tree_browse, "sizes", some_sizes)
    monkeypatch.setattr(tree_browse, "output_folders", some_output)
    links = asyncio.run(repository_router.get_dataset_links(SNAPSHOT_ID))
    assert links.containerSize == 328179712
    assert links.output == [folder]


class _FakeHead:
    """A bucket answering `HEAD`: url -> (status, Content-Length), or an
    exception to raise. Counts the requests."""

    def __init__(self, answers: dict[str, object]) -> None:
        self.answers = answers
        self.calls: list[str] = []

    async def __call__(self, url: str):
        import httpx

        self.calls.append(url)
        answer = self.answers[url]
        if isinstance(answer, Exception):
            raise answer
        status, length = answer
        return status, httpx.Headers({} if length is None else {"Content-Length": str(length)})


@pytest.fixture
def head(monkeypatch: pytest.MonkeyPatch):
    import httpx

    tree_browse.reset()
    fake = _FakeHead({
        "https://b/a": (200, 8570),
        "https://b/missing": (404, 0),
        "https://b/down": httpx.ConnectTimeout("slow"),
        "https://b/no-length": (200, None),
    })
    monkeypatch.setattr(tree_browse, "_head", fake)
    yield fake
    tree_browse.reset()


def test_sizes_leave_out_what_the_bucket_cannot_size(head):
    urls = ["https://b/a", "https://b/missing", "https://b/down", "https://b/no-length"]
    assert asyncio.run(tree_browse.sizes(urls)) == {"https://b/a": 8570}


def test_a_size_is_kept_and_a_failure_is_asked_again(head):
    asyncio.run(tree_browse.sizes(["https://b/a", "https://b/down"]))
    asyncio.run(tree_browse.sizes(["https://b/a", "https://b/down"]))
    assert head.calls.count("https://b/a") == 1
    assert head.calls.count("https://b/down") == 2


def _listing(keys: list[tuple[str, int]], token: str | None = None) -> str:
    contents = "".join(f"<Contents><Key>{k}</Key><Size>{n}</Size></Contents>" for k, n in keys)
    more = f"<IsTruncated>true</IsTruncated><NextContinuationToken>{token}</NextContinuationToken>" if token else (
        "<IsTruncated>false</IsTruncated>"
    )
    return f'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">{contents}{more}</ListBucketResult>'


class _FakeList:
    """A bucket answering ListObjectsV2 pages by continuation token."""

    def __init__(self, pages: dict[str | None, str]) -> None:
        self.pages = pages
        self.calls = 0

    async def __call__(self, url: str, *, params: dict[str, str]):
        import httpx

        self.calls += 1
        body = self.pages[params.get("continuation-token")]
        return httpx.Response(200, text=body, request=httpx.Request("GET", url))


@pytest.fixture
def bucket(monkeypatch: pytest.MonkeyPatch):
    tree_browse.reset()
    monkeypatch.setattr(tree_browse.settings, "S3_PUBLIC_BASE_URL", BASE)
    monkeypatch.setattr(tree_browse.settings, "S3_BUCKET", BUCKET)
    yield
    tree_browse.reset()


def test_output_folders_sum_each_folder_across_pages(bucket, monkeypatch: pytest.MonkeyPatch):
    out = f"snapshots/{SNAPSHOT_ID}/wbm_output/"
    fake = _FakeList({
        None: _listing([(f"{out}G/G.MT.csv", 5), (f"{out}G/daily/wbm_2000.nc", 100), (f"{out}G/yearly/q/wbm_2000.nc", 3)], "t1"),
        "t1": _listing([(f"{out}G/yearly/q/wbm_2001.nc", 4), (f"{out}G/yearly/", 0)]),
    })
    monkeypatch.setattr(tree_browse, "_get", fake)
    folders = asyncio.run(tree_browse.output_folders(SNAPSHOT_ID))
    assert [f.model_dump() for f in folders] == [
        {"run": "G", "name": "daily", "path": "wbm_output/G/daily/", "files": 1, "bytes": 100},
        {"run": "G", "name": "yearly", "path": "wbm_output/G/yearly/", "files": 2, "bytes": 7},
    ]
    asyncio.run(tree_browse.output_folders(SNAPSHOT_ID))
    assert fake.calls == 2  # kept


def test_output_folders_give_up_on_a_huge_or_unreadable_output(bucket, monkeypatch: pytest.MonkeyPatch):
    out = f"snapshots/{SNAPSHOT_ID}/wbm_output/"
    endless = _FakeList({None: _listing([(f"{out}G/daily/a.nc", 1)], "t"), "t": _listing([(f"{out}G/daily/b.nc", 1)], "t")})
    monkeypatch.setattr(tree_browse, "_get", endless)
    monkeypatch.setattr(tree_browse, "_OUTPUT_MAX_PAGES", 3)
    assert asyncio.run(tree_browse.output_folders(SNAPSHOT_ID)) == []

    async def down(url: str, *, params: dict[str, str]):
        raise OSError("unreachable")

    monkeypatch.setattr(tree_browse, "_get", down)
    assert asyncio.run(tree_browse.output_folders("f" * 64)) == []
