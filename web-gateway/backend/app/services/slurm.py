"""Slurm job orchestration via the slurmly library.

All Anvil interactions (sbatch / squeue / sacct / scancel / SFTP log tail)
go through a single shared `SlurmSSHClient`. This module exposes the same
async surface that the API layer used previously — `submit_job`,
`update_job_status`, `cancel_job`, `read_log` — plus the sweep
(`sync_active_jobs`, `clear_orphans`, `detect_purged_files`) that brings every
job to its verdict (ADR 0026). The SLURM answers it acts on are shared with the
status route through `job_live` (ADR 0027).
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import posixpath
import shlex
from datetime import datetime, timedelta, timezone
from typing import Any

from slurmly import (
    ExecutionProfile,
    JobSpec,
    SlurmSSHClient,
    SubmittedJob,
    get_preset,
)
from slurmly.cleanup import assert_safe_to_remove
from slurmly.exceptions import InvalidConfig
from pymongo.errors import DuplicateKeyError
from slurmly.models import JobInfo
from slurmly.slurm.commands import build_sacct_json_many
from slurmly.slurm.parser import parse_sacct_json_all

from app.core.audit import SYSTEM_ACTOR, AuditCategory, log_event
from app.core.config import settings
from app.core.database import get_db
from app.models.job import (
    SLURM_NO_VAL,
    TERMINAL_STATUSES,
    JobDB,
    JobParameters,
    SlurmConfig,
    read_stored_parameters,
    real_time,
)
from app.models.repository import build_envelope
from app.services import job_live, publish, run_start
from app.services.job_script import (
    SubmitInputError,
    is_valid_id,
    parse_slurm_time,
    recommended_walltime,
    runs_climatology,
    with_headroom,
)
from app.services.job_verdict import classify, slurm_state_head

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
# Module preamble
# ---------------------------------------------------------------------------


def gateway_execution_profiles() -> dict[str, ExecutionProfile]:
    """slurmly's execution profiles with a quiet module preamble.

    The job's stderr is shown as written, so the preamble must not write to it
    on a good simulation: Lmod's "modules were not unloaded" notice (the sticky `xalt`
    survives `module purge`) and `module list`'s table would be its first
    lines on every job. `-q` silences Lmod's warnings only; an error (an
    unknown module) is still printed and still returns non-zero, and slurmly
    renders `set -euo pipefail` before the preamble, so a failed `module load`
    fails the job. `module list` only informs, so it is dropped. The sticky
    module is left alone."""
    quiet: dict[str, ExecutionProfile] = {}
    for name, profile in get_preset("purdue_anvil").execution_profiles.items():
        lines = [
            "module -q " + line[len("module "):] if line.startswith("module ") else line
            for line in profile.preamble
            if line.split() != ["module", "list"]
        ]
        quiet[name] = profile.model_copy(update={"preamble": lines})
    return quiet


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
            execution_profiles=gateway_execution_profiles(),
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


def resolve_compute(
    slurm_config: SlurmConfig, snapshot: dict, post_processing: bool = False
) -> tuple[int, str]:
    """`(cores, walltime)` a job asks SLURM for: the draft's own choice, else
    the snapshot's `simulation.recommendedCompute` (the spec requires both
    there, so a real snapshot always answers).

    Cores are the recommendation as it is. A walltime the draft chose is sent
    as written; the snapshot's is sent with 50% headroom (`with_headroom`),
    because the recommendation is what a simulation took, not what it is safe to ask
    for. When the run will post-process (`job_script.runs_climatology`) that
    recommendation is the walltime plus the snapshot's measured
    `postProcessingWalltime` (`job_script.recommended_walltime`). Both are SLURM
    `--time` syntax: `15:00` is fifteen minutes.
    """
    recommended = snapshot.get("simulation", {}).get("recommendedCompute") or {}
    cores = slurm_config.cores or recommended.get("cores")
    walltime = slurm_config.walltime
    if not walltime:
        base = recommended_walltime(snapshot, post_processing)
        walltime = with_headroom(base) if base else None
    if not cores or not walltime:
        raise SubmitInputError(
            "The snapshot does not say how many cores and how much time it needs, "
            "and the snapshot draft does not either."
        )
    return int(cores), str(walltime)


def build_job_spec(
    job: JobDB, snapshot: dict, body: str, post_processing: bool = False
) -> JobSpec:
    """The slurmly spec for a gateway job. `--cpus-per-task`, not
    `--nodes`/`--ntasks`: the toolkit runs one container, and that is how it
    asks for cores itself. The account and partition are the gateway's.
    `post_processing` is whether the run will post-process, which the walltime
    allows for (`resolve_compute`)."""
    cores, walltime = resolve_compute(job.slurm_config, snapshot, post_processing)
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


# ---------------------------------------------------------------------------
# submit
# ---------------------------------------------------------------------------


async def submit_job(
    job: JobDB, snapshot: dict, body: str, post_processing: bool = False
) -> SubmittedJob:
    """Submit `job` to SLURM as a batch job whose body is `body`.

    Transport only: nothing is written to MongoDB here. The caller (the submit
    route) owns the job's state, because a failed submit must leave the draft a
    draft, and decides from the exception what to tell the user. Raises
    `SubmitInputError` for a request that cannot be built, `AnvilNotConfigured`,
    and whatever slurmly raises (`SSHTransportError`, `SbatchError`, ...).
    `post_processing` is whether the run will post-process (`resolve_compute`).
    """
    spec = build_job_spec(job, snapshot, body, post_processing)
    client = await get_slurm_client()
    submitted: SubmittedJob = await client.submit(spec)
    logger.info(
        "Job %s submitted → slurm=%s remote=%s",
        job.id,
        submitted.slurm_job_id,
        submitted.remote_job_dir,
    )
    return submitted


#: What a publish job asks SLURM for besides its walltime (`PUBLISH_WALLTIME`):
#: one task, two cores. It copies and uploads files and waits on `s3cmd`, and
#: the toolkit's `--jobs` (4) parallelises I/O, not computation.
PUBLISH_CORES = 2


def publish_job_name(snapshot_id: str) -> str:
    """The SLURM name of a snapshot's publish job: `publish-` and the first 12
    characters of its id. One name per snapshot, so `scancel --name` for a
    submit whose answer was lost reaches that publish and no other."""
    return f"publish-{snapshot_id[:12]}"


def build_publish_spec(name: str, body: str, *, job_id: str, snapshot_id: str) -> JobSpec:
    """The slurmly spec of a publish job (ADR 0031). The account and partition are
    the gateway's, as for a run; the execution profile is the run's too, so the
    body finds the toolkit's venv the same way."""
    return JobSpec(
        name=name,
        command_template=body,
        partition=settings.ANVIL_PARTITION,
        account=settings.ANVIL_ACCOUNT or None,
        qos=settings.ANVIL_QOS,
        ntasks=1,
        cpus_per_task=PUBLISH_CORES,
        time_limit=settings.PUBLISH_WALLTIME,
        execution_profile=settings.ANVIL_EXECUTION_PROFILE,
        metadata={"openghm_job_id": job_id, "snapshot_id": snapshot_id},
    )


async def upload_text(path: str, content: str, *, mode: int = 0o600) -> None:
    """Write a text file on Anvil over SFTP, replacing one that is there. The
    client's `_upload` is private to a pinned commit of slurmly (rule 2), like
    `run_remote`'s `_run`: this is the one place to change when the pin moves.
    A write into a directory that does not exist raises."""
    client = await get_slurm_client()
    await client._upload(path, content, mode=mode)


async def submit_publish(
    name: str, body: str, *, job_id: str, snapshot_id: str, metadata_path: str, metadata_text: str
) -> SubmittedJob:
    """Write the publish's `metadata.json` to `metadata_path` over SFTP, then
    sbatch the publish job whose body is `body`. Transport only, like
    `submit_job`: the route owns the job's state and decides from the exception
    what to tell the user. The file is written first and replaced by a retry
    that says `edit`, so the job reads exactly the document the record holds."""
    spec = build_publish_spec(name, body, job_id=job_id, snapshot_id=snapshot_id)
    await upload_text(metadata_path, metadata_text)
    client = await get_slurm_client()
    submitted: SubmittedJob = await client.submit(spec)
    logger.info(
        "Job %s: publish %s submitted → slurm=%s remote=%s",
        job_id,
        snapshot_id,
        submitted.slurm_job_id,
        submitted.remote_job_dir,
    )
    return submitted


# ---------------------------------------------------------------------------
# raw remote commands
# ---------------------------------------------------------------------------


async def run_remote(
    command: str, *, operation: str, retry_safe: bool = False, timeout: float | None = None
):
    """Run one shell command on Anvil and return slurmly's `CommandResult`
    (`exit_status`, `stdout`, `stderr`); a transport failure raises.

    slurmly has no public "run this command" API, so this reaches for the
    client's `_run`, which every slurmly operation goes through (its
    concurrency limit and hooks). That is a private API of a pinned commit
    (rule 2): the one place to change when the pin moves. `retry_safe` is for
    a command that does the same thing run twice — a read, a `rm -rf`, an
    `scancel` — because slurmly re-sends those after a dropped connection.
    `timeout` (seconds) is for a command that may run long; without one the
    transport's own default applies.
    """
    client = await get_slurm_client()
    return await client._run(
        command, operation=operation, check=False, retry_safe=retry_safe, timeout=timeout
    )


async def stream_remote_file(path: str, *, chunk_size: int = 1024 * 1024):
    """The bytes of a file on Anvil, `chunk_size` at a time, over SFTP: an async
    generator, so the file is never held whole. A file that is not there, or a
    transport failure, raises when the generator is advanced (`SSHTransportError`
    for a connection that cannot be had, asyncssh's own `SFTPError` for the
    file).

    slurmly has no public "read this file" API (its `read_text` decodes text and
    returns it whole), so this reaches for the client's transport and the one
    asyncssh connection it keeps open (`_transport._ensure_conn`), and opens an
    SFTP channel on it. Both are private to a pinned commit of slurmly (rule 2),
    like `run_remote`'s `_run`: this and `remove_remote_file` are the places to
    change when the pin moves. The channel is outside the client's command
    semaphore, which bounds commands, not the bytes of a long read. Closing the
    generator early (a client that went away) closes the channel."""
    client = await get_slurm_client()
    conn = await client._transport._ensure_conn()
    async with conn.start_sftp_client() as sftp:
        async with sftp.open(path, "rb") as remote:
            while True:
                data = await remote.read(chunk_size)
                if not data:
                    return
                yield data


async def remove_remote_file(path: str) -> None:
    """Delete one file on Anvil over SFTP; a file that is already gone is not an
    error. Private-API like `stream_remote_file` (same connection, same rule 2).
    It removes whatever path it is given: the caller decides which paths are its
    own to remove."""
    import asyncssh

    client = await get_slurm_client()
    conn = await client._transport._ensure_conn()
    async with conn.start_sftp_client() as sftp:
        try:
            await sftp.remove(path)
        except asyncssh.SFTPNoSuchFile:
            pass


async def read_outcome(remote_job_dir: str, name: str = "outcome.json") -> dict | None:
    """The job's `outcome.json` (a publish job's `publish-outcome.json`: `name`),
    or None when there is none or it does not parse to an object. A transport
    failure raises, because that is not the same as "the job left no record"."""
    path = posixpath.join(remote_job_dir, name)
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
        logger.warning("%s in %s is not valid JSON", name, remote_job_dir)
        return None
    return record if isinstance(record, dict) else None


async def _stderr_tail(doc: dict) -> str:
    """The end of the job's stderr, for the verdict's excerpt and the markers
    WBM prints there. Read through the base64 reader the logs route uses:
    slurmly's own tail decodes strictly, so a stderr holding one byte that is
    not UTF-8 (a log line from a tool in another encoding) made its command
    fail and left the excerpt empty. Bytes that do not decode become U+FFFD."""
    path = await log_path(doc, "stderr")
    if path is None:
        return ""  # a row that pre-dates slurmly's fields: nothing to tail
    stdout = await _run_log_read(path, None, _STDERR_TAIL_BYTES)
    if stdout is None:
        return ""  # the job left no stderr file
    return parse_log_read(stdout, offset=None, terminal=True)["data"]


#: How much of the end of stderr the verdict reads. The excerpt keeps the last
#: 60 lines and 8 KB of it (`job_verdict`); the rest is for the marker scan.
_STDERR_TAIL_BYTES = 64 * 1024
_ACTIVE = ["PENDING", "SUBMITTED", "RUNNING", "COMPLETING"]
# slurmly's `submit_grace_window_seconds` for the `purdue_anvil` preset: for
# this long after sbatch, "not found" is a lookup that is too early.
_SUBMIT_GRACE_SECONDS = 120
# How many ids one `sacct` check carries (slurmly's own batches are 50).
_PROBE_CHUNK = 50


# ---------------------------------------------------------------------------
# status: the sweep
# ---------------------------------------------------------------------------


def _as_utc(value: datetime | str | int | float | None) -> datetime | None:
    """A timestamp as an aware UTC datetime. Mongo's are already aware (the
    client is tz_aware); slurmly's are ISO strings, sometimes with a `Z` and
    sometimes bare (sacct's parsable form). `Unknown`, `None`, empty and
    garbage are None.

    So is a time SLURM does not have. A job that never started (cancelled
    while queued) has NO_VAL, 4294967294 seconds, for its start, and slurmly
    turns that into 2106-02-07T06:28:14Z. Epoch 0 is "unset" too. Both, and
    anything after the year 2100, are None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if value <= 0 or value >= SLURM_NO_VAL:
            return None
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if isinstance(value, datetime):
        parsed = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    elif isinstance(value, str):
        text = value.strip()
        if not text or text.lower() in {"unknown", "none", "n/a"}:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
        parsed = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    else:
        return None
    return real_time(parsed)


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


async def _requested_compute(doc: dict) -> tuple[int | None, int | None]:
    """`(cores, walltime in seconds)` the job asked SLURM for, worked out the way
    the submit worked it out: the draft's own, else the snapshot's recommendation
    (the walltime plus its post-processing time when the run post-processed, with
    headroom). The job stores neither. `(None, None)` when it cannot be told (the
    snapshot is gone, say): a message then says less, not something false."""
    try:
        config = SlurmConfig(**(doc.get("slurm_config") or {}))
        parameters = JobParameters(**(read_stored_parameters(doc.get("parameters")) or {}))
        dataset_id = doc.get("dataset_id")
        envelope = await get_db().datasets.find_one({"_id": dataset_id})
        snapshot = (envelope or {}).get("document") or {}
        rules = await run_start.read_init_rules(snapshot, dataset_id)
        post_processing = runs_climatology(parameters, rules.post_processing if rules else None)
        cores, walltime = resolve_compute(config, snapshot, post_processing)
        return cores, parse_slurm_time(walltime)
    except Exception as exc:
        logger.info("Job %s: could not work out what it asked SLURM for: %s", doc.get("_id"), exc)
        return None, None


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

    # The document this tick started with may be seconds old, and the reads
    # above took a while: a cancel recorded since then still counts, and a job
    # someone else has already moved is theirs.
    fresh = await get_db().jobs.find_one({"_id": doc["_id"]})
    if fresh is None or fresh.get("status") != doc["status"]:
        logger.info("Job %s left %s while its result was being read; leaving it", doc["_id"], doc["status"])
        return False
    doc = fresh

    # Only a message about walltime or memory is sharper for what the job asked for.
    cores, walltime_seconds = (
        await _requested_compute(doc)
        if slurm_state_head(slurm_state) in ("TIMEOUT", "OUT_OF_MEMORY", "FAILED")
        else (None, None)
    )
    verdict = classify(
        slurm_state=slurm_state,
        cancel_requested=bool(doc.get("cancel_requested_at")),
        outcome=outcome,
        stderr_tail=stderr_tail,
        missing=missing,
        slurm_exit_code=info.exit_code if info else None,
        walltime_seconds=walltime_seconds,
        cores=cores,
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


async def confirm_absent(ids: list[str]) -> tuple[dict[str, JobInfo], set[str]]:
    """Check that "SLURM did not report these jobs" was an answer.

    slurmly's batched `get_jobs` answers a `squeue` that failed and a `sacct`
    that failed with an empty result, the same as a job that is not there
    (`client.py`, `_batch_lookup_chunk`: a non-zero exit, empty output and
    unparseable output are all skipped silently). So for the ids it did not
    report, this runs the `sacct` once more, itself, where the outcome is
    visible: exit status 0 and a JSON document with a `jobs` list and no
    `errors`. Returns `(found, confirmed)`: the rows that retry did find (the
    first lookup missed them) and the ids it showed to be absent from SLURM's
    accounting. An id in neither could not be checked and says nothing about
    the job. `sacct` is the authority, not `squeue`: it records a job from
    submission until `sacct_lookback_days` after it ends, and a job that is
    not there is gone."""
    client = await get_slurm_client()
    profile = client.cluster_profile
    if not profile.supports_sacct_json:
        return {}, set()
    found: dict[str, JobInfo] = {}
    confirmed: set[str] = set()
    for start in range(0, len(ids), _PROBE_CHUNK):
        chunk = ids[start : start + _PROBE_CHUNK]
        command = build_sacct_json_many(chunk, lookback_days=profile.sacct_lookback_days)
        try:
            result = await run_remote(command, operation="sacct_probe", retry_safe=True)
        except Exception as exc:
            logger.warning("sacct check of %d absent jobs failed: %s", len(chunk), exc)
            continue
        try:
            payload = json.loads(result.stdout) if result.exit_status == 0 else None
        except ValueError:
            payload = None
        if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list) or payload.get("errors"):
            logger.warning(
                "sacct check of %d absent jobs gave no usable answer (exit %s): %s",
                len(chunk),
                result.exit_status,
                (result.stderr or "").strip()[:200],
            )
            continue
        rows = parse_sacct_json_all(payload)
        for jid in chunk:
            if jid in rows:
                found[jid] = rows[jid]
            else:
                confirmed.add(jid)
    return found, confirmed


async def _resolve_absent(
    found: dict[str, JobInfo | None], ids: list[str], *, share: bool = False
) -> set[str]:
    """For the ids `get_jobs` did not report: put in `found` any row a second
    `sacct` finds, and return the ids that `sacct` showed to be absent. Only
    those may count toward `lost` (ADR 0026, rule 4); the others are warned
    about and left alone. `share` reuses one check for the TTL, for the status
    route."""
    absent = [i for i in ids if found.get(i) is None]
    if not absent:
        return set()
    try:
        if share:
            rescued, confirmed = await job_live.shared(
                ("confirm_absent", tuple(absent)), lambda: confirm_absent(absent)
            )
        else:
            rescued, confirmed = await confirm_absent(absent)
    except Exception as exc:
        logger.warning("Could not check %d absent jobs, recording no misses: %s", len(absent), exc)
        return set()
    found.update(rescued)
    unchecked = len(absent) - len(rescued) - len(confirmed)
    if unchecked:
        logger.warning(
            "SLURM did not report %d of %d jobs and the check of that failed too; "
            "no misses recorded for them",
            unchecked,
            len(ids),
        )
    return confirmed


async def _settle(doc: dict, info: JobInfo | None, *, absent_confirmed: bool = False) -> None:
    """Bring one non-terminal job in line with what SLURM reported for it
    (`info`), or with SLURM not reporting it (None). `absent_confirmed` says
    that None was checked (`confirm_absent`); an unchecked None is a lookup
    that may have failed and changes nothing."""
    now = datetime.now(timezone.utc)

    if info is None:
        # Not in squeue or sacct. That is a fact about one lookup, not about
        # the job: slurmly also answers "absent" when both commands failed.
        # So absence counts only when `sacct` was seen to work, and then only
        # when it lasts, past slurmly's submit grace window (ADR 0026,
        # rule 4).
        if not absent_confirmed:
            return
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


async def _settle_once(doc: dict, info: JobInfo | None, *, absent_confirmed: bool = False) -> None:
    """`_settle`, run by one caller at a time per job: the sweep and every
    viewer's status poll that find a job over together reach one verdict."""
    await job_live.single_flight(
        ("settle", doc["_id"]), lambda: _settle(doc, info, absent_confirmed=absent_confirmed)
    )


async def sync_active_jobs() -> None:
    """One sweep: look up every job that has a SLURM id and no verdict, in one
    batched call, and settle each. If the lookup itself fails the whole tick
    is skipped, so a broken connection records no misses; and a job SLURM did
    not report is only absent once a second `sacct` shows it (`confirm_absent`). The answers are kept
    for the status route (`job_live`), so a poll soon after asks SLURM nothing."""
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
        found = await job_live.slurm_info(ids, refresh=True)
    except Exception as exc:
        logger.warning("Sweep: batched lookup of %d jobs failed, skipping this tick: %s", len(ids), exc)
        return
    confirmed = await _resolve_absent(found, ids)

    for doc, slurm_id in zip(docs, ids):
        try:
            await _settle_once(doc, found.get(slurm_id), absent_confirmed=slurm_id in confirmed)
        except Exception as exc:
            logger.warning("Sweep: job %s failed: %s", doc["_id"], exc)


async def backfill_slurm_end() -> None:
    """Give a job settled from a squeue row the end time (and start time and
    exit code) only sacct has. The verdict and `completed_at` are never touched.

    A candidate is a job with a verdict from SLURM's state, no `slurm_end`, that
    ended within `JOB_END_BACKFILL_WINDOW_SECONDS`. It is asked about once it
    has been over for `JOB_END_BACKFILL_RETRY_SECONDS` and again that long after
    each try, in one batched lookup per tick, at most `JOB_END_BACKFILL_MAX_TRIES`
    times. Only a sacct row counts: a squeue row still lingering is a try spent.
    A lookup that fails costs no try."""
    db = get_db()
    now = datetime.now(timezone.utc)
    retry = timedelta(seconds=settings.JOB_END_BACKFILL_RETRY_SECONDS)
    cutoff = now - timedelta(seconds=settings.JOB_END_BACKFILL_WINDOW_SECONDS)
    due: list[dict] = []
    async for doc in db.jobs.find(
        {
            "status": {"$in": sorted(TERMINAL_STATUSES)},
            "slurm_end": None,
            "slurm_state": {"$ne": None},
            "slurm_job_id": {"$ne": None},
            "completed_at": {"$gte": cutoff},
        }
    ):
        if (doc.get("slurm_end_tries") or 0) >= settings.JOB_END_BACKFILL_MAX_TRIES:
            continue
        waited_since = _as_utc(doc.get("slurm_end_tried_at")) or _as_utc(doc.get("completed_at"))
        if waited_since is not None and now - waited_since >= retry:
            due.append(doc)
    if not due:
        return

    ids = [str(doc["slurm_job_id"]) for doc in due]
    try:
        found = await job_live.slurm_info(ids, refresh=True)
    except Exception as exc:
        logger.warning("End-time backfill: lookup of %d jobs failed, skipping this tick: %s", len(ids), exc)
        return

    for doc, slurm_id in zip(due, ids):
        info = found.get(slurm_id)
        fields: dict[str, Any] = {}
        if info is not None and info.source == "sacct" and info.lifecycle in _ENDED_LIFECYCLES:
            for key, value in (
                ("slurm_end", _as_utc(info.end_time)),
                ("slurm_start", _as_utc(info.start_time)),
                ("slurm_exit_code", info.exit_code or None),
            ):
                if value and doc.get(key) is None:
                    fields[key] = value
        update: dict[str, Any] = {"$set": {**fields, "updated_at": now}}
        if "slurm_end" in fields:
            update["$unset"] = {"slurm_end_tries": "", "slurm_end_tried_at": ""}
        else:
            update["$set"].update(
                slurm_end_tries=(doc.get("slurm_end_tries") or 0) + 1, slurm_end_tried_at=now
            )
        try:
            # Conditional on the verdict and on the end time still being empty.
            await db.jobs.update_one(
                {"_id": doc["_id"], "status": doc["status"], "slurm_end": None}, update
            )
        except Exception as exc:
            logger.warning("End-time backfill: job %s failed: %s", doc["_id"], exc)


async def update_job_status(job_id: str) -> dict[str, Any]:
    """Refresh one job from Slurm the way the sweep does, for the status poll
    (GET /jobs/{id}/status). Returns the (possibly updated) document. The
    lookup is shared with every other caller inside the TTL (`job_live`)."""
    db = get_db()
    doc = await db.jobs.find_one({"_id": job_id})
    if doc is None:
        raise RuntimeError(f"Job {job_id} not found")

    slurm_job_id = doc.get("slurm_job_id")
    if doc.get("status") in TERMINAL_STATUSES or not slurm_job_id:
        return doc

    try:
        found = await job_live.slurm_info([str(slurm_job_id)])
    except Exception as exc:
        logger.warning("get_jobs failed for %s: %s", job_id, exc)
        return doc

    # Read again: another caller may have settled the job while this one waited.
    doc = await db.jobs.find_one({"_id": job_id}) or doc
    if doc.get("status") in TERMINAL_STATUSES:
        return doc
    confirmed = await _resolve_absent(found, [str(slurm_job_id)], share=True)
    await _settle_once(
        doc, found.get(str(slurm_job_id)), absent_confirmed=str(slurm_job_id) in confirmed
    )
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


SUBMIT_INTERRUPTED = (
    "The submit was interrupted before the gateway learned what Anvil answered, so any "
    "simulation it started was cancelled. Your draft is unchanged. Submit again."
)


async def return_to_draft(
    job_id: str,
    code: str,
    message: str,
    *,
    orphan_sim_id: str | None = None,
    only_if: dict[str, Any] | None = None,
) -> bool:
    """Undo the claim of a submit that never reached SLURM: back to DRAFT, the
    submit-time fields removed (a draft carries no `sim_id`, see
    `jobs._new_draft_document`), and the reason kept for the UI (it replaces any
    earlier one). `orphan_sim_id` is a `sim_id` whose job may exist after all,
    kept for the sweep to cancel by name.

    The orphan is recorded first and whatever the job's status is: a cancel can
    have moved the job on while the submit was in flight, and the name must
    outlive that, or nothing will ever scancel what sbatch started. `only_if`
    narrows the move to the job as the caller saw it. Returns whether the job
    went back to DRAFT."""
    db = get_db()
    if orphan_sim_id:
        await db.jobs.update_one({"_id": job_id}, {"$addToSet": {"orphan_sim_ids": orphan_sim_id}})
    now = datetime.now(timezone.utc)
    result = await db.jobs.update_one(
        {"_id": job_id, "status": "SUBMITTED", **(only_if or {})},
        {
            "$set": {
                "status": "DRAFT",
                "slurm_job_name": "",
                "last_submit_error": {"code": code, "message": message, "at": now},
                "updated_at": now,
            },
            "$unset": {"sim_id": "", "toolkit": "", "work_dir": ""},
        },
    )
    return result.matched_count == 1


async def reconcile_interrupted_submits() -> None:
    """Give back a draft whose submit the gateway lost track of.

    The submit claims a draft (SUBMITTED, a `sim_id`) and only then runs sbatch;
    the SLURM id is written after. If the process dies in between, or the write
    fails, or something unexpected is raised, the job stays SUBMITTED with no
    `slurm_job_id`, which `sync_active_jobs` cannot look up: it would sit there
    forever while a job may be queued on Anvil that nobody tracks. One that has
    not been written to for `JOB_SUBMIT_INTERRUPTED_AFTER_SECONDS` (longer than
    any submit takes) is cancelled by name, its leftover directory removed, and
    the draft returned with `last_submit_error` `submit_interrupted`. If the
    scancel cannot run, the name goes to `orphan_sim_ids` and `clear_orphans`
    retries it."""
    db = get_db()
    due_before = datetime.now(timezone.utc) - timedelta(seconds=settings.JOB_SUBMIT_INTERRUPTED_AFTER_SECONDS)
    stuck = [doc async for doc in db.jobs.find({"status": "SUBMITTED", "slurm_job_id": None})]
    for doc in stuck:
        updated = _as_utc(doc.get("updated_at"))
        if updated is not None and updated > due_before:
            continue  # a submit that may still be running
        try:
            await _reconcile_interrupted(doc)
        except Exception as exc:
            logger.warning("Interrupted submit of job %s: %s", doc["_id"], exc)


async def _reconcile_interrupted(doc: dict) -> None:
    sim_id = doc.get("sim_id")
    cancelled = False
    if is_valid_id(sim_id):
        try:
            cancelled = await scancel_by_name(sim_id)
        except Exception as exc:
            logger.warning("scancel --name=%s failed: %s", sim_id, exc)
        if cancelled:
            await remove_failed_submit_dirs(sim_id)
    moved = await return_to_draft(
        doc["_id"],
        "submit_interrupted",
        SUBMIT_INTERRUPTED,
        orphan_sim_id=sim_id if is_valid_id(sim_id) and not cancelled else None,
        only_if={"slurm_job_id": None, "updated_at": doc.get("updated_at")},
    )
    if moved:
        logger.warning("Job %s: its submit was interrupted (%s); returned to DRAFT", doc["_id"], sim_id)
        await log_event(
            "job_submit_interrupted",
            actor_id=SYSTEM_ACTOR,
            target_id=doc["_id"],
            category=AuditCategory.JOB,
            detail={"sim_id": sim_id, "cancelled": cancelled, "user_id": doc.get("user_id")},
        )


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
# publishes (ADR 0031)
# ---------------------------------------------------------------------------
#
# A completed draft's publish is a second SLURM job on the same job document, in
# `publish`, and does not touch `status`: a published draft is still COMPLETED.
# The route claims it and submits; the two passes below bring it to a verdict, as
# `sync_active_jobs` and `reconcile_interrupted_submits` do for a run. Every
# write is conditional on the attempt the pass read (`state` and `attempts`), so
# a retry that has claimed the record since is never overwritten.


async def write_publish(doc: dict, fields: dict[str, Any], *, only_if: dict[str, Any] | None = None) -> bool:
    """Write `fields` (keys of `publish`) of a job only while its publish is
    still the attempt `doc` was read with: `publishing`, the same `attempts`.
    Returns whether the write happened."""
    record = doc["publish"]
    update = {f"publish.{key}": value for key, value in fields.items()}
    result = await get_db().jobs.update_one(
        {
            "_id": doc["_id"],
            "publish.state": "publishing",
            "publish.attempts": record["attempts"],
            **(only_if or {}),
        },
        {"$set": {**update, "updated_at": datetime.now(timezone.utc)}},
    )
    return result.matched_count == 1


async def fail_publish(doc: dict, failure: publish.PublishFailure, *, actor: str, actor_email: str | None = None,
                       only_if: dict[str, Any] | None = None) -> bool:
    """End a publish `failed` with `failure` and write the `job_publish_failed`
    audit event, once: only the writer that won it gets to the event."""
    record = doc["publish"]
    written = await write_publish(
        doc,
        {"state": "failed", "finished_at": datetime.now(timezone.utc), "failure": failure.model_dump()},
        only_if=only_if,
    )
    if written:
        await log_event(
            "job_publish_failed",
            actor_id=actor,
            actor_email=actor_email,
            target_id=doc["_id"],
            category=AuditCategory.JOB,
            detail={
                "snapshot_id": record["snapshot_id"],
                "attempt": record["attempts"],
                "cause": failure.cause,
                "retry": failure.retry,
                "exit_code": failure.exit_code,
                "slurm_job_id": record.get("slurm_job_id"),
                "user_id": doc.get("user_id"),
            },
        )
    return written


async def register_published(doc: dict) -> None:
    """Add the published snapshot to the catalogue, as the draft's owner's and
    public (ADR 0031): the stored `publish.metadata` in an envelope, which is
    what lists it in the Data Repository. Nothing else registers a snapshot for
    a user. A duplicate key means an earlier pass registered it and was stopped
    before it could say so: that is success, not an error."""
    record = doc["publish"]
    envelope = build_envelope(record["metadata"], owner_user_id=doc["user_id"], visibility="public")
    try:
        await get_db().datasets.insert_one(envelope)
    except DuplicateKeyError:
        logger.info("Snapshot %s was already registered", record["snapshot_id"])


async def _conclude_publish(doc: dict, *, slurm_state: str | None, missing: bool) -> bool:
    """Reach the verdict on a publish whose job is over (or that SLURM has
    forgotten): read `publish-outcome.json`, name the result
    (`publish.classify_publish`), and for a success register the snapshot before
    marking it `published`, so a snapshot that reads as published is listed (and a
    registration that fails leaves the record `publishing`, to be done again next
    tick: a second one is a duplicate key, which counts as done). If the record
    cannot be read nothing is written and the next tick tries again. A job
    SLURM has forgotten that left no record is not judged until it has been gone
    `JOB_LOST_AFTER_SECONDS`, as a run is not. Returns whether a verdict was
    written."""
    record = doc["publish"]
    try:
        outcome = (
            await read_outcome(record["remote_job_dir"], publish.OUTCOME_NAME)
            if record.get("remote_job_dir")
            else None
        )
    except Exception as exc:
        logger.warning("Job %s: could not read its publish result yet: %s", doc["_id"], exc)
        return False
    if missing and publish.exit_code_of(outcome, record["snapshot_id"]) is None:
        submitted = _as_utc(record.get("submitted_at"))
        lost_after = timedelta(seconds=settings.JOB_LOST_AFTER_SECONDS + _SUBMIT_GRACE_SECONDS)
        if submitted is not None and datetime.now(timezone.utc) - submitted < lost_after:
            return False

    # The reads above took a while: a retry cannot have claimed the record
    # (only a `failed` one is claimed), but a delete can have removed the job.
    fresh = await get_db().jobs.find_one({"_id": doc["_id"]})
    if fresh is None or (fresh.get("publish") or {}).get("attempts") != record["attempts"]:
        logger.info("Job %s left its publish while the result was being read; leaving it", doc["_id"])
        return False
    if fresh["publish"].get("state") != "publishing":
        return False
    doc = fresh

    verdict = publish.classify_publish(
        slurm_state=slurm_state, outcome=outcome, snapshot_id=record["snapshot_id"]
    )
    if verdict.state == "failed":
        logger.warning(
            "Job %s: publish %s failed (%s, exit %s): %s",
            doc["_id"],
            record["snapshot_id"],
            verdict.failure.cause,
            verdict.failure.exit_code,
            publish.stderr_tail_of(outcome) or "no stderr tail",
        )
        return await fail_publish(doc, verdict.failure, actor=SYSTEM_ACTOR)

    try:
        await register_published(doc)
    except Exception as exc:
        logger.warning("Job %s: could not register published snapshot %s yet: %s", doc["_id"], record["snapshot_id"], exc)
        return False
    written = await write_publish(
        doc, {"state": "published", "finished_at": datetime.now(timezone.utc), "failure": None}
    )
    if written:
        await log_event(
            "job_published",
            actor_id=SYSTEM_ACTOR,
            target_id=doc["_id"],
            category=AuditCategory.JOB,
            detail={
                "snapshot_id": record["snapshot_id"],
                "attempt": record["attempts"],
                "slurm_job_id": record.get("slurm_job_id"),
                "user_id": doc.get("user_id"),
            },
        )
    return written


async def _settle_publish(doc: dict, info: JobInfo | None, *, absent_confirmed: bool) -> None:
    """Bring one `publishing` record in line with what SLURM reported for its
    job: nothing while it is queued or running, a verdict once it is over."""
    if info is None:
        if absent_confirmed:  # an unchecked absence is a lookup that may have failed
            await _conclude_publish(doc, slurm_state=None, missing=True)
        return
    if info.lifecycle in _ENDED_LIFECYCLES:
        await _conclude_publish(
            doc, slurm_state=info.raw_state or _LIFECYCLE_STATE[info.lifecycle], missing=False
        )


async def sync_publishes() -> None:
    """One sweep of the publishes: look up every job whose publish has a SLURM id
    and is still `publishing`, in one batched call, and settle each. As
    `sync_active_jobs` does for runs, a lookup that fails skips the tick and a job
    SLURM did not report is only absent once a second `sacct` shows it."""
    db = get_db()
    docs = [
        doc
        async for doc in db.jobs.find(
            {"publish.state": "publishing", "publish.slurm_job_id": {"$ne": None}}
        )
    ]
    if not docs:
        return
    ids = [str(doc["publish"]["slurm_job_id"]) for doc in docs]
    try:
        found = await job_live.slurm_info(ids, refresh=True)
    except Exception as exc:
        logger.warning("Publish sweep: batched lookup of %d jobs failed, skipping this tick: %s", len(ids), exc)
        return
    confirmed = await _resolve_absent(found, ids)

    for doc, slurm_id in zip(docs, ids):
        try:
            await _settle_publish(doc, found.get(slurm_id), absent_confirmed=slurm_id in confirmed)
        except Exception as exc:
            logger.warning("Publish sweep: job %s failed: %s", doc["_id"], exc)


async def reconcile_interrupted_publishes() -> None:
    """End a publish the gateway lost track of. The route claims it (`publishing`)
    and only then writes the metadata and runs sbatch; the SLURM id is recorded
    after. If the process dies in between, the record is `publishing` with no
    `slurm_job_id`, which `sync_publishes` cannot look up. One that has been so
    for `JOB_SUBMIT_INTERRUPTED_AFTER_SECONDS` (longer than a submit takes)
    becomes `failed`, `publish_submit_interrupted`, `retry: "same"`.

    Unlike an interrupted run's, it is not scancelled by name. A job that sbatch
    did start is harmless beside the retry's: under the same id both run the
    toolkit, which reads every key before it writes it and never replaces one that
    holds other bytes, so two publishes of one id cannot damage each other and the
    second only skips what the first wrote."""
    db = get_db()
    due_before = datetime.now(timezone.utc) - timedelta(seconds=settings.JOB_SUBMIT_INTERRUPTED_AFTER_SECONDS)
    stuck = [
        doc
        async for doc in db.jobs.find({"publish.state": "publishing", "publish.slurm_job_id": None})
    ]
    for doc in stuck:
        submitted = _as_utc(doc["publish"].get("submitted_at"))
        if submitted is not None and submitted > due_before:
            continue  # a submit that may still be running
        try:
            moved = await fail_publish(
                doc,
                publish.failure("publish_submit_interrupted", "same"),
                actor=SYSTEM_ACTOR,
                only_if={"publish.slurm_job_id": None},
            )
            if moved:
                logger.warning("Job %s: its publish %s was interrupted", doc["_id"], doc["publish"]["snapshot_id"])
        except Exception as exc:
            logger.warning("Interrupted publish of job %s: %s", doc["_id"], exc)


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


def _check_work_dir(doc: dict, work_dir: str) -> None:
    """Raise `RefusedPath` unless `work_dir` is exactly
    `<ANVIL_OUTPUT_BASE>/<sim_id>` for a `sim_id` of the id pattern."""
    sim_id = doc.get("sim_id") or ""
    if (
        not is_valid_id(sim_id)
        or ".." in work_dir.split("/")
        or work_dir != posixpath.join(settings.ANVIL_OUTPUT_BASE, sim_id)
    ):
        raise RefusedPath(f"{work_dir!r} is not this simulation's directory under the output base")


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
        _check_work_dir(doc, work_dir)
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
# logs: read by byte offset (ADR 0027)
# ---------------------------------------------------------------------------

#: The shell's exit status for "not a regular file".
_NOT_A_FILE = 3


def build_log_read_command(path: str, offset: int | None, limit: int) -> str:
    """One shell command that reads up to `limit` bytes of `path` from `offset`
    (from `limit` bytes before the end when `offset` is None) and prints three
    things: the file's size, the offset it started at, and the bytes,
    base64-encoded so none is lost to a decoding. Exits 3 when `path` is not a
    regular file (a symbolic link is refused: a job's own code writes there).
    Plain POSIX, `wc`, `tail`, `head` and `base64`, so it runs the same on
    Anvil (GNU) and on a developer's machine (BSD), where the tests run it."""
    if offset is None:
        start = f"start=$((size-{int(limit)})); if [ \"$start\" -lt 0 ]; then start=0; fi"
    else:
        start = f"start={int(offset)}"
    return (
        f"f={shlex.quote(path)}; "
        f'if [ ! -f "$f" ] || [ -L "$f" ]; then exit {_NOT_A_FILE}; fi; '
        "size=$(wc -c < \"$f\" | tr -d ' '); "
        f"{start}; "
        'echo "$size"; echo "$start"; '
        f'tail -c +$((start+1)) -- "$f" | head -c {int(limit)} | base64'
    )


def _parse_raw(stdout: str) -> tuple[int, int, bytes]:
    """`(size, start, bytes)` from the output of `build_log_read_command`."""
    lines = stdout.split("\n", 2)
    try:
        # base64.b64decode skips the newlines GNU's `base64` wraps with.
        return int(lines[0]), int(lines[1]), base64.b64decode(lines[2] if len(lines) > 2 else "")
    except (IndexError, ValueError) as exc:
        raise RuntimeError(f"unreadable log read: {stdout[:80]!r}") from exc


def _utf8_incomplete_tail(data: bytes) -> int:
    """How many bytes at the end of `data` begin a UTF-8 sequence it does not
    finish (0 to 3), so a chunk can leave them for the next read."""
    for back in range(1, min(3, len(data)) + 1):
        byte = data[-back]
        if byte < 0x80:
            return 0
        if byte >= 0xC0:  # a lead byte: how long its sequence is
            need = 2 if byte < 0xE0 else 3 if byte < 0xF0 else 4 if byte < 0xF8 else 1
            return back if back < need else 0
    return 0


def parse_log_read(
    stdout: str, *, offset: int | None, terminal: bool
) -> dict[str, Any]:
    """The logs route's fields from the output of `build_log_read_command`.

    Without an `offset` (a tail) that starts inside the file, the chunk begins
    just after the first newline, so it opens on a line. The chunk never ends
    inside a UTF-8 sequence: the incomplete bytes are left for the next read
    (`next_offset` stops before them) unless the job has ended and the chunk
    reaches the end of the file, where nothing more will come and they are
    decoded as they are."""
    size, start, data = _parse_raw(stdout)
    if offset is None and start > 0:
        newline = data.find(b"\n")
        if newline >= 0:
            skip = newline + 1
        else:  # one line longer than the window: begin on a character instead
            skip = 0
            while skip < min(3, len(data)) and 0x80 <= data[skip] < 0xC0:
                skip += 1
        data, start = data[skip:], start + skip
    if not (terminal and start + len(data) >= size):
        data = data[: len(data) - _utf8_incomplete_tail(data)]
    next_offset = start + len(data)
    return {
        "exists": True,
        "data": data.decode("utf-8", errors="replace"),
        "offset": start,
        "next_offset": next_offset,
        "size": max(size, next_offset),
        "eof": next_offset >= size,
    }


async def _run_log_read(path: str, offset: int | None, limit: int) -> str | None:
    """The output of one `build_log_read_command`, or None when `path` is not a
    regular file. A transport failure raises."""
    result = await run_remote(
        build_log_read_command(path, offset, limit), operation="read_log", retry_safe=True
    )
    if result.exit_status == _NOT_A_FILE:
        return None
    if result.exit_status != 0:
        raise RuntimeError(
            f"reading {path} failed with exit {result.exit_status}: {result.stderr.strip()[:200]}"
        )
    return result.stdout


async def read_log_bytes(path: str, offset: int, limit: int) -> tuple[int, bytes] | None:
    """`(size, bytes)` of up to `limit` bytes of `path` from `offset`, exactly as
    the file holds them (the download), or None when it is not a regular file."""
    stdout = await _run_log_read(path, offset, limit)
    if stdout is None:
        return None
    size, _, data = _parse_raw(stdout)
    return size, data


# A wbm log's path is found from the init files when the job has not ended.
# Exit 4: no init names this simulation's output directory.
_NO_INIT = 4
_RESOLVE_WBM_LOG = r"""
cd {work} 2>/dev/null && cd wbm_init 2>/dev/null || exit 3
sim={sim}
for f in *.init; do
  [ -f "$f" ] || continue
  out=$(sed -n "s/^[[:space:]]*Output_dir[[:space:]]*=>[[:space:]]*'\([^']*\)'.*/\1/p" "$f" | head -n 1)
  case "$out" in
    */wbm_output/"$sim"|*/wbm_output/"$sim"/)
      sed -n "s/^[[:space:]]*ID[[:space:]]*=>[[:space:]]*'\([^']*\)'.*/\1/p" "$f" | head -n 1
      exit 0;;
  esac
done
exit {no_init}
"""


def _own_path(path: object, *, under: str) -> str | None:
    """`path` if it is a file name directly inside the directory `under`."""
    if not isinstance(path, str) or not path.startswith(under + "/"):
        return None
    name = path[len(under) + 1 :]
    if name in ("", ".", "..") or "/" in name or "\x00" in name or "\n" in name:
        return None
    return path


def _wbm_work_dir(doc: dict) -> str | None:
    """The job's work directory if it is exactly `<output base>/<sim_id>`."""
    work_dir = doc.get("work_dir")
    if not isinstance(work_dir, str) or not work_dir:
        return None
    try:
        _check_work_dir(doc, work_dir)
    except RefusedPath:
        return None
    return work_dir


async def log_path(doc: dict, stream: str) -> str | None:
    """Where on Anvil the job's `stream` log is, or None when the job has no
    such place (no directory yet, a path that is not the job's own). Whether
    the file exists is for the read to say.

    stdout and stderr are slurmly's, in the job's own directory. The WBM log
    is `<work_dir>/<outcome.wbm.log>` once the job has ended, else the path
    stored on the job, else the log of the init whose `Output_dir` is this
    run's (stored when found). A transport failure raises."""
    if stream in ("stdout", "stderr"):
        remote_dir = doc.get("remote_job_dir")
        if not remote_dir:
            return None
        try:
            assert_safe_to_remove(remote_dir, remote_base_dir=_resolve_remote_base_dir())
        except InvalidConfig:
            return None
        return _own_path(doc.get(f"{stream}_path"), under=remote_dir)

    work_dir = _wbm_work_dir(doc)
    if work_dir is None:
        return None
    sim_id = doc["sim_id"]
    out_dir = posixpath.join(work_dir, "wbm_output", sim_id)
    outcome = doc.get("outcome")
    wbm = outcome.get("wbm") if isinstance(outcome, dict) else None
    recorded = wbm.get("log") if isinstance(wbm, dict) else None
    if isinstance(recorded, str):
        relative = posixpath.join(work_dir, recorded)
        if _own_path(relative, under=out_dir):
            return relative
    stored = _own_path(doc.get("wbm_log_path"), under=out_dir)
    if stored:
        return stored

    result = await run_remote(
        _RESOLVE_WBM_LOG.format(work=shlex.quote(work_dir), sim=shlex.quote(sim_id), no_init=_NO_INIT),
        operation="resolve_wbm_log",
        retry_safe=True,
    )
    if result.exit_status in (3, _NO_INIT):
        return None
    if result.exit_status != 0:
        raise RuntimeError(f"finding the WBM log failed with exit {result.exit_status}")
    run_id = result.stdout.strip()
    if not is_valid_id(run_id):
        return None
    found = posixpath.join(out_dir, run_id + ".log")
    await get_db().jobs.update_one({"_id": doc["_id"]}, {"$set": {"wbm_log_path": found}})
    return found


async def read_log(doc: dict, stream: str, offset: int | None, limit: int) -> dict[str, Any]:
    """One chunk of the job's `stream` log, for the logs route: `exists`,
    `data`, `offset`, `next_offset`, `size` and `eof` (`parse_log_read`).
    Reads of the same job, stream, offset and limit share one command for the
    TTL (`job_live`). A transport failure raises."""
    path = await log_path(doc, stream)
    if path is None:
        return _absent(offset)
    terminal = doc.get("status") in TERMINAL_STATUSES

    async def read() -> dict[str, Any]:
        stdout = await _run_log_read(path, offset, limit)
        if stdout is None:
            return _absent(offset)
        return parse_log_read(stdout, offset=offset, terminal=terminal)

    return await job_live.shared(("log", doc["_id"], stream, offset, limit, terminal), read)


def _absent(offset: int | None) -> dict[str, Any]:
    at = offset or 0
    return {"exists": False, "data": "", "offset": at, "next_offset": at, "size": 0, "eof": True}
