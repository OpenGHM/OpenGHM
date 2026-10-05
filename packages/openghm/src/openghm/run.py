"""Stage generated files and execute (or dry-run) a BuiltCommand."""

from __future__ import annotations

import os
import shutil
import subprocess

from .types import BuiltCommand, RunResult


def stage_files(cmd: BuiltCommand) -> None:
    """Stage everything the host needs before running, in dependency order.

    1. copy directories (e.g. a per-sim ``wbm_init``),
    2. create output directories (per-sim ``spool``/``wbm_output``/...),
    3. write generated files *last*, so a generated init overwrites its copy.
    """
    for c in cmd.staged_copies:
        shutil.copytree(c.src, c.dst, dirs_exist_ok=True)
    for d in cmd.staged_dirs:
        os.makedirs(d, exist_ok=True)
    for f in cmd.generated_files:
        directory = os.path.dirname(f.host_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(f.host_path, "w", encoding="utf-8") as fh:
            fh.write(f.content)


def run_command(
    cmd: BuiltCommand,
    *,
    dry_run: bool = False,
    capture: bool = False,
    stage: bool = True,
) -> RunResult:
    """Stage files and run ``cmd.argv``.

    ``dry_run`` returns the plan without staging or spawning. ``capture`` returns
    stdout/stderr as strings instead of streaming to the terminal. ``stage=False``
    runs a command the caller has already staged.
    """
    if dry_run:
        return RunResult(dry_run=True, argv=cmd.argv, display=cmd.display)

    if stage:
        stage_files(cmd)
    if capture:
        proc = subprocess.run(cmd.argv, capture_output=True, text=True)
        return RunResult(
            dry_run=False,
            argv=cmd.argv,
            display=cmd.display,
            exit_code=proc.returncode,
            stdout=proc.stdout,
            stderr=proc.stderr,
        )
    proc = subprocess.run(cmd.argv)  # inherit stdio (stream to terminal)
    return RunResult(
        dry_run=False,
        argv=cmd.argv,
        display=cmd.display,
        exit_code=proc.returncode,
    )
