"""The checks across a draft's parameters, run before a submit (the tree's `cross_rules`).

`wbm.pl -test` is a cheap first check and not a complete one: it passes a dataset that ends too
early and a Msk output without a `Runoff_mask` block, and the real run then dies, after the queue
wait and possibly months of simulated time. This module evaluates the rules of
`param_tree.yaml` before the job is sent, on the run as it will be: the snapshot's init with the
draft's changes applied (`effective_run`), and the files of the snapshot's model input
(`model_input`).

* `check` is the one call: it returns the `Finding`s, one per failed rule, with the level the tree
  gives the rule. An `error` refuses a submit, a `warn` or `info` is shown.
* Every rule id of the tree is in `EVALUATORS` (a function of the run), in `FILE_RULES` (a function
  that reads files of the model input) or in `NOT_EVALUATED` (the reason it is not);
  `tests/test_wbm_cross_rules.py` fails when one is in none.
* Dataset file coverage (`dataset_file_coverage`) is the rule that reads the most of the model
  input. It judges the files that exist, never what the model input's metadata or a data init
  declares: the published model inputs declare more than they hold.
* When the model input cannot be read the other rules still run, and coverage is reported as not
  checked, a warning: a bucket that is down does not refuse a submit.

The rule functions are pure: they take a `Ctx` and return `Issue`s, so each is tested without a
network. Where the evidence for a rule is (a measurement, a line of WBM) is in
docs/reference/wbm-init.md section 12.
"""

from __future__ import annotations

import calendar
import copy
import logging
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Awaitable, Callable, Iterable, Mapping, NamedTuple

from app.models.job import JobParameters
from app.services import job_script, model_parameters
from app.wbm_init import model_input, reader, tree, validate

logger = logging.getLogger(__name__)

#: The init keys of the dates a draft sets (a finding that names one is shown beside that date).
RUN_START = "MT_Code_Name.Run_Start"
RUN_END = "MT_Code_Name.Run_End"
SPINUP_START = "Spinup.Start"
SPINUP_END = "Spinup.End"


class Issue(NamedTuple):
    """What is wrong, in plain sentences, and the init key paths it concerns: a path of a field of
    the draft (`MT_Code_Name.Run_End`) lets the wizard show the message beside that field."""

    message: str
    paths: tuple[str, ...] = ()


@dataclass(frozen=True)
class Finding:
    """One failed rule: `rule` is the tree's id, `level` the tree's level for it, `paths` the init
    key paths it concerns, `message` plain sentences, one per thing wrong."""

    rule: str
    level: str
    message: str
    paths: tuple[str, ...] = ()


# ---------------------------------------------------------------------------
# The run as it will be
# ---------------------------------------------------------------------------

_NUMBER_RE = re.compile(r"^[-+]?\d+(\.\d*)?([eE][-+]?\d+(\.\d*)?)?$")
_ISO_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

#: A top-level init key that holds a block file when it is a path: `Reservoirs => '/wbm/...init'`.
_BLOCK_FILE_SUFFIX = ".init"
#: A plain string that stands for a key of its block: `PET => 'Hamon'` is `PET.method`.
_STRING_BLOCKS = {"PET": "method", "Routing": "method"}


@dataclass(frozen=True)
class Run:
    """The run the draft asks for, before anything is read from the model input."""

    version: str
    resolved: tree.Resolved
    #: The init as nested dicts of strings, the draft's changes applied.
    values: dict
    #: The output variable names, in order, each once.
    outputs: tuple[str, ...]
    #: The init key paths the draft changed.
    changed: frozenset[str]


def _fmt_number(value: float) -> str:
    return format(value, "g")


def apply_changes(values: dict, changes: Mapping[str, object]) -> dict:
    """A copy of `values` with `changes` (init key path -> value) set as the toolkit's editor
    sets them: a missing block is made, a plain string that stands for a block (`PET => 'Hamon'`)
    becomes the block holding it as its `method`, a number is its text."""
    out = copy.deepcopy(values)
    for path, value in changes.items():
        text = _fmt_number(value) if isinstance(value, float) else str(value)
        *parents, last = path.split(".")
        node = out
        for name in parents:
            child = node.get(name)
            if not isinstance(child, dict):
                child = {_STRING_BLOCKS[name]: child} if name in _STRING_BLOCKS and child else {}
                node[name] = child
            node = child
        node[last] = text
    return out


def output_names(text: str) -> tuple[str, ...]:
    """The names of an `Output_vars` string, as WBM reads it: whitespace-separated, each once."""
    return tuple(dict.fromkeys(text.split()))


def effective_run(
    snapshot: dict, loaded: model_parameters.Loaded, parameters: JobParameters
) -> Run:
    """The snapshot's init with the draft's changes applied: the period, the output variables, the
    post-processing choice and the custom parameters. A value equal to the snapshot's own is not a
    change (`job_script.run_overrides` leaves it out of the changes file too). The draft is not
    validated here: a date that is not a date, or a custom parameter the tree refuses, is
    something the submit's own checks say; this applies what it can and the rules judge the rest."""
    defaults = job_script.snapshot_defaults(snapshot)
    changes: dict[str, object] = {}
    kept = validate.drop_unchanged(parameters.custom_params or {}, loaded.resolved, loaded.values)
    refused = validate.validate(
        kept, loaded.resolved, loaded.values, parameters.variables, loaded.choices
    )
    changes.update(
        validate.typed_changes(
            {p: v for p, v in kept.items() if p not in refused}, loaded.resolved, loaded.values
        )
    )
    if parameters.temporal_range_start and parameters.temporal_range_start != defaults.temporal_range_start:
        changes[RUN_START] = parameters.temporal_range_start
    if parameters.temporal_range_end and parameters.temporal_range_end != defaults.temporal_range_end:
        changes[RUN_END] = parameters.temporal_range_end
    if parameters.variables and parameters.variables != defaults.variables:
        changes[job_script.OUTPUT_VARS_KEY] = " ".join(parameters.variables)
    own_pp = reader.lookup(loaded.values, "PostProcessing")
    if parameters.post_processing is not None and isinstance(own_pp, dict) and own_pp:
        changes[job_script.POST_PROCESSING_KEY] = 1 if parameters.post_processing == "climatology" else 0
    values = apply_changes(loaded.values, changes)
    outputs = output_names(values.get(job_script.OUTPUT_VARS_KEY) or "")
    return Run(loaded.code_version, loaded.resolved, values, outputs, frozenset(changes))


# ---------------------------------------------------------------------------
# What the rules see
# ---------------------------------------------------------------------------


@dataclass
class Ctx:
    """The run, with the files the rules need read from the model input."""

    run: Run
    #: `run.values` with each block file (`Reservoirs => '/wbm/data_init/dams/x.init'`) replaced by
    #: the block it holds, so a rule reads `Reservoirs.File` whichever way the init writes it.
    values: dict
    #: The data inits and block files the run reads, by the path the init writes for them.
    inits: dict[str, model_input.InitFile] = field(default_factory=dict)
    #: The container path of a file the run reads that cannot be read -> why, as a sentence.
    problems: dict[str, str] = field(default_factory=dict)
    #: The top-level keys the init writes as the path of a block file -> that path.
    blocks: dict[str, str] = field(default_factory=dict)
    #: The data inits that the crop parameter tables name, one `Target` per cell.
    tables: list[Target] = field(default_factory=list)

    @property
    def outputs(self) -> tuple[str, ...]:
        return self.run.outputs

    def get(self, path: str):
        return reader.lookup(self.values, path)

    def text(self, path: str) -> str:
        """The key's text; empty when it is absent or holds a block."""
        value = self.get(path)
        return value if isinstance(value, str) else ""

    def method(self, key: str) -> str:
        """`PET` or `Routing` as WBM reads it: the string, or the block's `method`."""
        value = self.get(key)
        if isinstance(value, dict):
            inner = value.get("method")
            return inner if isinstance(inner, str) else ""
        return value or ""

    def filled(self, path: str) -> bool:
        """Whether the key holds something: not absent, `''`, `0` or an empty block."""
        return tree.filled(self.get(path))

    def unread(self, path: str) -> bool:
        """Whether the key is inside a block that the init writes as a file path and that could not
        be read, so what the block holds is not known and a rule about it says nothing (the
        coverage rule says the file is missing)."""
        return tree.block_is_file(path, self.values)

    def on(self, module: str) -> bool:
        """Whether a module of the init is on. The raw init decides: a block file counts."""
        return tree.module_state(module, self.run.values) == "on"

    def dataset(self, path: str) -> model_input.InitFile | None:
        """The data init the field at `path` names, when the run reads it and it could be read."""
        kind = _classify(self.text(path))
        return self.inits.get(kind[1]) if kind and kind[0] == "init" else None

    def label(self, path: str) -> str:
        node = self.run.resolved.fields.get(path)
        return f"{node.label} ({path})" if node and node.label else path

    def outputs_with(self, *suffixes: str) -> list[str]:
        return [n for n in self.outputs if n.endswith(suffixes)]


def _classify(value: str) -> tuple[str, str] | None:
    """How a run init's value for a dataset or file field is read: `("init", path)` for a data
    `.init`, `("file", path)` for a raster or table (a `NETCDF:<file>:<layer>` is its file),
    None for what has no file to look for: empty, a constant number, a path with a template
    token, a folder, a Magic-Table ID."""
    text = value.strip()
    if not text or _NUMBER_RE.match(text):
        return None
    if text.upper().startswith("NETCDF:"):
        pieces = text.split(":")
        return ("file", pieces[1]) if len(pieces) == 3 and pieces[1] else None
    if re.search(r"_(YEAR|MONTH|DAY|HOUR|MIN)_", text) or not text.startswith("/"):
        return None
    if text.endswith(_BLOCK_FILE_SUFFIX):
        return "init", text
    if "." not in text.rsplit("/", 1)[-1]:
        return None  # a folder: `/wbm/data/dams`
    return "file", text


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------


def _date(text: str) -> date | None:
    """A real `YYYY-MM-DD`, else None."""
    m = _ISO_RE.match(text)
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        return None


def _run_date(text: str) -> tuple[date, bool] | None:
    """A run date and whether it is a monthly one (`YYYY-MM-00`: WBM's monthly time series), else None."""
    m = _ISO_RE.match(text)
    if m and m[3] == "00":
        try:
            return date(int(m[1]), int(m[2]), 1), True
        except ValueError:
            return None
    found = _date(text)
    return (found, False) if found else None


def _end_of_month(d: date) -> date:
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def _int(text: str) -> int:
    """WBM's `int` of a number's text; 0 when it is not one (`Loops => 'x'` counts as 0)."""
    return int(float(text)) if _NUMBER_RE.match(text) else 0


@dataclass(frozen=True)
class Span:
    """A stretch of dates the run reads, and the init keys that set its two ends."""

    start: date
    end: date
    start_path: str
    end_path: str


@dataclass(frozen=True)
class Window:
    """The dates a run reads its datasets on: each spin-up loop reads `Spinup.Start` to
    `Spinup.End` (RIMS/WBM.pm add_spinup_dates, M:4147-4172), and the run reads `Run_Start` (else
    `Spinup.Start`) to `Run_End` (else the end of the air temperature dataset, M:492, 507)."""

    #: The spin-up span first when there is one, then the run's.
    spans: tuple[Span, ...]
    #: A monthly run (`YYYY-MM-00`, or `Time_Series => monthly`) reads one date per month.
    monthly: bool
    #: A sub-daily run (`daily{N}`).
    hourly: bool
    #: `MT_Code_Name.Calendar` 365: no February 29.
    no_leap: bool

    def dates(self) -> list[date]:
        """Every date read, in order, each once."""
        seen: set[date] = set()
        for span in self.spans:
            d = span.start
            while d <= span.end:
                if not (self.no_leap and d.month == 2 and d.day == 29):
                    seen.add(d)
                d = date(d.year + (d.month == 12), d.month % 12 + 1, 1) if self.monthly else d + timedelta(days=1)
        return sorted(seen)

    def span_of(self, d: date) -> Span:
        return next((s for s in self.spans if s.start <= d <= s.end), self.spans[-1])

    @property
    def run(self) -> Span:
        return self.spans[-1]


def window_of(ctx: Ctx, airt_end: str = "") -> Window | None:
    """The window of the run, or None when its dates cannot be told (the date rules say why)."""
    start_path = RUN_START if ctx.text(RUN_START) else SPINUP_START
    start = _run_date(ctx.text(start_path))
    end_text, end_path = ctx.text(RUN_END), RUN_END
    if not end_text:
        end_text, end_path = airt_end, "MT_airT.Primary"
    end = _run_date(end_text)
    if start is None or end is None or start[0] > end[0]:
        return None
    series = ctx.text("MT_Code_Name.Time_Series")
    monthly = start[1] or series.startswith("monthly")
    spans = [Span(start[0], end[0], start_path, end_path)]
    if _int(ctx.text("Spinup.Loops")) > 0:
        sp_start, sp_end = _date(ctx.text(SPINUP_START)), _date(ctx.text(SPINUP_END))
        if sp_start and sp_end:
            sp_start = sp_start.replace(day=1)
            if sp_start <= _end_of_month(sp_end):
                spans.insert(0, Span(sp_start, _end_of_month(sp_end), SPINUP_START, SPINUP_END))
    return Window(
        tuple(spans),
        monthly,
        "daily{" in series,
        ctx.text("MT_Code_Name.Calendar") == "365",
    )


# ---------------------------------------------------------------------------
# The rules that need no file
# ---------------------------------------------------------------------------

Evaluator = Callable[[Ctx], Iterable[Issue]]

#: rule id -> its evaluator. The rules that read the model input's files are `FILE_RULES`, below.
EVALUATORS: dict[str, Evaluator] = {}

#: rule id -> why it is not evaluated. A draft today changes the period, the outputs, the
#: post-processing choice, scalar parameters and can switch a module off; a rule here concerns
#: none of those, or needs what the tree does not hold.
NOT_EVALUATED: dict[str, str] = {
    "output_dir_absolute": (
        "The output directory and the run id are set by the gateway and the toolkit (the toolkit "
        "rewrites `Output_dir` to the run's own folder), and a draft cannot change them."
    ),
}


def rule(rule_id: str) -> Callable[[Evaluator], Evaluator]:
    def register(fn: Evaluator) -> Evaluator:
        EVALUATORS[rule_id] = fn
        return fn

    return register


def _where_start(ctx: Ctx) -> str:
    return RUN_START if ctx.text(RUN_START) else SPINUP_START


@rule("run_start_or_spinup_start")
def _run_start_or_spinup_start(ctx: Ctx) -> Iterable[Issue]:
    path = _where_start(ctx)
    start = ctx.text(path)
    if not start:
        yield Issue(
            "The run has no start date: set the run start, or the spin-up start.",
            (RUN_START, SPINUP_START),
        )
    elif _run_date(start) is None:
        yield Issue(f"The run start {start!r} is not a date written YYYY-MM-DD.", (path,))


@rule("run_end_airT")
def _run_end_air_t(ctx: Ctx) -> Iterable[Issue]:
    if not ctx.text(RUN_END) and not ctx.text("MT_airT.Primary"):
        yield Issue(
            "The run has no end date, and WBM then ends it where the air temperature dataset "
            "ends, which needs a mean air temperature dataset (a minimum and maximum pair is not "
            "enough). Set the run end.",
            (RUN_END, "MT_airT.Primary"),
        )


def _airt_end(ctx: Ctx) -> str:
    init = ctx.dataset("MT_airT.Primary")
    return init.get("End_Date") if init else ""


@rule("run_start_before_end")
def _run_start_before_end(ctx: Ctx) -> Iterable[Issue]:
    start = _run_date(ctx.text(_where_start(ctx)))
    end_text = ctx.text(RUN_END) or _airt_end(ctx)
    if ctx.text(RUN_END) and _run_date(end_text) is None:
        yield Issue(f"The run end {end_text!r} is not a date written YYYY-MM-DD.", (RUN_END,))
        return
    end = _run_date(end_text)
    # Equal dates are one day of run, which WBM builds (a list of one date), and which the
    # submit's own period check (`job_script.run_overrides`) allows.
    if start and end and start[0] > end[0]:
        yield Issue(
            f"The run starts on {start[0]} but ends on {end[0]}: the start must not be after the end.",
            (_where_start(ctx), RUN_END),
        )


@rule("spinup_loops_dates")
def _spinup_loops_dates(ctx: Ctx) -> Iterable[Issue]:
    if _int(ctx.text("Spinup.Loops")) <= 0:
        return
    start, end = ctx.text(SPINUP_START), ctx.text(SPINUP_END)
    if not (start and end):
        yield Issue(
            "The spin-up repeats a period, so it needs the spin-up start and end dates.",
            (SPINUP_START, SPINUP_END),
        )
        return
    s, e = _date(start), _date(end)
    if s is None or e is None:
        bad = start if s is None else end
        yield Issue(f"The spin-up date {bad!r} is not a date written YYYY-MM-DD.", (SPINUP_START if s is None else SPINUP_END,))
    elif s.replace(day=1) > _end_of_month(e):
        yield Issue(
            f"The spin-up starts on {s} but ends on {e}: the start must be before the end.",
            (SPINUP_START, SPINUP_END),
        )


@rule("calendar_not_360")
def _calendar_not_360(ctx: Ctx) -> Iterable[Issue]:
    if ctx.text("MT_Code_Name.Calendar") == "360":
        yield Issue(
            "WBM accepts the 360-day calendar and then stops, since it is not coded for it. "
            "Use the standard calendar.",
            ("MT_Code_Name.Calendar",),
        )


def _monthly_run(ctx: Ctx) -> bool:
    series = ctx.text("MT_Code_Name.Time_Series")
    if series:
        return series.startswith("monthly")
    start = ctx.text(_where_start(ctx))
    return start.endswith("-00")


@rule("file_size_day_monthly")
def _file_size_day_monthly(ctx: Ctx) -> Iterable[Issue]:
    if ctx.text("MT_Code_Name.File_Size") == "day" and _monthly_run(ctx):
        yield Issue(
            "A monthly run cannot write one file per day: choose a file size of month or year.",
            ("MT_Code_Name.File_Size", "MT_Code_Name.Time_Series"),
        )


@rule("network_routing")
def _network_routing(ctx: Ctx) -> Iterable[Issue]:
    network = ctx.text("Network")
    if not network:
        yield Issue("The run has no river network file.", ("Network",))
    elif network.endswith(_BLOCK_FILE_SUFFIX):
        yield Issue("The river network must be a raster file, not a data .init.", ("Network",))
    if not ctx.filled("Routing"):
        yield Issue("The run has no routing: WBM requires it.", ("Routing",))


@rule("precip_fraction_pairing")
def _precip_fraction_pairing(ctx: Ctx) -> Iterable[Issue]:
    precip = ctx.dataset("MT_Precip.Primary")
    if precip is None:
        return
    series = precip.get("Time_Series")
    if series.startswith("monthly") and not ctx.filled("precipFraction"):
        yield Issue(
            "The precipitation is monthly, so WBM needs a daily fraction of it (precipFraction).",
            ("MT_Precip.Primary", "precipFraction"),
        )
    elif series.startswith("daily") and ctx.text("precipFraction"):
        yield Issue(
            "The precipitation is daily, so WBM stops when precipFraction is set: it is only for "
            "monthly precipitation.",
            ("MT_Precip.Primary", "precipFraction"),
        )


@rule("precip_units")
def _precip_units(ctx: Ctx) -> Iterable[Issue]:
    precip = ctx.dataset("MT_Precip.Primary")
    if precip is None:
        return
    units = precip.get("Units")
    monthly = precip.get("Time_Series").startswith("monthly")
    if monthly and not re.match(r"mm/m", units, re.I):
        yield Issue(f"Monthly precipitation must be in mm/month, but its Units are {units!r}.", ("MT_Precip.Primary",))
    elif not monthly and not re.match(r"mm/(d|h)", units, re.I):
        yield Issue(f"Daily precipitation must be in mm/day or mm/hour, but its Units are {units!r}.", ("MT_Precip.Primary",))
    fraction = ctx.dataset("precipFraction")
    if fraction is not None and not re.match(r"frac", fraction.get("Units"), re.I):
        yield Issue(f"The precipitation fraction must have Units starting 'frac', not {fraction.get('Units')!r}.", ("precipFraction",))


_DRIVERS = ("MT_windU", "MT_windV", "MT_humidity", "MT_cloudFr")


def _missing(ctx: Ctx, paths: Iterable[str]) -> list[str]:
    return [p for p in paths if not ctx.filled(p)]


@rule("pet_drivers")
def _pet_drivers(ctx: Ctx) -> Iterable[Issue]:
    method = ctx.method("PET")
    if method in ("Penman-Monteith", "FAO-56"):
        gone = _missing(ctx, (*(f"{d}.Primary" for d in _DRIVERS), "MT_albedo.Primary"))
        if gone:
            yield Issue(
                f"PET {method} needs wind, humidity, cloud fraction and albedo datasets; missing: "
                + ", ".join(gone) + ".",
                ("PET", *gone),
            )


@rule("pet_pm_canopy")
def _pet_pm_canopy(ctx: Ctx) -> Iterable[Issue]:
    if ctx.method("PET") == "Penman-Monteith":
        gone = _missing(ctx, ("canopyHt", "MT_LAI"))
        if gone:
            yield Issue(
                "PET Penman-Monteith needs the canopy height and the leaf area index; missing: "
                + ", ".join(gone) + ".",
                ("PET", *gone),
            )


@rule("twt_inputs")
def _twt_inputs(ctx: Ctx) -> Iterable[Issue]:
    twt = ctx.outputs_with("_twt")
    if twt:
        gone = _missing(
            ctx, ("airT_yc", *(f"{d}.Primary" for d in _DRIVERS), "canopyHt", "MT_LAI")
        )
        if gone:
            yield Issue(
                f"The water temperature output {twt[0]} needs the annual air temperature, wind, "
                "humidity, cloud fraction, canopy height and leaf area index; missing: "
                + ", ".join(gone) + ".",
                ("Output_vars", *gone),
            )


@rule("humidity_units")
def _humidity_units(ctx: Ctx) -> Iterable[Issue]:
    humidity = ctx.dataset("MT_humidity.Primary")
    if humidity is None:
        return
    units = humidity.get("Units")
    if not re.match(r"per|%|kg|deg.*C|C", units, re.I):
        yield Issue(
            f"The humidity Units {units!r} are not ones WBM reads: use per cent, kg/kg or degC.",
            ("MT_humidity.Primary",),
        )
    elif re.match(r"kg", units, re.I) and not ctx.filled("Elevation"):
        yield Issue(
            "Specific humidity (kg/kg) needs an elevation that is not 0: give a constant that is "
            "not 0, or a layer.",
            ("MT_humidity.Primary", "Elevation"),
        )


@rule("soil_awc_precedence")
def _soil_awc_precedence(ctx: Ctx) -> Iterable[Issue]:
    if ctx.filled("soilAWCapacity"):
        ignored = [p for p in ("FieldCap", "WiltingPoint") if ctx.filled(p)]
        if ignored:
            yield Issue(
                "WBM does not read " + " and ".join(ignored) + " when soilAWCapacity is set.",
                ("soilAWCapacity", *ignored),
            )


@rule("soil_fc_wp")
def _soil_fc_wp(ctx: Ctx) -> Iterable[Issue]:
    if ctx.filled("soilAWCapacity"):
        return
    gone = _missing(ctx, ("FieldCap", "WiltingPoint"))
    if gone:
        yield Issue(
            "Without soilAWCapacity WBM needs the field capacity and the wilting point; missing: "
            + ", ".join(gone) + ".",
            ("soilAWCapacity", *gone),
        )
    elif _NUMBER_RE.match(ctx.text("FieldCap")) and _NUMBER_RE.match(ctx.text("WiltingPoint")):
        yield Issue(
            "The field capacity and the wilting point cannot both be constants: WBM needs one of "
            "them to be a layer.",
            ("FieldCap", "WiltingPoint"),
        )


@rule("lapse_downscale_requires")
def _lapse_downscale_requires(ctx: Ctx) -> Iterable[Issue]:
    if not ctx.on("lapseDownscale") or ctx.unread("lapseDownscale.forceSecTemp"):
        return
    if not ctx.filled("MT_airT.Primary"):
        yield Issue(
            "Lapse-rate downscaling works on a mean air temperature dataset, not a minimum and "
            "maximum pair.",
            ("lapseDownscale", "MT_airT.Primary"),
        )
    if ctx.filled("MT_airT.Secondary") and ctx.text("lapseDownscale.forceSecTemp") not in ("1", "true"):
        yield Issue(
            "Lapse-rate downscaling with a secondary air temperature dataset needs forceSecTemp "
            "set to 1; WBM stops otherwise.",
            ("lapseDownscale", "lapseDownscale.forceSecTemp", "MT_airT.Secondary"),
        )


@rule("bias_correction_pairs")
def _bias_correction_pairs(ctx: Ctx) -> Iterable[Issue]:
    for a, b in (("WM_mod_precip", "WM_obs_precip"), ("WM_mod_airT", "WM_obs_airT")):
        if ctx.filled(a) != ctx.filled(b):
            lone, absent = (a, b) if ctx.filled(a) else (b, a)
            yield Issue(
                f"{lone} is set without {absent}: WBM ignores a bias-correction dataset that has no "
                "partner.",
                (a, b),
            )


# A dataset or file field that WBM reads once, at 2001-01-01 (`read_Layer`, M:801-818), not on every
# date of the run: the init of a time series in one is sampled on a single date. From the calls
# of `read_Layer` in wbm.pl (lines 647-1186, 4838-5024) and RIMS/WBM.pm (3436-3497, 3616, 3665).
LAYER_FIELDS = frozenset(
    {
        "rootingDepth", "soilAWCapacity", "FieldCap", "WiltingPoint", "canopyHt", "Elevation",
        "airT_yc", "Impervious", "wbmParam.CLeafMax", "wbmParam.infiltrFrac",
        "wbmParam.groundWatBETA", "wbmParam.RhRt2", "openWater.MaskDataset",
        "openWater.fracOpenWater", "lapseDownscale.climElevation", "lapseDownscale.netElevation",
        "Irrigation.SW_GW_ratio", "Irrigation.ricePercolation", "Irrigation.ExtraCoeff",
        "Irrigation.ExtraAqfCoeff", "Irrigation.AqfCoeff", "Aquifers.aqfInfiltFr", "Aquifers.DEM",
        "Aquifers.Net_DEM", "Aquifers.Aqf_Thick", "Aquifers.H_DEM_T", "Aquifers.H_DEM_B",
        "Aquifers.H_DEPTH_T", "Aquifers.H_DEPTH_B", "Aquifers.Conf_Thick", "Aquifers.Aqf_Sy",
        "Aquifers.Aqf_SyCnfd", "Aquifers.Aqf_Ph", "Aquifers.Aqf_Kh", "Aquifers.Aqf_Kv",
        "Aquifers.Aqf_KhConf", "Aquifers.Aqf_KvConf", "Aquifers.eFolding", "Aquifers.BRes",
        "Aquifers.Aqf_ID_File",
    }
)

#: The fields the file reader gives a second date to: `glArea` and `glVolume` are read with
#: `DATE_SEARCH_OPT => {YR_UP => 1}` (wbm.pl:1595-1597), so a date the dataset lacks is looked up
#: again one year later (RIMS/DataSet.pm:156-193).
YEARS_UP_FIELDS = frozenset({"Glaciers.glArea", "Glaciers.glVolume"})


@rule("timeseries_in_layer_field")
def _timeseries_in_layer_field(ctx: Ctx) -> Iterable[Issue]:
    for target in dataset_targets(ctx):
        if not target.layer or target.kind != "init":
            continue
        init = ctx.inits.get(target.container_path)
        series = _series(init) if init else None
        if isinstance(series, Series) and not series.clim:
            yield Issue(
                f"{target.field} is read as one picture, not as a time series: WBM takes the "
                f"{series.form} dataset {series.code} on 2001-01-01 only.",
                (target.field,),
            )


@rule("module_on_has_value")
def _module_on_has_value(ctx: Ctx) -> Iterable[Issue]:
    needs = tree.module_requirements(ctx.run.version)
    for path, children in needs.items():
        value = ctx.get(path)
        if not isinstance(value, dict) or not value or not ctx.on(path):
            continue  # off, a plain value, or a block file that could not be read
        gone = [
            c for c in children
            if c not in _CHECKED_ELSEWHERE and reader.lookup(ctx.values, c) in (None, "", {})
        ]
        if gone:
            yield Issue(
                f"{ctx.label(path)} is on but does not set " + ", ".join(gone) + ".",
                (path, *gone),
            )


# What another rule of the tree already says, so a missing value is said once.
_CHECKED_ELSEWHERE = frozenset(
    {
        "ConnectivityNetwork.File", "ConnectivityNetwork.SkipLines", "Reservoirs.File",
        "Reservoirs.SkipLines", "openWater.MaskDataset", "WaterDemand.PopDensity",
        "WaterDemand.DomDemandPP", "WaterDemand.IndDemandPP", "WaterDemand.LivestockParam",
    }
)


@rule("springs_need_aquifers")
def _springs_need_aquifers(ctx: Ctx) -> Iterable[Issue]:
    if ctx.on("Springs") and not ctx.on("Aquifers"):
        yield Issue("Springs need the 3D groundwater (Aquifers) module on.", ("Springs", "Aquifers"))


@rule("modflow_required")
def _modflow_required(ctx: Ctx) -> Iterable[Issue]:
    if not ctx.on("Aquifers") or ctx.unread("Aquifers.Type") or ctx.text("Aquifers.Type") != "ModFlow":
        return
    gone = _missing(ctx, ("Aquifers.DEM", "Aquifers.Net_DEM", "Aquifers.Aqf_Thick"))
    if gone:
        yield Issue("A ModFlow aquifer needs " + ", ".join(gone) + ".", ("Aquifers", *gone))
    for top, depth in (("H_DEM_T", "H_DEPTH_T"), ("H_DEM_B", "H_DEPTH_B")):
        if ctx.filled(f"Aquifers.{top}") and ctx.filled(f"Aquifers.{depth}"):
            yield Issue(
                f"Aquifers.{top} and Aquifers.{depth} both set the same head: set one of them.",
                (f"Aquifers.{top}", f"Aquifers.{depth}"),
            )


@rule("irrigation_efficiency")
def _irrigation_efficiency(ctx: Ctx) -> Iterable[Issue]:
    if (
        not ctx.on("Irrigation")
        or ctx.unread("Irrigation.IrrEfficiency")
        or ctx.filled("Irrigation.IrrTechApplicationFile")
    ):
        return
    efficiency = ctx.text("Irrigation.IrrEfficiency")
    if not efficiency or _NUMBER_RE.match(efficiency):
        yield Issue(
            "Irrigation needs an efficiency that is a data .init or a raster: WBM stops on a "
            "constant, and on the missing value, which it takes as the constant 1.",
            ("Irrigation", "Irrigation.IrrEfficiency"),
        )


@rule("water_demand_required")
def _water_demand_required(ctx: Ctx) -> Iterable[Issue]:
    if not ctx.on("WaterDemand") or ctx.unread("WaterDemand.PopDensity"):
        return
    gone = _missing(
        ctx,
        ("WaterDemand.PopDensity", "WaterDemand.DomDemandPP", "WaterDemand.IndDemandPP", "WaterDemand.LivestockParam"),
    )
    if gone:
        yield Issue("Water demand needs " + ", ".join(gone) + ".", ("WaterDemand", *gone))


@rule("open_water_mask")
def _open_water_mask(ctx: Ctx) -> Iterable[Issue]:
    if ctx.on("openWater") and not ctx.unread("openWater.MaskDataset") and not ctx.filled("openWater.MaskDataset"):
        yield Issue(
            "Open-water flush routing needs a mask dataset (openWater.MaskDataset).",
            ("openWater", "openWater.MaskDataset"),
        )


@rule("file_modules_need_file")
def _file_modules_need_file(ctx: Ctx) -> Iterable[Issue]:
    for module in ("ConnectivityNetwork", "Reservoirs"):
        if not ctx.on(module) or ctx.unread(f"{module}.File"):
            continue
        gone = []
        if not ctx.filled(f"{module}.File"):
            gone.append(f"{module}.File")
        if ctx.get(f"{module}.SkipLines") is None:
            gone.append(f"{module}.SkipLines")
        if gone:
            yield Issue(f"{ctx.label(module)} is on but does not set " + ", ".join(gone) + ".", (module, *gone))


@rule("muskingum_fallback_22")
def _muskingum_fallback_22(ctx: Ctx) -> Iterable[Issue]:
    if ctx.method("Routing") != "Muskingum":
        return
    on = [m for m in ("ConnectivityNetwork", "WaterDemand", "Irrigation") if ctx.on(m)]
    if ctx.on("openWaterEvap"):
        on.append("openWaterEvap")
    if on:
        yield Issue(
            "WBM 22.1.1 does not run Muskingum routing together with " + ", ".join(on)
            + ": it uses LRR routing instead.",
            ("Routing.method", *on),
        )


@rule("muskingum_note")
def _muskingum_note(ctx: Ctx) -> Iterable[Issue]:
    if ctx.method("Routing") == "Muskingum":
        yield Issue(
            "Muskingum routing suits coarse grids only, and WBM exits when water is abstracted from "
            "the network.",
            ("Routing.method",),
        )


_MSK_OUTPUTS = ("dischMsk", "runoffMsk", "grndWtMsk")


@rule("msk_outputs_runoff_mask_pairing")
def _msk_outputs_runoff_mask_pairing(ctx: Ctx) -> Iterable[Issue]:
    msk = [n for n in ctx.outputs if n in _MSK_OUTPUTS]
    block = ctx.on("Runoff_mask")
    if msk and not block:
        yield Issue(
            f"The output {msk[0]} needs the Runoff_mask block (source water by land area): WBM "
            "passes its one-step test without it and then stops when the run starts. Add the block "
            "or remove " + ", ".join(msk) + ".",
            ("Output_vars", "Runoff_mask"),
        )
    elif block and not msk:
        yield Issue(
            "The Runoff_mask block needs at least one of dischMsk, runoffMsk and grndWtMsk as an "
            "output: WBM stops without one.",
            ("Output_vars", "Runoff_mask"),
        )


@rule("din_outputs_din_block")
def _din_outputs_din_block(ctx: Ctx) -> Iterable[Issue]:
    din = [n for n in ctx.outputs if n.startswith("DIN")]
    if din and not ctx.on("DIN"):
        yield Issue(
            f"The output {din[0]} needs the DIN block (nitrogen tracking): WBM stops without it. "
            "Add the block or remove the DIN outputs.",
            ("Output_vars", "DIN"),
        )


@rule("din_block_without_output")
def _din_block_without_output(ctx: Ctx) -> Iterable[Issue]:
    if ctx.on("DIN") and not any(n.startswith("DIN") for n in ctx.outputs):
        yield Issue(
            "The DIN block is set but no DIN output is listed: WBM ignores the block.",
            ("DIN", "Output_vars"),
        )


_IRR_SUFFIXES = ("_irr", "_pst", "_use", "_rlt")
_PRIMARY_SUFFIXES = ("_ps", "_pg", "_pr", "_pu")


@rule("irr_outputs_without_irrigation")
def _irr_outputs_without_irrigation(ctx: Ctx) -> Iterable[Issue]:
    names = ctx.outputs_with(*_IRR_SUFFIXES)
    if names and not ctx.on("Irrigation"):
        yield Issue(
            "Irrigation is off, so WBM drops these irrigation re-use outputs without a word: "
            + ", ".join(names) + ".",
            ("Output_vars", "Irrigation"),
        )


@rule("pg_without_glaciers")
def _pg_without_glaciers(ctx: Ctx) -> Iterable[Issue]:
    names = ctx.outputs_with("_pg")
    if names and not ctx.on("Glaciers"):
        yield Issue(
            "Glacier melt is off, so these glacier-tracking outputs have no glacier water to "
            "track (what WBM does is not established): " + ", ".join(names) + ".",
            ("Output_vars", "Glaciers"),
        )


@rule("comp_balance_tracking")
def _comp_balance_tracking(ctx: Ctx) -> Iterable[Issue]:
    if not ctx.unread("wbmParam.compBalance") and ctx.text("wbmParam.compBalance") in ("1", "true") and not (
        ctx.outputs_with(*_PRIMARY_SUFFIXES) or ctx.outputs_with(*_IRR_SUFFIXES)
    ):
        yield Issue(
            "compBalance is 1, but no primary-source or irrigation re-use tracking output is "
            "listed: WBM sets it back to 0.",
            ("wbmParam.compBalance", "Output_vars"),
        )


_SELF_ADDED_RE = re.compile(r"(?:_irr_\d+|^(?:dischMsk|runoffMsk|grndWtMsk)_.+)$")


@rule("output_vars_self_added")
def _output_vars_self_added(ctx: Ctx) -> Iterable[Issue]:
    names = [n for n in ctx.outputs if _SELF_ADDED_RE.search(n)]
    if names:
        yield Issue(
            "WBM adds these output variables itself, so they must not be listed: "
            + ", ".join(names) + ".",
            ("Output_vars",),
        )


def _pp_block(ctx: Ctx) -> dict | None:
    """The `PostProcessing` block when WBM reads it: present and not empty, even with `Run => 0`."""
    block = ctx.get("PostProcessing")
    return block if isinstance(block, dict) and block else None


@rule("ta_multi_year_start_in_run")
def _ta_multi_year_start_in_run(ctx: Ctx) -> Iterable[Issue]:
    block = _pp_block(ctx)
    if block is None:
        return
    start = block.get("TA_multi_year_start")
    step = block.get("TA_multi_year_timestep")
    if not (isinstance(start, str) and start):
        return
    if not (isinstance(step, str) and step):
        yield Issue(
            "Multi-year aggregation needs both its start year and its time step: WBM skips it "
            "without the time step.",
            ("PostProcessing.TA_multi_year_start", "PostProcessing.TA_multi_year_timestep"),
        )
    window = window_of(ctx, _airt_end(ctx))
    if window is None or not start.isdigit():
        return
    first, last = window.run.start.year, window.run.end.year
    # WBM counts the last year only when the run ends on its last day (RIMS/WBM.pm:4276-4279).
    if not (window.run.end.month == 12 and window.run.end.day in (30, 31)):
        last -= 1
    if not first <= int(start) <= last:
        yield Issue(
            f"The multi-year aggregation starts in {start}, but WBM can start it only from {first} "
            f"to {last} (the run's last year counts only when the run ends on its December 31): "
            "WBM stops.",
            ("PostProcessing.TA_multi_year_start", RUN_START, RUN_END),
        )


@rule("post_processing_required_inputs")
def _post_processing_required_inputs(ctx: Ctx) -> Iterable[Issue]:
    block = _pp_block(ctx)
    if block is None:
        return
    names = [
        n for n in ctx.outputs
        if n not in _MSK_OUTPUTS or ctx.text("Runoff_mask.PostProcessing") in ("1", "true")
    ]
    only = block.get("Var_list")
    if isinstance(only, str) and only.split():
        names = [n for n in names if n in only.split()]
    if not names:
        yield Issue(
            "Post-processing has no output variable to process: WBM stops. List an output "
            "variable, or turn post-processing off.",
            ("PostProcessing", "Output_vars"),
        )
    aggregation = block.get("Polygon_Aggregation")
    if isinstance(aggregation, dict) and aggregation and not aggregation.get("IDs"):
        yield Issue(
            "Polygon aggregation needs the IDs of the polygon datasets.",
            ("PostProcessing.Polygon_Aggregation",),
        )


# ---------------------------------------------------------------------------
# Dataset file coverage
# ---------------------------------------------------------------------------

_TIME_SERIES_RE = re.compile(r"^(daily|monthly|yearly|decadal)(_clim)?(\{(\d+)\})?$")
#: The hours a `daily{N}` dataset steps through (RIMS.pm make_date_list: 1/N of a day).
_HOURLY_N = (1, 2, 3, 4, 6, 8, 12, 24)
_PYRAMID_RE = re.compile(r"^\(.+?,.+?\):")
_TOKEN_RE = re.compile(r"_(YEAR|MONTH|DAY|HOUR|MIN)_")
#: A dataset's date list is built from the middle of each period (RIMS.pm unzero_dates), so a file
#: name of a monthly dataset has day 15, of a yearly or decadal one July 1; a climatology is built
#: on 2001, a year without February 29 (RIMS.pm make_date_list, clim_yr).
_CLIM_YEAR = 2001


@dataclass(frozen=True)
class Series:
    """A data init's time axis, as WBM builds it from `Time_Series`, `Start_Date` and `End_Date`."""

    code: str
    #: daily, monthly, yearly or decadal.
    form: str
    #: A climatology (`*_clim`, or no `Time_Series`): one cycle of files, whatever the dates.
    clim: bool
    #: N of `daily{N}`, else 0.
    hourly: int
    start: tuple[int, int, int]
    end: tuple[int, int, int]
    #: Where the files are: each entry of `File_Path`, a pyramid's scale prefix and a `NETCDF:` wrapper removed.
    templates: tuple[str, ...]
    calendar: int
    start_text: str
    end_text: str


class Unchecked(NamedTuple):
    """A dataset the coverage rule does not judge, and why."""

    reason: str


def _templates(file_path: str) -> tuple[str, ...]:
    out = []
    for entry in file_path.split(";"):
        entry = _PYRAMID_RE.sub("", entry.strip())
        if entry.upper().startswith("NETCDF:"):
            pieces = entry.split(":")
            entry = pieces[1] if len(pieces) >= 2 else entry
        if entry:
            out.append(entry)
    return tuple(dict.fromkeys(out))


def _calendar(init: model_input.InitFile) -> int:
    """RIMS.pm get_calendar (R:1340-1358): `calendar=` in `Processing`, else 365 for a dataset with
    365 bands, else 366."""
    m = re.search(r"calendar=(\d+)", init.get("Processing"), re.I)
    if m:
        return int(m[1])
    return 365 if init.get("Bands").strip() == "365" else 366


def _series(init: model_input.InitFile) -> Series | Unchecked | Issue:
    """The time axis of a data init; `Unchecked` for a form the rule does not judge, an `Issue` for
    dates WBM refuses."""
    code = init.get("Code_Name") or init.name
    form_text = init.get("Time_Series").strip()
    templates = _templates(init.get("File_Path"))
    calendar_ = _calendar(init)
    if not templates:
        return Unchecked("it names no file")
    if calendar_ == 360:
        return Unchecked("its 360-day calendar is not one WBM runs")
    if not form_text:
        return Series(code, "yearly", True, 0, (0, 0, 0), (0, 0, 0), templates, calendar_, "", "")
    m = _TIME_SERIES_RE.match(form_text.lower())
    if m is None:
        return Unchecked(f"its Time_Series {form_text!r} is not one the check reads")
    hourly = int(m[4]) if m[4] else 0
    if hourly and hourly not in _HOURLY_N:
        return Unchecked(f"its Time_Series {form_text!r} is not one the check reads")
    clim = bool(m[2])
    start_text, end_text = init.get("Start_Date"), init.get("End_Date")
    if clim:
        return Series(code, m[1], True, hourly, (0, 0, 0), (0, 0, 0), templates, calendar_, start_text, end_text)
    start, end = _ISO_RE.match(start_text), _ISO_RE.match(end_text)
    if not start or not end:
        return Issue(
            f"The dataset {code} is a {form_text} series, but its Start_Date {start_text!r} and "
            f"End_Date {end_text!r} are not both dates written YYYY-MM-DD.",
        )
    return Series(
        code, m[1], False, hourly,
        (int(start[1]), int(start[2]), int(start[3])), (int(end[1]), int(end[2]), int(end[3])),
        templates, calendar_, start_text, end_text,
    )


def _shift_year(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # February 29
        return d.replace(year=d.year + years, day=28)


def _resolve(s: Series, d: date, monthly_run: bool) -> tuple[int, int, int] | None:
    """The date the file name of the run date `d` is made from, or None when the dataset has no
    date for it. WBM looks `d` up among the dataset's own dates, and when it is not one, as the
    month, then the year, then the decade (RIMS/DataSet.pm findDate, D:195-232): so a daily run
    reads a monthly dataset by month. A date outside `Start_Date`..`End_Date` is never found: the
    run dies, whatever the time step (D:190-192)."""
    if s.clim:
        if s.form == "daily":
            return (_CLIM_YEAR, d.month, 28 if (d.month, d.day) == (2, 29) else d.day)
        if s.form == "monthly":
            return (_CLIM_YEAR, d.month, 15)
        return (_CLIM_YEAR, 7, 1)
    if s.form == "daily":
        if monthly_run:
            return None  # the run asks for `YYYY-MM-00`, which a daily dataset has no date for
        # A dataset on the 365-day calendar has no February 29: the run's is its February 28 (D:212-214).
        day = d.replace(day=28) if (d.month, d.day) == (2, 29) and s.calendar == 365 else d
        key = (day.year, day.month, day.day)
        return key if s.start <= key <= s.end else None
    if s.form == "monthly":
        return (d.year, d.month, 15) if s.start[:2] <= (d.year, d.month) <= s.end[:2] else None
    if s.form == "yearly":
        return (d.year, 7, 1) if s.start[0] <= d.year <= s.end[0] else None
    decade = d.year // 10 * 10  # decadal: the dataset's dates are its start year, then every ten years
    keys = range(s.start[0], s.end[0] + 1, 10)
    return (decade, 7, 1) if decade in keys else None


def _names(s: Series, key: tuple[int, int, int]) -> list[str]:
    """The files of one date of the dataset: each entry of `File_Path` with the tokens replaced as
    RIMS does (R:1551-1555; R(22):1444-1449): `_YEAR_`, `_MONTH_` and `_DAY_` of the date, and
    `_HOUR_` and `_MIN_` of each step of a `daily{N}` day."""
    year, month, day = key
    steps = [(h * 24 // s.hourly if s.hourly else 0) for h in range(s.hourly or 1)]
    out: dict[str, None] = {}
    for template in s.templates:
        for hour in steps:
            name = (
                template.replace("_YEAR_", f"{year:04d}").replace("_MONTH_", f"{month:02d}")
                .replace("_DAY_", f"{day:02d}").replace("_HOUR_", f"{hour:02d}")
                .replace("_MIN_", "00")
            )
            out[name] = None
    return list(out)


def _cycle(s: Series) -> list[date]:
    """The dates of one cycle of a climatology, on a year without February 29."""
    if s.form == "daily":
        return [date(_CLIM_YEAR, 1, 1) + timedelta(days=n) for n in range(365)]
    if s.form == "monthly":
        return [date(_CLIM_YEAR, m, 1) for m in range(1, 13)]
    return [date(_CLIM_YEAR, 7, 1)]


class Target(NamedTuple):
    """A file the run reads: the init key path of the field (or file) that names it, the path as the
    run init writes it, and how it is read."""

    field: str
    container_path: str
    #: `init` (a data .init: its descriptor and its files are checked) or `file` (it must exist).
    kind: str
    #: Where inside a file the run reads, for a name taken from a table: `row Rice_crop, column Kc_TS`.
    via: str = ""
    layer: bool = False
    years_up: bool = False
    #: WBM opens the dataset's first file at the start to read its grid (the tree's `reads_first_file`).
    first_file: bool = False

    def describe(self) -> str:
        return f"{self.field}{f' ({self.via})' if self.via else ''}"


def dataset_targets(ctx: Ctx) -> list[Target]:
    """The dataset and file fields of the tree that the run reads: the field's module is on, and the
    init gives it a value that names a file (`_classify`). A module the init writes as a block file
    is read through `ctx.values`, where the block is already expanded."""
    out: list[Target] = []
    for node in ctx.run.resolved.fields.values():
        # A module that is itself a dataset (`openWaterEvap`, `Impervious`, `MT_LAI`) is read like a field.
        if node.type not in ("dataset", "file"):
            continue
        if any(not ctx.on(m) for m in node.modules):
            continue
        kind = _classify(ctx.text(node.path))
        if kind:
            out.append(
                Target(
                    node.path, kind[1], kind[0],
                    layer=node.path in LAYER_FIELDS,
                    years_up=node.path in YEARS_UP_FIELDS,
                    first_file=node.reads_first_file is True
                    or (isinstance(node.reads_first_file, str) and ctx.on(node.reads_first_file)),
                )
            )
    return out


#: The columns of a crop parameter table that name data inits (docs/reference/wbm-init.md section 8).
_TABLE_COLUMNS = ("RootDepth", "CropDepletionFactor", "LandFracTS", "LandFracTS_Dom", "Kc_TS", "AddedWaterTS")
_TABLE_FIELDS = ("Irrigation.CropParFile", "Irrigation.CropParFilePatch")


def table_targets(field_path: str, text: str) -> list[Target]:
    """The data inits a crop parameter table names (RIMS read_table: tab-separated, a header line;
    wbm.pl read_land_param skips a row with no `Group`): one `Target` per cell that holds a path."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []
    header = lines[0].split("\t")
    column = {name.strip(): i for i, name in enumerate(header)}
    if "Group" not in column or "Land_ID" not in column:
        return []
    out: list[Target] = []
    for line in lines[1:]:
        cells = line.split("\t")
        cell = lambda name: cells[column[name]].strip() if name in column and column[name] < len(cells) else ""  # noqa: E731
        if not cell("Group"):
            continue
        for name in _TABLE_COLUMNS:
            kind = _classify(cell(name))
            if kind and kind[0] == "init":
                out.append(Target(field_path, kind[1], "init", via=f"row {cell('Land_ID')}, column {name}"))
    return out


async def gather_files(source: model_input.Source, run: Run) -> Ctx:
    """The `Ctx` of a run: its block files expanded, then the data inits and tables its dataset
    fields name, read from the model input (parallel, a few at a time). A file that is not there or
    not an init is a `problem`, not an exception; only a bucket that cannot be read raises
    `model_input.Unavailable`."""
    values = copy.deepcopy(run.values)
    ctx = Ctx(run, values)
    prefixes = {p.split(".")[0] for p in run.resolved.fields if "." in p}
    ctx.blocks = {
        key: value
        for key, value in run.values.items()
        if key in prefixes and isinstance(value, str) and value.endswith(_BLOCK_FILE_SUFFIX)
    }
    await _read_all(source, ctx, ctx.blocks.values())
    for key, path in ctx.blocks.items():
        if path in ctx.inits:
            values[key] = ctx.inits[path].values
    targets = dataset_targets(ctx)
    await _read_all(source, ctx, [t.container_path for t in targets if t.kind == "init"])
    tables = [t for t in targets if t.field in _TABLE_FIELDS]
    texts = await model_input.gather(_read_table(source, ctx, t) for t in tables)
    wanted = [t.container_path for rows in texts for t in rows]
    await _read_all(source, ctx, wanted)
    ctx.tables = [t for rows in texts for t in rows]
    return ctx


async def _read_table(source: model_input.Source, ctx: Ctx, target: Target) -> list[Target]:
    location = model_input.locate(source, target.container_path)
    if location is None:
        return []
    try:
        text = await model_input.read_text(location)
    except model_input.NotFound:
        return []  # said by `cover`: the table is a file field that must exist
    except model_input.BadInit as exc:
        ctx.problems[target.container_path] = str(exc)
        return []
    return table_targets(target.field, text)


async def _read_all(source: model_input.Source, ctx: Ctx, paths: Iterable[str]) -> None:
    wanted = [p for p in dict.fromkeys(paths) if p not in ctx.inits and p not in ctx.problems]

    async def one(path: str) -> None:
        location = model_input.locate(source, path)
        if location is None:
            return  # not a published artifact: nothing to read, nothing to check
        try:
            ctx.inits[path] = await model_input.read_init(location)
        except model_input.NotFound:
            ctx.problems[path] = "it is not in the model input"
        except model_input.BadInit as exc:
            ctx.problems[path] = f"it cannot be read ({exc})"

    await model_input.gather(one(p) for p in wanted)


def _show(d: date, monthly: bool) -> str:
    return d.strftime("%Y-%m") if monthly else d.isoformat()


def _date_field(window: Window, d: date, early: bool) -> str:
    span = window.span_of(d)
    return span.start_path if early else span.end_path


@dataclass
class _Plan:
    target: Target
    series: Series
    #: The run dates in order with the files each needs; only the dates the dataset has.
    steps: list[tuple[date, list[str]]]


async def cover(source: model_input.Source, ctx: Ctx, window: Window | None) -> list[Issue]:
    """The issues of `dataset_file_coverage`: for every dataset the run reads, whether its
    `Start_Date`..`End_Date` cover the dates the run reads and whether a file exists for each.
    Raises `model_input.Unavailable` when a folder cannot be listed."""
    issues: list[Issue] = []
    targets = dataset_targets(ctx) + ctx.tables
    plans: list[_Plan] = []
    files: list[Target] = []
    for key, path in ctx.blocks.items():
        if path in ctx.problems:
            issues.append(Issue(f"{key} is read from {path}, but {ctx.problems[path]}.", (key,)))
    for target in targets:
        if target.container_path in ctx.problems:
            issues.append(
                Issue(
                    f"{target.describe()} points to {target.container_path}, but "
                    f"{ctx.problems[target.container_path]}.",
                    (target.field,),
                )
            )
        elif target.kind == "file":
            files.append(target)
        else:
            plan = _plan(ctx, target, window, issues)
            if plan:
                plans.append(plan)
    # The first file of a dataset WBM reads the grid of, which no run date may need (`reads_first_file`).
    firsts: list[tuple[Target, Series, str]] = []
    for target in targets:
        init = ctx.inits.get(target.container_path) if target.first_file and target.kind == "init" else None
        series = _series(init) if init else None
        if isinstance(series, Series) and not series.clim:
            firsts.append((target, series, _first_file(series)))
    # One listing per folder, all of them in parallel.
    wanted: dict[model_input.Location, None] = {}
    located: dict[str, model_input.Location | None] = {}

    def located_at(path: str) -> model_input.Location | None:
        if path not in located:
            located[path] = model_input.locate(source, path)
        return located[path]

    for target in files:
        loc = located_at(target.container_path)
        if loc:
            wanted[model_input.parent_of(loc)[0]] = None
    for plan in plans:
        for _, names in plan.steps:
            for name in names:
                loc = located_at(name)
                if loc:
                    wanted[model_input.parent_of(loc)[0]] = None
    for _, _, name in firsts:
        loc = located_at(name)
        if loc:
            wanted[model_input.parent_of(loc)[0]] = None
    folders = list(wanted)
    listed = dict(zip(folders, await model_input.gather(model_input.list_names(f) for f in folders)))

    def present(path: str) -> bool | None:
        loc = located_at(path)
        if loc is None:
            return None  # outside the published artifacts: not judged
        folder, name = model_input.parent_of(loc)
        return name in listed[folder].files

    for target in files:
        if present(target.container_path) is False:
            issues.append(
                Issue(f"{target.describe()} names {target.container_path}, which is not in the model input.", (target.field,))
            )
    for plan in plans:
        issue = _missing_file(plan, window, present)
        if issue:
            issues.append(issue)
    needed = {n for plan in plans for _, names in plan.steps for n in names}
    for target, series, name in firsts:
        if name not in needed and present(name) is False:  # a file a run date needs is said above
            issues.append(
                Issue(
                    f"The dataset {series.code} read by {target.describe()} has no file at its Start_Date "
                    f"({series.start_text}): WBM opens {name} when it starts, to read the grid, and it is "
                    "not in the model input.",
                    (target.field,),
                )
            )
    return issues


def _first_file(s: Series) -> str:
    """The first file of a dataset that is not a climatology: the one `RIMS::DataSet` lists first, from
    the middle of the period of its `Start_Date` (`unzero_dates`, R:1361-1373; as in `_names`)."""
    year, month, _ = s.start
    key = (year, month, 15) if s.form == "monthly" else (year, 7, 1) if s.form in ("yearly", "decadal") else s.start
    return _names(s, key)[0]


def _plan(ctx: Ctx, target: Target, window: Window | None, issues: list[Issue]) -> _Plan | None:
    """The run dates and files of one data init, adding to `issues` any date WBM would not find."""
    init = ctx.inits.get(target.container_path)
    if init is None:
        return None
    series = _series(init)
    if isinstance(series, Issue):
        issues.append(Issue(f"{target.describe()}: {series.message}", (target.field,)))
        return None
    if isinstance(series, Unchecked):
        return None  # not judged; the editor of a data init reports its form
    who = f"The dataset {series.code} read by {target.describe()}"
    if series.clim:
        return _Plan(target, series, [(d, _names(series, _resolve(series, d, False))) for d in _cycle(series)])
    if target.layer:
        dates = [date(2001, 1, 1)]
    elif window is None:
        return None  # the date rules say why the dates cannot be told
    else:
        dates = window.dates()
        if series.hourly and not window.hourly:
            issues.append(
                Issue(
                    f"{who} is an hourly series ({series.start_text} to {series.end_text}), and WBM "
                    "cannot read it for a run that steps by days: use a daily dataset, or a "
                    "sub-daily run.",
                    (target.field,),
                )
            )
            return None
    monthly_run = bool(window and window.monthly)
    steps: list[tuple[date, list[str]]] = []
    unresolved: list[date] = []
    for d in dates:
        key = _resolve(series, d, monthly_run)
        if key is None and target.years_up and not series.clim:
            key = _resolve(series, _shift_year(d, 1), monthly_run)
        if key is None:
            unresolved.append(d)
        else:
            steps.append((d, _names(series, key)))
    if unresolved:
        first = unresolved[0]
        covers = f"{series.start_text} to {series.end_text}"
        if target.layer:
            text = f"{who} has no date 2001-01-01, which WBM reads it on: its Start_Date and End_Date run from {covers}."
            paths: tuple[str, ...] = (target.field,)
        else:
            early = (first.year, first.month, first.day) < series.start
            text = (
                f"{who} has no data for {_show(first, monthly_run)}: its Start_Date and End_Date "
                f"run from {covers}."
            )
            paths = (target.field, _date_field(window, first, early))  # type: ignore[arg-type]
        issues.append(Issue(text, paths))
    return _Plan(target, series, steps)


def _missing_file(plan: _Plan, window: Window | None, present: Callable[[str], bool | None]) -> Issue | None:
    """The first date of the plan with a file that is not there, as an issue; None when all are."""
    last_ok: date | None = None
    for d, names in plan.steps:
        gone = next((n for n in names if present(n) is False), None)
        if gone is None:
            last_ok = d
            continue
        monthly = bool(window and window.monthly)
        who = f"The dataset {plan.series.code} read by {plan.target.describe()}"
        text = f"{who} has no file for {_show(d, monthly)}: {gone} is not in the model input."
        if last_ok is not None and not plan.series.clim:
            text += f" Its files run up to {_show(last_ok, monthly)}."
        paths: tuple[str, ...] = (plan.target.field,)
        if window and not plan.target.layer and not plan.series.clim:
            paths += (_date_field(window, d, last_ok is None),)
        return Issue(text, paths)
    return None


async def _coverage(source: model_input.Source, ctx: Ctx) -> list[Issue]:
    return await cover(source, ctx, window_of(ctx, _airt_end(ctx)))


#: The files `snowBands_init` requires next to the Network file (wbm.pl:4677-4684; 4683-4684 is the
#: `die "Elevation band data not found..."`): the network's path without its extension and these.
_SNOW_BAND_SUFFIXES = (".elvBands.dat", ".elvAverg.dat", ".elvBands.txt")


async def _snow_bands(source: model_input.Source, ctx: Ctx) -> list[Issue]:
    if not ctx.on("snowBands"):
        return []
    network = ctx.text("Network")
    if _classify(network) != ("file", network):
        return []  # `network_routing` says a network is missing
    base = re.sub(r"\.\w+$", "", network)
    absent = []
    for suffix in _SNOW_BAND_SUFFIXES:
        location = model_input.locate(source, base + suffix)
        if location is not None and not await model_input.file_exists(location):
            absent.append(base + suffix)
    if not absent:
        return []
    return [
        Issue(
            "Snow elevation bands need these files next to the river network, and they are not in "
            "the model input: " + ", ".join(absent) + ".",
            ("snowBands", "Network"),
        )
    ]


#: rule id -> a function of the model input's files, which raises `model_input.Unavailable` when
#: the bucket cannot be read: `check` then reports the rules here as not checked.
FILE_RULES: dict[str, Callable[[model_input.Source, Ctx], Awaitable[list[Issue]]]] = {
    "dataset_file_coverage": _coverage,
    "snow_bands_files": _snow_bands,
}


# ---------------------------------------------------------------------------
# The whole check
# ---------------------------------------------------------------------------

_NOT_CHECKED = (
    "The dataset files could not be checked right now, because the file store did not answer. "
    "A dataset that ends early would still stop the run."
)


@dataclass(frozen=True)
class Checks:
    """What `check` found, the failed rules in the tree's order."""

    findings: tuple[Finding, ...]
    #: False when the model input could not be read, so dataset coverage was not judged (its
    #: `Finding` is then a warning that says so).
    files_checked: bool

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.level == "error"]

    @property
    def warnings(self) -> list[Finding]:
        """The warnings and the notes: what is shown and does not refuse."""
        return [f for f in self.findings if f.level != "error"]


def _finding(rule_id: str, level: str, issues: list[Issue]) -> Finding:
    paths = tuple(dict.fromkeys(p for i in issues for p in i.paths))
    return Finding(rule_id, level, " ".join(i.message for i in issues), paths)


async def check(
    snapshot_id: str, snapshot: dict, loaded: model_parameters.Loaded, parameters: JobParameters
) -> Checks:
    """Every rule of the tree for the draft's run: the failed ones, each once with all its
    messages. When the model input cannot be read the rules that need no file still run, and the
    ones that do are not judged (`Checks.files_checked`). A draft that switches a module on is
    judged with the datasets it chose, which are read from the model input first."""
    kept = validate.drop_unchanged(parameters.custom_params or {}, loaded.resolved, loaded.values)
    if tree.needs_choices(kept, loaded.resolved, loaded.values):
        loaded = await model_parameters.with_choices(snapshot, snapshot_id, loaded)
    run = effective_run(snapshot, loaded, parameters)
    source = model_input.source_of(snapshot_id, snapshot)
    checked = True
    found: dict[str, list[Issue]] = {}
    try:
        ctx = await gather_files(source, run)
        for rule_id, file_rule in FILE_RULES.items():
            found[rule_id] = await file_rule(source, ctx)
    except model_input.ModelInputError as exc:
        logger.warning("Could not read the files of %s for the checks: %s", snapshot_id, exc)
        ctx, checked, found = Ctx(run, run.values), False, {}
    out: list[Finding] = []
    for entry in tree.cross_rules(run.version):
        rule_id = entry["id"]
        if rule_id in FILE_RULES:
            if not checked:
                if rule_id == "dataset_file_coverage":
                    out.append(Finding(rule_id, "warn", _NOT_CHECKED))
                continue
            issues = found[rule_id]
        else:
            evaluator = EVALUATORS.get(rule_id)
            issues = list(evaluator(ctx)) if evaluator else []
        if issues:
            out.append(_finding(rule_id, entry["level"], issues))
    return Checks(tuple(out), checked)
