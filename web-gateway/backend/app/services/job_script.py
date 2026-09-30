"""The bash body of a gateway job (ADR 0025).

A gateway job is a slurmly batch job whose body runs the pinned `openghm`
toolkit: fetch the snapshot into the shared cache, then `sim run` it. The fetch
runs under one lock that lives on /home (NFS), not on scratch, because flock on
/anvil (GPFS) does not lock across nodes (see `render_job_body`). slurmly
renders the shebang, the `#SBATCH` lines and the module preamble; everything
here is what it appends after them.

Everything in this module is pure — strings and dicts in, a string out — so
the rendered body is golden-tested (tests/test_job_script.py). Every value
that reaches the script is either matched against the pattern the toolkit
enforces on it or passed through `shlex.quote`, and usually both: the body is
emitted into a shell on a cluster, and its inputs come from a user's draft.
"""

from __future__ import annotations

import math
import posixpath
import re
import shlex
from dataclasses import dataclass
from datetime import date

from app.models.job import JobParameters


class SubmitInputError(ValueError):
    """An input the job body or job spec cannot be built from. `str()` is a
    message meant for the person who owns the draft."""


# The toolkit accepts `[A-Za-z0-9._-]+` for a snapshot id (fetch.py `_ID_RE`)
# and for `--id` (sim.py `_SIM_ID_RE`). Both end up as a path component and as
# a positional or option value, so a leading `-` (read as a flag) or `.` (`.`
# and `..`) is refused here on top of the toolkit's own rule.
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
# A toolkit install directory is named for a public commit. It is also printed
# inside double quotes in the script, so it stays to a conservative alphabet.
_COMMIT_RE = re.compile(r"^[A-Za-z0-9._+-]+$")
# A WBM output variable is an identifier (`runoff`, `streamAge`, `discharge_ps`).
# They are joined with spaces into one `--output-vars` value, so whitespace in
# a name would silently become two variables.
_VARIABLE_RE = re.compile(r"^[A-Za-z0-9_]+$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _check_id(kind: str, value: str) -> str:
    if not isinstance(value, str) or not _ID_RE.match(value):
        raise SubmitInputError(f"{kind} {value!r} is not a valid id")
    return value


def _check_abs_path(kind: str, value: str) -> str:
    if not isinstance(value, str) or not value.startswith("/") or "\x00" in value or "\n" in value:
        raise SubmitInputError(f"{kind} must be an absolute path (got {value!r})")
    return value.rstrip("/") or "/"


def toolkit_commit(openghm_home: str) -> str:
    """The commit a toolkit install is pinned to: the install directory's
    name (`<...>/apps/openghm/<commit>`, ADR 0025)."""
    home = _check_abs_path("ANVIL_OPENGHM_HOME", openghm_home)
    commit = posixpath.basename(home)
    if not _COMMIT_RE.match(commit):
        raise SubmitInputError(
            f"ANVIL_OPENGHM_HOME must end in the commit's name (got {openghm_home!r})"
        )
    return commit


def render_job_body(
    *,
    snapshot_id: str,
    sim_id: str,
    openghm_home: str,
    cache_dir: str,
    fetch_lock: str,
    run_start: str | None = None,
    run_end: str | None = None,
    output_vars: str | None = None,
) -> str:
    """The job's bash body. `run_start`, `run_end` and `output_vars` are passed
    to `sim run` only when given — the caller gives one only when the draft
    differs from the snapshot's own value (see `run_overrides`).

    The fetch takes one lock for every snapshot, not one each: a fetch also
    writes the model-input and image caches, which snapshots share, and two
    snapshots can link the same model input. `fetch_lock` must be on a
    filesystem where flock works across nodes: on Anvil that is /home (NFS),
    not /anvil (GPFS), where two jobs on different nodes held it at once.
    `--spool skip` because the run
    builds its own (`--spool fresh`), so a published spool is never downloaded.
    Raises `SubmitInputError` on an id or path that is not safe to render.
    """
    snapshot_id = _check_id("snapshot id", snapshot_id)
    sim_id = _check_id("simulation id", sim_id)
    home = _check_abs_path("ANVIL_OPENGHM_HOME", openghm_home)
    commit = toolkit_commit(home)
    cache = _check_abs_path("ANVIL_CACHE_DIR", cache_dir)
    lock = _check_abs_path("ANVIL_FETCH_LOCK", fetch_lock)
    if lock == "/" or fetch_lock.endswith("/"):
        raise SubmitInputError(f"ANVIL_FETCH_LOCK must name a file (got {fetch_lock!r})")

    run = [
        '"$OPENGHM" sim run --config "$CONFIG"',
        f'"$CACHE/snapshots/{snapshot_id}"',
        f"--id {sim_id}",
    ]
    if run_start is not None:
        run.append(f"--run-start {shlex.quote(_check_date('run start', run_start))}")
    if run_end is not None:
        run.append(f"--run-end {shlex.quote(_check_date('run end', run_end))}")
    if output_vars is not None:
        run.append(f"--output-vars {shlex.quote(_check_output_vars(output_vars))}")
    run.append("--spool fresh")

    return "\n".join(
        [
            "set -euo pipefail",
            f"OPENGHM={shlex.quote(home + '/bin/openghm')}",
            f"CONFIG={shlex.quote(home + '/gateway.toml')}",
            f"CACHE={shlex.quote(cache)}",
            f'echo "openghm $("$OPENGHM" --version) commit {commit}"',
            'mkdir -p "$CACHE/snapshots"',
            f'flock {shlex.quote(lock)} "$OPENGHM" snapshot fetch --config "$CONFIG" '
            f'{snapshot_id} --dest "$CACHE/snapshots/{snapshot_id}" --spool skip',
            " ".join(run),
        ]
    )


def _check_date(kind: str, value: str) -> str:
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise SubmitInputError(f"The {kind} must be a date like 2000-01-31 (got {value!r}).")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise SubmitInputError(f"The {kind} {value!r} is not a real date.")
    return value


def _check_output_vars(value: str) -> str:
    names = value.split(" ")
    if not value or not all(_VARIABLE_RE.match(n) for n in names):
        raise SubmitInputError(
            "Output variables must be names made of letters, digits and underscores."
        )
    return value


# ---------------------------------------------------------------------------
# SLURM --time
# ---------------------------------------------------------------------------

_SLURM_TIME_RE = re.compile(r"^(?:(\d+)-)?(\d+)(?::(\d{1,2}))?(?::(\d{1,2}))?$")


def parse_slurm_time(value: str) -> int:
    """Seconds in a SLURM `--time` value: `M`, `M:S`, `H:M:S`, `D-H`,
    `D-H:M` or `D-H:M:S`. `15:00` is fifteen minutes, not fifteen hours.
    Mirrored by `parseSlurmTime` in the frontend's lib/jobs/compute.ts."""
    m = _SLURM_TIME_RE.match(value.strip())
    if not m:
        raise SubmitInputError(f"{value!r} is not a SLURM time")
    days, a, b, c = m.groups()
    a = int(a)
    b = None if b is None else int(b)
    c = None if c is None else int(c)
    if days is not None:
        return int(days) * 86400 + a * 3600 + (b or 0) * 60 + (c or 0)
    if b is None:
        return a * 60
    if c is None:
        return a * 60 + b
    return a * 3600 + b * 60 + c


def format_slurm_time(seconds: int) -> str:
    """`M:SS` under an hour, `H:MM:SS` from an hour up (hours are not capped)."""
    h, rest = divmod(seconds, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def with_headroom(walltime: str) -> str:
    """A snapshot's recommended walltime plus 50%, in SLURM's format, rounded
    up to a whole second: `15:00` becomes `22:30`, `4:30:00` becomes
    `6:45:00`. A run of the v2 snapshot took 13:49 of its recommended 15:00,
    so the bare recommendation leaves no room. Applied only to a snapshot's
    value; a walltime the user chose is sent as given. Mirrored by
    `withHeadroom` in the frontend's lib/jobs/compute.ts."""
    return format_slurm_time((parse_slurm_time(walltime) * 3 + 1) // 2)


# ---------------------------------------------------------------------------
# What the draft asks for, against what the snapshot already says
# ---------------------------------------------------------------------------


def snapshot_defaults(snapshot: dict) -> JobParameters:
    """The parameters a new simulation starts with, read from a snapshot's
    `simulation` block: the temporal coverage and output variables it was run
    with. The one place these defaults are derived — the draft is created from
    it (`jobs._derive_simulation_parameters`) and the submit compares against
    it (`run_overrides`), so the two cannot drift."""
    simulation = snapshot.get("simulation", {})
    temporal = simulation.get("temporalCoverage", {})
    return JobParameters(
        temporal_range_start=str(temporal.get("start", "")),
        temporal_range_end=str(temporal.get("end", "")),
        variables=[v["name"] for v in simulation.get("outputVariables", [])],
    )


@dataclass(frozen=True)
class RunOverrides:
    """The `sim run` flags a draft needs. `None` means "the snapshot's own
    value": no flag is passed and the toolkit's init is untouched."""

    run_start: str | None = None
    run_end: str | None = None
    output_vars: str | None = None


def run_overrides(parameters: JobParameters, snapshot: dict) -> RunOverrides:
    """The flags that turn the snapshot's init into the draft's run, in the
    toolkit's formats: dates as `YYYY-MM-DD`, output variables as one
    space-separated string (WBM's `Output_vars` is whitespace-separated).

    A value equal to the snapshot's own is not passed: a draft left at its
    defaults runs the published init, which is what makes its output
    comparable with the published one. Raises `SubmitInputError` for a period
    that is not two real dates in order, or for no output variable at all.
    """
    defaults = snapshot_defaults(snapshot)
    start = _check_date("run start", parameters.temporal_range_start)
    end = _check_date("run end", parameters.temporal_range_end)
    if start > end:
        raise SubmitInputError("The run start must not be after the run end.")
    if not parameters.variables:
        raise SubmitInputError("Choose at least one output variable.")
    if not all(_VARIABLE_RE.match(n) for n in parameters.variables):
        raise SubmitInputError(
            "Output variables must be names made of letters, digits and underscores."
        )
    output_vars = " ".join(parameters.variables)
    return RunOverrides(
        run_start=start if start != defaults.temporal_range_start else None,
        run_end=end if end != defaults.temporal_range_end else None,
        output_vars=(
            output_vars if parameters.variables != defaults.variables else None
        ),
    )


def unsupported_fields(
    parameters: JobParameters, model_input_id: str | None, snapshot: dict
) -> list[str]:
    """The fields of a draft the toolkit has no flag for yet (ADR 0025,
    open item 9): a model-input override, a spatial domain other than the
    snapshot's own, custom init parameters. A submit that names any of them is
    refused rather than run without them."""
    fields: list[str] = []
    if model_input_id:
        fields.append("model_input_id")
    if parameters.spatial_domain is not None and not _is_snapshot_domain(
        parameters.spatial_domain, snapshot
    ):
        fields.append("parameters.spatial_domain")
    if parameters.custom_params:
        fields.append("parameters.custom_params")
    return fields


def _is_snapshot_domain(domain, snapshot: dict) -> bool:
    coverage = snapshot.get("simulation", {}).get("spatialCoverage")
    if not coverage:
        return False
    pairs = (
        (domain.north, coverage.get("northlimit")),
        (domain.south, coverage.get("southlimit")),
        (domain.east, coverage.get("eastlimit")),
        (domain.west, coverage.get("westlimit")),
    )
    return all(
        isinstance(other, (int, float)) and math.isclose(ours, other, abs_tol=1e-9)
        for ours, other in pairs
    )
