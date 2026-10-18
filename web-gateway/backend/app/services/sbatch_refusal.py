"""SLURM's refusals of a submit, in words for the person who owns the draft.

`sbatch` says no with a reason code (`QOSMaxWallDurationPerJobLimit`) followed
by a sentence about policy that does not say which request was too large. The
gateway names the cause it knows, tells the person what to change, and keeps
SLURM's own words after it, so that nothing is hidden and a cause not in the
table below is still shown as SLURM wrote it. Each known cause is stored as
what Anvil refused and the advice that goes with it; a caller whose page gives
its own instruction (a failed publish) asks for the first part alone.

Pure: text in, text out (tests/test_sbatch_refusal.py). The stored
`last_submit_error.code` stays `sbatch_rejected` whatever the reason.
"""

from __future__ import annotations

import re

from slurmly.exceptions import SbatchError

from app.models.job import MAX_WALLTIME_SECONDS

# Reason codes are matched whole and without regard to case, anywhere in the
# text: slurmly hands over stderr, and the code may sit on its own line or in
# front of `sbatch: error: ...`. Each entry is (codes, what was refused, advice).
_REASONS: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (
        ("QOSMaxWallDurationPerJobLimit",),
        "Anvil refused the requested run time: it is over the limit for one job "
        f"({MAX_WALLTIME_SECONDS // 3600} h).",
        "Shorten the run period or set a shorter walltime.",
    ),
    (
        ("QOSMaxCpuPerJobLimit", "QOSMaxCPUsPerUserLimit", "QOSMaxCpuPerUserLimit"),
        "Anvil refused the requested number of cores: it is over the limit.",
        "Set fewer cores.",
    ),
    (
        ("QOSMaxSubmitJobPerUserLimit", "QOSMaxJobsPerUserLimit"),
        "Anvil refused the job because too many jobs are already queued or running.",
        "Wait for some to finish, then submit again.",
    ),
    (
        ("AssocGrpCPUMinutesLimit", "AssocGrpBillingMinutes", "AssocGrpCPURunMinutesLimit"),
        "The allocation's compute-time budget is used up, so Anvil will not take another job.",
        "Contact an administrator.",
    ),
)

_PATTERNS = tuple(
    (re.compile(r"(?<![A-Za-z0-9_])(?:%s)(?![A-Za-z0-9_])" % "|".join(codes), re.IGNORECASE), what, advice)
    for codes, what, advice in _REASONS
)

# An absolute path: a `/` that starts a token (not the one in "and/or").
_PATH_RE = re.compile(r"(?<![\w/])/[^\s'\"()]+")

#: How much of SLURM's own text follows a translation: the first lines only,
#: so a long stderr (a script's output, a directory listing) is not repeated.
_QUOTE_LINES = 3
_QUOTE_CHARS = 300
#: How much of an unrecognised refusal is shown, as before this table existed.
_UNKNOWN_CHARS = 500


def _quote(detail: str) -> str:
    """The first lines of SLURM's text on one line, with any absolute path
    (the job directory sbatch was run in, say) replaced, and cut to a length."""
    lines = [line.strip() for line in detail.splitlines() if line.strip()][:_QUOTE_LINES]
    text = _PATH_RE.sub("<path>", " ".join(lines))
    text = re.sub(r"\s+", " ", text)
    if len(text) > _QUOTE_CHARS:
        text = text[: _QUOTE_CHARS - 1].rstrip() + "…"
    return text if text.endswith((".", "…")) else text + "."


def sentence(text: str) -> str:
    """`text` as a sentence that can be followed by another: a full stop is
    added unless it ends in one (or in `!`, `?`, `…`)."""
    text = text.rstrip()
    return text if text.endswith((".", "!", "?", "…")) else text + "."


def explain(detail: str, also: str = "", *, advice: bool = True) -> str:
    """The message for a refused submit, ending in a full stop, without the
    closing "Your draft is unchanged.". `detail` is what SLURM said (stderr,
    else stdout); `also` is more text to look for a reason code in, not to
    show. A reason in the table is explained, with SLURM's own words after it;
    anything else is SLURM's text as it is. `advice=False` leaves out what to
    do about a known reason, for a caller whose page says that itself."""
    searched = f"{detail}\n{also}"
    for pattern, what, advised in _PATTERNS:
        if pattern.search(searched):
            explanation = f"{what} {advised}" if advice else what
            return f"{explanation} SLURM said: {_quote(detail)}" if detail.strip() else explanation
    shown = detail.strip()
    shown = shown[: _UNKNOWN_CHARS - 1].rstrip() + "…" if len(shown) > _UNKNOWN_CHARS else shown
    return sentence(f"SLURM refused the job: {shown}" if shown else "SLURM refused the job")


def refusal_message(exc: Exception, unchanged: str = "Your draft is unchanged.", *, advice: bool = True) -> str:
    """`explain` for the exception a refused submit raised (`SbatchError` carries
    SLURM's stderr and stdout, anything else only its text), then `unchanged`."""
    detail = also = ""
    if isinstance(exc, SbatchError):
        detail = (exc.stderr or exc.stdout or "").strip()
        also = f"{exc.stderr}\n{exc.stdout}"
    explained = explain(detail or str(exc), also, advice=advice)
    return f"{sentence(explained)} {unchanged}"
