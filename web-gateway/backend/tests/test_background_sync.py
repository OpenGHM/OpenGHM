"""How often the sweep runs (ADR 0027): often while a job is active, rarely
when none is."""

from __future__ import annotations

import asyncio

import pytest

from app.core.config import settings
from app.services import background_sync

from route_helpers import make_job, make_sent_job


@pytest.fixture(autouse=True)
def intervals(monkeypatch, db):
    monkeypatch.setattr(background_sync, "get_db", lambda: db)
    monkeypatch.setattr(settings, "JOB_BACKGROUND_SYNC_ACTIVE_INTERVAL", 10)
    monkeypatch.setattr(settings, "JOB_BACKGROUND_SYNC_INTERVAL", 60)


def interval() -> int:
    return asyncio.run(background_sync._next_interval())


def test_no_jobs_is_the_idle_interval():
    assert interval() == 60


@pytest.mark.parametrize("status", ["SUBMITTED", "PENDING", "RUNNING", "COMPLETING"])
def test_an_active_job_with_a_slurm_id_is_the_active_interval(db, status):
    db.jobs.docs["j"] = make_sent_job("j", "owner", status)
    assert interval() == 10


def test_ended_jobs_drafts_and_a_claimed_draft_are_idle(db):
    db.jobs.docs["a"] = make_sent_job("a", "owner", "COMPLETED")
    db.jobs.docs["b"] = make_sent_job("b", "owner", "FAILED")
    db.jobs.docs["c"] = make_job("c", "owner", "DRAFT")
    db.jobs.docs["d"] = make_sent_job("d", "owner", "SUBMITTED", slurm_job_id=None)  # submit in flight
    assert interval() == 60


def test_an_orphaned_submit_still_being_cancelled_is_the_active_interval(db):
    db.jobs.docs["c"] = make_job("c", "owner", "DRAFT")
    db.jobs.docs["c"]["orphan_sim_ids"] = ["sim-20260930-abcdef"]
    assert interval() == 10
    db.jobs.docs["c"]["orphan_sim_ids"] = []
    assert interval() == 60


def test_a_database_that_cannot_be_asked_is_the_idle_interval(monkeypatch):
    def broken():
        raise RuntimeError("mongo is down")

    monkeypatch.setattr(background_sync, "get_db", broken)
    assert interval() == 60


def test_the_loop_sleeps_the_interval_it_was_given(db, monkeypatch):
    db.jobs.docs["j"] = make_sent_job("j", "owner", "RUNNING")
    slept: list[float] = []

    async def sleep(seconds):
        slept.append(seconds)
        raise asyncio.CancelledError

    async def nothing():
        return None

    monkeypatch.setattr(background_sync, "_sync_once", nothing)
    monkeypatch.setattr(background_sync.asyncio, "sleep", sleep)
    asyncio.run(background_sync.run_background_sync())
    assert slept == [10]


def test_a_tick_runs_every_step_even_when_one_fails(monkeypatch):
    from app.services import slurm

    ran: list[str] = []

    def step(name, fail=False):
        async def run():
            ran.append(name)
            if fail:
                raise RuntimeError("cluster unreachable")

        return run

    monkeypatch.setattr(slurm, "sync_active_jobs", step("jobs", fail=True))
    monkeypatch.setattr(slurm, "backfill_slurm_end", step("end times"))
    monkeypatch.setattr(slurm, "reconcile_interrupted_submits", step("interrupted submits"))
    monkeypatch.setattr(slurm, "clear_orphans", step("orphans"))
    monkeypatch.setattr(slurm, "detect_purged_files", step("purged"))
    asyncio.run(background_sync._sync_once())
    # The reconcile comes before the orphans, so a name it keeps is retried
    # on the same tick's next pass rather than a minute later.
    assert ran == ["jobs", "end times", "interrupted submits", "orphans", "purged"]


def test_a_failing_reconcile_does_not_stop_the_orphan_pass(monkeypatch):
    from app.services import slurm

    ran: list[str] = []

    async def reconcile():
        raise RuntimeError("anvil down")

    async def orphans():
        ran.append("orphans")

    async def nothing():
        return None

    monkeypatch.setattr(slurm, "sync_active_jobs", nothing)
    monkeypatch.setattr(slurm, "backfill_slurm_end", nothing)
    monkeypatch.setattr(slurm, "reconcile_interrupted_submits", reconcile)
    monkeypatch.setattr(slurm, "clear_orphans", orphans)
    monkeypatch.setattr(slurm, "detect_purged_files", nothing)
    asyncio.run(background_sync._sync_once())
    assert ran == ["orphans"]
