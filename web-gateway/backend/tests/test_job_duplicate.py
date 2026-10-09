"""POST /jobs/{id}/duplicate: a new draft that starts from one of the caller's
own snapshot drafts. The copy takes the settings and nothing of the run that was;
the source is untouched; a snapshot that left the repository refuses.

Runs the route and the real auth dependencies against the in-memory Mongo
(tests/conftest.py).
"""

from __future__ import annotations

import copy

import pytest

from app.api.v1.jobs import _new_draft_document
from app.models.job import JobParameters, SlurmConfig
from app.models.user import TokenPayload

from route_helpers import NOW, make_job, make_sent_job, make_user, token_for

OWNER = "owner"
HEADERS = token_for(OWNER)
DUPLICATE = "/api/v1/jobs/job-1/duplicate"

#: Everything about a run that a copy must not carry (plan: "A duplicate must
#: NOT copy"), set on the source so a copy that took one shows it.
RUN_FACTS = {
    "status_reason": "Cancelled by someone",
    "output_s3_key": "outputs/sim-job-1",
    "toolkit": {"home": "/home/x-openghm/apps/openghm/abc1234", "commit": "abc1234"},
    "work_dir": "/anvil/scratch/x-openghm/simulations/sim-job-1",
    "last_submit_error": {"code": "anvil_unreachable", "message": "down", "at": NOW},
    "slurm_state": "COMPLETED",
    "slurm_exit_code": "0:0",
    "slurm_start": NOW,
    "slurm_end": NOW,
    "failure": {"cause": "wbm_error", "phase": "run", "message": "m", "excerpt": "e"},
    "outcome": {"ok": True, "output": {"nc_count": 1, "total_bytes": 1}},
    "cancel_requested_at": NOW,
    "cancel_requested_by": "staff",
    "cancel_requested_by_email": "staff@example.org",
    "missing_since": NOW,
    "files": "present",
    "files_checked_at": NOW,
    "wbm_log_path": "wbm_output/sim-job-1/wbm_test.log",
    "orphan_sim_ids": ["sim-20260930-aaaaaa"],
    "started_at": NOW,
    "completed_at": NOW,
}

#: The settings a copy does take. (`model_input_id` is not one: an override the
#: source still carries is left behind, test below.)
SETTINGS = {
    "slug": "my-run",
    "about": {"name": "River basin", "description": "d", "keywords": ["a", "b"]},
    "parameters": {
        "temporal_range_start": "2000-02-01",
        "temporal_range_end": "2000-11-30",
        "variables": ["discharge"],
        "spatial_domain": {"north": 50.0, "south": 30.0, "east": -70.0, "west": -120.0},
        "custom_params": {"k": "v"},
    },
    "slurm_config": {"cores": 4, "walltime": "01:30:00"},
}


@pytest.fixture(autouse=True)
def owner(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)


@pytest.fixture
def source(db):
    """A finished job with everything a run leaves behind."""
    db.jobs.docs["job-1"] = make_sent_job(
        "job-1", OWNER, "COMPLETED", **copy.deepcopy(SETTINGS), **RUN_FACTS
    )
    return db.jobs.docs["job-1"]


def _set(block: dict | None) -> dict | None:
    """The keys of a response's `about` that hold a value (the response lists
    every key of the spec block, unset ones as null)."""
    return None if block is None else {k: v for k, v in block.items() if v is not None}


def _copies(db) -> list[dict]:
    return [d for d in db.jobs.docs.values() if d["_id"] != "job-1"]


def test_a_copy_is_a_201_with_the_sources_settings(client, db, source):
    response = client.post(DUPLICATE, headers=HEADERS)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["id"] != "job-1"
    assert body["status"] == "DRAFT"
    assert body["sim_id"] == ""
    assert body["user_id"] == OWNER
    assert body["dataset_id"] == "ds-1" and body["dataset_title"] == "Dataset one"
    assert body["slug"] == "my-run"
    assert _set(body["about"]) == {"name": "River basin (copy)", "description": "d", "keywords": ["a", "b"]}
    assert body["model_input_id"] is None
    assert body["parameters"] == {**SETTINGS["parameters"], "post_processing": None}
    assert body["slurm_config"] == SETTINGS["slurm_config"]
    assert body["updated_at"] == body["created_at"]
    assert body["slurm_job_id"] is None and body["failure"] is None and body["files"] is None
    assert body["completed_at"] is None and body["last_submit_error"] is None


def test_a_copy_does_not_take_a_model_input_override(client, db, source):
    """Choosing a model input is hidden (user decision 2026-10-06): a legacy
    source that overrides one is copied without it."""
    source["model_input_id"] = "mi-1"
    response = client.post(DUPLICATE, headers=HEADERS)
    assert response.status_code == 201, response.text
    assert response.json()["model_input_id"] is None
    (stored,) = _copies(db)
    assert stored["model_input_id"] is None
    assert source["model_input_id"] == "mi-1"


def test_the_stored_copy_carries_none_of_the_run(client, db, source):
    assert client.post(DUPLICATE, headers=HEADERS).status_code == 201
    (stored,) = _copies(db)
    assert "sim_id" not in stored
    fresh = _new_draft_document(
        job_id=stored["_id"],
        dataset_id="ds-1",
        dataset_title="Dataset one",
        parameters=JobParameters.model_validate(SETTINGS["parameters"]),
        slug="my-run",
        user=TokenPayload(sub=OWNER, email=f"{OWNER}@example.org", role="user", name=OWNER),
        now=stored["created_at"],
        about={**SETTINGS["about"], "name": "River basin (copy)"},
        slurm_config=SlurmConfig(**SETTINGS["slurm_config"]),
    )
    # The same keys and values as a draft that derive would build, given the
    # copied settings: every run fact is back at its fresh-draft value.
    assert stored == fresh


def test_a_copy_belongs_to_the_caller_and_has_fresh_timestamps(client, db, source):
    assert client.post(DUPLICATE, headers=HEADERS).status_code == 201
    (stored,) = _copies(db)
    assert stored["user_id"] == OWNER and stored["user_email"] == f"{OWNER}@example.org"
    assert stored["created_at"] > source["created_at"]
    assert stored["updated_at"] == stored["created_at"]


def test_the_title_is_read_from_the_snapshot_again(client, db, source):
    db.datasets.docs["ds-1"]["document"]["about"]["name"] = "Dataset renamed"
    body = client.post(DUPLICATE, headers=HEADERS).json()
    assert body["dataset_title"] == "Dataset renamed"


def test_the_short_title_is_read_from_the_snapshot_again(client, db, source):
    assert client.post(DUPLICATE, headers=HEADERS).json()["dataset_short_title"] is None
    db.datasets.docs["ds-1"]["document"]["about"]["shortName"] = "Short one"
    assert client.post(DUPLICATE, headers=HEADERS).json()["dataset_short_title"] == "Short one"


def test_a_source_without_a_name_gets_no_copy_suffix(client, db):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    assert client.post(DUPLICATE, headers=HEADERS).json()["about"] is None
    db.jobs.docs["job-1"]["about"] = {"description": "only a description"}
    assert _set(client.post(DUPLICATE, headers=HEADERS).json()["about"]) == {
        "description": "only a description"
    }


def test_two_copies_of_one_source_coexist(client, db, source):
    first = client.post(DUPLICATE, headers=HEADERS)
    second = client.post(DUPLICATE, headers=HEADERS)
    assert (first.status_code, second.status_code) == (201, 201)
    assert first.json()["id"] != second.json()["id"]
    assert len(_copies(db)) == 2
    assert all("sim_id" not in copy_ for copy_ in _copies(db))


def test_the_source_is_untouched(client, db, source):
    before = copy.deepcopy(db.jobs.docs["job-1"])
    client.post(DUPLICATE, headers=HEADERS)
    assert db.jobs.docs["job-1"] == before


def test_a_draft_can_be_copied_too(client, db):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    response = client.post(DUPLICATE, headers=HEADERS)
    assert response.status_code == 201
    assert response.json()["parameters"]["temporal_range_end"] == "2000-12-31"
    assert len(_copies(db)) == 1


def test_a_copy_is_audited(client, db, source):
    new_id = client.post(DUPLICATE, headers=HEADERS).json()["id"]
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "simulation_duplicated"]
    assert event["category"] == "job"
    assert event["actor_id"] == OWNER and event["actor_email"] == f"{OWNER}@example.org"
    assert event["target_id"] == new_id
    assert event["detail"] == {"source_id": "job-1", "dataset_id": "ds-1"}


def test_a_missing_snapshot_is_a_422_and_nothing_is_inserted_or_audited(client, db, source):
    del db.datasets.docs["ds-1"]
    response = client.post(DUPLICATE, headers=HEADERS)
    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "snapshot_not_found",
        "message": "The model snapshot this snapshot draft is based on is no longer in the "
        "repository, so it can't be copied.",
    }
    assert _copies(db) == []
    assert not [e for e in db.audit_events.docs.values() if e["action"] == "simulation_duplicated"]


def test_someone_elses_snapshot_draft_is_a_404_like_a_missing_one(client, db, source):
    db.users.docs["other"] = make_user("other", can_run_simulations=True)
    other = token_for("other")
    real = client.post(DUPLICATE, headers=other)
    missing = client.post("/api/v1/jobs/nope/duplicate", headers=other)
    assert (real.status_code, real.json()) == (missing.status_code, missing.json()) == (404, {"detail": "Job not found"})
    assert _copies(db) == []


def test_a_copy_of_a_job_with_no_slurm_config_or_about_still_works(client, db):
    doc = make_job("job-1", OWNER, "FAILED")
    doc["slurm_config"] = None
    db.jobs.docs["job-1"] = doc
    response = client.post(DUPLICATE, headers=HEADERS)
    assert response.status_code == 201
    assert response.json()["slurm_config"] == {"cores": None, "walltime": None}
