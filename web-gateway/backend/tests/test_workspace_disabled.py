"""`WORKSPACE_ENABLED` off: a draft cannot be created, edited, run or
published, and the drafts that exist can still be read.

Runs the real routes against the fake Mongo (tests/conftest.py).
"""

from __future__ import annotations

import pytest

from app.core.config import settings
from route_helpers import make_job, make_user, token_for

OWNER = "owner"


@pytest.fixture
def headers(db, monkeypatch):
    monkeypatch.setattr(settings, "WORKSPACE_ENABLED", False)
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)
    db.jobs.docs["j1"] = make_job("j1", OWNER, "DRAFT")
    return token_for(OWNER)


@pytest.mark.parametrize(
    "method, path",
    [
        ("post", "/api/v1/jobs/derive/some-snapshot"),
        ("post", "/api/v1/jobs/j1/duplicate"),
        ("patch", "/api/v1/jobs/j1"),
        ("post", "/api/v1/jobs/j1/submit"),
        ("post", "/api/v1/jobs/j1/publish"),
    ],
)
def test_draft_changes_are_refused(client, headers, method, path):
    response = getattr(client, method)(path, headers=headers, json={})
    assert response.status_code == 403, response.text
    assert response.json()["detail"]["code"] == "workspace_disabled"


def test_existing_drafts_are_still_read(client, headers):
    assert client.get("/api/v1/jobs/j1", headers=headers).status_code == 200
    assert client.get("/api/v1/jobs", headers=headers).status_code == 200
