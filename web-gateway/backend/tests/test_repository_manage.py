"""POST /api/v1/repository/datasets needs the repository-manage permission (ADR
0031, mission 2026-10-07-the-gateway-publishes-a-draft, B1). It accepted any
caller until 2026-10-07: a person's own snapshot reaches the catalogue only
through the gateway, once the job that publishes it has proven the upload.

The real route against the fake Mongo (tests/route_helpers.py), with the spec's
own example as the body.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from route_helpers import FakeDB, token_for

from app.api.v1 import repository as repository_router
from app.core.config import settings
from app.core.roles import Role

SCHEMAS = Path(__file__).resolve().parents[3] / "schemas"
SNAPSHOT = json.loads((SCHEMAS / "snapshot-spec/examples/wbm_storage_v2.0.0.json").read_text())
MODEL_INPUT = json.loads((SCHEMAS / "model-input-spec/examples/wbm_ancillary_data_v2.0.0.json").read_text())
URL = "/api/v1/repository/datasets"


@pytest.fixture
def mongo(monkeypatch) -> FakeDB:
    fake = FakeDB()
    monkeypatch.setattr(repository_router, "get_db", lambda: fake)
    # A developer's local .env turns the X-Mock-Role bypass on; these run as production.
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "ALLOW_MOCK_AUTH", False)
    return fake


@pytest.fixture
def http(mongo) -> TestClient:
    app = FastAPI()
    app.include_router(repository_router.router, prefix="/api/v1")
    return TestClient(app)


def test_without_a_token_it_is_401_and_nothing_is_stored(http, mongo):
    r = http.post(URL, json=SNAPSHOT)
    assert r.status_code == 401
    assert mongo.datasets.docs == {}


def test_an_invalid_token_is_401(http, mongo):
    r = http.post(URL, json=SNAPSHOT, headers={"Authorization": "Bearer nonsense"})
    assert r.status_code == 401 and mongo.datasets.docs == {}


@pytest.mark.parametrize("role", [Role.GUEST, Role.USER, Role.STAFF])
def test_everyone_but_an_admin_is_403_and_nothing_is_stored(http, mongo, role):
    r = http.post(URL, json=SNAPSHOT, headers=token_for("someone", role))
    assert r.status_code == 403
    assert "repository:manage" in r.json()["detail"]
    assert mongo.datasets.docs == {}


def test_an_admin_registers_a_snapshot(http, mongo):
    r = http.post(URL, json=SNAPSHOT, headers=token_for("admin-1", Role.ADMIN))
    assert r.status_code == 201, r.text
    assert r.json()["id"] == SNAPSHOT["id"]
    envelope = mongo.datasets.docs[SNAPSHOT["id"]]
    assert envelope["document"]["id"] == SNAPSHOT["id"] and envelope["visibility"] == "public"


def test_a_second_registration_of_an_id_is_still_409(http, mongo):
    admin = token_for("admin-1", Role.ADMIN)
    assert http.post(URL, json=SNAPSHOT, headers=admin).status_code == 201
    assert http.post(URL, json=SNAPSHOT, headers=admin).status_code == 409


def test_the_gate_comes_before_the_body_is_read(http, mongo):
    # a body that is not a snapshot is 422 for an admin, 403 for a user: who may ask is decided first
    assert http.post(URL, json={}, headers=token_for("admin-1", Role.ADMIN)).status_code == 422
    assert http.post(URL, json={}, headers=token_for("u", Role.USER)).status_code == 403


def test_registering_a_model_input_is_still_admin_only(http, mongo):
    url = "/api/v1/repository/model-inputs"
    assert http.post(url, json=MODEL_INPUT).status_code == 401
    assert http.post(url, json=MODEL_INPUT, headers=token_for("u", Role.USER)).status_code == 403
    assert http.post(url, json=MODEL_INPUT, headers=token_for("admin-1", Role.ADMIN)).status_code == 201
