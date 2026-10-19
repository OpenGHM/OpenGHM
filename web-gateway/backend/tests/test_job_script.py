"""The bash body a gateway job runs (ADR 0025): a golden for the default v2
draft, the flags a changed draft adds, and hostile inputs.

Pure: no Mongo, no request, no SSH.
"""

from __future__ import annotations

import json
import shlex
import subprocess
from pathlib import Path

import pytest

from app.models.job import JobParameters, SlurmConfig, SpatialDomain
from app.services import job_script
from app.services.job_script import SubmitInputError, render_job_body

EXAMPLE = (
    Path(__file__).parents[3]
    / "schemas/snapshot-spec/examples/wbm_storage_v2.0.0.json"
)
HOME = "/home/x-openghm/apps/openghm/abc1234"
CACHE = "/anvil/scratch/x-openghm/cache"
LOCK = "/home/x-openghm/apps/openghm/locks/fetch.lock"
SNAPSHOT_ID = "fc66a2cdeee9d456f83bc0b0a6f00cd447b0194c124a3bb4008a02990779ec89"
SIM_ID = "sim-20260930-0a1b2c"
WORK_DIR = f"/anvil/scratch/x-openghm/simulations/{SIM_ID}"


@pytest.fixture(scope="module")
def v2() -> dict:
    return json.loads(EXAMPLE.read_text())


def _body(**overrides) -> str:
    kwargs = dict(
        snapshot_id=SNAPSHOT_ID,
        sim_id=SIM_ID,
        openghm_home=HOME,
        cache_dir=CACHE,
        fetch_lock=LOCK,
        work_dir=WORK_DIR,
    )
    return render_job_body(**{**kwargs, **overrides})


def _params(snapshot: dict, **changes) -> JobParameters:
    return job_script.snapshot_defaults(snapshot).model_copy(update=changes)


# ---- golden ----------------------------------------------------------------


def test_default_v2_draft_renders_the_golden_body_with_no_overrides(v2):
    overrides = job_script.run_overrides(_params(v2), v2)
    assert overrides == job_script.RunOverrides(None, None, None)
    body = _body(**overrides.__dict__)
    assert body == f"""\
set -euo pipefail
OPENGHM={HOME}/bin/openghm
CONFIG={HOME}/gateway.toml
CACHE={CACHE}
PY={HOME}/venv/bin/python
export OG_SNAPSHOT_ID={SNAPSHOT_ID} OG_SIM_ID={SIM_ID} OG_COMMIT=abc1234
export OG_WORK_DIR={WORK_DIR}
OG_STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OG_PHASE=fetch OG_SIGNAL= STEP_RC=0
export OG_STARTED OG_PHASE OG_SIGNAL OG_RC_fetch OG_RC_run
step() {{
  OG_PHASE=$1; shift
  eval "OG_RC_$OG_PHASE="
  local rc=0
  "$@" || rc=$?
  eval "OG_RC_$OG_PHASE=$rc"
  [ "$rc" -eq 0 ] || STEP_RC=$rc
  return "$rc"
}}
finish() {{
  local status=$?
  set +e
  trap - EXIT
  "$PY" - <<'PYEOF'
{job_script.OUTCOME_PY}PYEOF
  local verdict=$?
  if [ "$verdict" -ne 0 ] && [ "$verdict" -ne 10 ]; then
    echo "openghm: outcome.json was not written" >&2
  fi
  [ "$status" -ne 0 ] && exit "$status"
  [ "$STEP_RC" -ne 0 ] && exit "$STEP_RC"
  case $verdict in
    0) exit 0 ;;
    10) exit 3 ;;
    *) exit 4 ;;
  esac
}}
trap finish EXIT
trap 'OG_SIGNAL=TERM; exit 143' TERM
trap 'OG_SIGNAL=INT; exit 130' INT
trap 'OG_SIGNAL=HUP; exit 129' HUP
if [ "${{SLURM_RESTART_COUNT:-0}}" != 0 ]; then
  echo "openghm: SLURM requeued this job (restart count $SLURM_RESTART_COUNT); not running it again" >&2
  exit 75
fi
if [ -n "${{SLURM_JOB_ID:-}}" ]; then
  scontrol update JobId="$SLURM_JOB_ID" Requeue=0 \\
    || echo "openghm: warning: could not turn requeueing off for this job" >&2
fi
echo "openghm $("$OPENGHM" --version) commit abc1234"
mkdir -p "$CACHE/snapshots"
step fetch flock {LOCK} "$OPENGHM" snapshot fetch --config "$CONFIG" {SNAPSHOT_ID} --dest "$CACHE/snapshots/{SNAPSHOT_ID}"
step run "$OPENGHM" sim run --config "$CONFIG" "$CACHE/snapshots/{SNAPSHOT_ID}" --id {SIM_ID} --spool cache
OG_PHASE=check"""


def test_the_requeue_guard_comes_before_the_fetch_and_after_the_traps(v2):
    body = _body()
    guard = body.index('if [ "${SLURM_RESTART_COUNT')
    assert body.index("trap 'OG_SIGNAL=HUP") < guard < body.index("step fetch")
    assert body.index("Requeue=0") < body.index("step fetch")


def test_the_outcome_writer_is_python_3_9_stdlib_only():
    """It runs in the toolkit venv on Anvil (3.9): no `X | Y`, no `match`, and
    nothing outside the standard library."""
    import ast

    tree = ast.parse(job_script.OUTCOME_PY, feature_version=(3, 9))
    imported = {
        alias.name.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in (node.names if isinstance(node, ast.Import) else [ast.alias(node.module)])
    }
    assert imported <= {"json", "os", "re", "socket", "sys", "tempfile", "collections", "datetime"}


def test_a_changed_period_and_variables_add_exactly_those_flags(v2):
    params = _params(
        v2,
        temporal_range_start="2000-06-01",
        temporal_range_end="2001-06-30",
        variables=["runoff", "discharge"],
    )
    overrides = job_script.run_overrides(params, v2)
    assert overrides == job_script.RunOverrides(
        "2000-06-01", "2001-06-30", "runoff discharge"
    )
    run_line = _body(**overrides.__dict__).splitlines()[-2]
    assert run_line == (
        f'step run "$OPENGHM" sim run --config "$CONFIG" "$CACHE/snapshots/{SNAPSHOT_ID}" '
        f"--id {SIM_ID} --run-start 2000-06-01 --run-end 2001-06-30 "
        "--output-vars 'runoff discharge' --spool cache"
    )


def test_only_what_differs_from_the_snapshot_is_passed(v2):
    only_end = job_script.run_overrides(_params(v2, temporal_range_end="2000-12-31"), v2)
    assert only_end == job_script.RunOverrides(None, "2000-12-31", None)
    only_vars = job_script.run_overrides(_params(v2, variables=["runoff"]), v2)
    assert only_vars == job_script.RunOverrides(None, None, "runoff")


def test_the_body_is_valid_bash(v2):
    body = _body(run_start="2000-06-01", output_vars="runoff discharge")
    subprocess.run(["bash", "-n"], input=body, text=True, check=True)


# ---- the period and variables a draft may ask for ---------------------------


@pytest.mark.parametrize(
    "changes",
    [
        {"temporal_range_start": "2001-13-01"},  # not a date
        {"temporal_range_start": "2000-1-1"},  # not YYYY-MM-DD
        {"temporal_range_end": "2000-01-01; rm -rf ~"},
        {"temporal_range_start": "2002-01-01"},  # after the end
        {"variables": []},
        {"variables": ["runoff", "x; rm -rf ~"]},
        {"variables": ["run off"]},
        {"variables": ["$(id)"]},
    ],
)
def test_a_draft_that_is_not_a_run_is_refused(v2, changes):
    with pytest.raises(SubmitInputError):
        job_script.run_overrides(_params(v2, **changes), v2)


# ---- hostile inputs reaching the renderer -----------------------------------


@pytest.mark.parametrize(
    "bad",
    ["", "a b", "x;rm -rf ~", "$(id)", "a'b", 'a"b', "../etc", "..", ".", "-rf", "a/b", "a\nb"],
)
@pytest.mark.parametrize("field", ["snapshot_id", "sim_id"])
def test_a_bad_id_is_refused(field, bad):
    with pytest.raises(SubmitInputError):
        _body(**{field: bad})


@pytest.mark.parametrize(
    "field, bad",
    [
        ("openghm_home", "relative/path"),
        ("openghm_home", "/home/x/apps/openghm/abc;id"),
        ("openghm_home", '/home/x/apps/openghm/a"b'),
        ("openghm_home", "/home/x/apps/openghm/$(id)"),
        ("cache_dir", "cache"),
        ("cache_dir", "/cache\nrm -rf ~"),
        ("fetch_lock", "fetch.lock"),
        ("fetch_lock", "/locks/"),
        ("fetch_lock", "/"),
        ("fetch_lock", "/locks/a\nb"),
    ],
)
def test_a_bad_path_is_refused(field, bad):
    with pytest.raises(SubmitInputError):
        _body(**{field: bad})


def test_paths_with_shell_metacharacters_are_quoted_not_executed():
    """A path may contain a space or a `$`; it reaches bash as one word."""
    body = _body(cache_dir="/scratch/my cache/$HOME")
    (assign,) = [l for l in body.splitlines() if l.startswith("CACHE=")]
    assert shlex.split(assign) == ["CACHE=/scratch/my cache/$HOME"]


def test_the_fetch_lock_is_outside_the_cache_and_quoted():
    """The lock is the path given, not `$CACHE/fetch.lock` (flock on scratch does
    not lock across nodes), and a path with a space or `$` stays one word."""
    body = _body()
    assert '"$CACHE/fetch.lock"' not in body
    assert f"step fetch flock {LOCK} " in body
    hostile = _body(fetch_lock="/home/x/my locks/$HOME/fetch.lock")
    (line,) = [l for l in hostile.splitlines() if l.startswith("step fetch flock ")]
    assert shlex.split(line)[3] == "/home/x/my locks/$HOME/fetch.lock"


@pytest.mark.parametrize(
    "flag, value",
    [
        ("run_start", "2000-01-01'; touch /tmp/x; echo '"),
        ("run_end", "$(touch /tmp/x)"),
        ("output_vars", "runoff; touch /tmp/x"),
        ("output_vars", ""),
    ],
)
def test_a_hostile_flag_value_is_refused(flag, value):
    with pytest.raises(SubmitInputError):
        _body(**{flag: value})


# ---- SLURM time and the walltime headroom -----------------------------------


@pytest.mark.parametrize(
    "value, seconds",
    [("15", 900), ("15:00", 900), ("01:30:00", 5400), ("111:30:00", 401400),
     ("1-12", 129600), ("1-12:30:15", 131415)],
)
def test_slurm_time_is_read_the_way_slurm_reads_it(value, seconds):
    assert job_script.parse_slurm_time(value) == seconds


def test_a_non_time_is_refused():
    with pytest.raises(SubmitInputError):
        job_script.parse_slurm_time("soon")


@pytest.mark.parametrize(
    "recommended, with_headroom",
    [
        ("15:00", "22:30"),  # the v2 example: 13:49 of 15:00 needed
        ("4:30:00", "6:45:00"),
        ("04:30:00", "6:45:00"),
        ("10:00", "15:00"),
        ("1:00", "1:30"),
        ("60", "1:30:00"),  # bare number: 60 minutes
        ("1-00:00:00", "36:00:00"),
        ("0:01", "0:02"),  # 1 s -> 1.5 s, rounded up
        ("80:00:00", "96:00:00"),  # 120 h would be over the limit: capped
        ("64:00:00", "96:00:00"),  # exactly the limit
        ("111:30:00", "96:00:00"),  # the recommendation alone is over it
    ],
)
def test_headroom_is_half_again_in_slurms_format_and_never_over_the_limit(
    recommended, with_headroom
):
    assert job_script.with_headroom(recommended) == with_headroom


def _recommending(walltime, step=None):
    compute = {"cores": 16, "walltime": walltime}
    if step is not None:
        compute["postProcessingWalltime"] = step
    return {"simulation": {"recommendedCompute": compute}}


def test_the_recommended_walltime_adds_the_post_processing_time_only_when_the_run_has_it():
    snapshot = _recommending("15:00", "1:30:00")
    assert job_script.recommended_walltime(snapshot) == "15:00"
    assert job_script.recommended_walltime(snapshot, True) == "1:45:00"
    assert job_script.recommended_walltime(_recommending("15:00"), True) == "15:00"
    assert job_script.recommended_walltime({"simulation": {}}, True) is None
    assert job_script.post_processing_walltime(snapshot) == "1:30:00"
    assert job_script.post_processing_walltime(_recommending("15:00")) is None
    assert job_script.post_processing_walltime(_recommending("15:00", "soon")) is None


@pytest.mark.parametrize(
    "walltime, step, post_processing, seconds",
    [
        ("15:00", None, False, 15 * 60),
        ("111:30:00", None, False, 111 * 3600 + 30 * 60),
        ("120:00:00", None, False, 120 * 3600),  # not capped at one job's 96 h
        ("80:00:00", "20:00:00", True, 100 * 3600),
        ("80:00:00", "20:00:00", False, 80 * 3600),
        ("0:00:01", None, False, 1),
        ("not a time", None, False, None),
    ],
)
def test_the_estimated_run_time_is_the_recommendation_as_it_is_and_not_capped(
    walltime, step, post_processing, seconds
):
    assert job_script.estimated_run_seconds(_recommending(walltime, step), post_processing) == seconds
    assert job_script.estimated_run_seconds({"simulation": {}}, post_processing) is None


def test_a_run_is_over_the_limit_only_above_two_weeks():
    assert job_script.run_over_limit(_recommending("336:00:00")) is None  # 336 h exactly
    assert job_script.run_over_limit(_recommending("336:00:01")) == 336 * 3600 + 1
    assert job_script.run_over_limit(_recommending("300:00:00", "40:00:00"), True) == 340 * 3600
    assert job_script.run_over_limit(_recommending("300:00:00", "40:00:00")) is None
    assert job_script.run_over_limit({"simulation": {}}) is None


@pytest.mark.parametrize(
    "seconds, text",
    [(111 * 3600 + 30 * 60, "111 h 30 min"), (4 * 3600, "4 h"), (22 * 60 + 30, "22 min 30 s"), (45, "45 s")],
)
def test_hours_are_written_however_long(seconds, text):
    assert job_script.describe_hours(seconds) == text


@pytest.mark.parametrize(
    "draft, own, expected",
    [
        ("climatology", "standard", True),
        ("climatology", None, True),
        (None, "climatology", True),
        ("climatology", "climatology", True),
        ("standard", "climatology", False),
        (None, "standard", False),
        (None, "none", False),
        (None, None, False),
    ],
)
def test_a_run_post_processes_when_the_draft_asks_or_asks_nothing_and_the_snapshot_does(draft, own, expected):
    parameters = JobParameters(
        temporal_range_start="2000-01-01", temporal_range_end="2000-12-31", post_processing=draft
    )
    assert job_script.runs_climatology(parameters, own) is expected


# ---- what the toolkit cannot do yet -----------------------------------------


def test_the_snapshots_own_defaults_have_no_unsupported_fields(v2):
    assert job_script.unsupported_fields(_params(v2), None, v2) == []


def test_each_unsupported_field_is_named(v2):
    coverage = v2["simulation"]["spatialCoverage"]
    same = SpatialDomain(
        north=coverage["northlimit"],
        south=coverage["southlimit"],
        east=coverage["eastlimit"],
        west=coverage["westlimit"],
    )
    smaller = same.model_copy(update={"north": coverage["northlimit"] - 1})
    assert job_script.unsupported_fields(_params(v2, spatial_domain=same), None, v2) == []
    assert job_script.unsupported_fields(_params(v2, spatial_domain=smaller), None, v2) == [
        "parameters.spatial_domain"
    ]
    assert job_script.unsupported_fields(_params(v2), "some-model-input", v2) == [
        "model_input_id"
    ]
    assert job_script.unsupported_fields(_params(v2, custom_params={"a": "1"}), None, v2) == [
        "parameters.custom_params"
    ]
    assert job_script.unsupported_fields(_params(v2, custom_params={}), None, v2) == []


# ---- the walltime the toolkit's spool lease lasts for ------------------------


@pytest.mark.parametrize("walltime", ["22:30", "96:00:00", "4-00:00:00", "1:05:09"])
def test_the_walltime_asked_of_slurm_is_passed_to_sim_run(walltime):
    run_line = _body(walltime=walltime).splitlines()[-2]
    assert run_line == (
        f'step run "$OPENGHM" sim run --config "$CONFIG" "$CACHE/snapshots/{SNAPSHOT_ID}" '
        f"--id {SIM_ID} --walltime {walltime} --spool cache"
    )


def test_the_walltime_comes_after_the_overrides_and_before_the_spool():
    run_line = _body(run_start="2000-06-01", output_vars="runoff", walltime="22:30").splitlines()[-2]
    assert run_line.endswith("--run-start 2000-06-01 --output-vars runoff --walltime 22:30 --spool cache")


def test_without_a_walltime_no_flag_is_passed():
    assert "--walltime" not in _body()


@pytest.mark.parametrize("walltime", ["22:30; rm -rf ~", "$(reboot)", "", "0", "0:00:00", "soon", "1 2"])
def test_a_walltime_that_is_not_a_slurm_time_is_refused(walltime):
    with pytest.raises(SubmitInputError):
        _body(walltime=walltime)


def test_the_flag_carries_the_value_the_submit_gives_sbatch(v2):
    """One resolution feeds both (`slurm.resolve_compute`): the snapshot's
    walltime with headroom, whatever a stored draft may still hold."""
    from app.services import slurm

    _, from_snapshot = slurm.resolve_compute(SlurmConfig(), v2)
    _, stored = slurm.resolve_compute(SlurmConfig(walltime="02:00:00"), v2)
    assert stored == from_snapshot
    assert f"--walltime {from_snapshot} " in _body(walltime=from_snapshot)
