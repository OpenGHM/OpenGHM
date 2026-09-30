"""Slurm job orchestration via the slurmly library.

All Anvil interactions (sbatch / squeue / sacct / scancel / SFTP log tail)
go through a single shared `SlurmSSHClient`. This module exposes the same
async surface that the API layer used previously — `submit_job`,
`update_job_status`, `cancel_job`, `get_job_logs` — so callers don't change.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any

from slurmly import (
    JobSpec,
    SlurmSSHClient,
    SubmittedJob,
    get_preset,
)
from slurmly.polling import is_terminal

from app.core.audit import SYSTEM_ACTOR, AuditCategory, log_event
from app.core.config import settings
from app.core.database import get_db
from app.models.job import TERMINAL_STATUSES, JobDB

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifecycle → JobStatus mapping
# ---------------------------------------------------------------------------

# slurmly Lifecycle is lowercase: queued/running/succeeded/failed/cancelled/timeout/unknown.
# "unknown" is intentionally absent — callers must NOT transition the DB on unknown.
_LIFECYCLE_MAP: dict[str, str] = {
    "queued": "SUBMITTED",
    "running": "RUNNING",
    "succeeded": "COMPLETED",
    "failed": "FAILED",
    "cancelled": "CANCELLED",
    "timeout": "FAILED",
}


# ---------------------------------------------------------------------------
# Shared client (lazy, lock-protected singleton)
# ---------------------------------------------------------------------------

_client: SlurmSSHClient | None = None
_client_lock = asyncio.Lock()


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
            raise RuntimeError(
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


# Recorded on the job document (and shown in the UI) whenever a submission
# runs the placeholder instead of a model, so a COMPLETED job that computed
# nothing cannot be mistaken for one that did. See is_placeholder_run().
PLACEHOLDER_REASON = (
    "Placeholder run: ANVIL_CONTAINER_IMAGE is not set, so this job executed "
    "no model. Nothing was computed and no output was produced."
)


def is_placeholder_run() -> bool:
    """True when submissions cannot run a model, only the smoke-test echo."""
    return not settings.ANVIL_CONTAINER_IMAGE


def _build_command_template(job: JobDB) -> str:
    """Bash command body executed inside the slurmly-rendered batch script.

    slurmly's execution_profile (anvil_cpu_modules) supplies the module-load
    preamble; we just emit the simulation command.
    """
    container = settings.ANVIL_CONTAINER_IMAGE
    if not container:
        # Smoke-test fallback: emit a recognisable line so dev jobs still produce output.
        return 'echo "OPENGHM placeholder run — set ANVIL_CONTAINER_IMAGE for real jobs"'

    # NOTE: this invocation does not match how the deployed WBM images are
    # actually run, and setting ANVIL_CONTAINER_IMAGE alone will produce
    # failing jobs rather than working ones. Their runscript is /bin/bash, so
    # they take a command, not these flags; a real run binds a snapshot's
    # model/utilities/wbm_init/gdal_test_files, its model input (data,
    # data_init) and per-run spool/wbm_output/WBM_run_state, and executes
    # /wbm/model/wbm.pl against an init file — see
    # images/wbm-v2-lite/run/wbm-run and images/wbm-v2-lite/test/*.slurm.
    # Closing that gap needs a job-to-snapshot/init mapping this model has no
    # field for; it is open item 11 in devdocs/reference/open-items.md.
    return (
        f"apptainer run {container} "
        '--temporal-start "$OPENGHM_TEMPORAL_START" '
        '--temporal-end "$OPENGHM_TEMPORAL_END"'
    )


def _build_env(job: JobDB) -> dict[str, str]:
    params = job.parameters
    env: dict[str, str] = {
        "OPENGHM_TEMPORAL_START": params.temporal_range_start,
        "OPENGHM_TEMPORAL_END": params.temporal_range_end,
        "OPENGHM_DATASET_ID": job.dataset_id,
    }

    if params.spatial_domain:
        sd = params.spatial_domain
        env["OPENGHM_SPATIAL_NORTH"] = str(sd.north)
        env["OPENGHM_SPATIAL_SOUTH"] = str(sd.south)
        env["OPENGHM_SPATIAL_EAST"] = str(sd.east)
        env["OPENGHM_SPATIAL_WEST"] = str(sd.west)

    if params.variables:
        env["OPENGHM_VARIABLES"] = ",".join(params.variables)

    if params.custom_params:
        for key, val in params.custom_params.items():
            safe_key = re.sub(r"[^A-Za-z0-9_]", "_", key).upper()
            env[f"OPENGHM_CUSTOM_{safe_key}"] = val

    return env


def _build_job_spec(job: JobDB) -> JobSpec:
    cfg = job.slurm_config
    return JobSpec(
        name=job.slurm_job_name,
        command_template=_build_command_template(job),
        partition=cfg.partition or settings.ANVIL_PARTITION,
        account=cfg.account or settings.ANVIL_ACCOUNT or None,
        qos=settings.ANVIL_QOS,
        nodes=cfg.nodes or settings.JOB_DEFAULT_NODES,
        ntasks=cfg.ntasks or settings.JOB_DEFAULT_NTASKS,
        memory=cfg.memory,
        time_limit=cfg.walltime or settings.JOB_DEFAULT_WALLTIME,
        execution_profile=settings.ANVIL_EXECUTION_PROFILE,
        env=_build_env(job),
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


async def submit_job(job_id: str) -> str:
    """Submit a queued job to Slurm.

    Updates the MongoDB document with slurmly's `SubmittedJob` fields.
    On failure marks the job as FAILED and re-raises.
    """
    db = get_db()
    doc = await db.jobs.find_one({"_id": job_id})
    if doc is None:
        raise RuntimeError(f"Job {job_id} not found in database")

    job = JobDB(**doc)
    spec = _build_job_spec(job)

    try:
        client = await get_slurm_client()
        submitted: SubmittedJob = await client.submit(spec)

        now = datetime.now(timezone.utc)
        updates: dict[str, Any] = {
            "slurm_job_id": submitted.slurm_job_id,
            "internal_job_id": submitted.internal_job_id,
            "remote_job_dir": submitted.remote_job_dir,
            "remote_script_path": submitted.remote_script_path,
            "stdout_path": submitted.stdout_path,
            "stderr_path": submitted.stderr_path,
            "slurmly_submitted_at": submitted.submitted_at,
            "status": "SUBMITTED",
            "submitted_at": now,
            "updated_at": now,
        }
        # Set here rather than on completion because update_job_status() only
        # writes status_reason for timeout/non-zero exit — a placeholder run
        # succeeds, so nothing later would ever mark it.
        if is_placeholder_run():
            updates["status_reason"] = PLACEHOLDER_REASON

        await db.jobs.update_one({"_id": job_id}, {"$set": updates})

        logger.info(
            "Job %s submitted → slurm=%s remote=%s",
            job_id,
            submitted.slurm_job_id,
            submitted.remote_job_dir,
        )
        return submitted.slurm_job_id

    except Exception as exc:
        await db.jobs.update_one(
            {"_id": job_id},
            {
                "$set": {
                    "status": "FAILED",
                    "status_reason": str(exc),
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        logger.error("Job %s submission failed: %s", job_id, exc)
        raise


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------


async def update_job_status(job_id: str) -> dict[str, Any]:
    """Refresh status from Slurm and persist transitions to MongoDB.

    Returns the (possibly updated) document.
    """
    db = get_db()
    doc = await db.jobs.find_one({"_id": job_id})
    if doc is None:
        raise RuntimeError(f"Job {job_id} not found")

    if doc.get("status") in TERMINAL_STATUSES:
        return doc

    slurm_job_id = doc.get("slurm_job_id")
    if not slurm_job_id:
        return doc

    try:
        client = await get_slurm_client()
        info = await client.get_job(
            slurm_job_id,
            submitted_at=doc.get("slurmly_submitted_at"),
        )
    except Exception as exc:
        logger.warning("get_job failed for %s: %s", job_id, exc)
        return doc

    lifecycle = info.lifecycle
    # Treat "unknown" as a transient lookup miss — don't transition.
    if lifecycle not in _LIFECYCLE_MAP:
        return doc

    new_status = _LIFECYCLE_MAP[lifecycle]
    current = doc["status"]
    now = datetime.now(timezone.utc)
    updates: dict[str, Any] = {"updated_at": now}

    if new_status != current:
        updates["status"] = new_status

        if new_status == "RUNNING" and doc.get("started_at") is None:
            updates["started_at"] = now

        if new_status in TERMINAL_STATUSES and doc.get("completed_at") is None:
            updates["completed_at"] = now

        if lifecycle == "timeout":
            updates["status_reason"] = "Job exceeded time limit"
        elif lifecycle == "failed" and info.exit_code:
            updates["status_reason"] = f"Exit code: {info.exit_code}"

        # Inside the transition branch on purpose: this function also runs
        # on every status poll (background sync tick + GET /jobs/{id}/status),
        # and a poll that finds no change never reaches here — so the audit
        # log records real transitions only, not polling noise.
        await log_event(
            "job_status_changed",
            actor_id=SYSTEM_ACTOR,
            target_id=job_id,
            category=AuditCategory.JOB,
            detail={
                "from": current,
                "to": new_status,
                "slurm_job_id": str(slurm_job_id),
                "user_id": doc.get("user_id"),
                **(
                    {"reason": updates["status_reason"]}
                    if "status_reason" in updates
                    else {}
                ),
            },
        )

    await db.jobs.update_one({"_id": job_id}, {"$set": updates})

    # is_terminal sanity log only
    if is_terminal(info):
        logger.debug("Job %s reached terminal lifecycle %s", job_id, lifecycle)

    doc.update(updates)
    return doc


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
