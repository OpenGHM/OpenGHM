"""PATCH /jobs/{id}: what an auto-saving client relies on. The write is
conditional on the draft still being a draft; `about` merges key by key;
`parameters` cannot be null; `slurm_config` clears one field at a time; and an
edit is not audited.

(The run-start check is in tests/test_run_start.py, `slurm_config` bounds in
tests/test_job_submit.py.) Runs the route and the real auth dependencies against
the in-memory Mongo (tests/conftest.py).
"""

from __future__ import annotations

import copy

import pytest

from app.api.v1 import jobs as jobs_router

from route_helpers import make_job, make_user, token_for

OWNER = "owner"
HEADERS = token_for(OWNER)
URL = "/api/v1/jobs/job-1"


@pytest.fixture(autouse=True)
def owner(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)


@pytest.fixture
def draft(db):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    return db.jobs.docs["job-1"]


def _patch(client, **body):
    return client.patch(URL, json=body, headers=HEADERS)


# ---- only a draft is written -------------------------------------------------


@pytest.mark.parametrize("status", ["PENDING", "SUBMITTED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"])
def test_a_job_past_draft_is_a_409_with_a_code_and_is_not_written(client, db, status):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, status)
    before = copy.deepcopy(db.jobs.docs["job-1"])
    response = _patch(client, slug="renamed")
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "not_a_draft"
    assert status in detail["message"]
    assert db.jobs.docs["job-1"] == before


def test_a_submit_between_the_read_and_the_write_is_a_409_and_is_not_written(client, db, monkeypatch):
    """The route read a draft; by the write the job was submitted. The write's
    own filter refuses it, so the edit lands nowhere."""
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "SUBMITTED")
    before = copy.deepcopy(db.jobs.docs["job-1"])

    async def stale_read(job_id, user, escalated):
        return make_job("job-1", OWNER, "DRAFT")

    monkeypatch.setattr(jobs_router, "_get_job_for", stale_read)
    response = _patch(client, slug="renamed")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "not_a_draft"
    assert "SUBMITTED" in response.json()["detail"]["message"]
    assert db.jobs.docs["job-1"] == before


def test_a_delete_between_the_read_and_the_write_is_a_404(client, db, monkeypatch):
    async def stale_read(job_id, user, escalated):
        return make_job("job-1", OWNER, "DRAFT")

    monkeypatch.setattr(jobs_router, "_get_job_for", stale_read)
    response = _patch(client, slug="renamed")  # nothing stored under job-1
    assert response.status_code == 404
    assert db.jobs.docs == {}


# ---- parameters cannot be null -------------------------------------------------


def test_null_parameters_is_a_422_and_changes_nothing(client, db, draft):
    before = copy.deepcopy(draft)
    response = _patch(client, parameters=None)
    assert response.status_code == 422
    assert "parameters" in str(response.json()["detail"])
    assert db.jobs.docs["job-1"] == before


# ---- about merges key by key ---------------------------------------------------


def _stored_about(db) -> dict | None:
    return db.jobs.docs["job-1"]["about"]


def test_about_keeps_the_keys_that_are_not_sent(client, db, draft):
    draft["about"] = {
        "name": "Old name",
        "creator": [{"name": "A. Researcher"}],
        "keywords": ["runoff"],
    }
    response = _patch(client, about={"name": "New name", "description": "Why"})
    assert response.status_code == 200
    assert _stored_about(db) == {
        "name": "New name",
        "description": "Why",
        "creator": [{"name": "A. Researcher"}],
        "keywords": ["runoff"],
    }
    answered = response.json()["about"]
    assert answered["name"] == "New name" and answered["keywords"] == ["runoff"]


def test_a_null_key_removes_that_key_only(client, db, draft):
    draft["about"] = {"name": "N", "description": "D", "keywords": ["k"]}
    assert _patch(client, about={"description": None}).status_code == 200
    assert _stored_about(db) == {"name": "N", "keywords": ["k"]}


def test_a_null_key_that_was_never_stored_is_not_stored(client, db, draft):
    assert _patch(client, about={"name": "N", "description": None}).status_code == 200
    assert _stored_about(db) == {"name": "N"}


def test_removing_the_last_key_leaves_no_about(client, db, draft):
    draft["about"] = {"name": "N"}
    assert _patch(client, about={"name": None}).status_code == 200
    assert _stored_about(db) is None


def test_null_about_clears_the_whole_block(client, db, draft):
    draft["about"] = {"name": "N", "keywords": ["k"]}
    assert _patch(client, about=None).status_code == 200
    assert _stored_about(db) is None


def test_a_value_the_spec_refuses_is_still_a_422(client, db, draft):
    draft["about"] = {"name": "N"}
    assert _patch(client, about={"name": ""}).status_code == 422
    assert _patch(client, about={"nope": "x"}).status_code == 422
    assert _stored_about(db) == {"name": "N"}


def test_a_stored_about_that_no_longer_validates_is_a_422_not_a_500(client, db, draft):
    draft["about"] = {"name": "N", "a_key_the_spec_never_had": 1}
    response = _patch(client, about={"description": "D"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_about"
    assert _stored_about(db) == {"name": "N", "a_key_the_spec_never_had": 1}


# ---- slurm_config clears one field at a time ---------------------------------------


def test_null_cores_clears_cores_and_keeps_the_walltime(client, db, draft):
    assert _patch(client, slurm_config={"cores": 8, "walltime": "04:00:00"}).status_code == 200
    response = _patch(client, slurm_config={"cores": None})
    assert response.status_code == 200
    assert response.json()["slurm_config"] == {"cores": None, "walltime": "04:00:00"}
    assert db.jobs.docs["job-1"]["slurm_config"] == {"cores": None, "walltime": "04:00:00"}


def test_null_walltime_clears_the_walltime_and_keeps_the_cores(client, db, draft):
    assert _patch(client, slurm_config={"cores": 8, "walltime": "04:00:00"}).status_code == 200
    got = _patch(client, slurm_config={"walltime": None}).json()
    assert got["slurm_config"] == {"cores": 8, "walltime": None}


# ---- an edit is not an audited event ----------------------------------------------


def test_a_patch_writes_no_audit_event(client, db, draft):
    response = _patch(
        client,
        slug="renamed",
        about={"name": "N"},
        slurm_config={"cores": 4},
        parameters={
            "temporal_range_start": "2000-01-01",
            "temporal_range_end": "2000-06-30",
            "variables": ["runoff"],
        },
    )
    assert response.status_code == 200
    assert db.audit_events.docs == {}
