"""The publish job's body and its record (ADR 0031): renders the real body, runs
it with `bash` against a stub `openghm` whose exit code and stderr are chosen per
test, and reads the `publish-outcome.json` and the exit code it leaves. No Anvil,
no SLURM: `SLURM_SUBMIT_DIR` is a temp directory.

Bash 3.2 (macOS) and 4+ (Anvil) must both run the body, so nothing in it may need
a newer one: this file runs on whichever `bash` is on PATH.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

from app.services import publish
from app.services.job_script import SubmitInputError

SNAPSHOT_ID = "ab" * 32
WORK = "/anvil/scratch/x-openghm/simulations/sim-20261005-76c660"
META = "/anvil/scratch/x-openghm/gateway/jobs/slurmly-92395059/publish-metadata.json"

# A stand-in for `openghm`: `snapshot publish` records its arguments, prints what the
# real one prints to stdout, writes STUB_STDERR to stderr and exits STUB_RC.
STUB = r"""#!/bin/bash
if [ "$1" = "--version" ]; then echo "0.0.0-stub"; exit 0; fi
if [ "$1 $2" = "snapshot publish" ]; then
  printf '%s\n' "$@" > "$STUB_ARGS"
  echo "snapshot id: $7"
  if [ -n "${STUB_STDERR:-}" ]; then printf '%b' "$STUB_STDERR" >&2; fi
  if [ -n "${STUB_SLEEP:-}" ]; then touch "$STUB_RUNNING"; sleep "$STUB_SLEEP" & wait $!; fi
  exit "${STUB_RC:-0}"
fi
echo "stub: unexpected arguments: $*" >&2
exit 99
"""


class Publish:
    """One rendered body, its temp tree and how to run it."""

    def __init__(self, root: Path, **render) -> None:
        self.root = root
        self.home = root / "apps/openghm/3b52b29"
        (self.home / "bin").mkdir(parents=True)
        (self.home / "venv/bin").mkdir(parents=True)
        (self.home / "bin/openghm").write_text(STUB)
        (self.home / "bin/openghm").chmod(0o755)
        (self.home / "venv/bin/python").symlink_to(sys.executable)
        self.submit_dir = root / "submit"
        self.submit_dir.mkdir()
        self.body = publish.render_publish_body(
            **{
                **dict(
                    snapshot_id=SNAPSHOT_ID,
                    openghm_home=str(self.home),
                    work_dir=WORK,
                    metadata_path=META,
                    s3cfg="~/.s3cfg",
                ),
                **render,
            }
        )
        self.script = root / "run.sh"
        # slurmly puts the shebang and `set -euo pipefail` above the body.
        self.script.write_text("#!/bin/bash\nset -euo pipefail\n" + self.body + "\n")

    def env(self, **extra) -> dict:
        env = {
            **os.environ,
            "SLURM_SUBMIT_DIR": str(self.submit_dir),
            "SLURM_JOB_ID": "4242",
            "STUB_ARGS": str(self.root / "args"),
            "STUB_RUNNING": str(self.root / "running"),
        }
        env.update({k: str(v) for k, v in extra.items()})
        return env

    def run(self, **extra) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(self.script)],
            env=self.env(**extra),
            capture_output=True,
            text=True,
            errors="replace",
            timeout=60,
        )

    @property
    def record(self) -> dict:
        return json.loads((self.submit_dir / "publish-outcome.json").read_text())

    @property
    def args(self) -> list[str]:
        return (self.root / "args").read_text().splitlines()


@pytest.fixture
def job(tmp_path) -> Publish:
    return Publish(tmp_path)


def test_the_command_is_the_toolkits_with_every_value_quoted(job):
    assert (
        f'"$OPENGHM" snapshot publish {WORK} --metadata {META} --id {SNAPSHOT_ID} '
        "--s3cfg '~/.s3cfg' 2>\"$OG_STDERR\"" in job.body.splitlines()
    )


def test_the_job_runs_the_toolkit_with_the_arguments_it_was_given(job):
    done = job.run()
    assert done.returncode == 0, done.stderr
    assert job.args == [
        "snapshot", "publish", WORK, "--metadata", META, "--id", SNAPSHOT_ID, "--s3cfg", "~/.s3cfg",
    ]


def test_a_clean_publish_exits_0_and_records_it(job):
    done = job.run()
    assert done.returncode == 0, done.stderr
    assert "publish outcome: exit 0" in done.stdout
    r = job.record
    assert r["schema"] == 1
    assert r["snapshot_id"] == SNAPSHOT_ID
    assert r["toolkit_commit"] == "3b52b29"
    assert r["slurm_job_id"] == "4242"
    assert r["host"]
    assert r["started_at"] <= r["ended_at"]
    assert r["signal"] is None and r["exit_code"] == 0 and r["stderr_tail"] == []
    assert done.stderr == ""  # the body adds nothing of its own to stderr
    assert sorted(p.name for p in job.submit_dir.iterdir()) == ["publish-outcome.json", "publish-stderr.log"]


@pytest.mark.parametrize("rc", [2, 3, 4, 5, 6, 7])
def test_the_toolkits_exit_code_is_the_jobs_and_the_records(job, rc):
    done = job.run(STUB_RC=rc, STUB_STDERR="openghm: something it says\\n")
    assert done.returncode == rc
    assert job.record["exit_code"] == rc
    assert job.record["stderr_tail"] == ["openghm: something it says"]
    # what the toolkit wrote to stderr is still in the job's own stderr
    assert "openghm: something it says" in done.stderr


def test_the_stderr_tail_is_40_lines_cut_at_500_characters(job):
    lines = "".join(f"line {i} {'x' * 600}\\n" for i in range(100))
    job.run(STUB_RC=6, STUB_STDERR=lines)
    tail = job.record["stderr_tail"]
    assert len(tail) == 40 and tail[-1].startswith("line 99 ")
    assert all(len(line) <= 500 for line in tail)


def test_a_line_that_is_not_utf8_cannot_break_the_record(job):
    job.run(STUB_RC=6, STUB_STDERR='say "hi" \\\\ \\xff\\xfe {"a": 1}\\n')
    assert job.record["exit_code"] == 6
    assert "hi" in job.record["stderr_tail"][0]


def test_the_record_is_read_by_the_verdict_as_the_job_wrote_it(job):
    job.run(STUB_RC=7)
    verdict = publish.classify_publish(slurm_state="FAILED", outcome=job.record, snapshot_id=SNAPSHOT_ID)
    assert verdict.failure.cause == "publish_verify_failed"
    job.run(STUB_RC=0)
    assert publish.classify_publish(slurm_state="COMPLETED", outcome=job.record, snapshot_id=SNAPSHOT_ID).state == "published"


def test_a_toolkit_that_cannot_run_is_a_recorded_failure_not_a_missing_record(job):
    (job.home / "bin/openghm").unlink()
    done = job.run()
    assert done.returncode == 127
    assert job.record["exit_code"] == 127


def test_sigterm_mid_publish_is_recorded_as_interrupted(job):
    proc = subprocess.Popen(
        ["bash", str(job.script)],
        env=job.env(STUB_SLEEP=30),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,  # a group of its own, like a SLURM step
    )
    try:
        running = job.root / "running"
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
    assert r["signal"] == "TERM" and r["exit_code"] is None
    # ...so the verdict is "the job failed, try again", never a success
    assert publish.classify_publish(slurm_state="COMPLETED", outcome=r, snapshot_id=SNAPSHOT_ID).failure.cause == (
        "publish_job_failed"
    )


def test_a_python_that_cannot_run_still_ends_a_good_publish_non_zero(job):
    (job.home / "venv/bin/python").unlink()
    (job.home / "venv/bin/python").symlink_to("/nonexistent/python")
    done = job.run()
    assert done.returncode == 4
    assert "publish-outcome.json was not written" in done.stderr


def test_without_slurm_submit_dir_the_record_goes_to_the_working_directory(job, tmp_path):
    env = job.env()
    del env["SLURM_SUBMIT_DIR"]
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    done = subprocess.run(["bash", str(job.script)], env=env, cwd=cwd, capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    assert json.loads((cwd / "publish-outcome.json").read_text())["exit_code"] == 0


# ---- what the renderer refuses ----------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        {"snapshot_id": "abc"},
        {"snapshot_id": "AB" * 32},
        {"snapshot_id": "ab" * 31 + "; rm -rf /"},
        {"snapshot_id": ""},
        {"openghm_home": "relative/3b52b29"},
        {"openghm_home": "/home/x/openghm/not a commit"},
        {"work_dir": "relative/sim"},
        {"work_dir": "/anvil/../etc"},
        {"work_dir": "/anvil/scratch/x\nrm -rf /"},
        {"metadata_path": "metadata.json"},
        {"metadata_path": "/a/../b/m.json"},
        {"s3cfg": "relative/.s3cfg"},
        {"s3cfg": "~other/.s3cfg"},
        {"s3cfg": "/home/x/.s3cfg\n; rm"},
        {"s3cfg": ""},
    ],
)
def test_an_unsafe_input_is_refused(tmp_path, bad):
    with pytest.raises(SubmitInputError):
        Publish(tmp_path, **bad)


def test_a_value_with_a_space_or_a_quote_reaches_the_shell_as_one_word(tmp_path):
    job = Publish(tmp_path, s3cfg="/home/x y/it's.s3cfg", work_dir="/anvil/scratch/a b/sim")
    done = job.run()
    assert done.returncode == 0, done.stderr
    assert job.args[2] == "/anvil/scratch/a b/sim" and job.args[-1] == "/home/x y/it's.s3cfg"


def test_the_body_is_the_one_in_the_report(job):
    # It is also pasted into the mission's report: a change to it is a change to that.
    assert job.body.startswith("set +e\n")
    assert "trap finish EXIT" in job.body
    assert job.body.rstrip().endswith("OG_RC=$?")
