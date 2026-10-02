"""GET /api/v1/repository/mine — what the signed-in user published.

Runs the real route against the fake Mongo (tests/route_helpers.py), with
envelopes built from the shipped spec examples by ``build_envelope`` and the
owner and registration time set the way the future publish path will set them.
"""

from __future__ import annotations

import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from route_helpers import FakeDB, token_for

from app.api.v1 import repository as repository_router
from app.core.config import settings
from app.models.repository import OwnedModelInputItem, OwnedSnapshotItem, build_envelope

SCHEMAS = Path(__file__).resolve().parents[3] / "schemas"
T0 = datetime(2026, 9, 1, tzinfo=timezone.utc)

ME = "me"
OTHER = "someone-else"


def _example(spec: str, name: str) -> dict:
    return json.loads((SCHEMAS / spec / "examples" / name).read_text())


def _snapshot(id_: str, owner: str | None, minutes: int = 0, visibility: str = "public") -> dict:
    doc = copy.deepcopy(_example("snapshot-spec", "wbm_storage_v2.0.0.json"))
    doc["id"] = id_
    doc["slug"] = f"snapshot-{id_[0]}"
    return build_envelope(
        doc, owner_user_id=owner, visibility=visibility, registered_at=T0 + timedelta(minutes=minutes)
    )


def _model_input(id_: str, owner: str | None, minutes: int = 0, visibility: str = "public") -> dict:
    doc = copy.deepcopy(_example("model-input-spec", "wbm_ancillary_data_v2.0.0.json"))
    doc["id"] = id_
    doc["slug"] = f"input-{id_[0]}"
    return build_envelope(
        doc, owner_user_id=owner, visibility=visibility, registered_at=T0 + timedelta(minutes=minutes)
    )


@pytest.fixture
def mongo(monkeypatch) -> FakeDB:
    fake = FakeDB()
    monkeypatch.setattr(repository_router, "get_db", lambda: fake)
    # A developer's local .env turns the X-Mock-Role bypass on, which would
    # sign a header-less request in; these tests run as production.
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "ALLOW_MOCK_AUTH", False)
    return fake


@pytest.fixture
def http(mongo) -> TestClient:
    app = FastAPI()
    app.include_router(repository_router.router, prefix="/api/v1")
    return TestClient(app)


def _put(mongo: FakeDB, collection: str, *envelopes: dict) -> None:
    for envelope in envelopes:
        mongo[collection].docs[envelope["_id"]] = envelope


def _get(http: TestClient, user: str = ME):
    return http.get("/api/v1/repository/mine", headers=token_for(user))


def test_signed_out_is_401(http, mongo):
    _put(mongo, "datasets", _snapshot("a" * 64, ME))
    r = http.get("/api/v1/repository/mine")
    assert r.status_code == 401


def test_an_invalid_token_is_401(http):
    r = http.get("/api/v1/repository/mine", headers={"Authorization": "Bearer nonsense"})
    assert r.status_code == 401


def test_returns_the_callers_items_of_both_kinds_with_their_kind(http, mongo):
    _put(mongo, "datasets", _snapshot("a" * 64, ME))
    _put(mongo, "model_inputs", _model_input("b" * 64, ME))

    r = _get(http)

    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"items"}
    assert {i["id"]: i["kind"] for i in body["items"]} == {"a" * 64: "snapshot", "b" * 64: "model-input"}
    # The catalogue's item shapes: the spec document's fields, not the envelope.
    for item in body["items"]:
        assert "about" in item and "owner_user_id" not in item and "document" not in item
    snapshot = next(i for i in body["items"] if i["kind"] == "snapshot")
    assert snapshot["spatialResolutionDegrees"] > 0


def test_excludes_other_users_and_unowned_items(http, mongo):
    _put(
        mongo, "datasets",
        _snapshot("a" * 64, ME), _snapshot("c" * 64, OTHER), _snapshot("d" * 64, None),
    )
    _put(mongo, "model_inputs", _model_input("b" * 64, ME), _model_input("e" * 64, OTHER), _model_input("f" * 64, None))

    ids = [i["id"] for i in _get(http).json()["items"]]

    assert sorted(ids) == ["a" * 64, "b" * 64]
    # The other user sees theirs, and only theirs.
    assert sorted(i["id"] for i in _get(http, OTHER).json()["items"]) == ["c" * 64, "e" * 64]


def test_a_document_without_the_owner_field_is_not_anyones(http, mongo):
    legacy = _snapshot("a" * 64, ME)
    del legacy["owner_user_id"]
    _put(mongo, "datasets", legacy)

    assert _get(http).json() == {"items": []}


def test_empty_when_the_caller_owns_nothing(http, mongo):
    _put(mongo, "datasets", _snapshot("c" * 64, OTHER))
    _put(mongo, "model_inputs", _model_input("e" * 64, None))

    r = _get(http)

    assert r.status_code == 200
    assert r.json() == {"items": []}


def test_does_not_filter_on_visibility(http, mongo):
    _put(mongo, "datasets", _snapshot("a" * 64, ME, visibility="private"))

    assert [i["id"] for i in _get(http).json()["items"]] == ["a" * 64]


def test_each_item_carries_its_envelopes_visibility_and_registration_time(http, mongo):
    _put(
        mongo, "datasets",
        _snapshot("a" * 64, ME, minutes=10), _snapshot("c" * 64, ME, minutes=20, visibility="private"),
    )
    _put(mongo, "model_inputs", _model_input("b" * 64, ME, minutes=30, visibility="private"))

    items = {i["id"]: i for i in _get(http).json()["items"]}

    assert {k: v["visibility"] for k, v in items.items()} == {
        "a" * 64: "public", "c" * 64: "private", "b" * 64: "private",
    }
    assert items["a" * 64]["registeredAt"] == "2026-09-01T00:10:00Z"
    assert items["c" * 64]["registeredAt"] == "2026-09-01T00:20:00Z"
    assert items["b" * 64]["registeredAt"] == "2026-09-01T00:30:00Z"
    # Beside the spec's own fields, never inside `about` or any other block.
    assert "visibility" not in items["a" * 64]["about"]


def test_an_item_of_either_kind_keeps_the_catalogues_fields(http, mongo):
    _put(mongo, "datasets", _snapshot("a" * 64, ME))
    _put(mongo, "model_inputs", _model_input("b" * 64, ME))

    items = {i["kind"]: i for i in _get(http).json()["items"]}

    assert {"spatialResolutionDegrees", "licenseUrl", "generatedAt"} <= set(items["snapshot"])
    assert "licenseUrl" in items["model-input"] and "spatialResolutionDegrees" not in items["model-input"]


def test_visibility_is_public_or_private_and_nothing_else():
    for visibility in ("public", "private"):
        assert OwnedSnapshotItem.from_envelope(_snapshot("a" * 64, ME, visibility=visibility)).visibility == visibility
    with pytest.raises(ValidationError):
        OwnedSnapshotItem.from_envelope(_snapshot("a" * 64, ME, visibility="friends"))
    with pytest.raises(ValidationError):
        OwnedModelInputItem.from_envelope(_model_input("b" * 64, ME, visibility="friends"))


def test_ordered_by_registration_time_newest_first_across_kinds(http, mongo):
    _put(mongo, "datasets", _snapshot("a" * 64, ME, minutes=10), _snapshot("c" * 64, ME, minutes=30))
    _put(mongo, "model_inputs", _model_input("b" * 64, ME, minutes=20), _model_input("d" * 64, ME, minutes=0))

    ids = [i["id"] for i in _get(http).json()["items"]]

    assert ids == ["c" * 64, "b" * 64, "a" * 64, "d" * 64]


def test_equal_registration_times_fall_back_to_the_id(http, mongo):
    _put(mongo, "datasets", _snapshot("c" * 64, ME, minutes=5), _snapshot("a" * 64, ME, minutes=5))
    _put(mongo, "model_inputs", _model_input("b" * 64, ME, minutes=5))

    ids = [i["id"] for i in _get(http).json()["items"]]

    assert ids == ["a" * 64, "b" * 64, "c" * 64]


def test_mine_is_not_taken_for_an_id(http, mongo):
    """`/mine` sits beside `/datasets/{id}` and `/model-inputs/{id}`; no
    id-style route in the router may swallow it."""
    paths = [route.path for route in repository_router.router.routes]
    assert "/repository/mine" in paths
    assert all("{" not in p for p in paths if p.endswith("/mine"))
    assert _get(http).status_code == 200
