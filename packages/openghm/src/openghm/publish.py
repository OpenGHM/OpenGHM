"""``openghm snapshot publish`` — publish a finished run's work directory as a snapshot.

The run is the per-simulation directory ``sim submit`` / ``sim run`` leaves under
``output_base`` (``simulation.json``, ``wbm_init/``, ``wbm_output/<sim id>/``,
``WBM_run_state/``). ``simulation.json`` names the base snapshot the run was made
from. The new tree at ``snapshots/<id>/`` is (ADR 0031):

- everything of the base's except ``metadata.json``, ``SHA256SUMS`` and the
  directories in :data:`COPY_EXCLUDED`, **copied server-side** from
  ``snapshots/<base id>/``: the same bytes with the same ``x-amz-meta-*`` and so the
  same file modes (ADR 0022), nothing rebuilt;
- the run's ``wbm_init/``, ``wbm_output/<sim id>/`` and ``WBM_run_state/``, uploaded
  public-read from scratch, each with its file mode and its sha256 as
  ``x-amz-meta-sha256``;
- a new ``SHA256SUMS`` by the recipe in ``docs/reference/snapshot-layout.md``: the
  base's own line for a copied file, a hash for an uploaded one, ``wbm_output/``
  left out;
- a new ``metadata.json``, written last.

Three phases. **Plan** reads the run and, anonymously over HTTPS, the base's
``metadata.json``, ``SHA256SUMS`` and listing, and turns them into one
:class:`Action` per key. **Check** has no side effects: ``metadata.json`` passes the
metadata spec (once its ``id`` is set) and agrees with the run, its ``uses.modelCode.treeHash``
is the tree hash of the code the publish would copy (ADR 0032; computed from the base's
``SHA256SUMS``, which is how the copied bytes are known), the output holds what the init asked
for, and the staged tree passes the layout spec. **Apply** goes
through :class:`S3Client`, whose real backend runs ``s3cmd``. It reads each key first:
absent, it writes it; present with the same bytes, it skips it; present with other
bytes, it stops. A retry with the same id therefore continues where the last attempt
stopped, and no published object is ever replaced. ``metadata.json`` goes last, so a
``snapshots/<id>/`` without one is an unfinished publish. Last, **verify** re-reads
``SHA256SUMS`` and HEADs every key anonymously.

"Same bytes" for a key that is already there: equal size, and then for an upload an
equal ``x-amz-meta-sha256`` (or, on an object without one, an ETag that equals the
local MD5), and for a copy an ETag equal to its source's.

Exit codes (``openghm snapshot publish``; one per kind of failure):

====  ===========================================================================
0     done (or, with ``--dry-run``, a plan that would go through)
2     bad input: an unreadable run, base or ``metadata.json``; ``metadata.json``
      fails the spec or disagrees with the run, including a ``uses.modelCode.treeHash``
      that is not the tree hash of the code to be copied; a bad ``--id``
3     output incomplete: the run did not succeed, the output lacks a year or a
      variable the init asked for or holds an empty file, or the tree fails the layout
4     a key already holds other bytes (nothing is replaced)
5     no credentials: ``--s3cfg`` missing or unreadable, or no ``s3cmd``
6     an ``s3cmd`` call failed (read, copy or upload)
7     verification failed: a key is missing, not public-read, or the wrong size
====  ===========================================================================

Stdlib only; Python 3.9 (Anvil).
"""

from __future__ import annotations

import hashlib
import http.client
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from . import assets, fetch, sim, spec
from . import code as wbm_code
from .errors import OpenghmError

# ── exit codes ────────────────────────────────────────────────────────────────

EXIT_OK = 0
EXIT_BAD_INPUT = 2
EXIT_OUTPUT_INCOMPLETE = 3
EXIT_OTHER_BYTES = 4
EXIT_NO_CREDENTIALS = 5
EXIT_UPLOAD_FAILED = 6
EXIT_VERIFY_FAILED = 7

#: Top-level directories of the base that are not copied: the ones the run replaces
#: (``wbm_init/``, ``wbm_output/``, ``WBM_run_state/``), a spool, and the input a
#: snapshot no longer carries (``fetch.EXCLUDED_DIRS``).
COPY_EXCLUDED = fetch.EXCLUDED_DIRS + ("wbm_init",)

METADATA_NAME = fetch.METADATA_NAME
SUMS_NAME = fetch.SUMS_NAME

_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
#: How many problems a message lists before summarising the rest.
_MAX_LISTED = 20


class PublishError(OpenghmError):
    """A publish that stops. ``code`` is the exit code of its kind (see the module docstring)."""

    def __init__(self, message: str, code: int = EXIT_BAD_INPUT):
        super().__init__(message)
        self.code = code


class S3Error(OpenghmError):
    """An S3 call that did not do what was asked (``s3cmd`` exited non-zero, or answered nonsense)."""


def _echo(line: str) -> None:
    print(line, flush=True)


def _problems(items: List[str]) -> str:
    lines = [f"  {p}" for p in items[:_MAX_LISTED]]
    if len(items) > _MAX_LISTED:
        lines.append(f"  ... and {len(items) - _MAX_LISTED} more")
    return "\n".join(lines)


# ── objects and the two clients ───────────────────────────────────────────────


@dataclass
class ObjectInfo:
    """What a HEAD of one key says."""

    size: int
    #: Unquoted. The ETag from a HEAD; from ``s3cmd info`` it is the "MD5 sum" line.
    etag: str = ""
    #: ``x-amz-meta-<name>`` -> value, names lower-cased (``sha256``, ``s3cmd-attrs``).
    meta: Dict[str, str] = field(default_factory=dict)

    @property
    def mode(self) -> Optional[int]:
        """The permission bits in ``x-amz-meta-s3cmd-attrs`` (ADR 0022), or ``None``."""
        m = fetch._MODE_RE.search(self.meta.get("s3cmd-attrs", ""))
        return int(m.group(1)) & 0o777 if m else None


class S3Client:
    """The three things a publish does to the bucket, with credentials. The real backend
    is :class:`S3CmdClient`; tests use an in-memory one."""

    def head(self, key: str) -> Optional[ObjectInfo]:
        """The key's info, or ``None`` when it is absent. Raises :class:`S3Error` otherwise."""
        raise NotImplementedError

    def copy(self, src: str, dst: str) -> None:
        """Server-side copy, public-read, keeping ``x-amz-meta-*``."""
        raise NotImplementedError

    def put(self, path: str, key: str, sha256: str) -> None:
        """Upload ``path`` public-read with its file mode and ``x-amz-meta-sha256``."""
        raise NotImplementedError


class S3CmdClient(S3Client):
    """:class:`S3Client` over the ``s3cmd`` executable. The exit code of every call is checked.

    ``runner`` is ``subprocess.run``'s signature, so a test can see the argv it is given.
    The credentials file is only ever named on the command line (``-c``), never read here.
    """

    #: ``s3cmd``'s exit code for a 404 (``EX_NOTFOUND``).
    NOT_FOUND = 12

    def __init__(self, s3cmd: str, s3cfg: str, bucket: str, runner=subprocess.run):
        self.s3cmd, self.s3cfg, self.bucket, self._runner = s3cmd, s3cfg, bucket, runner

    def _uri(self, key: str) -> str:
        return f"s3://{self.bucket}/{key}"

    def _run(self, *args: str):
        argv = [self.s3cmd, "-c", self.s3cfg, *args]
        try:
            return self._runner(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                universal_newlines=True, errors="replace")
        except OSError as e:
            raise S3Error(f"cannot run {self.s3cmd}: {e}")

    @staticmethod
    def _failure(verb: str, proc) -> S3Error:
        tail = " | ".join((proc.stderr or proc.stdout or "").strip().splitlines()[-3:])
        return S3Error(f"s3cmd {verb} failed (exit {proc.returncode}): {tail}")

    def head(self, key: str) -> Optional[ObjectInfo]:
        proc = self._run("info", self._uri(key))
        if proc.returncode != 0:
            err = (proc.stderr or "") + (proc.stdout or "")
            if proc.returncode == self.NOT_FOUND or re.search(r"\b404\b|NoSuchKey|Not Found", err):
                return None
            raise self._failure("info", proc)
        text = proc.stdout or ""
        size = re.search(r"^\s*File size:\s*(\d+)", text, re.MULTILINE)
        if not size:
            raise S3Error(f"unexpected output of `s3cmd info` for {key}: no 'File size' line")
        md5 = re.search(r"^\s*MD5 sum:\s*(\S+)", text, re.MULTILINE)
        meta = {m.group(1).lower(): m.group(2).strip()
                for m in re.finditer(r"^\s*x-amz-meta-([^:\s]+):[ \t]*(.*)$", text, re.MULTILINE | re.IGNORECASE)}
        return ObjectInfo(size=int(size.group(1)), etag=md5.group(1).strip('"') if md5 else "", meta=meta)

    def copy(self, src: str, dst: str) -> None:
        proc = self._run("cp", "--acl-public", self._uri(src), self._uri(dst))
        if proc.returncode != 0:
            raise self._failure("cp", proc)

    def put(self, path: str, key: str, sha256: str) -> None:
        # S3 does not guess a content type from the extension (s3-layout.md), so say it.
        mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
        proc = self._run("put", "--acl-public", "--preserve", "--no-progress", f"--mime-type={mime}",
                         f"--add-header=x-amz-meta-sha256:{sha256}", path, self._uri(key))
        if proc.returncode != 0:
            raise self._failure("put", proc)


class Anon:
    """Anonymous HTTPS reads of the public bucket: no credentials, no S3 client."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def url(self, key: str) -> str:
        return f"{self.base_url}/{urllib.parse.quote(key, safe='/')}"

    def _call(self, method: str, key: str):
        """``(status, headers, body)``; a transient failure is tried again like ``fetch``'s."""
        url = self.url(key)
        for attempt in range(1, fetch._ATTEMPTS + 1):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, method=method),  # noqa: S310
                                            timeout=fetch._TIMEOUT) as resp:
                    return resp.status, resp.headers, (resp.read() if method == "GET" else b"")
            except urllib.error.HTTPError as e:
                status, headers = e.code, e.headers
                e.close()
                if status < 500 or attempt == fetch._ATTEMPTS:
                    return status, headers, b""
            except (urllib.error.URLError, socket.timeout, ConnectionError, http.client.HTTPException) as e:
                if attempt == fetch._ATTEMPTS:
                    raise OpenghmError(f"cannot reach {url}: {getattr(e, 'reason', e)}")
            time.sleep(fetch._BACKOFF * attempt)
        raise AssertionError("unreachable")  # pragma: no cover

    def get(self, key: str) -> bytes:
        status, _headers, body = self._call("GET", key)
        if status != 200:
            raise OpenghmError(f"{self.url(key)}: HTTP {status}")
        return body

    def head(self, key: str) -> Optional[ObjectInfo]:
        """The key's info; ``None`` for a 404 or a 403 (absent, or not public-read)."""
        status, headers, _ = self._call("HEAD", key)
        if status in (403, 404):
            return None
        if status != 200:
            raise OpenghmError(f"{self.url(key)}: HTTP {status}")
        meta = {k.lower()[len("x-amz-meta-"):]: v for k, v in headers.items() if k.lower().startswith("x-amz-meta-")}
        return ObjectInfo(size=int(headers.get("Content-Length", "0")),
                          etag=(headers.get("ETag") or "").strip('"'), meta=meta)


def check_credentials(s3cfg: str, s3cmd: str) -> Tuple[str, str]:
    """``(s3cmd path, s3cfg path)``, or a :class:`PublishError` (exit 5) when either is missing.

    Only the existence and readability of the credentials file are checked; it is never read.
    """
    cfg = os.path.expanduser(s3cfg)
    if not (os.path.isfile(cfg) and os.access(cfg, os.R_OK)):
        raise PublishError(f"no credentials: {cfg} does not exist or is not readable "
                           "(pass --s3cfg, or create ~/.s3cfg)", EXIT_NO_CREDENTIALS)
    exe = shutil.which(s3cmd)
    if not exe:
        raise PublishError(f"cannot write to the bucket: {s3cmd!r} is not on PATH (pass --s3cmd)",
                           EXIT_NO_CREDENTIALS)
    return exe, cfg


def make_client(s3cmd: str, s3cfg: str, bucket: str) -> S3Client:
    """The real client. A seam, so the CLI's tests can put a fake in its place."""
    return S3CmdClient(s3cmd, s3cfg, bucket)


def bucket_of(base_url: str) -> str:
    """The bucket name: the last path segment of ``base_url`` (``…/openghm``)."""
    name = urllib.parse.urlsplit(base_url).path.strip("/").rsplit("/", 1)[-1]
    if not name:
        raise OpenghmError(f"--base-url {base_url!r} does not end in the bucket's name")
    return name


# ── the run and the base ──────────────────────────────────────────────────────


@dataclass
class Run:
    path: str
    sim_id: str
    base_id: str
    init: str
    model_input: str
    exit_code: Optional[int]


@dataclass
class Base:
    id: str
    meta: dict
    #: ``{rel: sha256}`` from its ``SHA256SUMS``.
    sums: Dict[str, str]
    #: ``{rel: (size, etag)}`` from its listing.
    listing: Dict[str, Tuple[int, str]]


def read_run(run_dir: str) -> Run:
    """The run's ``simulation.json``, with the fields a publish needs."""
    path = os.path.abspath(run_dir)
    if not os.path.isdir(path):
        raise PublishError(f"run directory not found: {path}")
    try:
        rec = sim.read_sidecar(os.path.join(path, sim.SIDECAR_NAME))
    except OpenghmError as e:
        raise PublishError(f"{e} (is this a run directory?)")
    if not isinstance(rec, dict):
        raise PublishError(f"{sim.SIDECAR_NAME} in {path} is not a JSON object")
    missing = [k for k in ("simulation_id", "snapshot", "init", "model_input") if not rec.get(k)]
    if missing:
        raise PublishError(f"{sim.SIDECAR_NAME} in {path} has no {', '.join(missing)}: is this a run directory?")
    sim_id, base_id = str(rec["simulation_id"]), str(rec["snapshot"])
    if not sim._SIM_ID_RE.match(sim_id) or sim_id in (".", ".."):
        raise PublishError(f"not a simulation id: {sim_id!r}")
    if not _HEX64_RE.match(base_id):
        raise PublishError(f"the run's base snapshot {base_id!r} is not a published id "
                           "(64 lowercase hex): only a run of a published snapshot can be published")
    init = str(rec["init"])
    if not os.path.isfile(os.path.join(path, "wbm_init", init)):
        raise PublishError(f"the run has no wbm_init/{init}")
    code = rec.get("exit_code")
    return Run(path=path, sim_id=sim_id, base_id=base_id, init=init, model_input=str(rec["model_input"]),
               exit_code=code if isinstance(code, int) else None)


def read_base(anon: Anon, base_id: str) -> Base:
    """The base snapshot's ``metadata.json``, ``SHA256SUMS`` and listing, read anonymously."""
    prefix = f"snapshots/{base_id}/"
    listing: Dict[str, Tuple[int, str]] = {}
    for key, size, etag in fetch.list_objects(anon.base_url, prefix):
        rel = key[len(prefix):]
        if rel and not rel.endswith("/"):
            listing[rel] = (size, etag)
    if not listing:
        raise PublishError(f"nothing under {prefix} in {anon.base_url}: the run's base snapshot is not published")
    for name in (METADATA_NAME, SUMS_NAME):
        if name not in listing:
            raise PublishError(f"{prefix}{name} is not in the bucket; the base is not a snapshot")
    try:
        meta = json.loads(anon.get(prefix + METADATA_NAME).decode("utf-8"))
        sums = fetch.parse_sums(anon.get(prefix + SUMS_NAME).decode("utf-8"))
    except (OpenghmError, ValueError) as e:
        raise PublishError(f"cannot read the base's {METADATA_NAME} or {SUMS_NAME}: {e}")
    if not isinstance(meta, dict):
        raise PublishError(f"the base's {METADATA_NAME} is not a JSON object")
    # The base's own tree has to agree with itself, or a copy would carry the disagreement.
    problems = []
    for rel in sums:
        if fetch.select(rel, COPY_EXCLUDED) is None and rel != METADATA_NAME and rel not in listing:
            problems.append(f"{rel}: listed in {SUMS_NAME} but not in the bucket")
    for rel in sorted(listing):
        if rel in (METADATA_NAME, SUMS_NAME) or fetch.select(rel, COPY_EXCLUDED) is not None:
            continue
        if not fetch._safe_rel(rel):
            problems.append(f"{rel}: unsafe path in the listing")
        elif rel not in sums:
            problems.append(f"{rel}: in the bucket but has no {SUMS_NAME} line")
    if problems:
        raise PublishError(f"the base snapshot {base_id} does not agree with its own {SUMS_NAME}:\n{_problems(problems)}")
    return Base(id=base_id, meta=meta, sums=sums, listing=listing)


def read_metadata(path: str, snapshot_id: str) -> dict:
    """The given ``metadata.json`` with its ``id`` set to ``snapshot_id``.

    Whatever ``id`` it carried is replaced, so a document copied from the base cannot
    publish onto the base's id.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            meta = json.load(fh)
    except (OSError, ValueError) as e:
        raise PublishError(f"cannot read {path}: {e}")
    if not isinstance(meta, dict):
        raise PublishError(f"{path} is not a JSON object")
    if "id" in meta:
        meta["id"] = snapshot_id
        return meta
    out: dict = {}
    if "$schema" in meta:
        out["$schema"] = meta["$schema"]
    out["id"] = snapshot_id
    out.update({k: v for k, v in meta.items() if k != "$schema"})
    return out


# ── check ─────────────────────────────────────────────────────────────────────


def check_spec(meta: dict) -> None:
    """``meta`` passes the metadata spec (with its ``id`` set); else :class:`PublishError` (exit 2)."""
    result = spec.validate_document(meta, spec="snapshot-spec")
    if not result.ok:
        raise PublishError(f"the given {METADATA_NAME} fails the snapshot spec:\n{_problems(result.errors)}")


def check_agreement(meta: dict, run: Run, base: Base) -> None:
    """``meta`` says what the run did and what it was made from; else :class:`PublishError` (exit 2)."""
    problems = []
    init = (meta.get("simulation") or {}).get("init")
    if init != run.init:
        problems.append(f"simulation.init is {init!r}, the run used {run.init!r}")
    mid = ((meta.get("uses") or {}).get("modelInput") or {}).get("id")
    if mid != run.model_input:
        problems.append(f"uses.modelInput.id is {mid!r}, the run used {run.model_input!r}")
    container = (meta.get("uses") or {}).get("container")
    base_container = (base.meta.get("uses") or {}).get("container")
    if container != base_container:
        problems.append("uses.container is not the base snapshot's")
    based_on = (meta.get("about") or {}).get("isBasedOn") or []
    if not any(isinstance(e, dict) and e.get("kind") == "snapshot" and e.get("id") == base.id for e in based_on):
        problems.append(f"about.isBasedOn does not name the base snapshot {base.id}")
    # `id` was replaced by the one being published (read_metadata); a URL built from another id was not
    url = str((meta.get("about") or {}).get("url") or "")
    if any(i != meta.get("id") for i in re.findall(r"[0-9a-f]{64}", url)):
        problems.append(f"about.url {url!r} names another id than {meta.get('id')}")
    if problems:
        raise PublishError(f"the given {METADATA_NAME} does not agree with the run:\n{_problems(problems)}")


def check_code(meta: dict, base: Base) -> None:
    """``meta`` pins the WBM code this publish would write: the base's ``model/`` and ``utilities/``,
    copied as they are (ADR 0032); else :class:`PublishError` (exit 2, with the other disagreements
    between ``metadata.json`` and what is published).

    The copied bytes are the ones the base's ``SHA256SUMS`` lists, so the tree hash is computed from
    those lines and nothing is downloaded.
    """
    pinned = (((meta.get("uses") or {}).get("modelCode")) or {}).get("treeHash")
    actual = wbm_code.tree_hash_of_sums(base.sums)
    if pinned != actual:
        raise PublishError(wbm_code.mismatch_message("the code this publish copies from the base snapshot "
                                                     f"{base.id}", actual, str(pinned)))


def _walk_files(root: str) -> List[str]:
    """Every file under ``root`` as a ``/``-relative path, sorted. A symlinked directory is refused:
    a tree is published as it is, not as what it points to."""
    out: List[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for d in dirnames:
            if os.path.islink(os.path.join(dirpath, d)):
                raise PublishError(f"{os.path.join(dirpath, d)} is a symlink to a directory; it cannot be published")
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            if not os.path.isfile(full):
                raise PublishError(f"{full} is not a regular file (a broken symlink?)")
            out.append(os.path.relpath(full, root).replace(os.sep, "/"))
    return out


def expected_output(init_text: str) -> Tuple[Optional[List[int]], Optional[List[str]], List[str]]:
    """What the run's init says its output holds: ``(years, variables, notes)``.

    ``years`` are those from the first year (``Run_Start``, else the spinup's ``Start``,
    as ``sim`` reads it) to the last (``Run_End``). One daily file per year is expected,
    ``daily/wbm_<year>.nc``. ``variables`` are those in ``Output_vars``, expected as
    ``monthly/<variable>/wbm_<year>.nc`` when the init turns temporal aggregation on.
    Either is ``None`` when the init does not say, and ``notes`` says what was therefore
    not checked. Files beyond these are fine.
    """
    notes: List[str] = []
    years: Optional[List[int]] = None
    start = sim._perl_scalar(init_text, "Run_Start") or sim._perl_scalar(init_text, "Start")
    end = sim._perl_scalar(init_text, "Run_End")
    file_size = sim._perl_scalar(init_text, "File_Size")
    if not (start and end and sim._ISO_DATE_RE.match(start) and sim._ISO_DATE_RE.match(end)):
        notes.append("the init gives no run period as two ISO dates: the years were not checked")
    elif sim._TIME_SERIES_KEY_RE.search(init_text) or (file_size is not None and file_size != "year"):
        notes.append("the init writes something other than one daily file per year: the years were not checked")
    elif int(end[:4]) < int(start[:4]):
        notes.append(f"the init's Run_End {end} is before its start {start}: the years were not checked")
    else:
        years = list(range(int(start[:4]), int(end[:4]) + 1))
    variables: Optional[List[str]] = None
    raw = sim._perl_scalar(init_text, "Output_vars")
    if not raw or not raw.split():
        notes.append("the init lists no Output_vars: the variables were not checked")
    elif sim._perl_scalar(init_text, "Temporal_Aggregation") != "1":
        notes.append("the init does not turn on Temporal_Aggregation, so no per-variable files are expected: "
                     "the variables were not checked")
    else:
        variables = [v for v in raw.split() if re.fullmatch(r"\w+", v) and "Msk" not in v]
    return years, variables, notes


def check_output(run: Run) -> Tuple[List[str], List[str]]:
    """``(problems, notes)``: what is missing or wrong in the run's output, one line each (empty when it
    is complete), and what could not be checked (see :func:`expected_output`)."""
    problems: List[str] = []
    if run.exit_code:
        problems.append(f"the run exited with {run.exit_code}")
    out_dir = os.path.join(run.path, "wbm_output", run.sim_id)
    if not os.path.isdir(out_dir):
        return problems + [f"wbm_output/{run.sim_id}/ does not exist"], []
    files = _walk_files(out_dir)
    if not files:
        return problems + [f"wbm_output/{run.sim_id}/ holds no files"], []
    have = set(files)
    for rel in files:
        if os.path.getsize(os.path.join(out_dir, *rel.split("/"))) == 0:
            problems.append(f"wbm_output/{run.sim_id}/{rel} is empty")
    with open(os.path.join(run.path, "wbm_init", run.init), "r", encoding="utf-8", errors="replace") as fh:
        years, variables, notes = expected_output(fh.read())
    for year in years or []:
        if f"daily/wbm_{year}.nc" not in have:
            problems.append(f"wbm_output/{run.sim_id}/daily/wbm_{year}.nc is missing (the init runs {years[0]}-{years[-1]})")
    for var in variables or []:
        for year in years or []:
            if f"monthly/{var}/wbm_{year}.nc" not in have:
                problems.append(f"wbm_output/{run.sim_id}/monthly/{var}/wbm_{year}.nc is missing "
                                f"(Output_vars lists {var})")
        if not years and not any(r.startswith(f"monthly/{var}/") for r in files):
            problems.append(f"wbm_output/{run.sim_id}/monthly/{var}/ holds no file (Output_vars lists {var})")
    return problems, notes


# ── plan ──────────────────────────────────────────────────────────────────────


@dataclass
class Action:
    """One key of the new tree."""

    key: str
    #: Path inside ``snapshots/<id>/``.
    rel: str
    #: ``"copy"`` (server-side, from ``source``, the base's key) or ``"upload"`` (from ``source``, a local path).
    kind: str
    source: str
    size: int
    sha256: str
    #: Whether ``SHA256SUMS`` lists it (everything but ``wbm_output/`` and itself).
    in_sums: bool


@dataclass
class Plan:
    snapshot_id: str
    base_id: str
    prefix: str
    #: Copies, then uploads, then ``SHA256SUMS``, then ``metadata.json``: the order they are written in.
    actions: List[Action]
    sums_bytes: bytes
    metadata_bytes: bytes
    notes: List[str] = field(default_factory=list)

    @property
    def uploads(self) -> List[Action]:
        return [a for a in self.actions if a.kind == "upload"]


def _write(path: str, data: bytes) -> str:
    with open(path, "wb") as fh:
        fh.write(data)
    os.chmod(path, 0o644)
    return path


def check_layout(rels: List[str], metadata_bytes: bytes, workdir: str) -> None:
    """The tree these keys make passes the layout spec: stage empty files with the right names
    in a temporary directory and check them. Raises :class:`PublishError` (exit 3)."""
    stage = os.path.join(workdir, "stage")
    try:
        for rel in rels:
            path = os.path.join(stage, *rel.split("/"))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, "wb").close()
        _write(os.path.join(stage, METADATA_NAME), metadata_bytes)
        result = spec.validate_layout(Path(stage), spec="snapshot-spec")
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    if not result.ok:
        raise PublishError("the tree to publish fails the snapshot layout, missing: "
                           + ", ".join(result.missing_required), EXIT_OUTPUT_INCOMPLETE)


def build_plan(run: Run, base: Base, meta: dict, snapshot_id: str, workdir: str) -> Plan:
    """The actions for ``snapshot_id`` (see the module docstring). Touches no bucket.

    Runs the checks that need the plan's key list (the layout), and hashes every uploaded
    file. ``SHA256SUMS`` and ``metadata.json`` are written into ``workdir``.
    """
    prefix = f"snapshots/{snapshot_id}/"
    base_prefix = f"snapshots/{base.id}/"
    copies = [
        Action(key=prefix + rel, rel=rel, kind="copy", source=base_prefix + rel, size=base.listing[rel][0],
               sha256=base.sums[rel], in_sums=True)
        for rel in sorted(base.sums)
        if fetch.select(rel, COPY_EXCLUDED) is None and rel != METADATA_NAME
    ]

    notes: List[str] = []
    local: List[Tuple[str, str]] = []   # (rel, path)
    for sub, rel_root in (("wbm_init", "wbm_init"), (f"wbm_output/{run.sim_id}", f"wbm_output/{run.sim_id}"),
                          ("WBM_run_state", "WBM_run_state")):
        root = os.path.join(run.path, *sub.split("/"))
        if not os.path.isdir(root):
            notes.append(f"the run has no {sub}/: none published")
            continue
        local.extend((f"{rel_root}/{rel}", os.path.join(root, *rel.split("/"))) for rel in _walk_files(root))

    metadata_bytes = (json.dumps(meta, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    check_layout([a.rel for a in copies] + [rel for rel, _ in local], metadata_bytes, workdir)

    uploads = []
    for rel, path in local:
        uploads.append(Action(key=prefix + rel, rel=rel, kind="upload", source=path, size=os.path.getsize(path),
                              sha256=assets.sha256_file(path), in_sums=not rel.startswith("wbm_output/")))

    lines = {a.rel: a.sha256 for a in copies + uploads if a.in_sums}
    lines[METADATA_NAME] = hashlib.sha256(metadata_bytes).hexdigest()
    sums_bytes = "".join(f"{sha}  ./{rel}\n" for rel, sha in sorted(lines.items())).encode("utf-8")
    generated = []
    for name, data in ((SUMS_NAME, sums_bytes), (METADATA_NAME, metadata_bytes)):
        generated.append(Action(key=prefix + name, rel=name, kind="upload", source=_write(os.path.join(workdir, name), data),
                                size=len(data), sha256=hashlib.sha256(data).hexdigest(), in_sums=False))
    return Plan(snapshot_id=snapshot_id, base_id=base.id, prefix=prefix, actions=copies + uploads + generated,
                sums_bytes=sums_bytes, metadata_bytes=metadata_bytes, notes=notes)


def prepare(run_dir: str, metadata_path: str, snapshot_id: str, base_url: str, workdir: str) -> Plan:
    """Read, check and plan. Raises :class:`PublishError` before anything is written anywhere."""
    run = read_run(run_dir)
    if snapshot_id == run.base_id:
        raise PublishError("--id is the base snapshot's own id: a published snapshot is never replaced")
    meta = read_metadata(metadata_path, snapshot_id)
    check_spec(meta)
    base = read_base(Anon(base_url), run.base_id)
    check_agreement(meta, run, base)
    check_code(meta, base)
    problems, notes = check_output(run)
    if problems:
        raise PublishError(f"the run's output is incomplete:\n{_problems(problems)}", EXIT_OUTPUT_INCOMPLETE)
    plan = build_plan(run, base, meta, snapshot_id, workdir)
    plan.notes = notes + plan.notes
    return plan


# ── apply ─────────────────────────────────────────────────────────────────────


def _md5_file(path: str) -> str:
    h = hashlib.md5(usedforsecurity=False)  # compared with an ETag, not a security check
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def decide(action: Action, head: Callable[[str], Optional[ObjectInfo]]) -> str:
    """What to do with a key: ``"copy"`` / ``"upload"`` when it is absent, ``"skip"`` when it already
    holds the same bytes. Raises :class:`PublishError` (exit 4) when it holds other bytes.

    ``head`` is the client's, or the anonymous one's for a dry run.
    """
    have = head(action.key)
    if have is None:
        return action.kind
    if action.kind == "copy":
        src = head(action.source)
        if src is None:
            raise PublishError(f"{action.source} is not in the bucket any more", EXIT_UPLOAD_FAILED)
        same = have.size == src.size and bool(have.etag) and have.etag == src.etag
    elif have.size != action.size:
        same = False
    elif "sha256" in have.meta:
        same = have.meta["sha256"].lower() == action.sha256
    else:
        same = bool(have.etag) and have.etag == _md5_file(action.source)
    if not same:
        raise PublishError(f"{action.key} already holds other bytes than this publish would write; "
                           "a published object is never replaced", EXIT_OTHER_BYTES)
    return "skip"


@dataclass
class Counts:
    copy: int = 0
    upload: int = 0
    skip: int = 0
    bytes_uploaded: int = 0


def _run_phase(actions: List[Action], fn: Callable[[Action], None], jobs: int) -> None:
    """``fn`` on each action. After the first failure nothing further is started and it is raised."""
    if jobs <= 1 or len(actions) <= 1:
        for a in actions:
            fn(a)
        return
    first: Optional[BaseException] = None
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = [pool.submit(fn, a) for a in actions]
        for fut in as_completed(futures):
            try:
                fut.result()
            except BaseException as e:  # noqa: BLE001 - re-raised below
                if first is None:
                    first = e
                    for other in futures:
                        other.cancel()
    if first is not None:
        raise first


def apply_plan(plan: Plan, client: S3Client, *, jobs: int = 1, out: Callable[[str], None] = _echo) -> Counts:
    """Write the plan: copies, uploads, ``SHA256SUMS``, ``metadata.json``; each key read first.

    ``metadata.json`` is read before anything is written: a published snapshot with other
    metadata under this id stops the publish with nothing changed.
    """
    counts = Counts()
    lock = threading.Lock()
    meta_action = plan.actions[-1]

    def one(action: Action, check_only: bool = False) -> None:
        try:
            what = decide(action, client.head)
            if check_only:
                return
            if what == "copy":
                client.copy(action.source, action.key)
            elif what == "upload":
                client.put(action.source, action.key, action.sha256)
        except S3Error as e:
            raise PublishError(f"{action.key}: {e}", EXIT_UPLOAD_FAILED)
        with lock:
            setattr(counts, what, getattr(counts, what) + 1)
            if what == "upload":
                counts.bytes_uploaded += action.size
            out(f"{what:<7} {action.key}")

    one(meta_action, check_only=True)
    copies = [a for a in plan.actions if a.kind == "copy"]
    uploads = [a for a in plan.actions if a.kind == "upload" and a.rel not in (SUMS_NAME, METADATA_NAME)]
    _run_phase(copies, one, jobs)
    _run_phase(uploads, one, jobs)
    one(plan.actions[-2])    # SHA256SUMS
    one(meta_action)         # metadata.json, last
    return counts


# ── verify ────────────────────────────────────────────────────────────────────


def verify(plan: Plan, anon: Anon) -> int:
    """Re-read ``SHA256SUMS`` and HEAD every key anonymously: it is there, public-read, the right size,
    and an uploaded file has the mode and ``x-amz-meta-sha256`` it was sent with. Returns the key count;
    raises :class:`PublishError` (exit 7) listing what failed."""
    problems: List[str] = []
    try:
        if anon.get(plan.prefix + SUMS_NAME) != plan.sums_bytes:
            problems.append(f"{SUMS_NAME}: what the bucket serves is not what was written")
    except OpenghmError as e:
        problems.append(f"{SUMS_NAME}: {e}")
    for a in plan.actions:
        try:
            info = anon.head(a.key)
            if info is None:
                problems.append(f"{a.key}: not readable anonymously (missing, or not public-read)")
                continue
            if info.size != a.size:
                problems.append(f"{a.key}: {info.size} bytes, expected {a.size}")
            if a.kind == "upload":
                want_mode: Optional[int] = os.stat(a.source).st_mode & 0o777
                if info.meta.get("sha256", a.sha256).lower() != a.sha256:
                    problems.append(f"{a.key}: x-amz-meta-sha256 is not the uploaded file's")
            else:
                src = anon.head(a.source)
                want_mode = src.mode if src else None
            if want_mode is not None and info.mode != want_mode:
                got = "none" if info.mode is None else oct(info.mode)
                problems.append(f"{a.key}: mode {got} in x-amz-meta-s3cmd-attrs, expected {oct(want_mode)}")
        except OpenghmError as e:
            problems.append(f"{a.key}: {e}")
    if problems:
        raise PublishError(f"verification failed:\n{_problems(problems)}", EXIT_VERIFY_FAILED)
    return len(plan.actions)


# ── the command ───────────────────────────────────────────────────────────────


@dataclass
class PublishResult:
    snapshot_id: str
    dry_run: bool
    counts: Counts
    verified: int = 0
    notes: List[str] = field(default_factory=list)


def new_snapshot_id() -> str:
    """256 random bits as lowercase hex (ADR 0014)."""
    return secrets.token_hex(32)


def publish(
    run_dir: str,
    metadata_path: str,
    *,
    snapshot_id: Optional[str] = None,
    base_url: Optional[str] = None,
    s3cfg: str = "~/.s3cfg",
    s3cmd: str = "s3cmd",
    dry_run: bool = False,
    jobs: int = 4,
    client: Optional[S3Client] = None,
    out: Callable[[str], None] = _echo,
) -> PublishResult:
    """Publish the run in ``run_dir`` as ``snapshots/<id>/`` (see the module docstring).

    With ``dry_run`` nothing is written: the plan is printed with each key's action, decided from
    anonymous reads, so it needs no credentials. ``client`` replaces the ``s3cmd`` one (tests).
    Raises :class:`PublishError`, whose ``code`` is the exit code.
    """
    base_url = (base_url or fetch.S3_BASE).rstrip("/")
    bucket = bucket_of(base_url)
    if snapshot_id is not None and not _HEX64_RE.match(snapshot_id):
        raise PublishError(f"--id {snapshot_id!r} is not a snapshot id (256 bits as 64 lowercase hex)")
    if not dry_run and client is None:
        exe, cfg = check_credentials(s3cfg, s3cmd)
        client = make_client(exe, cfg, bucket)
    snapshot_id = snapshot_id or new_snapshot_id()

    with tempfile.TemporaryDirectory(prefix="openghm-publish-") as workdir:
        plan = prepare(run_dir, metadata_path, snapshot_id, base_url, workdir)
        for note in plan.notes:
            out(f"note: {note}")
        anon = Anon(base_url)
        if dry_run:
            out(f"snapshot id: {snapshot_id} (dry run: nothing is written)")
            counts = Counts()
            for a in plan.actions:
                what = decide(a, anon.head)
                setattr(counts, what, getattr(counts, what) + 1)
                if what == "upload":
                    counts.bytes_uploaded += a.size
                out(f"{what:<7} {a.key}")
            return PublishResult(snapshot_id, True, counts, notes=plan.notes)
        out(f"snapshot id: {snapshot_id}")
        counts = apply_plan(plan, client, jobs=jobs, out=out)
        verified = verify(plan, anon)
    return PublishResult(snapshot_id, False, counts, verified=verified, notes=plan.notes)
