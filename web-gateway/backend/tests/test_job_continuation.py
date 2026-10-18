"""A run longer than one job continues in the next (ADR 0037, mission
2026-10-18-a-run-continues-past-the-time-limit): a job SLURM stops at its time
limit, after WBM saved a newer complete state, is submitted again; otherwise it
ends `timeout` and says why. The sweep, the continuation's submit and its retries,
cancel (in the gap, racing the submit, on the second job), delete and the logs of
each job.

The sweep runs against the in-memory Mongo with slurmly's real client over a fake
transport (tests/conftest.py `anvil`), `openghm sim state` answered by it; the
continuation's own sbatch is a stand-in (`submits`) so each outcome can be chosen.
"""

from __future__ import annotations

import asyncio
import copy
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import pytest
from slurmly import SubmittedJob
from slurmly.exceptions import InvalidJobSpec, SbatchError, SSHTransportError
from slurmly.models import JobInfo

from app.core.config import settings
from app.models.job import JobDB
from app.services import slurm

from conftest import REMOTE_BASE
from route_helpers import OUTPUT_BASE, SUCCESS_OUTCOME, make_job, make_sent_job, make_user, token_for

# conftest replaces these with fakes for the route tests; the reconcile and
# log-cache tests want the real ones.
REAL_READ_LOG = slurm.read_log
REAL_SCANCEL_BY_NAME = slurm.scancel_by_name

OWNER = "owner"
HEADERS = token_for(OWNER)
HOME = "/home/x-openghm/apps/openghm/abc1234"
WORK = f"{OUTPUT_BASE}/sim-job-1"
STATE_COMMAND = f"{HOME}/bin/openghm sim state {WORK} --json"
DIR = f"{REMOTE_BASE}/jobs/slurmly-1a2b3c4d"
NEW_DIR = f"{REMOTE_BASE}/jobs/slurmly-5e6f7a8b"
OUTCOME = f"{NEW_DIR}/outcome.json"
STARTED = datetime(2026, 9, 30, 14, 0, tzinfo=timezone.utc)
ENDED = datetime(2026, 10, 4, 14, 0, tzinfo=timezone.utc)
SAVED = "2026-10-02T09:00:00Z"  # after STARTED


@pytest.fixture(autouse=True)
def owner(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)


def now() -> datetime:
    return datetime.now(timezone.utc)


def info(state: str = "TIMEOUT", lifecycle: str = "timeout", slurm_id: str = "12345", **kw) -> JobInfo:
    return JobInfo(
        slurm_job_id=slurm_id,
        lifecycle=lifecycle,
        raw_state=state,
        exit_code=kw.pop("exit_code", "0:15"),
        start_time=kw.pop("start_time", "2026-09-30T14:00:00Z"),
        end_time=kw.pop("end_time", "2026-10-04T14:00:00Z"),
        source="sacct",
        **kw,
    )


def sweep():
    asyncio.run(slurm.sync_active_jobs())


def reconcile():
    asyncio.run(slurm.reconcile_interrupted_submits())


def prior(number: int = 1, directory: str = "slurmly-0a0a0a0a", slurm_id: str = "11111", **extra) -> dict:
    """A job that ran the simulation before the current one, as `previous_jobs` holds it."""
    path = f"{REMOTE_BASE}/jobs/{directory}"
    entry = {
        "number": number,
        "slurm_job_id": slurm_id,
        "internal_job_id": directory,
        "remote_job_dir": path,
        "remote_script_path": f"{path}/run.sh",
        "stdout_path": f"{path}/stdout.log",
        "stderr_path": f"{path}/stderr.log",
        "slurm_start": STARTED - timedelta(days=5),
        "slurm_end": STARTED - timedelta(days=1),
        "slurm_state": "TIMEOUT",
        "slurm_exit_code": "0:15",
        "state_saved_at": STARTED - timedelta(days=2),
    }
    entry.update(extra)
    return entry


def running(db, job_id: str = "job-1", status: str = "RUNNING", **extra) -> dict:
    """A job that kept its script (ADR 0037) and that SLURM is about to report
    as TIMEOUT."""
    fields = dict(
        toolkit={"home": HOME, "commit": "abc1234"},
        submit_script={"body": "#!/bin/bash\nopenghm sim run\n", "cores": 4, "walltime": "02:00:00"},
        slurm_state="RUNNING",
        started_at=STARTED,
        slurm_start=STARTED,
        files="present",
    )
    fields.update(extra)
    doc = make_sent_job(job_id, OWNER, status, **fields)
    db.jobs.docs[job_id] = doc
    return doc


def in_the_gap(db, *, tries: int = 0, age: timedelta = timedelta(minutes=10), **extra) -> dict:
    """What `_start_continuation` writes: SUBMITTED, no SLURM id, one job on
    record, a `continuation`; last written `age` ago."""
    doc = running(
        db,
        status="SUBMITTED",
        slurm_job_id=None,
        internal_job_id=None,
        remote_job_dir=None,
        remote_script_path=None,
        stdout_path=None,
        stderr_path=None,
        previous_jobs=[prior(directory="slurmly-1a2b3c4d", slurm_id="12345")],
        continuation={"number": 2, "requested_at": now(), "tries": tries},
        **extra,
    )
    doc.pop("slurm_state")
    doc["updated_at"] = (now() - age).replace(microsecond=0)  # as BSON keeps it
    return doc


def says_state(anvil, state="resumable", saved_at=SAVED, *, exit_status=0, stdout=None, stderr=""):
    """Make `openghm sim state` answer: what it prints on exit 0 (the toolkit's
    JSON), or `exit_status` and `stderr` for the ways it fails."""
    if stdout is None:
        stdout = json.dumps(
            {"state": state, "saved_at": saved_at if state == "resumable" else None, "wbm_id": "wbm_test"}
        )
    anvil.results.append((lambda command: " sim state " in command, (exit_status, stdout, stderr)))


def state_calls(anvil) -> list[str]:
    return [command for command in anvil.commands if " sim state " in command]


@dataclass
class Submits:
    """The continuation's sbatch, and what is done around it, in order. `error`
    makes the submit raise; `before` runs inside it (a cancel that lands, a second
    tick); `scancel_ok` is whether `scancel --name` can run."""

    events: list = field(default_factory=list)
    docs: list = field(default_factory=list)
    cancelled_ids: list = field(default_factory=list)
    error: Exception | None = None
    before: object = None
    scancel_ok: bool = True
    new_id: str = "99999"

    @property
    def calls(self) -> int:
        return len(self.docs)


@pytest.fixture
def submits(monkeypatch) -> Submits:
    box = Submits()

    async def submit_continuation(doc):
        box.docs.append(doc)
        box.events.append("submit")
        if box.before is not None:
            await box.before(doc)
        if box.error is not None:
            raise box.error
        return SubmittedJob(
            internal_job_id="slurmly-5e6f7a8b",
            slurm_job_id=box.new_id,
            remote_job_dir=NEW_DIR,
            remote_script_path=f"{NEW_DIR}/run.sh",
            stdout_path=f"{NEW_DIR}/stdout.log",
            stderr_path=f"{NEW_DIR}/stderr.log",
            submitted_at="2026-10-04T14:05:00Z",
        )

    async def scancel_by_name(sim_id):
        box.events.append(("scancel_name", sim_id))
        return box.scancel_ok

    async def remove_failed_submit_dirs(sim_id, keep=()):
        box.events.append(("remove_dirs", sim_id, tuple(keep)))

    async def cancel_job(slurm_job_id):
        box.cancelled_ids.append(slurm_job_id)
        return True

    monkeypatch.setattr(slurm, "submit_continuation", submit_continuation)
    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    monkeypatch.setattr(slurm, "remove_failed_submit_dirs", remove_failed_submit_dirs)
    monkeypatch.setattr(slurm, "cancel_job", cancel_job)
    return box


# ---- a timeout with progress is continued --------------------------------------


def test_a_timeout_after_a_newer_state_is_continued_and_queued(db, anvil, submits):
    running(db)
    says_state(anvil)
    anvil.found["12345"] = info()
    sweep()

    assert state_calls(anvil) == [STATE_COMMAND]
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "SUBMITTED"
    assert stored["slurm_job_id"] == "99999"
    assert (stored["remote_job_dir"], stored["internal_job_id"]) == (NEW_DIR, "slurmly-5e6f7a8b")
    assert stored["stdout_path"] == f"{NEW_DIR}/stdout.log" and stored["stderr_path"] == f"{NEW_DIR}/stderr.log"
    assert "continuation" not in stored  # cleared once the job has an id
    assert "failure" not in stored and stored.get("completed_at") is None
    # The ended job is on record, with everything a log reader and a delete need.
    (ended,) = stored["previous_jobs"]
    assert ended == {
        "number": 1,
        "slurm_job_id": "12345",
        "internal_job_id": "slurmly-1a2b3c4d",
        "remote_job_dir": DIR,
        "remote_script_path": f"{DIR}/run.sh",
        "stdout_path": f"{DIR}/stdout.log",
        "stderr_path": f"{DIR}/stderr.log",
        "slurm_start": STARTED,
        "slurm_end": ENDED,
        "slurm_state": "TIMEOUT",
        "slurm_exit_code": "0:15",
        "state_saved_at": datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc),
    }
    # The current job's SLURM fields were the ended job's, and are gone.
    for key in ("slurm_state", "slurm_exit_code", "slurm_start", "slurm_end", "missing_since"):
        assert key not in stored
    assert stored["started_at"] == STARTED  # the simulation's own start is kept
    # It was submitted from the document as written, with the stored script.
    (sent,) = submits.docs
    assert sent["submit_script"]["body"] == "#!/bin/bash\nopenghm sim run\n"
    assert sent["continuation"]["number"] == 2 and sent["previous_jobs"][0]["slurm_job_id"] == "12345"
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "job_continued"]
    assert event["target_id"] == "job-1" and event["detail"]["number"] == 2
    assert event["detail"]["after_slurm_job_id"] == "12345"
    assert event["detail"]["state_saved_at"].startswith("2026-10-02T09:00:00")


def test_the_second_job_is_then_followed_like_any_other_and_completes(db, anvil, submits):
    running(db)
    says_state(anvil)
    anvil.found["12345"] = info()
    sweep()

    anvil.found["99999"] = info("RUNNING", "running", slurm_id="99999", start_time="2026-10-04T14:30:00Z")
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "RUNNING"
    assert stored["slurm_start"] == datetime(2026, 10, 4, 14, 30, tzinfo=timezone.utc)

    anvil.found["99999"] = info(
        "COMPLETED", "succeeded", slurm_id="99999", exit_code="0:0",
        start_time="2026-10-04T14:30:00Z", end_time="2026-10-05T09:00:00Z",
    )
    anvil.files[OUTCOME] = json.dumps(SUCCESS_OUTCOME)
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "COMPLETED"
    assert [p["slurm_job_id"] for p in stored["previous_jobs"]] == ["12345"]
    assert stored["slurm_job_id"] == "99999" and stored["slurm_state"] == "COMPLETED"
    assert submits.calls == 1  # nothing else was submitted


def test_the_jobs_own_toolkit_is_asked_not_the_one_the_gateway_has_now(db, anvil, submits):
    running(db, toolkit={"home": "/home/x-openghm/apps/openghm/0ldc0de", "commit": "0ldc0de"})
    says_state(anvil)
    anvil.found["12345"] = info()
    sweep()
    assert state_calls(anvil) == [f"/home/x-openghm/apps/openghm/0ldc0de/bin/openghm sim state {WORK} --json"]


def test_the_state_may_be_the_jobs_last_save_to_the_second(db, anvil, submits):
    """`saved_at` after the SLURM start continues; the spinup's state counts too (a
    state is a state): nothing here asks which year it is."""
    running(db)
    says_state(anvil, saved_at="2026-09-30T14:00:01Z")
    anvil.found["12345"] = info()
    sweep()
    assert db.jobs.docs["job-1"]["slurm_job_id"] == "99999"


def test_a_job_whose_start_the_lookup_lacks_is_judged_against_the_stored_start(db, anvil, submits):
    running(db)
    says_state(anvil)
    anvil.found["12345"] = info(start_time=None)
    sweep()
    assert db.jobs.docs["job-1"]["slurm_job_id"] == "99999"


# ---- anything else ends as a timeout, with the reason ----------------------------


@pytest.mark.parametrize(
    "state, saved_at",
    [
        ("none", None),
        ("inconsistent", None),
        ("resumable", "2026-09-30T13:59:59Z"),  # saved before the job started: the old state
        ("resumable", "2026-09-30T14:00:00Z"),  # not after
        ("resumable", None),
    ],
)
def test_no_complete_state_saved_after_the_job_started_is_no_new_state(db, anvil, submits, state, saved_at):
    running(db)
    says_state(anvil, state, saved_at, stdout=json.dumps({"state": state, "saved_at": saved_at, "wbm_id": "w"}))
    anvil.found["12345"] = info()
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED"
    assert stored["failure"]["cause"] == "timeout" and stored["failure"]["detail"] == "no_new_state"
    assert "before it saved a state to continue from" in stored["status_reason"]
    assert "previous_jobs" not in stored and submits.calls == 0
    assert not [e for e in db.audit_events.docs.values() if e["action"] == "job_continued"]


@pytest.mark.parametrize(
    "answer",
    [
        dict(exit_status=2, stdout="", stderr="Usage: openghm sim [OPTIONS] COMMAND\nError: No such command 'state'.\n"),
        dict(exit_status=2, stdout="", stderr="openghm: no simulation.json in /x\n"),
        dict(exit_status=127, stdout="", stderr="bash: openghm: command not found\n"),
        dict(exit_status=1, stdout="", stderr="Traceback ..."),
        dict(exit_status=0, stdout="not json"),
        dict(exit_status=0, stdout='{"state": "maybe"}'),
        dict(exit_status=0, stdout="[]"),
    ],
)
def test_a_toolkit_that_cannot_say_is_not_continued_and_not_asked_again(db, anvil, submits, answer):
    """A toolkit installed before `sim state` (exit 2, `No such command`), or one
    that cannot read the work directory, answers: it is `no_new_state`, once. It
    is never a crash and never a retry every tick."""
    running(db)
    says_state(anvil, **answer)
    anvil.found["12345"] = info()
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED"
    assert stored["failure"]["cause"] == "timeout" and stored["failure"]["detail"] == "no_new_state"
    assert len(state_calls(anvil)) == 1 and submits.calls == 0
    sweep()  # a terminal job is not looked at again
    assert len(state_calls(anvil)) == 1


def test_the_job_limit_stops_a_run_that_cannot_finish_without_asking_the_toolkit(db, anvil, submits):
    running(db, previous_jobs=[prior(n, f"slurmly-0a0a0a0{n}", f"1000{n}") for n in range(1, settings.JOB_MAX_JOBS_PER_SIMULATION)])
    anvil.found["12345"] = info()
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED"
    assert stored["failure"]["cause"] == "timeout" and stored["failure"]["detail"] == "job_limit"
    assert f"ran as {settings.JOB_MAX_JOBS_PER_SIMULATION} jobs" in stored["status_reason"]
    assert "most one simulation may use" in stored["status_reason"]
    assert state_calls(anvil) == [] and submits.calls == 0
    assert len(stored["previous_jobs"]) == settings.JOB_MAX_JOBS_PER_SIMULATION - 1


def test_the_job_before_the_limit_is_still_continued(db, anvil, submits):
    running(db, previous_jobs=[prior(n, f"slurmly-0a0a0a0{n}", f"1000{n}") for n in range(1, settings.JOB_MAX_JOBS_PER_SIMULATION - 1)])
    says_state(anvil)
    anvil.found["12345"] = info()
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["slurm_job_id"] == "99999"
    assert len(stored["previous_jobs"]) == settings.JOB_MAX_JOBS_PER_SIMULATION - 1


def test_a_cancel_that_was_asked_is_never_continued(db, anvil, submits):
    running(db, cancel_requested_at=now(), cancel_requested_by=OWNER)
    anvil.found["12345"] = info()
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED" and stored["failure"]["cause"] == "timeout"
    assert stored["failure"]["detail"] is None  # not a question of state
    assert state_calls(anvil) == [] and submits.calls == 0


def test_a_job_from_before_continuations_has_no_script_and_ends_as_it_did(db, anvil, submits):
    doc = running(db)
    del doc["submit_script"]
    anvil.found["12345"] = info()
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED" and stored["failure"]["cause"] == "timeout"
    assert stored["failure"]["detail"] is None
    assert "before WBM finished." in stored["status_reason"]
    assert state_calls(anvil) == [] and submits.calls == 0


@pytest.mark.parametrize(
    "state, lifecycle", [("FAILED", "failed"), ("OUT_OF_MEMORY", "failed"), ("NODE_FAIL", "failed")]
)
def test_only_a_time_limit_is_continued(db, anvil, submits, state, lifecycle):
    running(db)
    anvil.found["12345"] = info(state, lifecycle)
    anvil.files[f"{DIR}/outcome.json"] = "null"
    sweep()
    assert db.jobs.docs["job-1"]["status"] == "FAILED"
    assert state_calls(anvil) == [] and submits.calls == 0


def test_a_continued_simulation_that_stops_again_without_progress_says_how_many_jobs_ran(db, anvil, submits):
    running(db, previous_jobs=[prior()])
    says_state(anvil, "resumable", "2026-09-29T00:00:00Z")  # the state job 1 left, older than this job
    anvil.found["12345"] = info()
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["failure"]["detail"] == "no_new_state"
    assert stored["status_reason"].startswith("This simulation ran as 2 jobs.")


# ---- Anvil cannot be asked: nothing is written ---------------------------------------


@pytest.mark.parametrize("failure", ["raises", "ssh_255"])
def test_a_state_read_that_cannot_run_writes_nothing_and_is_tried_next_tick(db, anvil, submits, failure):
    doc = running(db)
    before = dict(doc)
    anvil.found["12345"] = info()
    if failure == "raises":
        anvil.results.append((lambda c: " sim state " in c, SSHTransportError("connection reset")))
    else:
        says_state(anvil, exit_status=255, stdout="", stderr="ssh: connect to host failed")
    sweep()
    assert db.jobs.docs["job-1"] == before
    assert submits.calls == 0 and not db.audit_events.docs

    anvil.results.clear()
    says_state(anvil)
    sweep()
    assert db.jobs.docs["job-1"]["slurm_job_id"] == "99999"


# ---- the continuation's submit ------------------------------------------------------


def test_an_sbatch_refusal_fails_the_simulation_with_its_own_cause(db, anvil, submits):
    running(db)
    says_state(anvil)
    anvil.found["12345"] = info()
    submits.error = SbatchError(
        command="sbatch run.sh", exit_status=1,
        stderr="sbatch: error: Batch job submission failed: Invalid account or account/partition combination specified",
    )
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED"
    assert stored["failure"]["cause"] == "continuation_failed"
    assert "next job could not be queued" in stored["status_reason"]
    assert "Invalid account" in stored["status_reason"]
    assert stored["completed_at"] is not None and stored["files"] == "present"
    assert "continuation" not in stored and stored.get("slurm_job_id") is None
    assert [p["slurm_job_id"] for p in stored["previous_jobs"]] == ["12345"]
    assert submits.calls == 1  # a refusal is not retried
    # slurmly's leftover directory goes, the ended job's own does not.
    assert ("remove_dirs", "sim-job-1", (DIR,)) in submits.events
    (event,) = [e for e in db.audit_events.docs.values() if e["detail"].get("cause") == "continuation_failed"]
    assert event["detail"]["from"] == "SUBMITTED" and event["detail"]["to"] == "FAILED"


def test_a_spec_slurmly_will_not_build_fails_the_simulation_too(db, anvil, submits):
    running(db)
    says_state(anvil)
    anvil.found["12345"] = info()
    submits.error = InvalidJobSpec("time_limit must be a Slurm --time form")
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED" and stored["failure"]["cause"] == "continuation_failed"
    assert ("remove_dirs", "sim-job-1", (DIR,)) not in submits.events  # nothing was created


def test_a_script_that_was_not_kept_whole_fails_before_anything_is_sent(db, anvil, submits, monkeypatch):
    running(db, submit_script={"body": "x", "cores": "many", "walltime": "02:00:00"})
    says_state(anvil)
    anvil.found["12345"] = info()
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED" and stored["failure"]["cause"] == "continuation_failed"
    assert submits.calls == 0


def test_a_lost_answer_scancels_by_name_and_leaves_the_job_waiting_with_a_try_counted(db, anvil, submits):
    running(db)
    says_state(anvil)
    anvil.found["12345"] = info()
    submits.error = SSHTransportError("connection dropped after sbatch")
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "SUBMITTED" and stored["slurm_job_id"] is None
    assert stored["continuation"]["tries"] == 1 and stored["continuation"]["number"] == 2
    assert [p["slurm_job_id"] for p in stored["previous_jobs"]] == ["12345"]
    assert submits.events == [
        "submit",
        ("scancel_name", "sim-job-1"),
        ("remove_dirs", "sim-job-1", (DIR,)),
    ]
    assert "failure" not in stored


@pytest.mark.parametrize("error", [RuntimeError("an unexpected thing"), asyncio.TimeoutError(), OSError("broken pipe")])
def test_anything_unexpected_is_a_lost_answer_not_a_failure(db, anvil, submits, error):
    running(db)
    says_state(anvil)
    anvil.found["12345"] = info()
    submits.error = error
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "SUBMITTED" and stored["continuation"]["tries"] == 1


def test_a_lost_answer_whose_scancel_cannot_run_still_counts_and_leaves_no_directory_removed(db, anvil, submits):
    running(db)
    says_state(anvil)
    anvil.found["12345"] = info()
    submits.error = SSHTransportError("down")
    submits.scancel_ok = False
    sweep()
    assert db.jobs.docs["job-1"]["continuation"]["tries"] == 1
    assert submits.events == ["submit", ("scancel_name", "sim-job-1")]


def test_a_lost_answer_is_retried_by_the_sweep_after_scancelling_by_name(db, anvil, submits):
    running(db)
    says_state(anvil)
    anvil.found["12345"] = info()
    submits.error = SSHTransportError("connection dropped after sbatch")
    sweep()
    assert submits.calls == 1

    reconcile()  # it was written just now: a submit that may still be running
    assert submits.calls == 1

    db.jobs.docs["job-1"]["updated_at"] = (now() - timedelta(minutes=10)).replace(microsecond=0)
    submits.error = None
    submits.events.clear()
    reconcile()
    assert submits.events == [
        ("scancel_name", "sim-job-1"),
        ("remove_dirs", "sim-job-1", (DIR,)),
        "submit",
    ]
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "SUBMITTED" and stored["slurm_job_id"] == "99999"
    assert "continuation" not in stored and len(stored["previous_jobs"]) == 1


def test_a_continuation_the_process_died_in_is_submitted_again_never_given_back_as_a_draft(db, anvil, submits):
    in_the_gap(db)
    reconcile()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "SUBMITTED" and stored["slurm_job_id"] == "99999"
    assert "last_submit_error" not in stored and stored["sim_id"] == "sim-job-1"
    assert submits.events[0] == ("scancel_name", "sim-job-1")  # an earlier try may be alive


def test_a_continuation_is_not_touched_inside_the_grace_period(db, anvil, submits):
    in_the_gap(db, age=timedelta(seconds=settings.JOB_SUBMIT_INTERRUPTED_AFTER_SECONDS - 60))
    reconcile()
    assert submits.events == [] and db.jobs.docs["job-1"]["slurm_job_id"] is None


def test_a_continuation_is_not_submitted_while_an_earlier_try_cannot_be_cancelled(db, anvil, submits):
    in_the_gap(db)
    submits.scancel_ok = False
    reconcile()
    assert submits.calls == 0
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "SUBMITTED" and stored["slurm_job_id"] is None
    assert stored["continuation"]["tries"] == 0  # not a lost answer: it was never sent


def test_a_continuation_that_lost_its_answer_every_try_fails_with_its_own_cause(db, anvil, submits):
    in_the_gap(db, tries=settings.JOB_CONTINUATION_MAX_TRIES)
    reconcile()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED" and stored["failure"]["cause"] == "continuation_failed"
    assert f"{settings.JOB_CONTINUATION_MAX_TRIES} times" in stored["status_reason"]
    assert submits.calls == 0
    assert ("scancel_name", "sim-job-1") in submits.events  # what the last try may have started
    assert "continuation" not in stored and not stored.get("orphan_sim_ids")


def test_the_last_try_whose_scancel_cannot_run_hands_its_name_to_the_orphan_pass(db, anvil, submits):
    in_the_gap(db, tries=settings.JOB_CONTINUATION_MAX_TRIES)
    submits.scancel_ok = False
    reconcile()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "FAILED" and stored["orphan_sim_ids"] == ["sim-job-1"]


def test_the_tries_are_counted_until_they_run_out(db, anvil, submits):
    in_the_gap(db)
    submits.error = SSHTransportError("down")
    for expected in range(1, settings.JOB_CONTINUATION_MAX_TRIES + 1):
        db.jobs.docs["job-1"]["updated_at"] = (now() - timedelta(minutes=10)).replace(microsecond=0)
        reconcile()
        assert db.jobs.docs["job-1"]["continuation"]["tries"] == expected
    db.jobs.docs["job-1"]["updated_at"] = (now() - timedelta(minutes=10)).replace(microsecond=0)
    reconcile()
    assert db.jobs.docs["job-1"]["status"] == "FAILED"
    assert submits.calls == settings.JOB_CONTINUATION_MAX_TRIES


def test_a_first_submit_the_process_died_in_is_still_given_back_as_a_draft(db, anvil, submits):
    doc = make_sent_job("job-1", OWNER, "SUBMITTED", slurm_job_id=None)
    doc["updated_at"] = (now() - timedelta(minutes=10)).replace(microsecond=0)
    db.jobs.docs["job-1"] = doc
    reconcile()
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"
    assert submits.calls == 0


def test_a_simulation_that_already_ran_a_job_can_never_become_a_draft(db):
    in_the_gap(db)
    moved = asyncio.run(slurm.return_to_draft("job-1", "submit_interrupted", "x"))
    assert moved is False and db.jobs.docs["job-1"]["status"] == "SUBMITTED"


def test_giving_a_draft_back_drops_the_stored_script(db):
    running(db, status="SUBMITTED", slurm_job_id=None)
    assert asyncio.run(slurm.return_to_draft("job-1", "submit_interrupted", "x")) is True
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "DRAFT" and "submit_script" not in stored


def test_a_try_is_counted_once_however_many_writers_saw_it(db, anvil, submits):
    read = copy.deepcopy(in_the_gap(db))  # what both writers read

    async def twice():
        await slurm._continuation_answer_lost(read)
        await slurm._continuation_answer_lost(read)  # read before the first counted it

    asyncio.run(twice())
    assert db.jobs.docs["job-1"]["continuation"]["tries"] == 1


# ---- the spec of the next job ----


def test_the_next_job_asks_slurm_for_what_the_first_one_did(db):
    """Same name, partition, account, QOS and profile as `build_job_spec`; the body, cores and
    walltime are the stored ones, not worked out again from a snapshot that may have changed."""
    snapshot = db.datasets.docs["ds-1"]["document"]
    doc = running(db, slurm_job_name="sim-job-1", slurm_config={})
    doc["submit_script"] = {"body": "#!/bin/bash\nthe body\n", "cores": 16, "walltime": "22:30"}
    first = slurm.build_job_spec(JobDB(**doc), snapshot, "#!/bin/bash\nthe body\n")
    assert slurm.build_continuation_spec(doc) == first
    assert first.name == "sim-job-1" and first.time_limit == "22:30" and first.cpus_per_task == 16

    snapshot["simulation"]["recommendedCompute"] = {"cores": 2, "walltime": "1:00:00"}
    doc["submit_script"]["walltime"] = "96:00:00"
    again = slurm.build_continuation_spec(doc)
    assert (again.cpus_per_task, again.time_limit) == (16, "96:00:00")  # not the snapshot's new numbers


# ---- two writers, one continuation ----------------------------------------------------


def test_two_ticks_at_once_submit_one_continuation(db, anvil, submits, monkeypatch):
    doc = running(db)
    saved = datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc)

    async def slow_state(job):
        await asyncio.sleep(0)  # both ticks have read the job before either writes
        return slurm.RunState("resumable", saved)

    async def slow_submit(job):
        await asyncio.sleep(0)

    monkeypatch.setattr(slurm, "read_run_state", slow_state)
    submits.before = slow_submit
    timed_out = info()

    async def both():
        await asyncio.gather(
            slurm._settle(copy.deepcopy(doc), timed_out), slurm._settle(copy.deepcopy(doc), timed_out)
        )

    asyncio.run(both())
    stored = db.jobs.docs["job-1"]
    assert submits.calls == 1
    assert [p["slurm_job_id"] for p in stored["previous_jobs"]] == ["12345"]
    assert stored["slurm_job_id"] == "99999" and stored["status"] == "SUBMITTED"
    assert len([e for e in db.audit_events.docs.values() if e["action"] == "job_continued"]) == 1


def test_two_reconcilers_at_once_submit_one_continuation(db, anvil, submits):
    in_the_gap(db)

    async def slow_submit(job):
        await asyncio.sleep(0)

    submits.before = slow_submit

    async def both():
        await asyncio.gather(slurm.reconcile_interrupted_submits(), slurm.reconcile_interrupted_submits())

    asyncio.run(both())
    assert submits.calls == 1
    assert db.jobs.docs["job-1"]["slurm_job_id"] == "99999"


# ---- cancel -------------------------------------------------------------------------


def test_a_cancel_between_the_state_read_and_the_write_stops_the_continuation(db, anvil, submits):
    doc = running(db)
    before = dict(doc)

    def cancelled_while_it_reads(command: str) -> bool:
        if " sim state " not in command:
            return False
        db.jobs.docs["job-1"]["cancel_requested_at"] = now()  # the owner clicked Cancel
        return True

    anvil.results.append((cancelled_while_it_reads, (0, json.dumps({"state": "resumable", "saved_at": SAVED, "wbm_id": "w"}), "")))
    anvil.found["12345"] = info()
    sweep()
    stored = db.jobs.docs["job-1"]
    assert submits.calls == 0 and "previous_jobs" not in stored
    assert stored["status"] == "RUNNING" and stored["slurm_job_id"] == before["slurm_job_id"]


def test_a_cancel_in_the_gap_ends_cancelled_and_names_the_job_for_scancel(client, db, anvil, submits):
    in_the_gap(db)
    response = client.post("/api/v1/jobs/job-1/cancel", headers=HEADERS)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "CANCELLED" and body["failure"]["cause"] == "cancelled_by_user"
    assert body["continuation"] is None
    stored = db.jobs.docs["job-1"]
    assert stored["orphan_sim_ids"] == ["sim-job-1"]  # scancelled by name by the orphan pass
    assert [p["slurm_job_id"] for p in stored["previous_jobs"]] == ["12345"]
    assert "continuation" not in stored

    # Nothing more is started: not by the sweep, not by the reconciler.
    reconcile()
    sweep()
    assert submits.calls == 0
    assert db.jobs.docs["job-1"]["status"] == "CANCELLED"


def test_the_orphan_pass_scancels_the_cancelled_continuation_by_name(client, db, anvil, monkeypatch):
    monkeypatch.setattr(slurm, "scancel_by_name", REAL_SCANCEL_BY_NAME)
    in_the_gap(db)
    assert client.post("/api/v1/jobs/job-1/cancel", headers=HEADERS).status_code == 200
    asyncio.run(slurm.clear_orphans())
    assert "scancel --name=sim-job-1 --user=x-openghm" in anvil.commands
    assert not db.jobs.docs["job-1"].get("orphan_sim_ids")


def test_a_cancel_that_lands_while_the_continuation_is_being_submitted_cancels_the_new_job(db, anvil, submits):
    running(db)
    says_state(anvil)
    anvil.found["12345"] = info()

    async def cancelled_meanwhile(doc):
        # What the cancel route writes for a job with no SLURM id.
        stored = db.jobs.docs["job-1"]
        stored.update(status="CANCELLED", orphan_sim_ids=["sim-job-1"], cancel_requested_at=now())
        del stored["continuation"]

    submits.before = cancelled_meanwhile
    sweep()
    stored = db.jobs.docs["job-1"]
    assert submits.cancelled_ids == ["99999"]
    assert stored["status"] == "CANCELLED"
    # Where the unwanted job's files are is kept, so a delete removes them.
    assert stored["remote_job_dir"] == NEW_DIR and stored["slurm_job_id"] == "99999"
    assert [p["slurm_job_id"] for p in stored["previous_jobs"]] == ["12345"]


def test_if_the_unwanted_job_cannot_be_scancelled_the_name_is_kept_for_the_orphan_pass(db, anvil, submits, monkeypatch):
    running(db)
    says_state(anvil)
    anvil.found["12345"] = info()

    async def cancelled_meanwhile(doc):
        db.jobs.docs["job-1"].update(status="CANCELLED")

    async def cannot(slurm_job_id):
        raise SSHTransportError("down")

    submits.before = cancelled_meanwhile
    monkeypatch.setattr(slurm, "cancel_job", cannot)
    sweep()
    assert db.jobs.docs["job-1"]["orphan_sim_ids"] == ["sim-job-1"]


def test_cancelling_the_second_job_cancels_the_job_running_now(client, db, anvil, submits):
    running(db, slurm_job_id="99999", previous_jobs=[prior()])
    response = client.post("/api/v1/jobs/job-1/cancel", headers=HEADERS)
    assert response.status_code == 200, response.text
    assert submits.cancelled_ids == ["99999"]
    assert db.jobs.docs["job-1"]["cancel_requested_at"] is not None

    anvil.found["99999"] = info("CANCELLED", "cancelled", slurm_id="99999", exit_code="0:15")
    anvil.files[OUTCOME] = "null"
    db.jobs.docs["job-1"]["remote_job_dir"] = NEW_DIR
    sweep()
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "CANCELLED" and stored["failure"]["cause"] == "cancelled_by_user"
    assert [p["slurm_job_id"] for p in stored["previous_jobs"]] == ["11111"]
    assert submits.calls == 0


# ---- delete -------------------------------------------------------------------------

PREV_A = f"{REMOTE_BASE}/jobs/slurmly-0a0a0a0a"
PREV_B = f"{REMOTE_BASE}/jobs/slurmly-0b0b0b0b"


def test_delete_removes_every_jobs_directory_and_the_work_directory(client, db, anvil):
    running(
        db,
        status="COMPLETED",
        previous_jobs=[prior(1, "slurmly-0a0a0a0a"), prior(2, "slurmly-0b0b0b0b", "22222")],
    )
    assert client.delete("/api/v1/jobs/job-1", headers=HEADERS).status_code == 204
    assert anvil.commands == [
        f"[ -L {WORK} ] && exit 3; rm -rf -- {WORK}",
        f"rm -rf -- {DIR}",
        f"rm -rf -- {PREV_A}",
        f"rm -rf -- {PREV_B}",
    ]
    assert "job-1" not in db.jobs.docs
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "job_deleted"]
    assert event["detail"]["removed"] == [WORK, DIR, PREV_A, PREV_B]


def test_delete_of_a_cancelled_continuation_with_no_current_directory_still_removes_the_earlier_ones(client, db, anvil):
    in_the_gap(db)
    db.jobs.docs["job-1"].update(status="CANCELLED", previous_jobs=[prior(1, "slurmly-0a0a0a0a")])
    assert client.delete("/api/v1/jobs/job-1", headers=HEADERS).status_code == 204
    assert anvil.commands == [f"[ -L {WORK} ] && exit 3; rm -rf -- {WORK}", f"rm -rf -- {PREV_A}"]


def test_a_previous_directory_outside_slurmlys_base_refuses_the_whole_delete(client, db, anvil):
    running(db, status="COMPLETED", previous_jobs=[prior(1, "slurmly-0a0a0a0a", remote_job_dir="/etc")])
    response = client.delete("/api/v1/jobs/job-1", headers=HEADERS)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "refused_path"
    assert anvil.commands == [] and "job-1" in db.jobs.docs  # nothing was removed


def test_a_previous_directory_that_cannot_be_removed_keeps_the_document(client, db, anvil):
    running(db, status="COMPLETED", previous_jobs=[prior(1, "slurmly-0a0a0a0a")])
    anvil.results.append((lambda c: c == f"rm -rf -- {PREV_A}", (1, "", "rm: cannot remove: busy")))
    response = client.delete("/api/v1/jobs/job-1", headers=HEADERS)
    assert response.status_code == 502 and response.json()["detail"]["code"] == "cleanup_failed"
    assert "job-1" in db.jobs.docs


# ---- logs, by job -------------------------------------------------------------------


@pytest.fixture
def two_jobs(db):
    return running(db, status="COMPLETED", previous_jobs=[prior(1, "slurmly-0a0a0a0a", "11111")])


@pytest.fixture
def reads(monkeypatch) -> list[dict]:
    """The document each log read was made for."""
    seen: list[dict] = []

    async def read_log(doc, stream, offset, limit):
        seen.append(doc)
        return {"exists": True, "data": "out", "offset": 0, "next_offset": 3, "size": 3, "eof": True}

    monkeypatch.setattr(slurm, "read_log", read_log)
    return seen


@pytest.mark.parametrize("query", ["", "&job=2"])
def test_the_logs_are_the_current_jobs_by_default(client, two_jobs, reads, query):
    assert client.get(f"/api/v1/jobs/job-1/logs?stream=stdout{query}", headers=HEADERS).status_code == 200
    assert reads[-1]["stdout_path"] == f"{DIR}/stdout.log"


def test_a_job_number_reads_that_jobs_files(client, two_jobs, reads):
    response = client.get("/api/v1/jobs/job-1/logs?stream=stderr&job=1", headers=HEADERS)
    assert response.status_code == 200, response.text
    assert reads[-1]["stderr_path"] == f"{PREV_A}/stderr.log" and reads[-1]["remote_job_dir"] == PREV_A
    assert reads[-1]["_id"] == "job-1"


@pytest.mark.parametrize("job", [3, 9])
def test_a_job_that_did_not_run_is_a_404(client, two_jobs, reads, job):
    response = client.get(f"/api/v1/jobs/job-1/logs?stream=stdout&job={job}", headers=HEADERS)
    assert response.status_code == 404 and response.json()["detail"]["code"] == "job_not_found"
    assert reads == []


@pytest.mark.parametrize("job", [0, -1])
def test_a_job_number_is_one_based(client, two_jobs, reads, job):
    assert client.get(f"/api/v1/jobs/job-1/logs?stream=stdout&job={job}", headers=HEADERS).status_code == 422


def test_the_wbm_log_is_one_file_and_ignores_the_job_number(client, two_jobs, reads):
    for job in (1, 7):
        assert client.get(f"/api/v1/jobs/job-1/logs?stream=wbm&job={job}", headers=HEADERS).status_code == 200
    assert all(doc["remote_job_dir"] == DIR for doc in reads)


def test_the_download_of_an_earlier_job_reads_its_file_and_says_which_job(client, two_jobs, anvil):
    anvil.files[f"{PREV_A}/stdout.log"] = "the first job's output\n"
    anvil.files[f"{DIR}/stdout.log"] = "the second job's output\n"
    first = client.get("/api/v1/jobs/job-1/logs/stdout/download?job=1", headers=HEADERS)
    assert first.status_code == 200 and first.text == "the first job's output\n"
    assert 'filename="sim-job-1-job1-stdout.log"' in first.headers["content-disposition"]
    current = client.get("/api/v1/jobs/job-1/logs/stdout/download", headers=HEADERS)
    assert current.text == "the second job's output\n"
    assert 'filename="sim-job-1-stdout.log"' in current.headers["content-disposition"]
    assert client.get("/api/v1/jobs/job-1/logs/stdout/download?job=5", headers=HEADERS).status_code == 404


def test_reads_of_two_jobs_are_not_shared_for_the_ttl(db, anvil, two_jobs):
    """slurm.read_log shares a read between callers for a few seconds; the jobs of a
    simulation share its id and its streams, so the path has to be in the key."""
    anvil.files[f"{PREV_A}/stdout.log"] = "first\n"
    anvil.files[f"{DIR}/stdout.log"] = "second\n"
    doc = db.jobs.docs["job-1"]
    first = asyncio.run(REAL_READ_LOG(slurm.job_view(doc, 1), "stdout", None, 100))
    second = asyncio.run(REAL_READ_LOG(doc, "stdout", None, 100))
    assert (first["data"], second["data"]) == ("first\n", "second\n")


def test_a_view_of_an_earlier_job_exists_only_for_a_job_that_ran(db, two_jobs):
    doc = db.jobs.docs["job-1"]
    assert slurm.job_view(doc, 1)["remote_job_dir"] == PREV_A
    assert slurm.job_view(doc, 2) is None and slurm.job_view(doc, 0) is None


# ---- what the API shows ---------------------------------------------------------------


def test_the_job_shows_its_earlier_jobs_without_their_paths(client, db, two_jobs):
    body = client.get("/api/v1/jobs/job-1", headers=HEADERS).json()
    assert body["job_number"] == 2 and body["max_jobs"] == settings.JOB_MAX_JOBS_PER_SIMULATION
    assert body["continuation"] is None
    (earlier,) = body["previous_jobs"]
    assert set(earlier) == {"number", "slurm_job_id", "slurm_state", "slurm_start", "slurm_end", "state_saved_at"}
    assert earlier["number"] == 1 and earlier["slurm_job_id"] == "11111" and earlier["slurm_state"] == "TIMEOUT"
    assert earlier["state_saved_at"].startswith("2026-09-28T14:00:00")
    assert "submit_script" not in body


def test_the_status_poll_carries_the_same_fields(client, db, anvil):
    in_the_gap(db, tries=2)
    body = client.get("/api/v1/jobs/job-1/status", headers=HEADERS).json()
    assert body["status"] == "SUBMITTED" and body["slurm_job_id"] is None
    assert body["job_number"] == 2 and body["max_jobs"] == settings.JOB_MAX_JOBS_PER_SIMULATION
    assert body["continuation"]["number"] == 2 and body["continuation"]["tries"] == 2
    assert [p["slurm_job_id"] for p in body["previous_jobs"]] == ["12345"]


def test_a_job_run_by_one_job_says_so(client, db):
    running(db)
    body = client.get("/api/v1/jobs/job-1", headers=HEADERS).json()
    assert body["previous_jobs"] == [] and body["job_number"] == 1 and body["continuation"] is None


def test_a_job_with_no_stored_script_may_use_one_job_and_a_draft_the_setting(client, db):
    doc = running(db)
    del doc["submit_script"]
    assert client.get("/api/v1/jobs/job-1", headers=HEADERS).json()["max_jobs"] == 1
    db.jobs.docs["job-2"] = make_job("job-2", OWNER, "DRAFT")
    draft = client.get("/api/v1/jobs/job-2", headers=HEADERS).json()
    assert draft["max_jobs"] == settings.JOB_MAX_JOBS_PER_SIMULATION and draft["job_number"] is None
