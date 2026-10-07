"""The sweep of publishes (ADR 0031, mission
2026-10-07-the-gateway-publishes-a-draft, B4): one batched lookup of the jobs
whose publish is `publishing`, a verdict from `publish-outcome.json` by the
table of the toolkit's exit codes, the snapshot registered in the catalogue
before a publish reads as `published`, a publish whose submit was lost ended,
and every write conditional on the attempt the pass read.

slurmly's real client runs over a fake transport (tests/conftest.py `anvil`);
the batched lookup and the files it finds are set per test.
"""

from __future__ import annotations

import asyncio
import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from slurmly.exceptions import SSHTransportError
from slurmly.models import JobInfo

from app.core.config import settings
from app.services import background_sync, publish, slurm

from conftest import REMOTE_BASE
from route_helpers import make_job, make_sent_job

SID = "ab" * 32
PUBLISH_DIR = f"{REMOTE_BASE}/jobs/slurmly-9f8e7d6c"
OUTCOME = f"{PUBLISH_DIR}/publish-outcome.json"
METADATA = {
    "$schema": "https://schemas.openghm.org/snapshot-spec/metadata/1.0.0.json",
    "id": SID,
    "slug": "tutorial-rerun",
    "about": {"name": "Tutorial rerun"},
}

# conftest replaces `slurm.scancel_by_name` with a fake for the route tests.
REAL_SCANCEL_BY_NAME = slurm.scancel_by_name


def now() -> datetime:
    return datetime.now(timezone.utc)


def info(state: str, lifecycle: str, slurm_id: str = "67890") -> JobInfo:
    return JobInfo(
        slurm_job_id=slurm_id,
        lifecycle=lifecycle,
        raw_state=state,
        exit_code="0:0",
        start_time="2026-10-07T14:00:00Z",
        end_time="2026-10-07T14:14:00Z",
        source="sacct",
    )


def sweep():
    asyncio.run(slurm.sync_publishes())


def reconcile():
    asyncio.run(slurm.reconcile_interrupted_publishes())


def outcome(code, **extra) -> str:
    return json.dumps(
        {"schema": 1, "snapshot_id": SID, "exit_code": code, "signal": None, "stderr_tail": ["the toolkit said x"], **extra}
    )


def record(**changes) -> dict:
    rec = {
        "state": "publishing",
        "snapshot_id": SID,
        "metadata": copy.deepcopy(METADATA),
        "attempts": 1,
        "slurm_job_id": "67890",
        "remote_job_dir": PUBLISH_DIR,
        "submitted_at": now() - timedelta(minutes=30),
        "finished_at": None,
        "failure": None,
        "submitted_by": "admin",
    }
    rec.update(changes)
    return rec


@pytest.fixture
def job(db):
    """A completed draft of `owner`, its publish started by an admin."""
    db.jobs.docs["job-1"] = make_sent_job("job-1", "owner", "COMPLETED", publish=record())
    return db.jobs.docs["job-1"]


def stored(db) -> dict:
    return db.jobs.docs["job-1"]["publish"]


def registered(db) -> set[str]:
    """What the catalogue holds besides the base snapshot the `db` fixture seeds."""
    return set(db.datasets.docs) - {"ds-1"}


# ---- what is looked up -------------------------------------------------------


def test_only_publishing_jobs_with_a_slurm_id_are_looked_up_in_one_call(db, anvil):
    db.jobs.docs["a"] = make_sent_job("a", "owner", "COMPLETED", publish=record(slurm_job_id="101"))
    db.jobs.docs["b"] = make_sent_job("b", "owner", "COMPLETED", publish=record(slurm_job_id="102"))
    db.jobs.docs["c"] = make_sent_job("c", "owner", "COMPLETED", publish=record(state="published", slurm_job_id="103"))
    db.jobs.docs["d"] = make_sent_job("d", "owner", "COMPLETED", publish=record(state="failed", slurm_job_id="104"))
    db.jobs.docs["e"] = make_sent_job("e", "owner", "COMPLETED", publish=record(slurm_job_id=None))
    db.jobs.docs["f"] = make_sent_job("f", "owner", "COMPLETED")  # never published
    db.jobs.docs["g"] = make_sent_job("g", "owner", "RUNNING", slurm_job_id="105")  # a run: not this sweep's
    db.jobs.docs["h"] = make_job("h", "owner", "DRAFT")
    sweep()
    assert len(anvil.lookups) == 1 and sorted(anvil.lookups[0]) == ["101", "102"]


def test_nothing_to_sweep_asks_nothing(db, anvil):
    db.jobs.docs["f"] = make_sent_job("f", "owner", "COMPLETED")
    sweep()
    assert anvil.lookups == [] and anvil.commands == []


def test_a_failed_lookup_skips_the_whole_tick(db, anvil, job):
    anvil.lookup_error = SSHTransportError("connection reset")
    before = copy.deepcopy(job)
    sweep()
    assert db.jobs.docs["job-1"] == before and anvil.commands == []


@pytest.mark.parametrize("state, lifecycle", [("PENDING", "queued"), ("RUNNING", "running")])
def test_a_publish_still_going_is_left_alone(db, anvil, job, state, lifecycle):
    anvil.found["67890"] = info(state, lifecycle)
    before = copy.deepcopy(job)
    sweep()
    assert db.jobs.docs["job-1"] == before
    assert anvil.commands == []  # its record is not read before it can be there


def test_an_unknown_lifecycle_is_a_lookup_miss_not_an_ending(db, anvil, job):
    anvil.found["67890"] = info("SOMETHING", "unknown")
    before = copy.deepcopy(job)
    sweep()
    assert db.jobs.docs["job-1"] == before


# ---- a verdict for each exit code of the toolkit ------------------------------

TABLE = [
    (2, "publish_bad_input", "edit"),
    (3, "publish_output_incomplete", "none"),
    (4, "publish_conflict", "none"),
    (5, "publish_setup", "none"),
    (6, "publish_upload_failed", "same"),
    (7, "publish_verify_failed", "same"),
]


@pytest.mark.parametrize("code, cause, retry", TABLE)
def test_each_exit_code_ends_the_publish_failed_with_its_cause_and_retry(db, anvil, job, code, cause, retry):
    anvil.files[OUTCOME] = outcome(code)
    anvil.found["67890"] = info("FAILED", "failed")
    before = copy.deepcopy(job)
    sweep()
    p = stored(db)
    assert p["state"] == "failed"
    assert p["failure"] == {"cause": cause, "message": publish.MESSAGE[cause], "retry": retry, "exit_code": code}
    assert p["finished_at"] is not None
    assert "the toolkit said x" not in p["failure"]["message"]  # the tail is for the log
    # nothing else of the publish, and nothing of the run, changed
    for key in ("snapshot_id", "metadata", "attempts", "slurm_job_id", "remote_job_dir", "submitted_by"):
        assert p[key] == before["publish"][key]
    assert {k: v for k, v in db.jobs.docs["job-1"].items() if k not in ("publish", "updated_at")} == {
        k: v for k, v in before.items() if k not in ("publish", "updated_at")
    }
    assert registered(db) == set()  # nothing registered
    (event,) = [e for e in db.audit_events.docs.values()]
    assert event["action"] == "job_publish_failed" and event["actor_id"] == "system"
    assert event["target_id"] == "job-1" and event["category"] == "job"
    assert event["detail"] == {
        "snapshot_id": SID, "attempt": 1, "cause": cause, "retry": retry, "exit_code": code,
        "slurm_job_id": "67890", "user_id": "owner",
    }


def test_the_outcome_is_read_from_the_publish_jobs_own_directory(db, anvil, job):
    anvil.files[OUTCOME] = outcome(6)
    anvil.found["67890"] = info("FAILED", "failed")
    sweep()
    assert any(OUTCOME in c for c in anvil.commands)
    # not the run's slurmly directory
    assert not any(f"{REMOTE_BASE}/jobs/slurmly-1a2b3c4d" in c for c in anvil.commands)


@pytest.mark.parametrize(
    "state, lifecycle, files, message",
    [
        ("COMPLETED", "succeeded", {}, publish.MESSAGE["publish_job_failed"]),  # no outcome file
        ("FAILED", "failed", {}, publish.MESSAGE["publish_job_failed"]),
        ("TIMEOUT", "timeout", {OUTCOME: outcome(None, signal="TERM")}, publish._TIMED_OUT),
        ("CANCELLED by 1234", "cancelled", {}, publish._CANCELLED),
        ("NODE_FAIL", "failed", {}, publish.MESSAGE["publish_job_failed"]),
        ("OUT_OF_MEMORY", "failed", {OUTCOME: outcome(0)}, publish.MESSAGE["publish_job_failed"]),
        ("COMPLETED", "succeeded", {OUTCOME: "not json"}, publish.MESSAGE["publish_job_failed"]),
        ("COMPLETED", "succeeded", {OUTCOME: json.dumps(["not", "a", "record"])}, publish.MESSAGE["publish_job_failed"]),
        ("FAILED", "failed", {OUTCOME: outcome(127)}, publish.MESSAGE["publish_job_failed"]),
        ("COMPLETED", "succeeded", {OUTCOME: outcome(0, snapshot_id="cd" * 32)}, publish.MESSAGE["publish_job_failed"]),
    ],
)
def test_no_usable_record_a_kill_or_any_other_ending_is_a_job_that_failed(db, anvil, job, state, lifecycle, files, message):
    anvil.files.update(files)
    anvil.found["67890"] = info(state, lifecycle)
    sweep()
    p = stored(db)
    assert p["state"] == "failed"
    assert p["failure"]["cause"] == "publish_job_failed" and p["failure"]["retry"] == "same"
    assert p["failure"]["message"] == message
    assert registered(db) == set()


# ---- exit 0: registered, then published ---------------------------------------


def test_exit_zero_registers_the_snapshot_as_the_owners_and_publishes_it(db, anvil, job):
    anvil.files[OUTCOME] = outcome(0)
    anvil.found["67890"] = info("COMPLETED", "succeeded")
    sweep()
    p = stored(db)
    assert p["state"] == "published" and p["failure"] is None and p["finished_at"] is not None
    assert db.jobs.docs["job-1"]["status"] == "COMPLETED"
    envelope = db.datasets.docs[SID]
    assert envelope["_id"] == SID
    assert envelope["document"] == METADATA  # the stored document, as it is
    # the draft's owner, not the admin who pressed the button
    assert envelope["owner_user_id"] == "owner" and envelope["visibility"] == "public"
    assert envelope["registered_at"] is not None
    (event,) = [e for e in db.audit_events.docs.values()]
    assert event["action"] == "job_published" and event["actor_id"] == "system"
    assert event["detail"] == {"snapshot_id": SID, "attempt": 1, "slurm_job_id": "67890", "user_id": "owner"}


def test_a_snapshot_already_registered_counts_as_success(db, anvil, job):
    earlier = {"_id": SID, "document": {"id": SID, "registered": "by an earlier pass"}, "owner_user_id": "owner", "visibility": "public"}
    db.datasets.docs[SID] = copy.deepcopy(earlier)
    anvil.files[OUTCOME] = outcome(0)
    anvil.found["67890"] = info("COMPLETED", "succeeded")
    sweep()
    assert stored(db)["state"] == "published"
    assert registered(db) == {SID} and db.datasets.docs[SID] == earlier  # not replaced, not duplicated


def test_a_registration_that_fails_leaves_the_publish_for_the_next_tick(db, anvil, job, monkeypatch):
    anvil.files[OUTCOME] = outcome(0)
    anvil.found["67890"] = info("COMPLETED", "succeeded")
    insert = type(db.datasets).insert_one

    async def broken(self, doc):
        raise RuntimeError("mongo hiccup")

    monkeypatch.setattr(type(db.datasets), "insert_one", broken)
    sweep()
    assert stored(db)["state"] == "publishing" and registered(db) == set()
    assert [e for e in db.audit_events.docs.values()] == []

    monkeypatch.setattr(type(db.datasets), "insert_one", insert)
    sweep()
    assert stored(db)["state"] == "published" and SID in db.datasets.docs


def test_a_mark_that_fails_after_registering_is_finished_by_the_next_tick(db, anvil, job, monkeypatch):
    anvil.files[OUTCOME] = outcome(0)
    anvil.found["67890"] = info("COMPLETED", "succeeded")
    real = slurm.write_publish
    calls = []

    async def fails_once(doc, fields, **kw):
        calls.append(fields)
        if len(calls) == 1:
            raise RuntimeError("mongo hiccup")
        return await real(doc, fields, **kw)

    monkeypatch.setattr(slurm, "write_publish", fails_once)
    sweep()
    assert stored(db)["state"] == "publishing" and SID in db.datasets.docs
    sweep()  # registers again: a duplicate key, which is success
    assert stored(db)["state"] == "published" and registered(db) == {SID}


def test_a_published_snapshot_is_listed_as_the_owners(db, anvil, job):
    from app.models.repository import OwnedSnapshotItem

    document = json.loads(
        (Path(__file__).resolve().parents[3] / "schemas/snapshot-spec/examples/wbm_storage_v2.0.0.json").read_text()
    )
    document["id"] = SID
    db.jobs.docs["job-1"]["publish"]["metadata"] = document
    anvil.files[OUTCOME] = outcome(0)
    anvil.found["67890"] = info("COMPLETED", "succeeded")
    sweep()
    # the registered envelope is one the catalogue's own readers take
    item = OwnedSnapshotItem.from_envelope(db.datasets.docs[SID])
    assert item.id == SID and item.visibility == "public"


# ---- a job SLURM has forgotten ----------------------------------------------


def test_an_absence_that_was_not_confirmed_changes_nothing(db, anvil, job):
    anvil.results.append((lambda c: c.startswith("sacct "), SSHTransportError("sacct down")))
    before = copy.deepcopy(job)
    sweep()
    assert db.jobs.docs["job-1"] == before


def test_a_forgotten_job_that_left_a_record_is_judged_by_it_at_once(db, anvil, job):
    anvil.files[OUTCOME] = outcome(0)  # sacct knows no such job, and it finished
    sweep()
    assert stored(db)["state"] == "published" and SID in db.datasets.docs


def test_a_forgotten_job_with_no_record_is_waited_for_then_failed(db, anvil, job):
    db.jobs.docs["job-1"]["publish"]["submitted_at"] = now() - timedelta(seconds=60)
    before = copy.deepcopy(db.jobs.docs["job-1"])
    sweep()
    assert db.jobs.docs["job-1"] == before  # too soon to say

    db.jobs.docs["job-1"]["publish"]["submitted_at"] = now() - timedelta(
        seconds=settings.JOB_LOST_AFTER_SECONDS + 600
    )
    sweep()
    p = stored(db)
    assert p["state"] == "failed" and p["failure"]["cause"] == "publish_job_failed" and p["failure"]["retry"] == "same"


def test_a_record_that_cannot_be_read_is_tried_again_next_tick(db, anvil, job):
    anvil.found["67890"] = info("COMPLETED", "succeeded")
    anvil.results.append((lambda c: "publish-outcome.json" in c, SSHTransportError("connection reset")))
    before = copy.deepcopy(job)
    sweep()
    assert db.jobs.docs["job-1"] == before
    anvil.results.clear()
    anvil.files[OUTCOME] = outcome(0)
    sweep()
    assert stored(db)["state"] == "published"


# ---- conditional writes ------------------------------------------------------


def test_a_retry_that_claimed_the_record_while_the_result_was_read_is_not_overwritten(db, anvil, job, monkeypatch):
    anvil.files[OUTCOME] = outcome(6)
    anvil.found["67890"] = info("FAILED", "failed")
    real = slurm.read_outcome

    async def read_then_a_retry_claims(*a, **k):
        result = await real(*a, **k)
        db.jobs.docs["job-1"]["publish"].update(attempts=2, slurm_job_id=None)
        return result

    monkeypatch.setattr(slurm, "read_outcome", read_then_a_retry_claims)
    sweep()
    p = stored(db)
    assert p["state"] == "publishing" and p["attempts"] == 2 and p["failure"] is None
    assert [e for e in db.audit_events.docs.values()] == []


def test_a_job_deleted_while_the_result_was_read_is_left_alone(db, anvil, job, monkeypatch):
    anvil.files[OUTCOME] = outcome(0)
    anvil.found["67890"] = info("COMPLETED", "succeeded")
    real = slurm.read_outcome

    async def read_then_deleted(*a, **k):
        result = await real(*a, **k)
        del db.jobs.docs["job-1"]
        return result

    monkeypatch.setattr(slurm, "read_outcome", read_then_deleted)
    sweep()
    assert registered(db) == set()  # nothing registered for a job that is gone


def test_a_verdict_is_written_once(db, anvil, job):
    anvil.files[OUTCOME] = outcome(0)
    anvil.found["67890"] = info("COMPLETED", "succeeded")
    sweep()
    sweep()
    assert len(db.audit_events.docs) == 1
    assert len(anvil.lookups) == 1  # a published record is not looked up again


# ---- a publish whose submit was lost -----------------------------------------


def lost(db, minutes, **changes):
    db.jobs.docs["job-1"] = make_sent_job(
        "job-1",
        "owner",
        "COMPLETED",
        publish=record(slurm_job_id=None, remote_job_dir=None, submitted_at=now() - timedelta(minutes=minutes), **changes),
    )


def test_a_publishing_record_with_no_slurm_id_is_ended_once_it_is_old_enough(db, anvil):
    lost(db, 10)
    reconcile()
    p = stored(db)
    assert p["state"] == "failed" and p["finished_at"] is not None
    assert p["failure"] == {
        "cause": "publish_submit_interrupted",
        "message": publish.MESSAGE["publish_submit_interrupted"],
        "retry": "same",
        "exit_code": None,
    }
    # nothing is scancelled and nothing is run on Anvil: a second job under the
    # same id is harmless, and the toolkit's per-key rule makes them idempotent
    assert anvil.commands == [] and anvil.lookups == []
    (event,) = [e for e in db.audit_events.docs.values()]
    assert event["action"] == "job_publish_failed" and event["detail"]["cause"] == "publish_submit_interrupted"
    assert event["actor_id"] == "system"


def test_a_submit_that_may_still_be_running_is_left_alone(db, anvil):
    lost(db, 1)
    before = copy.deepcopy(db.jobs.docs["job-1"])
    reconcile()
    assert db.jobs.docs["job-1"] == before


def test_the_age_is_the_settings(db, anvil, monkeypatch):
    lost(db, 1)
    monkeypatch.setattr(settings, "JOB_SUBMIT_INTERRUPTED_AFTER_SECONDS", 30)
    reconcile()
    assert stored(db)["state"] == "failed"


@pytest.mark.parametrize("changes", [{"slurm_job_id": "67890"}, {"state": "failed"}, {"state": "published"}])
def test_only_a_publishing_record_with_no_slurm_id_is_interrupted(db, anvil, changes):
    lost(db, 60)
    db.jobs.docs["job-1"]["publish"].update(changes)
    before = copy.deepcopy(db.jobs.docs["job-1"])
    reconcile()
    assert db.jobs.docs["job-1"] == before


def test_an_interrupted_publish_that_was_recorded_meanwhile_is_not_ended(db, anvil, monkeypatch):
    lost(db, 60)
    real = slurm.fail_publish

    async def recorded_first(doc, failure, **kw):
        db.jobs.docs["job-1"]["publish"]["slurm_job_id"] = "67890"  # the route got there
        return await real(doc, failure, **kw)

    monkeypatch.setattr(slurm, "fail_publish", recorded_first)
    reconcile()
    assert stored(db)["state"] == "publishing" and stored(db)["slurm_job_id"] == "67890"
    assert [e for e in db.audit_events.docs.values()] == []


# ---- the sweep's rhythm ------------------------------------------------------


@pytest.fixture
def rhythm(monkeypatch, db):
    monkeypatch.setattr(background_sync, "get_db", lambda: db)
    monkeypatch.setattr(settings, "JOB_BACKGROUND_SYNC_ACTIVE_INTERVAL", 10)
    monkeypatch.setattr(settings, "JOB_BACKGROUND_SYNC_INTERVAL", 60)


def interval() -> int:
    return asyncio.run(background_sync._next_interval())


def test_a_publish_with_a_slurm_id_and_no_verdict_is_the_active_interval(db, rhythm, job):
    assert interval() == 10


@pytest.mark.parametrize(
    "changes", [{"state": "published"}, {"state": "failed"}, {"slurm_job_id": None}]
)
def test_an_ended_or_not_yet_submitted_publish_is_idle(db, rhythm, changes):
    db.jobs.docs["job-1"] = make_sent_job("job-1", "owner", "COMPLETED", publish=record(**changes))
    assert interval() == 60


def test_the_tick_runs_both_publish_passes(db, anvil, monkeypatch):
    ran = []

    async def sync():
        ran.append("publishes")

    async def interrupted():
        ran.append("interrupted publishes")

    for name in ("sync_active_jobs", "backfill_slurm_end", "reconcile_interrupted_submits", "clear_orphans", "detect_purged_files"):
        monkeypatch.setattr(slurm, name, lambda: asyncio.sleep(0))
    monkeypatch.setattr(slurm, "sync_publishes", sync)
    monkeypatch.setattr(slurm, "reconcile_interrupted_publishes", interrupted)
    asyncio.run(background_sync._sync_once())
    assert ran == ["publishes", "interrupted publishes"]


def test_a_publish_pass_that_raises_does_not_stop_the_others(db, anvil, monkeypatch):
    ran = []

    async def boom():
        raise RuntimeError("down")

    async def interrupted():
        ran.append("interrupted publishes")

    for name in ("sync_active_jobs", "backfill_slurm_end", "reconcile_interrupted_submits", "clear_orphans", "detect_purged_files"):
        monkeypatch.setattr(slurm, name, lambda: asyncio.sleep(0))
    monkeypatch.setattr(slurm, "sync_publishes", boom)
    monkeypatch.setattr(slurm, "reconcile_interrupted_publishes", interrupted)
    asyncio.run(background_sync._sync_once())
    assert ran == ["interrupted publishes"]
