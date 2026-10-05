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

**The cache has a cap.** Scratch allows a fixed number of files and the cache only grows, so
:func:`prepare` first runs :func:`prune`: when ``myquota`` says the scratch file quota is
``spool_prune_high`` used or more, it deletes whole **units** (one variant's year: every
dataset's ``YYYY-…`` files; or its ``clim`` unit: ``0000-…`` names and the undated climate-bias
and ``_MinMax`` files), least recently used first, until the projected use is at or below
``spool_prune_low``. Each variant directory keeps an index of its units
(``.units/<YYYY|clim>.json``: files, bytes, last use, whether S3 holds every file), which
:func:`prepare` and :func:`harvest` maintain so that pruning does not walk the cache. A run
holds the units it links through a **lease** (``<cache root>/.leases/<sim id>.json``) from
:func:`prepare` until :func:`harvest` or the end of its walltime, and pruning skips them.
Directories beginning with a dot (``.units``, ``.leases``, ``.tmp``) are never spool data.
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
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, Iterable, List, Optional, Set, Tuple

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

#: A variant directory's index of its units, and the cache root's leases (both begin with a
#: dot, so no walk of the cache takes them for spool data).
UNITS_DIR = ".units"
LEASES_DIR = ".leases"
#: The unit of the ``0000-…`` names and of every undated file.
CLIM_UNIT = "clim"
#: A spool file's unit is its year: a name beginning ``YYYY-`` (not ``0000``).
_YEAR_PREFIX = re.compile(r"^(\d{4})-")
#: A lease's length when the run's ``simulation.json`` records no walltime: Anvil's longest
#: job (4 days) and an hour.
LEASE_DEFAULT = timedelta(hours=96 + 1)
#: The command that prints the quotas (RCAC's), and how long it is given to answer.
MYQUOTA = "myquota"
MYQUOTA_TIMEOUT = 60
#: A count as ``myquota`` prints it: ``812``, ``59.6K``, ``1.0M``.
_QUOTA_COUNT = re.compile(r"^(\d+(?:\.\d+)?)([KMG]?)$", re.IGNORECASE)
_QUOTA_FACTOR = {"": 1, "K": 10**3, "M": 10**6, "G": 10**9}
#: A size as ``myquota`` prints it: ``812B``, ``91.9GB``, ``100.0TB`` (decimal: KB = 1e3 ... PB = 1e15).
_QUOTA_SIZE = re.compile(r"^(\d+(?:\.\d+)?)([KMGTP]?)B?$", re.IGNORECASE)
_SIZE_FACTOR = {"": 1, "K": 10**3, "M": 10**6, "G": 10**9, "T": 10**12, "P": 10**15}

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


def fill(plan: SpoolPlan, v: Variant, *, listing: Optional[Dict[str, int]] = None) -> Dict[str, object]:
    """The days of ``spools/<model input id>/<network>/<variant>/`` that the run's years need and
    the cache lacks, into the variant directory. Returns ``{"downloaded": days, "failed": days,
    "error": str | None}``. ``listing``, if given, is filled with every name the prefix lists
    (relative to it) and its size, and is left empty when the listing failed.

    Nothing on S3 under the prefix is not an error (a variant nobody has published), and neither is
    a bucket that cannot be reached: the run then builds what it lacks, as ``--spool fresh`` does.
    """
    prefix = f"spools/{plan.model_input_id}/{v.network}/{v.id}/"
    try:
        found = fetch.list_objects(plan.s3_base.rstrip("/"), prefix)
    except OpenghmError as e:
        return {"downloaded": 0, "failed": 0, "error": str(e)}
    sizes = {key[len(prefix):]: size for key, size, _etag in found}
    if listing is not None:
        listing.update(sizes)
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


def _subdirs(path: str) -> List["os.DirEntry[str]"]:
    """The directories in ``path`` that are not symlinks and do not begin with a dot (an index,
    a lease or a scratch directory is never spool data), by name; none where ``path`` is absent."""
    try:
        return sorted((e for e in os.scandir(path) if e.is_dir(follow_symlinks=False)
                       and not e.name.startswith(".")), key=lambda e: e.name)
    except FileNotFoundError:
        return []


Selection = List[Tuple[str, List[str]]]


def selection(v: Variant) -> Selection:
    """``(dataset directory, .dat names)`` of the cached days the run's years need.

    A ``_MinMax`` directory counts only when the cache holds all 365 of its files: WBM
    rebuilds it, writing every file, unless it finds exactly that many.
    """
    out: Selection = []
    for entry in _subdirs(v.dir):
        names = [n for n in _pairs(entry.path) if _wanted(f"{entry.name}/{n}", v.years)]
        if entry.name.endswith("_MinMax") and len(names) != _MINMAX_FILES:
            continue
        out.append((entry.name, names))
    return out


def link(plan: SpoolPlan, v: Variant, chosen: Optional[Selection] = None) -> int:
    """Symlink the cached days the run's years need into ``<workdir>/spool/<network>/``, each
    pointing at ``/wbm/spool/.cache/<dir>/<name>``. Returns the days linked.

    ``chosen`` is :func:`selection` of the variant (taken here if not given), which
    :func:`prepare` has already leased.
    """
    if not os.path.isdir(v.dir):
        return 0
    linked = 0
    for dirname, names in selection(v) if chosen is None else chosen:
        here = os.path.join(plan.run_spool, v.network, dirname)
        os.makedirs(here, exist_ok=True)
        for name in names:
            made = False
            for file in (name, name + ".hdr"):
                dst = os.path.join(here, file)
                if os.path.lexists(dst):
                    if not os.path.islink(dst):
                        continue        # a file an earlier attempt of this run built: its own
                    os.unlink(dst)
                os.symlink(f"{SPOOL_CACHE_BIND}/{dirname}/{file}", dst)
                made = True
            linked += made
    return linked


def drop_dangling(plan: SpoolPlan, v: Variant) -> int:
    """Remove the run's links whose target is no longer in the cache (a prune, a purge or an
    earlier attempt got there after :func:`selection`), so WBM builds those days in the run's own
    directory instead of failing to write through a read-only link. A day's ``.dat`` and
    ``.dat.hdr`` go together. Returns the days removed."""
    prefix = SPOOL_CACHE_BIND + "/"
    gone: Set[str] = set()
    for entry in _subdirs(os.path.join(plan.run_spool, v.network)):
        for f in os.scandir(entry.path):
            if not f.is_symlink():
                continue
            target = os.readlink(f.path)
            if target.startswith(prefix) and not os.path.exists(os.path.join(v.dir, *target[len(prefix):].split("/"))):
                gone.add(f.path[:-len(".hdr")] if f.path.endswith(".hdr") else f.path)
    for dat in gone:
        for path in (dat, dat + ".hdr"):
            if os.path.islink(path):
                os.unlink(path)
    return len(gone)


# ── units, leases and the cap ─────────────────────────────────────────────────


def _utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_utc(text: object) -> Optional[datetime]:
    try:
        return datetime.strptime(str(text), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _write_json(path: str, data: object) -> None:
    """``data`` as JSON at ``path``, all at once: a reader finds the old file or the new one."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(data, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, path)


def _read_json(path: str) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def unit_of(name: str) -> str:
    """The unit of the spool file ``name``: its year (``2000`` for ``2000-06-15.dat``), or
    :data:`CLIM_UNIT` for a ``0000-…`` name and one with no date (``001.dat``)."""
    m = _YEAR_PREFIX.match(name)
    return m.group(1) if m and int(m.group(1)) else CLIM_UNIT


def _scan(vdir: str, units: Optional[Iterable[str]] = None) -> Dict[str, List[Tuple[str, int, float]]]:
    """``{unit: [(path relative to vdir, bytes, mtime)]}`` of the ``.dat`` and ``.dat.hdr`` files
    under ``vdir``, all units or only ``units`` (only those files are ``stat``-ed)."""
    want = None if units is None else set(units)
    out: Dict[str, List[Tuple[str, int, float]]] = {}
    for entry in _subdirs(vdir):
        for f in os.scandir(entry.path):
            if not (f.name.endswith(".dat") or f.name.endswith(".dat.hdr")):
                continue
            unit = unit_of(f.name)
            if want is not None and unit not in want:
                continue
            try:
                st = f.stat(follow_symlinks=False)
            except FileNotFoundError:
                continue
            if stat.S_ISREG(st.st_mode):
                out.setdefault(unit, []).append((f"{entry.name}/{f.name}", st.st_size, st.st_mtime))
    return out


def _index_path(vdir: str, unit: str) -> str:
    return os.path.join(vdir, UNITS_DIR, f"{unit}.json")


def _read_index(vdir: str, unit: str) -> Optional[dict]:
    """The unit's index, or ``None`` where it is absent or not one."""
    rec = _read_json(_index_path(vdir, unit))
    if rec is None or not isinstance(rec.get("files"), int) or not isinstance(rec.get("bytes"), int) \
            or _parse_utc(rec.get("last_used")) is None or not isinstance(rec.get("on_s3"), bool):
        return None
    return rec


def refresh_index(
    vdir: str, units: Iterable[str], now: datetime, *, used: Iterable[str] = (),
    listing: Optional[Dict[str, int]] = None, built: bool = False,
) -> None:
    """Recount ``units`` of the variant directory ``vdir`` into their index files.

    A unit in ``used`` (or one with no index yet) gets ``last_used = now``. ``on_s3`` is true when
    ``listing`` (name → size under the variant's S3 prefix) holds every file of the unit; without
    a listing it stays as it was, and ``built`` (files only a run built were added) makes it false.
    A unit with no files left has no index.
    """
    units, used = set(units), set(used)
    found = _scan(vdir, units) if units else {}
    for unit in sorted(units):
        files = found.get(unit)
        if not files:
            try:
                os.unlink(_index_path(vdir, unit))
            except FileNotFoundError:
                pass
            continue
        old = _read_index(vdir, unit)
        on_s3 = (False if built else all(rel in listing for rel, _b, _m in files) if listing is not None
                 else bool(old and old["on_s3"]))
        _write_json(_index_path(vdir, unit), {
            "files": len(files), "bytes": sum(b for _r, b, _m in files), "on_s3": on_s3,
            "last_used": _utc(now) if unit in used or old is None else old["last_used"],
        })


def _walltime(text: object) -> Optional[timedelta]:
    """A SLURM time (``--time``): ``M``, ``M:S``, ``H:M:S``, ``D-H``, ``D-H:M`` or ``D-H:M:S``."""
    m = re.fullmatch(r"(?:(\d+)-)?(\d+)(?::(\d+))?(?::(\d+))?", str(text or "").strip())
    if m is None:
        return None
    days, a, b, c = m.groups()
    nums = [int(x) for x in (a, b, c) if x is not None]
    if days is not None:
        hours, minutes, seconds = (nums + [0, 0])[:3]
    elif len(nums) == 3:
        hours, minutes, seconds = nums
    else:
        hours, minutes, seconds = 0, nums[0], (nums[1] if len(nums) > 1 else 0)
    return timedelta(days=int(days or 0), hours=hours, minutes=minutes, seconds=seconds)


def _lease_path(cache_root: str, sim_id: str) -> str:
    return os.path.join(cache_root, LEASES_DIR, f"{sim_id}.json")


def write_lease(plan: SpoolPlan, v: Variant, units: Iterable[str], now: datetime) -> None:
    """Record that this run holds ``units`` of ``v``, until the end of its walltime (what
    ``simulation.json`` records; :data:`LEASE_DEFAULT` where it records none). A run that fails
    harvests nothing and so removes nothing: its lease just expires."""
    side = os.path.join(plan.workdir, SIDECAR_NAME)
    walltime = None
    if os.path.isfile(side):
        walltime = _walltime(read_sidecar(side).get("walltime"))
    _write_json(_lease_path(plan.cache_root, plan.sim_id), {
        "variant_dir": v.dir, "units": sorted(set(units)), "expires": _utc(now + (walltime or LEASE_DEFAULT)),
    })


def _lease_records(cache_root: str) -> List[Tuple[str, str, dict, datetime]]:
    """``[(lease file, sim id, record, expiry)]`` of the readable leases under ``cache_root``, by
    name. A file that is not a lease is left out."""
    out: List[Tuple[str, str, dict, datetime]] = []
    directory = os.path.join(cache_root, LEASES_DIR)
    try:
        names = sorted(os.listdir(directory))
    except FileNotFoundError:
        return out
    for name in names:
        path = os.path.join(directory, name)
        rec = _read_json(path) if name.endswith(".json") else None
        until = _parse_utc(rec.get("expires")) if rec else None
        if until is None or not isinstance(rec.get("variant_dir"), str) or not isinstance(rec.get("units"), list):
            continue
        out.append((path, name[:-len(".json")], rec, until))
    return out


def _leases(cache_root: str, now: datetime) -> Tuple[Set[Tuple[str, str]], List[str]]:
    """``({(variant dir, unit)}, [expired lease files])``: what unexpired leases hold, and the
    leases that have run out. A file that is not a lease is left alone and holds nothing."""
    held: Set[Tuple[str, str]] = set()
    expired: List[str] = []
    for path, _sim, rec, until in _lease_records(cache_root):
        if until <= now:
            expired.append(path)
        else:
            held.update((os.path.realpath(rec["variant_dir"]), str(u)) for u in rec["units"])
    return held, expired


def release_lease(plan: SpoolPlan) -> None:
    try:
        os.unlink(_lease_path(plan.cache_root, plan.sim_id))
    except FileNotFoundError:
        pass


# the cap


def _scratch_row(text: str) -> Optional[Tuple[List[str], Optional[List[str]]]]:
    """``(columns of the scratch row, columns of the header line before it or None)``."""
    header: Optional[List[str]] = None
    for line in text.splitlines():
        cols = line.split()
        if not cols:
            continue
        if cols[0].lower() == "type" and "Files" in cols:
            header = cols
        elif cols[0] == "scratch":
            return cols, header
    return None


def _quota_columns(header: Optional[List[str]]) -> Dict[str, Optional[int]]:
    """The scratch row's ``Size``, size ``Limit``, ``Files`` and file ``Limit`` columns as indexes
    from the right (``None`` where the header has no ``Size``). Without a header the row's last
    columns are taken to be ``Size Limit Use Files Limit Use``."""
    if header is None:
        return {"size": -6, "size_limit": -5, "files": -3, "files_limit": -2}
    n = len(header)
    files = header.index("Files") - n
    size = header.index("Size") - n if "Size" in header else None
    after = lambda i: next((j - n for j, c in enumerate(header) if c == "Limit" and j - n > i), None)
    return {"size": size, "size_limit": None if size is None else after(size),
            "files": files, "files_limit": after(files)}


def parse_myquota(text: str) -> Tuple[int, int]:
    """``(files used, file limit)`` of the ``scratch`` row of ``myquota``'s output.

    The columns are found from the header line (``… Files Limit Use``) counting from the right,
    so a location or size that holds spaces does not shift them; without a header the row's last
    three columns are taken to be those. A count is ``812``, ``59.6K``, ``1.0M`` (K, M, G are
    powers of 1000). Raises :class:`OpenghmError` where there is no such row or it does not read.
    """
    row = _scratch_row(text)
    if row is not None:
        cols, header = row
        at = _quota_columns(header)
        try:
            used, cap = (_quota_count(cols[at[k]]) for k in ("files", "files_limit"))
        except (IndexError, TypeError, ValueError):
            used = cap = 0
        if cap > 0:
            return used, cap
    raise OpenghmError("cannot read the scratch file quota from myquota's output")


def _quota_count(text: str) -> int:
    m = _QUOTA_COUNT.match(text)
    if m is None:
        raise ValueError(text)
    return round(float(m.group(1)) * _QUOTA_FACTOR[m.group(2).upper()])


def _quota_bytes(text: str) -> int:
    """A size as ``myquota`` prints it (``91.9GB``, ``100.0TB``, ``0B``) in bytes: decimal units,
    B, KB, MB, GB, TB, PB."""
    m = _QUOTA_SIZE.match(text)
    if m is None:
        raise ValueError(text)
    return round(float(m.group(1)) * _SIZE_FACTOR[m.group(2).upper()])


def parse_scratch_quota(text: str) -> Dict[str, int]:
    """``{files_used, files_limit, bytes_used, bytes_limit}`` of the ``scratch`` row of
    ``myquota``'s output: the files as :func:`parse_myquota` reads them, the bytes from the row's
    ``Size`` and ``Limit`` columns. Raises :class:`OpenghmError` where either does not read."""
    files_used, files_limit = parse_myquota(text)
    cols, header = _scratch_row(text)         # parse_myquota found it
    at = _quota_columns(header)
    try:
        bytes_used, bytes_limit = (_quota_bytes(cols[at[k]]) for k in ("size", "size_limit"))
    except (IndexError, TypeError, ValueError):
        bytes_limit = 0
    if bytes_limit <= 0:
        raise OpenghmError("cannot read the scratch size quota from myquota's output")
    return {"files_used": files_used, "files_limit": files_limit,
            "bytes_used": bytes_used, "bytes_limit": bytes_limit}


def _myquota(run) -> str:
    try:
        proc = run([MYQUOTA], capture_output=True, text=True, timeout=MYQUOTA_TIMEOUT)
    except FileNotFoundError:
        raise OpenghmError(f"{MYQUOTA} is not on this machine")
    except (OSError, subprocess.SubprocessError) as e:
        raise OpenghmError(f"{MYQUOTA} failed: {e}")
    if proc.returncode:
        raise OpenghmError(f"{MYQUOTA} exited {proc.returncode}: {(proc.stderr or '').strip()[-200:]}")
    return proc.stdout or ""


def read_quota(*, run=subprocess.run) -> Tuple[int, int]:
    """``(files used, file limit)`` of the scratch quota, from ``myquota`` (``run`` is
    ``subprocess.run``; tests pass a fake). Raises :class:`OpenghmError` without one."""
    return parse_myquota(_myquota(run))


def read_scratch_quota(*, run=subprocess.run) -> Dict[str, int]:
    """``{files_used, files_limit, bytes_used, bytes_limit}`` of the scratch quota, from
    ``myquota`` (see :func:`parse_scratch_quota`). Raises :class:`OpenghmError` without one."""
    return parse_scratch_quota(_myquota(run))


@dataclass
class _Unit:
    """One unit of one variant, as its index says."""

    variant_dir: str
    unit: str
    files: int
    bytes: int
    last_used: str
    on_s3: bool

    @property
    def order(self) -> Tuple[str, int, str]:
        """Oldest day of last use first; within a day, a unit S3 holds before one only this cache does."""
        return self.last_used[:10], 0 if self.on_s3 else 1, self.last_used

    def to_dict(self) -> dict:
        return {"variant_dir": self.variant_dir, "unit": self.unit, "files": self.files,
                "bytes": self.bytes, "last_used": self.last_used, "on_s3": self.on_s3}


def _unit_names(vdir: str) -> Set[str]:
    """The units that have a spool file under ``vdir``, from the names alone (no ``stat``)."""
    return {unit_of(f.name) for entry in _subdirs(vdir) for f in os.scandir(entry.path)
            if f.name.endswith(".dat") or f.name.endswith(".dat.hdr")}


def _variant_units(vdir: str, *, write: bool) -> List[_Unit]:
    """The units of one variant directory, by its index. The file names are listed (not
    ``stat``-ed) to find what is there: a unit with no index, or one that cannot be read, is
    counted now (``last_used`` = its newest file's mtime, ``on_s3`` false) and, if ``write``,
    indexed; an index of a unit with no files left (a purge got there) is dropped."""
    present = _unit_names(vdir)
    out: Dict[str, _Unit] = {}
    for unit in sorted(present):
        rec = _read_index(vdir, unit)
        if rec is not None:
            out[unit] = _Unit(vdir, unit, rec["files"], rec["bytes"], rec["last_used"], rec["on_s3"])
    for unit, files in _scan(vdir, present - set(out)).items():
        newest = _utc(datetime.fromtimestamp(max(m for _r, _b, m in files), timezone.utc))
        out[unit] = _Unit(vdir, unit, len(files), sum(b for _r, b, _m in files), newest, False)
        if write:
            _write_json(_index_path(vdir, unit), {"files": len(files), "bytes": out[unit].bytes,
                                                  "last_used": newest, "on_s3": False})
    if write:
        try:
            gone = [n[:-len(".json")] for n in os.listdir(os.path.join(vdir, UNITS_DIR))
                    if n.endswith(".json") and n[:-len(".json")] not in present]
        except FileNotFoundError:
            gone = []
        for unit in gone:
            os.unlink(_index_path(vdir, unit))
    return list(out.values())


def _candidates(cache_root: str, *, write: bool) -> List[_Unit]:
    """Every unit of every variant under ``<cache root>/<model input>/<network>/<variant>/``."""
    out: List[_Unit] = []
    for mi in _subdirs(cache_root):
        for net in _subdirs(mi.path):
            for var in _subdirs(net.path):
                out.extend(_variant_units(var.path, write=write))
    return out


def _delete_unit(vdir: str, unit: str) -> Tuple[int, int]:
    """Delete one unit: its index file first (a unit with no index is not counted as present),
    then its ``.dat`` files, then its ``.hdr`` files, so a reader never finds a ``.dat`` without
    its header. Returns ``(files, bytes)`` deleted."""
    try:
        os.unlink(_index_path(vdir, unit))
    except FileNotFoundError:
        pass
    files = sorted(_scan(vdir, [unit]).get(unit, []), key=lambda f: (f[0].endswith(".hdr"), f[0]))
    count = size = 0
    for rel, nbytes, _m in files:
        try:
            os.unlink(os.path.join(vdir, *rel.split("/")))
        except FileNotFoundError:
            continue
        count += 1
        size += nbytes
    return count, size


def prune(
    cache_root: str, *, high: float, low: float, dry_run: bool = False,
    log: Optional[Callable[[str], None]] = None, run=subprocess.run, now: Optional[datetime] = None,
    everything: bool = False,
) -> Dict[str, object]:
    """Keep the scratch file quota under ``high`` by deleting the least recently used units of the
    spool cache under ``cache_root``, down to ``low``.

    Reads the scratch row of ``myquota`` (:func:`read_quota`; ``run`` is ``subprocess.run``). Below
    ``high`` of the limit, or with no readable quota, nothing is deleted. Otherwise units are
    taken in the order of :attr:`_Unit.order`, skipping every unit an unexpired lease holds
    (re-read before each deletion, to narrow the race with a ``prepare`` that starts meanwhile;
    expired leases are removed), until the files deleted reach ``used - low * limit``. With
    ``dry_run`` nothing is deleted or written and the plan is the same.

    Returns ``{"dry_run", "high", "low", "used", "limit", "after", "reason", "deleted": [{variant_dir,
    unit, files, bytes, last_used, on_s3}], "deleted_files", "deleted_bytes", "skipped_leased",
    "expired_leases"}``: ``reason`` says why nothing was done (``None`` where something was) and
    ``after`` is the file count it leaves (projected, with ``dry_run``).

    With ``everything`` the thresholds and the target are ignored: every unit no unexpired lease
    holds is deleted, in the same order and with the same re-reading of the leases. The quota is
    still read, for the report, but a cache with no readable ``myquota`` is cleared all the same
    (``used``, ``limit`` and ``after`` are ``None`` then). ``skipped_leased`` counts every unit a
    lease holds, and the result has ``"all": true``.
    """
    say = log or (lambda _m: None)
    if not everything and not 0 <= low < high <= 1:
        raise OpenghmError(f"the spool prune thresholds must satisfy 0 <= low < high <= 1 (got low {low}, high {high})")
    now = now or datetime.now(timezone.utc)
    result: Dict[str, object] = {
        "dry_run": dry_run, "high": high, "low": low, "used": None, "limit": None, "after": None,
        "reason": None, "deleted": [], "deleted_files": 0, "deleted_bytes": 0,
        "skipped_leased": 0, "expired_leases": 0,
    }
    used = limit = None
    try:
        used, limit = read_quota(run=run)
    except OpenghmError as e:
        if not everything:
            result["reason"] = f"no pruning: {e}"
            return _said(result, say)
    result.update(used=used, limit=limit, after=used)
    if everything:
        result["all"] = True
        target = None
    elif used < high * limit:
        result["reason"] = f"below {high:.0%} of the quota: nothing to delete"
        return _said(result, say)
    else:
        target = used - low * limit
    held, expired = _leases(cache_root, now)
    result["expired_leases"] = len(expired)
    if not dry_run:
        for path in expired:
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
    candidates = _candidates(cache_root, write=not dry_run)
    units = sorted((u for u in candidates if (os.path.realpath(u.variant_dir), u.unit) not in held),
                   key=lambda u: u.order)
    deleted: List[dict] = []
    files = nbytes = 0
    skipped = len(candidates) - len(units) if everything else 0
    for u in units:
        if target is not None and files >= target:
            break
        if (os.path.realpath(u.variant_dir), u.unit) in _leases(cache_root, now)[0]:
            skipped += 1
            continue
        if dry_run:
            n, b = u.files, u.bytes
        else:
            n, b = _delete_unit(u.variant_dir, u.unit)
        files += n
        nbytes += b
        deleted.append({**u.to_dict(), "files": n, "bytes": b})
    result.update(deleted=deleted, deleted_files=files, deleted_bytes=nbytes,
                  after=None if used is None else used - files, skipped_leased=skipped)
    if everything:
        if not deleted:
            result["reason"] = "no unit to delete: the cache is empty or every unit is leased"
    elif files < target:
        result["reason"] = "no more units to delete: the cache is not what holds the quota"
    return _said(result, say)


def _said(result: Dict[str, object], say: Callable[[str], None]) -> Dict[str, object]:
    for line in describe_prune(result):
        say(line)
    return result


def describe_prune(result: Dict[str, object]) -> List[str]:
    """``prune``'s result as the lines ``spool prune`` and ``spool prepare`` print."""
    verb = "would delete" if result["dry_run"] else "deleted"
    if result.get("all"):
        return _describe_prune_all(result, verb)
    if result["used"] is None:
        return [f"spool: {result['reason']}"]
    head = f"spool: scratch files {result['used']:,} of {result['limit']:,} ({result['used'] / result['limit']:.1%})"
    if not result["deleted"]:
        return [f"{head}; {result['reason'] or 'nothing to delete'}"]
    lines = [f"{head}, at or above {result['high']:.0%}: {verb} {len(result['deleted'])} units, "
             f"{result['deleted_files']:,} files, {result['deleted_bytes'] / 1e9:.1f} GB"]
    lines += [f"spool:   {d['variant_dir']} {d['unit']}: {d['files']:,} files, {d['bytes'] / 1e9:.2f} GB, "
              f"last used {d['last_used']}, {'on S3' if d['on_s3'] else 'only here'}" for d in result["deleted"]]
    lines.append(f"spool: scratch files {'would be' if result['dry_run'] else 'now'} {result['after']:,} "
                 f"({result['after'] / result['limit']:.1%}), target {result['low']:.0%}"
                 + (f"; {result['reason']}" if result["reason"] else ""))
    return lines


def _describe_prune_all(result: Dict[str, object], verb: str) -> List[str]:
    what = "all units no running simulation holds"
    head = f"spool: {what}"
    if result["used"] is not None:
        head = (f"spool: scratch files {result['used']:,} of {result['limit']:,} "
                f"({result['used'] / result['limit']:.1%}), {what}")
    leased = f"; {result['skipped_leased']} held by leases, kept" if result["skipped_leased"] else ""
    if not result["deleted"]:
        return [f"{head}: {result['reason']}{leased}"]
    lines = [f"{head}: {verb} {len(result['deleted'])} units, {result['deleted_files']:,} files, "
             f"{result['deleted_bytes'] / 1e9:.1f} GB{leased}"]
    lines += [f"spool:   {d['variant_dir']} {d['unit']}: {d['files']:,} files, {d['bytes'] / 1e9:.2f} GB, "
              f"last used {d['last_used']}, {'on S3' if d['on_s3'] else 'only here'}" for d in result["deleted"]]
    if result["after"] is not None:
        lines.append(f"spool: scratch files {'would be' if result['dry_run'] else 'now'} {result['after']:,} "
                     f"({result['after'] / result['limit']:.1%})")
    return lines


# ── status ────────────────────────────────────────────────────────────────────


def status(
    cache_root: str, *, high: float, low: float, run=subprocess.run, now: Optional[datetime] = None,
) -> Dict[str, object]:
    """What the scratch quota and the spool cache under ``cache_root`` hold now; deletes and
    writes nothing.

    Units are read as :func:`prune` reads them (:func:`_variant_units` without writing: the
    indexes, and file names and one ``stat`` per file for a unit with none). Returns
    ``{"quota": {files_used, files_limit, bytes_used, bytes_limit} | None, "quota_error", "high",
    "low", "cache_root", "variants": [{model_input_id, network, variant, dir, units, files, bytes,
    last_used, on_s3_units, leased_units}], "leases": [{sim_id, variant_dir, units, expires}],
    "totals": {units, files, bytes}}``: ``variants`` (those with a unit) newest ``last_used``
    first, ``leases`` the unexpired ones, by sim id.
    """
    now = now or datetime.now(timezone.utc)
    quota: Optional[Dict[str, int]] = None
    quota_error: Optional[str] = None
    try:
        quota = read_scratch_quota(run=run)
    except OpenghmError as e:
        quota_error = str(e)
    held, _expired = _leases(cache_root, now)
    variants: List[dict] = []
    for mi in _subdirs(cache_root):
        for net in _subdirs(mi.path):
            for var in _subdirs(net.path):
                units = _variant_units(var.path, write=False)
                if not units:
                    continue
                real = os.path.realpath(var.path)
                variants.append({
                    "model_input_id": mi.name, "network": net.name, "variant": var.name, "dir": var.path,
                    "units": len(units), "files": sum(u.files for u in units), "bytes": sum(u.bytes for u in units),
                    "last_used": max(u.last_used for u in units),
                    "on_s3_units": sum(u.on_s3 for u in units),
                    "leased_units": sum((real, u.unit) in held for u in units),
                })
    variants.sort(key=lambda v: v["last_used"], reverse=True)
    leases = [{"sim_id": sim, "variant_dir": rec["variant_dir"], "units": [str(u) for u in rec["units"]],
               "expires": str(rec["expires"])}
              for _path, sim, rec, until in _lease_records(cache_root) if until > now]
    return {
        "quota": quota, "quota_error": quota_error, "high": high, "low": low, "cache_root": cache_root,
        "variants": variants, "leases": leases,
        "totals": {"units": sum(v["units"] for v in variants), "files": sum(v["files"] for v in variants),
                   "bytes": sum(v["bytes"] for v in variants)},
    }


def describe_status(result: Dict[str, object]) -> List[str]:
    """``status``'s result as the lines ``spool status`` prints."""
    q, t = result["quota"], result["totals"]
    lines = []
    if q:
        lines.append(f"scratch  files {q['files_used']:,} of {q['files_limit']:,} ({q['files_used'] / q['files_limit']:.1%}); "
                     f"size {q['bytes_used'] / 1e9:,.1f} GB of {q['bytes_limit'] / 1e9:,.0f} GB "
                     f"({q['bytes_used'] / q['bytes_limit']:.1%})")
    else:
        lines.append(f"scratch  no quota: {result['quota_error']}")
    lines.append(f"cache    {result['cache_root']}: {t['units']:,} units, {t['files']:,} files, {t['bytes'] / 1e9:,.2f} GB; "
                 f"pruned at {result['high']:.0%} of the file quota, down to {result['low']:.0%}")
    if result["variants"]:
        rows = [("MODEL INPUT", "NETWORK", "VARIANT", "UNITS", "FILES", "GB", "LAST USED", "ON S3", "LEASED")]
        rows += [(v["model_input_id"], v["network"], v["variant"], str(v["units"]), f"{v['files']:,}",
                  f"{v['bytes'] / 1e9:,.2f}", v["last_used"] or "-", str(v["on_s3_units"]), str(v["leased_units"]))
                 for v in result["variants"]]
        widths = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
        right = {3, 4, 5, 7, 8}
        lines += ["  ".join(c.rjust(w) if i in right else c.ljust(w) for i, (c, w) in enumerate(zip(r, widths))).rstrip()
                  for r in rows]
    for lease in result["leases"]:
        lines.append(f"lease    {lease['sim_id']}: {len(lease['units'])} units of {lease['variant_dir']}, until {lease['expires']}")
    return lines


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
    """Before WBM: prune the cache, compute the variant, fill the cache from S3, lease and link it
    into the run.

    :func:`prune` goes first, by the plan's thresholds; a prune that fails is logged and never
    fails the run. The lease on the units about to be linked is written before the links are, and
    a link whose target is gone by then is removed (:func:`drop_dangling`). Points
    ``<workdir>/spool-cache`` at the variant directory (the host side of the read-only bind), and
    records ``spool_variant``, ``spool_cache`` and ``spool`` (``downloaded``, ``linked``,
    ``failed``, ``fill_error``, ``dangling``, ``prune``) in the run's ``simulation.json``.
    """
    say = log or (lambda _m: None)
    now = datetime.now(timezone.utc)
    try:
        pruned = prune(plan.cache_root, high=plan.prune_high, low=plan.prune_low, log=say)
    except Exception as e:      # the cap is housekeeping: whatever goes wrong, the run goes on
        say(f"spool: prune failed: {e}")
        pruned = {"error": str(e)}
    v = variant(plan, evaluator=evaluator)
    try:
        os.makedirs(v.dir, exist_ok=True)
        os.makedirs(os.path.join(plan.run_spool, os.path.basename(SPOOL_CACHE_BIND)), exist_ok=True)
        _point(plan.cache_link, v.dir)
    except OSError as e:
        raise OpenghmError(f"cannot set up the spool cache {v.dir}: {e}")
    say(f"spool: variant {v.id} in {v.dir}")
    # Lease the run's years before the fill, so another run's prune leaves alone what this
    # one is downloading; the lease is narrowed to what is linked below.
    first, last = v.years
    if first is not None and last is not None:
        wanted = {str(y) for y in range(first, last + 1)} | {CLIM_UNIT}
    else:
        wanted = {unit_of(n) for _d, names in selection(v) for n in names} | {CLIM_UNIT}
    try:
        write_lease(plan, v, wanted, now)
    except OSError as e:
        raise OpenghmError(f"cannot lease the cached spool {v.dir}: {e}")
    listing: Dict[str, int] = {}
    filled = fill(plan, v, listing=listing)
    if filled["error"]:
        say(f"spool: S3 fill incomplete ({filled['failed']} days failed): {filled['error']}")
    try:
        chosen = selection(v)
        units = {unit_of(n) for _d, names in chosen for n in names}
        write_lease(plan, v, units, now)
        linked = link(plan, v, chosen)
        dangling = drop_dangling(plan, v)
    except OSError as e:
        raise OpenghmError(f"cannot lease and link the cached spool into {plan.run_spool}: {e}")
    if dangling:
        say(f"spool: {dangling} linked days were gone from the cache; the run builds them")
    try:
        # the units the fill may have added to, besides the ones linked
        listed = {unit_of(posixpath.basename(rel)) for rel in listing if _wanted(rel, v.years)}
        refresh_index(v.dir, units | listed, now, used=units,
                      listing=listing if listing or not filled["error"] else None)
    except OSError as e:
        say(f"spool: cannot update the unit index of {v.dir}: {e}")
    record = {"downloaded": filled["downloaded"], "linked": linked, "failed": filled["failed"],
              "fill_error": filled["error"], "dangling": dangling, "prune": pruned}
    say(f"spool: downloaded {record['downloaded']} days, linked {linked}")
    _update_sidecar(plan, {"spool_variant": v.id, "spool_cache": v.dir}, record)
    return {**record, "variant": v.id, "dir": v.dir}


def harvest(plan: SpoolPlan, *, log: Optional[Callable[[str], None]] = None) -> Dict[str, int]:
    """After WBM exits 0: move the days it built into the variant directory.

    Walks ``<workdir>/spool/<network>/``, and for every regular ``<name>.dat`` with a regular
    ``<name>.dat.hdr`` inside a subdirectory (a dataset, ``<mod>_<obs>/`` or ``<LAI>_MinMax/``)
    moves the ``.hdr`` and then the ``.dat`` into the variant directory with :func:`_move_in`.
    Network-level files and symlinks are left alone. Returns ``{"harvested": days, "already_present":
    days the cache had by then}`` and records them in ``simulation.json``. The units it added
    to are recounted in the variant's index, and the run's lease is released.
    """
    say = log or (lambda _m: None)
    vdir = os.path.realpath(plan.cache_link)
    if not os.path.isdir(plan.cache_link):
        raise OpenghmError(f"{plan.cache_link} is not there: `openghm spool prepare` has not run for this simulation")
    root = os.path.join(plan.run_spool, os.path.basename(os.path.dirname(vdir)))
    tmp = _tmp_dir(plan)
    harvested = present = 0
    added: Set[str] = set()
    for entry in _subdirs(root):
        for name in _pairs(entry.path):
            hdr_src, dat_src = (os.path.join(entry.path, name + ".hdr"), os.path.join(entry.path, name))
            if not all(stat.S_ISREG(os.lstat(p).st_mode) for p in (hdr_src, dat_src)):
                continue
            _move_in(hdr_src, os.path.join(vdir, entry.name, name + ".hdr"), tmp)
            if _move_in(dat_src, os.path.join(vdir, entry.name, name), tmp):
                harvested += 1
                added.add(unit_of(name))
            else:
                present += 1
    shutil.rmtree(tmp, ignore_errors=True)
    try:
        refresh_index(vdir, added, datetime.now(timezone.utc), built=True)
    except OSError as e:
        say(f"spool: cannot update the unit index of {vdir}: {e}")
    release_lease(plan)
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
