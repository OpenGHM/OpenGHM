"""``sim run`` — local foreground execution shares submit's resolution.

Asserts that ``build_run`` reuses the same snapshot resolution as ``build_submit``
but wraps it as a direct container exec (no sbatch), and that the local sidecar
records ``mode: local`` + an exit code.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from openghm import Config
from openghm.errors import OpenghmError
from openghm.run import stage_files
from openghm.sim import (
    SubmitOptions, build_run, build_submit, record_exit_code, resolve_job_id, sidecar_path,
)

@pytest.fixture(autouse=True)
def _no_slurm_allocation(monkeypatch):
    """A test run is not inside someone's allocation unless it says so."""
    monkeypatch.delenv("SLURM_CPUS_PER_TASK", raising=False)


_INIT_TEMPLATE = """{
  MT_Code_Name => {
    Output_dir => 'wbm/wbm_output/WBM_test',
    Run_Start  => '2000-01-01',
  },
}
"""

_METADATA = {
    "simulation": {
        "init": "wbm_test.init",
        "recommendedCompute": {"cores": 16, "walltime": "15:00"},
    },
    "uses": {
        "container": {
            "image": "wbm-v2-lite", "version": "2.0.0", "digest": "sha256:" + "a" * 64,
            "https": "https://example.test/containers/wbm-v2-lite/2.0.0/wbm-v2-lite-2.0.0.sif",
        },
        "modelInput": {"id": "2" * 64},
    },
}


def tmp_sif(root: Path) -> Path:
    """Where ``_config`` looks for the image the snapshot pins."""
    return root / "sif" / "wbm-v2-lite" / "2.0.0" / "wbm-v2-lite-2.0.0.sif"


def tmp_model_input(root: Path) -> Path:
    """Where ``_config`` looks for the model input the snapshot links."""
    return root / "model-inputs" / ("2" * 64)


def _make_snapshot(root: Path) -> Path:
    snap = root / "wbm_storage_v2.0.0"
    for d in ("model", "utilities", "gdal_test_files", "wbm_init"):
        (snap / d).mkdir(parents=True, exist_ok=True)
    (snap / "metadata.json").write_text(json.dumps(_METADATA), encoding="utf-8")
    (snap / "wbm_init" / "wbm_test.init").write_text(_INIT_TEMPLATE, encoding="utf-8")
    sif = tmp_sif(root)
    sif.parent.mkdir(parents=True, exist_ok=True)
    sif.write_bytes(b"")
    (tmp_model_input(root) / "data_init").mkdir(parents=True, exist_ok=True)
    return snap


def _config(tmp_path: Path) -> Config:
    return Config(output_base=str(tmp_path / "out"), sif_dir=str(tmp_path / "sif"),
                  model_input_dir=str(tmp_path / "model-inputs"))


def _find(built, container):
    return next(m for m in built.mounts if m.container == container)


def _gen(built, endswith):
    return next(f for f in built.generated_files if f.host_path.endswith(endswith))


# ── run vs submit ──────────────────────────────────────────────────────────────


def test_run_argv_is_container_exec_not_sbatch(tmp_path):
    snap = _make_snapshot(tmp_path)
    ctx, built = build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    # foreground container exec, not sbatch
    assert built.argv[0] == "singularity"
    assert "exec" in built.argv
    assert built.argv[-3:] == [ctx.image, "/wbm/model/wbm.pl", "/wbm/wbm_init/wbm_test.init"] \
        or built.argv[-2:] == ["/wbm/model/wbm.pl", "/wbm/wbm_init/wbm_test.init"]
    # no sbatch script is generated for a local run
    assert not any(f.host_path.endswith(".sbatch") for f in built.generated_files)
    assert built.display.startswith("singularity exec")
    # the model input comes from the cache
    assert _find(built, "/wbm/data").host == str(tmp_model_input(tmp_path))
    assert _find(built, "/wbm/data_init").host == str(tmp_model_input(tmp_path) / "data_init")


def test_run_docker_argv(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_run(
        SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path),
        runtime="docker",
    )
    assert built.argv[:3] == ["docker", "run", "--rm"]


def test_run_and_submit_share_resolution(tmp_path, monkeypatch):
    monkeypatch.setenv("SLURM_CPUS_PER_TASK", "16")
    snap = _make_snapshot(tmp_path)
    cfg = _config(tmp_path)
    _c1, sub = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), cfg)
    _c2, run = build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), cfg)
    # same mounts, inner cmd, staging, and per-sim init content
    assert [(m.container, m.readonly) for m in sub.mounts] == [(m.container, m.readonly) for m in run.mounts]
    assert sub.inner_cmd == run.inner_cmd    # 16 cores in both: 8 threads
    assert set(sub.staged_dirs) == set(run.staged_dirs)
    assert [(c.src, c.dst) for c in sub.staged_copies] == [(c.src, c.dst) for c in run.staged_copies]
    assert _gen(sub, "wbm_test.init").content == _gen(run, "wbm_test.init").content


def test_run_without_an_allocation_passes_no_thread_count(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_run(
        SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    assert built.inner_cmd == ["/wbm/model/wbm.pl", "/wbm/wbm_init/wbm_test.init"]
    assert " -t " not in built.display
    assert json.loads(_gen(built, "simulation.json").content)["wbm_threads"] is None


@pytest.mark.parametrize("env, flag", [
    ("1", ["-t", "1"]), ("7", ["-t", "7"]), ("8", ["-t", "8"]), ("26", ["-t", "8"]),
])
def test_run_threads_follow_slurm_cpus_per_task(tmp_path, monkeypatch, env, flag):
    monkeypatch.setenv("SLURM_CPUS_PER_TASK", env)
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_run(
        SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1", verbose=True), _config(tmp_path))
    # before the init path, next to -v; the metadata's 16 recommended cores are not consulted
    assert built.inner_cmd == ["/wbm/model/wbm.pl", *flag, "-v", "/wbm/wbm_init/wbm_test.init"]
    assert f"/wbm/model/wbm.pl {' '.join(flag)} -v /wbm/wbm_init/wbm_test.init" in built.display
    assert json.loads(_gen(built, "simulation.json").content)["wbm_threads"] == int(flag[1])


@pytest.mark.parametrize("env", ["", "0", "-2", "abc", "4x", "2.5", " "])
def test_run_ignores_a_slurm_cpus_per_task_that_is_not_a_positive_integer(tmp_path, monkeypatch, env):
    monkeypatch.setenv("SLURM_CPUS_PER_TASK", env)
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_run(
        SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    assert built.inner_cmd == ["/wbm/model/wbm.pl", "/wbm/wbm_init/wbm_test.init"]


def test_run_sidecar_mode_local(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    sidecar = json.loads(_gen(built, "simulation.json").content)
    assert sidecar["mode"] == "local"
    assert sidecar["exit_code"] is None
    assert "slurm_job_id" not in sidecar


def test_submit_sidecar_mode_slurm(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    sidecar = json.loads(_gen(built, "simulation.json").content)
    assert sidecar["mode"] == "slurm"
    assert sidecar["slurm_job_id"] is None


def test_record_exit_code_updates_sidecar(tmp_path):
    snap = _make_snapshot(tmp_path)
    _ctx, built = build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    stage_files(built)
    assert json.loads(Path(sidecar_path(built)).read_text())["exit_code"] is None
    path = record_exit_code(built, 0)
    assert path == sidecar_path(built)
    assert json.loads(Path(path).read_text())["exit_code"] == 0


def test_resolve_job_id_local_mode_is_clear_error(tmp_path):
    base = tmp_path / "out"
    (base / "loc").mkdir(parents=True)
    (base / "loc" / "simulation.json").write_text(
        json.dumps({"simulation_id": "loc", "mode": "local", "exit_code": 0}), encoding="utf-8")
    with pytest.raises(OpenghmError, match="run locally"):
        resolve_job_id(str(base), "loc")


def test_run_spool_modes(tmp_path):
    snap = _make_snapshot(tmp_path)
    _c, fresh_run = build_run(
        SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1", spool="fresh"), _config(tmp_path))
    assert _find(fresh_run, "/wbm/spool").host == str(tmp_path / "out" / "sim1" / "spool")
    assert json.loads(_gen(fresh_run, "simulation.json").content)["spool_mode"] == "fresh"
    _c, cache_run = build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))  # the default
    assert _find(cache_run, "/wbm/spool").host == str(tmp_path / "out" / "sim1" / "spool")
    assert _find(cache_run, "/wbm/spool/.cache").readonly is True
    assert json.loads(_gen(cache_run, "simulation.json").content)["spool_mode"] == "cache"
    assert cache_run.spool is not None and fresh_run.spool is None
