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

from app.models.job import JobParameters, SpatialDomain
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
echo "openghm $("$OPENGHM" --version) commit abc1234"
mkdir -p "$CACHE/snapshots"
flock {LOCK} "$OPENGHM" snapshot fetch --config "$CONFIG" {SNAPSHOT_ID} --dest "$CACHE/snapshots/{SNAPSHOT_ID}" --spool skip
"$OPENGHM" sim run --config "$CONFIG" "$CACHE/snapshots/{SNAPSHOT_ID}" --id {SIM_ID} --spool fresh"""


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
    run_line = _body(**overrides.__dict__).splitlines()[-1]
    assert run_line == (
        f'"$OPENGHM" sim run --config "$CONFIG" "$CACHE/snapshots/{SNAPSHOT_ID}" '
        f"--id {SIM_ID} --run-start 2000-06-01 --run-end 2001-06-30 "
        "--output-vars 'runoff discharge' --spool fresh"
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
    assert f"flock {LOCK} " in body
    hostile = _body(fetch_lock="/home/x/my locks/$HOME/fetch.lock")
    (line,) = [l for l in hostile.splitlines() if l.startswith("flock ")]
    assert shlex.split(line)[1] == "/home/x/my locks/$HOME/fetch.lock"


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
    ],
)
def test_headroom_is_half_again_in_slurms_format(recommended, with_headroom):
    assert job_script.with_headroom(recommended) == with_headroom


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
