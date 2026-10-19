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
from collections.abc import Iterable
from dataclasses import dataclass
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
from slurmly.exceptions import InvalidConfig, InvalidJobSpec, SbatchError
from pymongo.errors import DuplicateKeyError
from slurmly.models import JobInfo
from slurmly.slurm.commands import build_sacct_json_many
from slurmly.slurm.parser import parse_sacct_json_all

from app.core.audit import SYSTEM_ACTOR, AuditCategory, log_event
from app.core.config import settings
from app.core.database import get_db
from app.models.job import (
    MAX_JOBS_PER_SIMULATION,
    SLURM_NO_VAL,
    TERMINAL_STATUSES,
    JobDB,
    JobParameters,
    SlurmConfig,
    read_stored_parameters,
    real_time,
)
from app.models.repository import build_envelope
from app.services import job_live, publish, run_start, sbatch_refusal
from app.services.job_script import (
    SubmitInputError,
    is_valid_id,
    parse_slurm_time,
    recommended_walltime,
    runs_climatology,
    toolkit_paths,
    with_headroom,
)
from app.services.job_verdict import classify, continuation_failure, slurm_state_head

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
    """`(cores, walltime)` a job asks SLURM for: the draft's cores, else the
    snapshot's `simulation.recommendedCompute` (the spec requires both there, so a
    real snapshot always answers).

    The walltime is never the draft's: it is the snapshot's recommendation with
    50% headroom (`with_headroom`) and at most one job's limit, because the
    recommendation is what a simulation took, not what it is safe to ask for.
    When the run will post-process (`job_script.runs_climatology`) that
    recommendation is the walltime plus the snapshot's measured
    `postProcessingWalltime` (`job_script.recommended_walltime`). Both are SLURM
    `--time` syntax: `15:00` is fifteen minutes.
    """
    recommended = snapshot.get("simulation", {}).get("recommendedCompute") or {}
    cores = slurm_config.cores or recommended.get("cores")
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
    return _run_spec(
        job_id=job.id,
        dataset_id=job.dataset_id,
        name=job.slurm_job_name or job.sim_id or job.id,
        body=body,
        cores=cores,
        walltime=walltime,
    )


def _run_spec(*, job_id: str, dataset_id: str, name: str, body: str, cores: int, walltime: str) -> JobSpec:
    """The one place a run's `JobSpec` is put together, so the first submit and a
    continuation (ADR 0037) ask SLURM for the same partition, account, QOS and
    execution profile."""
    return JobSpec(
        name=name,
        command_template=body,
        partition=settings.ANVIL_PARTITION,
        account=settings.ANVIL_ACCOUNT or None,
        qos=settings.ANVIL_QOS,
        cpus_per_task=cores,
        time_limit=walltime,
        execution_profile=settings.ANVIL_EXECUTION_PROFILE,
        metadata={"openghm_job_id": job_id, "dataset_id": dataset_id},
    )


def build_continuation_spec(doc: dict) -> JobSpec:
    """The spec of a simulation's next job (ADR 0037), from what its first submit
    stored (`submit_script`: the body, cores and walltime it sent) and not from the
    snapshot or the draft, which may have changed: the same name (`sim_id`, which
    every job of a simulation shares), the same script, the same toolkit. Raises
    `KeyError` or `ValueError` for a document with no usable script."""
    script = doc["submit_script"]
    return _run_spec(
        job_id=doc["_id"],
        dataset_id=doc["dataset_id"],
        name=doc.get("slurm_job_name") or doc["sim_id"],
        body=script["body"],
        cores=int(script["cores"]),
        walltime=str(script["walltime"]),
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


async def submit_continuation(doc: dict) -> SubmittedJob:
    """Submit the next job of the simulation in `doc` as a batch job (ADR 0037).
    Transport only, like `submit_job`: the caller owns the document and decides
    from the exception what happened (`SbatchError` and `InvalidJobSpec`: SLURM or
    slurmly said no; anything else: the answer may have been lost)."""
    spec = build_continuation_spec(doc)
    client = await get_slurm_client()
    submitted: SubmittedJob = await client.submit(spec)
    logger.info(
        "Job %s continued → slurm=%s remote=%s",
        doc["_id"],
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
    only_if: dict[str, Any] | None = None,
) -> bool:
    """Write `fields` to a job only if it is still in the status `doc` was
    read in (and, with `only_if`, still matches that too), so a cancel, a submit
    or another sweep that moved it first is not overwritten. Returns whether the
    write happened. A change of status is audit-logged, once: only the writer
    that won it gets here."""
    now = datetime.now(timezone.utc)
    update: dict[str, Any] = {"$set": {**fields, "updated_at": now}}
    if unset:
        update["$unset"] = {key: "" for key in unset}
    result = await get_db().jobs.update_one(
        {"_id": doc["_id"], "status": doc["status"], **(only_if or {})}, update
    )
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
    the submit worked it out: the draft's cores, else the snapshot's, and the
    snapshot's recommended walltime (plus its post-processing time when the run
    post-processed, with headroom). The job stores neither. `(None, None)` when it cannot be told (the
    snapshot is gone, say): a message then says less, not something false. A job
    that kept its script (ADR 0037) knows what it asked for, and says so."""
    script = doc.get("submit_script")
    if isinstance(script, dict):
        try:
            return int(script["cores"]), parse_slurm_time(str(script["walltime"]))
        except (KeyError, TypeError, ValueError, SubmitInputError):
            pass  # not a script this gateway wrote: work it out as for an old job
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
    next tick tries again. Returns whether a verdict was written.

    A job SLURM stopped at its time limit may not get one at all: when WBM saved a
    newer state during it, the simulation is continued in a next job instead
    (`_consider_continuing`, ADR 0037), and the job only becomes `previous_jobs`.
    Otherwise it ends `timeout`, with the reason it was not continued."""
    timeout_reason: str | None = None
    if not missing and slurm_state_head(slurm_state) == "TIMEOUT" and doc.get("submit_script"):
        try:
            considered = await _consider_continuing(doc, info)
        except StateUnreadable as exc:
            logger.warning("Job %s: could not tell whether it can be continued yet: %s", doc["_id"], exc)
            return False
        if considered in (_CONTINUED, _MOVED):
            return considered == _CONTINUED
        timeout_reason = considered  # None, `job_limit` or `no_new_state`
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
        timeout_reason=timeout_reason,
        jobs_ran=len(doc.get("previous_jobs") or []) + 1,
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


# ---------------------------------------------------------------------------
# a run longer than one job (ADR 0037)
# ---------------------------------------------------------------------------
#
# A job SLURM stops at its time limit, when WBM saved a newer complete state
# during it, is not a failure: the next job runs the same script on the same work
# directory and WBM resumes. The ended job moves to `previous_jobs`, the document
# goes back to SUBMITTED with a `continuation`, and the next job is submitted.
# Every write below is a compare-and-set, and no path leaves two SLURM jobs for
# one simulation or one nobody tracks: a submit whose answer was lost is
# scancelled by name (`sim_id`, shared by every job of a simulation, which is safe
# only because the earlier jobs have all ended) before any other submit is made.

#: What `_consider_continuing` answers besides a reason a TIMEOUT was not continued.
_CONTINUED = "continued"
_MOVED = "moved"  # another writer moved the job first: leave it to them

#: The toolkit's `sim state` reads a few files; this is only a ceiling.
_STATE_TIMEOUT_SECONDS = 60


class StateUnreadable(Exception):
    """Anvil could not be asked what state the work directory holds (a transport
    failure). That says nothing about the run: nothing is written, and the next
    tick asks again."""


@dataclass(frozen=True)
class RunState:
    """What `openghm sim state` said: `state` is `none`, `resumable` or
    `inconsistent`, or None when the toolkit could not say (it has no such
    command, or could not read the work directory); `saved_at` is when the
    resumable state was saved."""

    state: str | None
    saved_at: datetime | None = None


async def read_run_state(doc: dict) -> RunState:
    """Ask the simulation's own pinned toolkit what its work directory holds:
    `<toolkit.home>/bin/openghm sim state <work_dir> --json`, which prints `{"state",
    "saved_at", "wbm_id"}` and exits 0 whenever it could look, 2 when it could not.

    Only a transport failure raises (`StateUnreadable`). Anything else the toolkit
    does is an answer: an install from before `sim state` (click's "no such
    command" is exit 2), a work directory it cannot read, output that is not what
    it prints. All of them are `RunState(None)`, which means "not continued" and
    is judged once, never retried: a toolkit that cannot say will not be able to
    on the next tick either."""
    toolkit = doc.get("toolkit") or {}
    work_dir = _wbm_work_dir(doc)
    if not toolkit.get("home") or work_dir is None:
        return RunState(None)
    try:
        openghm, _ = toolkit_paths(toolkit["home"])
    except SubmitInputError:
        return RunState(None)
    command = " ".join(shlex.quote(word) for word in [openghm, "sim", "state", work_dir, "--json"])
    try:
        result = await run_remote(
            command, operation="sim_state", retry_safe=True, timeout=_STATE_TIMEOUT_SECONDS
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        raise StateUnreadable(str(exc) or type(exc).__name__) from exc
    if result.exit_status is None or result.exit_status == 255:
        # 255 is ssh's own failure, not the toolkit's: it never ran.
        raise StateUnreadable(f"the command did not run (exit {result.exit_status})")
    if result.exit_status != 0:
        logger.warning(
            "sim state of %s exited %s, so it is not continued: %s",
            work_dir,
            result.exit_status,
            (result.stderr or "").strip()[-200:],
        )
        return RunState(None)
    try:
        answer = json.loads(result.stdout)
        state = answer["state"]
    except (ValueError, KeyError, TypeError):
        logger.warning("sim state of %s printed no usable JSON: %.200r", work_dir, result.stdout)
        return RunState(None)
    if state not in ("none", "resumable", "inconsistent"):
        logger.warning("sim state of %s answered with state %r", work_dir, state)
        return RunState(None)
    saved_at = _as_utc(answer.get("saved_at")) if isinstance(answer, dict) else None
    return RunState(state, saved_at)


async def _consider_continuing(doc: dict, info: JobInfo | None) -> str | None:
    """A job of `doc` that SLURM ended with `TIMEOUT`: continue it, or say why not.
    Returns `_CONTINUED`, `_MOVED` (another writer got there first), `job_limit`
    (the simulation has used all the jobs it may), `no_new_state` (the work
    directory holds no complete state saved after this job started, or the
    toolkit could not say), or None (a cancel was asked: the timeout stands as it
    is, as it does for any job that ends before its cancel). Raises
    `StateUnreadable` when Anvil could not be asked, which writes nothing."""
    fresh = await get_db().jobs.find_one({"_id": doc["_id"]})
    if fresh is None or fresh.get("status") != doc["status"]:
        logger.info("Job %s left %s while it was being judged; leaving it", doc["_id"], doc["status"])
        return _MOVED
    doc = fresh
    if doc.get("cancel_requested_at"):
        return None
    jobs_ran = len(doc.get("previous_jobs") or []) + 1
    if jobs_ran >= MAX_JOBS_PER_SIMULATION:
        return "job_limit"

    state = await read_run_state(doc)
    started = (_as_utc(info.start_time) if info else None) or _as_utc(doc.get("slurm_start"))
    if state.state != "resumable" or state.saved_at is None or started is None or state.saved_at <= started:
        return "no_new_state"

    after = await _start_continuation(doc, info, state.saved_at)
    if after is None:
        return _MOVED
    if after.get("status") == "SUBMITTED" and not after.get("slurm_job_id"):
        await _submit_continuation_of(after)
    return _CONTINUED


async def _start_continuation(doc: dict, info: JobInfo | None, saved_at: datetime) -> dict | None:
    """The one compare-and-set that continues a simulation: the ended job goes
    onto `previous_jobs`, the current-job fields are cleared, and the document is
    SUBMITTED with a `continuation` and no SLURM id, as a draft's claim leaves it.
    It matches only the job as `doc` read it (status, SLURM id) with no cancel
    asked, so a second tick, a cancel and a delete each lose or win it cleanly.
    Returns the document as written, or None when it did not match."""
    now = datetime.now(timezone.utc)
    ran = len(doc.get("previous_jobs") or []) + 1
    ended = {
        "number": ran,
        "slurm_job_id": str(doc["slurm_job_id"]),
        "internal_job_id": doc.get("internal_job_id"),
        "remote_job_dir": doc.get("remote_job_dir"),
        "remote_script_path": doc.get("remote_script_path"),
        "stdout_path": doc.get("stdout_path"),
        "stderr_path": doc.get("stderr_path"),
        "slurm_start": (_as_utc(info.start_time) if info else None) or _as_utc(doc.get("slurm_start")),
        "slurm_end": _as_utc(info.end_time) if info else None,
        "slurm_state": "TIMEOUT",
        "slurm_exit_code": (info.exit_code if info else None) or doc.get("slurm_exit_code"),
        "state_saved_at": saved_at,
        # When the gateway saw it over: starts the window of its end-time backfill.
        "recorded_at": now,
    }
    result = await get_db().jobs.update_one(
        {
            "_id": doc["_id"],
            "status": doc["status"],
            "slurm_job_id": doc["slurm_job_id"],
            "cancel_requested_at": None,
        },
        {
            "$set": {
                "status": "SUBMITTED",
                "slurm_job_id": None,
                "internal_job_id": None,
                "remote_job_dir": None,
                "remote_script_path": None,
                "stdout_path": None,
                "stderr_path": None,
                "slurmly_submitted_at": None,
                "continuation": {"number": ran + 1, "requested_at": now, "tries": 0},
                "updated_at": now,
            },
            "$unset": {
                "slurm_state": "",
                "slurm_exit_code": "",
                "slurm_start": "",
                "slurm_end": "",
                "missing_since": "",
            },
            "$push": {"previous_jobs": ended},
        },
    )
    if result.matched_count == 0:
        logger.info("Job %s changed while it was being continued; leaving it", doc["_id"])
        return None
    await log_event(
        "job_continued",
        actor_id=SYSTEM_ACTOR,
        target_id=doc["_id"],
        category=AuditCategory.JOB,
        detail={
            "sim_id": doc.get("sim_id"),
            "number": ran + 1,
            "after_slurm_job_id": str(doc["slurm_job_id"]),
            "state_saved_at": saved_at.isoformat(),
            "user_id": doc.get("user_id"),
        },
    )
    return await get_db().jobs.find_one({"_id": doc["_id"]})


def _previous_dirs(doc: dict) -> list[str]:
    """The slurmly directories of the jobs that ran `doc` before the current one."""
    return [
        entry["remote_job_dir"]
        for entry in doc.get("previous_jobs") or []
        if isinstance(entry, dict) and entry.get("remote_job_dir")
    ]


async def _submit_continuation_of(doc: dict) -> None:
    """Submit the next job of `doc`, which `_start_continuation` has written
    (SUBMITTED, no SLURM id, a `continuation`), and settle what the answer was.

    - SLURM or slurmly said no (`SbatchError`, `InvalidJobSpec`): the simulation
      FAILED, `continuation_failed`, with SLURM's reason. Retrying a refusal would
      get the same one.
    - The answer was lost (a transport failure, a timeout, anything unexpected):
      a job may exist, so it is scancelled by name and the document stays SUBMITTED
      with no SLURM id and one more try counted; the sweep tries again later
      (`reconcile_interrupted_submits`).
    - A SLURM id: written with a compare-and-set on SUBMITTED. If a cancel moved the
      job meanwhile, the new job is scancelled, as the submit route does.

    Never raises for what Anvil or SLURM did."""
    try:
        # Checked before anything is sent: a script that cannot be turned into a
        # job is a plain failure, while anything raised after sbatch ran may
        # have started one (below).
        build_continuation_spec(doc)
    except (KeyError, TypeError, ValueError) as exc:
        logger.error("Job %s: its stored script cannot be submitted: %s", doc["_id"], exc)
        await _fail_continuation(doc, "The job script the first job ran was not kept in a form this gateway can use.")
        return
    try:
        submitted = await submit_continuation(doc)
    except asyncio.CancelledError:
        raise
    except (SbatchError, InvalidJobSpec) as exc:
        logger.warning("Job %s: SLURM refused its continuation: %s", doc["_id"], exc)
        why = sbatch_refusal.refusal_message(exc, "", advice=False).strip()
        if isinstance(exc, SbatchError) and is_valid_id(doc.get("sim_id")):
            # slurmly made its directory before sbatch said no. Found by name, so
            # the directories of the jobs that did run are kept.
            await remove_failed_submit_dirs(doc["sim_id"], keep=_previous_dirs(doc))
        await _fail_continuation(doc, why)
        return
    except Exception as exc:
        logger.warning("Job %s: the answer to its continuation was lost: %s", doc["_id"], exc)
        await _continuation_answer_lost(doc)
        return

    try:
        recorded = await get_db().jobs.update_one(
            {"_id": doc["_id"], "status": "SUBMITTED", "slurm_job_id": None},
            {
                "$set": {
                    "slurm_job_id": submitted.slurm_job_id,
                    "internal_job_id": submitted.internal_job_id,
                    "remote_job_dir": submitted.remote_job_dir,
                    "remote_script_path": submitted.remote_script_path,
                    "stdout_path": submitted.stdout_path,
                    "stderr_path": submitted.stderr_path,
                    "slurmly_submitted_at": submitted.submitted_at,
                    "updated_at": datetime.now(timezone.utc),
                },
                "$unset": {"continuation": ""},
            },
        )
    except Exception:
        # SLURM has the job and its id could not be written (the database is
        # down). Nothing tracks it: scancel it by name, and if that cannot run
        # either, the sweep does before it submits anything again.
        logger.exception("Job %s: its continuation took %s but the id was not recorded", doc["_id"], submitted.slurm_job_id)
        await _continuation_answer_lost(doc)
        return
    if recorded.matched_count == 0:
        await _cancel_unwanted_continuation(doc, submitted)


async def _cancel_unwanted_continuation(doc: dict, submitted: SubmittedJob) -> None:
    """A cancel moved the job between `_start_continuation` and SLURM's answer:
    the next job exists on Anvil and its owner already said no to it. It is
    scancelled by its id (by the name, kept for the orphan pass, if that fails),
    and its directories are written onto the cancelled document so a delete removes
    them."""
    db = get_db()
    logger.warning("Job %s left SUBMITTED during its continuation; cancelling %s", doc["_id"], submitted.slurm_job_id)
    try:
        await cancel_job(submitted.slurm_job_id)
    except Exception as exc:
        logger.error("scancel of unwanted %s failed: %s", submitted.slurm_job_id, exc)
        if is_valid_id(doc.get("sim_id")):
            await db.jobs.update_one({"_id": doc["_id"]}, {"$addToSet": {"orphan_sim_ids": doc["sim_id"]}})
    await db.jobs.update_one(
        {"_id": doc["_id"], "status": "CANCELLED"},
        {
            "$set": {
                "slurm_job_id": submitted.slurm_job_id,
                "internal_job_id": submitted.internal_job_id,
                "remote_job_dir": submitted.remote_job_dir,
                "remote_script_path": submitted.remote_script_path,
                "stdout_path": submitted.stdout_path,
                "stderr_path": submitted.stderr_path,
                "slurmly_submitted_at": submitted.submitted_at,
            }
        },
    )


async def _continuation_answer_lost(doc: dict) -> None:
    """A continuation submit whose answer was lost: scancel by name whatever it
    started (best effort: `reconcile_interrupted_submits` scancels again before it
    submits anew), remove the leftover directory when that worked, and count the
    try. The count is a compare-and-set on the number the caller read, so two
    writers do not count one try twice."""
    sim_id = doc.get("sim_id")
    if is_valid_id(sim_id):
        try:
            if await scancel_by_name(sim_id):
                await remove_failed_submit_dirs(sim_id, keep=_previous_dirs(doc))
        except Exception as exc:
            logger.warning("scancel --name=%s failed: %s", sim_id, exc)
    tries = (doc.get("continuation") or {}).get("tries") or 0
    try:
        await get_db().jobs.update_one(
            {"_id": doc["_id"], "status": "SUBMITTED", "slurm_job_id": None, "continuation.tries": tries},
            {"$set": {"continuation.tries": tries + 1, "updated_at": datetime.now(timezone.utc)}},
        )
    except Exception as exc:
        logger.warning("Job %s: could not count a lost continuation try: %s", doc["_id"], exc)


async def _fail_continuation(doc: dict, why: str) -> bool:
    """End a simulation whose next job could not be queued: FAILED,
    `continuation_failed`. Conditional on the job still being SUBMITTED with no
    SLURM id, so a cancel or a job recorded meanwhile is not overwritten."""
    failure = continuation_failure(why)
    return await _move(
        doc,
        {
            "status": "FAILED",
            "status_reason": failure.message,
            "failure": failure.model_dump(),
            "completed_at": datetime.now(timezone.utc),
            "files": "present",  # the work directory holds what the jobs wrote
        },
        unset=("continuation",),
        cause=failure.cause,
        only_if={"slurm_job_id": None},
    )


async def _reconcile_continuation(doc: dict) -> None:
    """A continuation whose submit the gateway lost track of (the process died,
    or the answer was lost) and that has waited `JOB_SUBMIT_INTERRUPTED_AFTER_SECONDS`.
    Unlike a first submit it is never given back as a draft: earlier jobs ran this
    simulation. The sweep claims it (a write on `updated_at`, so one writer wins),
    scancels by name whatever an earlier try may have started, and only when that
    worked submits again, so there are never two jobs. After
    `JOB_CONTINUATION_MAX_TRIES` lost answers it fails `continuation_failed`; if
    the scancel of that last try cannot run, the name goes to `orphan_sim_ids`,
    which is safe now that nothing will be submitted again."""
    db = get_db()
    claimed = await db.jobs.update_one(
        {"_id": doc["_id"], "status": "SUBMITTED", "slurm_job_id": None, "updated_at": doc.get("updated_at")},
        {"$set": {"updated_at": datetime.now(timezone.utc)}},
    )
    if claimed.matched_count == 0:
        return  # another writer has it, or it has moved on
    sim_id = doc.get("sim_id")
    cancelled = False
    if is_valid_id(sim_id):
        try:
            cancelled = await scancel_by_name(sim_id)
        except Exception as exc:
            logger.warning("scancel --name=%s failed: %s", sim_id, exc)
        if cancelled:
            await remove_failed_submit_dirs(sim_id, keep=_previous_dirs(doc))
    tries = (doc.get("continuation") or {}).get("tries") or 0
    fresh = await db.jobs.find_one({"_id": doc["_id"]})
    if fresh is None or fresh.get("status") != "SUBMITTED" or fresh.get("slurm_job_id"):
        return
    if tries >= settings.JOB_CONTINUATION_MAX_TRIES:
        if is_valid_id(sim_id) and not cancelled:
            await db.jobs.update_one({"_id": doc["_id"]}, {"$addToSet": {"orphan_sim_ids": sim_id}})
        logger.warning("Job %s: its continuation was never accepted after %d tries", doc["_id"], tries)
        await _fail_continuation(
            fresh,
            f"Anvil did not answer {tries} times in a row when the next job was submitted.",
        )
        return
    if not cancelled:
        return  # an earlier try may be alive; submit nothing until it is gone
    await _submit_continuation_of(fresh)


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


def _sacct_end_fields(info: JobInfo | None, stored: dict) -> dict[str, Any]:
    """The end time, start time and exit code a sacct row gives `stored` (a job
    document or a `previous_jobs` entry), for the ones it has none of. A squeue
    row, a row for a job still going and no row at all give nothing."""
    fields: dict[str, Any] = {}
    if info is not None and info.source == "sacct" and info.lifecycle in _ENDED_LIFECYCLES:
        for key, value in (
            ("slurm_end", _as_utc(info.end_time)),
            ("slurm_start", _as_utc(info.start_time)),
            ("slurm_exit_code", info.exit_code or None),
        ):
            if value and stored.get(key) is None:
                fields[key] = value
    return fields


def _end_backfill_due(stored: dict, base: Any, now: datetime) -> bool:
    """Whether a record with no end time is to be asked about now: it has tries
    left, it ended within the window (when `base` says when), and it has been
    over, or untried, for the retry interval."""
    if (stored.get("slurm_end_tries") or 0) >= settings.JOB_END_BACKFILL_MAX_TRIES:
        return False
    base = _as_utc(base)
    if base is not None and now - base > timedelta(seconds=settings.JOB_END_BACKFILL_WINDOW_SECONDS):
        return False
    waited_since = _as_utc(stored.get("slurm_end_tried_at")) or base
    return waited_since is None or now - waited_since >= timedelta(
        seconds=settings.JOB_END_BACKFILL_RETRY_SECONDS
    )


async def backfill_slurm_end() -> None:
    """Give a job settled from a squeue row the end time (and start time and
    exit code) only sacct has. The verdict and `completed_at` are never touched.

    A candidate is a job with a verdict from SLURM's state, no `slurm_end`, that
    ended within `JOB_END_BACKFILL_WINDOW_SECONDS`. It is asked about once it
    has been over for `JOB_END_BACKFILL_RETRY_SECONDS` and again that long after
    each try, in one batched lookup per tick, at most `JOB_END_BACKFILL_MAX_TRIES`
    times. Only a sacct row counts: a squeue row still lingering is a try spent.
    A lookup that fails costs no try.

    The same holds for every entry of `previous_jobs` (ADR 0037) with no
    `slurm_end`, whatever status the simulation has now, since it may be running
    its next job: the entry moved there when the gateway saw the job over
    (`recorded_at`, which starts its window and its first wait), and the tries are
    counted on the entry (`slurm_end_tries`, `slurm_end_tried_at`), each entry
    bounded by `JOB_END_BACKFILL_MAX_TRIES` on its own. An entry written before
    `recorded_at` existed has no window, only the tries. Its writes are
    conditional on that entry's `slurm_end` still being empty, and do not touch
    the document's `updated_at`."""
    db = get_db()
    now = datetime.now(timezone.utc)
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
        if _end_backfill_due(doc, doc.get("completed_at"), now):
            due.append(doc)
    due_previous: list[tuple[dict, dict]] = []
    async for doc in db.jobs.find({"previous_jobs": {"$elemMatch": {"slurm_end": None}}}):
        for entry in doc.get("previous_jobs") or []:
            if (
                isinstance(entry, dict)
                and entry.get("slurm_end") is None
                and entry.get("slurm_job_id")
                and entry.get("number") is not None
                and _end_backfill_due(entry, entry.get("recorded_at"), now)
            ):
                due_previous.append((doc, entry))
    if not due and not due_previous:
        return

    ids = list(
        dict.fromkeys(
            [str(doc["slurm_job_id"]) for doc in due]
            + [str(entry["slurm_job_id"]) for _, entry in due_previous]
        )
    )
    try:
        found = await job_live.slurm_info(ids, refresh=True)
    except Exception as exc:
        logger.warning("End-time backfill: lookup of %d jobs failed, skipping this tick: %s", len(ids), exc)
        return

    for doc in due:
        fields = _sacct_end_fields(found.get(str(doc["slurm_job_id"])), doc)
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

    for doc, entry in due_previous:
        fields = _sacct_end_fields(found.get(str(entry["slurm_job_id"])), entry)
        prefix = "previous_jobs.$[e]."
        update = {"$set": {prefix + key: value for key, value in fields.items()}}
        if "slurm_end" in fields:
            update["$unset"] = {prefix + "slurm_end_tries": "", prefix + "slurm_end_tried_at": ""}
        else:
            update["$set"][prefix + "slurm_end_tries"] = (entry.get("slurm_end_tries") or 0) + 1
            update["$set"][prefix + "slurm_end_tried_at"] = now
        try:
            # Conditional on this entry's end time still being empty.
            await db.jobs.update_one(
                {
                    "_id": doc["_id"],
                    "previous_jobs": {"$elemMatch": {"number": entry["number"], "slurm_end": None}},
                },
                update,
                array_filters=[{"e.number": entry["number"], "e.slurm_end": None}],
            )
        except Exception as exc:
            logger.warning(
                "End-time backfill: job %s, earlier job %s failed: %s",
                doc["_id"], entry["slurm_job_id"], exc,
            )


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
        # A simulation that already ran a job is never a draft again (ADR 0037).
        {"_id": job_id, "status": "SUBMITTED", "previous_jobs": {"$exists": False}, **(only_if or {})},
        {
            "$set": {
                "status": "DRAFT",
                "slurm_job_name": "",
                "last_submit_error": {"code": code, "message": message, "at": now},
                "updated_at": now,
            },
            "$unset": {"sim_id": "", "toolkit": "", "work_dir": "", "submit_script": ""},
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
    retries it.

    A job that already ran (`previous_jobs`, a `continuation`) is a continuation
    whose submit was lost, not a draft's: it is submitted again instead
    (`_reconcile_continuation`, ADR 0037), and never returned to a draft."""
    db = get_db()
    due_before = datetime.now(timezone.utc) - timedelta(seconds=settings.JOB_SUBMIT_INTERRUPTED_AFTER_SECONDS)
    stuck = [doc async for doc in db.jobs.find({"status": "SUBMITTED", "slurm_job_id": None})]
    for doc in stuck:
        updated = _as_utc(doc.get("updated_at"))
        if updated is not None and updated > due_before:
            continue  # a submit that may still be running
        try:
            if doc.get("continuation") or doc.get("previous_jobs"):
                await _reconcile_continuation(doc)
            else:
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


async def remove_failed_submit_dirs(sim_id: str, keep: Iterable[str] = ()) -> None:
    """Remove slurmly's job directory left by a submit sbatch refused. slurmly
    creates it before sbatch runs and never learns of it again, and the
    gateway never got its path, so it is found by its `metadata.json` naming
    the attempt's `sim_id`. Best-effort: a failure is logged and nothing else
    changes.

    Every job of a simulation that was continued carries the same name, so the
    directories of the jobs that did run (`keep`, their `previous_jobs`) are
    left alone: the name finds them too."""
    kept = {path.rstrip("/") for path in keep}
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
            if not directory or directory.rstrip("/") in kept:
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


def previous_job_dirs(doc: dict) -> list[str]:
    """The slurmly directories of the jobs that ran a continued simulation before
    the current one (`previous_jobs`), each checked as `removable_paths` checks
    the current one. Raises `RefusedPath` for one outside the allow-list."""
    directories = _previous_dirs(doc)
    for directory in directories:
        try:
            assert_safe_to_remove(directory, remote_base_dir=_resolve_remote_base_dir())
        except InvalidConfig as exc:
            raise RefusedPath(str(exc)) from exc
        _job_at(directory)
    return directories


async def remove_job_files(doc: dict) -> list[str]:
    """Remove a finished job's directories from Anvil and return what was
    removed: the work directory, slurmly's directory of the current job, and
    slurmly's directory of every job that ran before it (ADR 0037). Every path is
    checked before anything is touched. Raises `RefusedPath` (nothing removed),
    `CleanupFailed` (Anvil said no), and whatever the transport raises when Anvil
    cannot be reached."""
    remote_dir, work_dir = removable_paths(doc)
    earlier = previous_job_dirs(doc)
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
    errors: list[str] = []
    for directory in earlier:
        client = await get_slurm_client()
        outcome = await client.cleanup_remote_job_dir(_job_at(directory))
        errors.extend(outcome.errors)
        removed.extend(outcome.removed)
    if errors:
        raise CleanupFailed("; ".join(errors))
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


def job_view(doc: dict, number: int) -> dict | None:
    """`doc` as it was while job `number` of the simulation was the current one:
    that job's slurmly ids and paths (`previous_jobs`), for the log readers, which
    only read those and the status. None when no such earlier job exists (the
    current job is `doc` itself). An earlier job has ended, so the view is
    terminal: its files are complete, which is all `read_log` uses the status for."""
    for entry in doc.get("previous_jobs") or []:
        if isinstance(entry, dict) and entry.get("number") == number:
            return {
                **doc,
                "status": "COMPLETED",
                **{
                    key: entry.get(key)
                    for key in (
                        "slurm_job_id",
                        "internal_job_id",
                        "remote_job_dir",
                        "remote_script_path",
                        "stdout_path",
                        "stderr_path",
                    )
                },
            }
    return None


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

    # The path is part of the key: the jobs of a simulation share its id and its
    # streams, and differ only in where their files are.
    return await job_live.shared(("log", doc["_id"], stream, path, offset, limit, terminal), read)


def _absent(offset: int | None) -> dict[str, Any]:
    at = offset or 0
    return {"exists": False, "data": "", "offset": at, "next_offset": at, "size": 0, "eof": True}
