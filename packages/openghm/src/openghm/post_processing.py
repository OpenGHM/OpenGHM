"""WBM post-processing — ``PostProcessing => { Run => 1, … }`` in an init.

With ``Run`` true, WBM writes ``PostProcessing.pl`` into the run's output directory and
starts it **detached** (``wbm.pl`` ~line 4269: ``system("perl -w … > PostProcessing.log &")``).
Inside a container that does not survive: ``singularity exec`` returns as soon as ``wbm.pl``
exits, the image is unmounted under the script, every ``temporal_aggregation.pl`` call fails
with "Transport endpoint is not connected", and nothing says so (Anvil job 21163850: an empty
``climatology/``, ``outcome.json`` ``ok: true``). So the toolkit takes the step over:

1. a run whose init asks for post-processing is staged with ``Run => 0`` (WBM still writes
   the script, and does not launch it);
2. after WBM exits 0 :func:`finish` runs ``PostProcessing.pl`` in the foreground, in the same
   container and mounts as WBM, its output in ``PostProcessing.log`` beside it;
3. :func:`check` decides whether it worked. The script ignores the exit status of each of its
   ``system()`` calls and prints "All Done!" even when every one fails, so the files it was
   asked to write must exist too;
4. the requested ``Run`` value is put back in the run's ``wbm_init/<init>`` and in WBM's own
   dump ``wbm_output/<id>/init_files/<init>``, whatever happened, so that what is published
   and what a rerun reads say what was asked for;
5. the result is recorded as ``post_processing`` in ``simulation.json``.

The init is edited as text, inside the ``PostProcessing`` block only: ``Run`` keys elsewhere
(``Run_Start``, ``Run_End``) are never read or changed. This module is a leaf: it reads and
writes ``simulation.json`` itself, because :mod:`openghm.sim` imports it.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from typing import Callable, Dict, Iterator, List, Optional, Tuple

from .errors import OpenghmError

SCRIPT_NAME = "PostProcessing.pl"
LOG_NAME = "PostProcessing.log"
#: How many trailing lines of the log are kept in the record.
TAIL_LINES = 40
#: The climatology file suffixes (``<name>_dc.nc``: daily, monthly and yearly climatology).
_CLIMATOLOGY_SUFFIXES = ("_dc", "_mc", "_yc")

#: ``runner(argv, log_path) -> exit code``: runs the script with stdout and stderr in the log.
Runner = Callable[[List[str], str], int]


# ── reading and editing the init ───────────────────────────────────────────────

_BLOCK_RE = re.compile(r"""(?<!\w)(?:(['"])PostProcessing\1|PostProcessing)\s*=>\s*\{""")
_RUN_KEY_RE = re.compile(r"""(?:(['"])Run\1|(?<![\w$@%])Run(?!\w))\s*=>\s*""")
# A Perl scalar: quoted, or bare up to the next ``,``, ``}``, ``#`` or end of line (possibly empty,
# as in ``Polygon_Aggregation => ,``).
_VALUE_RE = re.compile(r"""'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[^,}\n#]*""")


def _walk(text: str, start: int) -> Iterator[Tuple[int, int]]:
    """``(index, depth)`` of each character of ``text`` from ``start`` that is code, not the inside
    of a quoted string or a ``#`` comment. The depth is the count of braces opened and not yet
    closed since ``start``; the ``}`` that closes the block ``start`` is in comes with depth ``-1``,
    and ends the walk. A string's opening quote is yielded (a quoted key starts there)."""
    depth, quote, i, n = 0, None, start, len(text)
    while i < n:
        c = text[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c == "#":
            j = text.find("\n", i)
            i = n if j == -1 else j
            continue
        elif c in "'\"":
            quote = c
            yield i, depth
        elif c == "{":
            yield i, depth
            depth += 1
        elif c == "}":
            depth -= 1
            yield i, depth
            if depth < 0:
                return
        else:
            yield i, depth
        i += 1


def _post_processing_block(text: str) -> Optional[Tuple[int, int]]:
    """``(start, end)`` of what is between the braces of the ``PostProcessing => { … }`` block, or
    ``None`` when the init has none (or its braces do not balance)."""
    for m in _BLOCK_RE.finditer(text):
        line_start = text.rfind("\n", 0, m.start()) + 1
        if text[line_start:m.start()].lstrip().startswith("#"):
            continue
        for i, depth in _walk(text, m.end()):
            if depth < 0:
                return m.end(), i
        return None
    return None


def _run_value_span(text: str) -> Optional[Tuple[int, int]]:
    """``(start, end)`` of the value of the block's own ``Run`` key (not one in a nested hash, and
    not ``Run_Start``), or ``None``. An empty value (``Run => ,``) is an empty span."""
    block = _post_processing_block(text)
    if block is None:
        return None
    start, end = block
    for i, depth in _walk(text, start):
        if i >= end:
            break
        if depth != 0:
            continue
        key = _RUN_KEY_RE.match(text, i)
        if key is None:
            continue
        value = _VALUE_RE.match(text, key.end())
        raw = value.group(0)
        return key.end(), key.end() + len(raw.rstrip())
    return None


def requested_run_value(init_text: str) -> Optional[str]:
    """The literal ``Run`` has inside the init's ``PostProcessing`` block, as written
    (``1``, ``'0'``, ``''``), or ``None`` when there is no block or the block has no ``Run``."""
    span = _run_value_span(init_text)
    return None if span is None else init_text[span[0]:span[1]].strip()


def is_true(literal: str) -> bool:
    """Perl's truth of a ``Run`` literal: false for ``0``, ``'0'``, ``''``, ``""``, nothing and
    ``undef``; true for anything else."""
    s = literal.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"":
        return s[1:-1] not in ("", "0")
    if s in ("", "undef"):
        return False
    try:
        return float(s) != 0
    except ValueError:
        return True


def set_run_value(init_text: str, literal: str) -> str:
    """``init_text`` with the block's ``Run`` value replaced by ``literal``; the key, its
    whitespace, the comma and everything else stay as they were. Unchanged when the init has no
    ``PostProcessing`` block or no ``Run`` in it."""
    span = _run_value_span(init_text)
    if span is None:
        return init_text
    return init_text[:span[0]] + literal + init_text[span[1]:]


# ── reading the generated script ───────────────────────────────────────────────

_PARAM_RE = re.compile(r"my\s+@param\s*=\s*qw\s*\(([^)]*)\)")
_DEPTH_RE = re.compile(r"""\$TA_depth\s*=\s*['"](\w+)['"]""")


def expected_outputs(script_text: str) -> Optional[dict]:
    """What a run of this generated ``PostProcessing.pl`` must have written, or ``None`` when the
    script's variable list or flags cannot be read.

    * ``variables``: the names in its ``@param`` list;
    * ``suffixes``: the climatology files each variable gets, when ``$temporal_agg`` and
      ``$climatology`` are both 1: ``_dc`` unless ``$monthly``, ``_mc`` unless ``$TA_depth`` is
      ``day``, ``_yc`` unless it is ``day`` or ``month`` (the ``next`` lines of the script);
    * ``climatology``: variables times suffixes, the file count ``climatology/`` must hold;
    * ``spatial_agg``: ``$spatial_agg`` is 1, so ``spatial_agg/`` must not be empty.

    The file names are the variables' ``Code_Name`` from the run's ``.MT.csv``, not the ``@param``
    names (``WMB_test_runoff`` writes ``wbm_runoff_dc.nc``), so the files are counted, not named.
    """
    params = _PARAM_RE.search(script_text)
    depth = _DEPTH_RE.search(script_text)
    flags = {}
    for name in ("temporal_agg", "climatology", "monthly", "spatial_agg"):
        m = re.search(rf"\${name}\s*=\s*(\d+)", script_text)
        if m is None:
            return None
        flags[name] = int(m.group(1))
    if params is None or depth is None:
        return None
    variables = params.group(1).split()
    ta_depth = depth.group(1)
    suffixes: List[str] = []
    if flags["temporal_agg"] and flags["climatology"]:
        if not flags["monthly"]:
            suffixes.append("_dc")
        if ta_depth != "day":
            suffixes.append("_mc")
        if ta_depth not in ("day", "month"):
            suffixes.append("_yc")
    return {
        "variables": len(variables),
        "suffixes": suffixes,
        "climatology": len(variables) * len(suffixes),
        "spatial_agg": bool(flags["spatial_agg"]),
    }


# ── checking the run ───────────────────────────────────────────────────────────

_ALL_DONE_RE = re.compile(r"^\s*All Done!\s*$", re.MULTILINE)
_CANT_EXEC_RE = re.compile(r"Can't exec")


def _files(directory: str) -> List[str]:
    try:
        return sorted(n for n in os.listdir(directory) if os.path.isfile(os.path.join(directory, n)))
    except OSError:
        return []


def check(output_dir: str, log_text: str, exit_code: Optional[int], expected: Optional[dict]) -> dict:
    """The verdict on a finished ``PostProcessing.pl``: ``all_done``, ``expected``, ``found``,
    ``cant_exec``, ``problems`` (what is wrong, in words) and ``ok``.

    ``ok`` needs exit code 0, "All Done!" in the log, no ``Can't exec`` line, and the files of
    ``expected`` (see :func:`expected_outputs`): per climatology suffix at least one file per
    variable in ``climatology/`` (a multi-year run adds renamed ``_yc`` files, which count only
    toward the ``_yc`` total), and a ``spatial_agg/`` that is not empty when it was asked for.
    """
    problems: List[str] = []
    all_done = bool(_ALL_DONE_RE.search(log_text))
    cant_exec = len(_CANT_EXEC_RE.findall(log_text))
    if exit_code != 0:
        problems.append(f"{SCRIPT_NAME} exited with code {exit_code}")
    if not all_done:
        problems.append(f"{LOG_NAME} does not end in 'All Done!': the script did not finish")
    if cant_exec:
        problems.append(f"{cant_exec} 'Can't exec' line(s) in {LOG_NAME}: a tool it calls is missing or not executable")
    found: Optional[dict] = None
    expected_record: Optional[dict] = None
    if expected is None:
        problems.append(f"cannot read the variable list and flags from {SCRIPT_NAME}")
    else:
        expected_record = {"climatology": expected["climatology"], "spatial_agg": expected["spatial_agg"]}
        clim = _files(os.path.join(output_dir, "climatology"))
        per_suffix = {s: sum(1 for n in clim if n.endswith(f"{s}.nc")) for s in expected["suffixes"]}
        spatial = len(_files(os.path.join(output_dir, "spatial_agg")))
        found = {
            "climatology": sum(min(n, expected["variables"]) for n in per_suffix.values()),
            "spatial_agg": spatial,
        }
        if found["climatology"] < expected["climatology"]:
            by = ", ".join(f"{s} {n} of {expected['variables']}" for s, n in per_suffix.items())
            problems.append(
                f"climatology/ holds {found['climatology']} of the {expected['climatology']} files "
                f"it should ({by})"
            )
        if expected["spatial_agg"] and not spatial:
            problems.append("spatial_agg/ is empty")
    return {
        "all_done": all_done,
        "expected": expected_record,
        "found": found,
        "cant_exec": cant_exec,
        "problems": problems,
        "ok": not problems,
    }


# ── running it ─────────────────────────────────────────────────────────────────


def _run_logged(argv: List[str], log_path: str) -> int:
    """Run ``argv`` in the foreground with stdout and stderr in ``log_path``; its exit code
    (127 when the runtime itself cannot be started, the reason being the log's only line)."""
    with open(log_path, "w", encoding="utf-8") as log:
        try:
            return subprocess.run(argv, stdout=log, stderr=subprocess.STDOUT).returncode
        except OSError as e:
            log.write(f"cannot start {argv[0]}: {e}\n")
            return 127


def _tail(path: str, n: int = TAIL_LINES) -> List[str]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read().splitlines()[-n:]
    except OSError:
        return []


def run_post_processing(argv: List[str], output_dir: str, *, runner: Optional[Runner] = None) -> dict:
    """Run the script WBM wrote into ``output_dir`` with ``argv`` (the container exec the run
    recorded) and check it. Returns the fields of the ``post_processing`` record the run adds
    to ``requested``/``run_value``/``argv``: ``exit_code``, ``seconds``, ``log`` (the host path),
    ``tail`` and what :func:`check` returns.

    A run that left no ``PostProcessing.pl`` is not run and has ``exit_code`` ``None``.
    """
    script = os.path.join(output_dir, SCRIPT_NAME)
    log_path = os.path.join(output_dir, LOG_NAME)
    if not os.path.isfile(script):
        return {
            "exit_code": None, "all_done": False, "expected": None, "found": None, "cant_exec": 0,
            "seconds": 0, "log": log_path, "tail": [],
            "problems": [f"WBM wrote no {SCRIPT_NAME} in the output directory"], "ok": False,
        }
    with open(script, "r", encoding="utf-8", errors="replace") as fh:
        expected = expected_outputs(fh.read())
    started = time.monotonic()
    code = (runner or _run_logged)(argv, log_path)
    seconds = int(round(time.monotonic() - started))
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as fh:
            log_text = fh.read()
    except OSError:
        log_text = ""
    return {
        "exit_code": code, "seconds": seconds, "log": log_path,
        "tail": log_text.splitlines()[-TAIL_LINES:], **check(output_dir, log_text, code, expected),
    }


# ── putting the init back ──────────────────────────────────────────────────────


def restore(workdir: str, sim_id: str, init_filename: str, literal: str) -> List[str]:
    """Write ``literal`` back as the ``Run`` value of the run's init: ``<workdir>/wbm_init/<init>``
    and WBM's own dump ``<workdir>/wbm_output/<sim id>/init_files/<init>``. A file that does not
    exist is skipped. Returns the paths it rewrote."""
    rewritten: List[str] = []
    for path in (
        os.path.join(workdir, "wbm_init", init_filename),
        os.path.join(workdir, "wbm_output", sim_id, "init_files", init_filename),
    ):
        if not os.path.isfile(path):
            continue
        with open(path, "r", encoding="utf-8", newline="") as fh:
            text = fh.read()
        new = set_run_value(text, literal)
        if new != text:
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(new)
            rewritten.append(path)
    return rewritten


# ── the step, from what the sidecar recorded ───────────────────────────────────


def _read_sidecar(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as e:
        raise OpenghmError(f"cannot read {path}: {e}")


def finish(
    sidecar: str, wbm_exit_code: int, *, runner: Optional[Runner] = None,
    log: Optional[Callable[[str], None]] = None,
) -> Optional[dict]:
    """After WBM: run and check post-processing, put the init back, record the result.

    ``sidecar`` is the run's ``simulation.json``; its ``post_processing`` (written when the run was
    staged: ``requested``, ``run_value``, ``argv``) says whether there is anything to do, what to
    run and what to restore. Returns ``None`` when the run did not ask for post-processing.

    The step runs only when ``wbm_exit_code`` is 0; otherwise the record has ``exit_code`` and ``ok``
    ``None``. The init is put back either way, and a restore that fails is reported to ``log`` and
    does not change the record. The record replaces ``post_processing`` in the sidecar.
    """
    say = log or (lambda _m: None)
    data = _read_sidecar(sidecar)
    record = data.get("post_processing")
    if not isinstance(record, dict) or not record.get("requested"):
        return None
    workdir = os.path.dirname(os.path.abspath(sidecar))
    sim_id, init = str(data["simulation_id"]), str(data["init"])
    output_dir = os.path.join(workdir, "wbm_output", sim_id)
    try:
        if wbm_exit_code == 0:
            result = run_post_processing(record["argv"], output_dir, runner=runner)
        else:
            result = {
                "exit_code": None, "all_done": None, "expected": None, "found": None,
                "cant_exec": None, "seconds": None, "log": os.path.join(output_dir, LOG_NAME),
                "tail": [], "problems": [], "ok": None,
            }
    finally:
        try:
            restore(workdir, sim_id, init, record["run_value"])
        except OSError as e:
            say(f"openghm: warning: could not put the Run value back in the init: {e}")
    result["log"] = os.path.relpath(result["log"], workdir)
    record = {**record, **result}
    data["post_processing"] = record
    with open(sidecar, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(data, indent=2) + "\n")
    return record
