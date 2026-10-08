"""Cancel in two steps (ADR 0026, mission
2026-09-30-every-job-ends-with-a-verdict): a request that SLURM confirms, the
sweep turning it into a verdict, and the race between a cancel and a submit
that has not yet heard SLURM's answer.

The routes and the sweep run against the in-memory Mongo (tests/conftest.py);
slurmly is its real client over a fake transport where the sweep needs it.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from slurmly import SubmittedJob
from slurmly.models import JobInfo

from app.api.v1 import jobs as jobs_router
from app.services import slurm

from conftest import REMOTE_BASE
from app.core.roles import Role
from route_helpers import NOW, SUCCESS_OUTCOME, make_job, make_sent_job, make_user, token_for

# conftest replaces this with a fake for the route tests.
REAL_SCANCEL_BY_NAME = slurm.scancel_by_name

OWNER = "owner"
HEADERS = token_for(OWNER)
CANCEL = "/api/v1/jobs/job-1/cancel"
DIR = f"{REMOTE_BASE}/jobs/slurmly-1a2b3c4d"


@pytest.fixture(autouse=True)
def owner(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)


@pytest.fixture
def scancels(monkeypatch) -> list[str]:
    """The SLURM ids `scancel` was asked for."""
    calls: list[str] = []

    async def cancel_job(slurm_job_id: str) -> bool:
        calls.append(slurm_job_id)
        return True

    monkeypatch.setattr(slurm, "cancel_job", cancel_job)
    return calls


def _info(state: str, lifecycle: str, **kw) -> JobInfo:
    return JobInfo(
        slurm_job_id="12345",
        lifecycle=lifecycle,
        raw_state=state,
        exit_code=kw.pop("exit_code", "0:0"),
        start_time="2026-09-30T14:00:00Z",
        end_time="2026-09-30T14:05:00Z",
        source="sacct",
        **kw,
    )


# ---- the first step ---------------------------------------------------------


def test_a_job_without_a_slurm_id_is_cancelled_at_once(client, db, scancels):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "SUBMITTED")
    db.jobs.docs["job-1"]["slurm_job_id"] = None  # still inside its submit
    response = client.post(CANCEL, headers=HEADERS)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "CANCELLED"
    assert body["failure"]["cause"] == "cancelled_by_user"
    assert body["cancel_requested_by_email"] == "owner@example.org"
    assert body["completed_at"] is not None
    assert scancels == []  # nothing to scancel yet
    stored = db.jobs.docs["job-1"]
    assert stored["cancel_requested_by"] == OWNER


def test_a_job_with_a_slurm_id_records_the_request_and_keeps_its_status(client, db, scancels):
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, "RUNNING")
    response = client.post(CANCEL, headers=HEADERS)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "RUNNING"  # SLURM has yet to confirm
    assert body["cancel_requested_at"] is not None
    assert body["cancel_requested_by_email"] == "owner@example.org"
    assert body["failure"] is None and body["completed_at"] is None
    assert scancels == ["12345"]
    assert db.jobs.docs["job-1"]["cancel_requested_by"] == OWNER
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "job_cancelled"]
    assert event["detail"]["requested"] is True


def test_a_failed_scancel_is_502_and_the_request_is_withdrawn(client, db, monkeypatch):
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, "RUNNING")

    async def cancel_job(slurm_job_id):
        raise RuntimeError("ssh: connection reset by 149.165.1.1")

    monkeypatch.setattr(slurm, "cancel_job", cancel_job)
    response = client.post(CANCEL, headers=HEADERS)
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["code"] == "cancel_failed"
    assert "149.165" not in json.dumps(detail)
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "RUNNING"
    assert not {"cancel_requested_at", "cancel_requested_by", "cancel_requested_by_email"} & set(stored)


def test_asking_again_asks_scancel_again_and_keeps_the_first_request(client, db, scancels):
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, "RUNNING")
    first = client.post(CANCEL, headers=HEADERS).json()
    second = client.post(CANCEL, headers=HEADERS)
    assert second.status_code == 200
    assert second.json()["cancel_requested_at"] == first["cancel_requested_at"]
    assert scancels == ["12345", "12345"]


def test_a_failed_second_scancel_keeps_the_pending_request(client, db, monkeypatch):
    doc = make_sent_job("job-1", OWNER, "RUNNING")
    db.jobs.docs["job-1"] = doc
    assert client.post(CANCEL, headers=HEADERS).status_code == 200

    async def cancel_job(slurm_job_id):
        raise RuntimeError("down")

    monkeypatch.setattr(slurm, "cancel_job", cancel_job)
    assert client.post(CANCEL, headers=HEADERS).status_code == 502
    assert "cancel_requested_at" in db.jobs.docs["job-1"]


@pytest.mark.parametrize("status", ["DRAFT", "COMPLETED", "FAILED", "CANCELLED"])
def test_a_job_that_is_not_running_cannot_be_cancelled(client, db, scancels, status):
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, status)
    assert client.post(CANCEL, headers=HEADERS).status_code == 409
    assert scancels == []


def test_the_submit_recording_its_id_during_a_cancel_turns_it_into_a_request(
    client, db, scancels, monkeypatch
):
    """The cancel read a job with no id; the submit recorded one before the
    cancel's write. The conditional write misses, so there *is* a job to
    scancel: the request path runs instead of a bare CANCELLED."""
    stale = make_job("job-1", OWNER, "SUBMITTED")
    stale["slurm_job_id"] = None
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, "SUBMITTED")

    async def read_before_the_submit_recorded(job_id, user, escalated):
        return stale

    monkeypatch.setattr(jobs_router, "_get_job_for", read_before_the_submit_recorded)
    response = client.post(CANCEL, headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["status"] == "SUBMITTED"
    assert scancels == ["12345"]
    assert db.jobs.docs["job-1"]["cancel_requested_by"] == OWNER


# ---- the second step: the sweep sees SLURM's word ---------------------------


def _sweep(db, anvil, job_id="job-1"):
    asyncio.run(slurm.sync_active_jobs())
    return db.jobs.docs[job_id]


def test_a_requested_cancel_that_slurm_confirms_is_cancelled_by_user(db, anvil):
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, "RUNNING", cancel_requested_at=NOW)
    anvil.found["12345"] = _info("CANCELLED by 8013088", "cancelled", exit_code="0:15")
    stored = _sweep(db, anvil)
    assert stored["status"] == "CANCELLED"
    assert stored["failure"]["cause"] == "cancelled_by_user"
    assert stored["slurm_state"] == "CANCELLED by 8013088"
    assert stored["slurm_exit_code"] == "0:15"
    assert stored["slurm_end"].isoformat().startswith("2026-09-30T14:05:00")
    assert stored["completed_at"] == stored["slurm_end"]  # SLURM's end, not the poll's
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "job_status_changed"]
    assert event["detail"]["from"] == "RUNNING" and event["detail"]["to"] == "CANCELLED"
    assert event["detail"]["cause"] == "cancelled_by_user"


def test_slurm_cancelled_without_a_request_is_cancelled_by_system(db, anvil):
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, "RUNNING")
    anvil.found["12345"] = _info("CANCELLED", "cancelled")
    stored = _sweep(db, anvil)
    assert stored["status"] == "CANCELLED"
    assert stored["failure"]["cause"] == "cancelled_by_system"


def test_a_cancel_that_came_too_late_leaves_the_real_completion(db, anvil):
    db.jobs.docs["job-1"] = make_sent_job(
        "job-1", OWNER, "RUNNING", cancel_requested_at=NOW
    )
    anvil.found["12345"] = _info("COMPLETED", "succeeded")
    anvil.files[f"{DIR}/outcome.json"] = json.dumps(SUCCESS_OUTCOME)
    stored = _sweep(db, anvil)
    assert stored["status"] == "COMPLETED"
    assert stored["failure"] is None
    assert stored["files"] == "present"


# ---- the race with a submit that has not heard SLURM's answer ---------------


SUBMIT = "/api/v1/jobs/job-1/submit"


def _submitted(job_id: str = "job-1") -> SubmittedJob:
    return SubmittedJob(
        internal_job_id="slurmly-1a2b3c4d",
        slurm_job_id="777",
        remote_job_dir=DIR,
        remote_script_path=f"{DIR}/run.sh",
        stdout_path=f"{DIR}/stdout.log",
        stderr_path=f"{DIR}/stderr.log",
        submitted_at="2026-09-30T00:00:00Z",
    )


def _cancel_lands_during_the_submit(db, monkeypatch):
    """Replace the submit with one during which the user's cancel is answered:
    the job is CANCELLED, with no SLURM id, before sbatch's answer arrives."""

    async def submit_job(job, snapshot, body, post_processing=False):
        db.jobs.docs["job-1"].update(
            status="CANCELLED", cancel_requested_by=OWNER, cancel_requested_at=job.updated_at
        )
        return _submitted()

    monkeypatch.setattr(slurm, "submit_job", submit_job)


def test_a_cancel_landing_between_claim_and_record_scancels_what_slurm_answered(
    client, db, scancels, monkeypatch
):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    _cancel_lands_during_the_submit(db, monkeypatch)
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 202
    assert scancels == ["777"]
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "CANCELLED"  # the submit did not undo the cancel
    assert response.json()["status"] == "CANCELLED"
    # Where the files are is kept, so a delete can remove them.
    assert stored["remote_job_dir"] == DIR
    assert "orphan_sim_ids" not in stored


def test_if_that_scancel_fails_the_name_is_kept_for_the_sweep(client, db, monkeypatch):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    _cancel_lands_during_the_submit(db, monkeypatch)

    async def cancel_job(slurm_job_id):
        raise RuntimeError("down")

    monkeypatch.setattr(slurm, "cancel_job", cancel_job)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "CANCELLED"
    assert stored["orphan_sim_ids"] == [stored["sim_id"]]


# ---- mission 2026-10-06: every failure is handled ---------------------------


@pytest.mark.parametrize("status", ["DRAFT", "COMPLETED", "FAILED", "CANCELLED"])
def test_cancelling_what_cannot_be_cancelled_answers_code_and_message(client, db, scancels, status):
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, status)
    response = client.post(CANCEL, headers=HEADERS)
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "not_cancellable"
    assert detail["current"] == status
    assert status.lower() in detail["message"]
    assert "Cannot cancel job in state" not in detail["message"]


def test_a_cancel_before_sbatch_answered_keeps_the_name_for_a_scancel(client, db, scancels):
    """The submit may have run sbatch and not yet written the id: a job may
    exist. The name is kept (the sweep scancels it by name) and the request
    itself makes no SSH call."""
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "SUBMITTED")
    db.jobs.docs["job-1"]["slurm_job_id"] = None
    assert client.post(CANCEL, headers=HEADERS).status_code == 200
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "CANCELLED"
    assert stored["orphan_sim_ids"] == ["sim-job-1"]
    assert db.cleanup_calls == []


def test_the_sweep_then_scancels_that_name_and_clears_it(client, db, anvil, monkeypatch):
    monkeypatch.setattr(slurm, "scancel_by_name", REAL_SCANCEL_BY_NAME)
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "SUBMITTED")
    db.jobs.docs["job-1"]["slurm_job_id"] = None
    client.post(CANCEL, headers=HEADERS)
    asyncio.run(slurm.clear_orphans())
    assert anvil.commands == ["scancel --name=sim-job-1 --user=x-openghm"]
    assert db.jobs.docs["job-1"]["orphan_sim_ids"] == []


def test_an_admins_cancel_before_the_queue_does_not_say_you_cancelled(client, db, scancels):
    db.users.docs["root"] = make_user("root", Role.ADMIN)
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "SUBMITTED")
    db.jobs.docs["job-1"]["slurm_job_id"] = None
    response = client.post(CANCEL, headers=token_for("root", Role.ADMIN))
    assert response.status_code == 200
    body = response.json()
    assert body["cancel_requested_by_email"] == "root@example.org"
    for text in (body["status_reason"], body["failure"]["message"]):
        assert "You" not in text and "OpenGHM" in text
    assert body["failure"]["cause"] == "cancelled_by_user"  # a cancel the gateway recorded


def test_a_cancel_the_sweep_confirms_does_not_say_you_cancelled_either(db, anvil):
    db.jobs.docs["job-1"] = make_sent_job(
        "job-1", OWNER, "RUNNING", cancel_requested_at=NOW, cancel_requested_by="root"
    )
    anvil.found["12345"] = _info("CANCELLED", "cancelled")
    stored = _sweep(db, anvil)
    assert "You" not in stored["failure"]["message"]


def test_a_cancel_recorded_while_the_verdict_was_being_read_still_counts(db, anvil, monkeypatch):
    """The sweep read the document, then SSH for the record and stderr, and the
    user's cancel landed meanwhile: SLURM's CANCELLED is theirs, not the system's."""
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, "RUNNING")
    anvil.found["12345"] = _info("CANCELLED", "cancelled")
    real = slurm.read_outcome

    async def read_then_a_cancel_lands(remote_job_dir):
        result = await real(remote_job_dir)
        db.jobs.docs["job-1"].update(cancel_requested_at=NOW, cancel_requested_by=OWNER)
        return result

    monkeypatch.setattr(slurm, "read_outcome", read_then_a_cancel_lands)
    stored = _sweep(db, anvil)
    assert stored["status"] == "CANCELLED"
    assert stored["failure"]["cause"] == "cancelled_by_user"
