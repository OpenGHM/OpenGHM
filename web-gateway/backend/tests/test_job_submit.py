"""POST /jobs/{id}/submit (mission 2026-09-30-a-gateway-job-runs-the-toolkit,
ADR 0025): every answer the route gives, what it records on the job, the
rollback to DRAFT when Anvil does not take it, and the slurm spec a submit
builds for the v2 snapshot.

The route and the real auth dependencies run against the in-memory Mongo
(tests/conftest.py); the slurm service is faked, so no SSH happens.
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

import pytest
from slurmly import JobSpec
from slurmly.exceptions import InvalidJobSpec, SbatchError, SbatchParseError, SSHTransportError
from slurmly.scripts.renderer import render_script

from app.api.v1 import jobs as jobs_router
from app.core.config import settings
from app.models.job import (
    MAX_JOBS_PER_SIMULATION,
    MAX_RUN_SECONDS,
    MAX_WALLTIME_SECONDS,
    JobDB,
    SlurmConfig,
)
from app.services import job_script, slurm

from conftest import REMOTE_BASE
from route_helpers import NOW, make_job, make_user, token_for

# conftest fakes these for the route tests; the leftovers tests below want the
# real ones, and this module is imported before any fixture runs.
REAL_SCANCEL_BY_NAME = slurm.scancel_by_name
REAL_REMOVE_FAILED_SUBMIT_DIRS = slurm.remove_failed_submit_dirs

OWNER = "owner"
HEADERS = token_for(OWNER)
SUBMIT = "/api/v1/jobs/job-1/submit"
V2 = Path(__file__).parents[3] / "schemas/snapshot-spec/examples/wbm_storage_v2.0.0.json"


@pytest.fixture(autouse=True)
def owner(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)


@pytest.fixture
def draft(db):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    return db.jobs.docs["job-1"]


@pytest.fixture
def sent(monkeypatch) -> list:
    """Record what reaches slurmly, on top of conftest's fake that answers."""
    calls: list = []
    real = slurm.submit_job

    async def recording(job, snapshot, body, post_processing=False):
        calls.append((job, snapshot, body))
        return await real(job, snapshot, body, post_processing)

    monkeypatch.setattr(slurm, "submit_job", recording)
    return calls


def _fail_with(monkeypatch, exc: Exception):
    async def submit_job(job, snapshot, body, post_processing=False):
        raise exc

    monkeypatch.setattr(slurm, "submit_job", submit_job)


def _patch(client, **body):
    return client.patch("/api/v1/jobs/job-1", json=body, headers=HEADERS)


# ---- 202 -------------------------------------------------------------------


def test_a_submit_is_accepted_and_the_job_records_everything(client, db, draft, sent):
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "SUBMITTED"
    assert re.fullmatch(r"sim-\d{8}-[0-9a-f]{6}", body["sim_id"])
    assert body["slurm_job_id"] == "12345"
    assert body["slurm_job_name"] == body["sim_id"]
    assert body["toolkit"] == {
        "home": "/home/x-openghm/apps/openghm/abc1234",
        "commit": "abc1234",
    }
    assert body["work_dir"] == f"/anvil/scratch/x-openghm/simulations/{body['sim_id']}"
    assert body["remote_job_dir"] == "/anvil/scratch/x-openghm/openghm/slurmly-1a2b3c4d"
    assert body["submitted_at"] is not None
    assert body["last_submit_error"] is None

    stored = db.jobs.docs["job-1"]
    assert stored["sim_id"] == body["sim_id"]
    assert stored["internal_job_id"] == "slurmly-1a2b3c4d"
    assert stored["remote_script_path"].endswith("/run.sh")

    # What slurmly was handed: the rendered body, for this snapshot and sim id.
    ((job, snapshot, script),) = sent
    assert isinstance(job, JobDB) and job.sim_id == body["sim_id"]
    # Defaults: no overrides, and the walltime asked of SLURM (the snapshot's
    # 15:00 with headroom) given to the toolkit for its spool lease.
    assert f'--id {body["sim_id"]} --walltime 22:30 --spool cache' in script
    assert slurm.build_job_spec(job, snapshot, "x").time_limit == "22:30"
    assert f'OG_WORK_DIR={body["work_dir"]}' in script
    assert "snapshot fetch" in script and " ds-1 " in script

    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "job_submitted"]
    assert event["target_id"] == "job-1" and event["actor_id"] == OWNER
    assert event["detail"]["sim_id"] == body["sim_id"]


def test_a_changed_period_reaches_the_script_as_flags(client, db, draft, sent):
    assert _patch(
        client,
        parameters={
            "temporal_range_start": "2000-03-01",
            "temporal_range_end": "2000-12-31",
            "variables": ["runoff"],
        },
    ).status_code == 200
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    script = sent[0][2]
    assert "--run-start 2000-03-01" in script
    assert "--run-end" not in script  # equal to the snapshot's own
    assert "--output-vars runoff" in script


def test_the_drafts_cores_and_the_snapshots_walltime_are_what_slurm_is_asked_for(client, db, draft, sent):
    # A walltime sent by a client that still has the field is not stored, so it cannot be asked for.
    assert _patch(client, slurm_config={"cores": 4, "walltime": "01:30:00"}).status_code == 200
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    (job, snapshot, _), = sent
    assert slurm.resolve_compute(job.slurm_config, snapshot) == (4, "22:30")


# ---- refused before anything changes ---------------------------------------


def test_a_non_draft_is_409(client, db):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "RUNNING")
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "not_a_draft"
    assert db.jobs.docs["job-1"]["status"] == "RUNNING"


def test_a_second_submit_is_409(client, db, draft):
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    second = client.post(SUBMIT, headers=HEADERS)
    assert second.status_code == 409


def test_two_submits_racing_cannot_both_claim_the_draft(client, db, draft, sent, monkeypatch):
    """Both requests read a DRAFT; only one conditional update can move it.
    Here the other request wins between this one's read and its claim."""
    stale = dict(draft)

    async def read_then_lose_the_race(job_id, user, escalated):
        db.jobs.docs["job-1"]["status"] = "SUBMITTED"  # the other request's claim
        return stale

    monkeypatch.setattr(jobs_router, "_get_job_for", read_then_lose_the_race)
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 409
    assert sent == []  # nothing was sent to Anvil for the loser
    assert "sim_id" not in db.jobs.docs["job-1"]


def test_a_draft_edited_during_the_submit_is_not_submitted(client, db, draft, sent, monkeypatch):
    stale = dict(draft)

    async def read_then_get_edited(job_id, user, escalated):
        db.jobs.docs["job-1"]["updated_at"] = draft["updated_at"].replace(year=2027)
        return stale

    monkeypatch.setattr(jobs_router, "_get_job_for", read_then_get_edited)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 409
    assert sent == []


def test_someone_elses_draft_is_404(client, db, draft):
    db.users.docs["other"] = make_user("other", can_run_simulations=True)
    response = client.post(SUBMIT, headers=token_for("other"))
    assert response.status_code == 404
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"


def test_the_active_job_limit_answers_429_and_leaves_the_draft(client, db, draft):
    db.jobs.docs["a"] = make_job("a", OWNER, "RUNNING")
    db.jobs.docs["b"] = make_job("b", OWNER, "PENDING")
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "active_job_limit"
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"


@pytest.mark.parametrize(
    "edit, fields",
    [
        ({"model_input_id": "some-model-input"}, ["model_input_id"]),
        (
            {
                "parameters": {
                    "temporal_range_start": "2000-01-01",
                    "temporal_range_end": "2000-12-31",
                    "variables": ["runoff", "discharge"],
                    "spatial_domain": {"north": 40, "south": 30, "east": -80, "west": -90},
                }
            },
            ["parameters.spatial_domain"],
        ),
        (
            {
                "parameters": {
                    "temporal_range_start": "2000-01-01",
                    "temporal_range_end": "2000-12-31",
                    "variables": ["runoff", "discharge"],
                    "custom_params": {"a": "1"},
                }
            },
            ["parameters.custom_params"],
        ),
    ],
)
def test_each_unsupported_field_is_a_422_naming_it(client, db, draft, sent, edit, fields):
    if "model_input_id" in edit:
        # The API no longer sets an override (user decision 2026-10-06); a legacy
        # draft that has one is written straight to the store.
        draft.update(edit)
    else:
        assert _patch(client, **edit).status_code == 200
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "unsupported_fields"
    assert detail["fields"] == fields
    assert all(f in detail["message"] for f in fields)
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"
    assert sent == []


def test_the_snapshots_own_bounding_box_is_not_an_override(client, db, draft):
    box = {"north": 57.1667, "south": 21.75, "east": -60.5833, "west": -127.8333}
    assert _patch(
        client,
        parameters={
            "temporal_range_start": "2000-01-01",
            "temporal_range_end": "2000-12-31",
            "variables": ["runoff", "discharge"],
            "spatial_domain": box,
        },
    ).status_code == 200
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202


def test_a_period_that_is_not_a_run_is_a_422_and_a_draft(client, db, draft):
    assert _patch(
        client,
        parameters={
            "temporal_range_start": "2001-01-01",
            "temporal_range_end": "2000-01-01",
            "variables": ["runoff"],
        },
    ).status_code == 200
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_parameters"
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"


def test_a_snapshot_that_left_the_repository_is_a_422(client, db, draft):
    del db.datasets.docs["ds-1"]
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "snapshot_not_found"


def _recommend(db, walltime: str):
    db.datasets.docs["ds-1"]["document"]["simulation"]["recommendedCompute"]["walltime"] = walltime


def test_a_recommendation_over_the_limit_is_submitted_at_the_cap_and_the_script_is_kept(
    client, db, draft, sent
):
    """ADR 0037: the Global snapshot's 111 h 30 min no longer refuses the submit.
    The job asks for one job's maximum, and the run continues in the next job."""
    _recommend(db, "111:30:00")  # the Global_tracking snapshot
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 202
    (call,) = sent
    assert slurm.build_job_spec(call[0], call[1], call[2]).time_limit == "96:00:00"
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "SUBMITTED" and "last_submit_error" not in stored
    # What was sent is stored, to be sent again by a continuation.
    assert stored["submit_script"] == {"body": call[2], "cores": 16, "walltime": "96:00:00"}


def test_a_walltime_stored_in_a_draft_before_it_went_is_ignored_at_submit(client, db, draft, sent):
    db.jobs.docs["job-1"]["slurm_config"] = {"cores": 4, "walltime": "00:05:00"}
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    (call,) = sent
    assert slurm.build_job_spec(call[0], call[1], "x").time_limit == "22:30"
    assert db.jobs.docs["job-1"]["submit_script"]["walltime"] == "22:30"


def test_an_automatic_walltime_is_capped_at_the_limit_when_the_recommendation_fits(
    client, db, draft, sent
):
    _recommend(db, "80:00:00")  # + 50% would be 120 h
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    (call,) = sent
    assert slurm.build_job_spec(call[0], call[1], "x").time_limit == "96:00:00"


def test_one_simulation_may_run_two_weeks_in_at_most_four_jobs():
    assert MAX_RUN_SECONDS == 14 * 24 * 3600
    assert MAX_JOBS_PER_SIMULATION == 4  # 4 x 96 h = 384 h: the slack is for the work each cut redoes
    assert MAX_JOBS_PER_SIMULATION * MAX_WALLTIME_SECONDS >= MAX_RUN_SECONDS


def test_a_run_estimated_over_two_weeks_is_refused_and_stays_a_draft(client, db, draft, sent):
    """224 h recommended is 336 h with headroom: exactly two weeks, allowed. A minute more is not."""
    _recommend(db, "224:00:00")
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    db.jobs.docs["job-1"].update(status="DRAFT", submit_script=None)
    sent.clear()
    _recommend(db, "224:01:00")
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "run_over_limit"
    assert detail["message"] == (
        "This simulation is estimated to take about 336 h 1 min "
        "(the reference run, plus 50%), over the 2-week limit for one simulation."
    )
    assert detail["estimated_seconds"] == 336 * 3600 + 90 and detail["limit_seconds"] == MAX_RUN_SECONDS
    assert sent == []
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "DRAFT" and stored["last_submit_error"]["code"] == "run_over_limit"


def test_the_estimate_is_not_capped_at_one_jobs_limit(client, db, draft, sent):
    """A 300 h recommendation is asked of SLURM at the 96 h cap, but is estimated at 450 h."""
    _recommend(db, "300:00:00")
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 422
    assert "about 450 h" in response.json()["detail"]["message"]
    assert sent == []


# ---- Anvil does not take it: the draft stays a draft ------------------------


def _assert_back_to_draft(db, code: str):
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "DRAFT"
    # A draft carries none of what a submit sets: `sim_id` must be absent, not
    # null, or the sparse unique index on it collides across drafts.
    assert not {"sim_id", "toolkit", "work_dir"} & set(stored)
    assert stored["slurm_job_name"] == ""
    assert stored["slurm_job_id"] is None
    assert stored["last_submit_error"]["code"] == code
    assert stored["last_submit_error"]["message"]
    assert stored["last_submit_error"]["at"] is not None


def test_anvil_unreachable_is_503_and_leaves_a_draft(client, db, draft, monkeypatch):
    _fail_with(monkeypatch, SSHTransportError("connection reset by 149.165.1.1"))
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["code"] == "anvil_unreachable"
    assert "149.165" not in json.dumps(detail)  # no transport internals to the user
    _assert_back_to_draft(db, "anvil_unreachable")


def test_sbatch_refusal_is_502_with_slurms_message_and_leaves_a_draft(
    client, db, draft, monkeypatch
):
    _fail_with(
        monkeypatch,
        SbatchError(
            command="sbatch run.sh",
            exit_status=1,
            stderr="sbatch: error: Batch job submission failed: Invalid account",
        ),
    )
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["code"] == "sbatch_rejected"
    assert "Invalid account" in detail["message"]
    _assert_back_to_draft(db, "sbatch_rejected")


def test_a_run_time_refusal_is_explained_and_slurms_own_text_follows(
    client, db, draft, monkeypatch
):
    _fail_with(
        monkeypatch,
        SbatchError(
            command="cd /anvil/scratch/x-openghm/openghm/slurmly-1a2b3c4d && sbatch run.sh",
            exit_status=1,
            stderr=(
                "sbatch: error: Batch job submission failed: Job violates accounting/QOS "
                "policy (job submit limit, user's size and/or time limits)"
            ),
            stdout="QOSMaxWallDurationPerJobLimit",
        ),
    )
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["code"] == "sbatch_rejected"  # unchanged: clients rely on it
    assert detail["message"].startswith("Anvil refused the requested run time")
    assert "Job violates accounting/QOS policy" in detail["message"]
    assert "/anvil" not in detail["message"]
    assert detail["message"].endswith("Your draft is unchanged.")
    _assert_back_to_draft(db, "sbatch_rejected")
    assert db.jobs.docs["job-1"]["last_submit_error"]["message"] == detail["message"]


def test_an_invalid_spec_is_502_sbatch_rejected(client, db, draft, monkeypatch):
    _fail_with(monkeypatch, InvalidJobSpec("time_limit must be a Slurm --time form"))
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "sbatch_rejected"
    _assert_back_to_draft(db, "sbatch_rejected")


def test_unconfigured_ssh_is_503_anvil_not_configured(client, db, draft, monkeypatch):
    _fail_with(monkeypatch, slurm.AnvilNotConfigured("no ssh key"))
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "anvil_not_configured"
    _assert_back_to_draft(db, "anvil_not_configured")


def test_an_unexpected_failure_still_returns_the_draft(db, draft, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _fail_with(monkeypatch, ZeroDivisionError("bug"))
    app = FastAPI()
    app.include_router(jobs_router.router, prefix="/api/v1")
    response = TestClient(app, raise_server_exceptions=False).post(SUBMIT, headers=HEADERS)
    assert response.status_code == 500
    _assert_back_to_draft(db, "internal_error")


def test_a_retry_after_a_failure_succeeds_and_clears_the_error(client, db, draft, monkeypatch):
    real = slurm.submit_job
    _fail_with(monkeypatch, SSHTransportError("down"))
    assert client.post(SUBMIT, headers=HEADERS).status_code == 503
    assert db.jobs.docs["job-1"]["last_submit_error"]["code"] == "anvil_unreachable"

    monkeypatch.setattr(slurm, "submit_job", real)
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 202
    assert response.json()["last_submit_error"] is None
    assert "last_submit_error" not in db.jobs.docs["job-1"]


def test_the_draft_shows_why_the_last_submit_failed(client, db, draft, monkeypatch):
    _fail_with(monkeypatch, SSHTransportError("down"))
    client.post(SUBMIT, headers=HEADERS)
    got = client.get("/api/v1/jobs/job-1", headers=HEADERS).json()
    assert got["status"] == "DRAFT"
    assert got["last_submit_error"]["code"] == "anvil_unreachable"


def test_no_toolkit_install_is_503_and_runs_nothing(client, db, draft, sent, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", "")
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "anvil_not_configured"
    assert sent == []
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"
    assert "sim_id" not in db.jobs.docs["job-1"]


# ---- a submit that may have reached SLURM, and one that certainly did not ----


@pytest.mark.parametrize(
    "exc",
    [
        SSHTransportError("connection reset"),
        SbatchParseError("Submitted batch job soon"),
        TimeoutError("no answer"),
        ConnectionResetError("reset"),
    ],
)
def test_a_lost_answer_cancels_the_attempt_by_name(client, db, draft, monkeypatch, exc):
    _fail_with(monkeypatch, exc)
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "anvil_unreachable"
    ((call, sim_id),) = db.cleanup_calls
    assert call == "scancel_by_name" and sim_id.startswith("sim-")
    _assert_back_to_draft(db, "anvil_unreachable")
    assert not db.jobs.docs["job-1"].get("orphan_sim_ids")


def test_when_that_scancel_fails_too_the_name_is_kept_on_the_draft(
    client, db, draft, monkeypatch
):
    _fail_with(monkeypatch, SSHTransportError("connection reset"))

    async def scancel_by_name(sim_id):
        db.cleanup_calls.append(("scancel_by_name", sim_id))
        return False

    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 503
    ((_, sim_id),) = db.cleanup_calls
    stored = db.jobs.docs["job-1"]
    assert stored["orphan_sim_ids"] == [sim_id]
    _assert_back_to_draft(db, "anvil_unreachable")  # and still a draft, without sim_id


def test_a_scancel_that_raises_is_the_same_as_one_that_failed(client, db, draft, monkeypatch):
    _fail_with(monkeypatch, SSHTransportError("down"))

    async def scancel_by_name(sim_id):
        raise SSHTransportError("still down")

    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 503
    assert len(db.jobs.docs["job-1"]["orphan_sim_ids"]) == 1


def test_a_resubmit_after_an_orphan_keeps_the_old_name_to_cancel(client, db, draft, monkeypatch):
    real = slurm.submit_job
    _fail_with(monkeypatch, SSHTransportError("down"))

    async def scancel_by_name(sim_id):
        return False

    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    client.post(SUBMIT, headers=HEADERS)
    (orphan,) = db.jobs.docs["job-1"]["orphan_sim_ids"]
    monkeypatch.setattr(slurm, "submit_job", real)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    assert db.jobs.docs["job-1"]["orphan_sim_ids"] == [orphan]
    assert db.jobs.docs["job-1"]["sim_id"] != orphan


def test_a_refusal_removes_slurmlys_leftover_directory_and_cancels_nothing(
    client, db, draft, monkeypatch
):
    _fail_with(monkeypatch, SbatchError(command="sbatch run.sh", exit_status=1, stderr="Invalid account"))
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 502
    ((call, sim_id),) = db.cleanup_calls
    assert call == "remove_failed_submit_dirs" and sim_id.startswith("sim-")
    assert not db.jobs.docs["job-1"].get("orphan_sim_ids")


def test_a_failed_cleanup_never_changes_the_answer(client, db, draft, monkeypatch):
    _fail_with(monkeypatch, SbatchError(command="sbatch run.sh", exit_status=1, stderr="no"))

    async def no_anvil():
        raise SSHTransportError("down")

    # The real function swallows its own failures. (Never the real client: a
    # developer's .env may hold real credentials.)
    monkeypatch.setattr(slurm, "get_slurm_client", no_anvil)
    monkeypatch.setattr(slurm, "remove_failed_submit_dirs", REAL_REMOVE_FAILED_SUBMIT_DIRS)
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "sbatch_rejected"


@pytest.mark.parametrize(
    "exc", [slurm.AnvilNotConfigured("no key"), InvalidJobSpec("bad time")]
)
def test_a_submit_that_never_left_the_gateway_needs_no_cleanup_by_name(
    client, db, draft, monkeypatch, exc
):
    _fail_with(monkeypatch, exc)
    client.post(SUBMIT, headers=HEADERS)
    assert not [c for c in db.cleanup_calls if c[0] == "scancel_by_name"]


def test_scancel_by_name_is_this_users_and_this_attempts(db, anvil, monkeypatch):
    assert asyncio.run(REAL_SCANCEL_BY_NAME("sim-20260930-0a1b2c")) is True
    assert anvil.commands == ["scancel --name=sim-20260930-0a1b2c --user=x-openghm"]
    assert anvil.transport.runs[0].retry_safe is True
    anvil.results.append((lambda c: True, (1, "", "scancel: error")))
    assert asyncio.run(REAL_SCANCEL_BY_NAME("sim-20260930-0a1b2c")) is False


def test_the_leftover_directory_is_found_by_the_name_in_its_metadata_and_removed(db, anvil):
    sim = "sim-20260930-0a1b2c"
    found = f"{REMOTE_BASE}/jobs/slurmly-1a2b3c4d/metadata.json\n"
    anvil.results.append((lambda c: c.startswith("grep"), (0, found, "")))
    asyncio.run(REAL_REMOVE_FAILED_SUBMIT_DIRS(sim))
    grep, rm = anvil.commands
    assert grep == (
        f"grep -l -F '\"name\": \"{sim}\"' {REMOTE_BASE}/jobs/slurmly-*/metadata.json"
    )
    assert rm == f"rm -rf -- {REMOTE_BASE}/jobs/slurmly-1a2b3c4d"


def test_nothing_is_removed_when_no_directory_names_the_attempt(db, anvil):
    anvil.results.append((lambda c: c.startswith("grep"), (1, "", "")))
    asyncio.run(REAL_REMOVE_FAILED_SUBMIT_DIRS("sim-20260930-0a1b2c"))
    assert len(anvil.commands) == 1


def test_a_hit_outside_the_jobs_root_is_not_removed(db, anvil):
    anvil.results.append((lambda c: c.startswith("grep"), (0, "/anvil/scratch/x-openghm/cache/metadata.json\n", "")))
    asyncio.run(REAL_REMOVE_FAILED_SUBMIT_DIRS("sim-20260930-0a1b2c"))
    assert len(anvil.commands) == 1  # slurmly's own check refuses; the grep was all


def test_a_cleanup_that_cannot_reach_anvil_is_silent(db, anvil):
    anvil.results.append((lambda c: True, SSHTransportError("down")))
    asyncio.run(REAL_REMOVE_FAILED_SUBMIT_DIRS("sim-20260930-0a1b2c"))  # does not raise


# ---- PATCH slurm_config ------------------------------------------------------


def test_patch_stores_cores(client, db, draft):
    got = _patch(client, slurm_config={"cores": 8}).json()
    assert got["slurm_config"] == {"cores": 8}
    got = _patch(client, slurm_config={"cores": 16}).json()
    assert got["slurm_config"] == {"cores": 16}


def test_patch_null_goes_back_to_the_snapshots_recommendation(client, db, draft):
    _patch(client, slurm_config={"cores": 8})
    got = _patch(client, slurm_config=None).json()
    assert got["slurm_config"] == {"cores": None}


@pytest.mark.parametrize(
    "config",
    [
        {"cores": 0},
        {"cores": 129},
        {"cores": 1.5},
        {"nodes": 2},  # not a field a user sets: ignored, so nothing changes
        {"walltime": "x"},  # nor is the walltime, which is never the user's
    ],
)
def test_patch_refuses_out_of_bounds_compute(client, db, draft, config):
    response = _patch(client, slurm_config=config)
    if "cores" not in config:
        assert response.status_code == 200
        assert response.json()["slurm_config"] == {"cores": None}
    else:
        assert response.status_code == 422


def test_patch_accepts_the_bounds(client, db, draft):
    got = _patch(client, slurm_config={"cores": 128})
    assert got.status_code == 200


def test_the_old_post_jobs_route_is_gone(client, db):
    assert client.post("/api/v1/jobs", json={}, headers=HEADERS).status_code == 405


# ---- the slurm spec (T4) ------------------------------------------------------


@pytest.fixture
def v2_spec_inputs(monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_ACCOUNT", "ees260008")
    monkeypatch.setattr(settings, "ANVIL_PARTITION", "shared")
    snapshot = json.loads(V2.read_text())
    doc = make_job("job-1", OWNER, "SUBMITTED")
    doc["dataset_id"] = snapshot["id"]
    doc["sim_id"] = "sim-20260930-0a1b2c"
    doc["slurm_job_name"] = "sim-20260930-0a1b2c"
    return JobDB(**doc), snapshot


def test_spec_for_the_v2_snapshot_asks_for_its_recommended_compute(v2_spec_inputs):
    job, snapshot = v2_spec_inputs
    spec = slurm.build_job_spec(job, snapshot, "echo body")
    assert isinstance(spec, JobSpec)
    # 15:00 recommended (15 minutes) plus 50%; cores as recommended.
    assert (spec.cpus_per_task, spec.time_limit) == (1, "22:30")
    assert (spec.nodes, spec.ntasks, spec.memory) == (None, None, None)
    assert (spec.account, spec.partition, spec.qos) == ("ees260008", "shared", "cpu")
    assert spec.name == "sim-20260930-0a1b2c"
    assert spec.command_template == "echo body"
    assert spec.env == {}


def test_spec_prefers_the_drafts_own_cores_and_never_its_walltime(v2_spec_inputs):
    job, snapshot = v2_spec_inputs
    job.slurm_config.cores = 4
    spec = slurm.build_job_spec(job, snapshot, "echo body")
    assert (spec.cpus_per_task, spec.time_limit) == (4, "22:30")


def test_the_rendered_batch_script_requests_cpus_per_task_not_nodes(v2_spec_inputs):
    from slurmly import get_preset

    job, snapshot = v2_spec_inputs
    preset = get_preset("purdue_anvil")
    body = job_script.render_job_body(
        snapshot_id=snapshot["id"],
        sim_id=job.sim_id,
        openghm_home=settings.ANVIL_OPENGHM_HOME,
        cache_dir=settings.ANVIL_CACHE_DIR,
        fetch_lock=settings.ANVIL_FETCH_LOCK,
        work_dir=f"{settings.ANVIL_OUTPUT_BASE}/{job.sim_id}",
    )
    script = render_script(
        spec=slurm.build_job_spec(job, snapshot, body),
        profile=preset.cluster_profile,
        execution_profile=slurm.gateway_execution_profiles()["anvil_cpu_modules"],
        stdout_path="/o",
        stderr_path="/e",
        remote_job_dir="/j",
    )
    directives = [l for l in script.splitlines() if l.startswith("#SBATCH")]
    assert "#SBATCH --cpus-per-task=1" in directives
    assert "#SBATCH --time=22:30" in directives
    assert "#SBATCH --account=ees260008" in directives
    assert not [d for d in directives if "--nodes" in d or "--ntasks" in d]
    assert "--id sim-20260930-0a1b2c --spool cache" in script
    # `set -e`, then the quiet module preamble, then the body: a failed
    # `module load` stops the job, and nothing is printed on a good one.
    lines = script.splitlines()
    assert lines[lines.index("set -euo pipefail") + 1:][:2] == [
        "module -q purge",
        "module -q load modtree/cpu",
    ]
    assert "module list" not in script


def test_every_module_preamble_is_quiet_and_has_no_module_list():
    for name, profile in slurm.gateway_execution_profiles().items():
        assert profile.preamble, name
        assert all(line.startswith("module -q ") for line in profile.preamble), name
        assert "module -q list" not in profile.preamble, name


def test_a_stored_walltime_is_not_a_field_of_the_draft_any_more(v2_spec_inputs):
    job, snapshot = v2_spec_inputs
    stored = SlurmConfig(**{"cores": None, "walltime": "00:15:00"})
    assert not hasattr(stored, "walltime") and stored.model_dump() == {"cores": None}
    spec = slurm.build_job_spec(job, snapshot, "echo body")
    assert spec.time_limit == "22:30"  # the recommendation's, with headroom
    assert spec.cpus_per_task == 1  # cores still the snapshot's


def test_the_snapshots_walltime_gets_headroom_and_its_cores_do_not(v2_spec_inputs):
    job, snapshot = v2_spec_inputs
    snapshot["simulation"]["recommendedCompute"] = {"cores": 8, "walltime": "4:30:00"}
    assert slurm.resolve_compute(job.slurm_config, snapshot) == (8, "6:45:00")
    job.slurm_config.cores = 2
    assert slurm.resolve_compute(job.slurm_config, snapshot) == (2, "6:45:00")


def test_a_run_that_post_processes_gets_headroom_on_its_walltime_and_post_processing_time(v2_spec_inputs):
    job, snapshot = v2_spec_inputs
    snapshot["simulation"]["recommendedCompute"] = {
        "cores": 8, "walltime": "4:00:00", "postProcessingWalltime": "0:30:00"}
    assert slurm.resolve_compute(job.slurm_config, snapshot) == (8, "6:00:00")
    assert slurm.resolve_compute(job.slurm_config, snapshot, True) == (8, "6:45:00")
    assert slurm.build_job_spec(job, snapshot, "x", True).time_limit == "6:45:00"


def test_the_job_body_locks_the_fetch_on_home(client, db, draft, sent):
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    script = sent[0][2]
    assert f"step fetch flock {settings.ANVIL_FETCH_LOCK} " in script
    assert settings.ANVIL_FETCH_LOCK.startswith("/home/")


def test_spec_without_any_compute_is_refused(v2_spec_inputs):
    job, snapshot = v2_spec_inputs
    del snapshot["simulation"]["recommendedCompute"]
    with pytest.raises(job_script.SubmitInputError):
        slurm.build_job_spec(job, snapshot, "echo body")


# ---- mission 2026-10-06: a submit that is interrupted or unexpected -----------


def test_an_unexpected_exception_after_sbatch_cancels_the_attempt_by_name(db, draft, monkeypatch):
    """The generic branch used to return the draft and drop the name: sbatch may
    have run, and nothing would ever scancel it."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _fail_with(monkeypatch, ZeroDivisionError("bug while reading sbatch's answer"))
    app = FastAPI()
    app.include_router(jobs_router.router, prefix="/api/v1")
    response = TestClient(app, raise_server_exceptions=False).post(SUBMIT, headers=HEADERS)
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "internal_error"
    ((call, sim_id),) = db.cleanup_calls
    assert call == "scancel_by_name" and sim_id.startswith("sim-")
    _assert_back_to_draft(db, "internal_error")
    assert "cancelled" in db.jobs.docs["job-1"]["last_submit_error"]["message"]
    assert not db.jobs.docs["job-1"].get("orphan_sim_ids")


def test_if_that_scancel_cannot_run_the_unexpected_failure_keeps_the_name(db, draft, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _fail_with(monkeypatch, ZeroDivisionError("bug"))

    async def scancel_by_name(sim_id):
        raise SSHTransportError("down")

    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    app = FastAPI()
    app.include_router(jobs_router.router, prefix="/api/v1")
    assert TestClient(app, raise_server_exceptions=False).post(SUBMIT, headers=HEADERS).status_code == 500
    assert len(db.jobs.docs["job-1"]["orphan_sim_ids"]) == 1
    _assert_back_to_draft(db, "internal_error")


def test_a_failed_write_of_the_slurm_id_cancels_the_job_and_gives_the_draft_back(
    db, draft, monkeypatch
):
    """sbatch answered, the gateway could not record the id: the job exists and
    nothing would track it."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    real = db.jobs.update_one

    async def update_one(query, update):
        if "slurm_job_id" in update.get("$set", {}):
            raise RuntimeError("mongo went away")
        return await real(query, update)

    monkeypatch.setattr(db.jobs, "update_one", update_one)
    app = FastAPI()
    app.include_router(jobs_router.router, prefix="/api/v1")
    response = TestClient(app, raise_server_exceptions=False).post(SUBMIT, headers=HEADERS)
    assert response.status_code == 500
    ((call, sim_id),) = db.cleanup_calls
    assert call == "scancel_by_name"
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "DRAFT" and "sim_id" not in stored
    assert stored["last_submit_error"]["code"] == "submit_interrupted"
    assert not stored.get("orphan_sim_ids")


def test_a_cancel_that_won_the_job_while_the_answer_was_lost_still_records_the_name(
    client, db, draft, monkeypatch
):
    """`_return_to_draft` filtered on SUBMITTED, so an orphan from a submit the
    user cancelled in flight was dropped with the filter."""

    async def submit_job(job, snapshot, body, post_processing=False):
        db.jobs.docs["job-1"].update(status="CANCELLED", cancel_requested_by=OWNER)
        raise SSHTransportError("connection reset")

    async def scancel_by_name(sim_id):
        return False

    monkeypatch.setattr(slurm, "submit_job", submit_job)
    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 503
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "CANCELLED"  # the cancel stands
    assert stored["orphan_sim_ids"] == [stored["sim_id"]]


# ---- a sbatch refusal message is a sentence, then another ----------------------


def test_an_unrecognised_refusal_gets_its_full_stop_before_your_draft_is_unchanged(
    client, db, draft, monkeypatch
):
    _fail_with(
        monkeypatch,
        SbatchError(
            command="sbatch run.sh",
            exit_status=1,
            stderr="sbatch: error: Batch job submission failed: Requested node configuration is not available combination specified",
        ),
    )
    message = client.post(SUBMIT, headers=HEADERS).json()["detail"]["message"]
    assert message.endswith("combination specified. Your draft is unchanged.")
    assert "specified Your" not in message


# ---- last_submit_error is never the reason of an earlier try --------------------

STALE = {"code": "anvil_unreachable", "message": "Anvil could not be reached.", "at": NOW}


def _stale(db):
    db.jobs.docs["job-1"]["last_submit_error"] = dict(STALE)


def _assert_error_is(db, code: str, status: str = "DRAFT"):
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == status
    assert stored["last_submit_error"]["code"] == code, stored["last_submit_error"]
    assert stored["last_submit_error"]["message"] != STALE["message"]


def test_unsupported_fields_replaces_the_stale_reason(client, db, draft):
    _stale(db)
    db.jobs.docs["job-1"]["model_input_id"] = "other-input"
    assert client.post(SUBMIT, headers=HEADERS).status_code == 422
    _assert_error_is(db, "unsupported_fields")


def test_answered_by_published_replaces_the_stale_reason(client, db, draft, monkeypatch):
    from app.services import published_answer

    class Answered:
        answered = True

    async def answer(*args, **kwargs):
        return Answered()

    monkeypatch.setattr(published_answer, "answer", answer)
    _stale(db)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 409
    _assert_error_is(db, "answered_by_published")


@pytest.mark.parametrize("check", ["_refuse_unaligned_start", "_refuse_dates_outside_aggregation"])
def test_the_run_date_refusals_replace_the_stale_reason(client, db, draft, monkeypatch, check):
    async def refuse(*args, **kwargs):
        raise jobs_router._error(422, "run_start_not_aligned" if "start" in check else "run_dates_outside_aggregation", "No.")

    monkeypatch.setattr(jobs_router, check, refuse)
    _stale(db)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 422
    _assert_error_is(db, "run_start_not_aligned" if "start" in check else "run_dates_outside_aggregation")


def test_an_unconfigured_gateway_replaces_the_stale_reason(client, db, draft, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", "")
    _stale(db)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 503
    _assert_error_is(db, "anvil_not_configured")


def test_a_refusal_of_the_account_replaces_the_stale_reason(client, db, draft):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=False)
    _stale(db)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 403
    _assert_error_is(db, "not_permitted_to_run")


def test_the_active_job_limit_replaces_the_stale_reason(client, db, draft):
    for n in (2, 3):
        db.jobs.docs[f"busy-{n}"] = make_job(f"busy-{n}", OWNER, "RUNNING")
    _stale(db)
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 429
    _assert_error_is(db, "active_job_limit")


def test_someone_elses_refused_submit_writes_nothing_to_the_draft(client, db, draft):
    db.users.docs["other"] = make_user("other", can_run_simulations=False)
    _stale(db)
    assert client.post(SUBMIT, headers=token_for("other")).status_code in (403, 404)
    assert db.jobs.docs["job-1"]["last_submit_error"] == STALE


def test_a_submit_that_is_not_a_draft_does_not_touch_the_reason(client, db):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "RUNNING")
    db.jobs.docs["job-1"]["last_submit_error"] = dict(STALE)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 409
    assert db.jobs.docs["job-1"]["last_submit_error"] == STALE


def test_a_refusal_after_anvil_replaces_it_too(client, db, draft, monkeypatch):
    _stale(db)
    _fail_with(monkeypatch, SbatchError(command="sbatch run.sh", exit_status=1, stderr="Invalid account"))
    assert client.post(SUBMIT, headers=HEADERS).status_code == 502
    _assert_error_is(db, "sbatch_rejected")
