"""What viewers of a job share (ADR 0027, mission 4): one SLURM lookup per job
per TTL window however many ask, a job settled once however many find it over,
the `live` part of the status answer, and the progress WBM's log gives.

slurmly's real client runs over a fake transport (tests/conftest.py `anvil`);
here its batched lookup is replaced by one that takes a moment, so concurrent
callers really do overlap.
"""

from __future__ import annotations

import asyncio
import json
from datetime import date, datetime, timezone

import pytest
from slurmly.exceptions import SSHTransportError
from slurmly.models import JobInfo

from app.core.config import settings
from app.services import job_live, slurm

from conftest import REMOTE_BASE
from route_helpers import SUCCESS_OUTCOME, make_sent_job, make_user, token_for

REAL_UPDATE_JOB_STATUS = slurm.update_job_status
REAL_READ_LOG = slurm.read_log

OUTCOME = f"{REMOTE_BASE}/jobs/slurmly-1a2b3c4d/outcome.json"
READ_AT = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


def run(coro):
    return asyncio.run(coro)


def info(state: str = "RUNNING", lifecycle: str = "running", slurm_id: str = "12345", **kw) -> JobInfo:
    return JobInfo(
        slurm_job_id=slurm_id,
        lifecycle=lifecycle,
        raw_state=state,
        exit_code="0:0",
        start_time="2026-09-30T14:00:00Z",
        end_time="2026-09-30T14:14:00Z",
        source=kw.pop("source", "squeue"),
        **kw,
    )


@pytest.fixture(autouse=True)
def real_status(monkeypatch, db):
    monkeypatch.setattr(slurm, "update_job_status", REAL_UPDATE_JOB_STATUS)


@pytest.fixture
def clock(monkeypatch):
    """`job_live`'s clock, moved by the test."""
    now = [1000.0]
    monkeypatch.setattr(job_live, "_clock", lambda: now[0])
    return now


@pytest.fixture
def job(db):
    db.jobs.docs["job-1"] = make_sent_job("job-1", "owner", "RUNNING")
    return db.jobs.docs["job-1"]


@pytest.fixture
def slow_lookup(anvil, monkeypatch):
    """The batched lookup, taking a moment: callers arriving meanwhile overlap."""

    async def get_jobs(ids, **_kw):
        anvil.lookups.append(list(ids))
        await asyncio.sleep(0.01)
        if anvil.lookup_error is not None:
            raise anvil.lookup_error
        return {i: anvil.found[i] for i in ids if i in anvil.found}

    monkeypatch.setattr(anvil.client, "get_jobs", get_jobs)
    anvil.found["12345"] = info()
    return anvil


# ---- one lookup per window ---------------------------------------------------


def test_concurrent_status_polls_share_one_lookup(db, job, slow_lookup, clock):
    async def five():
        return await asyncio.gather(*(slurm.update_job_status("job-1") for _ in range(5)))

    docs = run(five())
    assert len(slow_lookup.lookups) == 1
    assert all(d["status"] == "RUNNING" for d in docs)


def test_an_answer_is_reused_until_the_ttl_is_up(db, job, slow_lookup, clock):
    run(slurm.update_job_status("job-1"))
    clock[0] += settings.JOB_LIVE_TTL_SECONDS - 0.1
    run(slurm.update_job_status("job-1"))
    assert len(slow_lookup.lookups) == 1
    clock[0] += 0.2
    run(slurm.update_job_status("job-1"))
    assert len(slow_lookup.lookups) == 2


def test_the_sweep_fills_the_answer_a_poll_then_uses(db, job, slow_lookup, clock):
    run(slurm.sync_active_jobs())
    run(slurm.update_job_status("job-1"))
    assert len(slow_lookup.lookups) == 1


def test_the_sweep_asks_again_even_inside_the_ttl(db, job, slow_lookup, clock):
    run(slurm.sync_active_jobs())
    slow_lookup.found["12345"] = info("COMPLETED", "succeeded")
    slow_lookup.files[OUTCOME] = json.dumps(SUCCESS_OUTCOME)
    run(slurm.sync_active_jobs())
    assert len(slow_lookup.lookups) == 2
    assert db.jobs.docs["job-1"]["status"] == "COMPLETED"


def test_one_batched_lookup_fills_every_job_it_asked_about(db, slow_lookup, clock):
    for n in (1, 2, 3):
        db.jobs.docs[f"j{n}"] = make_sent_job(f"j{n}", "owner", "RUNNING", slurm_job_id=str(100 + n))
        slow_lookup.found[str(100 + n)] = info(slurm_id=str(100 + n))
    run(slurm.sync_active_jobs())
    got = run(job_live.slurm_info(["101", "102", "103", "999"]))
    assert len(slow_lookup.lookups) == 2  # the sweep's, then the one for 999 alone
    assert slow_lookup.lookups[1] == ["999"]
    assert got["101"].slurm_job_id == "101" and got["999"] is None


def test_an_id_slurm_did_not_report_is_an_answer_too(slow_lookup, clock):
    slow_lookup.found.clear()
    assert run(job_live.slurm_info(["12345"])) == {"12345": None}
    assert run(job_live.slurm_info(["12345"])) == {"12345": None}
    assert len(slow_lookup.lookups) == 1


# ---- a failed lookup ---------------------------------------------------------


def test_a_failed_lookup_raises_to_every_waiter_and_is_not_kept(slow_lookup, clock):
    slow_lookup.lookup_error = SSHTransportError("connection reset")

    async def three():
        return await asyncio.gather(
            *(job_live.slurm_info(["12345"]) for _ in range(3)), return_exceptions=True
        )

    results = run(three())
    assert all(isinstance(r, SSHTransportError) for r in results)
    assert len(slow_lookup.lookups) == 1

    slow_lookup.lookup_error = None
    assert run(job_live.slurm_info(["12345"]))["12345"].raw_state == "RUNNING"
    assert len(slow_lookup.lookups) == 2  # the failure was not cached


def test_a_failed_poll_leaves_the_job_alone_and_the_next_asks_again(db, job, slow_lookup, clock):
    slow_lookup.lookup_error = SSHTransportError("down")
    before = dict(job)
    assert run(slurm.update_job_status("job-1")) == before
    slow_lookup.lookup_error = None
    run(slurm.update_job_status("job-1"))
    assert len(slow_lookup.lookups) == 2


def test_the_older_answer_stays_readable_after_a_lookup_fails(db, job, slow_lookup, clock):
    run(slurm.update_job_status("job-1"))
    first = job_live.live_view(db.jobs.docs["job-1"])
    clock[0] += 60
    slow_lookup.lookup_error = SSHTransportError("down")
    run(slurm.update_job_status("job-1"))
    assert job_live.live_view(db.jobs.docs["job-1"])["checked_at"] == first["checked_at"]


# ---- settling once -----------------------------------------------------------


def test_five_polls_that_find_a_job_over_reach_one_verdict(db, job, slow_lookup, clock, monkeypatch):
    slow_lookup.found["12345"] = info("COMPLETED", "succeeded")
    slow_lookup.files[OUTCOME] = json.dumps(SUCCESS_OUTCOME)
    concluded = []
    real = slurm._conclude

    async def conclude(doc, **kw):
        concluded.append(doc["_id"])
        await asyncio.sleep(0.01)
        return await real(doc, **kw)

    monkeypatch.setattr(slurm, "_conclude", conclude)

    async def five():
        return await asyncio.gather(*(slurm.update_job_status("job-1") for _ in range(5)))

    docs = run(five())
    assert concluded == ["job-1"]
    assert len(slow_lookup.lookups) == 1
    assert all(d["status"] == "COMPLETED" for d in docs)
    events = [e for e in db.audit_events.docs.values() if e["action"] == "job_status_changed"]
    assert len(events) == 1


def test_a_sweep_and_a_poll_reach_one_verdict_together(db, job, slow_lookup, clock, monkeypatch):
    slow_lookup.found["12345"] = info("COMPLETED", "succeeded")
    slow_lookup.files[OUTCOME] = json.dumps(SUCCESS_OUTCOME)
    concluded = []
    real = slurm._conclude

    async def conclude(doc, **kw):
        concluded.append(doc["_id"])
        await asyncio.sleep(0.01)
        return await real(doc, **kw)

    monkeypatch.setattr(slurm, "_conclude", conclude)

    async def both():
        await asyncio.gather(slurm.sync_active_jobs(), slurm.update_job_status("job-1"))

    run(both())
    assert concluded == ["job-1"]


def test_single_flight_hands_the_error_to_everyone():
    async def boom():
        await asyncio.sleep(0.01)
        raise ValueError("no")

    async def three():
        return await asyncio.gather(
            *(job_live.single_flight("k", boom) for _ in range(3)), return_exceptions=True
        )

    assert all(isinstance(r, ValueError) for r in run(three()))
    assert run(job_live.single_flight("k", lambda: asyncio.sleep(0, "again"))) == "again"


# ---- `live` ------------------------------------------------------------------

SQUEUE_PENDING = {
    "job_state": ["PENDING"],
    "state_reason": "Priority",
    "time_limit": {"set": True, "infinite": False, "number": 23},
    "start_time": {"set": True, "infinite": False, "number": 1790000000},
}


def live_of(anvil, doc, **kw):
    anvil.found["12345"] = info(**kw)
    run(job_live.slurm_info(["12345"]))
    return job_live.live_view(doc)


def test_a_queued_job_says_why_and_when(db, slow_lookup, clock):
    doc = make_sent_job("job-1", "owner", "SUBMITTED")
    live = live_of(slow_lookup, doc, state="PENDING", lifecycle="queued",
                   queue_reason="Priority", raw=SQUEUE_PENDING)
    assert live["queue_reason"] == "Priority"
    assert live["time_limit_seconds"] == 23 * 60 == 1380
    assert live["estimated_start"] == datetime.fromtimestamp(1790000000, timezone.utc)
    assert live["checked_at"].tzinfo is not None
    assert live["progress"] is None


def test_no_estimate_when_slurm_gives_none_or_the_job_runs(db, slow_lookup, clock):
    doc = make_sent_job("job-1", "owner", "SUBMITTED")
    none_yet = {**SQUEUE_PENDING, "start_time": {"set": True, "number": 0}}
    live = live_of(slow_lookup, doc, state="PENDING", lifecycle="queued", raw=none_yet)
    assert live["estimated_start"] is None
    job_live.reset()
    running = {**SQUEUE_PENDING, "job_state": ["RUNNING"]}
    live = live_of(slow_lookup, doc, state="RUNNING", lifecycle="running", raw=running)
    assert live["estimated_start"] is None


@pytest.mark.parametrize("reason", [None, "None", "none", "  ", ""])
def test_a_reason_of_none_is_no_reason(db, slow_lookup, clock, reason):
    doc = make_sent_job("job-1", "owner", "RUNNING")
    assert live_of(slow_lookup, doc, queue_reason=reason)["queue_reason"] is None


@pytest.mark.parametrize(
    "raw, seconds",
    [
        ({"time_limit": {"set": True, "number": 23}}, 1380),
        ({"time_limit": 90}, 5400),
        ({"time_limit": {"set": False, "number": 0}}, None),
        ({"time_limit": {"set": True, "infinite": True, "number": 0}}, None),
        ({"time": {"limit": {"set": True, "number": 15}}}, 900),
        ({"Timelimit": "00:23:00"}, 1380),
        ({"Timelimit": "1-02:00:00"}, 26 * 3600),
        ({"Timelimit": "UNLIMITED"}, None),
        ({"Timelimit": "Partition_Limit"}, None),
        ({"Timelimit": ""}, None),
        ({}, None),
        (None, None),
    ],
)
def test_the_time_limit_from_either_source(raw, seconds):
    assert job_live.time_limit_seconds(raw) == seconds


def test_no_live_for_a_draft_an_ended_job_or_a_job_never_heard_of(db, slow_lookup, clock):
    run(job_live.slurm_info(["12345"]))
    assert job_live.live_view(make_sent_job("job-1", "owner", "RUNNING")) is not None
    for status in ("COMPLETED", "FAILED", "CANCELLED", "DRAFT"):
        assert job_live.live_view(make_sent_job("job-1", "owner", status)) is None
    assert job_live.live_view(make_sent_job("job-2", "owner", "RUNNING", slurm_job_id="777")) is None


def test_a_job_slurm_did_not_report_has_no_live(db, slow_lookup, clock):
    slow_lookup.found.clear()
    run(job_live.slurm_info(["12345"]))
    assert job_live.live_view(make_sent_job("job-1", "owner", "RUNNING")) is None


# ---- progress ----------------------------------------------------------------

SPINUP = "Spinup 1/1 (2000-01-01) Balance=(0.00,0.00,0.00,   0.01,    0.01,   0.01,  0.00, 0.00,0.00) Spool+=3"
RUN = "File wbm_2001.nc (2001-12-22) Balance=(0.00,0.00,0.00,   8.20,  109.09,   0.81,  0.00, 0.00,0.00) Spool+=2"


def progress(text, start="2000-01-01", end="2001-12-31"):
    return job_live.parse_progress(text, run_start=start, run_end=end, read_at=READ_AT)


def test_a_spinup_line_gives_the_loop_and_no_fraction():
    assert progress(SPINUP + "\n") == {
        "phase": "spinup", "loop": 1, "loops": 1, "date": "2000-01-01",
        "run_start": "2000-01-01", "run_end": "2001-12-31", "fraction": None,
        "line": SPINUP, "read_at": READ_AT,
    }


def test_a_run_line_gives_the_fraction_of_the_period():
    got = progress("junk\n" + RUN + "\n")
    done = (date(2001, 12, 22) - date(2000, 1, 1)).days + 1
    total = (date(2001, 12, 31) - date(2000, 1, 1)).days + 1
    assert (done, total) == (722, 731)
    assert got["phase"] == "run" and got["date"] == "2001-12-22"
    assert got["loop"] is None and got["loops"] is None
    assert got["fraction"] == pytest.approx(722 / 731)
    assert got["line"] == RUN


def test_the_last_matching_line_wins():
    first = "File wbm_2000.nc (2000-03-01) Balance=(0)"
    assert progress(f"{first}\n{RUN}\nSomething else\n")["date"] == "2001-12-22"
    assert progress(f"{RUN}\n{SPINUP}\n")["phase"] == "spinup"


def test_the_fraction_stays_between_zero_and_one():
    assert progress("File a.nc (1999-06-01) x", start="2000-01-01")["fraction"] == 0.0
    assert progress("File a.nc (2005-06-01) x", end="2001-12-31")["fraction"] == 1.0


def test_no_fraction_without_a_usable_period():
    assert progress(RUN, start=None, end=None)["fraction"] is None
    assert progress(RUN, start="2002-01-01", end="2001-01-01")["fraction"] is None
    assert progress(RUN, start="garbage", end="2001-12-31")["run_start"] is None


@pytest.mark.parametrize(
    "text",
    [
        "",
        "All Done!",
        "Time used for the job - 829s",
        "Spinup 1/1 2000-01-01",
        "File wbm_2001.nc (2001-13-45) Balance",  # not a date
        "  File wbm_2001.nc (2001-12-22) indented",
        "Reading File wbm_2001.nc (2001-12-22)",
    ],
)
def test_any_other_line_is_no_progress(text):
    assert progress(text) is None


def test_a_long_line_is_cut():
    assert len(progress("File a.nc (2000-02-02) " + "x" * 500)["line"]) == 200


# A continued run: the WBM log is one file every job of the simulation appends to,
# and each WBM start prints a line like this near the top of its run (ADR 0037).
STARTED = "The job started on 2026-10-18 at 09:30:12."
CUT_AT = "File wbm_2001.nc (2001-06-22) Balance=(0.00,0.00,0.00,   8.20,  109.09,   0.81,  0.00, 0.00,0.00) Spool+=2"
RESUMED = "File wbm_2001.nc (2001-01-02) Balance=(0.00,0.00,0.00,   8.20,  109.09,   0.81,  0.00, 0.00,0.00) Spool+=2"


def test_a_job_that_has_printed_no_day_yet_has_no_progress_not_the_one_before_it():
    text = f"The job started on 2026-10-14 at 08:00:00.\n{SPINUP}\n{CUT_AT}\n{STARTED}\nPrevious run state files are read!\n"
    assert progress(text) is None


def test_the_new_jobs_first_day_replaces_the_one_the_earlier_job_was_cut_at():
    text = f"{SPINUP}\n{CUT_AT}\n{STARTED}\nPrevious run state files are read!\n{RESUMED}\n"
    got = progress(text)
    assert got["date"] == "2001-01-02" and got["line"] == RESUMED
    assert got["fraction"] == pytest.approx(368 / 731)


def test_a_start_line_beyond_the_tail_leaves_the_last_day_as_it_is():
    # A tail that holds only day lines: read as before.
    assert progress(f"{SPINUP}\n{CUT_AT}\n")["date"] == "2001-06-22"
    assert progress(f"{CUT_AT}\n{RESUMED}\n")["date"] == "2001-01-02"


def test_the_first_start_of_a_simulation_is_no_progress_until_its_first_day():
    assert progress(f"{STARTED}\nReading inputs\n") is None
    assert progress(f"{STARTED}\n{SPINUP}\n")["phase"] == "spinup"


def running(db, doc_id="job-1"):
    db.users.docs["owner"] = make_user("owner", can_run_simulations=True)
    db.jobs.docs[doc_id] = make_sent_job(doc_id, "owner", "RUNNING")
    return db.jobs.docs[doc_id]


def chunk(data: str, exists: bool = True) -> dict:
    return {"exists": exists, "data": data, "offset": 0, "next_offset": len(data), "size": len(data), "eof": True}


def test_the_status_route_carries_live_and_progress(client, db, slow_lookup, clock, monkeypatch):
    running(db)
    run(job_live.slurm_info(["12345"]))

    async def read_log(doc, stream, offset, limit):
        assert (stream, offset, limit) == ("wbm", None, 4096)
        return chunk(SPINUP + "\n" + RUN + "\n")

    monkeypatch.setattr(slurm, "read_log", read_log)
    body = client.get("/api/v1/jobs/job-1/status", headers=token_for("owner")).json()
    assert body["live"]["progress"]["phase"] == "run"
    assert body["live"]["progress"]["date"] == "2001-12-22"
    assert body["live"]["checked_at"].endswith("Z")
    assert body["live"]["time_limit_seconds"] is None


def test_the_status_route_reports_no_progress_right_after_a_continued_job_starts(
    client, db, slow_lookup, clock, monkeypatch
):
    running(db)
    run(job_live.slurm_info(["12345"]))

    async def read_log(doc, stream, offset, limit):
        return chunk(f"{SPINUP}\n{CUT_AT}\n{STARTED}\n")

    monkeypatch.setattr(slurm, "read_log", read_log)
    body = client.get("/api/v1/jobs/job-1/status", headers=token_for("owner")).json()
    assert body["live"] is not None and body["live"]["progress"] is None


def test_no_live_before_slurm_has_been_heard(client, db, monkeypatch):
    running(db)

    async def update_job_status(job_id):  # no lookup: nothing has been heard
        return await db.jobs.find_one({"_id": job_id})

    monkeypatch.setattr(slurm, "update_job_status", update_job_status)
    body = client.get("/api/v1/jobs/job-1/status", headers=token_for("owner")).json()
    assert body["live"] is None


def test_a_progress_read_that_fails_costs_only_the_progress(client, db, slow_lookup, clock, monkeypatch):
    running(db)
    run(job_live.slurm_info(["12345"]))

    async def read_log(*_a):
        raise SSHTransportError("down")

    monkeypatch.setattr(slurm, "read_log", read_log)
    response = client.get("/api/v1/jobs/job-1/status", headers=token_for("owner"))
    assert response.status_code == 200
    assert response.json()["live"]["progress"] is None
    assert response.json()["live"]["checked_at"]


def test_progress_is_read_only_for_a_running_job_with_a_work_dir(db, slow_lookup, clock, monkeypatch):
    reads = []

    async def read_log(doc, stream, offset, limit):
        reads.append(doc["_id"])
        return chunk(RUN)

    monkeypatch.setattr(slurm, "read_log", read_log)
    run(job_live.slurm_info(["12345"]))
    queued = make_sent_job("q", "owner", "SUBMITTED")
    no_dir = make_sent_job("n", "owner", "RUNNING", work_dir=None)
    assert run(job_live.live_state(queued))["progress"] is None
    assert run(job_live.live_state(no_dir))["progress"] is None
    assert reads == []
    assert run(job_live.live_state(make_sent_job("r", "owner", "RUNNING")))["progress"]["phase"] == "run"
    assert run(job_live.live_state(make_sent_job("c", "owner", "COMPLETING")))["progress"]["phase"] == "run"
    assert reads == ["r", "c"]


def test_viewers_share_one_progress_read_per_window(db, slow_lookup, clock, monkeypatch):
    reads = []

    async def read_log(doc, stream, offset, limit):
        reads.append(1)
        await asyncio.sleep(0.01)
        return chunk(RUN)

    monkeypatch.setattr(slurm, "read_log", read_log)
    run(job_live.slurm_info(["12345"]))
    doc = make_sent_job("job-1", "owner", "RUNNING")

    async def five():
        return await asyncio.gather(*(job_live.live_state(doc) for _ in range(5)))

    assert all(v["progress"]["phase"] == "run" for v in run(five()))
    assert len(reads) == 1
    run(job_live.live_state(doc))
    assert len(reads) == 1
    clock[0] += settings.JOB_LIVE_TTL_SECONDS + 1
    run(job_live.live_state(doc))
    assert len(reads) == 2


def test_the_sweep_never_reads_a_log(db, job, slow_lookup, clock, monkeypatch):
    async def read_log(*_a):
        raise AssertionError("the sweep read a log")

    monkeypatch.setattr(slurm, "read_log", read_log)
    run(slurm.sync_active_jobs())
