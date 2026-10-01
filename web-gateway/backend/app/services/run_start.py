"""Where a run of a snapshot may start, read before the job reaches the queue.

WBM writes the first step of a run into band 1 of an output file, so a run can
only start on the first day of a file. How much one file holds is the model's
`File_Size` (in the `.init`'s `MT_Code_Name` block): with `'year'` a run starts
on January 1, with `'month'` on the first of a month. `openghm sim run` refuses
any other start (`_check_run_start_alignment`, packages/openghm/src/openghm/
sim.py), but only once the SLURM job runs, after a queue wait. This module reads
the same rule from the snapshot's init up front, so the editor can say it and a
submit can refuse it.

The rule mirrors the toolkit's, and no more:

* `'year'` and `'month'` are rules;
* `'day'` makes every day the first day of a file, so it is no rule;
* an init with no `File_Size` key and no `Time_Series` key is `'year'`, WBM's
  default (`images/wbm-tools-lite/wbm/model/RIMS/WBM.pm` line 495,
  `set_default($MT_param{File_Size}, 'year')`);
* an init with no `File_Size` but a `Time_Series` key is left alone (an hourly
  `daily{N}` series forces `'day'` files, and monthly series were not checked),
  and so is a `File_Size` with another value or one the pattern cannot read.

What was run and what was read. A v2 job (Anvil job 20977065, `File_Size =>
'year'`, start 2000-03-01) died after the spinup creating a file at a band
greater than 1. The absent-`File_Size` rule is read from the model code, which
the v1 model shares: no v1 run was taken to the end (a v1 job started
2001-03-01 passed WBM's start-up and was in the spinup when its walltime ended).

The init is read over Anvil S3's public HTTPS, as the backend has no S3
credentials: `<S3_PUBLIC_BASE_URL>/<S3_BUCKET>/snapshots/<id>/wbm_init/<init>`,
where `<init>` is the snapshot's `simulation.init` (a path relative to
`wbm_init/`, docs/reference/metadata-format.md). A snapshot is immutable by id,
so a successful read is kept for the life of the process. A failed read is not
a rule: it answers `None`, nothing is blocked, and the read is not retried for
`_RETRY_AFTER` seconds so a page of edits does not each wait on a dead network.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from datetime import date
from typing import Literal
from urllib.parse import quote

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

#: `"year"`: a run starts on January 1. `"month"`: on the first of a month.
#: `"none"`: the init was read and sets no rule (`File_Size 'day'`, another
#: value, or no `File_Size` beside a `Time_Series` key). `None` (not in this alias): the
#: init could not be read, which is not the same as having no rule.
RunStartAlignment = Literal["year", "month", "none"]

# The toolkit's own patterns (sim.py `_FILE_SIZE_RE`, `_FILE_SIZE_KEY_RE`,
# `_TIME_SERIES_KEY_RE`), so the two cannot read one init differently.
_FILE_SIZE_RE = re.compile(r"\bFile_Size\b\s*=>\s*(?:'([^']*)'|\"([^\"]*)\")")
_FILE_SIZE_KEY_RE = re.compile(r"\bFile_Size\b\s*=>")
_TIME_SERIES_KEY_RE = re.compile(r"\bTime_Series\b\s*=>")
_ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

_READ_TIMEOUT = 5.0
_RETRY_AFTER = 60.0


def alignment_from_init(content: str) -> RunStartAlignment:
    """The run-start rule an init's `File_Size` sets; `'year'` for an init that
    sets neither `File_Size` nor `Time_Series` (WBM's default)."""
    m = _FILE_SIZE_RE.search(content)
    size = (m.group(1) if m.group(1) is not None else m.group(2)) if m else None
    if size is None and not _FILE_SIZE_KEY_RE.search(content) and not _TIME_SERIES_KEY_RE.search(content):
        size = "year"
    return size if size in ("year", "month") else "none"  # type: ignore[return-value]


@dataclass(frozen=True)
class RunStartViolation:
    """A start the rule refuses, in words a person can act on."""

    message: str
    #: The nearest start the rule allows, or None when it has no date in range.
    suggested_start: str | None


def _candidates(alignment: str, d: date) -> list[date]:
    if alignment == "year":
        return [date(d.year, 1, 1), date(d.year + 1, 1, 1)]
    nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return [date(d.year, d.month, 1), nxt]


def nearest_valid_start(
    alignment: str, start: str, lo: str | None = None, hi: str | None = None
) -> str | None:
    """The allowed start closest to `start` (the earlier one on a tie), kept
    inside `lo`..`hi` (ISO dates, the snapshot's coverage) when given. None if
    `start` is not an ISO date or nothing allowed lies in range."""
    if alignment not in ("year", "month") or not _ISO_DATE_RE.match(start):
        return None
    try:
        d = date.fromisoformat(start)
    except ValueError:
        return None
    options = [c.isoformat() for c in _candidates(alignment, d)]
    options = [c for c in options if (lo is None or c >= lo) and (hi is None or c <= hi)]
    if not options:
        return None
    return min(options, key=lambda c: abs((date.fromisoformat(c) - d).days))


_RULE_TEXT = {
    "year": "This snapshot's model writes one file per year, so a run must start on January 1.",
    "month": (
        "This snapshot's model writes one file per month, "
        "so a run must start on the first day of a month."
    ),
}


def check_run_start(
    alignment: str | None,
    start: str,
    *,
    snapshot_start: str | None = None,
    snapshot_end: str | None = None,
) -> RunStartViolation | None:
    """None when `start` may start a run, or when nothing is known to forbid it.

    A start equal to the snapshot's own is the published run's, which the
    toolkit does not re-check (it checks only a `--run-start` override), so it
    is allowed here too. A value that is not an ISO date is not this check's to
    refuse: the submit's own date check does that."""
    if alignment not in ("year", "month") or not _ISO_DATE_RE.match(start):
        return None
    if start == snapshot_start:
        return None
    try:
        d = date.fromisoformat(start)
    except ValueError:
        return None
    ok = d.day == 1 and (alignment == "month" or d.month == 1)
    if ok:
        return None
    suggested = nearest_valid_start(alignment, start, snapshot_start, snapshot_end)
    text = _RULE_TEXT[alignment]
    if suggested:
        text += f" Start on {suggested} instead."
    return RunStartViolation(message=text, suggested_start=suggested)


# ---------------------------------------------------------------------------
# Reading the init
# ---------------------------------------------------------------------------

#: (snapshot id, init) -> rule. Only successful reads: immutable by id.
_rules: dict[tuple[str, str], RunStartAlignment] = {}
#: (snapshot id, init) -> monotonic time of the last failed read.
_failed_at: dict[tuple[str, str], float] = {}


def reset() -> None:
    """Forget what was read (tests)."""
    _rules.clear()
    _failed_at.clear()


def init_url(snapshot_id: str, init: str) -> str:
    base = settings.S3_PUBLIC_BASE_URL.rstrip("/")
    return f"{base}/{settings.S3_BUCKET}/snapshots/{snapshot_id}/wbm_init/{quote(init)}"


async def _fetch_init(url: str) -> str:
    async with httpx.AsyncClient(timeout=_READ_TIMEOUT, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.text


async def run_start_alignment(snapshot: dict, snapshot_id: str) -> RunStartAlignment | None:
    """The run-start rule of a snapshot (its catalogue `document`), or None when
    its init cannot be read: no `simulation.init`, or the S3 read failed."""
    init = (snapshot.get("simulation") or {}).get("init")
    if not isinstance(init, str) or not init:
        return None
    key = (snapshot_id, init)
    if key in _rules:
        return _rules[key]
    failed = _failed_at.get(key)
    if failed is not None and time.monotonic() - failed < _RETRY_AFTER:
        return None
    url = init_url(snapshot_id, init)
    try:
        content = await _fetch_init(url)
    except Exception as exc:  # network, HTTP status, decoding: all mean "could not check"
        logger.warning("Could not read %s to find its run-start rule: %s", url, exc)
        _failed_at[key] = time.monotonic()
        return None
    _failed_at.pop(key, None)
    _rules[key] = alignment_from_init(content)
    return _rules[key]

