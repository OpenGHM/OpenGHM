"""Slurm job orchestration via the slurmly library.

All Anvil interactions (sbatch / squeue / sacct / scancel / SFTP log tail)
go through a single shared `SlurmSSHClient`. This module exposes the same
async surface that the API layer used previously — `submit_job`,
`update_job_status`, `cancel_job`, `get_job_logs` — plus the sweep
(`sync_active_jobs`, `clear_orphans`, `detect_purged_files`) that brings every
job to its verdict (ADR 0026).
"""

from __future__ import annotations

import asyncio
import json
import logging
import posixpath
import shlex
from datetime import datetime, timedelta, timezone
from typing import Any

from slurmly import (
    JobSpec,
    SlurmSSHClient,
    SubmittedJob,
    get_preset,
)
from slurmly.cleanup import assert_safe_to_remove
from slurmly.exceptions import InvalidConfig
from slurmly.models import JobInfo

from app.core.audit import SYSTEM_ACTOR, AuditCategory, log_event
from app.core.config import settings
from app.core.database import get_db
from app.models.job import TERMINAL_STATUSES, JobDB, SlurmConfig
from app.services.job_script import SubmitInputError, is_valid_id, with_headroom
from app.services.job_verdict import classify

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifecycle → JobStatus mapping
# ---------------------------------------------------------------------------

# slurmly Lifecycle is lowercase: queued/running/succeeded/failed/cancelled/timeout/unknown.
# Only the two live ones map to a status here; how a job *ends* is decided by
# `job_verdict.classify` from SLURM's raw state and the job's own record, never
# from the lifecycle. "unknown" is intentionally absent — callers must NOT
# transition the DB on unknown.
_LIVE_STATUS: dict[str, str] = {
    "queued": "SUBMITTED",
    "running": "RUNNING",
}
_ENDED_LIFECYCLES = {"succeeded", "failed", "cancelled", "timeout"}
# What a lifecycle's raw state is called when slurmly reports none.
_LIFECYCLE_STATE = {
    "succeeded": "COMPLETED",
    "failed": "FAILED",
    "cancelled": "CANCELLED",
    "timeout": "TIMEOUT",
}


# ---------------------------------------------------------------------------
# Shared client (lazy, lock-protected singleton)
# ---------------------------------------------------------------------------

_client: SlurmSSHClient | None = None
_client_lock = asyncio.Lock()


class AnvilNotConfigured(RuntimeError):
    """The gateway has no way to reach or run anything on Anvil yet: SSH
    credentials or the toolkit install are not set."""


def toolkit_configured() -> bool:
    """Whether a toolkit install is named (`ANVIL_OPENGHM_HOME`). Without one
    a submit runs nothing (ADR 0025)."""
    return bool(settings.ANVIL_OPENGHM_HOME)


def _resolve_remote_base_dir() -> str:
    return settings.ANVIL_REMOTE_BASE_DIR.replace(
        "{username}", settings.ANVIL_SSH_USERNAME
    )


async def get_slurm_client() -> SlurmSSHClient:
    """Return a shared SlurmSSHClient, creating it on first use."""
    global _client
    if _client is not None:
        return _client

    async with _client_lock:
        if _client is not None:
            return _client

        has_key = settings.ANVIL_SSH_KEY_CONTENT or settings.ANVIL_SSH_KEY_PATH
        if not settings.ANVIL_SSH_USERNAME or not has_key:
            raise AnvilNotConfigured(
                "ANVIL_SSH_USERNAME and one of ANVIL_SSH_KEY_CONTENT / "
                "ANVIL_SSH_KEY_PATH must be configured"
            )

        preset = get_preset("purdue_anvil")
        _client = SlurmSSHClient.connect(
            host=settings.ANVIL_SSH_HOST,
            port=settings.ANVIL_SSH_PORT,
            username=settings.ANVIL_SSH_USERNAME,
            key_content=settings.ANVIL_SSH_KEY_CONTENT or None,
            key_path=settings.ANVIL_SSH_KEY_PATH or None,
            remote_base_dir=_resolve_remote_base_dir(),
            cluster_profile=preset.cluster_profile,
            execution_profiles=preset.execution_profiles,
            account=settings.ANVIL_ACCOUNT or None,
            max_concurrent_commands=settings.ANVIL_MAX_CONCURRENT_COMMANDS,
        )
        logger.info(
            "slurmly client connected (host=%s user=%s base=%s)",
            settings.ANVIL_SSH_HOST,
            settings.ANVIL_SSH_USERNAME,
            _resolve_remote_base_dir(),
        )
    return _client


async def close_slurm_client() -> None:
    """Close the shared client (called from FastAPI lifespan shutdown)."""
    global _client
    if _client is not None:
        try:
            await _client.close()
        finally:
            _client = None


def client_state() -> str:
    """Report the shared client's state without connecting.

    Deliberately does not call get_slurm_client(): that opens a real SSH
    session to Anvil, which a status page should not do on every load (it's
    slow and hits a shared HPC login node). "connected" means the singleton
    is warm — a job has been submitted/polled since boot; "idle" means
    configured but not yet warmed up; "unconfigured" means the SSH
    credentials aren't set at all.
    """
    has_key = bool(settings.ANVIL_SSH_KEY_CONTENT or settings.ANVIL_SSH_KEY_PATH)
    if not settings.ANVIL_SSH_USERNAME or not has_key:
        return "unconfigured"
    return "connected" if _client is not None else "idle"


# ---------------------------------------------------------------------------
# JobSpec construction
# ---------------------------------------------------------------------------


def resolve_compute(slurm_config: SlurmConfig, snapshot: dict) -> tuple[int, str]:
    """`(cores, walltime)` a job asks SLURM for: the draft's own choice, else
    the snapshot's `simulation.recommendedCompute` (the spec requires both
    there, so a real snapshot always answers).

    Cores are the recommendation as it is. A walltime the draft chose is sent
    as written; the snapshot's is sent with 50% headroom (`with_headroom`),
    because the recommendation is what a run took, not what it is safe to ask
    for. Both are SLURM `--time` syntax: `15:00` is fifteen minutes.
    """
    recommended = snapshot.get("simulation", {}).get("recommendedCompute") or {}
    cores = slurm_config.cores or recommended.get("cores")
    walltime = slurm_config.walltime or (
        with_headroom(str(recommended["walltime"])) if recommended.get("walltime") else None
    )
    if not cores or not walltime:
        raise SubmitInputError(
            "The snapshot does not say how many cores and how much time it needs, "
            "and the simulation does not either."
        )
    return int(cores), str(walltime)


def build_job_spec(job: JobDB, snapshot: dict, body: str) -> JobSpec:
    """The slurmly spec for a gateway job. `--cpus-per-task`, not
    `--nodes`/`--ntasks`: the toolkit runs one container, and that is how it
    asks for cores itself. The account and partition are the gateway's."""
    cores, walltime = resolve_compute(job.slurm_config, snapshot)
    return JobSpec(
        name=job.slurm_job_name or job.sim_id or job.id,
        command_template=body,
        partition=settings.ANVIL_PARTITION,
        account=settings.ANVIL_ACCOUNT or None,
        qos=settings.ANVIL_QOS,
        cpus_per_task=cores,
        time_limit=walltime,
        execution_profile=settings.ANVIL_EXECUTION_PROFILE,
        metadata={"openghm_job_id": job.id, "dataset_id": job.dataset_id},
    )


def _reconstruct_submitted_job(doc: dict[str, Any]) -> SubmittedJob:
    """Rebuild a SubmittedJob from persisted DB fields (for tail/cleanup)."""
    return SubmittedJob(
        internal_job_id=doc["internal_job_id"],
        slurm_job_id=doc["slurm_job_id"],
        remote_job_dir=doc["remote_job_dir"],
        remote_script_path=doc["remote_script_path"],
        stdout_path=doc["stdout_path"],
        stderr_path=doc["stderr_path"],
        submitted_at=doc.get("slurmly_submitted_at"),
    )


# ---------------------------------------------------------------------------
# submit
# ---------------------------------------------------------------------------


async def submit_job(job: JobDB, snapshot: dict, body: str) -> SubmittedJob:
    """Submit `job` to SLURM as a batch job whose body is `body`.

    Transport only: nothing is written to MongoDB here. The caller (the submit
    route) owns the job's state, because a failed submit must leave the draft a
    draft, and decides from the exception what to tell the user. Raises
    `SubmitInputError` for a request that cannot be built, `AnvilNotConfigured`,
    and whatever slurmly raises (`SSHTransportError`, `SbatchError`, ...).
    """
    spec = build_job_spec(job, snapshot, body)
    client = await get_slurm_client()
    submitted: SubmittedJob = await client.submit(spec)
    logger.info(
        "Job %s submitted → slurm=%s remote=%s",
        job.id,
        submitted.slurm_job_id,
        submitted.remote_job_dir,
    )
    return submitted


# ---------------------------------------------------------------------------
# raw remote commands
# ---------------------------------------------------------------------------


async def run_remote(command: str, *, operation: str, retry_safe: bool = False):
    """Run one shell command on Anvil and return slurmly's `CommandResult`
    (`exit_status`, `stdout`, `stderr`); a transport failure raises.

    slurmly has no public "run this command" API, so this reaches for the
    client's `_run`, which every slurmly operation goes through (its
    concurrency limit and hooks). That is a private API of a pinned commit
    (rule 2): the one place to change when the pin moves. `retry_safe` is for
    a command that does the same thing run twice — a read, a `rm -rf`, an
    `scancel` — because slurmly re-sends those after a dropped connection.
    """
    client = await get_slurm_client()
    return await client._run(command, operation=operation, check=False, retry_safe=retry_safe)


async def read_outcome(remote_job_dir: str) -> dict | None:
    """The job's `outcome.json`, or None when there is none or it does not
    parse to an object. A transport failure raises, because that is not the
    same as "the job left no record"."""
    path = posixpath.join(remote_job_dir, "outcome.json")
    result = await run_remote(
        f"[ -f {shlex.quote(path)} ] && cat -- {shlex.quote(path)}",
        operation="read_outcome",
        retry_safe=True,
    )
    if result.exit_status == 1:  # the test failed: no such file
        return None
    if result.exit_status != 0:
        raise RuntimeError(f"reading {path} failed with exit {result.exit_status}")
    try:
        record = json.loads(result.stdout)
    except ValueError:
        logger.warning("outcome.json in %s is not valid JSON", remote_job_dir)
        return None
    return record if isinstance(record, dict) else None


async def _stderr_tail(doc: dict) -> str:
    try:
        submitted = _reconstruct_submitted_job(doc)
    except KeyError:
        return ""  # a row that pre-dates slurmly's fields: nothing to tail
    client = await get_slurm_client()
    chunk = await client.tail_stderr(submitted, lines=_STDERR_TAIL_LINES)
    return getattr(chunk, "content", "") or ""


_STDERR_TAIL_LINES = 200
_ACTIVE = ["PENDING", "SUBMITTED", "RUNNING", "COMPLETING"]
# slurmly's `submit_grace_window_seconds` for the `purdue_anvil` preset: for
# this long after sbatch, "not found" is a lookup that is too early.
_SUBMIT_GRACE_SECONDS = 120


# ---------------------------------------------------------------------------
# status: the sweep
# ---------------------------------------------------------------------------


def _as_utc(value: datetime | str | None) -> datetime | None:
    """A timestamp as an aware UTC datetime. Mongo's are already aware (the
    client is tz_aware); slurmly's are ISO strings, sometimes with a `Z` and
    sometimes bare (sacct's parsable form). `Unknown`, `None`, empty and
    garbage are None."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or text.lower() in {"unknown", "none", "n/a"}:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def _move(
    doc: dict,
    fields: dict[str, Any],
    *,
    unset: tuple[str, ...] = (),
    cause: str | None = None,
) -> bool:
    """Write `fields` to a job only if it is still in the status `doc` was
    read in, so a cancel, a submit or another sweep that moved it first is not
    overwritten. Returns whether the write happened. A change of status is
    audit-logged, once: only the writer that won it gets here."""
    now = datetime.now(timezone.utc)
    update: dict[str, Any] = {"$set": {**fields, "updated_at": now}}
    if unset:
        update["$unset"] = {key: "" for key in unset}
    result = await get_db().jobs.update_one({"_id": doc["_id"], "status": doc["status"]}, update)
    if result.matched_count == 0:
        logger.info("Job %s left %s while it was being updated; leaving it", doc["_id"], doc["status"])
        return False
    new_status = fields.get("status", doc["status"])
    if new_status != doc["status"]:
        # A poll that finds no change never reaches here, so the audit log
        # records real transitions only, not polling noise.
        await log_event(
            "job_status_changed",
            actor_id=SYSTEM_ACTOR,
            target_id=doc["_id"],
            category=AuditCategory.JOB,
            detail={
                "from": doc["status"],
                "to": new_status,
                "slurm_job_id": str(doc.get("slurm_job_id")),
                "user_id": doc.get("user_id"),
                **({"cause": cause} if cause else {}),
                **({"slurm_state": fields["slurm_state"]} if fields.get("slurm_state") else {}),
            },
        )
    return True


async def _conclude(doc: dict, *, slurm_state: str | None, info: JobInfo | None, missing: bool) -> bool:
    """Reach the verdict on a job that is over (or that SLURM has forgotten)
    and store it with everything it rests on. Reads `outcome.json` and the end
    of stderr over SSH; if either cannot be read, nothing is written and the
    next tick tries again. Returns whether a verdict was written."""
    try:
        outcome = await read_outcome(doc["remote_job_dir"]) if doc.get("remote_job_dir") else None
        stderr_tail = await _stderr_tail(doc)
    except Exception as exc:
        logger.warning("Job %s: could not read its result yet: %s", doc["_id"], exc)
        return False

    verdict = classify(
        slurm_state=slurm_state,
        cancel_requested=bool(doc.get("cancel_requested_at")),
        outcome=outcome,
        stderr_tail=stderr_tail,
        missing=missing,
    )
    now = datetime.now(timezone.utc)
    slurm_start = _as_utc(info.start_time) if info else None
    slurm_end = _as_utc(info.end_time) if info else None
    fields: dict[str, Any] = {
        "status": verdict.status,
        "status_reason": verdict.failure.message if verdict.failure else None,
        "failure": verdict.failure.model_dump() if verdict.failure else None,
        "outcome": outcome,
        "completed_at": slurm_end or now,
    }
    if slurm_state:
        fields["slurm_state"] = slurm_state
    if info is not None and info.exit_code:
        fields["slurm_exit_code"] = info.exit_code
    if slurm_start:
        fields["slurm_start"] = slurm_start
        if doc.get("started_at") is None:
            fields["started_at"] = slurm_start  # it ended before a poll saw it run
    if slurm_end:
        fields["slurm_end"] = slurm_end
    if verdict.status == "COMPLETED" or (outcome or {}).get("staged"):
        fields["files"] = "present"
    return await _move(
        doc,
        fields,
        unset=("missing_since",),
        cause=verdict.failure.cause if verdict.failure else None,
    )


async def _settle(doc: dict, info: JobInfo | None) -> None:
    """Bring one non-terminal job in line with what SLURM reported for it
    (`info`), or with SLURM not reporting it (None)."""
    now = datetime.now(timezone.utc)

    if info is None:
        # Not in squeue or sacct. That is a fact about one lookup, not about
        # the job: slurmly also answers "absent" when both commands failed.
        # Only a job that stays absent for a while, past slurmly's submit
        # grace window, is judged (ADR 0026, rule 4).
        missing_since = _as_utc(doc.get("missing_since"))
        if missing_since is None:
            await _move(doc, {"missing_since": now})
            return
        submitted = _as_utc(doc.get("slurmly_submitted_at")) or _as_utc(doc.get("submitted_at"))
        lost_after = timedelta(seconds=settings.JOB_LOST_AFTER_SECONDS)
        in_grace = submitted is not None and now - submitted <= timedelta(
            seconds=_SUBMIT_GRACE_SECONDS
        )
        if now - missing_since >= lost_after and not in_grace:
            await _conclude(doc, slurm_state=None, info=None, missing=True)
        return

    lifecycle = info.lifecycle
    if lifecycle in _ENDED_LIFECYCLES:
        state = info.raw_state or _LIFECYCLE_STATE[lifecycle]
        try:
            await _conclude(doc, slurm_state=state, info=info, missing=False)
        except ValueError as exc:  # a state classify does not know as an ending
            logger.warning("Job %s: %s", doc["_id"], exc)
        return
    if lifecycle not in _LIVE_STATUS:
        return  # "unknown": a lookup miss, don't transition

    new_status = _LIVE_STATUS[lifecycle]
    fields: dict[str, Any] = {}
    if new_status != doc["status"]:
        fields["status"] = new_status
    if info.raw_state and info.raw_state != doc.get("slurm_state"):
        fields["slurm_state"] = info.raw_state
    if new_status == "RUNNING":
        if doc.get("started_at") is None:
            fields["started_at"] = now
        if doc.get("slurm_start") is None:
            fields["slurm_start"] = _as_utc(info.start_time) or now
    unset = ("missing_since",) if doc.get("missing_since") is not None else ()
    if fields or unset:
        await _move(doc, fields, unset=unset)


async def sync_active_jobs() -> None:
    """One sweep: look up every job that has a SLURM id and no verdict, in one
    batched call, and settle each. If the lookup itself fails the whole tick
    is skipped, so a broken connection records no misses."""
    db = get_db()
    docs = [
        doc
        async for doc in db.jobs.find(
            {"status": {"$in": _ACTIVE}, "slurm_job_id": {"$ne": None}}
        )
    ]
    if not docs:
        return
    ids = [str(doc["slurm_job_id"]) for doc in docs]
    try:
        client = await get_slurm_client()
        found = await client.get_jobs(ids)
    except Exception as exc:
        logger.warning("Sweep: batched lookup of %d jobs failed, skipping this tick: %s", len(ids), exc)
        return

    for doc, slurm_id in zip(docs, ids):
        try:
            await _settle(doc, found.get(slurm_id))
        except Exception as exc:
            logger.warning("Sweep: job %s failed: %s", doc["_id"], exc)


async def update_job_status(job_id: str) -> dict[str, Any]:
    """Refresh one job from Slurm the way the sweep does, for the status poll
    (GET /jobs/{id}/status). Returns the (possibly updated) document."""
    db = get_db()
    doc = await db.jobs.find_one({"_id": job_id})
    if doc is None:
        raise RuntimeError(f"Job {job_id} not found")

    slurm_job_id = doc.get("slurm_job_id")
    if doc.get("status") in TERMINAL_STATUSES or not slurm_job_id:
        return doc

    try:
        client = await get_slurm_client()
        found = await client.get_jobs([str(slurm_job_id)])
    except Exception as exc:
        logger.warning("get_jobs failed for %s: %s", job_id, exc)
        return doc

    await _settle(doc, found.get(str(slurm_job_id)))
    return await db.jobs.find_one({"_id": job_id}) or doc


# ---------------------------------------------------------------------------
# what a submit that may have reached SLURM leaves behind
# ---------------------------------------------------------------------------


async def scancel_by_name(sim_id: str) -> bool:
    """`scancel --name=<sim_id> --user=<ssh user>`: a `sim_id` names one submit
    attempt and no other job, so this removes a job the user was never told
    about. scancel exits 0 when nothing matches. Returns whether it ran."""
    result = await run_remote(
        f"scancel --name={shlex.quote(sim_id)} --user={shlex.quote(settings.ANVIL_SSH_USERNAME)}",
        operation="scancel_by_name",
        retry_safe=True,
    )
    if result.exit_status != 0:
        logger.warning("scancel --name=%s failed (%s): %s", sim_id, result.exit_status, result.stderr.strip())
    return result.exit_status == 0


async def clear_orphans() -> None:
    """Retry the `scancel --name` of every job that still carries a `sim_id`
    whose submit may have reached SLURM (`orphan_sim_ids`: a draft after a lost
    answer, a cancelled job whose answer came too late); drop the ones that
    worked."""
    db = get_db()
    carriers = [
        doc
        async for doc in db.jobs.find({"orphan_sim_ids": {"$exists": True, "$ne": []}})
    ]
    for doc in carriers:
        for sim_id in doc.get("orphan_sim_ids") or []:
            try:
                if await scancel_by_name(sim_id):
                    await db.jobs.update_one({"_id": doc["_id"]}, {"$pull": {"orphan_sim_ids": sim_id}})
            except Exception as exc:
                logger.warning("Orphan %s of job %s: %s", sim_id, doc["_id"], exc)


async def remove_failed_submit_dirs(sim_id: str) -> None:
    """Remove slurmly's job directory left by a submit sbatch refused. slurmly
    creates it before sbatch runs and never learns of it again, and the
    gateway never got its path, so it is found by its `metadata.json` naming
    the attempt's `sim_id`. Best-effort: a failure is logged and nothing else
    changes."""
    base = _resolve_remote_base_dir().rstrip("/")
    try:
        client = await get_slurm_client()
        needle = f'"name": "{sim_id}"'  # how metadata.json spells the spec's name
        found = await run_remote(
            f"grep -l -F {shlex.quote(needle)} {shlex.quote(base + '/jobs/')}slurmly-*/metadata.json",
            operation="find_failed_submit",
            retry_safe=True,
        )
        for line in found.stdout.splitlines():
            directory = posixpath.dirname(line.strip())
            if not directory:
                continue
            result = await client.cleanup_remote_job_dir(_job_at(directory))
            if result.errors:
                logger.warning("Leftover %s of a failed submit not removed: %s", directory, result.errors)
    except Exception as exc:
        logger.warning("Could not clean up after failed submit %s: %s", sim_id, exc)


# ---------------------------------------------------------------------------
# files: delete
# ---------------------------------------------------------------------------


class RefusedPath(Exception):
    """A path a job's delete would remove is not one the gateway may remove.
    Nothing has been removed."""


class CleanupFailed(Exception):
    """Anvil was reached and a removal failed. The job's document must stay."""


def _job_at(directory: str) -> SubmittedJob:
    """A SubmittedJob naming only its directory: all `cleanup_remote_job_dir`
    reads is `remote_job_dir`."""
    try:
        return SubmittedJob(
            internal_job_id=posixpath.basename(directory),
            slurm_job_id="0",
            remote_job_dir=directory,
            remote_script_path=posixpath.join(directory, "run.sh"),
            stdout_path=posixpath.join(directory, "stdout.log"),
            stderr_path=posixpath.join(directory, "stderr.log"),
        )
    except ValueError as exc:  # not named `slurmly-<8 hex>`
        raise RefusedPath(f"{directory} is not a slurmly job directory") from exc


def removable_paths(doc: dict) -> tuple[str | None, str | None]:
    """`(slurmly job directory, work directory)` a job's delete removes, each
    None when the job has none recorded (ADR 0026). Raises `RefusedPath` for
    a path outside the allow-list: slurmly's directory must be under
    `<base>/jobs/`, and the work directory must be exactly
    `<ANVIL_OUTPUT_BASE>/<sim_id>` for a `sim_id` of the id pattern. Nothing
    else belongs to a job: the snapshot, model-input and image caches are
    shared, and a job never removes them."""
    remote_dir = doc.get("remote_job_dir") or None
    work_dir = doc.get("work_dir") or None
    if remote_dir:
        try:
            assert_safe_to_remove(remote_dir, remote_base_dir=_resolve_remote_base_dir())
        except InvalidConfig as exc:
            raise RefusedPath(str(exc)) from exc
        _job_at(remote_dir)
    if work_dir:
        sim_id = doc.get("sim_id") or ""
        if (
            not is_valid_id(sim_id)
            or ".." in work_dir.split("/")
            or work_dir != posixpath.join(settings.ANVIL_OUTPUT_BASE, sim_id)
        ):
            raise RefusedPath(f"{work_dir!r} is not this simulation's directory under the output base")
    return remote_dir, work_dir


async def remove_job_files(doc: dict) -> list[str]:
    """Remove a finished job's two directories from Anvil and return what was
    removed. Every path is checked before anything is touched. Raises
    `RefusedPath` (nothing removed), `CleanupFailed` (Anvil said no), and
    whatever the transport raises when Anvil cannot be reached."""
    remote_dir, work_dir = removable_paths(doc)
    removed: list[str] = []
    if work_dir:
        quoted = shlex.quote(work_dir)
        # `rm -rf` follows nothing, but a work directory that is a symlink is
        # not the directory the gateway made: refuse it rather than remove
        # whatever it was pointed at (or its link, unasked).
        result = await run_remote(
            f"[ -L {quoted} ] && exit 3; rm -rf -- {quoted}",
            operation="delete_work_dir",
            retry_safe=True,
        )
        if result.exit_status == 3:
            raise RefusedPath(f"{work_dir} is a symbolic link")
        if result.exit_status != 0:
            raise CleanupFailed(f"{work_dir}: exit {result.exit_status}: {result.stderr.strip()[:200]}")
        removed.append(work_dir)
    if remote_dir:
        client = await get_slurm_client()
        outcome = await client.cleanup_remote_job_dir(_job_at(remote_dir))
        if outcome.errors:
            raise CleanupFailed("; ".join(outcome.errors))
        removed.extend(outcome.removed)
    return removed


# ---------------------------------------------------------------------------
# files: purge detection
# ---------------------------------------------------------------------------

_PURGE_CHECK_BATCH = 100


async def detect_purged_files() -> None:
    """Anvil purges scratch files nobody touched for 30 days (ADR 0026). Once
    a day per job, one SSH command per batch lists which finished jobs' work
    directories still exist; a missing one sets `files: purged`."""
    db = get_db()
    now = datetime.now(timezone.utc)
    due_before = now - timedelta(seconds=settings.JOB_FILES_CHECK_INTERVAL_SECONDS)
    due = []
    async for doc in db.jobs.find({"files": "present"}):
        checked = _as_utc(doc.get("files_checked_at"))
        if doc.get("work_dir") and (checked is None or checked <= due_before):
            due.append(doc)

    for i in range(0, len(due), _PURGE_CHECK_BATCH):
        batch = due[i : i + _PURGE_CHECK_BATCH]
        paths = " ".join(shlex.quote(doc["work_dir"]) for doc in batch)
        try:
            result = await run_remote(
                f'for d in {paths}; do [ -d "$d" ] && echo "$d"; done',
                operation="check_work_dirs",
                retry_safe=True,
            )
        except Exception as exc:
            logger.warning("Purge check failed, will try again: %s", exc)
            return
        if result.exit_status not in (0, 1):  # 1 is the last `[ -d ]` being false
            logger.warning("Purge check exited %s, will try again", result.exit_status)
            return
        present = set(result.stdout.split("\n"))
        for doc in batch:
            fields: dict[str, Any] = {"files_checked_at": now}
            if doc["work_dir"] not in present:
                fields["files"] = "purged"
            await db.jobs.update_one({"_id": doc["_id"], "files": "present"}, {"$set": fields})


# ---------------------------------------------------------------------------
# cancel
# ---------------------------------------------------------------------------


async def cancel_job(slurm_job_id: str) -> bool:
    """Send scancel for the given Slurm job ID."""
    client = await get_slurm_client()
    await client.cancel(slurm_job_id)
    return True


# ---------------------------------------------------------------------------
# logs
# ---------------------------------------------------------------------------


_LOG_TAIL_LINES = 500


async def get_job_logs(job_id: str) -> tuple[str, str, bool]:
    """Tail stdout/stderr from Anvil. Returns (stdout, stderr, truncated)."""
    db = get_db()
    doc = await db.jobs.find_one({"_id": job_id})
    if doc is None:
        raise RuntimeError(f"Job {job_id} not found")

    if not doc.get("remote_job_dir") or not doc.get("slurm_job_id"):
        return ("", "", False)

    try:
        submitted = _reconstruct_submitted_job(doc)
    except KeyError:
        # Older row that pre-dates slurmly fields — nothing to tail.
        return ("", "", False)

    client = await get_slurm_client()
    stdout_chunk = await client.tail_stdout(submitted, lines=_LOG_TAIL_LINES)
    stderr_chunk = await client.tail_stderr(submitted, lines=_LOG_TAIL_LINES)

    stdout = getattr(stdout_chunk, "content", "") or ""
    stderr = getattr(stderr_chunk, "content", "") or ""
    truncated = bool(
        getattr(stdout_chunk, "truncated", False)
        or getattr(stderr_chunk, "truncated", False)
    )

    return (stdout, stderr, truncated)
