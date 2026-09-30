"""``sim submit`` — build contract, per-sim init normalization, staging, errors.

Asserts structure (mounts, split read/write, generated init/sbatch) rather than
byte-identical goldens, matching test_dryrun's style.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from openghm import Config, assets, spec
from openghm.errors import OpenghmError
from openghm.run import stage_files
from openghm.sim import (
    SubmitOptions, _set_perl_key, build_persim_init, build_submit, parse_slurm_job_id, record_slurm_job_id, sidecar_path,
    list_simulations, find_simulation, resolve_job_id, read_sidecar,
    build_sacct_argv, parse_sacct, sacct_primary, build_scancel_argv,
    slurm_log_path, tail_lines,
)

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

#: The snapshot spec's shape, trimmed to what ``sim submit`` reads. The full
#: documents live in ``schemas/snapshot-spec/examples/`` and are exercised by
#: ``test_spec_examples_submit`` below.
_METADATA = {
    "slug": "wbm_storage_v2.0.0",
    "simulation": {
        "init": "wbm_test.init",
        "recommendedCompute": {"cores": 16, "walltime": "15:00"},
    },
    "id": "1" * 64,
    "uses": {
        "container": {
            "image": "wbm-v2-lite", "version": "2.0.0", "digest": "sha256:" + "a" * 64,
            "https": "https://example.test/containers/wbm-v2-lite/2.0.0/wbm-v2-lite-2.0.0.sif",
        },
        "modelInput": {"id": "2" * 64},
    },
}


def _make_snapshot(root: Path, *, metadata=_METADATA, init_name="wbm_test.init",
                   write_init=True, cache_model_input=True) -> Path:
    """A snapshot tree (it has no ``data/`` or ``data_init/``) and its caches."""
    snap = root / "wbm_storage_v2.0.0"
    for d in ("model", "utilities", "gdal_test_files", "wbm_init"):
        (snap / d).mkdir(parents=True, exist_ok=True)
    if metadata is not None:
        (snap / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    if write_init:
        (snap / "wbm_init" / init_name).write_text(_INIT_TEMPLATE, encoding="utf-8")
    # the image the document pins, in the cache `_config` points at
    container = ((metadata or {}).get("uses") or {}).get("container")
    if container and all(container.get(k) for k in ("image", "version", "https")):
        pin = assets.spec_from_container({**container, "digest": "sha256:" + "0" * 64})
        sif = Path(_config(root).image_path(pin.image, pin.version, pin.filename))
        sif.parent.mkdir(parents=True, exist_ok=True)
        sif.write_bytes(b"")
    # the model input the document links, in the cache `_config` points at
    mid = (((metadata or {}).get("uses") or {}).get("modelInput") or {}).get("id")
    if mid and cache_model_input:
        (Path(_config(root).model_input_path(mid)) / "data_init").mkdir(parents=True, exist_ok=True)
    return snap


def _config(tmp_path: Path) -> Config:
    return Config(output_base=str(tmp_path / "out"), sif_dir=str(tmp_path / "sif"),
                  model_input_dir=str(tmp_path / "model-inputs"),
                  account="abc123456", partition="shared")


def _find(built, container):
    return next(m for m in built.mounts if m.container == container)


def _gen(built, endswith):
    return next(f for f in built.generated_files if f.host_path.endswith(endswith))


# ── build contract ────────────────────────────────────────────────────────────


def test_submit_split_mounts_and_sif(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))

    assert _ctx.image == str(tmp_path / "sif" / "wbm-v2-lite" / "2.0.0" / "wbm-v2-lite-2.0.0.sif")
    # reads come from the model input cache and the snapshot, bound read-only
    mi = str(tmp_path / "model-inputs" / ("2" * 64))
    assert _find(built, "/wbm/data").readonly is True
    assert _find(built, "/wbm/data").host == mi
    assert _find(built, "/wbm/data_init").readonly is True
    assert _find(built, "/wbm/data_init").host == mi + "/data_init"
    assert _find(built, "/wbm/model").readonly is True
    # writes go to per-sim scratch, writable
    for cpath in ("/wbm/wbm_output", "/wbm/WBM_run_state"):
        m = _find(built, cpath)
        assert m.readonly is False
        assert m.host.startswith(str(tmp_path / "out" / "sim1"))
    # the spool is the snapshot's own, in place, writable
    assert _find(built, "/wbm/spool").host == str(snap / "spool")
    assert _find(built, "/wbm/spool").readonly is False
    # per-sim wbm_init overrides the snapshot's
    assert _find(built, "/wbm/wbm_init").host == str(tmp_path / "out" / "sim1" / "wbm_init")
    assert built.inner_cmd == ["/wbm/model/wbm.pl", "/wbm/wbm_init/wbm_test.init"]
    assert built.argv[0] == "sbatch"


def test_submit_staging_lists(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    base = str(tmp_path / "out" / "sim1")
    assert set(built.staged_dirs) == {str(snap / "spool"), f"{base}/wbm_output", f"{base}/WBM_run_state"}
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


# the v2 wbm_test.init's MT_Code_Name block: Run_End but no Run_Start, tab-indented
_V2_INIT = (
    "{\n"
    "MT_Code_Name\t=>  {\n"
    "          File_Size\t=> 'year',\n"
    "          MT_ID\t\t=> 'WMB_test_runoff',\n"
    "          Output_dir\t=> '/wbm/wbm_output/sim-20260930-53366e',\n"
    "          Run_End\t=> '2001-12-31'\n"
    "        },\n"
    "}\n"
)


# the same block without File_Size: --run-start is unchecked, so any date goes
_V2_FREE = _V2_INIT.replace("          File_Size\t=> 'year',\n", "")


def _build(template, **kw):
    return build_persim_init(template, "sim1", SubmitOptions(snapshot_dir="x", simulation_id="sim1", **kw))


def test_run_start_inserted_before_run_end_when_init_has_none():
    out = _build(_V2_FREE, run_start="2000-03-01")
    assert (
        "          Output_dir\t=> '/wbm/wbm_output/sim1',\n"
        "          Run_Start => '2000-03-01',\n"
        "          Run_End\t=> '2001-12-31'\n"
    ) in out
    assert out.count("Run_Start") == 1 and out.count("Run_End") == 1
    # the inserted key is found by the same pattern: a second replace works
    again = _set_perl_key(out, "Run_Start", "1999-01-01", quote=True, required=True, label="x")
    assert "Run_Start => '1999-01-01'," in again and "2000-03-01" not in again


def test_run_start_replaced_in_place_when_present():
    out = _build(_V2_FREE.replace("          Run_End", "          Run_Start => '2000-01-01',\n          Run_End"),
                 run_start="2000-03-01")
    assert out.count("Run_Start") == 1
    assert "Run_Start => '2000-03-01'," in out


def test_run_start_with_both_keys_replaces_and_leaves_run_end():
    out = _build(_INIT_TEMPLATE, run_start="2000-03-01")
    assert "Run_Start  => '2000-03-01'," in out
    assert "Run_End    => '2000-12-31'," in out
    assert out.count("Run_Start") == 1


def test_run_start_year_files_accepts_jan_1():
    out = _build(_V2_INIT, run_start="2000-01-01")
    assert "Run_Start => '2000-01-01'," in out


def test_run_start_year_files_rejects_mid_year_and_suggests_jan_1():
    with pytest.raises(OpenghmError) as e:
        _build(_V2_INIT, run_start="2000-03-01")
    msg = str(e.value)
    assert msg.startswith("--run-start 2000-03-01:")
    assert "File_Size 'year'" in msg and "Use 2000-01-01." in msg


def test_run_start_year_files_rejects_jan_2():
    with pytest.raises(OpenghmError, match="Use 2000-01-01"):
        _build(_V2_INIT, run_start="2000-01-02")


_MONTH_INIT = _V2_INIT.replace("'year'", "'month'")


def test_run_start_month_files_accepts_the_1st():
    out = _build(_MONTH_INIT, run_start="2000-03-01")
    assert "Run_Start => '2000-03-01'," in out


def test_run_start_month_files_rejects_the_15th_and_suggests_the_1st():
    with pytest.raises(OpenghmError) as e:
        _build(_MONTH_INIT, run_start="2000-03-15")
    msg = str(e.value)
    assert "File_Size 'month'" in msg and "one output file per month" in msg and "Use 2000-03-01." in msg


def test_run_start_unchecked_without_file_size_or_with_other_value():
    assert "Run_Start => '2000-03-15'," in _build(_V2_FREE, run_start="2000-03-15")
    other = _V2_INIT.replace("'year'", "'day'")
    assert "Run_Start => '2000-03-15'," in _build(other, run_start="2000-03-15")


def test_run_start_check_reads_double_quoted_and_spaced_file_size():
    tpl = _V2_INIT.replace("File_Size\t=> 'year'", 'File_Size => "year"')
    with pytest.raises(OpenghmError, match="Use 2000-01-01"):
        _build(tpl, run_start="2000-03-01")


def test_run_start_check_only_applies_when_run_start_given():
    _build(_V2_INIT, run_end="2001-06-30")  # File_Size 'year', no --run-start: fine


def test_run_start_without_either_key_still_raises():
    with pytest.raises(OpenghmError, match="--run-start: key 'Run_Start' not found"):
        _build("{ MT_Code_Name => { Output_dir => 'x' } }", run_start="2000-03-01")


def test_run_end_without_either_key_still_raises():
    with pytest.raises(OpenghmError, match="--run-end: key 'Run_End' not found"):
        _build("{ MT_Code_Name => { Output_dir => 'x' } }", run_end="2001-12-31")


def test_run_end_inserted_after_run_start_when_init_has_none():
    # Run_Start is the last entry, so it has no comma of its own to begin with
    tpl = "{\n  MT_Code_Name => {\n\tOutput_dir => 'x',\n\tRun_Start => '2000-01-01'\n  },\n}\n"
    out = _build(tpl, run_end="2001-12-31")
    assert "\tRun_Start => '2000-01-01',\n\tRun_End => '2001-12-31',\n  }," in out
    # and when Run_Start already has its comma, none is doubled
    out = _build(tpl.replace("'2000-01-01'\n", "'2000-01-01',\n\tOther => 1\n"), run_end="2001-12-31")
    assert "'2000-01-01',\n\tRun_End => '2001-12-31',\n\tOther => 1\n" in out


def test_insert_keeps_tab_indentation():
    tpl = "{\n\tMT_Code_Name => {\n\t\tOutput_dir => 'x',\n\t\tRun_End => '2001-12-31'\n\t},\n}\n"
    out = _build(tpl, run_start="2000-03-01")
    assert "\t\tRun_Start => '2000-03-01',\n\t\tRun_End => '2001-12-31'\n" in out


def test_insert_into_one_line_hash_stays_on_the_line():
    tpl = "{ MT_Code_Name => { Output_dir => 'x', Run_End => '2001-12-31' } }\n"
    out = _build(tpl, run_start="2000-03-01")
    assert "Run_Start => '2000-03-01', Run_End => '2001-12-31' }" in out


def test_start_key_lookup_does_not_match_run_start_for_insert():
    # \bStart\b must not see Run_Start, so a Spinup-less init with only Run_Start still raises
    tpl = "{ MT_Code_Name => { Output_dir => 'x', Run_Start => '2000-01-01' } }\n"
    with pytest.raises(OpenghmError, match="--spinup-start"):
        _build(tpl, spinup_start="1999-01-01")


@pytest.mark.skipif(shutil.which("perl") is None, reason="perl not installed")
@pytest.mark.parametrize("kw,key,expected", [
    ({"run_start": "2000-03-01"}, "Run_Start", "2000-03-01"),
    ({"run_end": "2002-06-30"}, "Run_End", "2002-06-30"),
])
def test_inserted_init_is_valid_perl(kw, key, expected):
    tpl = _V2_FREE if "run_start" in kw else _V2_FREE.replace("Run_End\t=> '2001-12-31'", "Run_Start => '2000-01-01'")
    out = _build(tpl, **kw)
    res = subprocess.run(
        ["perl", "-e", f"my $h = do {{ local $/; eval <STDIN> }}; die $@ if $@; print $h->{{MT_Code_Name}}{{{key}}}"],
        input=out, capture_output=True, text=True,
    )
    assert res.returncode == 0, res.stderr
    assert res.stdout == expected


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
    assert "#SBATCH --account=abc123456" in sb
    assert "singularity exec -B " in sb
    assert "wbm-v2-lite-2.0.0.sif /wbm/model/wbm.pl /wbm/wbm_init/wbm_test.init" in sb


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
    assert sidecar["model_input"] == "2" * 64
    assert sidecar["model_input_path"] == str(tmp_path / "model-inputs" / ("2" * 64))
    assert "data_subdir" not in sidecar
    assert sidecar["user_info"] == "alice@x.edu"
    assert sidecar["submitted_at"] == "2026-07-05T00:00:00Z"
    assert sidecar["slurm_job_id"] is None


def test_cwd_default(tmp_path, monkeypatch):
    snap = _make_snapshot(tmp_path)
    monkeypatch.chdir(snap)
    _ctx, built = build_submit(SubmitOptions(simulation_id="sim1"), _config(tmp_path))  # no path → cwd
    assert _find(built, "/wbm/data").host == str(tmp_path / "model-inputs" / ("2" * 64))


# ── --spool snapshot | fresh ─────────────────────────────────────────────────


def test_spool_snapshot_uses_existing_spool_in_place(tmp_path):
    snap = _make_snapshot(tmp_path)
    (snap / "spool").mkdir()
    (snap / "spool" / "cache.bin").write_bytes(b"x")
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    stage_files(built)
    assert _find(built, "/wbm/spool").host == str(snap / "spool")
    assert (snap / "spool" / "cache.bin").read_bytes() == b"x"   # untouched, not copied
    assert not (tmp_path / "out" / "sim1" / "spool").exists()
    sidecar = json.loads(_gen(built, "simulation.json").content)
    assert sidecar["spool_mode"] == "snapshot" and sidecar["spool_dir"] == str(snap / "spool")


def test_spool_fresh_is_per_simulation(tmp_path):
    snap = _make_snapshot(tmp_path)
    (snap / "spool").mkdir()
    _ctx, built = build_submit(
        SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1", spool="fresh"), _config(tmp_path))
    per_sim = str(tmp_path / "out" / "sim1" / "spool")
    assert _find(built, "/wbm/spool").host == per_sim
    assert _find(built, "/wbm/spool").readonly is False
    assert per_sim in built.staged_dirs and str(snap / "spool") not in built.staged_dirs
    sidecar = json.loads(_gen(built, "simulation.json").content)
    assert sidecar["spool_mode"] == "fresh" and sidecar["spool_dir"] == per_sim
    # the init still points WBM at the container path
    assert "/wbm/spool/" in _gen(built, "wbm_init/wbm_test.init").content


def test_spool_fresh_works_on_a_read_only_snapshot(tmp_path):
    snap = _make_snapshot(tmp_path)
    snap.chmod(0o555)
    try:
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1", spool="fresh"),
                     _config(tmp_path))
    finally:
        snap.chmod(0o755)


@pytest.mark.skipif(hasattr(os, "geteuid") and os.geteuid() == 0, reason="root ignores permissions")
@pytest.mark.parametrize("existing_spool", [False, True])
def test_spool_snapshot_not_writable_suggests_fresh(tmp_path, existing_spool):
    snap = _make_snapshot(tmp_path)
    target = snap
    if existing_spool:
        target = snap / "spool"
        target.mkdir()
    target.chmod(0o555)
    try:
        with pytest.raises(OpenghmError, match="--spool fresh"):
            build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    finally:
        target.chmod(0o755)


def test_spool_bad_mode(tmp_path):
    snap = _make_snapshot(tmp_path)
    with pytest.raises(OpenghmError, match="--spool must be one of"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1", spool="bogus"),
                     _config(tmp_path))


# ── real host staging (no sbatch spawn) ────────────────────────────────────────


def test_stage_files_creates_dirs_copies_and_init(tmp_path):
    snap = _make_snapshot(tmp_path)
    # a sibling file in wbm_init must survive the per-sim copy
    (snap / "wbm_init" / "shared.pm").write_text("1;\n", encoding="utf-8")
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))

    stage_files(built)
    base = tmp_path / "out" / "sim1"
    for d in ("wbm_output", "WBM_run_state"):
        assert (base / d).is_dir()
    assert (snap / "spool").is_dir() and not (base / "spool").exists()   # created in the snapshot
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


def test_no_simulation_block(tmp_path):
    snap = _make_snapshot(tmp_path, metadata={"slug": "x"})
    with pytest.raises(OpenghmError, match="simulation block"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))


def test_missing_container_version(tmp_path):
    meta = json.loads(json.dumps(_METADATA))
    del meta["uses"]
    snap = _make_snapshot(tmp_path, metadata=meta)
    with pytest.raises(OpenghmError, match="uses.container.version"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))


def test_missing_image_names_the_commands(tmp_path):
    snap = _make_snapshot(tmp_path)
    os.remove(_config(tmp_path).image_path("wbm-v2-lite", "2.0.0", "wbm-v2-lite-2.0.0.sif"))
    with pytest.raises(OpenghmError) as e:
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    msg = str(e.value)
    assert f"openghm snapshot fetch {_METADATA['id']}" in msg
    assert "openghm sif pull wbm-v2-lite:2.0.0" in msg
    # a dry run prints the plan without the image, and --sif replaces the lookup
    build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path),
                 check_assets=False)
    ctx, _ = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"),
                          _config(tmp_path), sif="/x/my.sif")
    assert ctx.image == "/x/my.sif"


def test_container_pin_incomplete(tmp_path):
    meta = json.loads(json.dumps(_METADATA))
    del meta["uses"]["container"]["https"]
    snap = _make_snapshot(tmp_path, metadata=meta)
    with pytest.raises(OpenghmError, match="uses.container.https"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))


def test_missing_recommended_compute(tmp_path):
    meta = json.loads(json.dumps(_METADATA))
    del meta["simulation"]["recommendedCompute"]
    snap = _make_snapshot(tmp_path, metadata=meta)
    with pytest.raises(OpenghmError, match="recommendedCompute"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))


def test_cli_overrides_recommended_compute(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_submit(
        SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1", cores=4, walltime="0:30:00"),
        _config(tmp_path),
    )
    sbatch = _gen(built, ".sbatch").content
    assert "--cpus-per-task=4" in sbatch or "-c 4" in sbatch
    assert "0:30:00" in sbatch


def test_bad_sim_id(tmp_path):
    snap = _make_snapshot(tmp_path)
    with pytest.raises(OpenghmError, match="--id"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="bad/id"), _config(tmp_path))


def test_snapshot_data_is_not_read(tmp_path):
    # a published tree may still carry data/ and data_init/; the run uses the model input
    snap = _make_snapshot(tmp_path)
    (snap / "data" / "old").mkdir(parents=True)
    (snap / "data_init").mkdir()
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    assert all(str(snap / "data") not in m.host and m.host != str(snap / "data_init")
               for m in built.mounts)


def test_missing_model_input_names_the_commands(tmp_path):
    snap = _make_snapshot(tmp_path, cache_model_input=False)
    mid = "2" * 64
    with pytest.raises(OpenghmError) as e:
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    msg = str(e.value)
    assert str(tmp_path / "model-inputs" / mid) in msg
    assert f"openghm snapshot fetch {_METADATA['id']}" in msg
    assert f"openghm model-input fetch {mid}" in msg
    # a dry run prints the plan without it
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"),
                               _config(tmp_path), check_assets=False)
    assert _find(built, "/wbm/data").host == str(tmp_path / "model-inputs" / mid)


def test_missing_model_input_id(tmp_path):
    meta = json.loads(json.dumps(_METADATA))
    del meta["uses"]["modelInput"]
    snap = _make_snapshot(tmp_path, metadata=meta)
    with pytest.raises(OpenghmError, match="uses.modelInput.id"):
        build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))


# ── the shipped example metadata.json files ───────────────────────────────────


@pytest.mark.parametrize("name", [
    "wbm_storage_v2.0.0", "wbm_storage_v1.0.0_Global", "wbm_storage_v1.0.0_Wyoming",
])
def test_spec_examples_submit(tmp_path, name):
    """Every shipped example is readable by ``sim submit``, not just by the validator.

    ``test_spec.py`` checks these against the schema. This checks the other
    half — that the fields the toolkit reaches for are the ones the spec
    actually defines — which is the divergence that went unnoticed while the
    gateway moved onto the spec and the toolkit did not.
    """
    meta = json.loads(
        (spec.schemas_root() / "snapshot-spec" / "examples" / f"{name}.json").read_text()
    )
    snap = _make_snapshot(tmp_path, metadata=meta, init_name=meta["simulation"]["init"])

    _ctx, built = build_submit(
        SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path)
    )

    compute = meta["simulation"]["recommendedCompute"]
    sbatch = _gen(built, ".sbatch").content
    assert str(compute["cores"]) in sbatch and compute["walltime"] in sbatch
    pin = meta["uses"]["container"]
    assert _ctx.image == str(
        tmp_path / "sif" / pin["image"] / pin["version"] / pin["https"].rsplit("/", 1)[-1]
    )
    assert _gen(built, meta["simulation"]["init"])


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
