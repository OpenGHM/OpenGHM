"""What a viewer of a job page shares (ADR 0027): one SLURM lookup per job per
window, one progress read per running job per window, one log read per offset
per window, and one settling of a job however many callers find it over.

Everything here lives in this process and is a cache, not state: a restart
loses it and costs one lookup, and a second replica would keep its own. Time is
`_clock` (monotonic), which a test replaces.
"""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Awaitable, Callable, Hashable

from slurmly.models import JobInfo

from app.core.config import settings
from app.models.job import TERMINAL_STATUSES
from app.services import slurm

#: The clock every age here is measured on; tests replace it.
_clock: Callable[[], float] = time.monotonic

# How long a SLURM answer stays readable for `live` after the lookups that
# would refresh it start failing. Afterwards it is dropped, not shown.
_INFO_KEPT_SECONDS = 3600

# How much of the WBM log's end the progress read looks at.
PROGRESS_READ_BYTES = 4096
_LINE_MAX = 200


# ---------------------------------------------------------------------------
# single flight
# ---------------------------------------------------------------------------

_flights: dict[Hashable, asyncio.Future] = {}


def _fail(future: asyncio.Future, exc: BaseException) -> None:
    """Hand `exc` to whoever awaits `future`. A cancelled leader is not a
    cancelled follower, so followers get an ordinary error for it."""
    if isinstance(exc, asyncio.CancelledError):
        exc = RuntimeError("the shared call was cancelled")
    future.set_exception(exc)
    future.exception()  # marked as retrieved: there may be no follower


async def single_flight(key: Hashable, factory: Callable[[], Awaitable[Any]]) -> Any:
    """Run `factory()` once for `key` at a time: a caller that finds one running
    awaits its result (or its error) instead of starting another."""
    running = _flights.get(key)
    if running is not None:
        return await asyncio.shield(running)
    future = asyncio.get_running_loop().create_future()
    _flights[key] = future
    try:
        result = await factory()
    except BaseException as exc:
        _fail(future, exc)
        raise
    else:
        future.set_result(result)
        return result
    finally:
        _flights.pop(key, None)


# ---------------------------------------------------------------------------
# a short-lived shared result
# ---------------------------------------------------------------------------

_results: dict[Hashable, tuple[float, Any]] = {}


async def shared(key: Hashable, factory: Callable[[], Awaitable[Any]]) -> Any:
    """`factory()`'s result for `key`, reused for `JOB_LIVE_TTL_SECONDS` and
    computed once at a time. An error is not kept: the next caller tries again."""
    ttl = settings.JOB_LIVE_TTL_SECONDS
    hit = _results.get(key)
    if hit is not None and _clock() - hit[0] < ttl:
        return hit[1]

    async def compute() -> Any:
        value = await factory()
        now = _clock()
        for old in [k for k, (at, _) in _results.items() if now - at >= ttl]:
            del _results[old]
        _results[key] = (now, value)
        return value

    return await single_flight(("shared", key), compute)


# ---------------------------------------------------------------------------
# SLURM answers
# ---------------------------------------------------------------------------


@dataclass
class _Answer:
    info: JobInfo | None  # None: SLURM did not report the job
    at: float  # `_clock` when the lookup started
    checked_at: datetime


_answers: dict[str, _Answer] = {}
_lookups: dict[str, asyncio.Future] = {}


async def slurm_info(ids: list[str], *, refresh: bool = False) -> dict[str, JobInfo | None]:
    """SLURM's answer for each of `ids`: `None` where it did not report the job.

    An answer younger than `JOB_LIVE_TTL_SECONDS` is used as it is; an id with a
    lookup already running waits for that one; the rest go to SLURM in one
    batched `get_jobs`, whose result fills every id it asked for. `refresh`
    (the sweep) ignores a fresh answer but still joins a lookup running. A
    failed lookup raises to everyone waiting on it and is not kept as an
    answer; the older one, if any, stays readable for `live_view`.
    """
    ttl = settings.JOB_LIVE_TTL_SECONDS
    started = _clock()
    wall = datetime.now(timezone.utc)
    found: dict[str, JobInfo | None] = {}
    waiting: dict[str, asyncio.Future] = {}
    missing: list[str] = []
    for slurm_id in dict.fromkeys(str(i) for i in ids):
        answer = _answers.get(slurm_id)
        if not refresh and answer is not None and started - answer.at < ttl:
            found[slurm_id] = answer.info
        elif slurm_id in _lookups:
            waiting[slurm_id] = _lookups[slurm_id]
        else:
            missing.append(slurm_id)

    if missing:
        future = asyncio.get_running_loop().create_future()
        for slurm_id in missing:
            _lookups[slurm_id] = future
        try:
            client = await slurm.get_slurm_client()
            got = await client.get_jobs(missing)
        except BaseException as exc:
            _fail(future, exc)
            raise
        else:
            batch = {slurm_id: got.get(slurm_id) for slurm_id in missing}
            for slurm_id, info in batch.items():
                _answers[slurm_id] = _Answer(info, started, wall)
            future.set_result(batch)
            found.update(batch)
        finally:
            for slurm_id in missing:
                _lookups.pop(slurm_id, None)
        for old in [k for k, a in _answers.items() if started - a.at > _INFO_KEPT_SECONDS]:
            del _answers[old]

    for slurm_id, future in waiting.items():
        found[slurm_id] = (await asyncio.shield(future))[slurm_id]
    return found


# ---------------------------------------------------------------------------
# `live`
# ---------------------------------------------------------------------------


def _number(value: Any) -> float | None:
    """A number out of SLURM's JSON, which wraps them as `{"set", "infinite",
    "number"}` (or does not). Unset, infinite and anything else is None."""
    if isinstance(value, dict):
        if not value.get("set", True) or value.get("infinite"):
            return None
        value = value.get("number")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


_TIMELIMIT_RE = re.compile(r"^(?:(\d+)-)?(\d+):(\d{2}):(\d{2})$")


def time_limit_seconds(raw: dict | None) -> int | None:
    """The limit SLURM enforces, from the row it answered with. squeue's JSON
    (`time_limit`) and sacct's (`time.limit`) count minutes; sacct's parsable
    form prints `[D-]HH:MM:SS`. Anything else, or an unlimited job, is None."""
    if not isinstance(raw, dict):
        return None
    minutes = _number(raw.get("time_limit"))
    if minutes is None and isinstance(raw.get("time"), dict):
        minutes = _number(raw["time"].get("limit"))
    if minutes is not None:
        return int(minutes * 60) if minutes > 0 else None
    text = raw.get("Timelimit")
    match = _TIMELIMIT_RE.match(text.strip()) if isinstance(text, str) else None
    if match is None:
        return None
    days, hours, mins, secs = (int(part or 0) for part in match.groups())
    total = ((days * 24 + hours) * 60 + mins) * 60 + secs
    return total or None


def _estimated_start(info: JobInfo) -> datetime | None:
    if (info.raw_state or "").upper() != "PENDING" or not isinstance(info.raw, dict):
        return None
    epoch = _number(info.raw.get("start_time"))
    if epoch is None or epoch <= 0:
        return None
    try:
        return datetime.fromtimestamp(epoch, timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def live_view(doc: dict, progress: dict | None = None) -> dict | None:
    """The status answer's `live` for `doc`, from the last SLURM answer for it
    (however old: its `checked_at` says), or None for a draft, an ended job, and
    a job SLURM has never been heard about in this process."""
    slurm_id = doc.get("slurm_job_id")
    if doc.get("status") in TERMINAL_STATUSES or doc.get("status") == "DRAFT" or not slurm_id:
        return None
    answer = _answers.get(str(slurm_id))
    if answer is None or answer.info is None:
        return None
    info = answer.info
    reason = (info.queue_reason or "").strip()
    return {
        "checked_at": answer.checked_at,
        "queue_reason": None if not reason or reason.lower() == "none" else reason,
        "estimated_start": _estimated_start(info),
        "time_limit_seconds": time_limit_seconds(info.raw),
        "progress": progress,
    }


async def live_state(doc: dict) -> dict | None:
    """`live_view` with the job's progress: read only for a job that runs and
    has a work directory, and shared for the TTL. Any failure to read it
    leaves `progress` None; it never fails the status route."""
    progress = None
    if doc.get("status") in ("RUNNING", "COMPLETING") and doc.get("work_dir") and live_view(doc):
        try:
            progress = await shared(("progress", doc["_id"]), lambda: _read_progress(doc))
        except Exception:
            progress = None
    return live_view(doc, progress)


# ---------------------------------------------------------------------------
# progress
# ---------------------------------------------------------------------------

_SPINUP_RE = re.compile(r"^Spinup (\d+)/(\d+) \((\d{4}-\d{2}-\d{2})\)")
_RUN_RE = re.compile(r"^File \S+ \((\d{4}-\d{2}-\d{2})\)")


def _date(value: Any) -> date | None:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def parse_progress(
    text: str, *, run_start: Any, run_end: Any, read_at: datetime
) -> dict | None:
    """Progress from the last line of `text` that WBM's per-day output has the
    shape of (ADR 0027), or None when there is none. The fraction is given for
    the run phase only, from the simulation's first and last day."""
    start, end = _date(run_start), _date(run_end)
    for line in reversed(text.splitlines()):
        loop = loops = None
        if match := _SPINUP_RE.match(line):
            phase, loop, loops = "spinup", int(match[1]), int(match[2])
            reached = _date(match[3])
        elif match := _RUN_RE.match(line):
            phase, reached = "run", _date(match[1])
        else:
            continue
        if reached is None:
            continue
        fraction = None
        if phase == "run" and start and end and end >= start:
            done = (reached - start).days + 1
            fraction = min(1.0, max(0.0, done / ((end - start).days + 1)))
        return {
            "phase": phase,
            "loop": loop,
            "loops": loops,
            "date": reached.isoformat(),
            "run_start": start.isoformat() if start else None,
            "run_end": end.isoformat() if end else None,
            "fraction": fraction,
            "line": line.rstrip()[:_LINE_MAX],
            "read_at": read_at,
        }
    return None


async def _read_progress(doc: dict) -> dict | None:
    chunk = await slurm.read_log(doc, "wbm", None, PROGRESS_READ_BYTES)
    if not chunk["exists"]:
        return None
    parameters = doc.get("parameters") or {}
    return parse_progress(
        chunk["data"],
        run_start=parameters.get("temporal_range_start"),
        run_end=parameters.get("temporal_range_end"),
        read_at=datetime.now(timezone.utc),
    )


def reset() -> None:
    """Forget everything (tests)."""
    _flights.clear()
    _results.clear()
    _answers.clear()
    _lookups.clear()
