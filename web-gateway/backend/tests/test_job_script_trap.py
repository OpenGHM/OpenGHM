"""The outcome record a gateway job writes when its body ends (ADR 0026).

Renders the real body, runs it with `bash` against a stub `openghm` whose exit
codes and output are chosen per test, and reads the `outcome.json` and the exit
code it leaves. No Anvil, no SLURM: `SLURM_SUBMIT_DIR` is a temp directory and
`flock` is a stub when the machine has none (macOS does not).

Bash 3.2 (macOS) and 4+ (Anvil) must both run the body, so nothing in it may
need a newer one: this file runs on whichever `bash` is on PATH.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

from app.services.job_script import BODY_MARKER, render_job_body

SIM_ID = "sim-20260930-0a1b2c"
SNAPSHOT_ID = "fc66a2cdeee9d456f83bc0b0a6f00cd447b0194c124a3bb4008a02990779ec89"

# A stand-in for `openghm`, steered by STUB_* variables. It writes what the
# real `sim run` writes once it has staged: simulation.json (its exit_code is
# null until the container has run), the init WBM reads, WBM's log and the
# `.nc` files.
STUB = r"""#!/bin/bash
W="$STUB_WORK_DIR"
if [ "$1" = "--version" ]; then echo "0.0.0-stub"; exit 0; fi
if [ "$1 $2" = "snapshot fetch" ]; then
  rc="${STUB_FETCH_RC:-0}"
  if [ "$rc" = 1 ]; then printf 'failed:\n  data/runoff.nc: HTTP 500\n' >&2; fi
  if [ "$rc" = 2 ]; then echo "openghm: snapshot id is not valid" >&2; fi
  exit "$rc"
fi
if [ "$1 $2" = "sim run" ]; then
  rc="${STUB_RUN_RC:-0}"
  if [ "${STUB_STAGED:-1}" != 1 ]; then echo "openghm: the config has no output_base" >&2; exit "$rc"; fi
  sim=$(basename "$W")
  mkdir -p "$W/wbm_init" "$W/wbm_output/$sim/daily" "$W/wbm_output/$sim/monthly"
  printf "ID\t\t=> 'wbm_test',\n" > "$W/wbm_init/wbm_test.init"
  printf '{"init": "wbm_test.init", "exit_code": null}' > "$W/simulation.json"
  if [ -n "${STUB_SLEEP:-}" ]; then touch "$W/.running"; sleep "$STUB_SLEEP" & wait $!; fi
  log="$W/wbm_output/$sim/wbm_test.log"
  case "${STUB_LOG:-ok}" in
    ok) printf 'Start\nTime used for the job - 12s\nAll Done!\n' > "$log" ;;
    nodone) printf 'Start\nrunning\n' > "$log" ;;
    warp) printf 'Start\nFailed to warp runoff: out of memory\n' > "$log" ;;
    warp_done) printf 'Failed to warp runoff\nAll Done!\n' > "$log" ;;
    nothing) printf 'Start\nNothing to do\n' > "$log" ;;
    hostile) printf 'say "hi" \\ \xff\xfe {"a": 1}\nAll Done!\n' > "$log" ;;
    none) ;;
  esac
  i=0
  while [ "$i" -lt "${STUB_NC:-2}" ]; do
    printf 'xxxx' > "$W/wbm_output/$sim/daily/wbm_$i.nc"; i=$((i + 1))
  done
  printf '{"init": "wbm_test.init", "exit_code": %s}' "$rc" > "$W/simulation.json"
  exit "$rc"
fi
echo "stub: unexpected arguments: $*" >&2
exit 99
"""


class Job:
    """One rendered body, its temp tree and how to run it."""

    def __init__(self, root: Path, **render) -> None:
        self.root = root
        self.home = root / "apps/openghm/abc1234"
        (self.home / "bin").mkdir(parents=True)
        (self.home / "venv/bin").mkdir(parents=True)
        (self.home / "bin/openghm").write_text(STUB)
        (self.home / "bin/openghm").chmod(0o755)
        (self.home / "venv/bin/python").symlink_to(sys.executable)
        self.submit_dir = root / "submit"
        self.submit_dir.mkdir()
        self.work_dir = root / "simulations" / SIM_ID
        self.body = render_job_body(
            **{
                **dict(
                    snapshot_id=SNAPSHOT_ID,
                    sim_id=SIM_ID,
                    openghm_home=str(self.home),
                    cache_dir=str(root / "cache"),
                    fetch_lock=str(root / "locks/fetch.lock"),
                    work_dir=str(self.work_dir),
                ),
                **render,
            }
        )
        self.script = root / "run.sh"
        # slurmly puts the shebang and `set -euo pipefail` above the body.
        self.script.write_text("#!/bin/bash\nset -euo pipefail\n" + self.body + "\n")
        self.bin = root / "bin"
        self.bin.mkdir()
        if shutil.which("flock") is None:
            flock = self.bin / "flock"
            flock.write_text('#!/bin/sh\nshift\nexec "$@"\n')  # no lock, same command
            flock.chmod(0o755)

    def env(self, **extra) -> dict:
        env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "SLURM_SUBMIT_DIR": str(self.submit_dir),
            "SLURM_JOB_ID": "4242",
            "STUB_WORK_DIR": str(self.work_dir),
        }
        env.update({k: str(v) for k, v in extra.items()})
        return env

    def run(self, **extra) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(self.script)],
            env=self.env(**extra),
            capture_output=True,
            text=True,
            timeout=60,
        )

    @property
    def record(self) -> dict:
        return json.loads((self.submit_dir / "outcome.json").read_text())


@pytest.fixture
def job(tmp_path) -> Job:
    return Job(tmp_path)


def test_a_clean_run_exits_0_and_records_a_manifest(job):
    done = job.run()
    assert done.returncode == 0, done.stderr
    assert "outcome: ok" in done.stdout
    r = job.record
    assert r["schema"] == 1
    assert r["ok"] is True
    assert r["sim_id"] == SIM_ID and r["snapshot_id"] == SNAPSHOT_ID
    assert r["toolkit_commit"] == "abc1234"
    assert r["slurm_job_id"] == "4242"
    assert r["host"]
    assert r["started_at"] <= r["ended_at"]
    assert r["phase"] == "check" and r["signal"] is None
    assert r["steps"] == {"fetch": {"exit_code": 0}, "run": {"exit_code": 0}}
    assert r["staged"] is True
    assert r["wbm"]["log"] == f"wbm_output/{SIM_ID}/wbm_test.log"
    assert r["wbm"]["all_done"] is True and r["wbm"]["markers"] == []
    assert r["wbm"]["tail"][-1] == "All Done!"
    out = r["output"]
    assert out["nc_count"] == 2 and out["truncated"] is False
    assert out["file_count"] == 3  # two .nc and the log
    assert out["total_bytes"] == 8 + len(job.work_dir.joinpath(r["wbm"]["log"]).read_bytes())
    paths = {f["path"] for f in out["files"]}
    assert paths == {
        f"wbm_output/{SIM_ID}/wbm_test.log",
        f"wbm_output/{SIM_ID}/daily/wbm_0.nc",
        f"wbm_output/{SIM_ID}/daily/wbm_1.nc",
    }
    assert {f["bytes"] for f in out["files"] if f["path"].endswith(".nc")} == {4}


def test_the_body_says_so_on_stderr_before_anything_else(job):
    done = job.run()
    assert done.stderr.splitlines()[0] == BODY_MARKER


def test_the_record_is_written_atomically(job):
    job.run()
    assert sorted(p.name for p in job.submit_dir.iterdir()) == ["outcome.json"]


@pytest.mark.parametrize("rc", [1, 2])
def test_a_failed_fetch_exits_with_its_code_and_never_runs(job, rc):
    done = job.run(STUB_FETCH_RC=rc)
    assert done.returncode == rc
    assert "outcome: fail" in done.stdout
    r = job.record
    assert r["ok"] is False
    assert r["phase"] == "fetch"
    assert r["steps"] == {"fetch": {"exit_code": rc}}
    assert r["staged"] is False
    assert r["output"]["nc_count"] == 0
    assert not job.work_dir.exists()
    # What the gateway shows as the excerpt is still on stderr.
    assert ("failed:" if rc == 1 else "openghm: snapshot id") in done.stderr


def test_a_run_refused_before_staging_is_not_staged(job):
    done = job.run(STUB_RUN_RC=2, STUB_STAGED=0)
    assert done.returncode == 2
    r = job.record
    assert r["phase"] == "run" and r["ok"] is False
    assert r["steps"] == {"fetch": {"exit_code": 0}, "run": {"exit_code": 2}}
    assert r["staged"] is False
    assert r["wbm"] == {"log": None, "all_done": False, "markers": [], "tail": []}


def test_the_same_exit_code_after_staging_is_recorded_as_staged(job):
    done = job.run(STUB_RUN_RC=2, STUB_LOG="nodone", STUB_NC=0)
    assert done.returncode == 2
    r = job.record
    assert r["steps"]["run"] == {"exit_code": 2}
    assert r["staged"] is True
    assert r["wbm"]["tail"] == ["Start", "running"]


def test_a_killed_container_exits_137_and_is_staged(job):
    done = job.run(STUB_RUN_RC=137, STUB_LOG="nodone", STUB_NC=0)
    assert done.returncode == 137
    r = job.record
    assert r["steps"]["run"] == {"exit_code": 137}
    assert r["staged"] is True and r["ok"] is False


def test_exit_0_without_all_done_is_a_failed_check(job):
    done = job.run(STUB_LOG="nodone")
    assert done.returncode == 3
    r = job.record
    assert r["phase"] == "check" and r["ok"] is False
    assert r["steps"]["run"] == {"exit_code": 0}
    assert r["wbm"]["all_done"] is False and r["wbm"]["markers"] == []


@pytest.mark.parametrize(
    "mode, markers, all_done",
    [
        ("warp", ["Failed to warp"], False),
        ("warp_done", ["Failed to warp"], True),  # a marker alone is enough
        ("nothing", ["Nothing to do"], False),
    ],
)
def test_exit_0_with_a_failure_marker_is_a_failed_check(job, mode, markers, all_done):
    done = job.run(STUB_LOG=mode)
    assert done.returncode == 3
    r = job.record
    assert r["ok"] is False
    assert r["wbm"]["markers"] == markers and r["wbm"]["all_done"] is all_done


def test_exit_0_with_no_nc_files_is_a_failed_check(job):
    done = job.run(STUB_NC=0)
    assert done.returncode == 3
    r = job.record
    assert r["ok"] is False
    assert r["wbm"]["all_done"] is True
    assert r["output"]["nc_count"] == 0


def test_a_log_line_that_breaks_naive_json_still_makes_a_record(job):
    done = job.run(STUB_LOG="hostile")
    assert done.returncode == 0, done.stderr
    tail = job.record["wbm"]["tail"]
    assert tail[-1] == "All Done!"
    assert tail[0].startswith('say "hi" \\ ')


def test_the_log_is_found_without_the_init_when_it_is_the_only_one(job):
    job.run()
    (job.work_dir / "wbm_init/wbm_test.init").unlink()
    (job.submit_dir / "outcome.json").unlink()
    done = job.run(STUB_LOG="none")  # stage again; the old log stays
    assert done.returncode == 0
    assert job.record["wbm"]["log"] == f"wbm_output/{SIM_ID}/wbm_test.log"


def test_a_long_log_line_is_cut_and_the_tail_is_40_lines(job, tmp_path):
    job.run()
    log = job.work_dir / f"wbm_output/{SIM_ID}/wbm_test.log"
    log.write_text("\n".join(f"line {i} " + "x" * 600 for i in range(100)) + "\nAll Done!\n")
    (job.submit_dir / "outcome.json").unlink()
    done = job.run(STUB_LOG="none", STUB_RUN_RC=0)
    assert done.returncode == 0
    tail = job.record["wbm"]["tail"]
    assert len(tail) == 40 and tail[-1] == "All Done!"
    assert all(len(line) <= 500 for line in tail)


def test_the_manifest_is_capped_and_says_so(job):
    done = job.run(STUB_NC=5003)
    assert done.returncode == 0
    out = job.record["output"]
    assert out["nc_count"] == 5003 and out["file_count"] == 5004
    assert len(out["files"]) == 5000 and out["truncated"] is True


def test_sigterm_mid_run_is_recorded_as_an_interrupted_step(job):
    proc = subprocess.Popen(
        ["bash", str(job.script)],
        env=job.env(STUB_SLEEP=30),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,  # a group of its own, like a SLURM step
    )
    try:
        running = job.work_dir / ".running"
        deadline = time.monotonic() + 30
        while not running.exists():
            assert time.monotonic() < deadline, "the stub never reached its sleep"
            assert proc.poll() is None
            time.sleep(0.05)
        os.killpg(proc.pid, signal.SIGTERM)  # what scancel sends the step
        stdout, stderr = proc.communicate(timeout=30)
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)
    assert proc.returncode == 143, stderr
    r = job.record
    assert r["signal"] == "TERM"
    assert r["phase"] == "run"
    assert r["steps"] == {"fetch": {"exit_code": 0}, "run": {"exit_code": None}}
    assert r["ok"] is False
    assert r["staged"] is False  # simulation.json has no exit_code yet
    assert "outcome: fail" in stdout


def test_without_slurm_submit_dir_the_record_goes_to_the_working_directory(job, tmp_path):
    env = job.env()
    del env["SLURM_SUBMIT_DIR"]
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    done = subprocess.run(
        ["bash", str(job.script)], env=env, cwd=cwd, capture_output=True, text=True
    )
    assert done.returncode == 0, done.stderr
    assert json.loads((cwd / "outcome.json").read_text())["ok"] is True


def test_a_python_that_cannot_run_still_ends_the_job_non_zero(job):
    (job.home / "venv/bin/python").unlink()
    (job.home / "venv/bin/python").symlink_to("/nonexistent/python")
    done = job.run()
    assert done.returncode == 4
    assert "outcome.json was not written" in done.stderr
    assert not (job.submit_dir / "outcome.json").exists()


def test_a_python_that_cannot_run_keeps_a_failing_steps_code(job):
    (job.home / "venv/bin/python").unlink()
    (job.home / "venv/bin/python").symlink_to("/nonexistent/python")
    assert job.run(STUB_FETCH_RC=1).returncode == 1


def test_a_failure_outside_any_step_still_writes_a_record(tmp_path):
    (tmp_path / "a-file").write_text("")
    job = Job(tmp_path, cache_dir=str(tmp_path / "a-file/cache"))  # `mkdir -p` cannot work
    done = job.run()
    assert done.returncode != 0
    r = job.record
    assert r["ok"] is False and r["steps"] == {} and r["phase"] == "fetch"


@pytest.mark.parametrize(
    "work_dir",
    [
        "relative/" + SIM_ID,
        "/scratch/simulations/sim-other",
        "/scratch/../" + SIM_ID,
        "/scratch/simulations/",
        "/",
        "/scratch/" + SIM_ID + "\nrm -rf ~",
    ],
)
def test_a_work_dir_that_is_not_this_simulations_is_refused(work_dir):
    from app.services.job_script import SubmitInputError

    with pytest.raises(SubmitInputError):
        render_job_body(
            snapshot_id=SNAPSHOT_ID,
            sim_id=SIM_ID,
            openghm_home="/home/x/apps/openghm/abc1234",
            cache_dir="/cache",
            fetch_lock="/locks/fetch.lock",
            work_dir=work_dir,
        )
