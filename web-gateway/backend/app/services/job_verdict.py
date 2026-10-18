"""How a job's verdict is reached (ADR 0026).

`classify` is the only place a cause is named. It is pure — strings and dicts
in, a `Verdict` out — so every row of the contract is a unit test fed recorded
SLURM states, outcome records (`job_script`) and stderr, with no SSH and no
Mongo. The first rule that matches wins:

1. SLURM says `CANCELLED`: `cancelled_by_user` if the gateway recorded a
   cancel request, else `cancelled_by_system`.
2. SLURM killed the job (`TIMEOUT`, `OUT_OF_MEMORY`, `NODE_FAIL` and kin): its
   own cause. The script was killed, so its record is absent or cut short. A
   `TIMEOUT` the gateway did not continue (ADR 0037) says why in `detail`:
   `no_new_state` or `job_limit` (the caller decides, `classify` words it).
3. SLURM says the script exited (`COMPLETED`, `FAILED`, `SPECIAL_EXIT`): the
   record decides, first failing fact first. A record with a `restart_count`
   above 0 is a run SLURM requeued after a node failure, which the body
   refuses to repeat (`job_script._REQUEUE_GUARD`): `node_failure`. Then the
   fetch step (`gateway_setup`, `fetch_failed`), then the run step: the
   toolkit's own exit codes first, 64 (`run_state_incomplete`) and 65
   (`run_incomplete`), then a run that was not staged is `run_refused`; one that was staged and whose
   `post_processing.ok` is false (WBM finished, the post-processing its init
   asks for did not) is `post_processing_failed`; any other staged run that
   did not exit 0 is `wbm_error`. Then the silent failures of a run that
   exited 0 (`wbm_silent_failure`). Last, a run that exited 0 whose
   `post_processing.ok` is false is `post_processing_failed` too: the record
   is the truth even if the toolkit's exit code disagrees. Only after all of
   these does a record that says success, with SLURM agreeing, complete.
4. SLURM has no record of the job (`missing=True`): judged from the record as
   rule 3 would; no record is `lost`.

`classify` is total: a record of the wrong shape (valid JSON, but `steps` a
list, an exit code that is a string) is no record, `outcome_missing`, never an
exception, because the sweep would then retry the same job forever.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Literal

from app.models.job import MAX_WALLTIME_SECONDS, FailureCause, JobFailure
from app.services.job_script import WBM_MARKERS

logger = logging.getLogger(__name__)

VerdictStatus = Literal["COMPLETED", "FAILED", "CANCELLED"]

# SLURM states that mean the job was killed from outside, not that it exited.
_KILLED_BY_SLURM: dict[str, FailureCause] = {
    "TIMEOUT": "timeout",
    "OUT_OF_MEMORY": "out_of_memory",
    "NODE_FAIL": "node_failure",
    "BOOT_FAIL": "node_failure",
    "PREEMPTED": "node_failure",
    "DEADLINE": "node_failure",
    "REVOKED": "node_failure",
}
# SLURM states that mean the script ran to its end and exited.
_EXITED = {"COMPLETED", "FAILED", "SPECIAL_EXIT"}

# The phase each record-derived cause happened in. The others (SLURM's kills,
# cancels, a lost job) take whatever phase the record reached, if there is one.
_PHASE: dict[str, str] = {
    "fetch_failed": "fetch",
    "gateway_setup": "fetch",
    "run_refused": "run",
    "wbm_error": "run",
    "run_state_incomplete": "run",
    "run_incomplete": "run",
    "post_processing_failed": "run",
    "wbm_silent_failure": "check",
}

# A message is a short sentence its owner can act on. The ones that depend on
# a fact of the simulation are built in `_message`.
_MESSAGE: dict[str, str] = {
    "fetch_failed": (
        "The snapshot could not be downloaded to Anvil, so the simulation never "
        "started. Try again; if it keeps failing, the snapshot's files may be "
        "unavailable."
    ),
    "node_failure": (
        "Anvil lost this simulation. This is not a problem with your input. Submit "
        "again."
    ),
    "cancelled_by_user": "This simulation was cancelled from OpenGHM.",
    "cancelled_by_system": (
        "Anvil or an administrator cancelled this simulation. It was not cancelled "
        "from OpenGHM."
    ),
    "lost": (
        "Anvil has no record of this simulation any more, and it left no result "
        "behind. Submit again."
    ),
}

#: Memory comes with the cores on Anvil's `shared` partition, at most 1896 MiB
#: a core (`MaxMemPerCPU`, gateway.md §5): so the lever on a job that ran out
#: of memory is its cores, or the length of the run. The frontend states the
#: same figure as `ANVIL_SHARED_MB_PER_CORE` (lib/jobs/compute.ts).
ANVIL_SHARED_MB_PER_CORE = 1896


def _gb(megabytes: int) -> str:
    """`1.9`, `121.3`: GB (1 GB = 1000 MB) with one decimal."""
    return f"{megabytes / 1000:.1f}"


def _more_cores(cores: int | None) -> str:
    """What to do about a job that ran out of memory, with how much memory it
    had when its cores are known (`classify`'s `cores`)."""
    per_core = f"about {_gb(ANVIL_SHARED_MB_PER_CORE)} GB each"
    if cores is not None and cores > 0:
        what = (
            f"This simulation had {cores} {'core' if cores == 1 else 'cores'}, and memory comes with "
            f"the cores on Anvil's shared partition ({per_core}), so about "
            f"{_gb(cores * ANVIL_SHARED_MB_PER_CORE)} GB in all. "
        )
    else:
        what = f"Memory comes with the cores on Anvil's shared partition, {per_core}. "
    return (
        f"{what}Start a new snapshot draft with more cores for more memory, or with a "
        "shorter run period."
    )


#: The toolkit's `sim run` exit codes for a run it did not hand to WBM or did not
#: believe (ADR 0037): 64, the run state in the work directory was not all written
#: by one save, so a rerun is refused before WBM starts; 65, WBM exited 0 but its
#: log stops before the run's last day.
_RUN_STATE_INCOMPLETE = 64
_RUN_INCOMPLETE = 65

#: Exit codes of a process SLURM or the kernel killed with SIGKILL: 128 + 9,
#: and the same signal as a shell reports it from a container runtime.
_KILLED_EXIT_CODES = (137, 247)
#: sysexits.h, `EX_USAGE` (64) to `EX_CONFIG` (78). In the fetch step `flock`
#: answers with these when it cannot run the toolkit under the lock (seen live:
#: 66 for a lock file whose directory does not exist, 69 for a toolkit that is
#: not installed). The toolkit itself exits only 0, 1, 2 or a container's code,
#: so a code in this range there is the gateway's Anvil setup, not the snapshot.
_SETUP_EXIT_CODES = range(64, 79)

_EXCERPT_LINES = 60
_EXCERPT_BYTES = 8 * 1024
_WBM_LOG_LINES = 15
_WBM_LOG_SEPARATOR = "--- last lines of WBM's log ---"
_REASON_CHARS = 200

# Stderr lines that are noise, not news: the container tooling's architecture
# warning, and the fetch counter that a toolkit install from before it went
# quiet off a terminal still prints.
_PROGRESS = re.compile(r"^\s*\d+/\d+ files\s*$")
_NOISE_PREFIXES = ("dpkg-architecture: warning:",)


@dataclass(frozen=True)
class Verdict:
    status: VerdictStatus
    failure: JobFailure | None  # None only for COMPLETED


def slurm_state_head(raw: str | None) -> str:
    """`CANCELLED by 123` (sacct's verbose form) is `CANCELLED`."""
    parts = (raw or "").strip().split()
    return parts[0].upper() if parts else ""


def classify(
    *,
    slurm_state: str | None,
    cancel_requested: bool,
    outcome: dict | None,
    stderr_tail: str,
    missing: bool,
    slurm_exit_code: str | None = None,
    walltime_seconds: int | None = None,
    cores: int | None = None,
    timeout_reason: str | None = None,
    jobs_ran: int = 1,
) -> Verdict:
    """The verdict on a job that is over.

    `slurm_state` is SLURM's raw state, and is ignored when `missing`: SLURM
    has no record of the job, which is rule 4. `outcome` is the parsed
    `outcome.json` or None, and `stderr_tail` the end of the job's stderr.
    `slurm_exit_code` (`137:0`, sacct's form), `walltime_seconds` and `cores`
    (what the job asked SLURM for) only sharpen a message, and so do `timeout_reason`
    (`no_new_state` or `job_limit`: why a `TIMEOUT` was not continued, ADR 0037,
    decided by the caller, which has to look at the work directory) and `jobs_ran`
    (how many jobs ran the simulation, this one included). Raises ValueError for a state
    that is not an ending, because a job that is still going has no verdict
    yet. Anything else a record does to it is `outcome_missing`.
    """
    record = outcome if isinstance(outcome, dict) else None
    excerpt = _stderr_excerpt(stderr_tail)
    phase = _phase(record)
    killed = _killed_exit(slurm_exit_code)

    if missing:
        if record is None:
            return _fail("lost", phase=None, excerpt=excerpt)
        return _judge(record, None, stderr_tail, excerpt, cores=cores)

    head = slurm_state_head(slurm_state)
    if head == "CANCELLED":
        cause: FailureCause = "cancelled_by_user" if cancel_requested else "cancelled_by_system"
        return Verdict("CANCELLED", _failure(cause, phase, excerpt=excerpt))
    if head in _KILLED_BY_SLURM:
        cause = _KILLED_BY_SLURM[head]
        return _fail(
            cause,
            phase=phase,
            excerpt=excerpt,
            state=head,
            walltime=walltime_seconds,
            cores=cores,
            detail=timeout_reason if cause == "timeout" else None,
            jobs_ran=jobs_ran,
        )
    if head in _EXITED:
        return _judge(record, head, stderr_tail, excerpt, killed=killed and head == "FAILED", cores=cores)
    raise ValueError(f"{slurm_state!r} is not a state a job ends in")


def _phase(record: dict | None) -> str | None:
    phase = (record or {}).get("phase")
    return phase if isinstance(phase, str) else None


def _killed_exit(slurm_exit_code: str | None) -> bool:
    """Whether SLURM's `ExitCode` (`exit:signal`) says the script was killed:
    exit 137 or 247, or signal 9."""
    head, _, signal = (slurm_exit_code or "").partition(":")
    try:
        return int(head) in _KILLED_EXIT_CODES or int(signal) == 9
    except ValueError:
        return False


class _Malformed(Exception):
    """The record is JSON, but not the record `job_script.OUTCOME_PY` writes."""


def _judge(
    record: dict | None,
    slurm_state: str | None,
    stderr_tail: str,
    excerpt: str | None,
    *,
    killed: bool = False,
    cores: int | None = None,
) -> Verdict:
    """Rule 3 on a record that may be anything: a shape this gateway cannot
    read is as good as no record."""
    try:
        return _from_record(
            record, slurm_state=slurm_state, stderr_tail=stderr_tail, excerpt=excerpt, killed=killed, cores=cores
        )
    except _Malformed as exc:
        logger.warning("outcome.json is not the record the job body writes: %s", exc)
    except Exception:
        logger.warning("outcome.json could not be judged", exc_info=True)
    return _fail("outcome_missing", phase=None, excerpt=excerpt, detail="malformed")


# ---------------------------------------------------------------------------
# Rule 3: the record decides
# ---------------------------------------------------------------------------


def _step(steps: dict, name: str) -> dict | None:
    """The step's entry, None when it was not reached. An entry that is not an
    object with an integer (or null) `exit_code` is a record this gateway cannot
    read."""
    step = steps.get(name)
    if step is None:
        return None
    if not isinstance(step, dict):
        raise _Malformed(f"steps.{name} is a {type(step).__name__}")
    code = step.get("exit_code")
    if code is not None and (isinstance(code, bool) or not isinstance(code, int)):
        raise _Malformed(f"steps.{name}.exit_code is {code!r}")
    return step


def _object(record: dict, key: str) -> dict:
    value = record.get(key)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise _Malformed(f"{key} is a {type(value).__name__}")
    return value


def _from_record(
    record: dict | None,
    *,
    slurm_state: str | None,
    stderr_tail: str,
    excerpt: str | None,
    killed: bool = False,
    cores: int | None = None,
) -> Verdict:
    if record is None:
        return _fail("outcome_missing", phase=None, excerpt=excerpt, detail="killed" if killed else None, cores=cores)

    # A requeued run did nothing but say so; the failure is the first attempt's.
    restarts = record.get("restart_count")
    if isinstance(restarts, int) and not isinstance(restarts, bool) and restarts > 0:
        return _fail("node_failure", phase=_phase(record), excerpt=excerpt)

    steps = _object(record, "steps")
    fetch, run = _step(steps, "fetch"), _step(steps, "run")
    wbm = _object(record, "wbm")
    output = _object(record, "output")
    phase = _phase(record)
    wbm_tail = wbm.get("tail") or []
    recorded_markers = wbm.get("markers") or []
    if not isinstance(wbm_tail, list) or not isinstance(recorded_markers, list):
        raise _Malformed("wbm.tail and wbm.markers must be lists")

    # First failing fact first. A step that has an exit code and did not
    # exit 0 is a verdict; one that has none means the script stopped inside
    # it, which no cause can be drawn from.
    if fetch is not None and fetch.get("exit_code") not in (None, 0):
        code = fetch["exit_code"]
        if code in _SETUP_EXIT_CODES:
            return _fail("gateway_setup", excerpt=excerpt, code=code)
        return _fail("fetch_failed", excerpt=_fetch_excerpt(excerpt), code=code)
    if run is not None and run.get("exit_code") not in (None, 0):
        code = run["exit_code"]
        if code == _RUN_STATE_INCOMPLETE:
            return _fail("run_state_incomplete", excerpt=excerpt, code=code)
        if code == _RUN_INCOMPLETE:
            return _fail(
                "run_incomplete",
                excerpt=_wbm_excerpt(excerpt, wbm_tail),
                detail=_openghm_message(excerpt),
                code=code,
            )
        if not record.get("staged"):
            return _fail("run_refused", excerpt=excerpt, detail=_openghm_message(excerpt), code=code)
        post = _failed_post_processing(record)
        if post is not None:
            return _fail(
                "post_processing_failed",
                excerpt=_post_processing_excerpt(post, excerpt),
                detail=_post_processing_missing(post),
                code=code,
            )
        return _fail(
            "wbm_error",
            excerpt=_wbm_excerpt(excerpt, wbm_tail),
            detail=_last_paragraph(excerpt),
            code=code,
            cores=cores,
        )
    if fetch is None or run is None:
        return _fail("outcome_missing", phase=phase, excerpt=excerpt, detail="stopped_before_run")
    if fetch.get("exit_code") is None or run.get("exit_code") is None:
        return _fail("outcome_missing", phase=phase, excerpt=excerpt, detail="interrupted")
    if record.get("signal"):
        return _fail("outcome_missing", phase=phase, excerpt=excerpt, detail="interrupted")

    # WBM prints "Failed to warp" to stderr, not to its log, and exits 0: the
    # record's markers come from the log alone, so stderr is read for them too.
    markers = [m for m in WBM_MARKERS if m in recorded_markers or m in (stderr_tail or "")]
    if markers:
        return _fail("wbm_silent_failure", excerpt=_wbm_excerpt(excerpt, wbm_tail), detail=f"marker:{markers[0]}")
    if not wbm.get("all_done"):
        return _fail("wbm_silent_failure", excerpt=_wbm_excerpt(excerpt, wbm_tail), detail="no_all_done")
    if not output.get("nc_count"):
        return _fail("wbm_silent_failure", excerpt=_wbm_excerpt(excerpt, wbm_tail), detail="no_nc")

    # Both steps exited 0, but the record says the post-processing failed: the
    # record is the truth, even if the toolkit's exit code ever disagrees.
    post = _failed_post_processing(record)
    if post is not None:
        return _fail(
            "post_processing_failed",
            excerpt=_post_processing_excerpt(post, excerpt),
            detail=_post_processing_missing(post),
        )

    # The record says success. SLURM has to agree, or the two disagree and
    # neither is to be trusted with the word "completed".
    if slurm_state in (None, "COMPLETED"):
        return Verdict("COMPLETED", None)
    return _fail("outcome_missing", phase=phase, excerpt=excerpt, detail=f"disagree:{slurm_state}")


# ---------------------------------------------------------------------------
# Causes, messages and excerpts
# ---------------------------------------------------------------------------


def _fail(
    cause: FailureCause,
    *,
    excerpt: str | None,
    phase: str | None = None,
    detail: str | None = None,
    code: int | None = None,
    state: str | None = None,
    walltime: int | None = None,
    cores: int | None = None,
    jobs_ran: int = 1,
) -> Verdict:
    return Verdict(
        "FAILED",
        _failure(
            cause,
            phase,
            excerpt=excerpt,
            detail=detail,
            code=code,
            state=state,
            walltime=walltime,
            cores=cores,
            jobs_ran=jobs_ran,
        ),
    )


def _failure(
    cause: FailureCause,
    phase: str | None,
    *,
    excerpt: str | None,
    detail: str | None = None,
    code: int | None = None,
    state: str | None = None,
    walltime: int | None = None,
    cores: int | None = None,
    jobs_ran: int = 1,
) -> JobFailure:
    phase = _PHASE.get(cause, phase)
    return JobFailure(
        cause=cause,
        phase=phase,
        message=_message(
            cause,
            detail=detail,
            code=code,
            state=state,
            phase=phase,
            walltime=walltime,
            cores=cores,
            jobs_ran=jobs_ran,
        ),
        excerpt=excerpt,
        # Only a timeout's detail is part of the API: the others are wording
        # for `_message`.
        detail=detail if cause == "timeout" else None,
    )


def _message(
    cause: str,
    *,
    detail: str | None,
    code: int | None,
    state: str | None,
    phase: str | None = None,
    walltime: int | None = None,
    cores: int | None = None,
    jobs_ran: int = 1,
) -> str:
    if cause == "gateway_setup":
        return (
            f"The gateway's Anvil setup is broken: the snapshot download could not start "
            f"(exit code {code}), and the snapshot is not at fault. Tell an administrator; "
            "submitting again will not help."
        )
    if cause == "run_refused":
        if not detail:
            return (
                f"The toolkit stopped before the simulation started (exit code {code}) and gave "
                "no reason. The log below may show why."
            )
        return f"The toolkit refused to start this simulation: {detail}. Check the snapshot's settings and submit again."
    if cause == "wbm_error":
        if code in _KILLED_EXIT_CODES:
            return f"WBM was killed (exit code {code}), most likely because it ran out of memory. {_more_cores(cores)}"
        if detail:
            return f"WBM stopped with an error (exit code {code}): {detail}"
        return (
            f"WBM stopped with an error (exit code {code}). The last lines of its "
            "log show what it was doing."
        )
    if cause == "run_state_incomplete":
        return (
            "A job was stopped while WBM was saving its state, so the saved state is not all from "
            "one save and the simulation cannot be continued. Submit it again from a new "
            "snapshot draft."
        )
    if cause == "run_incomplete":
        stopped = "WBM exited without an error but stopped before the run's last day"
        return f"{stopped}: {detail}." if detail else f"{stopped}."
    if cause == "post_processing_failed":
        head = (
            "WBM's run finished and its daily, monthly and yearly output is complete, but the "
            "post-processing this simulation's init asks for (climatology and other "
            "aggregations) failed or wrote incomplete output"
        )
        if detail:
            head += f": {detail}"
        return (
            f"{head}. The log below shows what the post-processing printed. Submitting again "
            "runs it again."
        )
    if cause == "wbm_silent_failure":
        if detail and detail.startswith("marker:"):
            return (
                f"WBM exited normally but its output says \"{detail[7:]}\", so the "
                "simulation did not finish."
            )
        if detail == "no_nc":
            return "WBM finished, but it wrote no .nc output files."
        return "WBM exited without finishing: its log never reached \"All Done!\"."
    if cause == "timeout":
        if phase == "fetch":
            return (
                "The simulation hit its walltime while it was still fetching the snapshot, before "
                "WBM started. Fetches wait for each other, so this happens when Anvil is "
                "busy. Submit again."
            )
        return _timeout_message(walltime=walltime, reason=detail, jobs_ran=jobs_ran)
    if cause == "out_of_memory":
        return f"The simulation ran out of memory and Anvil stopped it. {_more_cores(cores)}"
    if cause == "node_failure" and state:
        return f"Anvil lost this simulation (SLURM state {state}). This is not a problem with your input. Submit again."
    if cause == "outcome_missing":
        if detail == "interrupted":
            return "The simulation was stopped part-way, and did not report a result."
        if detail == "stopped_before_run":
            return "The simulation ended before WBM ran, and did not report a result."
        if detail == "killed":
            return (
                "The simulation was killed and did not report a result; most likely it ran out of "
                f"memory. {_more_cores(cores)}"
            )
        if detail == "malformed":
            return "The simulation reported a result this gateway cannot read. Its logs may show why."
        if detail and detail.startswith("disagree:"):
            return (
                f"SLURM says the job ended {detail[9:]}, but the simulation's own record says it "
                "succeeded. Check the logs before using its output."
            )
        return "The simulation ended without reporting a result. Its logs may show why."
    return _MESSAGE[cause]


def _timeout_message(*, walltime: int | None, reason: str | None, jobs_ran: int) -> str:
    """A `TIMEOUT` after the fetch. `reason` is why it was not continued
    (ADR 0037): `job_limit` (the simulation used all the jobs it may) or
    `no_new_state` (WBM saved no complete state during the job, which WBM does at
    the end of each simulated year, so there is nothing to carry on from); None
    when no continuation was considered (a job from before them). A simulation
    that already ran as several jobs is not told to shorten the run period as
    though one job was all it had."""
    hours = MAX_WALLTIME_SECONDS // 3600
    lever = (
        "Shorten the run period and submit again."
        if walltime is not None and walltime >= MAX_WALLTIME_SECONDS
        else f"Submit again with a longer walltime (up to {hours} h), or with a shorter run period."
    )
    if jobs_ran > 1:
        ran = f"This simulation ran as {jobs_ran} jobs."
        if reason == "job_limit":
            return (
                f"{ran} That is the most one simulation may use, and the last job hit its walltime "
                "before WBM finished. Shorten the run period (fewer years need fewer jobs), or ask "
                "an administrator whether the limit can be raised."
            )
        if reason == "no_new_state":
            return (
                f"{ran} The last one hit its walltime before WBM saved a new state to continue "
                f"from, so it could not be continued. {lever}"
            )
        return f"{ran} The last one hit its walltime before WBM finished. {lever}"
    if reason == "job_limit":
        return (
            "The simulation hit its walltime before WBM finished, and one simulation may use only "
            f"{jobs_ran} job. Shorten the run period and submit again."
        )
    if reason == "no_new_state":
        return (
            "The simulation hit its walltime before WBM finished, and before it saved a state to "
            f"continue from in another job, so it was not continued. {lever}"
        )
    if walltime is not None and walltime >= MAX_WALLTIME_SECONDS:
        return (
            f"The simulation hit its walltime before WBM finished, and that was already the "
            f"{hours} h maximum. {lever}"
        )
    return f"The simulation hit its walltime before WBM finished. {lever}"


def continuation_failure(why: str) -> JobFailure:
    """The verdict on a simulation whose next job Anvil would not take, or could not
    be asked for (ADR 0037): a job ran it up to its time limit and WBM saved a
    state to continue from, but the continuation was never queued. Named here, with
    the other causes; `why` is a sentence saying what went wrong."""
    return JobFailure(
        cause="continuation_failed",
        phase="submit",
        message=(
            f"The simulation ran out of time and WBM saved a state to continue from, but the next job "
            f"could not be queued. {why} What WBM wrote so far is on Anvil."
        ),
        excerpt=None,
    )


def _stderr_excerpt(stderr_tail: str) -> str | None:
    """The part of stderr worth showing: all of it. The job's module preamble
    is quiet (`slurm.gateway_execution_profiles`), so what is on stderr is the
    job's own, and a failed `module load` is news too. Known noise lines are
    dropped (progress may arrive as `\\r` fragments: the last one is the line)
    and blank runs collapse to one. The last ~60 lines / 8 KB."""
    text = (stderr_tail or "").replace("\r\n", "\n")
    lines: list[str] = []
    for raw in text.split("\n"):
        fragments = [f for f in raw.split("\r") if f.strip()]
        line = fragments[-1].rstrip() if fragments else ""
        if _PROGRESS.match(line) or line.lstrip().startswith(_NOISE_PREFIXES):
            continue
        if not line and (not lines or not lines[-1]):
            continue
        lines.append(line)
    text = "\n".join(lines).strip("\n")
    text = "\n".join(text.splitlines()[-_EXCERPT_LINES:]).strip()
    if len(text.encode("utf-8")) > _EXCERPT_BYTES:
        text = text.encode("utf-8")[-_EXCERPT_BYTES:].decode("utf-8", errors="ignore")
    return text or None


def _failed_post_processing(record: dict) -> dict | None:
    """The record's `post_processing` when it says the step failed: an object
    whose `ok` is the boolean False. Anything else (absent, null, not an
    object, `ok` null because WBM failed first, or not a boolean) is no such
    record."""
    post = record.get("post_processing")
    if isinstance(post, dict) and post.get("ok") is False:
        return post
    return None


def _count(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _post_processing_missing(post: dict) -> str | None:
    """What the toolkit's record says is missing, in a phrase, from the facts
    it holds: the climatology files expected against found, the spatial
    aggregates, programs that could not be started. None when the record names
    nothing, so the message stays general rather than guess."""
    expected = post.get("expected") if isinstance(post.get("expected"), dict) else {}
    found = post.get("found") if isinstance(post.get("found"), dict) else {}
    parts: list[str] = []
    want, have = _count(expected.get("climatology")), _count(found.get("climatology"))
    if want and (have or 0) < want:
        parts.append(f"{have or 0} of {want} climatology files were written")
    if expected.get("spatial_agg") is True and not found.get("spatial_agg"):
        parts.append("no spatial aggregates were written")
    cant_exec = _count(post.get("cant_exec"))
    if cant_exec:
        parts.append(f"{cant_exec} program(s) could not be started")
    if not parts and post.get("all_done") is False:
        parts.append("the script did not reach \"All Done!\"")
    return "; ".join(parts) or None


def _post_processing_excerpt(post: dict, excerpt: str | None) -> str | None:
    """The tail of PostProcessing.log the toolkit recorded, bounded like the
    other excerpts; stderr's when the record holds none."""
    tail = post.get("tail")
    lines = [str(x) for x in tail] if isinstance(tail, list) else []
    text = "\n".join(lines[-_EXCERPT_LINES:]).strip()
    if not text:
        return excerpt
    return _last_bytes(text, _EXCERPT_BYTES)


def _wbm_excerpt(excerpt: str | None, tail: list[str]) -> str | None:
    """Why WBM stopped is on stderr; what it was doing is in its log. Both,
    stderr first, the log's last lines after a separator. Within the byte cap
    the log part is what gives way."""
    log_lines = [str(x) for x in tail][-_WBM_LOG_LINES:]
    while log_lines and not log_lines[0].strip():
        log_lines.pop(0)
    log = "\n".join(log_lines).strip()
    if not log:
        return excerpt
    if not excerpt:
        return _last_bytes(log, _EXCERPT_BYTES)
    head = excerpt + "\n" + _WBM_LOG_SEPARATOR + "\n"
    room = _EXCERPT_BYTES - len(head.encode("utf-8"))
    if room <= 0:
        return excerpt
    return head + _last_bytes(log, room)


def _last_bytes(text: str, limit: int) -> str:
    """The end of `text` within `limit` bytes, from a line start if it can."""
    if len(text.encode("utf-8")) <= limit:
        return text
    cut = text.encode("utf-8")[-limit:].decode("utf-8", errors="ignore")
    return cut.split("\n", 1)[1] if "\n" in cut else cut


#: Lines of stderr that are the toolkit talking about itself, not the reason a
#: program stopped: the spool cache's progress (`spool: downloaded ...`) and the
#: toolkit's warnings. They share a block with the reason, and crowd it out.
_NOT_A_REASON = ("spool:", "openghm: warning:")


def _last_paragraph(excerpt: str | None) -> str | None:
    """The last block of consecutive non-blank lines, on one line, at most
    200 characters: the reason a program gives just before it stops. The
    toolkit's own progress lines are left out, and a block too long is cut at
    its start, because what a program says last is why it stopped."""
    block: list[str] = []
    for line in reversed((excerpt or "").splitlines()):
        text = line.strip()
        if text.startswith(_NOT_A_REASON):
            continue
        if text:
            block.append(text)
        elif block:
            break
    text = " ".join(" ".join(reversed(block)).split())
    if len(text) > _REASON_CHARS:
        text = "…" + text[-(_REASON_CHARS - 1):].lstrip()
    return text or None


def _fetch_excerpt(excerpt: str | None) -> str | None:
    """From the toolkit's `failed:` line on — that block names the files that
    did not download. Without one, the whole excerpt."""
    if not excerpt:
        return excerpt
    lines = excerpt.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("failed:"):
            return "\n".join(lines[i:])
    return excerpt


def _openghm_message(excerpt: str | None) -> str | None:
    """The toolkit's own reason: the last `openghm: <message>` line."""
    for line in reversed((excerpt or "").splitlines()):
        if line.startswith("openghm:"):
            return line[len("openghm:"):].strip().rstrip(".") or None
    return None
