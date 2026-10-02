"""The sweep (ADR 0026, mission 2026-09-30-every-job-ends-with-a-verdict): one
batched lookup per tick, a verdict stored the first time a job is seen over,
a job SLURM has forgotten judged only after a while, every write conditional,
and the two housekeeping passes (orphaned submits, purged work directories).

slurmly's real client runs over a fake transport (tests/conftest.py `anvil`);
the batched lookup and the files it finds are set per test.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from slurmly.exceptions import SSHTransportError
from slurmly.models import JobInfo

from app.core.config import settings
from app.services import slurm

from conftest import REMOTE_BASE
from route_helpers import OUTPUT_BASE, SUCCESS_OUTCOME, make_job, make_sent_job

# conftest replaces these with fakes for the route tests; the sweep tests want
# the real ones, and the module is imported before any fixture runs.
REAL_UPDATE_JOB_STATUS = slurm.update_job_status
REAL_SCANCEL_BY_NAME = slurm.scancel_by_name

DIR = f"{REMOTE_BASE}/jobs/slurmly-1a2b3c4d"
OUTCOME = f"{DIR}/outcome.json"
STDERR = f"{DIR}/stderr.log"


def now() -> datetime:
    return datetime.now(timezone.utc)


def mongo_time(delta: timedelta) -> datetime:
    """A time as Mongo hands it back: naive, in UTC."""
    return (now() + delta).replace(tzinfo=None)


def info(state: str, lifecycle: str, slurm_id: str = "12345", **kw) -> JobInfo:
    return JobInfo(
        slurm_job_id=slurm_id,
        lifecycle=lifecycle,
        raw_state=state,
        exit_code=kw.pop("exit_code", "0:0"),
        start_time=kw.pop("start_time", "2026-09-30T14:00:00Z"),
        end_time=kw.pop("end_time", "2026-09-30T14:14:00Z"),
        source="sacct",
        **kw,
    )


def sweep():
    asyncio.run(slurm.sync_active_jobs())


@pytest.fixture
def job(db):
    db.jobs.docs["job-1"] = make_sent_job("job-1", "owner", "SUBMITTED")
    return db.jobs.docs["job-1"]


def failing(**changes) -> dict:
    rec = json.loads(json.dumps(SUCCESS_OUTCOME))
    rec.update(changes)
    rec["ok"] = False
    return rec


# ---- one batched lookup ------------------------------------------------------


def test_every_active_job_is_looked_up_in_one_call(db, anvil):
    for n, status in enumerate(["SUBMITTED", "RUNNING", "PENDING"], start=1):
        db.jobs.docs[f"j{n}"] = make_sent_job(f"j{n}", "owner", status, slurm_job_id=str(100 + n))
    db.jobs.docs["done"] = make_sent_job("done", "owner", "COMPLETED", slurm_job_id="999")
    db.jobs.docs["draft"] = make_job("draft", "owner", "DRAFT")
    db.jobs.docs["claimed"] = make_sent_job("claimed", "owner", "SUBMITTED", slurm_job_id=None)
    sweep()
    assert len(anvil.lookups) == 1
    assert sorted(anvil.lookups[0]) == ["101", "102", "103"]


def test_no_active_job_means_no_lookup(db, anvil):
    db.jobs.docs["done"] = make_sent_job("done", "owner", "COMPLETED")
    sweep()
    assert anvil.lookups == [] and anvil.commands == []


def test_a_failed_lookup_skips_the_whole_tick(db, anvil, job):
    anvil.lookup_error = SSHTransportError("connection reset")
    before = dict(job)
    sweep()
    assert db.jobs.docs["job-1"] == before  # not even a miss recorded
    assert anvil.commands == []


# ---- a job that is still going ----------------------------------------------


def test_queued_and_running_update_the_status_and_time(db, anvil, job):
    anvil.found["12345"] = info("PENDING", "queued")
    sweep()
    assert db.jobs.docs["job-1"]["status"] == "SUBMITTED"
    assert db.jobs.docs["job-1"]["slurm_state"] == "PENDING"

    anvil.found["12345"] = info("RUNNING", "running")
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "RUNNING"
    assert stored["slurm_state"] == "RUNNING"
    assert stored["started_at"] is not None
    assert stored["slurm_start"].isoformat().startswith("2026-09-30T14:00:00")
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "job_status_changed"]
    assert (event["detail"]["from"], event["detail"]["to"]) == ("SUBMITTED", "RUNNING")


def test_a_poll_that_finds_no_change_writes_and_logs_nothing(db, anvil, job):
    anvil.found["12345"] = info("RUNNING", "running")
    sweep()
    settled = dict(db.jobs.docs["job-1"])
    events = len(db.audit_events.docs)
    sweep()
    assert db.jobs.docs["job-1"] == settled
    assert len(db.audit_events.docs) == events


def test_finding_a_job_again_clears_the_miss(db, anvil, job):
    job["missing_since"] = mongo_time(-timedelta(minutes=3))
    anvil.found["12345"] = info("RUNNING", "running")
    sweep()
    assert "missing_since" not in db.jobs.docs["job-1"]


def test_an_unknown_state_changes_nothing(db, anvil, job):
    anvil.found["12345"] = info("WEIRD_NEW_STATE", "unknown")
    before = dict(job)
    sweep()
    assert db.jobs.docs["job-1"] == before


# ---- a job that is over ------------------------------------------------------


def test_a_clean_finish_stores_the_verdict_with_everything_it_rests_on(db, anvil, job):
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    anvil.files[OUTCOME] = json.dumps(SUCCESS_OUTCOME)
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "COMPLETED"
    assert stored["failure"] is None and stored["status_reason"] is None
    assert stored["outcome"] == SUCCESS_OUTCOME
    assert stored["slurm_state"] == "COMPLETED" and stored["slurm_exit_code"] == "0:0"
    assert stored["slurm_start"].isoformat().startswith("2026-09-30T14:00:00")
    assert stored["slurm_end"].isoformat().startswith("2026-09-30T14:14:00")
    assert stored["completed_at"] == stored["slurm_end"]
    assert stored["started_at"] == stored["slurm_start"]  # never seen running
    assert stored["files"] == "present"
    assert anvil.commands[0].startswith(f"[ -f {OUTCOME}")


def test_a_failed_finish_stores_the_cause_and_the_excerpt(db, anvil, job):
    rec = failing(phase="fetch", steps={"fetch": {"exit_code": 1}}, staged=False)
    anvil.found["12345"] = info("FAILED", "failed", exit_code="1:0")
    anvil.files[OUTCOME] = json.dumps(rec)
    anvil.files[STDERR] = "failed:\n  a.nc: HTTP 500\n"
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED"
    assert stored["failure"]["cause"] == "fetch_failed"
    assert stored["failure"]["excerpt"] == "failed:\n  a.nc: HTTP 500"
    assert stored["status_reason"] == stored["failure"]["message"]
    assert stored["slurm_exit_code"] == "1:0"
    assert "files" not in stored  # nothing was staged
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "job_status_changed"]
    assert event["detail"]["cause"] == "fetch_failed" and event["detail"]["to"] == "FAILED"


def test_a_job_slurm_killed_needs_no_record(db, anvil, job):
    anvil.found["12345"] = info("TIMEOUT", "timeout", exit_code="0:15")
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED"
    assert stored["failure"]["cause"] == "timeout"
    assert stored["outcome"] is None


def test_staged_files_are_marked_present_even_when_the_run_failed(db, anvil, job):
    rec = failing(steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 1}}, staged=True)
    anvil.found["12345"] = info("FAILED", "failed", exit_code="1:0")
    anvil.files[OUTCOME] = json.dumps(rec)
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["failure"]["cause"] == "wbm_error"
    assert stored["files"] == "present"


def test_a_malformed_record_is_no_record(db, anvil, job):
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    anvil.files[OUTCOME] = '{"schema": 1, "steps": '
    sweep()
    assert db.jobs.docs["job-1"]["failure"]["cause"] == "outcome_missing"


def test_a_record_that_is_not_an_object_is_no_record(db, anvil, job):
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    anvil.files[OUTCOME] = "[1, 2]"
    sweep()
    assert db.jobs.docs["job-1"]["failure"]["cause"] == "outcome_missing"


def test_an_unreadable_record_waits_for_the_next_tick(db, anvil, job):
    """Not being able to *look* is not the same as the job having left no
    record: nothing is written, so the next tick reads it again."""
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    anvil.results.append((lambda c: "outcome.json" in c, SSHTransportError("down")))
    before = dict(job)
    sweep()
    assert db.jobs.docs["job-1"] == before
    anvil.results.clear()
    anvil.files[OUTCOME] = json.dumps(SUCCESS_OUTCOME)
    sweep()
    assert db.jobs.docs["job-1"]["status"] == "COMPLETED"


def test_an_unreadable_stderr_waits_too(db, anvil, job):
    anvil.found["12345"] = info("TIMEOUT", "timeout")
    anvil.results.append((lambda c: "tail" in c, SSHTransportError("down")))
    sweep()
    assert db.jobs.docs["job-1"]["status"] == "SUBMITTED"


def test_a_job_moved_by_someone_else_is_not_overwritten(db, anvil, job, monkeypatch):
    """The user's cancel (or another sweep) wins the job between this tick's
    read and its write: the conditional write misses and changes nothing."""
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    anvil.files[OUTCOME] = json.dumps(SUCCESS_OUTCOME)
    real_get_jobs = anvil.client.get_jobs

    async def get_jobs_then_lose_the_job(ids, **kw):
        found = await real_get_jobs(ids, **kw)
        db.jobs.docs["job-1"]["status"] = "CANCELLED"
        return found

    monkeypatch.setattr(anvil.client, "get_jobs", get_jobs_then_lose_the_job)
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "CANCELLED"
    assert "failure" not in stored and "outcome" not in stored
    assert not [e for e in db.audit_events.docs.values() if e["action"] == "job_status_changed"]


# ---- a job SLURM does not know -----------------------------------------------


def test_the_first_miss_is_only_noted(db, anvil, job):
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "SUBMITTED"
    assert stored["missing_since"] is not None
    assert anvil.commands == []  # nothing is read for a first miss


def test_a_miss_is_not_repeated_while_it_lasts(db, anvil, job):
    sweep()
    first = db.jobs.docs["job-1"]["missing_since"]
    sweep()
    assert db.jobs.docs["job-1"]["missing_since"] == first


def test_a_job_missing_for_a_while_with_no_record_is_lost(db, anvil, job):
    job["missing_since"] = mongo_time(-timedelta(seconds=settings.JOB_LOST_AFTER_SECONDS + 5))
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED"
    assert stored["failure"]["cause"] == "lost"
    assert stored["completed_at"] is not None
    assert "missing_since" not in stored


def test_a_job_missing_for_less_than_the_window_is_left_alone(db, anvil, job):
    job["missing_since"] = mongo_time(-timedelta(seconds=settings.JOB_LOST_AFTER_SECONDS - 60))
    sweep()
    assert db.jobs.docs["job-1"]["status"] == "SUBMITTED"
    assert anvil.commands == []


def test_a_job_missing_for_a_while_is_judged_by_its_record(db, anvil, job):
    job["missing_since"] = mongo_time(-timedelta(hours=1))
    anvil.files[OUTCOME] = json.dumps(SUCCESS_OUTCOME)
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "COMPLETED"
    assert stored["failure"] is None
    assert stored["outcome"] == SUCCESS_OUTCOME
    assert stored["files"] == "present"


def test_a_missing_job_whose_record_says_it_failed_is_failed_for_that_reason(db, anvil, job):
    job["missing_since"] = mongo_time(-timedelta(hours=1))
    rec = failing(steps={"fetch": {"exit_code": 0}, "run": {"exit_code": 2}}, staged=False)
    anvil.files[OUTCOME] = json.dumps(rec)
    sweep()
    assert db.jobs.docs["job-1"]["failure"]["cause"] == "run_refused"


def test_a_job_missing_inside_slurmlys_grace_window_is_not_judged(db, anvil, job):
    job["missing_since"] = mongo_time(-timedelta(hours=1))
    job["slurmly_submitted_at"] = (now() - timedelta(seconds=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    sweep()
    assert db.jobs.docs["job-1"]["status"] == "SUBMITTED"


def test_an_ssh_failure_reading_the_record_of_a_missing_job_does_nothing(db, anvil, job):
    job["missing_since"] = mongo_time(-timedelta(hours=1))
    anvil.results.append((lambda c: "outcome.json" in c, SSHTransportError("down")))
    before = dict(job)
    sweep()
    assert db.jobs.docs["job-1"] == before


# ---- the status poll shares the same path ------------------------------------


def test_the_status_poll_settles_one_job_the_same_way(db, anvil, job):
    anvil.found["12345"] = info("RUNNING", "running")
    doc = asyncio.run(REAL_UPDATE_JOB_STATUS("job-1"))
    assert anvil.lookups == [["12345"]]
    assert doc["status"] == "RUNNING"
    assert db.jobs.docs["job-1"]["status"] == "RUNNING"


def test_the_status_poll_of_a_finished_job_reads_nothing(db, anvil):
    db.jobs.docs["job-1"] = make_sent_job("job-1", "owner", "COMPLETED")
    asyncio.run(REAL_UPDATE_JOB_STATUS("job-1"))
    assert anvil.lookups == [] and anvil.commands == []


def test_the_status_poll_survives_a_failed_lookup(db, anvil, job):
    anvil.lookup_error = SSHTransportError("down")
    doc = asyncio.run(REAL_UPDATE_JOB_STATUS("job-1"))
    assert doc["status"] == "SUBMITTED"


# ---- what the routes then say ---------------------------------------------------


def test_the_verdict_reaches_both_responses_and_the_raw_record_does_not(client, db, anvil, job):
    from route_helpers import make_user, token_for

    db.users.docs["owner"] = make_user("owner", can_run_simulations=True)
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    anvil.files[OUTCOME] = json.dumps(SUCCESS_OUTCOME)
    sweep()
    headers = token_for("owner")
    detail = client.get("/api/v1/jobs/job-1", headers=headers).json()
    polled = client.get("/api/v1/jobs/job-1/status", headers=headers).json()
    for body in (detail, polled):
        assert body["status"] == "COMPLETED"
        assert body["slurm_state"] == "COMPLETED" and body["slurm_exit_code"] == "0:0"
        assert body["slurm_start"].startswith("2026-09-30T14:00:00")
        assert body["slurm_end"].startswith("2026-09-30T14:14:00")
        assert body["files"] == "present"
        assert body["failure"] is None
        assert body["output"]["nc_count"] == 16
        assert body["output"]["file_count"] == 17
        assert body["output"]["total_bytes"] == 123456
        assert body["output"]["truncated"] is False
        assert body["output"]["files"] == [{"path": f"wbm_output/{SUCCESS_OUTCOME['sim_id']}/daily/wbm_2000.nc", "bytes": 1}]
        assert "outcome" not in body
    assert polled["work_dir"] == f"{OUTPUT_BASE}/sim-job-1"
    assert polled["completed_at"] is not None


def test_a_job_stored_before_the_verdict_existed_still_loads(client, db):
    from route_helpers import make_user, token_for

    db.users.docs["owner"] = make_user("owner", can_run_simulations=True)
    db.jobs.docs["job-1"] = make_job("job-1", "owner", "COMPLETED")  # none of the new keys
    for path in ("", "/status"):
        body = client.get(f"/api/v1/jobs/job-1{path}", headers=token_for("owner")).json()
        assert body["failure"] is None and body["output"] is None and body["files"] is None
        assert body["slurm_state"] is None and body["cancel_requested_at"] is None
    from app.models.job import JobDB

    assert JobDB(**db.jobs.docs["job-1"]).orphan_sim_ids == []


# ---- purge detection ----------------------------------------------------------


def _purge(anvil=None):
    asyncio.run(slurm.detect_purged_files())


def _done(db, job_id, **extra):
    db.jobs.docs[job_id] = make_sent_job(job_id, "owner", "COMPLETED", files="present", **extra)


def test_a_work_dir_that_is_gone_is_marked_purged_in_one_command(db, anvil):
    _done(db, "a")
    _done(db, "b")
    _done(db, "c")
    kept = {f"{OUTPUT_BASE}/sim-a", f"{OUTPUT_BASE}/sim-c"}
    anvil.results.append((lambda c: c.startswith("for d in"), (0, "\n".join(sorted(kept)) + "\n", "")))
    _purge()
    (command,) = anvil.commands
    assert command.startswith("for d in ") and command.endswith('; do [ -d "$d" ] && echo "$d"; done')
    for name in ("a", "b", "c"):
        assert f"{OUTPUT_BASE}/sim-{name}" in command
    assert db.jobs.docs["a"]["files"] == "present"
    assert db.jobs.docs["b"]["files"] == "purged"
    assert db.jobs.docs["c"]["files"] == "present"
    assert all(db.jobs.docs[n]["files_checked_at"] is not None for n in "abc")


def test_the_last_test_being_false_is_not_a_failure(db, anvil):
    _done(db, "a")
    anvil.results.append((lambda c: c.startswith("for d in"), (1, "", "")))  # nothing exists
    _purge()
    assert db.jobs.docs["a"]["files"] == "purged"


def test_a_job_is_checked_at_most_once_a_day(db, anvil):
    _done(db, "a")
    anvil.results.append((lambda c: True, (0, f"{OUTPUT_BASE}/sim-a\n", "")))  # it is there
    _purge()
    assert len(anvil.commands) == 1
    _purge()
    assert len(anvil.commands) == 1  # not due yet
    db.jobs.docs["a"]["files_checked_at"] = mongo_time(-timedelta(days=1, minutes=1))
    _purge()
    assert len(anvil.commands) == 2


def test_only_present_files_are_checked(db, anvil):
    _done(db, "a")
    db.jobs.docs["a"]["files"] = "purged"
    db.jobs.docs["run"] = make_sent_job("run", "owner", "RUNNING")
    db.jobs.docs["old"] = make_sent_job("old", "owner", "COMPLETED")  # files unknown
    _purge()
    assert anvil.commands == []


def test_a_failed_check_changes_nothing_and_is_tried_again(db, anvil):
    _done(db, "a")
    anvil.results.append((lambda c: True, SSHTransportError("down")))
    _purge()
    assert db.jobs.docs["a"]["files"] == "present"
    assert "files_checked_at" not in db.jobs.docs["a"]
    anvil.results.clear()
    anvil.results.append((lambda c: True, (255, "", "ssh: connect to host")))
    _purge()
    assert db.jobs.docs["a"]["files"] == "present"
    assert "files_checked_at" not in db.jobs.docs["a"]


def test_paths_are_quoted_in_the_check(db, anvil):
    _done(db, "a", work_dir=f"{OUTPUT_BASE}/sim a; rm -rf ~")
    _purge()
    assert "'" in anvil.commands[0] and "; rm -rf ~'" in anvil.commands[0]


# ---- orphans ------------------------------------------------------------------


@pytest.fixture(autouse=False)
def real_scancel(monkeypatch):
    monkeypatch.setattr(slurm, "scancel_by_name", REAL_SCANCEL_BY_NAME)


def test_orphaned_submits_are_cancelled_by_name_until_it_works(db, anvil, real_scancel):
    db.jobs.docs["job-1"] = make_job("job-1", "owner", "DRAFT")
    db.jobs.docs["job-1"]["orphan_sim_ids"] = ["sim-20260930-aaaaaa", "sim-20260930-bbbbbb"]
    anvil.results.append((lambda c: "bbbbbb" in c, (1, "", "scancel: error: Unable to contact slurm controller")))
    asyncio.run(slurm.clear_orphans())
    assert anvil.commands == [
        "scancel --name=sim-20260930-aaaaaa --user=x-openghm",
        "scancel --name=sim-20260930-bbbbbb --user=x-openghm",
    ]
    assert db.jobs.docs["job-1"]["orphan_sim_ids"] == ["sim-20260930-bbbbbb"]

    anvil.results.clear()
    asyncio.run(slurm.clear_orphans())
    assert db.jobs.docs["job-1"]["orphan_sim_ids"] == []
    asyncio.run(slurm.clear_orphans())
    assert len(anvil.commands) == 3  # an empty list is not asked again


def test_a_transport_failure_keeps_the_orphan(db, anvil, real_scancel):
    db.jobs.docs["job-1"] = make_job("job-1", "owner", "DRAFT")
    db.jobs.docs["job-1"]["orphan_sim_ids"] = ["sim-20260930-aaaaaa"]
    anvil.results.append((lambda c: True, SSHTransportError("down")))
    asyncio.run(slurm.clear_orphans())
    assert db.jobs.docs["job-1"]["orphan_sim_ids"] == ["sim-20260930-aaaaaa"]


def test_jobs_without_orphans_cost_no_command(db, anvil, real_scancel, job):
    db.jobs.docs["job-2"] = make_job("job-2", "owner", "DRAFT")
    asyncio.run(slurm.clear_orphans())
    assert anvil.commands == []


# ---- the end time only sacct has ---------------------------------------------


def squeue_row(state: str = "COMPLETED", lifecycle: str = "succeeded") -> JobInfo:
    """What a finished job looks like while squeue still lists it: no start,
    end or exit code (slurmly's squeue parsing carries none)."""
    return JobInfo(
        slurm_job_id="12345", lifecycle=lifecycle, raw_state=state, source="squeue"
    )


def backfill():
    asyncio.run(slurm.backfill_slurm_end())


def over_for(db, delta: timedelta) -> None:
    """Move a settled job's `completed_at` back, so it has been over for `delta`."""
    db.jobs.docs["job-1"]["completed_at"] = now() - delta


@pytest.fixture
def settled_from_squeue(db, anvil, job):
    anvil.found["12345"] = squeue_row()
    anvil.files[OUTCOME] = json.dumps(SUCCESS_OUTCOME)
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "COMPLETED" and "slurm_end" not in stored
    over_for(db, timedelta(seconds=settings.JOB_END_BACKFILL_RETRY_SECONDS + 5))
    return stored


def test_a_verdict_from_a_squeue_row_has_no_end_time_yet(db, anvil, settled_from_squeue):
    assert settled_from_squeue["slurm_state"] == "COMPLETED"
    assert settled_from_squeue["completed_at"] is not None
    assert settled_from_squeue.get("slurm_end") is None


def test_the_sweep_fills_the_end_time_from_a_sacct_row(db, anvil, settled_from_squeue):
    before = dict(settled_from_squeue)
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    anvil.lookups.clear()
    backfill()
    stored = db.jobs.docs["job-1"]
    assert stored["slurm_end"].isoformat().startswith("2026-09-30T14:14:00")
    assert stored["slurm_start"].isoformat().startswith("2026-09-30T14:00:00")
    assert stored["slurm_exit_code"] == "0:0"
    assert anvil.lookups == [["12345"]]
    for key in ("status", "failure", "outcome", "slurm_state", "completed_at", "files"):
        assert stored[key] == before[key]
    assert "slurm_end_tries" not in stored
    # The one status change is the verdict itself; the backfill adds none.
    assert len([e for e in db.audit_events.docs.values() if e["action"] == "job_status_changed"]) == 1
    anvil.lookups.clear()
    backfill()
    assert anvil.lookups == []  # nothing left to ask about


def test_a_start_time_and_exit_code_already_stored_are_kept(db, anvil, settled_from_squeue):
    stored = db.jobs.docs["job-1"]
    stored["slurm_start"] = datetime(2026, 9, 30, 13, 0, tzinfo=timezone.utc)
    stored["slurm_exit_code"] = "0:9"
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    backfill()
    assert stored["slurm_end"].isoformat().startswith("2026-09-30T14:14:00")
    assert stored["slurm_start"] == datetime(2026, 9, 30, 13, 0, tzinfo=timezone.utc)
    assert stored["slurm_exit_code"] == "0:9"


def test_a_job_that_only_just_ended_is_not_asked_about_yet(db, anvil, settled_from_squeue):
    over_for(db, timedelta(seconds=10))
    anvil.lookups.clear()
    backfill()
    assert anvil.lookups == []


def test_a_job_that_ended_long_ago_is_not_asked_about(db, anvil, settled_from_squeue):
    over_for(db, timedelta(seconds=settings.JOB_END_BACKFILL_WINDOW_SECONDS + 60))
    anvil.lookups.clear()
    backfill()
    assert anvil.lookups == []


def test_a_job_judged_without_slurm_is_not_asked_about(db, anvil, job):
    job["missing_since"] = mongo_time(-timedelta(hours=1))
    sweep()
    assert db.jobs.docs["job-1"]["failure"]["cause"] == "lost"
    over_for(db, timedelta(hours=1))
    anvil.lookups.clear()
    backfill()
    assert anvil.lookups == []


def test_a_sacct_that_never_answers_is_given_up_on(db, anvil, settled_from_squeue):
    """Absent from sacct, or still a squeue row: each costs a try, and after
    the last one the job is not asked about again."""
    before = dict(settled_from_squeue)
    anvil.lookups.clear()
    for n in range(settings.JOB_END_BACKFILL_MAX_TRIES):
        anvil.found.clear()
        if n % 2:
            anvil.found["12345"] = squeue_row()
        backfill()
        stored = db.jobs.docs["job-1"]
        assert stored["slurm_end_tries"] == n + 1
        stored["slurm_end_tried_at"] = now() - timedelta(
            seconds=settings.JOB_END_BACKFILL_RETRY_SECONDS + 5
        )
    assert len(anvil.lookups) == settings.JOB_END_BACKFILL_MAX_TRIES
    backfill()
    assert len(anvil.lookups) == settings.JOB_END_BACKFILL_MAX_TRIES
    stored = db.jobs.docs["job-1"]
    assert stored.get("slurm_end") is None
    for key in ("status", "failure", "outcome", "slurm_state", "completed_at"):
        assert stored[key] == before[key]


def test_a_try_waits_for_the_retry_interval(db, anvil, settled_from_squeue):
    anvil.lookups.clear()
    backfill()
    backfill()  # the first try was just now
    assert len(anvil.lookups) == 1


def test_a_failed_lookup_costs_no_try(db, anvil, settled_from_squeue):
    anvil.lookup_error = SSHTransportError("connection reset")
    backfill()
    assert "slurm_end_tries" not in db.jobs.docs["job-1"]
    anvil.lookup_error = None
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    backfill()
    assert db.jobs.docs["job-1"]["slurm_end"] is not None


def test_a_job_that_changed_status_meanwhile_is_not_written(db, anvil, settled_from_squeue, monkeypatch):
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    real = anvil.client.get_jobs

    async def get_jobs_then_change(ids, **kw):
        found = await real(ids, **kw)
        db.jobs.docs["job-1"]["status"] = "FAILED"
        return found

    monkeypatch.setattr(anvil.client, "get_jobs", get_jobs_then_change)
    backfill()
    assert db.jobs.docs["job-1"].get("slurm_end") is None
