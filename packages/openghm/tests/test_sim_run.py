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


# ── --walltime ─────────────────────────────────────────────────────────────────


def _cli_config(tmp_path: Path) -> Path:
    cfg = tmp_path / "config.toml"
    cfg.write_text(f'output_base = "{tmp_path / "out"}"\nsif_dir = "{tmp_path / "sif"}"\n'
                   f'model_input_dir = "{tmp_path / "model-inputs"}"\n')
    return cfg


def _run_cli(tmp_path, *args):
    from click.testing import CliRunner
    from openghm.cli.main import cli
    snap = _make_snapshot(tmp_path)
    return CliRunner().invoke(cli, ["sim", "run", str(snap), "--id", "sim1", "--config", str(_cli_config(tmp_path)),
                                    *args])


@pytest.mark.parametrize("text", ["30:00", "22:30:00", "4-00:00:00", "1-12", "1-02:30", "90"])
def test_cli_sim_run_walltime_is_recorded_in_the_sidecar(tmp_path, text):
    out = _run_cli(tmp_path, "--walltime", text, "--dry-run", "--json")
    assert out.exit_code == 0, out.output
    payload = json.loads(out.stdout)
    sidecar = next(f for f in payload["generatedFiles"] if f["hostPath"].endswith("simulation.json"))
    assert json.loads(sidecar["content"])["walltime"] == text


def test_cli_sim_run_without_walltime_keeps_the_metadatas(tmp_path):
    out = _run_cli(tmp_path, "--dry-run", "--json")
    assert out.exit_code == 0, out.output
    sidecar = next(f for f in json.loads(out.stdout)["generatedFiles"] if f["hostPath"].endswith("simulation.json"))
    assert json.loads(sidecar["content"])["walltime"] == "15:00"


@pytest.mark.parametrize("text", ["soon", "", "1:2:3:4", "0", "00:00:00", "-5", "22h", "1-"])
def test_cli_sim_run_rejects_a_walltime_that_is_not_slurms(tmp_path, text):
    out = _run_cli(tmp_path, "--walltime", text, "--dry-run")
    assert out.exit_code == 2
    assert out.output.startswith("openghm: --walltime") and "HH:MM:SS" in out.output
    assert "Traceback" not in out.output


def test_build_run_validates_the_walltime(tmp_path):
    snap = _make_snapshot(tmp_path)
    with pytest.raises(OpenghmError, match="not a SLURM time"):
        build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id="s", walltime="never"), _config(tmp_path))


# ── a finished run is never reported as refused ────────────────────────────────


def test_cli_sim_run_exits_with_the_containers_code_when_recording_it_fails(tmp_path, monkeypatch):
    from openghm.cli import main as cli_main
    from openghm.types import RunResult

    monkeypatch.setattr(cli_main, "run_command", lambda built, **kw: RunResult(
        dry_run=False, argv=built.argv, display=built.display, exit_code=3))

    def broken(built, code):
        raise OSError("disk full")
    monkeypatch.setattr(cli_main, "record_exit_code", broken)
    out = _run_cli(tmp_path, "--spool", "fresh")
    assert out.exit_code == 3, out.output
    assert "openghm: warning: could not record the exit code" in out.output and "disk full" in out.output
    assert "Traceback" not in out.output


def test_cli_sim_run_a_corrupt_sidecar_does_not_turn_exit_0_into_a_traceback(tmp_path, monkeypatch):
    from openghm.cli import main as cli_main
    from openghm.types import RunResult

    def run(built, **kw):
        stage_files(built)
        Path(sidecar_path(built)).write_text("{not json")     # the run (or a disk) left it unreadable
        return RunResult(dry_run=False, argv=built.argv, display=built.display, exit_code=0)
    monkeypatch.setattr(cli_main, "run_command", run)
    out = _run_cli(tmp_path, "--spool", "fresh")
    assert out.exit_code == 0, out.output
    assert "warning: could not record the exit code" in out.output


def _killed_run(tmp_path, monkeypatch, code):
    from openghm.cli import main as cli_main
    from openghm.types import RunResult

    monkeypatch.setattr(cli_main, "run_command", lambda built, **kw: RunResult(
        dry_run=False, argv=built.argv, display=built.display, exit_code=code))
    return _run_cli(tmp_path, "--spool", "fresh")


def test_cli_sim_run_killed_by_sigkill_says_so_instead_of_an_empty_panel(tmp_path, monkeypatch):
    out = _killed_run(tmp_path, monkeypatch, -9)
    assert "exit -9" in out.output
    assert "WBM was killed by signal 9 (SIGKILL)." in out.output
    assert "out-of-memory killer" in out.output


def test_cli_sim_run_killed_by_another_signal_names_it_without_blaming_memory(tmp_path, monkeypatch):
    out = _killed_run(tmp_path, monkeypatch, -15)
    assert "WBM was killed by signal 15 (SIGTERM)." in out.output
    assert "out-of-memory" not in out.output


def test_cli_sim_run_with_an_ordinary_failure_adds_no_signal_line(tmp_path, monkeypatch):
    out = _killed_run(tmp_path, monkeypatch, 3)
    assert "exit 3" in out.output and "killed by signal" not in out.output


# ── post-processing: PostProcessing => { Run => 1 } ───────────────────────────
#
# `sim run` holds the init at Run => 0 while WBM runs, runs PostProcessing.pl itself afterwards, and
# puts the requested value back whatever happened. WBM and the container are faked; the inits and the
# generated script are real (tests/fixtures/post_processing/).

_PP_FIXTURES = Path(__file__).parent / "fixtures" / "post_processing"
_PP_NINE = [f"wbm_{v}_{s}.nc" for v in ("discharge", "runoff", "streamAge") for s in ("dc", "mc", "yc")]
_PP_DONE = "\nDataCube aggregation started for 3 WBM output variables (4 forks):\n\nAll Done!\n\n"


class _Faked:
    """What the faked WBM and the faked post-processing container saw."""

    def __init__(self, tmp_path: Path):
        self.work = tmp_path / "out" / "sim1"
        self.out = self.work / "wbm_output" / "sim1"
        self.init = self.work / "wbm_init" / "wbm_test.init"
        self.dump = self.out / "init_files" / "wbm_test.init"
        self.run_during_wbm = None
        self.forks_during_wbm = None
        self.pp_calls = []

    def sidecar(self) -> dict:
        return json.loads((self.work / "simulation.json").read_text())

    def forks_values(self):
        from openghm.post_processing import block_value
        return [block_value(f.read_text(), "Forks") for f in (self.init, self.dump) if f.exists()]

    def run_values(self):
        from openghm.post_processing import requested_run_value
        return [requested_run_value(f.read_text()) for f in (self.init, self.dump) if f.exists()]


def _fake_run(tmp_path, monkeypatch, init, *, wbm_code=0, pp_code=0, pp_files=_PP_NINE, pp_log=_PP_DONE):
    from openghm import post_processing
    from openghm.cli import main as cli_main
    from openghm.post_processing import block_value, requested_run_value
    from openghm.types import RunResult

    fake = _Faked(tmp_path)

    def wbm(built, **kw):
        if kw.get("dry_run"):
            return RunResult(dry_run=True, argv=built.argv, display=built.display)
        stage_files(built)
        staged = fake.init.read_text()
        fake.run_during_wbm = requested_run_value(staged)
        fake.forks_during_wbm = block_value(staged, "Forks")
        fake.dump.parent.mkdir(parents=True)
        fake.dump.write_text(staged)                       # WBM's dump of the init it read
        (fake.out / "PostProcessing.pl").write_text((_PP_FIXTURES / "PostProcessing.pl").read_text())
        return RunResult(dry_run=False, argv=built.argv, display=built.display, exit_code=wbm_code)

    def container(argv, log_path):
        fake.pp_calls.append(argv)
        Path(log_path).write_text(pp_log)
        (fake.out / "climatology").mkdir(exist_ok=True)
        for n in pp_files:
            (fake.out / "climatology" / n).write_bytes(b"x")
        return pp_code

    monkeypatch.setattr(cli_main, "run_command", wbm)
    monkeypatch.setattr(post_processing, "_run_logged", container)
    snap = _make_snapshot(tmp_path)
    (snap / "wbm_init" / "wbm_test.init").write_text((_PP_FIXTURES / init).read_text(), encoding="utf-8")
    return fake, snap


def _invoke(tmp_path, snap, *args):
    from click.testing import CliRunner
    from openghm.cli.main import cli
    return CliRunner().invoke(
        cli, ["sim", "run", str(snap), "--id", "sim1", "--spool", "fresh", "--config", str(_cli_config(tmp_path)), *args])


def test_sim_run_runs_post_processing_after_wbm_and_puts_the_init_back(tmp_path, monkeypatch):
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_SHORT.init")
    out = _invoke(tmp_path, snap)
    assert out.exit_code == 0, out.output
    assert fake.run_during_wbm == "0"                       # WBM saw Run => 0
    assert fake.run_values() == ["1", "1"]                  # both copies say what was asked for
    assert len(fake.pp_calls) == 1
    assert fake.pp_calls[0][-3:] == ["perl", "-w", "/wbm/wbm_output/sim1/PostProcessing.pl"]
    side = fake.sidecar()
    pp = side["post_processing"]
    assert side["exit_code"] == 0 and pp["ok"] is True and pp["exit_code"] == 0
    assert pp["expected"] == {"climatology": 9, "spatial_agg": False}
    assert pp["found"] == {"climatology": 9, "spatial_agg": 0}
    assert pp["log"] == "wbm_output/sim1/PostProcessing.log"
    assert "post-processing finished" in out.output


def test_sim_run_fails_when_post_processing_fails_though_wbm_exited_0(tmp_path, monkeypatch):
    """The script exits 0 and prints 'All Done!' with nothing in climatology/ (Anvil job 21163850)."""
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_SHORT.init", pp_files=[])
    out = _invoke(tmp_path, snap)
    assert out.exit_code == 1, out.output
    pp = fake.sidecar()["post_processing"]
    assert pp["ok"] is False and pp["exit_code"] == 0 and pp["all_done"] is True
    assert pp["found"]["climatology"] == 0
    assert "openghm: post-processing failed: climatology/ holds 0 of the 9" in out.output
    assert fake.sidecar()["exit_code"] == 0                  # WBM's own result is still recorded as it was
    assert fake.run_values() == ["1", "1"]                  # restored on this path too


def test_sim_run_fails_when_the_post_processing_script_exits_non_zero(tmp_path, monkeypatch):
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_SHORT.init", pp_code=2, pp_log="boom\n")
    out = _invoke(tmp_path, snap)
    assert out.exit_code == 1
    pp = fake.sidecar()["post_processing"]
    assert pp["ok"] is False and pp["exit_code"] == 2 and pp["tail"] == ["boom"]


def test_sim_run_after_a_failed_wbm_skips_post_processing_but_restores_the_init(tmp_path, monkeypatch):
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_SHORT.init", wbm_code=3)
    out = _invoke(tmp_path, snap)
    assert out.exit_code == 3, out.output                   # WBM's own code
    assert fake.pp_calls == []
    pp = fake.sidecar()["post_processing"]
    assert pp["ok"] is None and pp["exit_code"] is None and pp["requested"] is True
    assert fake.run_values() == ["1", "1"]


def test_sim_run_with_an_init_that_does_not_ask_changes_nothing(tmp_path, monkeypatch):
    from openghm.sim import SubmitOptions, build_persim_init
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_test.init")      # Run => 0
    template = (snap / "wbm_init" / "wbm_test.init").read_text()
    out = _invoke(tmp_path, snap)
    assert out.exit_code == 0, out.output
    assert fake.pp_calls == []
    assert "post_processing" not in fake.sidecar()
    assert fake.init.read_text() == build_persim_init(template, "sim1", SubmitOptions())
    assert fake.run_values() == ["0", "0"]
    assert "post-processing" not in out.output


def test_sim_run_without_a_post_processing_block_changes_nothing(tmp_path, monkeypatch):
    from openghm.cli import main as cli_main
    from openghm.types import RunResult
    monkeypatch.setattr(cli_main, "run_command", lambda built, **kw: (stage_files(built), RunResult(
        dry_run=False, argv=built.argv, display=built.display, exit_code=0))[1])
    out = _run_cli(tmp_path, "--spool", "fresh")             # the module's _INIT_TEMPLATE has no block
    assert out.exit_code == 0, out.output
    side = json.loads((tmp_path / "out" / "sim1" / "simulation.json").read_text())
    assert "post_processing" not in side and side["exit_code"] == 0


def test_sim_run_fails_when_the_post_processing_record_cannot_be_made(tmp_path, monkeypatch):
    """A step nobody could record is a failed step when WBM exited 0."""
    from openghm import post_processing
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_SHORT.init")

    def broken(*a, **kw):
        raise OSError("disk full")
    monkeypatch.setattr(post_processing, "finish", broken)
    out = _invoke(tmp_path, snap)
    assert out.exit_code == 1 and "post-processing could not be completed: disk full" in out.output


def test_sim_run_dry_run_shows_the_held_init_and_runs_nothing(tmp_path, monkeypatch):
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_SHORT.init")
    out = _invoke(tmp_path, snap, "--dry-run", "--json")
    assert out.exit_code == 0, out.output
    files = {Path(f["hostPath"]).name: f["content"] for f in json.loads(out.stdout)["generatedFiles"]}
    assert json.loads(files["simulation.json"])["post_processing"]["run_value"] == "1"
    from openghm.post_processing import requested_run_value
    assert requested_run_value(files["wbm_test.init"]) == "0"
    assert fake.pp_calls == [] and not fake.work.exists()


# ── PostProcessing Forks = the cores the run holds ─────────────────────────────


def test_sim_run_forks_as_many_as_slurm_cpus_per_task_and_puts_the_init_back(tmp_path, monkeypatch):
    monkeypatch.setenv("SLURM_CPUS_PER_TASK", "32")
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_SHORT.init")
    out = _invoke(tmp_path, snap)
    assert out.exit_code == 0, out.output
    assert fake.forks_during_wbm == "32"                    # the staged init, and so WBM's dump of it
    assert fake.forks_values() == ["8", "8"]                # what the init had, in both copies, after the run
    pp = fake.sidecar()["post_processing"]
    assert pp["forks"] == 32 and pp["forks_value"] == "8" and pp["ok"] is True
    assert fake.run_values() == ["1", "1"]


def test_sim_run_without_slurm_cpus_leaves_forks_as_the_init_has_it(tmp_path, monkeypatch):
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_test.init")
    out = _invoke(tmp_path, snap, "--post-processing", "climatology")
    assert out.exit_code == 0, out.output
    assert fake.forks_during_wbm == "4" and fake.forks_values() == ["4", "4"]
    pp = fake.sidecar()["post_processing"]
    assert pp["forks"] is None and pp["forks_value"] == "4" and pp["ok"] is True


def test_sim_run_adds_forks_to_a_block_without_one_and_takes_it_out_again(tmp_path, monkeypatch):
    from openghm.post_processing import remove_block_key
    monkeypatch.setenv("SLURM_CPUS_PER_TASK", "12")
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_SHORT.init")
    init = snap / "wbm_init" / "wbm_test.init"
    original = remove_block_key(init.read_text(), "Forks")
    init.write_text(original)
    out = _invoke(tmp_path, snap)
    assert out.exit_code == 0, out.output
    assert fake.forks_during_wbm == "12"
    pp = fake.sidecar()["post_processing"]
    assert pp["forks"] == 12 and pp["forks_value"] is None
    assert fake.forks_values() == [None, None] and "Forks" not in fake.init.read_text()


def test_sim_run_after_a_failed_wbm_still_puts_forks_back(tmp_path, monkeypatch):
    monkeypatch.setenv("SLURM_CPUS_PER_TASK", "32")
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_SHORT.init", wbm_code=3)
    out = _invoke(tmp_path, snap)
    assert out.exit_code == 3 and fake.pp_calls == []
    assert fake.forks_values() == ["8", "8"] and fake.run_values() == ["1", "1"]


def test_a_run_that_asks_for_no_post_processing_keeps_forks_untouched(tmp_path, monkeypatch):
    monkeypatch.setenv("SLURM_CPUS_PER_TASK", "32")
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_SHORT.init")
    out = _invoke(tmp_path, snap, "--post-processing", "standard")
    assert out.exit_code == 0, out.output
    assert fake.forks_during_wbm == "8" and fake.forks_values() == ["8", "8"]
    assert "post_processing" not in fake.sidecar()


def test_sim_submit_then_post_process_puts_forks_back(tmp_path, monkeypatch):
    """The sbatch path: staged with the job's 16 cores, `sim post-process` restores the init's 8."""
    fake = _staged_submit(tmp_path, monkeypatch)
    assert fake.forks_values() == ["16", "16"]
    out = _post_process(fake, "--wbm-exit-code", "0")
    assert out.exit_code == 0, out.output
    assert fake.forks_values() == ["8", "8"] and fake.run_values() == ["1", "1"]
    pp = fake.sidecar()["post_processing"]
    assert pp["forks"] == 16 and pp["forks_value"] == "8"


# ── sim post-process (the sbatch job's step) ───────────────────────────────────


def _staged_submit(tmp_path, monkeypatch, init="fc66a2cd_wbm_SHORT.init", **kw):
    """A submitted run as the compute node finds it: staged, WBM done."""
    fake, snap = _fake_run(tmp_path, monkeypatch, init, **kw)
    _ctx, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="sim1"), _config(tmp_path))
    stage_files(built)
    fake.dump.parent.mkdir(parents=True)
    fake.dump.write_text(fake.init.read_text())
    (fake.out / "PostProcessing.pl").write_text((_PP_FIXTURES / "PostProcessing.pl").read_text())
    return fake


def _post_process(fake, *args):
    from click.testing import CliRunner
    from openghm.cli.main import cli
    return CliRunner().invoke(cli, ["sim", "post-process", str(fake.work), *args])


def test_sim_post_process_after_a_good_wbm_runs_checks_and_restores(tmp_path, monkeypatch):
    fake = _staged_submit(tmp_path, monkeypatch)
    out = _post_process(fake, "--wbm-exit-code", "0")
    assert out.exit_code == 0, out.output
    assert len(fake.pp_calls) == 1 and fake.sidecar()["post_processing"]["ok"] is True
    assert fake.run_values() == ["1", "1"]


def test_sim_post_process_exits_1_when_the_step_fails(tmp_path, monkeypatch):
    fake = _staged_submit(tmp_path, monkeypatch, pp_files=_PP_NINE[:5])
    out = _post_process(fake)                                   # --wbm-exit-code defaults to 0
    assert out.exit_code == 1, out.output
    assert fake.sidecar()["post_processing"]["found"]["climatology"] == 5
    assert fake.run_values() == ["1", "1"]


def test_sim_post_process_after_a_failed_wbm_exits_with_wbms_code_and_restores(tmp_path, monkeypatch):
    fake = _staged_submit(tmp_path, monkeypatch)
    out = _post_process(fake, "--wbm-exit-code", "137")
    assert out.exit_code == 137, out.output
    assert fake.pp_calls == [] and fake.sidecar()["post_processing"]["ok"] is None
    assert fake.run_values() == ["1", "1"]


def test_sim_post_process_on_a_run_that_did_not_ask_does_nothing(tmp_path, monkeypatch):
    fake = _staged_submit(tmp_path, monkeypatch, init="fc66a2cd_wbm_test.init")
    assert _post_process(fake).exit_code == 0
    assert _post_process(fake, "--wbm-exit-code", "5").exit_code == 5
    assert fake.pp_calls == [] and "post_processing" not in fake.sidecar()


def test_sim_post_process_without_a_sidecar_keeps_wbms_code(tmp_path):
    from click.testing import CliRunner
    from openghm.cli.main import cli
    for code, want in (("0", 2), ("9", 9)):
        out = CliRunner().invoke(cli, ["sim", "post-process", str(tmp_path), "--wbm-exit-code", code])
        assert out.exit_code == want and "post-processing could not be completed" in out.output


# ── --post-processing standard|climatology (CLI) ───────────────────────────────


def test_cli_sim_run_climatology_on_a_run_0_init_runs_post_processing(tmp_path, monkeypatch):
    """fc66a2cd's wbm_test.init (Run => 0): WBM sees Run => 0, the step runs, the init gets Run => 1 back."""
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_test.init")
    out = _invoke(tmp_path, snap, "--post-processing", "climatology")
    assert out.exit_code == 0, out.output
    assert fake.run_during_wbm == "0"
    assert len(fake.pp_calls) == 1
    pp = fake.sidecar()["post_processing"]
    assert pp["requested"] is True and pp["run_value"] == "1" and pp["ok"] is True
    assert fake.run_values() == ["1", "1"]


def test_cli_sim_run_standard_on_a_run_1_init_runs_no_post_processing(tmp_path, monkeypatch):
    """fc66a2cd's SHORT init (Run => 1) with standard: Run => 0 staged, no step, nothing recorded."""
    fake, snap = _fake_run(tmp_path, monkeypatch, "fc66a2cd_wbm_SHORT.init")
    out = _invoke(tmp_path, snap, "--post-processing", "standard")
    assert out.exit_code == 0, out.output
    assert fake.run_during_wbm == "0" and fake.pp_calls == []
    assert "post_processing" not in fake.sidecar()
    assert fake.run_values() == ["0", "0"]


def test_cli_sim_run_post_processing_on_an_init_without_a_block_exits_2(tmp_path):
    snap = _make_snapshot(tmp_path)
    out = _invoke(tmp_path, snap, "--post-processing", "climatology", "--dry-run")
    assert out.exit_code == 2
    assert "openghm: --post-processing climatology: this init has no PostProcessing block" in out.output


def test_cli_sim_submit_post_processing_is_refused_the_same_way(tmp_path):
    from click.testing import CliRunner
    from openghm.cli.main import cli
    snap = _make_snapshot(tmp_path)
    out = CliRunner().invoke(cli, [
        "sim", "submit", str(snap), "--id", "sim1", "--spool", "fresh", "--dry-run",
        "--config", str(_cli_config(tmp_path)), "--post-processing", "standard"])
    assert out.exit_code == 2
    assert "openghm: --post-processing standard" in out.output


def test_cli_sim_post_processing_choice_is_checked_by_click(tmp_path):
    out = _invoke(tmp_path, _make_snapshot(tmp_path), "--post-processing", "daily", "--dry-run")
    assert out.exit_code == 2 and "daily" in out.output
