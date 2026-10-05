"""``--spool cache`` — runs share spool files through a cache.

WBM reads ``<spool>/<network>/<ID>[_<patch>]/<name>.dat`` (with its ``.dat.hdr``)
when the file exists and otherwise builds it from the forcing and writes it. A
spool is therefore a cache of days already built, and what WBM may read from it
depends on the run: the image, the model code, the network file and the init's
settings, not its dates, names or outputs. That is the **variant**, and one cache
directory holds one::

    <spool_cache>/<model input id>/<network>/<variant>/<ID>[_<patch>]/<name>.dat[.hdr]

laid out inside as WBM lays out ``<spool>/<network>/``, plus the climate-bias
``<mod>_<obs>/NNN.dat`` and ``<LAI>_MinMax/NNN.dat`` directories.

A run with ``--spool cache`` (:func:`run_cached`, or ``openghm spool prepare`` /
``harvest`` around a SLURM job's exec):

1. :func:`prepare` evaluates the final init in the run's image (:func:`variant`),
   **fills** the variant directory from S3 ``spools/<model input id>/<network>/
   <variant>/`` with the days the run's period needs and the cache lacks, and
   **links** those days into the run's own ``<workdir>/spool/<network>/`` as
   symlinks to ``/wbm/spool/.cache/...``, where the variant directory is bound
   read-only. WBM tests ``-e``, which follows the link, and reads; it cannot write
   through it, so a day the cache holds is read and never rewritten.
2. WBM runs, building every day the cache lacked as a regular file in the run's own
   directory. Network-level files (``Cell_Table.dat``, the reservoir tifs,
   ``landCoverOneID.tif``) are per run and are never cached.
3. After WBM exits 0, :func:`harvest` moves each regular ``.dat``/``.dat.hdr`` pair
   under the run's dataset directories into the variant directory, ``.hdr`` first,
   by hard link and unlink so an existing file is never overwritten (two runs that
   built a day built the same bytes; the first one wins). There are no locks: a
   reader sees a day only once its ``.dat`` is there, and ``.hdr`` is moved before it.
   A run that exits non-zero harvests nothing: its last pair may be half written.

The S3 side is read anonymously with :mod:`openghm.fetch`'s listing and download
helpers; nothing is uploaded.
"""

from __future__ import annotations

import errno
import hashlib
import http.client
import json
import os
import posixpath
import re
import shutil
import stat
import subprocess
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

from . import assets, fetch
from .errors import OpenghmError
from .run import run_command, stage_files
from .runtime import RuntimeContext
from .sim import SIDECAR_NAME, _wbm_exec_argv, read_sidecar
from .types import SPOOL_CACHE_BIND, BuiltCommand, Mount, RunResult, SpoolPlan

#: Hex characters of the sha256 that name a variant.
VARIANT_LENGTH = 16

#: Init keys left out of the variant, by block (``""`` is the init's top level):
#: what only names or times the run, or what a spool file's content does not depend
#: on. Everything else in the init is part of the variant, so a different dataset, a
#: patch value or the projection gets its own directory (coarser than one variant per
#: dataset, and exact for what drafts change today: period and variables).
STRIPPED_KEYS: Dict[str, Tuple[str, ...]] = {
    "": (
        "ID",               # names the run
        "Comment",          # prose
        "Project",          # prose
        "Output_dir",       # where the run writes its output
        "Output_vars",      # which variables are written; spool files hold inputs
        "PostProcessing",   # aggregates the output after the run
        "spool_dir",        # where the spool is: the cache is it
    ),
    "MT_Code_Name": (
        "MT_ID",            # names the run's output
        "Output_dir",       # where the run writes its output
        "Run_Start",        # the period decides which days are read, not what they hold
        "Run_End",          # likewise
        "File_Size",        # how much one output file holds
        "spool_dir",        # where the spool is: the cache is it
    ),
}
#: ``Spinup``, ``Spinup_*`` and ``spinup_state_ID`` (any case) are left out of the variant
#: too: the spinup is a period, and the state it starts from does not change the inputs.
_SPINUP_KEY = re.compile(r"^spinup(_.*)?$", re.IGNORECASE)

#: ``YYYY-MM-DD.dat``: a daily, monthly (``-00`` day), yearly or climatology (year
#: ``0000``) spool file. ``NNN.dat`` (climate bias, ``_MinMax``) has no date.
_DATED_FILE = re.compile(r"^(\d{4})-\d{2}-\d{2}\.dat$")
#: ``_MinMax`` files WBM wants before it reuses a directory (``scale_MinMax``).
_MINMAX_FILES = 365
#: Parallel downloads of the fill.
FILL_JOBS = 8

#: Reads the init the way ``read_init`` does (``WBM.pm``: strip ``\r``, ``=> ,``, ``eval``)
#: and prints it as canonical JSON, every scalar a string. A string naming an existing
#: ``.init`` file becomes its path and sha256, so a file the init points at (the
#: snapshot's ``wbm_init/`` is not part of the code hashes) is part of the variant.
_EVAL_PERL = r"""
use Digest::SHA qw(sha256_hex);
my $file = shift @ARGV;
open(my $fh, '<', $file) or die "cannot open $file: $!\n";
my $str = do { local $/; <$fh> }; close $fh;
$str =~ s/\r//g;
$str =~ s/=>\s*,/=> '',/g;
my $att = eval $str;
die "cannot read the init $file: " . ($@ || "not a hash") . "\n" unless ref($att) eq 'HASH';
sub plain {
  my ($v) = @_;
  return undef unless defined $v;
  my $r = ref $v;
  if ($r eq 'HASH')  { my %h; $h{$_} = plain($v->{$_}) for keys %$v; return \%h; }
  if ($r eq 'ARRAY') { return [ map { plain($_) } @$v ]; }
  return "<$r>" if $r;
  my $s = "$v";
  if ($s =~ /\.init$/i && -f $s) {
    open(my $in, '<:raw', $s) or die "cannot open $s: $!\n";
    my $raw = do { local $/; <$in> }; close $in;
    return { init_file => $s, sha256 => sha256_hex($raw) };
  }
  return $s;
}
print JSON::PP->new->ascii->canonical->encode(plain($att)), "\n";
"""


@dataclass
class Variant:
    """A run's spool variant and what it was computed from."""

    id: str
    #: ``<cache_root>/<model input id>/<network>/<variant>``.
    dir: str
    #: The network file's name without its extension: WBM's spool subdirectory.
    network: str
    #: ``(first, last)`` year a run reads from the spool; ``None`` where the init does not say.
    years: Tuple[Optional[int], Optional[int]]
    #: What was hashed: the image digest, the code and network sha256, the stripped init.
    inputs: dict
    #: The init as evaluated, before anything is stripped.
    init: dict

    def to_dict(self) -> dict:
        return {"variant": self.id, "dir": self.dir, "network": self.network,
                "years": list(self.years), "inputs": self.inputs}


Evaluator = Callable[[SpoolPlan], dict]


# ── the variant ───────────────────────────────────────────────────────────────


def container_evaluator(plan: SpoolPlan, *, run=subprocess.run) -> dict:
    """The plan's final init as plain data, evaluated by ``perl`` inside the run's image.

    Under the run's own read-only binds, so a path the init names resolves as it will
    for WBM. ``run`` is ``subprocess.run`` (tests pass a fake).
    """
    ctx = RuntimeContext(runtime=plan.runtime, image=plan.image)
    mounts = [Mount(host, container, True) for host, container in plan.eval_mounts]
    argv = _wbm_exec_argv(
        ctx, mounts, ["perl", "-MJSON::PP", "-e", _EVAL_PERL, plan.init_container])
    proc = run(argv, capture_output=True, text=True)
    if proc.returncode:
        raise OpenghmError(
            f"cannot read the init {plan.init_container} in {plan.image} "
            f"(exit {proc.returncode}): {(proc.stderr or '').strip()[-500:]}"
        )
    try:
        return json.loads(proc.stdout)
    except ValueError as e:
        raise OpenghmError(f"the init evaluated to something that is not JSON: {e}")


def _strip(init: dict) -> dict:
    """``init`` without :data:`STRIPPED_KEYS` and the spinup keys."""
    out = {}
    for key, value in init.items():
        if key in STRIPPED_KEYS[""] or _SPINUP_KEY.match(key):
            continue
        if isinstance(value, dict) and key in STRIPPED_KEYS:
            value = {k: v for k, v in value.items() if k not in STRIPPED_KEYS[key]}
        out[key] = value
    return out


def _read_sums(path: str) -> Dict[str, str]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fetch.parse_sums(fh.read())
    except OSError as e:
        raise OpenghmError(f"cannot read {path}: {e}")


def _code_sha256(snapshot: str) -> str:
    """sha256 of the snapshot's ``SHA256SUMS`` lines under ``model/`` and ``utilities/``,
    sorted, each as ``<sha256>  <path>`` with no leading ``./``."""
    sums = _read_sums(os.path.join(snapshot, fetch.SUMS_NAME))
    lines = sorted(f"{sha}  {rel}" for rel, sha in sums.items()
                   if rel.split("/", 1)[0] in ("model", "utilities"))
    if not lines:
        raise OpenghmError(f"{snapshot}/{fetch.SUMS_NAME} has no line under model/ or utilities/")
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def network_name(network: str) -> str:
    """WBM's spool subdirectory for a network file: its name without the extension
    (``fileBaseName`` in ``WBM.pm``)."""
    return re.sub(r"\.\w+$", "", posixpath.basename(network))


def _network_sha256(plan: SpoolPlan, init: dict) -> Tuple[str, str]:
    """``(spool subdirectory, sha256)`` of the init's ``Network``: a file of the model
    input, which is bound at ``/wbm/data``, so its hash is in the model input's ``SHA256SUMS``."""
    network = init.get("Network")
    if not isinstance(network, str) or not network:
        raise OpenghmError("the init has no Network, so there is no spool to share")
    root = "/wbm/data/"
    if not network.startswith(root):
        raise OpenghmError(f"Network {network!r} is not a file of the model input (under {root})")
    rel = posixpath.normpath(network[len(root):])
    sums = _read_sums(os.path.join(plan.model_input_path, fetch.SUMS_NAME))
    if rel not in sums:
        raise OpenghmError(f"Network {network!r} has no line in {plan.model_input_path}/{fetch.SUMS_NAME}")
    return network_name(network), sums[rel]


def _year(value) -> Optional[int]:
    m = re.match(r"^(\d{4})-\d{2}-\d{2}", value) if isinstance(value, str) else None
    return int(m.group(1)) if m else None


def _years(init: dict) -> Tuple[Optional[int], Optional[int]]:
    """The years a run reads from the spool: from the first of its spinup and run starts
    to the year after its end (a run's last step can read the next year's first day).
    ``None`` where the init does not say: the first when it has no ``Run_Start`` (WBM then
    starts where the forcing does), the last when it has no ``Run_End``."""
    mt = init.get("MT_Code_Name") if isinstance(init.get("MT_Code_Name"), dict) else {}
    spinup = init.get("Spinup") if isinstance(init.get("Spinup"), dict) else {}
    run_start = _year(mt.get("Run_Start"))
    first = None
    if run_start is not None:
        first = min(y for y in (run_start, _year(spinup.get("Start"))) if y is not None)
    end = _year(mt.get("Run_End"))
    return first, (end + 1 if end is not None else None)


def variant(plan: SpoolPlan, *, evaluator: Optional[Evaluator] = None) -> Variant:
    """The plan's variant: the first :data:`VARIANT_LENGTH` hex characters of a sha256 over the
    canonical JSON (sorted keys, no whitespace) of

    * the image digest the snapshot pins (the file's sha256 for a ``--sif`` override);
    * the sha256 of the snapshot's ``SHA256SUMS`` lines under ``model/`` and ``utilities/``;
    * the network file's sha256, from the model input's ``SHA256SUMS``;
    * the run's final init, evaluated by ``evaluator`` (default: :func:`container_evaluator`)
      without :data:`STRIPPED_KEYS`.
    """
    init = (evaluator or container_evaluator)(plan)
    if not isinstance(init, dict):
        raise OpenghmError("the init did not evaluate to a hash")
    network, network_sha = _network_sha256(plan, init)
    image = plan.image_digest or "sha256:" + assets.sha256_file(plan.image)
    inputs = {"image": image, "code": _code_sha256(plan.snapshot), "network": network_sha,
              "init": _strip(init)}
    canonical = json.dumps(inputs, sort_keys=True, separators=(",", ":"))
    vid = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:VARIANT_LENGTH]
    return Variant(
        id=vid, dir=os.path.join(plan.cache_root, plan.model_input_id, network, vid),
        network=network, years=_years(init), inputs=inputs, init=init,
    )


# ── which files a run takes ───────────────────────────────────────────────────


def _wanted(rel: str, years: Tuple[Optional[int], Optional[int]]) -> bool:
    """Whether the ``.dat`` at ``rel`` (``<dir>/<name>.dat``) is read by a run over ``years``:
    a dated name inside them, a climatology (year 0000), or a name with no date."""
    if "/" not in rel:
        return False        # network level: per run, never cached
    m = _DATED_FILE.match(posixpath.basename(rel))
    if m is None or int(m.group(1)) == 0:
        return rel.endswith(".dat")
    first, last = years
    year = int(m.group(1))
    return (first is None or year >= first) and (last is None or year <= last)


def _tmp_dir(plan: SpoolPlan) -> str:
    return os.path.join(plan.cache_root, ".tmp", plan.sim_id)


def _move_in(src: str, dst: str, tmp: str) -> bool:
    """Move ``src`` to ``dst`` unless ``dst`` exists: ``os.link`` then ``unlink``, so a file is
    never overwritten and a reader never sees half of one. ``True`` if ``dst`` is new.

    Across filesystems (``EXDEV``) the bytes are first copied into ``tmp``, on the cache's own.
    """
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.link(src, dst)
    except FileExistsError:
        os.unlink(src)
        return False
    except OSError as e:
        if e.errno != errno.EXDEV:
            raise
        os.makedirs(tmp, exist_ok=True)
        part = os.path.join(tmp, f"{os.getpid()}.{os.path.basename(dst)}")
        shutil.copyfile(src, part)
        try:
            os.link(part, dst)
            new = True
        except FileExistsError:
            new = False
        finally:
            os.unlink(part)
        os.unlink(src)
        return new
    os.unlink(src)
    return True


# ── fill from S3 ──────────────────────────────────────────────────────────────


def _download(url: str, part: str, size: int) -> None:
    """``url`` into ``part``, its size checked against the listing; a transient error is retried."""
    os.makedirs(os.path.dirname(part), exist_ok=True)
    for attempt in range(1, fetch._ATTEMPTS + 1):
        try:
            got = 0
            with fetch._open(url) as resp, open(part, "wb") as fh:
                for chunk in iter(lambda: resp.read(fetch._CHUNK), b""):
                    fh.write(chunk)
                    got += len(chunk)
            if got != size:
                raise OpenghmError(f"size {got}, the listing says {size}")
            return
        except (OpenghmError, OSError, http.client.HTTPException) as e:
            try:
                os.remove(part)
            except OSError:
                pass
            if attempt == fetch._ATTEMPTS or not fetch._is_transient(e):
                raise
            time.sleep(fetch._BACKOFF * attempt)


def _fill_one(plan: SpoolPlan, vdir: str, prefix: str, rel: str, sizes: Dict[str, int]) -> bool:
    """One day (``rel`` is its ``.dat``): ``.hdr`` then ``.dat`` into the cache. ``True`` if the
    ``.dat`` is new there."""
    tmp = _tmp_dir(plan)
    new = False
    for name in (rel + ".hdr", rel):
        part = os.path.join(tmp, name)
        url = f"{plan.s3_base.rstrip('/')}/{urllib.parse.quote(prefix + name, safe='/')}"
        _download(url, part, sizes[name])
        new = _move_in(part, os.path.join(vdir, *name.split("/")), tmp)
    return new


def fill(plan: SpoolPlan, v: Variant) -> Dict[str, object]:
    """The days of ``spools/<model input id>/<network>/<variant>/`` that the run's years need and
    the cache lacks, into the variant directory. Returns ``{"downloaded": days, "failed": days,
    "error": str | None}``.

    Nothing on S3 under the prefix is not an error (a variant nobody has published), and neither is
    a bucket that cannot be reached: the run then builds what it lacks, as ``--spool fresh`` does.
    """
    prefix = f"spools/{plan.model_input_id}/{v.network}/{v.id}/"
    try:
        listing = fetch.list_objects(plan.s3_base.rstrip("/"), prefix)
    except OpenghmError as e:
        return {"downloaded": 0, "failed": 0, "error": str(e)}
    sizes = {key[len(prefix):]: size for key, size, _etag in listing}
    todo = sorted(
        rel for rel in sizes
        if rel.endswith(".dat") and fetch._safe_rel(rel) and rel + ".hdr" in sizes
        and _wanted(rel, v.years) and not os.path.exists(os.path.join(v.dir, *rel.split("/")))
    )
    downloaded, failed, error = 0, 0, None
    try:
        with ThreadPoolExecutor(max_workers=FILL_JOBS) as pool:
            futures = {pool.submit(_fill_one, plan, v.dir, prefix, rel, sizes): rel for rel in todo}
            for fut in as_completed(futures):
                try:
                    downloaded += bool(fut.result())
                except (OpenghmError, OSError, http.client.HTTPException) as e:
                    failed += 1
                    error = f"{futures[fut]}: {e}"
    finally:
        shutil.rmtree(_tmp_dir(plan), ignore_errors=True)
    return {"downloaded": downloaded, "failed": failed, "error": error}


# ── link ──────────────────────────────────────────────────────────────────────


def _pairs(directory: str) -> List[str]:
    """Names of the ``.dat`` files in ``directory`` whose ``.dat.hdr`` is there too."""
    names = set(os.listdir(directory))
    return sorted(n for n in names if n.endswith(".dat") and n + ".hdr" in names)


def link(plan: SpoolPlan, v: Variant) -> int:
    """Symlink the cached days the run's years need into ``<workdir>/spool/<network>/``, each
    pointing at ``/wbm/spool/.cache/<dir>/<name>``. Returns the days linked.

    A ``_MinMax`` directory is linked only when the cache holds all 365 of its files: WBM
    rebuilds it, writing every file, unless it finds exactly that many.
    """
    if not os.path.isdir(v.dir):
        return 0
    linked = 0
    for entry in sorted(os.scandir(v.dir), key=lambda e: e.name):
        if not entry.is_dir(follow_symlinks=False):
            continue
        names = [n for n in _pairs(entry.path) if _wanted(f"{entry.name}/{n}", v.years)]
        if entry.name.endswith("_MinMax") and len(names) != _MINMAX_FILES:
            continue
        here = os.path.join(plan.run_spool, v.network, entry.name)
        os.makedirs(here, exist_ok=True)
        for name in names:
            made = False
            for file in (name, name + ".hdr"):
                dst = os.path.join(here, file)
                if os.path.lexists(dst):
                    if not os.path.islink(dst):
                        continue        # a file an earlier attempt of this run built: its own
                    os.unlink(dst)
                os.symlink(f"{SPOOL_CACHE_BIND}/{entry.name}/{file}", dst)
                made = True
            linked += made
    return linked


# ── prepare and harvest ───────────────────────────────────────────────────────


def _update_sidecar(plan: SpoolPlan, top: Dict[str, object], spool: Dict[str, object]) -> None:
    """Merge ``top`` into the run's ``simulation.json`` and ``spool`` into its ``spool`` key."""
    path = os.path.join(plan.workdir, SIDECAR_NAME)
    if not os.path.isfile(path):
        return
    data = read_sidecar(path)
    data.update(top)
    data["spool"] = {**(data.get("spool") or {}), **spool}
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(data, indent=2) + "\n")


def _point(link_path: str, target: str) -> None:
    """Make the symlink ``link_path`` point at ``target``, replacing one that exists."""
    tmp = f"{link_path}.{os.getpid()}"
    try:
        os.unlink(tmp)
    except FileNotFoundError:
        pass
    os.symlink(target, tmp)
    os.replace(tmp, link_path)


def prepare(
    plan: SpoolPlan, *, evaluator: Optional[Evaluator] = None,
    log: Optional[Callable[[str], None]] = None,
) -> Dict[str, object]:
    """Before WBM: compute the variant, fill the cache from S3, link the cache into the run.

    Points ``<workdir>/spool-cache`` at the variant directory (the host side of the read-only
    bind), and records ``spool_variant``, ``spool_cache`` and ``spool`` (``downloaded``,
    ``linked``, ``failed``, ``fill_error``) in the run's ``simulation.json``.
    """
    say = log or (lambda _m: None)
    v = variant(plan, evaluator=evaluator)
    try:
        os.makedirs(v.dir, exist_ok=True)
        os.makedirs(os.path.join(plan.run_spool, os.path.basename(SPOOL_CACHE_BIND)), exist_ok=True)
        _point(plan.cache_link, v.dir)
    except OSError as e:
        raise OpenghmError(f"cannot set up the spool cache {v.dir}: {e}")
    say(f"spool: variant {v.id} in {v.dir}")
    filled = fill(plan, v)
    if filled["error"]:
        say(f"spool: S3 fill incomplete ({filled['failed']} days failed): {filled['error']}")
    try:
        linked = link(plan, v)
    except OSError as e:
        raise OpenghmError(f"cannot link the cached spool into {plan.run_spool}: {e}")
    record = {"downloaded": filled["downloaded"], "linked": linked,
              "failed": filled["failed"], "fill_error": filled["error"]}
    say(f"spool: downloaded {record['downloaded']} days, linked {linked}")
    _update_sidecar(plan, {"spool_variant": v.id, "spool_cache": v.dir}, record)
    return {**record, "variant": v.id, "dir": v.dir}


def harvest(plan: SpoolPlan, *, log: Optional[Callable[[str], None]] = None) -> Dict[str, int]:
    """After WBM exits 0: move the days it built into the variant directory.

    Walks ``<workdir>/spool/<network>/``, and for every regular ``<name>.dat`` with a regular
    ``<name>.dat.hdr`` inside a subdirectory (a dataset, ``<mod>_<obs>/`` or ``<LAI>_MinMax/``)
    moves the ``.hdr`` and then the ``.dat`` into the variant directory with :func:`_move_in`.
    Network-level files and symlinks are left alone. Returns ``{"harvested": days, "already_present":
    days the cache had by then}`` and records them in ``simulation.json``.
    """
    say = log or (lambda _m: None)
    vdir = os.path.realpath(plan.cache_link)
    if not os.path.isdir(plan.cache_link):
        raise OpenghmError(f"{plan.cache_link} is not there: `openghm spool prepare` has not run for this simulation")
    root = os.path.join(plan.run_spool, os.path.basename(os.path.dirname(vdir)))
    tmp = _tmp_dir(plan)
    harvested = present = 0
    try:
        dirs = sorted((e for e in os.scandir(root) if e.is_dir(follow_symlinks=False)
                       and not e.name.startswith(".")), key=lambda e: e.name)
    except FileNotFoundError:
        dirs = []
    for entry in dirs:
        for name in _pairs(entry.path):
            hdr_src, dat_src = (os.path.join(entry.path, name + ".hdr"), os.path.join(entry.path, name))
            if not all(stat.S_ISREG(os.lstat(p).st_mode) for p in (hdr_src, dat_src)):
                continue
            _move_in(hdr_src, os.path.join(vdir, entry.name, name + ".hdr"), tmp)
            if _move_in(dat_src, os.path.join(vdir, entry.name, name), tmp):
                harvested += 1
            else:
                present += 1
    shutil.rmtree(tmp, ignore_errors=True)
    counts = {"harvested": harvested, "already_present": present}
    say(f"spool: harvested {harvested} days, {present} already in the cache")
    _update_sidecar(plan, {}, counts)
    return counts


def run_cached(
    built: BuiltCommand, *, capture: bool = False, evaluator: Optional[Evaluator] = None,
    log: Optional[Callable[[str], None]] = None,
) -> RunResult:
    """Stage, :func:`prepare`, run ``built.argv``, and on exit 0 :func:`harvest`.

    A harvest that fails does not turn a finished run into a failed one: it is reported to
    ``log`` and recorded as ``spool.harvest_error``.
    """
    plan = built.spool
    if plan is None:
        raise OpenghmError("this command was not built with --spool cache")
    stage_files(built)
    prepare(plan, evaluator=evaluator, log=log)
    result = run_command(built, capture=capture, stage=False)
    if result.exit_code == 0:
        try:
            harvest(plan, log=log)
        except (OpenghmError, OSError) as e:
            if log:
                log(f"spool: harvest failed: {e}")
            _update_sidecar(plan, {}, {"harvest_error": str(e)})
    return result


def plan_from_sim_dir(sim_dir: str) -> SpoolPlan:
    """The :class:`SpoolPlan` a run recorded in ``<sim_dir>/simulation.json``."""
    path = os.path.join(sim_dir, SIDECAR_NAME)
    if not os.path.isfile(path):
        raise OpenghmError(f"no {SIDECAR_NAME} in {sim_dir}; is it a simulation directory?")
    raw = read_sidecar(path).get("spool_plan")
    if not isinstance(raw, dict):
        raise OpenghmError(f"{path} has no spool_plan: the simulation was not built with --spool cache")
    try:
        return SpoolPlan.from_dict(raw)
    except TypeError as e:
        raise OpenghmError(f"{path} has a bad spool_plan: {e}")
