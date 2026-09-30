"""How a job's verdict is reached (ADR 0026).

`classify` is the only place a cause is named. It is pure — strings and dicts
in, a `Verdict` out — so every row of the contract is a unit test fed recorded
SLURM states, outcome records (`job_script`) and stderr, with no SSH and no
Mongo. The first rule that matches wins:

1. SLURM says `CANCELLED`: `cancelled_by_user` if the gateway recorded a
   cancel request, else `cancelled_by_system`.
2. SLURM killed the job (`TIMEOUT`, `OUT_OF_MEMORY`, `NODE_FAIL` and kin): its
   own cause. The script was killed, so its record is absent or cut short.
3. SLURM says the script exited (`COMPLETED`, `FAILED`, `SPECIAL_EXIT`): the
   record decides, first failing fact first.
4. SLURM has no record of the job (`missing=True`): judged from the record as
   rule 3 would; no record is `lost`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.models.job import FailureCause, JobFailure
from app.services.job_script import BODY_MARKER

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
    "run_refused": "run",
    "wbm_error": "run",
    "wbm_silent_failure": "check",
}

# A message is a short sentence its owner can act on. The ones that depend on
# a fact of the run are built in `_message`.
_MESSAGE: dict[str, str] = {
    "fetch_failed": (
        "The snapshot could not be downloaded to Anvil, so the simulation never "
        "started. Try again; if it keeps failing, the snapshot's files may be "
        "unavailable."
    ),
    "timeout": (
        "The job hit its walltime before WBM finished. Submit again with a "
        "longer walltime."
    ),
    "out_of_memory": (
        "The job ran out of memory and Anvil stopped it. Reduce what the "
        "simulation asks for or request more resources, then submit again."
    ),
    "node_failure": (
        "Anvil lost the job. This is not a problem with your input. Submit "
        "again."
    ),
    "cancelled_by_user": "You cancelled this simulation.",
    "cancelled_by_system": (
        "Anvil or an administrator cancelled this job. It was not cancelled "
        "from OpenGHM."
    ),
    "lost": (
        "Anvil has no record of this job any more, and it left no result "
        "behind. Submit again."
    ),
}

_EXCERPT_LINES = 60
_EXCERPT_BYTES = 8 * 1024


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
) -> Verdict:
    """The verdict on a job that is over.

    `slurm_state` is SLURM's raw state, and is ignored when `missing`: SLURM
    has no record of the job, which is rule 4. `outcome` is the parsed
    `outcome.json` or None, and `stderr_tail` the end of the job's stderr.
    Raises ValueError for a state that is not an ending, because a job that
    is still going has no verdict yet.
    """
    record = outcome if isinstance(outcome, dict) else None
    excerpt = _stderr_excerpt(stderr_tail)
    phase = (record or {}).get("phase")

    if missing:
        if record is None:
            return _fail("lost", phase=None, excerpt=excerpt)
        return _from_record(record, slurm_state=None, excerpt=excerpt)

    head = slurm_state_head(slurm_state)
    if head == "CANCELLED":
        cause: FailureCause = "cancelled_by_user" if cancel_requested else "cancelled_by_system"
        return Verdict("CANCELLED", _failure(cause, phase, excerpt=excerpt))
    if head in _KILLED_BY_SLURM:
        cause = _KILLED_BY_SLURM[head]
        return _fail(cause, phase=phase, excerpt=excerpt, state=head)
    if head in _EXITED:
        return _from_record(record, slurm_state=head, excerpt=excerpt)
    raise ValueError(f"{slurm_state!r} is not a state a job ends in")


# ---------------------------------------------------------------------------
# Rule 3: the record decides
# ---------------------------------------------------------------------------


def _from_record(record: dict | None, *, slurm_state: str | None, excerpt: str | None) -> Verdict:
    if record is None:
        return _fail("outcome_missing", phase=None, excerpt=excerpt)

    steps = record.get("steps") or {}
    fetch, run = steps.get("fetch"), steps.get("run")
    wbm = record.get("wbm") or {}
    output = record.get("output") or {}
    phase = record.get("phase")
    wbm_excerpt = "\n".join(wbm.get("tail") or []).strip() or None

    # First failing fact first. A step that has an exit code and did not
    # exit 0 is a verdict; one that has none means the script stopped inside
    # it, which no cause can be drawn from.
    if fetch is not None and fetch.get("exit_code") not in (None, 0):
        return _fail("fetch_failed", excerpt=_fetch_excerpt(excerpt), code=fetch["exit_code"])
    if run is not None and run.get("exit_code") not in (None, 0):
        code = run["exit_code"]
        if not record.get("staged"):
            return _fail("run_refused", excerpt=excerpt, detail=_openghm_message(excerpt), code=code)
        return _fail("wbm_error", excerpt=wbm_excerpt or excerpt, code=code)
    if fetch is None or run is None:
        return _fail("outcome_missing", phase=phase, excerpt=excerpt, detail="stopped_before_run")
    if fetch.get("exit_code") is None or run.get("exit_code") is None:
        return _fail("outcome_missing", phase=phase, excerpt=excerpt, detail="interrupted")
    if record.get("signal"):
        return _fail("outcome_missing", phase=phase, excerpt=excerpt, detail="interrupted")

    markers = wbm.get("markers") or []
    if markers:
        return _fail("wbm_silent_failure", excerpt=wbm_excerpt or excerpt, detail=f"marker:{markers[0]}")
    if not wbm.get("all_done"):
        return _fail("wbm_silent_failure", excerpt=wbm_excerpt or excerpt, detail="no_all_done")
    if not output.get("nc_count"):
        return _fail("wbm_silent_failure", excerpt=wbm_excerpt or excerpt, detail="no_nc")

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
) -> Verdict:
    return Verdict(
        "FAILED",
        _failure(cause, phase, excerpt=excerpt, detail=detail, code=code, state=state),
    )


def _failure(
    cause: FailureCause,
    phase: str | None,
    *,
    excerpt: str | None,
    detail: str | None = None,
    code: int | None = None,
    state: str | None = None,
) -> JobFailure:
    return JobFailure(
        cause=cause,
        phase=_PHASE.get(cause, phase),
        message=_message(cause, detail=detail, code=code, state=state),
        excerpt=excerpt,
    )


def _message(cause: str, *, detail: str | None, code: int | None, state: str | None) -> str:
    if cause == "run_refused":
        why = detail or "the snapshot or its configuration is not valid"
        return f"The toolkit refused to run this simulation: {why}. Check the snapshot's settings and submit again."
    if cause == "wbm_error":
        return (
            f"WBM stopped with an error (exit code {code}). The last lines of its "
            "log show what it was doing."
        )
    if cause == "wbm_silent_failure":
        if detail and detail.startswith("marker:"):
            return (
                f"WBM exited normally but its log says \"{detail[7:]}\", so the "
                "run did not finish."
            )
        if detail == "no_nc":
            return "WBM finished, but it wrote no .nc output files."
        return "WBM exited without finishing: its log never reached \"All Done!\"."
    if cause == "node_failure" and state:
        return f"Anvil lost the job (SLURM state {state}). This is not a problem with your input. Submit again."
    if cause == "outcome_missing":
        if detail == "interrupted":
            return "The job was stopped part-way, and did not report a result."
        if detail == "stopped_before_run":
            return "The job ended before it ran the simulation, and did not report a result."
        if detail and detail.startswith("disagree:"):
            return (
                f"SLURM says the job ended {detail[9:]}, but the job's own record says it "
                "succeeded. Check the logs before using its output."
            )
        return "The job ended without reporting a result. Its logs may show why."
    return _MESSAGE[cause]


def _stderr_excerpt(stderr_tail: str) -> str | None:
    """The part of stderr that is the job's own: after the body's marker,
    which keeps slurmly's `module list` out. With no marker the body never
    started, and everything there is news. The last ~60 lines / 8 KB."""
    text = stderr_tail or ""
    at = text.find(BODY_MARKER)
    if at != -1:
        text = text[at + len(BODY_MARKER):]
    lines = text.strip("\n").splitlines()[-_EXCERPT_LINES:]
    text = "\n".join(lines).strip()
    if len(text.encode("utf-8")) > _EXCERPT_BYTES:
        text = text.encode("utf-8")[-_EXCERPT_BYTES:].decode("utf-8", errors="ignore")
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
