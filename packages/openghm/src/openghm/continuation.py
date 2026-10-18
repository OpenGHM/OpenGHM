"""Rerunning ``sim run`` on a work directory that already holds a run (ADR 0037).

A job that SLURM stopped at its time limit leaves ``<work dir>/WBM_run_state/`` and
``<work dir>/wbm_output/<sim id>/`` as WBM left them, and the gateway reruns the identical
``sim run``. WBM resumes on its own from ``<ID>.dat``; what this module adds is the care around
the cut, from what WBM's code does (``images/wbm-tools-lite/wbm/model/wbm.pl``, the block "Save
state of the run"):

- A save writes ``<ID>.dat`` first, then the ``<ID>.bucket-*.dat`` / ``.sM.*.dat`` / ... files,
  then ``<ID>.yr_data.json`` (and ``<ID>.usgs_data.json`` when there is USGS data). The end of
  the spinup writes ``<ID>.spinup.*`` instead, which a resume does not read.
  So a state is **resumable** when ``<ID>.dat`` and ``<ID>.yr_data.json`` exist and no
  ``<ID>.*.dat`` is newer than the ``.json``, **inconsistent** when ``<ID>.dat`` exists and that
  does not hold (a kill landed inside a save), and **none** without ``<ID>.dat``.
- WBM writes a year's output files before the state save at that year's end, so every ``*.nc``
  newer than ``<ID>.dat`` belongs to the year a cut interrupted, and WBM rewrites it.
- WBM exits 0 on a resume that finds nothing to do; its log says how far it got.

The WBM run ID is the init's ``ID``, which is not the simulation id.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from .errors import OpenghmError
from .sim import SIDECAR_NAME, read_sidecar, sidecar_path
from .types import BuiltCommand

NONE = "none"
RESUMABLE = "resumable"
INCONSISTENT = "inconsistent"

#: ``sim run`` exit codes of its own (WBM's code, 1 and 2 keep their meaning).
EXIT_STATE_INCONSISTENT = 64
EXIT_STOPPED_SHORT = 65

#: The directory under the run's output directory that WBM writes once and never again.
KEEP_DIR = "cell_area"

_ID_RE = re.compile(r"""^[\s{]*ID\s*=>\s*(?:'([^']*)'|"([^"]*)")""", re.MULTILINE)
_RUN_END_RE = re.compile(r"""\bRun_End\b\s*=>\s*(?:'([^']*)'|"([^"]*)")""")
_DAY_RE = re.compile(r"^(Spinup \d+/\d+|File \S+) \((\d{4}-\d{2}-\d{2})")


class RunStateInconsistent(OpenghmError):
    """The run state was not all written by one save; the run cannot be continued."""


@dataclass
class RunState:
    """What :func:`state_status` found: ``status`` is :data:`NONE`, :data:`RESUMABLE` or
    :data:`INCONSISTENT`; ``saved_at`` (ISO-8601 UTC) only when resumable; ``dat_mtime_ns`` is
    ``<ID>.dat``'s mtime, ``None`` when there is no such file."""

    status: str
    saved_at: Optional[str] = None
    dat_mtime_ns: Optional[int] = None


@dataclass
class RunLayout:
    """Where one simulation's WBM state, output and log are, and when its run ends."""

    work_dir: str
    sim_id: str
    wbm_id: str
    run_end: Optional[str]

    @property
    def run_state_dir(self) -> str:
        return os.path.join(self.work_dir, "WBM_run_state")

    @property
    def output_dir(self) -> str:
        return os.path.join(self.work_dir, "wbm_output", self.sim_id)

    @property
    def log_path(self) -> str:
        return os.path.join(self.output_dir, f"{self.wbm_id}.log")


# ── reading the init ─────────────────────────────────────────────────────────


def _quoted(m: Optional["re.Match[str]"]) -> Optional[str]:
    if m is None:
        return None
    value = m.group(1) if m.group(1) is not None else m.group(2)
    return value.strip() or None


def wbm_id_of(init_text: str) -> Optional[str]:
    """The ``ID => '...'`` of a WBM init, ``None`` when it has none. Only a key that starts a
    line counts, so ``MT_ID`` and ``State_ID`` do not."""
    return _quoted(_ID_RE.search(init_text))


def run_end_of(init_text: str) -> Optional[str]:
    """The init's ``Run_End``, ``None`` when it has none."""
    return _quoted(_RUN_END_RE.search(init_text))


def layout_from_init(work_dir: str, sim_id: str, init_text: str) -> Optional[RunLayout]:
    """The layout of a simulation from its per-sim init; ``None`` when the init has no ID."""
    wbm_id = wbm_id_of(init_text)
    if wbm_id is None:
        return None
    return RunLayout(work_dir=work_dir, sim_id=sim_id, wbm_id=wbm_id, run_end=run_end_of(init_text))


def layout_for_run(built: BuiltCommand) -> Optional[RunLayout]:
    """The layout of the run a ``sim run`` command stages: its per-sim init, with the overrides
    applied, is one of ``built.generated_files``. ``None`` when that cannot be told."""
    sidecar = sidecar_path(built)
    if not sidecar:
        return None
    work_dir = os.path.dirname(sidecar)
    files = {f.host_path: f.content for f in built.generated_files}
    meta = json.loads(files[sidecar])
    init, sim_id = meta.get("init"), meta.get("simulation_id")
    text = files.get(os.path.join(work_dir, "wbm_init", init)) if init else None
    if not sim_id or text is None:
        return None
    return layout_from_init(work_dir, sim_id, text)


def layout_from_work_dir(work_dir: str) -> RunLayout:
    """The layout of a simulation as its work directory records it: ``simulation.json`` names
    the init, which ``sim run`` generated into ``wbm_init/``. Raises :class:`OpenghmError` when
    the work directory, the sidecar or the init cannot be read; the init may have no ID, in which
    case ``wbm_id`` is the empty string."""
    if not os.path.isdir(work_dir):
        raise OpenghmError(f"not a directory: {work_dir}")
    sidecar = read_sidecar(os.path.join(work_dir, SIDECAR_NAME))
    init = sidecar.get("init")
    if not isinstance(init, str) or not init:
        raise OpenghmError(f"{os.path.join(work_dir, SIDECAR_NAME)} does not name the run's init")
    init_path = os.path.join(work_dir, "wbm_init", init)
    try:
        with open(init_path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError as e:
        raise OpenghmError(f"cannot read {init_path}: {e}")
    sim_id = sidecar.get("simulation_id") or os.path.basename(os.path.normpath(work_dir))
    return RunLayout(work_dir=work_dir, sim_id=sim_id, wbm_id=wbm_id_of(text) or "", run_end=run_end_of(text))


# ── the state ────────────────────────────────────────────────────────────────


def _iso_utc(mtime_ns: int) -> str:
    return datetime.fromtimestamp(mtime_ns // 1_000_000_000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def state_status(directory: str, wbm_id: str) -> RunState:
    """The state of ``<ID>.*`` in a run-state directory (or in the ``WBM_run_state`` of a work
    directory): :data:`NONE`, :data:`RESUMABLE` or :data:`INCONSISTENT`.

    ``<ID>.spinup.*`` is ignored throughout: a resume does not read it. Times are compared as
    nanoseconds, strictly: a file is newer only when its mtime is later.
    """
    nested = os.path.join(directory, "WBM_run_state")
    if os.path.isdir(nested):
        directory = nested
    prefix = f"{wbm_id}."
    try:
        names = os.listdir(directory)
    except OSError:
        return RunState(NONE)

    def mtime(name: str) -> Optional[int]:
        try:
            return os.stat(os.path.join(directory, name)).st_mtime_ns
        except OSError:
            return None

    dat = mtime(f"{wbm_id}.dat")
    if dat is None:
        return RunState(NONE)
    json_ns = mtime(f"{wbm_id}.yr_data.json")
    if json_ns is None:
        return RunState(INCONSISTENT, dat_mtime_ns=dat)
    for name in names:
        if not (name.startswith(prefix) and name.endswith(".dat")) or name.startswith(f"{prefix}spinup."):
            continue
        t = mtime(name)
        if t is not None and t > json_ns:
            return RunState(INCONSISTENT, dat_mtime_ns=dat)
    return RunState(RESUMABLE, saved_at=_iso_utc(json_ns), dat_mtime_ns=dat)


# ── the output of the cut year ───────────────────────────────────────────────


def prepare_rerun(output_dir: str, state: RunState) -> List[str]:
    """Delete the ``*.nc`` under the run's output directory that WBM will write again, and return
    their paths: those newer than ``<ID>.dat`` of a resumable state, every one when there is
    none. ``cell_area/`` is kept. An inconsistent state is refused (:class:`RunStateInconsistent`),
    since there is no telling which output belongs to which save."""
    if state.status == INCONSISTENT:
        raise RunStateInconsistent("the run state is inconsistent")
    cutoff = state.dat_mtime_ns if state.status == RESUMABLE else None
    deleted: List[str] = []
    for root, dirs, files in os.walk(output_dir):
        if root == output_dir and KEEP_DIR in dirs:
            dirs.remove(KEEP_DIR)
        for name in files:
            if not name.endswith(".nc"):
                continue
            path = os.path.join(root, name)
            try:
                if cutoff is not None and os.stat(path).st_mtime_ns <= cutoff:
                    continue
                os.remove(path)
            except FileNotFoundError:
                continue
            deleted.append(path)
    return sorted(deleted)


# ── how far WBM got ──────────────────────────────────────────────────────────


def last_day(log_path: str, *, window: int = 1 << 16) -> Optional[Tuple[str, str]]:
    """The last per-day line of WBM's log: ``("Spinup", date)`` or ``("File", date)``. ``None``
    when the log is missing or has none. The log is appended to across reruns, so it is read from
    the end, in growing windows."""
    try:
        with open(log_path, "rb") as fh:
            size = fh.seek(0, os.SEEK_END)
            while True:
                start = max(0, size - window)
                fh.seek(start)
                text = fh.read(size - start).decode("utf-8", errors="replace")
                lines = text.splitlines()
                if start > 0:
                    lines = lines[1:]            # the first line may be cut
                for line in reversed(lines):
                    m = _DAY_RE.match(line)
                    if m:
                        return m.group(1).split(" ", 1)[0], m.group(2)
                if start == 0:
                    return None
                window *= 4
    except OSError:
        return None


def stopped_short(layout: RunLayout) -> Optional[str]:
    """After WBM exited 0: why its log does not show a finished run, or ``None`` when its last day
    line is a ``File`` line dated the run's ``Run_End`` (nothing to check when the init has none)."""
    if layout.run_end is None:
        return None
    last = last_day(layout.log_path)
    if last is None:
        return f"WBM's log has no day line ({layout.log_path})"
    kind, date = last
    if kind == "File" and date == layout.run_end:
        return None
    if date < layout.run_end or kind == "Spinup":
        return f"WBM stopped on {date}, before the run's end {layout.run_end}"
    return f"WBM's last day, {date}, is not the run's end {layout.run_end}"
