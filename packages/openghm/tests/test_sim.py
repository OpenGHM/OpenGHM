"""``sim submit`` — build contract, per-sim init normalization, staging, errors.

Asserts structure (mounts, split read/write, generated init/sbatch) rather than
byte-identical goldens, matching test_dryrun's style.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from openghm import Config
from openghm.errors import OpenghmError
from openghm.run import stage_files
from openghm.sim import (
    SubmitOptions, build_submit, parse_slurm_job_id, record_slurm_job_id, sidecar_path,
    list_simulations, find_simulation, resolve_job_id, read_sidecar,
    build_sacct_argv, parse_sacct, sacct_primary, build_scancel_argv,
    slurm_log_path, tail_lines,
)

REPO = Path(__file__).resolve().parents[1]

_INIT_TEMPLATE = """{
  MT_Code_Name => {
    Output_dir => 'wbm/wbm_output/WBM_test',
    spool_dir  => 'spool/',
    Run_Start  => '2000-01-01',
    Run_End    => '2000-12-31',
  },
  Spinup => { Start => '2000-01-01', End => '2000-12-31', Loops => 1 },
  Output_vars => "runoff discharge",
}
"""

_METADATA = {
    "slug": "wbm_storage_v2.0.0",
    "datasetType": "snapshot",
    "title": "WBM v2.0.0 tutorial",
    "softwareVersion": "WBM v2.0.0",
    "recommendedComputeSetting": ["16", "15:00"],
    "jobSubmission": {
        "init": "wbm_test.init",
        "wbmVersion": "2.0.0",
        "dataSubdir": "wbm_ancillary_data_v2.0.0",
        "cores": 16,
        "walltime": "15:00",
    },
}


def _make_snapshot(root: Path, *, metadata=_METADATA, init_name="wbm_test.init",
                   data_subdirs=("wbm_ancillary_data_v2.0.0",), write_init=True) -> Path:
    snap = root / "wbm_storage_v2.0.0"
    for d in ("data", "data_init", "model", "utilities", "gdal_test_files", "wbm_init"):
        (snap / d).mkdir(parents=True, exist_ok=True)
    for sub in data_subdirs:
        (snap / "data" / sub).mkdir(parents=True, exist_ok=True)
    if metadata is not None:
        (snap / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    if write_init:
        (snap / "wbm_init" / init_name).write_text(_INIT_TEMPLATE, encoding="utf-8")
    return snap


def _config(tmp_path: Path) -> Config:
    return Config(output_base=str(tmp_path / "out"), sif_dir=str(tmp_path / "sif"),
                  account="ees260008", partition="shared")


def _find(built, container):
    return next(m for m in built.mounts if m.container == container)


def _gen(built, endswith):
    return next(f for f in built.generated_files if f.host_path.endswith(endswith))


# ── build contract ────────────────────────────────────────────────────────────


def test_submit_split_mounts_and_sif(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))

    assert _ctx.image == str(tmp_path / "sif" / "wbm" / "2.0.0" / "wbm_opensource_v2.0.0.sif")
    # reads come from the snapshot, bound read-only
    assert _find(built, "/wbm/data").readonly is True
    assert _find(built, "/wbm/data").host == str(snap / "data" / "wbm_ancillary_data_v2.0.0")
    assert _find(built, "/wbm/model").readonly is True
    # writes go to per-sim scratch, writable
    for cpath in ("/wbm/spool", "/wbm/wbm_output", "/wbm/WBM_run_state"):
        m = _find(built, cpath)
        assert m.readonly is False
        assert m.host.startswith(str(tmp_path / "out" / "sim1"))
    # per-sim wbm_init overrides the snapshot's
    assert _find(built, "/wbm/wbm_init").host == str(tmp_path / "out" / "sim1" / "wbm_init")
    assert built.inner_cmd == ["/wbm/model/wbm.pl", "/wbm/wbm_init/wbm_test.init"]
    assert built.argv[0] == "sbatch"


def test_submit_staging_lists(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    base = str(tmp_path / "out" / "sim1")
    assert set(built.staged_dirs) == {f"{base}/spool", f"{base}/wbm_output", f"{base}/WBM_run_state"}
    assert len(built.staged_copies) == 1
    assert built.staged_copies[0].src == str(snap / "wbm_init")
    assert built.staged_copies[0].dst == f"{base}/wbm_init"


def test_persim_init_normalizes_paths_and_overrides(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_submit(
        SubmitOptions(snapshot_dir=str(snap), simulation_id="sim-abc",
                      run_end="2001-12-31", spinup_loops=2, output_vars="runoff"),
        _config(tmp_path),
    )
    init = _gen(built, "wbm_init/wbm_test.init").content
    assert "Output_dir => '/wbm/wbm_output/sim-abc'" in init  # was relative
    assert "spool_dir  => '/wbm/spool/'" in init              # was 'spool/'
    assert "Run_Start  => '2000-01-01'" in init               # untouched
    assert "Run_End    => '2001-12-31'" in init               # overridden
    assert "Output_vars => 'runoff'" in init                  # overridden
    assert "Loops => 2" in init
    # \bStart\b must not have clobbered Run_Start
    assert "Start => '2000-01-01'" in init


def test_persim_init_without_spool_dir(tmp_path):
    # the real v2 wbm_test.init has no spool_dir (spool defaults to the mount) — must not error
    init_no_spool = "{\n  MT_Code_Name => { Output_dir => 'wbm/wbm_output/WBM_test' },\n}\n"
    snap = _make_snapshot(tmp_path)
    (snap / "wbm_init" / "wbm_test.init").write_text(init_no_spool, encoding="utf-8")
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    init = _gen(built, "wbm_init/wbm_test.init").content
    assert "Output_dir => '/wbm/wbm_output/sim1'" in init
    assert "spool_dir" not in init  # not injected


def test_sbatch_script_has_slurm_directives(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_submit(
        SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1", cores=32, walltime="2:00:00"),
        _config(tmp_path),
    )
    sb = _gen(built, ".sbatch").content
    assert "#SBATCH --cpus-per-task=32" in sb          # CLI override wins over metadata
    assert "#SBATCH --time=2:00:00" in sb
    assert "#SBATCH --account=ees260008" in sb
    assert "singularity exec -B " in sb
    assert "wbm_opensource_v2.0.0.sif /wbm/model/wbm.pl /wbm/wbm_init/wbm_test.init" in sb


def test_sidecar_records_provenance(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_submit(
        SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1", user_info="alice@x.edu"),
        _config(tmp_path), now="2026-07-05T00:00:00Z",
    )
    sidecar = json.loads(_gen(built, "simulation.json").content)
    assert sidecar["simulation_id"] == "sim1"
    assert sidecar["init"] == "wbm_test.init"
    assert sidecar["wbm_version"] == "2.0.0"
    assert sidecar["user_info"] == "alice@x.edu"
    assert sidecar["submitted_at"] == "2026-07-05T00:00:00Z"
    assert sidecar["slurm_job_id"] is None


def test_cwd_default(tmp_path, monkeypatch):
    snap = _make_snapshot(tmp_path)
    monkeypatch.chdir(snap)
    _ctx, built = build_submit(SubmitOptions(simulation_id="sim1"), _config(tmp_path))  # no path → cwd
    assert _find(built, "/wbm/data").host == str(snap / "data" / "wbm_ancillary_data_v2.0.0")


def test_metadata_derivation_fallback(tmp_path):
    # No jobSubmission wbmVersion/dataSubdir → derive from softwareVersion + single data/ subdir
    meta = json.loads(json.dumps(_METADATA))
    meta["jobSubmission"] = {"init": "wbm_test.init"}
    snap = _make_snapshot(tmp_path, metadata=meta)
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    assert _ctx.image.endswith("wbm_opensource_v2.0.0.sif")
    assert _find(built, "/wbm/data").host.endswith("wbm_ancillary_data_v2.0.0")


# ── real host staging (no sbatch spawn) ────────────────────────────────────────


def test_stage_files_creates_dirs_copies_and_init(tmp_path):
    snap = _make_snapshot(tmp_path)
    # a sibling file in wbm_init must survive the per-sim copy
    (snap / "wbm_init" / "shared.pm").write_text("1;\n", encoding="utf-8")
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))

    stage_files(built)
    base = tmp_path / "out" / "sim1"
    for d in ("spool", "wbm_output", "WBM_run_state"):
        assert (base / d).is_dir()
    assert (base / "wbm_init" / "shared.pm").is_file()          # copied
    init = (base / "wbm_init" / "wbm_test.init").read_text()
    assert "Output_dir => '/wbm/wbm_output/sim1'" in init       # generated wins over copy
    assert json.loads((base / "simulation.json").read_text())["simulation_id"] == "sim1"


# ── slurm job id recording ─────────────────────────────────────────────────────


@pytest.mark.parametrize("text,expected", [
    ("Submitted batch job 18875449\n", "18875449"),
    ("Submitted batch job 42", "42"),
    ("sbatch: error: something\n", None),
    ("", None),
    (None, None),
])
def test_parse_slurm_job_id(text, expected):
    assert parse_slurm_job_id(text) == expected


def test_record_slurm_job_id_updates_sidecar(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    stage_files(built)  # writes simulation.json with slurm_job_id=null
    assert json.loads(Path(sidecar_path(built)).read_text())["slurm_job_id"] is None

    path = record_slurm_job_id(built, "18875449")
    assert path == sidecar_path(built)
    assert json.loads(Path(path).read_text())["slurm_job_id"] == "18875449"


def test_record_slurm_job_id_no_sidecar_on_disk(tmp_path):
    # not staged yet → no-op, returns None (does not raise)
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    assert record_slurm_job_id(built, "999") is None


# ── error paths ────────────────────────────────────────────────────────────────


def test_missing_metadata(tmp_path):
    snap = _make_snapshot(tmp_path, metadata=None)
    with pytest.raises(OpenghmError, match="metadata.json"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))


def test_missing_init_file(tmp_path):
    snap = _make_snapshot(tmp_path, write_init=False)
    with pytest.raises(OpenghmError, match="init file not found"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))


def test_no_job_submission_block(tmp_path):
    meta = {"slug": "x", "softwareVersion": "WBM v2.0.0"}
    snap = _make_snapshot(tmp_path, metadata=meta)
    with pytest.raises(OpenghmError, match="jobSubmission"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))


def test_bad_sim_id(tmp_path):
    snap = _make_snapshot(tmp_path)
    with pytest.raises(OpenghmError, match="--id"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="bad/id"), _config(tmp_path))


@pytest.mark.parametrize("subdirs", [(), ("a", "b")])
def test_ambiguous_data_subdir(tmp_path, subdirs):
    meta = json.loads(json.dumps(_METADATA))
    meta["jobSubmission"] = {"init": "wbm_test.init", "wbmVersion": "2.0.0"}  # force derivation
    snap = _make_snapshot(tmp_path, metadata=meta, data_subdirs=subdirs)
    with pytest.raises(OpenghmError, match="exactly one subdirectory"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))


# ── shipped metadata.json files ────────────────────────────────────────────────


@pytest.mark.parametrize("name", [
    "wbm_storage_v2.0.0", "wbm_storage_v1.0.0_Global", "wbm_storage_v1.0.0_Wyoming",
])
def test_exported_metadata_files_valid(name):
    path = REPO / "snapshots_metadata" / f"{name}.json"
    meta = json.loads(path.read_text())
    job = meta["jobSubmission"]
    assert job["init"].endswith(".init")
    assert job["wbmVersion"] and job["dataSubdir"]
    assert job["cores"] and job["walltime"]
    # full doc carried verbatim
    assert meta["datasetType"] == "snapshot" and "variablesMeasured" in meta


# ── management: list / status / logs / cancel (local, no SLURM) ─────────────────


def _write_sim(output_base: Path, sim_id: str, *, job_id=None, submitted_at=None, **extra) -> Path:
    """Write a minimal <output_base>/<sim_id>/simulation.json sidecar."""
    d = output_base / sim_id
    d.mkdir(parents=True, exist_ok=True)
    sidecar = {"simulation_id": sim_id, "slurm_job_id": job_id,
               "submitted_at": submitted_at, "wbm_version": "2.0.0",
               "cores": 16, "walltime": "15:00", **extra}
    (d / "simulation.json").write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
    return d


def test_list_simulations_newest_first_and_dir(tmp_path):
    base = tmp_path / "out"
    _write_sim(base, "old", job_id="100", submitted_at="2026-07-01T00:00:00Z")
    _write_sim(base, "new", job_id="200", submitted_at="2026-07-05T00:00:00Z")
    _write_sim(base, "mid", job_id="150", submitted_at="2026-07-03T00:00:00Z")
    (base / "not-a-sim").mkdir()  # dir without a sidecar is ignored
    records = list_simulations(str(base))
    assert [r["simulation_id"] for r in records] == ["new", "mid", "old"]
    assert records[0]["_dir"] == str(base / "new")


def test_list_simulations_missing_base_is_empty(tmp_path):
    assert list_simulations(str(tmp_path / "does-not-exist")) == []


def test_list_simulations_skips_unreadable_sidecar(tmp_path):
    base = tmp_path / "out"
    _write_sim(base, "good", job_id="1", submitted_at="2026-07-05T00:00:00Z")
    bad = base / "bad"
    bad.mkdir(parents=True)
    (bad / "simulation.json").write_text("{ not json", encoding="utf-8")
    assert [r["simulation_id"] for r in list_simulations(str(base))] == ["good"]


def test_find_simulation_by_id_and_by_jobid(tmp_path):
    base = tmp_path / "out"
    _write_sim(base, "sim-a", job_id="18875449", submitted_at="2026-07-05T00:00:00Z")
    by_id = find_simulation(str(base), "sim-a")
    by_job = find_simulation(str(base), "18875449")
    assert by_id and by_id["simulation_id"] == "sim-a"
    assert by_job and by_job["simulation_id"] == "sim-a"   # resolved via job-id scan
    assert find_simulation(str(base), "nope") is None


def test_resolve_job_id_variants(tmp_path):
    base = tmp_path / "out"
    _write_sim(base, "sim-a", job_id="18875449", submitted_at="2026-07-05T00:00:00Z")
    _write_sim(base, "sim-pending", job_id=None, submitted_at="2026-07-06T00:00:00Z")
    # by sim id → its recorded job id
    assert resolve_job_id(str(base), "sim-a") == ("18875449", find_simulation(str(base), "sim-a"))
    # raw numeric key with no matching sidecar → treated as a job id
    job_id, sidecar = resolve_job_id(str(base), "99999")
    assert job_id == "99999" and sidecar is None
    # known sim but no recorded job id → error
    with pytest.raises(OpenghmError, match="no recorded SLURM"):
        resolve_job_id(str(base), "sim-pending")
    # unknown, non-numeric → error
    with pytest.raises(OpenghmError, match="no simulation"):
        resolve_job_id(str(base), "ghost")


def test_build_sacct_and_scancel_argv():
    argv = build_sacct_argv("18875449")
    assert argv[:4] == ["sacct", "-j", "18875449", "-P"]
    assert "--noheader" in argv and any(a.startswith("--format=") and "State" in a for a in argv)
    assert build_scancel_argv("42") == ["scancel", "42"]


def test_parse_sacct_and_primary():
    out = (
        "18875449|wbm-sim1|COMPLETED|0:0|00:12:59|2026-07-06T05:47:00|2026-07-06T05:59:59|shared|16\n"
        "18875449.batch|batch|COMPLETED|0:0|00:12:59|2026-07-06T05:47:00|2026-07-06T05:59:59||16\n"
    )
    rows = parse_sacct(out)
    assert len(rows) == 2
    assert rows[0]["JobID"] == "18875449" and rows[0]["State"] == "COMPLETED"
    assert rows[0]["ExitCode"] == "0:0" and rows[0]["AllocCPUS"] == "16"
    # step row has an empty Partition (trailing field short) handled gracefully
    assert rows[1]["JobID"] == "18875449.batch"
    primary = sacct_primary(rows, "18875449")
    assert primary["JobID"] == "18875449"  # not the .batch step
    assert parse_sacct("") == [] and parse_sacct(None) == []
    assert sacct_primary([], "1") is None


def test_slurm_log_path_out_and_err(tmp_path):
    d = str(tmp_path / "out" / "sim1")
    assert slurm_log_path(d, "42") == os.path.join(d, "slurm-42.out")
    assert slurm_log_path(d, "42", err=True) == os.path.join(d, "slurm-42.err")


def test_tail_lines(tmp_path):
    p = tmp_path / "slurm-42.out"
    p.write_text("l1\nl2\nl3\nl4\nl5\n", encoding="utf-8")
    assert tail_lines(str(p), 2) == ["l4", "l5"]
    assert tail_lines(str(p), 0) == ["l1", "l2", "l3", "l4", "l5"]   # 0 → all
    assert tail_lines(str(p), 99) == ["l1", "l2", "l3", "l4", "l5"]  # n > len → all
    with pytest.raises(OpenghmError, match="log not found"):
        tail_lines(str(tmp_path / "missing.out"), 10)


def test_read_sidecar_roundtrip_and_error(tmp_path):
    d = _write_sim(tmp_path / "out", "sim1", job_id="7", submitted_at="2026-07-05T00:00:00Z")
    assert read_sidecar(str(d / "simulation.json"))["slurm_job_id"] == "7"
    with pytest.raises(OpenghmError, match="cannot read"):
        read_sidecar(str(tmp_path / "nope.json"))
