"""What a snapshot's init asks of a simulation's dates, read before the job reaches the
queue: where a simulation may start, and the multi-year aggregation window the simulation
must reach (`check_run_dates`).

WBM writes the first step of a simulation into band 1 of an output file, so a simulation can
only start on the first day of a file. How much one file holds is the model's
`File_Size` (in the `.init`'s `MT_Code_Name` block): with `'year'` a simulation starts
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

The aggregation window. With `TA_multi_year_start` and `TA_multi_year_timestep`
both set in the init's `PostProcessing` block, WBM stops at start-up unless that
year lies inside the simulation: `post_processing` in
`images/wbm-tools-lite/wbm/model/RIMS/WBM.pm` (line 4279) dies with "Aggregation
multi-year start is outside of the run dates..." when the year is before the
run's first year or after its last complete year (the year of `Run_End`, one
less unless it is a December 31). The `Run` flag does not matter: Anvil job
21016198 had `Run => 0` and died of it. So a simulation must start in or before that
year and end on or after its December 31. This lives in the init and nowhere in
the snapshot's metadata (`simulation` leaves `PostProcessing` out,
docs/reference/metadata-format.md), hence this read. Only a date that differs
from the snapshot's own is held to it: the published simulation passed, and the
toolkit (`_check_run_dates_vs_aggregation`) checks overrides only. A December 30
end is let through: a 360-day calendar counts it as a year's last day, and the
calendar is the forcing data's, not the init's, so WBM has the last word.

The post-processing choice. The same read gives `post_processing`, what the
init's `PostProcessing => { Run => … }` block asks WBM for: `"none"` when the init
has no such block or the block has no `Run` of its own (a toolkit flag cannot
change what is not there), `"standard"` when `Run` is false in Perl's sense (`0`,
`'0'`, `''`), `"climatology"` when it is true. Only the block's own top-level
`Run` counts, never `Run_Start`/`Run_End` or a `Run` in a nested hash. The same
block gives `post_processing_settings`, what it sets (`Run`, `Temporal_Aggregation`,
`Climatology`, the multi-year pair, `Polygon_Aggregation`, `Forks`), each from its
top-level key as `PostProcessing.pl` reads it. The backend does not import the toolkit, so `post_processing_from_init` is a compact
reader of its own; `openghm.post_processing.requested_run_value` is the toolkit's,
and both are tested on the same real inits (tests/test_post_processing.py).

The init is read over Anvil S3's public HTTPS, as the backend has no S3
credentials: `<S3_PUBLIC_BASE_URL>/<S3_BUCKET>/snapshots/<id>/wbm_init/<init>`,
where `<init>` is the snapshot's `simulation.init` (a path relative to
`wbm_init/`, docs/reference/metadata-format.md). A snapshot is immutable by id,
so a successful read is kept for the life of the process, as text (`read_init_text`),
which the rules and the model parameters (`app.wbm_init`) both read. A failed read is not
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

#: What a snapshot's init asks of WBM's post-processing (see the module docstring).
PostProcessing = Literal["none", "standard", "climatology"]

#: `"year"`: a simulation starts on January 1. `"month"`: on the first of a month.
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
# The toolkit's `_PERL_VALUE`: a quoted value, or a bare one up to `,`, `}` or the end of the line.
_PERL_VALUE = r"(?:'([^']*)'|\"([^\"]*)\"|([^,}\n]+))"

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


def _perl_scalar(content: str, key: str) -> str | None:
    """The first `key => value` of a Perl-hash init, unquoted; None when absent
    (the toolkit's `_perl_scalar`)."""
    m = re.search(rf"\b{re.escape(key)}\b\s*=>\s*{_PERL_VALUE}", content)
    if m is None:
        return None
    quoted = m.group(1) if m.group(1) is not None else m.group(2)
    return (quoted if quoted is not None else m.group(3)).strip()


def aggregation_start_year_from_init(content: str) -> int | None:
    """The year multi-year aggregation starts in, when the init sets one WBM
    acts on: both `TA_multi_year_start` and `TA_multi_year_timestep` set (Perl
    false is `''` and `'0'`), and the start a plain four-digit year. None
    otherwise: no window, or one this reader does not understand."""
    first = _perl_scalar(content, "TA_multi_year_start")
    step = _perl_scalar(content, "TA_multi_year_timestep")
    if not first or first == "0" or not step or step == "0" or not re.fullmatch(r"\d{4}", first):
        return None
    return int(first)


_PP_BLOCK_RE = re.compile(r"""(?<!\w)(?:(['"])PostProcessing\1|PostProcessing)\s*=>\s*\{""")
# A Perl scalar: quoted, or bare up to `,`, `}`, `#` or the end of the line (possibly empty).
_PP_VALUE_RE = re.compile(r"""'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[^,}\n#]*""")


def _is_perl_true(literal: str) -> bool:
    """Perl's truth of a `Run` literal: false for `0`, `'0'`, `''`, `""`, nothing and `undef`."""
    s = literal.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"":
        return s[1:-1] not in ("", "0")
    if s in ("", "undef"):
        return False
    try:
        return float(s) != 0
    except ValueError:
        return True


_PP_KEYS = (
    "Run",
    "Temporal_Aggregation",
    "Climatology",
    "TA_multi_year_start",
    "TA_multi_year_timestep",
    "Polygon_Aggregation",
    "Forks",
)
_PP_KEY_RES = {
    key: re.compile(rf"""(?:(['"]){key}\1|(?<![\w$@%]){key}(?!\w))\s*=>\s*""") for key in _PP_KEYS
}


def _pp_block(content: str) -> dict[str, str] | None:
    """The first uncommented `PostProcessing => { … }` block of the init, as the
    raw literal of each of its own top-level keys in `_PP_KEYS` (the first of each; a
    hash value reads as `{…`). The block is read brace-balanced, skipping quoted
    strings and `#` comments, and only a key at the block's own depth counts. None
    when there is no block or its braces do not balance. Total: any text answers."""
    for block in _PP_BLOCK_RE.finditer(content):
        line_start = content.rfind("\n", 0, block.start()) + 1
        if content[line_start:block.start()].lstrip().startswith("#"):
            continue
        depth, quote, i, n, found = 0, None, block.end(), len(content), {}
        while i < n:
            c = content[i]
            if quote:
                if c == "\\":
                    i += 2
                    continue
                if c == quote:
                    quote = None
            elif c == "#":
                j = content.find("\n", i)
                i = n if j == -1 else j
                continue
            elif c == "}" and depth == 0:
                return found  # the block's own closing brace
            else:
                if depth == 0:
                    for name, pattern in _PP_KEY_RES.items():
                        if name not in found and (key := pattern.match(content, i)):
                            value = _PP_VALUE_RE.match(content, key.end())
                            found[name] = value.group(0) if value else ""
                            break
                if c in "'\"":
                    quote = c
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
            i += 1
        return None  # the braces do not balance
    return None


def post_processing_from_init(content: str) -> PostProcessing:
    """What the init's `PostProcessing` block asks for: `"none"` without a block
    or a `Run` of its own in it (or with unbalanced braces), else `"climatology"`
    when `Run` is true in Perl's sense and `"standard"` when it is not. Total: any
    text at all answers rather than raising."""
    block = _pp_block(content)
    if block is None or "Run" not in block:
        return "none"
    return "climatology" if _is_perl_true(block["Run"]) else "standard"


@dataclass(frozen=True)
class PostProcessingSettings:
    """What the init's `PostProcessing` block sets, as `PostProcessing.pl` reads each key
    (images/wbm-tools-lite/wbm/model/RIMS/WBM.pm, `PostProcessing`). Each field is the
    key's own value; whether it takes effect (climatology needs temporal aggregation,
    multi-year needs climatology) is for the reader to derive."""

    #: `Run` is true in Perl's sense: WBM post-processes after the simulation.
    run: bool
    #: `Temporal_Aggregation` is true: daily to monthly to yearly files.
    temporal_aggregation: bool
    #: `Climatology`, WBM's `set_default` of it: 1 when the init does not say.
    climatology: bool
    #: `Climatology` is absent or empty, so `climatology` is the default rather than the init's word.
    climatology_default: bool
    #: `(start year, step in years)` when both `TA_multi_year_start` and
    #: `TA_multi_year_timestep` are set, whatever `climatology` says.
    multi_year: tuple[int, int] | None
    #: `Polygon_Aggregation` is set (true in Perl's sense).
    polygon_aggregation: bool
    #: `Forks` as an integer; None when the init does not set it (WBM's default is 8).
    forks: int | None


def _perl_int(literal: str) -> int:
    """Perl's `int` of a scalar literal: its leading number, else 0."""
    s = literal.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"":
        s = s[1:-1].strip()
    m = re.match(r"[-+]?(?:\d+\.?\d*|\.\d+)", s)
    return int(float(m.group(0))) if m else 0


def _unquoted(literal: str) -> str:
    s = literal.strip()
    return s[1:-1].strip() if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"" else s


def post_processing_settings_from_init(content: str) -> PostProcessingSettings | None:
    """The block's settings as it reads them. None when `post_processing_from_init`
    says `"none"`: no block, no `Run`, or an unreadable init."""
    block = _pp_block(content)
    if block is None or "Run" not in block:
        return None
    clim = block.get("Climatology", "")
    climatology_default = not _unquoted(clim)
    first = _unquoted(block.get("TA_multi_year_start", ""))
    step = _unquoted(block.get("TA_multi_year_timestep", ""))
    multi_year = None
    if re.fullmatch(r"\d{4}", first) and re.fullmatch(r"\d+", step) and int(step) > 0:
        multi_year = (int(first), int(step))
    forks = block.get("Forks", "")
    return PostProcessingSettings(
        run=_is_perl_true(block["Run"]),
        temporal_aggregation=_is_perl_true(block.get("Temporal_Aggregation", "")),
        # WBM's `set_default`: an absent or empty value is the default, 1.
        climatology=climatology_default or _perl_int(clim) != 0,
        climatology_default=climatology_default,
        multi_year=multi_year,
        polygon_aggregation=_is_perl_true(block.get("Polygon_Aggregation", "")),
        forks=_perl_int(forks) if _unquoted(forks) else None,
    )


@dataclass(frozen=True)
class InitRules:
    """What a snapshot's init asks of a simulation's dates and post-processing, as read."""

    alignment: RunStartAlignment
    #: The year multi-year aggregation starts in; None when the init sets none.
    aggregation_start_year: int | None
    #: What the init's `PostProcessing => { Run => … }` asks for.
    post_processing: PostProcessing = "none"
    #: What the init's `PostProcessing` block sets; None when `post_processing` is `"none"`.
    post_processing_settings: PostProcessingSettings | None = None


def rules_from_init(content: str) -> InitRules:
    return InitRules(
        alignment_from_init(content),
        aggregation_start_year_from_init(content),
        post_processing_from_init(content),
        post_processing_settings_from_init(content),
    )


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
    "year": "This snapshot's model writes one file per year, so a simulation must start on January 1.",
    "month": (
        "This snapshot's model writes one file per month, "
        "so a simulation must start on the first day of a month."
    ),
}


def check_run_start(
    alignment: str | None,
    start: str,
    *,
    snapshot_start: str | None = None,
    snapshot_end: str | None = None,
) -> RunStartViolation | None:
    """None when `start` may start a simulation, or when nothing is known to forbid it.

    A start equal to the snapshot's own is the published simulation's, which the
    toolkit does not re-check (it checks only a `MT_Code_Name.Run_Start` change), so it
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


@dataclass(frozen=True)
class RunDatesViolation:
    """Run dates the aggregation window refuses, in words a person can act on."""

    #: The refusal in full, one sentence per date that breaks the window.
    message: str
    #: The aggregation's first year.
    aggregation_start_year: int
    #: The latest start the window allows, and the earliest end.
    latest_start: str
    earliest_end: str
    #: Which of the two dates break it: "start", "end" or both.
    fields: tuple[str, ...]


def aggregation_messages(
    year: int, *, snapshot_start: str | None = None, snapshot_end: str | None = None
) -> dict[str, str]:
    """The sentence for a start that is too late and for an end that is too
    early, each naming the allowed range inside the snapshot's coverage. The
    browser words them the same (`lib/jobs/aggregation-window.ts`)."""
    edge = f"{year:04d}-12-31"
    lead = (
        "This snapshot's model also aggregates its results over multi-year "
        f"periods that begin in {year}, so"
    )
    # When the range is one date, say that date rather than "X to X".
    if snapshot_start and snapshot_start <= edge:
        start_text = (
            f"a simulation must start on {edge}"
            if snapshot_start == edge
            else f"a simulation can start no later than {edge} (allowed: {snapshot_start} to {edge})"
        )
    else:
        start_text = f"a simulation can start no later than {edge}"
    if snapshot_end and edge <= snapshot_end:
        end_text = (
            f"a simulation must end on {edge}"
            if snapshot_end == edge
            else f"a simulation must end on or after {edge} (allowed: {edge} to {snapshot_end})"
        )
    else:
        end_text = f"a simulation must end on or after {edge}"
    return {"start": f"{lead} {start_text}.", "end": f"{lead} {end_text}."}


def check_run_dates(
    aggregation_start_year: int | None,
    start: str,
    end: str,
    *,
    snapshot_start: str | None = None,
    snapshot_end: str | None = None,
) -> RunDatesViolation | None:
    """None when the dates satisfy the aggregation window, or when nothing is
    known to forbid them. A date equal to the snapshot's own is the published
    run's and passes, as in the toolkit; a value that is not an ISO date is the
    date check's to refuse."""
    if aggregation_start_year is None:
        return None
    edge = f"{aggregation_start_year:04d}-12-31"
    fields: list[str] = []
    if _ISO_DATE_RE.match(start) and start != snapshot_start and int(start[:4]) > aggregation_start_year:
        fields.append("start")
    # December 30 is let through: a 360-day calendar's last day (see the module docstring).
    if (
        _ISO_DATE_RE.match(end)
        and end != snapshot_end
        and end < f"{aggregation_start_year:04d}-12-30"
    ):
        fields.append("end")
    if not fields:
        return None
    sentences = aggregation_messages(
        aggregation_start_year, snapshot_start=snapshot_start, snapshot_end=snapshot_end
    )
    return RunDatesViolation(
        message=" ".join(sentences[f] for f in fields),
        aggregation_start_year=aggregation_start_year,
        latest_start=edge,
        earliest_end=edge,
        fields=tuple(fields),
    )


# ---------------------------------------------------------------------------
# Reading the init
# ---------------------------------------------------------------------------

#: (snapshot id, init) -> the init's text. Only successful reads: immutable by id.
_texts: dict[tuple[str, str], str] = {}
#: (snapshot id, init) -> rules, derived from `_texts`.
_rules: dict[tuple[str, str], InitRules] = {}
#: (snapshot id, init) -> monotonic time of the last failed read.
_failed_at: dict[tuple[str, str], float] = {}


def reset() -> None:
    """Forget what was read (tests)."""
    _texts.clear()
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


async def read_init_text(snapshot: dict, snapshot_id: str) -> str | None:
    """The text of a snapshot's init (its catalogue `document`), the one cached read every
    consumer shares (the run-date rules, the model parameters). None when it cannot be read:
    no `simulation.init`, or the S3 read failed."""
    init = (snapshot.get("simulation") or {}).get("init")
    if not isinstance(init, str) or not init:
        return None
    key = (snapshot_id, init)
    if key in _texts:
        return _texts[key]
    failed = _failed_at.get(key)
    if failed is not None and time.monotonic() - failed < _RETRY_AFTER:
        return None
    url = init_url(snapshot_id, init)
    try:
        content = await _fetch_init(url)
    except Exception as exc:  # network, HTTP status, decoding: all mean "could not check"
        logger.warning("Could not read %s: %s", url, exc)
        _failed_at[key] = time.monotonic()
        return None
    _failed_at.pop(key, None)
    _texts[key] = content
    return content


async def read_init_rules(snapshot: dict, snapshot_id: str) -> InitRules | None:
    """The rules of a snapshot (its catalogue `document`), or None when its init
    cannot be read: no `simulation.init`, or the S3 read failed."""
    init = (snapshot.get("simulation") or {}).get("init")
    key = (snapshot_id, init)
    if isinstance(init, str) and key in _rules:
        return _rules[key]
    content = await read_init_text(snapshot, snapshot_id)
    if content is None:
        return None
    _rules[key] = rules_from_init(content)
    return _rules[key]


async def run_start_alignment(snapshot: dict, snapshot_id: str) -> RunStartAlignment | None:
    """The run-start rule of a snapshot, or None when its init cannot be read."""
    rules = await read_init_rules(snapshot, snapshot_id)
    return rules.alignment if rules else None
