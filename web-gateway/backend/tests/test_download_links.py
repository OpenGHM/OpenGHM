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
from app.models.repository import build_envelope, model_input_links, snapshot_links

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
    }


def test_model_input_links_are_exact(catalogue):
    links = asyncio.run(repository_router.get_model_input_links(MODEL_INPUT_ID))
    assert links.model_dump() == {
        "id": MODEL_INPUT_ID,
        "treeUrl": f"{BASE}/openghm/model-inputs/{MODEL_INPUT_ID}/",
        "metadataUrl": f"{BASE}/openghm/model-inputs/{MODEL_INPUT_ID}/metadata.json",
        "sha256sumsUrl": f"{BASE}/openghm/model-inputs/{MODEL_INPUT_ID}/SHA256SUMS",
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
