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
    assert [c for c in anvil.commands if not c.startswith("sacct ")] == []  # no record is read


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
    assert [c for c in anvil.commands if not c.startswith("sacct ")] == []


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


# ---- absence counts only when the lookup worked -------------------------------
# slurmly answers a failed squeue and a failed sacct with the same empty result
# as a job that is not there, so the sweep asks sacct again itself, where the
# exit status and the output can be seen (open item 23, ADR 0026 rule 4).


def broken_sacct(anvil, answer=(1, "", "slurm_load_jobs error: Unable to contact slurm controller")):
    anvil.results.append((lambda c: c.startswith("sacct "), answer))


def lost_clock(db, seconds_ago: float):
    stored = db.jobs.docs["job-1"]
    stored["missing_since"] = mongo_time(-timedelta(seconds=seconds_ago))
    return stored["missing_since"]


@pytest.mark.parametrize(
    "answer",
    [
        (1, "", "slurm_load_jobs error: Unable to contact slurm controller"),
        (0, "", ""),  # exit 0 and no output: no JSON document at all
        (0, "not json", ""),
        (0, '{"errors": [{"error": "x"}], "jobs": []}', ""),
        (0, '{"errors": []}', ""),  # a document, but not a list of jobs
        SSHTransportError("down"),
    ],
)
def test_a_failed_lookup_tick_records_no_miss(db, anvil, job, answer):
    broken_sacct(anvil, answer)
    before = dict(job)
    sweep()
    assert db.jobs.docs["job-1"] == before  # no missing_since
    assert any(c.startswith("sacct ") for c in anvil.commands)


@pytest.mark.parametrize("answer", [(1, "", "unreachable"), (0, "", "")])
def test_a_failed_lookup_tick_does_not_advance_the_lost_clock(db, anvil, job, answer):
    since = lost_clock(db, settings.JOB_LOST_AFTER_SECONDS + 5)
    broken_sacct(anvil, answer)
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "SUBMITTED"
    assert stored["missing_since"] == since
    assert not [e for e in db.audit_events.docs.values() if e["action"] == "job_status_changed"]


def test_the_next_tick_that_works_judges_the_job(db, anvil, job):
    lost_clock(db, settings.JOB_LOST_AFTER_SECONDS + 5)
    anvil.results.append((lambda c: c.startswith("sacct "), (1, "", "down")))
    sweep()
    assert db.jobs.docs["job-1"]["status"] == "SUBMITTED"
    anvil.results.clear()
    sweep()
    assert db.jobs.docs["job-1"]["status"] == "FAILED"
    assert db.jobs.docs["job-1"]["failure"]["cause"] == "lost"


def test_a_real_absence_on_a_working_tick_counts(db, anvil, job):
    sweep()
    assert db.jobs.docs["job-1"]["missing_since"] is not None  # first miss, sacct answered
    lost_clock(db, settings.JOB_LOST_AFTER_SECONDS + 5)
    sweep()
    assert db.jobs.docs["job-1"]["failure"]["cause"] == "lost"


def test_a_single_tracked_job_that_is_gone_can_still_be_lost(db, anvil, job):
    # One job, absent from the batch: "every job absent" cannot tell a failed
    # lookup from a vanished job, which is why the second sacct is the judge.
    assert len(anvil.lookups) == 0
    lost_clock(db, settings.JOB_LOST_AFTER_SECONDS + 5)
    sweep()
    assert anvil.lookups == [["12345"]]
    assert db.jobs.docs["job-1"]["failure"]["cause"] == "lost"


def test_every_job_absent_on_a_tick_where_sacct_failed_is_nobody_lost(db, anvil, job):
    db.jobs.docs["job-2"] = make_sent_job("job-2", "owner", "RUNNING", slurm_job_id="12346")
    for stored in db.jobs.docs.values():
        stored["missing_since"] = mongo_time(-timedelta(hours=1))
    broken_sacct(anvil)
    sweep()
    assert {d["status"] for d in db.jobs.docs.values()} == {"SUBMITTED", "RUNNING"}


def test_some_jobs_absent_are_judged_while_others_are_found(db, anvil, job):
    db.jobs.docs["job-2"] = make_sent_job("job-2", "owner", "SUBMITTED", slurm_job_id="12346")
    lost_clock(db, settings.JOB_LOST_AFTER_SECONDS + 5)
    anvil.found["12346"] = info("RUNNING", "running", slurm_id="12346")
    sweep()
    assert db.jobs.docs["job-1"]["failure"]["cause"] == "lost"
    assert db.jobs.docs["job-2"]["status"] == "RUNNING"


def test_a_job_the_second_sacct_finds_is_not_absent(db, anvil, job):
    lost_clock(db, settings.JOB_LOST_AFTER_SECONDS + 5)
    row = {"job_id": 12345, "name": "x", "state": {"current": ["RUNNING"], "reason": "None"},
           "time": {"start": 1790000000, "end": 0}}
    anvil.results.append((lambda c: c.startswith("sacct "), (0, json.dumps({"jobs": [row], "errors": []}), "")))
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "RUNNING"
    assert "missing_since" not in stored


def test_nothing_absent_costs_no_extra_command(db, anvil, job):
    anvil.found["12345"] = info("RUNNING", "running")
    sweep()
    assert anvil.commands == []


def test_the_status_poll_of_an_unchecked_absence_records_nothing(db, anvil, job):
    broken_sacct(anvil)
    before = dict(job)
    doc = asyncio.run(REAL_UPDATE_JOB_STATUS("job-1"))
    assert doc["status"] == "SUBMITTED"
    assert db.jobs.docs["job-1"] == before


def test_the_status_poll_of_a_checked_absence_notes_the_miss(db, anvil, job):
    asyncio.run(REAL_UPDATE_JOB_STATUS("job-1"))
    assert db.jobs.docs["job-1"]["missing_since"] is not None


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


# ---- mission 2026-10-06: a submit the gateway lost track of --------------------


def reconcile():
    asyncio.run(slurm.reconcile_interrupted_submits())


def stuck(db, job_id="job-1", age=timedelta(minutes=10), **extra):
    """A claimed job with no SLURM id, last written `age` ago."""
    doc = make_sent_job(job_id, "owner", "SUBMITTED", slurm_job_id=None, **extra)
    doc["updated_at"] = (now() - age).replace(microsecond=0)  # as BSON keeps it
    db.jobs.docs[job_id] = doc
    return doc


def test_a_claim_with_no_slurm_id_for_minutes_is_cancelled_by_name_and_given_back(db):
    stuck(db)
    reconcile()
    assert db.cleanup_calls == [
        ("scancel_by_name", "sim-job-1"),
        ("remove_failed_submit_dirs", "sim-job-1"),
    ]
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "DRAFT"
    assert not {"sim_id", "toolkit", "work_dir"} & set(stored)
    assert stored["slurm_job_name"] == ""
    assert stored["last_submit_error"]["code"] == "submit_interrupted"
    assert "interrupted" in stored["last_submit_error"]["message"]
    assert "cancelled" in stored["last_submit_error"]["message"]
    assert not stored.get("orphan_sim_ids")
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "job_submit_interrupted"]
    assert event["target_id"] == "job-1" and event["detail"] == {
        "sim_id": "sim-job-1", "cancelled": True, "user_id": "owner",
    }


def test_a_claim_still_inside_the_grace_period_is_left_alone(db):
    stuck(db, age=timedelta(seconds=settings.JOB_SUBMIT_INTERRUPTED_AFTER_SECONDS - 60))
    reconcile()
    assert db.cleanup_calls == []
    assert db.jobs.docs["job-1"]["status"] == "SUBMITTED"


def test_the_grace_period_outlasts_the_submits_own_timeouts():
    # sbatch is one of a few SSH commands of at most 30 s each (slurmly's
    # command_timeout_seconds, after a 10 s connect): minutes of room, not seconds.
    assert settings.JOB_SUBMIT_INTERRUPTED_AFTER_SECONDS >= 180


def test_a_job_with_a_slurm_id_a_draft_and_a_finished_job_are_not_reconciled(db):
    db.jobs.docs["a"] = make_sent_job("a", "owner", "SUBMITTED")  # has an id
    db.jobs.docs["b"] = make_job("b", "owner", "DRAFT")
    db.jobs.docs["c"] = make_sent_job("c", "owner", "FAILED", slurm_job_id=None)
    for doc in db.jobs.docs.values():
        doc["updated_at"] = (now() - timedelta(hours=1)).replace(microsecond=0)
    before = {k: dict(v) for k, v in db.jobs.docs.items()}
    reconcile()
    assert db.jobs.docs == before and db.cleanup_calls == []


@pytest.mark.parametrize("how", ["fails", "raises"])
def test_if_scancel_cannot_run_the_name_goes_to_the_orphans_the_sweep_retries(db, monkeypatch, how):
    stuck(db)

    async def scancel_by_name(sim_id):
        if how == "raises":
            raise SSHTransportError("down")
        return False

    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    reconcile()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "DRAFT"
    assert stored["last_submit_error"]["code"] == "submit_interrupted"
    assert stored["orphan_sim_ids"] == ["sim-job-1"]
    assert db.cleanup_calls == []  # no directory removed after a scancel that did not run


def test_the_orphan_is_then_cancelled_by_the_orphan_pass(db, anvil, monkeypatch):
    stuck(db)

    async def down(sim_id):
        return False

    monkeypatch.setattr(slurm, "scancel_by_name", down)
    reconcile()
    monkeypatch.setattr(slurm, "scancel_by_name", REAL_SCANCEL_BY_NAME)
    asyncio.run(slurm.clear_orphans())
    assert anvil.commands == ["scancel --name=sim-job-1 --user=x-openghm"]
    assert db.jobs.docs["job-1"]["orphan_sim_ids"] == []


def test_a_submit_that_recorded_its_id_during_the_sweep_is_not_given_back(db, monkeypatch):
    """The scancel took a while and a slow submit wrote its id meanwhile: the
    conditional write misses, the job is not turned into a DRAFT under it, and
    the name stays for a scancel of what may be running."""
    stuck(db)

    async def scancel_while_the_submit_records(sim_id):
        db.jobs.docs["job-1"].update(slurm_job_id="999", updated_at=now())
        return True

    monkeypatch.setattr(slurm, "scancel_by_name", scancel_while_the_submit_records)
    reconcile()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "SUBMITTED" and stored["slurm_job_id"] == "999"
    assert "last_submit_error" not in stored
    assert not [e for e in db.audit_events.docs.values() if e["action"] == "job_submit_interrupted"]


# ---- SLURM's NO_VAL is not a time ------------------------------------------------

NO_VAL_ISO = "2106-02-07T06:28:14Z"  # what slurmly makes of 4294967294


@pytest.mark.parametrize(
    "value",
    [NO_VAL_ISO, "2106-02-07T06:28:14", 4294967294, 4294967295, 0, "1970-01-01T00:00:00Z",
     datetime(2106, 2, 7, 6, 28, 14, tzinfo=timezone.utc), datetime(2106, 2, 7, 6, 28, 14),
     "2100-01-01T00:00:00Z", "Unknown", "", None, "garbage", True],
)
def test_a_time_slurm_does_not_have_is_none(value):
    assert slurm._as_utc(value) is None


@pytest.mark.parametrize(
    "value",
    ["2026-09-30T14:00:00Z", "2026-09-30T14:00:00", datetime(2026, 9, 30, 14), 1790000000],
)
def test_a_real_time_still_parses(value):
    assert slurm._as_utc(value).year == 2026


def test_slurmly_turns_no_val_into_2106(db):
    """The input of the bug: the parser keeps the sentinel as a date."""
    from slurmly.slurm.parser import _epoch_to_iso

    assert _epoch_to_iso(4294967294) == NO_VAL_ISO


def test_a_job_cancelled_while_queued_stores_no_start_time(db, anvil, job):
    """Seen live: sacct reported NO_VAL for the start of a job cancelled before it
    ran, and the page showed "Waited 695470 h"."""
    job["cancel_requested_at"] = now()
    anvil.found["12345"] = info("CANCELLED by 8013088", "cancelled", start_time=NO_VAL_ISO,
                                end_time="2026-09-30T14:05:00Z", exit_code="0:0")
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "CANCELLED"
    assert "slurm_start" not in stored
    assert stored["started_at"] is None
    assert stored["slurm_end"].isoformat().startswith("2026-09-30T14:05:00")
    assert stored["completed_at"] == stored["slurm_end"]


def test_an_end_time_of_no_val_falls_back_to_when_the_sweep_saw_it(db, anvil, job):
    anvil.found["12345"] = info("CANCELLED", "cancelled", start_time=NO_VAL_ISO, end_time=NO_VAL_ISO)
    sweep()
    stored = db.jobs.docs["job-1"]
    assert "slurm_end" not in stored
    assert stored["completed_at"].year == now().year


def test_a_running_job_with_no_val_start_is_given_the_time_it_was_seen(db, anvil, job):
    anvil.found["12345"] = info("RUNNING", "running", start_time=NO_VAL_ISO)
    sweep()
    assert db.jobs.docs["job-1"]["slurm_start"].year == now().year


def test_the_backfill_does_not_store_no_val_either(db, anvil, settled_from_squeue):
    anvil.found["12345"] = info("COMPLETED", "succeeded", start_time=NO_VAL_ISO)
    backfill()
    stored = db.jobs.docs["job-1"]
    assert stored["slurm_end"] is not None and stored.get("slurm_start") is None


def test_a_job_stored_with_the_2106_start_reads_without_it(client, db):
    """The dev job that already carries it: shown with no start, not 695470 h."""
    from route_helpers import make_user, token_for

    no_val = datetime(2106, 2, 7, 6, 28, 14, tzinfo=timezone.utc)
    db.users.docs["owner"] = make_user("owner", can_run_simulations=True)
    db.jobs.docs["job-1"] = make_sent_job(
        "job-1", "owner", "CANCELLED", slurm_start=no_val, started_at=no_val,
        slurm_end=datetime(2026, 9, 30, 14, 5, tzinfo=timezone.utc),
        completed_at=datetime(2026, 9, 30, 14, 5, tzinfo=timezone.utc),
    )
    headers = token_for("owner")
    for path in ("", "/status"):
        body = client.get(f"/api/v1/jobs/job-1{path}", headers=headers).json()
        assert body["started_at"] is None and body["slurm_start"] is None
        assert body["slurm_end"].startswith("2026-09-30T14:05")
        assert body["completed_at"].startswith("2026-09-30T14:05")
    listed = client.get("/api/v1/jobs", headers=headers).json()["items"][0]
    assert listed["started_at"] is None and listed["slurm_start"] is None


# ---- the verdict reads what the job left, whatever it is ------------------------


def test_stderr_is_read_through_the_base64_reader_and_decoded_leniently(db, anvil, job):
    """slurmly's tail decodes strictly: one byte that is not UTF-8 failed its
    command (exit -1) and the excerpt came back empty."""
    anvil.found["12345"] = info("TIMEOUT", "timeout")
    anvil.files[STDERR] = b"slurmstepd: error: DUE TO TIME LIMIT\nlatin-1 \xe9 and \xff\xfe bytes\nlast line\n"
    sweep()
    excerpt = db.jobs.docs["job-1"]["failure"]["excerpt"]
    assert excerpt.splitlines()[0] == "slurmstepd: error: DUE TO TIME LIMIT"
    assert "latin-1 � and �� bytes" in excerpt
    assert excerpt.splitlines()[-1] == "last line"
    commands = [c for c in anvil.commands if "base64" in c]
    assert len(commands) == 1 and "stderr.log" in commands[0]
    assert not any("tail -n" in c for c in anvil.commands)  # slurmly's strict tail is not used


def test_only_the_end_of_a_long_stderr_is_read(db, anvil, job):
    anvil.found["12345"] = info("TIMEOUT", "timeout")
    anvil.files[STDERR] = "".join(f"line {i}\n" for i in range(20000))
    sweep()
    excerpt = db.jobs.docs["job-1"]["failure"]["excerpt"]
    assert excerpt.splitlines()[-1] == "line 19999" and len(excerpt.splitlines()) == 60


def test_a_job_with_no_stderr_file_has_no_excerpt_and_still_gets_its_verdict(db, anvil, job):
    anvil.found["12345"] = info("TIMEOUT", "timeout")
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED" and stored["failure"]["excerpt"] is None


def test_failed_to_warp_on_stderr_fails_a_job_whose_log_and_exit_are_clean(db, anvil, job):
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    anvil.files[OUTCOME] = json.dumps(SUCCESS_OUTCOME)
    anvil.files[STDERR] = "\nFailed to warp /m/precip_2001.nc\n\tFork code = 9\n"
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED"
    assert stored["failure"]["cause"] == "wbm_silent_failure"
    assert "Failed to warp" in stored["failure"]["message"]
    assert "precip_2001.nc" in stored["failure"]["excerpt"]


@pytest.mark.parametrize(
    "record",
    [{"steps": []}, {"steps": {"fetch": [], "run": []}}, {"wbm": [1]}, {"output": "x"},
     {"schema": 1, "steps": {"fetch": {"exit_code": "0"}, "run": {"exit_code": "0"}}}],
)
def test_a_record_of_the_wrong_shape_ends_the_job_instead_of_being_retried_forever(db, anvil, job, record):
    """classify used to raise AttributeError on `steps` being a list, which the
    sweep caught per job and tried again every tick."""
    anvil.found["12345"] = info("COMPLETED", "succeeded")
    anvil.files[OUTCOME] = json.dumps(record)
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED"
    assert stored["failure"]["cause"] == "outcome_missing"
    assert stored["outcome"] == record
    # and what it stores does not break the pages that read it
    from app.api.v1.jobs import _doc_to_response, _status_response

    _doc_to_response(stored)
    _status_response(stored)


def test_a_malformed_stored_record_does_not_break_the_log_path(db, anvil, job):
    job.update(status="FAILED", outcome={"wbm": ["not", "an", "object"]})
    anvil.results.append((lambda c: "wbm_init" in c, (3, "", "")))
    assert asyncio.run(slurm.log_path(job, "wbm")) is None


# ---- messages that need the job's own facts -------------------------------------


def snapshot_recommending(db, walltime):
    db.datasets.docs["ds-1"] = {
        "_id": "ds-1",
        "document": {"simulation": {"recommendedCompute": {"cores": 16, "walltime": walltime}}},
    }


def test_a_timeout_at_the_96_hour_maximum_says_to_shorten_the_period(db, anvil, job):
    job["slurm_config"] = {"cores": 8, "walltime": "96:00:00"}
    anvil.found["12345"] = info("TIMEOUT", "timeout")
    sweep()
    message = db.jobs.docs["job-1"]["failure"]["message"]
    assert "already the 96 h maximum" in message and "longer walltime" not in message


def test_a_timeout_of_a_shorter_walltime_offers_a_longer_one(db, anvil, job):
    job["slurm_config"] = {"cores": 8, "walltime": "06:00:00"}
    anvil.found["12345"] = info("TIMEOUT", "timeout")
    sweep()
    message = db.jobs.docs["job-1"]["failure"]["message"]
    assert "longer walltime (up to 96 h)" in message and "maximum" not in message


def test_the_walltime_of_a_draft_with_none_of_its_own_is_the_snapshots_with_headroom(db, anvil, job):
    """80 h recommended: with headroom it is 120 h, which the submit capped at 96 h."""
    snapshot_recommending(db, "80:00:00")
    anvil.found["12345"] = info("TIMEOUT", "timeout")
    sweep()
    assert "already the 96 h maximum" in db.jobs.docs["job-1"]["failure"]["message"]


@pytest.mark.parametrize(
    "choice, maximum",
    [("climatology", True), ("standard", False), (None, False)],
)
def test_the_walltime_of_a_climatology_draft_includes_its_post_processing_time(db, anvil, job, choice, maximum):
    """50 h recommended is 75 h with headroom; with 30 h of post-processing it is 80 h, 120 h with
    headroom, which the submit capped at 96 h."""
    snapshot_recommending(db, "50:00:00")
    db.datasets.docs["ds-1"]["document"]["simulation"]["recommendedCompute"]["postProcessingWalltime"] = "30:00:00"
    job["parameters"]["post_processing"] = choice
    anvil.found["12345"] = info("TIMEOUT", "timeout")
    sweep()
    message = db.jobs.docs["job-1"]["failure"]["message"]
    assert ("already the 96 h maximum" in message) is maximum


def test_an_out_of_memory_job_is_told_how_much_memory_its_cores_gave(db, anvil, job):
    job["slurm_config"] = {"cores": 4, "walltime": "06:00:00"}
    anvil.found["12345"] = info("OUT_OF_MEMORY", "failed")
    sweep()
    message = db.jobs.docs["job-1"]["failure"]["message"]
    assert "had 4 cores" in message and "about 7.6 GB in all" in message


def test_an_out_of_memory_job_with_the_snapshot_gone_is_still_told_to_add_cores(db, anvil, job):
    job["slurm_config"] = {"cores": None, "walltime": None}
    del db.datasets.docs["ds-1"]
    anvil.found["12345"] = info("OUT_OF_MEMORY", "failed")
    sweep()
    message = db.jobs.docs["job-1"]["failure"]["message"]
    assert "more cores" in message and "had" not in message


def test_a_timeout_whose_snapshot_is_gone_still_gets_a_verdict(db, anvil, job):
    del db.datasets.docs["ds-1"]
    anvil.found["12345"] = info("TIMEOUT", "timeout")
    sweep()
    assert db.jobs.docs["job-1"]["failure"]["cause"] == "timeout"


def test_a_timeout_during_the_fetch_is_worded_for_the_fetch(db, anvil, job):
    rec = failing(phase="fetch", signal="TERM", steps={"fetch": {"exit_code": None}}, staged=False)
    anvil.found["12345"] = info("TIMEOUT", "timeout")
    anvil.files[OUTCOME] = json.dumps(rec)
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["failure"]["phase"] == "fetch"
    assert "fetching the snapshot" in stored["failure"]["message"]


def test_a_job_slurm_marks_failed_with_exit_137_and_no_record_is_probably_out_of_memory(db, anvil, job):
    anvil.found["12345"] = info("FAILED", "failed", exit_code="137:0")
    sweep()
    message = db.jobs.docs["job-1"]["failure"]["message"]
    assert "ran out of memory" in message and "more cores" in message
