"""The bash body of a gateway job (ADR 0025).

A gateway job is a slurmly batch job whose body runs the pinned `openghm`
toolkit: fetch the snapshot into the shared cache, then `sim run` it. The fetch
runs under one lock that lives on /home (NFS), not on scratch, because flock on
/anvil (GPFS) does not lock across nodes (see `render_job_body`). slurmly
renders the shebang, the `#SBATCH` lines and the module preamble; everything
here is what it appends after them.

Everything in this module is pure — strings and dicts in, a string out — so
the rendered body is golden-tested (tests/test_job_script.py). Every value
that reaches the script is either matched against the pattern the toolkit
enforces on it or passed through `shlex.quote`, and usually both: the body is
emitted into a shell on a cluster, and its inputs come from a user's draft.

The body also reports how it ended (ADR 0026). Each step runs through `step`,
which records its phase and exit code, and an EXIT trap hands those facts to a
Python snippet that writes `outcome.json` into slurmly's job directory
(`$SLURM_SUBMIT_DIR`, because slurmly runs `cd <job dir> && sbatch`). The
record holds facts, never a cause: `app.services.job_verdict.classify` is the
only place a cause is named. Its schema is stable, and only the backend reads
it (the frontend gets `JobResponse.failure` and `.output`)::

    {
      "schema": 1,
      "sim_id": "...", "snapshot_id": "...", "toolkit_commit": "...",
      "host": "...", "slurm_job_id": "... or null",
      "started_at": "ISO-8601 UTC", "ended_at": "ISO-8601 UTC",
      "phase": "fetch" | "run" | "check",
      "signal": "TERM" | "INT" | "HUP" | null,
      "restart_count": 0,
      "steps": {"fetch": {"exit_code": 0}, "run": {"exit_code": 0}},
      "staged": true,
      "wbm": {"log": "wbm_output/<sim_id>/<ID>.log" | null, "all_done": true,
              "markers": ["Failed to warp"], "tail": ["last 40 lines", "..."]},
      "output": {"nc_count": 16, "total_bytes": 123, "file_count": 17,
                 "files": [{"path": "wbm_output/<sim_id>/daily/x.nc", "bytes": 1}],
                 "truncated": false},
      "post_processing": null | {"ok": false, "tail": ["last 40 lines", "..."], ...},
      "ok": true
    }

`restart_count` is SLURM's `SLURM_RESTART_COUNT`: 0 on a first run, more on a
run SLURM requeued after a node failure. The first run turns requeueing off
for the job (`scontrol update ... Requeue=0`), but a requeue that started
before it got that far runs the body again: that run fetches and runs nothing,
records its `restart_count` and exits non-zero, because it would otherwise write
into the work directory the first attempt left half-written, under the same
`sim_id`. `classify` reads a `restart_count` above 0 as `node_failure`.

A step that was not reached is absent from `steps`; one the script was
interrupted in has `"exit_code": null`. `staged` is whether `simulation.json`
has an `exit_code` (the toolkit writes it only once the container ran), which
tells `sim run` refusing before staging from WBM failing after it. `markers`
are the failure lines WBM exits 0 after (`WBM_MARKERS`) that the log holds;
`Failed to warp` is printed to WBM's stderr, which this record does not read,
so `classify` looks for the markers in the stderr tail too. `all_done` is its
success line. `post_processing` is the toolkit's own record of the post-processing
the run's init asked for (`simulation.json`'s `post_processing`, copied whole):
null when the init did not ask or the file holds none. `classify` reads its
`ok` and `tail`, and a record whose `post_processing.ok` is false is not `ok`
itself, whatever the steps' exit codes. `output.files` is capped at 5000 and its paths
are relative to the work directory, under `wbm_output/<sim_id>/` only. `ok` is
the script's own judgement and only sets its exit code, so SLURM agrees.
"""

from __future__ import annotations

import json
import math
import posixpath
import re
import shlex
from dataclasses import dataclass
from datetime import date

from app.models.job import MAX_RUN_SECONDS, MAX_WALLTIME_SECONDS, JobParameters


class SubmitInputError(ValueError):
    """An input the job body or job spec cannot be built from. `str()` is a
    message meant for the person who owns the draft."""


# The toolkit accepts `[A-Za-z0-9._-]+` for a snapshot id (fetch.py `_ID_RE`)
# and for `--id` (sim.py `_SIM_ID_RE`). Both end up as a path component and as
# a positional or option value, so a leading `-` (read as a flag) or `.` (`.`
# and `..`) is refused here on top of the toolkit's own rule.
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
# A toolkit install directory is named for a public commit. It is also printed
# inside double quotes in the script, so it stays to a conservative alphabet.
_COMMIT_RE = re.compile(r"^[A-Za-z0-9._+-]+$")
# A WBM output variable is an identifier (`runoff`, `streamAge`, `discharge_ps`).
# They are joined with spaces into one `--output-vars` value, so whitespace in
# a name would silently become two variables.
_VARIABLE_RE = re.compile(r"^[A-Za-z0-9_]+$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

#: The lines WBM prints and exits 0 after. `Failed to warp` goes to its stderr
#: (`WBM.pm`, the gdalwarp failure), `Nothing to do` to its log: so the script
#: scans the log for them and `job_verdict.classify` scans stderr too. The one
#: list, for both.
WBM_MARKERS = ("Failed to warp", "Nothing to do")

#: The program the EXIT trap feeds to the toolkit venv's Python, as a quoted
#: heredoc. That Python is 3.9 on Anvil, so: stdlib only, no `X | Y`
#: annotations. Its inputs are environment variables the body exports
#: (`OG_*`), never text interpolated into it. Exits 0 for a record that says `ok`, 10 for one that
#: does not, and anything else (a traceback) when the record was not written.
_OUTCOME_PY = r'''import json, os, re, socket, sys, tempfile
from collections import deque
from datetime import datetime, timezone

E = os.environ
MARKERS = @MARKERS@
MAX_FILES = 5000


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


sim_id = E["OG_SIM_ID"]
work = E["OG_WORK_DIR"]
steps = {}
for name in ("fetch", "run"):
    v = E.get("OG_RC_" + name)
    if v is not None:
        steps[name] = {"exit_code": int(v) if re.fullmatch(r"\d+", v) else None}

sim = load(os.path.join(work, "simulation.json"))
sim = sim if isinstance(sim, dict) else {}
staged = sim.get("exit_code") is not None

out_dir = os.path.join(work, "wbm_output", sim_id)
log = None
init = sim.get("init")
if isinstance(init, str) and init:
    try:
        with open(os.path.join(work, "wbm_init", os.path.basename(init))) as f:
            m = re.search(r"^\s*ID\s*=>\s*'([^']+)'", f.read(), re.M)
        if m and os.path.isfile(os.path.join(out_dir, os.path.basename(m.group(1)) + ".log")):
            log = os.path.join(out_dir, os.path.basename(m.group(1)) + ".log")
    except OSError:
        pass
if log is None and os.path.isdir(out_dir):
    logs = [n for n in sorted(os.listdir(out_dir)) if n.endswith(".log")]
    if len(logs) == 1:
        log = os.path.join(out_dir, logs[0])

wbm = {"log": None, "all_done": False, "markers": [], "tail": []}
if log is not None:
    found = set()
    tail = deque(maxlen=40)
    with open(log, errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if "All Done!" in line:
                wbm["all_done"] = True
            found.update(m for m in MARKERS if m in line)
            tail.append(line[:500])
    wbm["log"] = os.path.relpath(log, work)
    wbm["markers"] = [m for m in MARKERS if m in found]
    wbm["tail"] = list(tail)

files = []
nc_count = total = count = 0
for root, dirs, names in os.walk(out_dir):
    dirs.sort()
    for n in sorted(names):
        p = os.path.join(root, n)
        if os.path.islink(p) or not os.path.isfile(p):
            continue
        size = os.path.getsize(p)
        count += 1
        total += size
        nc_count += n.endswith(".nc")
        if len(files) < MAX_FILES:
            files.append({"path": os.path.relpath(p, work), "bytes": size})
output = {
    "nc_count": nc_count, "total_bytes": total, "file_count": count,
    "files": files, "truncated": count > len(files),
}

signal = E.get("OG_SIGNAL") or None
restart = E.get("SLURM_RESTART_COUNT") or ""
restart_count = int(restart) if re.fullmatch(r"\d+", restart) else 0
post = sim.get("post_processing") if isinstance(sim.get("post_processing"), dict) else None
ok = (
    "fetch" in steps and "run" in steps
    and all(s["exit_code"] == 0 for s in steps.values())
    and signal is None
    and restart_count == 0
    and wbm["all_done"] and not wbm["markers"] and nc_count > 0
    and not (post is not None and post.get("ok") is False)
)
record = {
    "schema": 1,
    "sim_id": sim_id,
    "snapshot_id": E["OG_SNAPSHOT_ID"],
    "toolkit_commit": E["OG_COMMIT"],
    "host": socket.gethostname(),
    "slurm_job_id": E.get("SLURM_JOB_ID") or None,
    "started_at": E["OG_STARTED"],
    "ended_at": now(),
    "phase": E["OG_PHASE"],
    "signal": signal,
    "restart_count": restart_count,
    "steps": steps,
    "staged": staged,
    "wbm": wbm,
    "output": output,
    "post_processing": post,
    "ok": ok,
}
dest = E.get("SLURM_SUBMIT_DIR") or os.getcwd()
fd, tmp = tempfile.mkstemp(dir=dest, prefix=".outcome.", suffix=".tmp")
with os.fdopen(fd, "w") as f:
    json.dump(record, f)
    f.flush()
    os.fsync(f.fileno())
os.replace(tmp, os.path.join(dest, "outcome.json"))
print("outcome: " + ("ok" if ok else "fail"))
sys.exit(0 if ok else 10)
'''
OUTCOME_PY = _OUTCOME_PY.replace(
    "@MARKERS@", "(" + ", ".join(json.dumps(m) for m in WBM_MARKERS) + ")"
)


def is_valid_id(value: object) -> bool:
    """Whether `value` is an id the renderer accepts (a snapshot or simulation
    id). Also how the delete route decides a `sim_id` may name a directory."""
    return isinstance(value, str) and _ID_RE.match(value) is not None


def _check_id(kind: str, value: str) -> str:
    if not is_valid_id(value):
        raise SubmitInputError(f"{kind} {value!r} is not a valid id")
    return value


def _check_abs_path(kind: str, value: str) -> str:
    if not isinstance(value, str) or not value.startswith("/") or "\x00" in value or "\n" in value:
        raise SubmitInputError(f"{kind} must be an absolute path (got {value!r})")
    return value.rstrip("/") or "/"


def toolkit_paths(openghm_home: str) -> tuple[str, str]:
    """`(bin/openghm, gateway.toml)` of a toolkit install: the executable a job
    runs and the config it passes with `--config`. Raises `SubmitInputError`
    when `openghm_home` is not an absolute path. Unquoted: the caller quotes."""
    home = _check_abs_path("ANVIL_OPENGHM_HOME", openghm_home)
    return home + "/bin/openghm", home + "/gateway.toml"


def toolkit_commit(openghm_home: str) -> str:
    """The commit a toolkit install is pinned to: the install directory's
    name (`<...>/apps/openghm/<commit>`, ADR 0025)."""
    home = _check_abs_path("ANVIL_OPENGHM_HOME", openghm_home)
    commit = posixpath.basename(home)
    if not _COMMIT_RE.match(commit):
        raise SubmitInputError(
            f"ANVIL_OPENGHM_HOME must end in the commit's name (got {openghm_home!r})"
        )
    return commit


# Records a step's phase and exit code, then returns that code so `set -e`
# still ends the script at the first failing step. `|| rc=$?` keeps the code
# from being lost to `set -e`. The code stays unset until the command returns:
# a signal handler runs only once the foreground command is gone, and then the
# step is recorded as interrupted (empty, read as `null`) rather than as
# having exited 0. `$OG_PHASE` is one of our own literal names, so `eval` only
# ever sees `OG_RC_fetch` or `OG_RC_run`.
_STEP = """\
step() {
  OG_PHASE=$1; shift
  eval "OG_RC_$OG_PHASE="
  local rc=0
  "$@" || rc=$?
  eval "OG_RC_$OG_PHASE=$rc"
  [ "$rc" -eq 0 ] || STEP_RC=$rc
  return "$rc"
}"""

# The EXIT trap. `$?` is read first, before anything changes it. It is 0 for a
# bare SIGTERM, which is why TERM, INT and HUP have traps of their own that
# record the signal and `exit` with its code. The script's exit code is the
# status it ended with (a signal's, a failing step's, or another command's
# under `set -e`), else 0 for a record that says ok and 3 when the steps
# passed and the check (markers, manifest) did not. The record is written by Python: JSON
# built in bash breaks on the first quote in a log line.
_FINISH = """\
finish() {
  local status=$?
  set +e
  trap - EXIT
  "$PY" - <<'PYEOF'
""" + OUTCOME_PY + """PYEOF
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
}"""


# SLURM requeues a batch job after a node failure (`JobRequeue=1`, up to
# `MaxBatchRequeue=5` times on Anvil, read on 2026-10-07), and the requeued run
# would write the same `sim_id` into the same work directory, on top of what the
# first attempt left, while the gateway sees one job. slurmly has no JobSpec field
# for `--no-requeue`, and a line after its `#SBATCH` lines is ignored by sbatch,
# so the body turns requeueing off itself: the first run does it for the job
# (`scontrol update Requeue=0`, run from inside the job; checked to return 0 and
# show `Requeue=0` afterwards), and a run SLURM requeued before that happened
# (`SLURM_RESTART_COUNT` is its restart count, unset on a first run) stops without
# fetching or running, and says so in `outcome.json`. A failed `scontrol` is a
# warning: the job is worth more than the guard. 75 is `EX_TEMPFAIL`.
_REQUEUE_GUARD = """\
if [ "${SLURM_RESTART_COUNT:-0}" != 0 ]; then
  echo "openghm: SLURM requeued this job (restart count $SLURM_RESTART_COUNT); not running it again" >&2
  exit 75
fi
if [ -n "${SLURM_JOB_ID:-}" ]; then
  scontrol update JobId="$SLURM_JOB_ID" Requeue=0 \\
    || echo "openghm: warning: could not turn requeueing off for this job" >&2
fi"""


def render_job_body(
    *,
    snapshot_id: str,
    sim_id: str,
    openghm_home: str,
    cache_dir: str,
    fetch_lock: str,
    work_dir: str,
    run_start: str | None = None,
    run_end: str | None = None,
    output_vars: str | None = None,
    post_processing: str | None = None,
    walltime: str | None = None,
) -> str:
    """The job's bash body. `run_start`, `run_end`, `output_vars` and `post_processing`
    are passed to `sim run` only when given — the caller gives one only when the draft
    differs from the snapshot's own value (see `run_overrides`).

    `walltime` is the value the job asks SLURM for (`--time`, as
    `slurm.resolve_compute` resolves it, in SLURM's own syntax): the toolkit's
    spool lease lasts as long as the job does (`sim run --walltime`). The
    caller always gives it; without one the toolkit falls back to its own
    default lease.

    The fetch takes one lock for every snapshot, not one each: a fetch also
    writes the model-input and image caches, which snapshots share, and two
    snapshots can link the same model input. `fetch_lock` must be on a
    filesystem where flock works across nodes: on Anvil that is /home (NFS),
    not /anvil (GPFS), where two jobs on different nodes held it at once.
    The simulation shares a spool through the toolkit's spool cache (`--spool cache`),
    which links the days the cache holds and harvests the days the simulation built
    after it exits 0; the fetch brings no spool.

    `work_dir` is where `sim run` writes (`<output_base>/<sim_id>`, ADR 0023):
    the body reads WBM's log and lists the output there to write
    `outcome.json` (see the module docstring). Raises `SubmitInputError` on an
    id or path that is not safe to render.
    """
    snapshot_id = _check_id("snapshot id", snapshot_id)
    sim_id = _check_id("simulation id", sim_id)
    home = _check_abs_path("ANVIL_OPENGHM_HOME", openghm_home)
    openghm, config = toolkit_paths(home)
    commit = toolkit_commit(home)
    cache = _check_abs_path("ANVIL_CACHE_DIR", cache_dir)
    lock = _check_abs_path("ANVIL_FETCH_LOCK", fetch_lock)
    if lock == "/" or fetch_lock.endswith("/"):
        raise SubmitInputError(f"ANVIL_FETCH_LOCK must name a file (got {fetch_lock!r})")
    work = _check_abs_path("work directory", work_dir)
    if ".." in work.split("/") or posixpath.basename(work) != sim_id:
        raise SubmitInputError(
            f"The work directory must be an absolute path ending in /{sim_id} (got {work_dir!r})"
        )

    run = [
        'step run "$OPENGHM" sim run --config "$CONFIG"',
        f'"$CACHE/snapshots/{snapshot_id}"',
        f"--id {sim_id}",
    ]
    if run_start is not None:
        run.append(f"--run-start {shlex.quote(_check_date('run start', run_start))}")
    if run_end is not None:
        run.append(f"--run-end {shlex.quote(_check_date('run end', run_end))}")
    if output_vars is not None:
        run.append(f"--output-vars {shlex.quote(_check_output_vars(output_vars))}")
    if post_processing is not None:
        run.append(f"--post-processing {_check_post_processing(post_processing)}")
    if walltime is not None:
        run.append(f"--walltime {shlex.quote(_check_walltime(walltime))}")
    run.append("--spool cache")

    return "\n".join(
        [
            "set -euo pipefail",
            f"OPENGHM={shlex.quote(openghm)}",
            f"CONFIG={shlex.quote(config)}",
            f"CACHE={shlex.quote(cache)}",
            f"PY={shlex.quote(home + '/venv/bin/python')}",
            f"export OG_SNAPSHOT_ID={snapshot_id} OG_SIM_ID={sim_id} OG_COMMIT={commit}",
            f"export OG_WORK_DIR={shlex.quote(work)}",
            'OG_STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)',
            "OG_PHASE=fetch OG_SIGNAL= STEP_RC=0",
            "export OG_STARTED OG_PHASE OG_SIGNAL OG_RC_fetch OG_RC_run",
            _STEP,
            _FINISH,
            "trap finish EXIT",
            "trap 'OG_SIGNAL=TERM; exit 143' TERM",
            "trap 'OG_SIGNAL=INT; exit 130' INT",
            "trap 'OG_SIGNAL=HUP; exit 129' HUP",
            _REQUEUE_GUARD,
            f'echo "openghm $("$OPENGHM" --version) commit {commit}"',
            'mkdir -p "$CACHE/snapshots"',
            f'step fetch flock {shlex.quote(lock)} "$OPENGHM" snapshot fetch --config "$CONFIG" '
            f'{snapshot_id} --dest "$CACHE/snapshots/{snapshot_id}"',
            " ".join(run),
            "OG_PHASE=check",
        ]
    )


def _check_date(kind: str, value: str) -> str:
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise SubmitInputError(f"The {kind} must be a date like 2000-01-31 (got {value!r}).")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise SubmitInputError(f"The {kind} {value!r} is not a real date.")
    return value


_POST_PROCESSING_CHOICES = ("standard", "climatology")


def _check_post_processing(value: str) -> str:
    if value not in _POST_PROCESSING_CHOICES:
        raise SubmitInputError("The output choice must be 'standard' or 'climatology'.")
    return value


def _check_walltime(value: str) -> str:
    """A walltime in SLURM's syntax, as it is: the toolkit parses the same
    formats (`parse_slurm_time` is the gateway's reading of them)."""
    if not isinstance(value, str) or not _SLURM_TIME_RE.match(value.strip()):
        raise SubmitInputError(f"The walltime {value!r} is not a SLURM time.")
    if parse_slurm_time(value) <= 0:
        raise SubmitInputError("The walltime must be more than zero.")
    return value.strip()


def _check_output_vars(value: str) -> str:
    names = value.split(" ")
    if not value or not all(_VARIABLE_RE.match(n) for n in names):
        raise SubmitInputError(
            "Output variables must be names made of letters, digits and underscores."
        )
    return value


# ---------------------------------------------------------------------------
# SLURM --time
# ---------------------------------------------------------------------------

_SLURM_TIME_RE = re.compile(r"^(?:(\d+)-)?(\d+)(?::(\d{1,2}))?(?::(\d{1,2}))?$")


def parse_slurm_time(value: str) -> int:
    """Seconds in a SLURM `--time` value: `M`, `M:S`, `H:M:S`, `D-H`,
    `D-H:M` or `D-H:M:S`. `15:00` is fifteen minutes, not fifteen hours.
    Mirrored by `parseSlurmTime` in the frontend's lib/jobs/compute.ts."""
    m = _SLURM_TIME_RE.match(value.strip())
    if not m:
        raise SubmitInputError(f"{value!r} is not a SLURM time")
    days, a, b, c = m.groups()
    a = int(a)
    b = None if b is None else int(b)
    c = None if c is None else int(c)
    if days is not None:
        return int(days) * 86400 + a * 3600 + (b or 0) * 60 + (c or 0)
    if b is None:
        return a * 60
    if c is None:
        return a * 60 + b
    return a * 3600 + b * 60 + c


def format_slurm_time(seconds: int) -> str:
    """`M:SS` under an hour, `H:MM:SS` from an hour up (hours are not capped)."""
    h, rest = divmod(seconds, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _headroom_seconds(seconds: int) -> int:
    """`seconds` plus 50%, rounded up to a whole second."""
    return (seconds * 3 + 1) // 2


def with_headroom(walltime: str) -> str:
    """A snapshot's recommended walltime plus 50%, in SLURM's format, rounded
    up to a whole second and never over `MAX_WALLTIME_SECONDS` (what one job
    may use on Anvil): `15:00` becomes `22:30`, `4:30:00` becomes `6:45:00`,
    `80:00:00` becomes `96:00:00`. A simulation of the v2 snapshot took 13:49 of its
    recommended 15:00, so the bare recommendation leaves no room. A recommendation
    that is itself over the limit cannot be run in one job; the job asks for the
    cap and the run continues in the next job when SLURM stops it (ADR 0037).
    Mirrored by `withHeadroom` in the frontend's lib/jobs/compute.ts."""
    seconds = _headroom_seconds(parse_slurm_time(walltime))
    return format_slurm_time(min(seconds, MAX_WALLTIME_SECONDS))


def post_processing_walltime(snapshot: dict) -> str | None:
    """The snapshot's `recommendedCompute.postProcessingWalltime`: how long the
    post-processing step took on its reference period. None when it was not
    measured (the field is absent) or is not a SLURM time."""
    value = (snapshot.get("simulation", {}).get("recommendedCompute") or {}).get(
        "postProcessingWalltime"
    )
    if not value:
        return None
    try:
        parse_slurm_time(str(value))
    except SubmitInputError:
        return None
    return str(value)


def runs_climatology(parameters: JobParameters, own_post_processing: str | None) -> bool:
    """Whether the run will post-process: the draft asks for `climatology`, or
    asks nothing and the snapshot's own init does (`own_post_processing`,
    `run_start.InitRules.post_processing`; None when the init could not be read,
    which counts as not). The one rule the resolved walltime and the run-time
    limit check share, mirrored by `runsClimatology` in the frontend's
    lib/jobs/compute.ts."""
    return (parameters.post_processing or own_post_processing) == "climatology"


def recommended_walltime(snapshot: dict, post_processing: bool = False) -> str | None:
    """The snapshot's recommended walltime, in SLURM's format and without headroom.
    When the run `post_processing` it is the walltime plus the measured
    `postProcessingWalltime`, or the walltime alone when that was not measured.
    None when the snapshot has no walltime. Raises `SubmitInputError` for one
    that is not a SLURM time."""
    walltime = (snapshot.get("simulation", {}).get("recommendedCompute") or {}).get("walltime")
    if not walltime:
        return None
    seconds = parse_slurm_time(str(walltime))
    extra = post_processing_walltime(snapshot) if post_processing else None
    if extra is None:
        return str(walltime)
    return format_slurm_time(seconds + parse_slurm_time(extra))


def estimated_run_seconds(snapshot: dict, post_processing: bool = False) -> int | None:
    """How long a run of this snapshot is estimated to take: the recommended
    walltime (with the post-processing time when the run `post_processing`s,
    `recommended_walltime`) plus 50%, not capped at one job's limit. What the
    simulation's 2-week limit (`MAX_RUN_SECONDS`) is held against. None when
    the snapshot has no walltime or one that is not a SLURM time
    (`resolve_compute` reports that). Mirrored by `estimatedRunSeconds` in the
    frontend's lib/jobs/compute.ts."""
    try:
        recommended = recommended_walltime(snapshot, post_processing)
        if recommended is None:
            return None
        return _headroom_seconds(parse_slurm_time(recommended))
    except SubmitInputError:
        return None


def run_over_limit(snapshot: dict, post_processing: bool = False) -> int | None:
    """The estimated run time in seconds (`estimated_run_seconds`) when it is
    over `MAX_RUN_SECONDS`, else None: the draft is refused (`run_over_limit`).
    Mirrored by `submitProblems` in the frontend's lib/workspace/draft-state.ts."""
    seconds = estimated_run_seconds(snapshot, post_processing)
    return seconds if seconds is not None and seconds > MAX_RUN_SECONDS else None


def describe_hours(seconds: int) -> str:
    """"111 h 30 min", "4 h", "22 min 30 s": a duration for a person, in hours
    however long it is, the way the limit is written. Mirrored by
    `describeHours` in the frontend's lib/jobs/compute.ts."""
    h, rest = divmod(seconds, 3600)
    m, s = divmod(rest, 60)
    if h:
        return f"{h} h {m} min" if m else f"{h} h"
    if m:
        return f"{m} min {s} s" if s else f"{m} min"
    return f"{s} s"


# ---------------------------------------------------------------------------
# What the draft asks for, against what the snapshot already says
# ---------------------------------------------------------------------------


def snapshot_defaults(snapshot: dict) -> JobParameters:
    """The parameters a new snapshot draft starts with, read from a snapshot's
    `simulation` block: the temporal coverage and output variables it was run
    with. The one place these defaults are derived — the draft is created from
    it (`jobs._derive_simulation_parameters`) and the submit compares against
    it (`run_overrides`), so the two cannot drift."""
    simulation = snapshot.get("simulation", {})
    temporal = simulation.get("temporalCoverage", {})
    return JobParameters(
        temporal_range_start=str(temporal.get("start", "")),
        temporal_range_end=str(temporal.get("end", "")),
        variables=[v["name"] for v in simulation.get("outputVariables", [])],
    )


@dataclass(frozen=True)
class RunOverrides:
    """The `sim run` flags a draft needs. `None` means "the snapshot's own
    value": no flag is passed and the toolkit's init is untouched."""

    run_start: str | None = None
    run_end: str | None = None
    output_vars: str | None = None
    post_processing: str | None = None


def _post_processing_override(value: str | None, own: str | None) -> str | None:
    """The flag value for a draft's choice: none when the draft leaves it unset or
    asks for what the snapshot's init already has. `own` is None when the init
    could not be read, and then any set choice is passed (the toolkit, which reads
    the init, is the last line)."""
    if value is None or value == own:
        return None
    return _check_post_processing(value)


def run_overrides(
    parameters: JobParameters, snapshot: dict, own_post_processing: str | None = None
) -> RunOverrides:
    """The flags that turn the snapshot's init into the draft's simulation, in the
    toolkit's formats: dates as `YYYY-MM-DD`, output variables as one
    space-separated string (WBM's `Output_vars` is whitespace-separated).

    A value equal to the snapshot's own is not passed: a draft left at its
    defaults runs the published init, which is what makes its output
    comparable with the published one. `own_post_processing` is what the snapshot's
    init asks of post-processing (`run_start.InitRules.post_processing`), which
    needs a read of the init and so is the caller's to give. Raises `SubmitInputError` for a period
    that is not two real dates in order, or for no output variable at all.
    """
    defaults = snapshot_defaults(snapshot)
    start = _check_date("run start", parameters.temporal_range_start)
    end = _check_date("run end", parameters.temporal_range_end)
    if start > end:
        raise SubmitInputError("The run start must not be after the run end.")
    if not parameters.variables:
        raise SubmitInputError("Choose at least one output variable.")
    if not all(_VARIABLE_RE.match(n) for n in parameters.variables):
        raise SubmitInputError(
            "Output variables must be names made of letters, digits and underscores."
        )
    output_vars = " ".join(parameters.variables)
    return RunOverrides(
        run_start=start if start != defaults.temporal_range_start else None,
        run_end=end if end != defaults.temporal_range_end else None,
        output_vars=(
            output_vars if parameters.variables != defaults.variables else None
        ),
        post_processing=_post_processing_override(parameters.post_processing, own_post_processing),
    )


def unsupported_fields(
    parameters: JobParameters, model_input_id: str | None, snapshot: dict
) -> list[str]:
    """The fields of a draft the toolkit has no flag for yet (ADR 0025,
    open item 9): a model-input override, a spatial domain other than the
    snapshot's own, custom init parameters. A submit that names any of them is
    refused rather than run without them."""
    fields: list[str] = []
    if model_input_id:
        fields.append("model_input_id")
    if parameters.spatial_domain is not None and not _is_snapshot_domain(
        parameters.spatial_domain, snapshot
    ):
        fields.append("parameters.spatial_domain")
    if parameters.custom_params:
        fields.append("parameters.custom_params")
    return fields


def _is_snapshot_domain(domain, snapshot: dict) -> bool:
    coverage = snapshot.get("simulation", {}).get("spatialCoverage")
    if not coverage:
        return False
    pairs = (
        (domain.north, coverage.get("northlimit")),
        (domain.south, coverage.get("southlimit")),
        (domain.east, coverage.get("eastlimit")),
        (domain.west, coverage.get("westlimit")),
    )
    return all(
        isinstance(other, (int, float)) and math.isclose(ours, other, abs_tol=1e-9)
        for ours, other in pairs
    )
