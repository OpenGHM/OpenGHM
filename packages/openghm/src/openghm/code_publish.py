"""``openghm code publish`` — publish a WBM code version to ``wbm-code/wbm/<version>/`` (ADR 0032).

``SOURCE`` is a directory, or a ``.tar`` / ``.tar.gz`` / ``.tgz`` / ``.zip`` of one. The code
root is the folder holding ``model/`` and ``utilities/``: the source itself, or its single
top-level folder, and nothing else (the shape of the upstream release archives is not known,
so one wrapping folder is tolerated and the rest is refused). An archive is extracted into a
temporary directory with every member checked first: an absolute path, a ``..`` component, a
link and a device or fifo are refused, and nothing is written outside the directory.

The version is the ``WBM_VERSION`` constant in ``model/wbm.pl``. The key prefix is
``wbm-code/wbm/<version>/`` (``<version>-r<N>`` with ``--revision N``). The tree is:

- ``model/`` and ``utilities/`` as the source has them, ``_Inline`` included (ADR 0032) although
  the tree hash leaves it out (ADR 0008), each file public-read with its mode as
  ``mode:<decimal st_mode>`` in ``x-amz-meta-s3cmd-attrs`` (ADR 0022) and its sha256 as
  ``x-amz-meta-sha256``, exactly as ``snapshot publish`` uploads a file;
- ``SHA256SUMS``, ``<sha256>  ./<path>`` for every one of those files, sorted by path;
- ``TREEHASH``, one line: the tree hash of the code, written **last**. A prefix without it is an
  unfinished publish, and a retry with the same version continues where it stopped.

Modes are the source's own and are never guessed (ADR 0022), with one exception: WBM runs
:data:`EXECUTABLE` directly, so a staged copy of either of them that is not executable is made
0755 and the change is printed (``utilities/build_spool.pl`` was once published 0644, and
``wbm.pl -bldSpool`` failed with "Permission denied").

Three phases, like ``snapshot publish``. **Plan** reads and stages the source, hashes it and reads
``wbm-code/wbm/<version>/TREEHASH`` anonymously: the same hash is "already published" and nothing is
changed; another hash is refused (nothing is replaced), with the next free ``-r<N>``, which is
never picked automatically. **Apply** reads each key first through :class:`publish.S3Client`:
absent, it writes it; present with the same bytes, it skips it; present with other bytes, it stops.
**Verify** re-reads ``SHA256SUMS`` and ``TREEHASH``, HEADs every key anonymously, and recomputes the
tree hash from the published ``SHA256SUMS``.

Last, the version is listed in ``wbm-code/manifest.json`` (:mod:`wbm_code_manifest`): added as
``current`` with today's UTC date unless it is already listed with this tree hash; an entry is never
overwritten, and a listing with another tree hash stops the publish **before** anything is written. A
failure to write the manifest happens after the code is published and verified, so it is its own error
(exit 8), not a failed publish: ``openghm code manifest sync`` repairs it, and so does running the same
publish again (already published, but not yet listed, it lists it).

Exit codes (``openghm code publish``; the same numbers as ``snapshot publish``, which has no use here for 3):

====  ===========================================================================
0     done, already published (the same tree hash), or, with ``--dry-run``, a plan that would go through
2     bad input: an unreadable or unsafe source, no code root, no ``WBM_VERSION``, a path or
      link that cannot be published, a bad ``--revision``
4     the version (or a key under it) already holds other bytes (nothing is replaced); or
      ``wbm-code/manifest.json`` is not valid or lists the version with another tree hash
5     no credentials: ``--s3cfg`` missing or unreadable, or no ``s3cmd``
6     an ``s3cmd`` call failed (read or upload)
7     verification failed: a key is missing, not public-read, or the wrong size, mode or hash
8     the code is published and verified, but ``wbm-code/manifest.json`` could not be updated
====  ===========================================================================

Stdlib only; Python 3.9 (Anvil).
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import stat
import tarfile
import tempfile
import threading
import zipfile
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

from . import assets, fetch
from . import code as wbm_code
from . import publish as pub
from . import wbm_code_manifest as manifest
from .errors import OpenghmError
from .publish import (EXIT_BAD_INPUT, EXIT_OTHER_BYTES, EXIT_UPLOAD_FAILED, EXIT_VERIFY_FAILED, Action, Anon,
                      Counts, PublishError, S3Client, S3Error)

SUMS_NAME = fetch.SUMS_NAME
TREEHASH_NAME = "TREEHASH"
PREFIX = "wbm-code/wbm/"

#: The code is published, but its manifest entry could not be written.
EXIT_MANIFEST_FAILED = 8

#: Files WBM runs directly: they must be executable in the published tree.
EXECUTABLE = ("model/wbm.pl", "utilities/build_spool.pl")

#: Names an archive tool adds beside the folder it packs; they do not count as "another entry".
_JUNK = ("__MACOSX", ".DS_Store")

_VERSION_LINE_RE = re.compile(rb"""^\s*use\s+constant\s+WBM_VERSION\s*=>\s*(['"])([^'"]+)\1""", re.MULTILINE)
_VERSION_OK_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+-]*$")
_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")


def _echo(line: str) -> None:
    print(line, flush=True)


# ── the source ────────────────────────────────────────────────────────────────


def _unsafe(name: str) -> bool:
    if not name or name.startswith("/") or "\\" in name or re.match(r"^[A-Za-z]:", name):
        return True
    return ".." in name.split("/")


def _target(dest: str, name: str) -> Optional[str]:
    """Where member ``name`` goes under ``dest``, or ``None`` for the archive's own ``./``."""
    if _unsafe(name):
        raise PublishError(f"refusing to extract {name!r}: an absolute path, a '..' component or a backslash")
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if not parts:
        return None
    path = os.path.join(dest, *parts)
    if os.path.commonpath([os.path.realpath(dest), os.path.realpath(path)]) != os.path.realpath(dest):
        raise PublishError(f"refusing to extract {name!r}: it would leave the extraction directory")
    return path


def _write_member(path: str, src, mode: int, name: str) -> None:
    if not mode & 0o400:
        raise PublishError(f"{name}: mode {oct(mode)} is not readable by its owner; it cannot be published")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as out:
        shutil.copyfileobj(src, out)
    os.chmod(path, mode)


def extract(source: str, dest: str) -> None:
    """Extract the archive ``source`` into ``dest``, member by member. Raises :class:`PublishError`
    on any unsafe member, before that member is written."""
    low = source.lower()
    try:
        if low.endswith(".zip"):
            with zipfile.ZipFile(source) as zf:
                for info in zf.infolist():
                    name = info.filename
                    attr = info.external_attr >> 16
                    if attr and not (stat.S_ISREG(attr) or stat.S_ISDIR(attr)):
                        raise PublishError(f"refusing {name!r}: not a regular file or directory (a link or device)")
                    path = _target(dest, name)
                    if path is None:
                        continue
                    if name.endswith("/") or (attr and stat.S_ISDIR(attr)):
                        os.makedirs(path, exist_ok=True)
                        continue
                    with zf.open(info) as src:
                        _write_member(path, src, (attr & 0o777) or 0o644, name)
        elif low.endswith((".tar", ".tar.gz", ".tgz")):
            with tarfile.open(source, "r:*") as tf:
                for member in tf:
                    name = member.name
                    if not (member.isreg() or member.isdir()):
                        raise PublishError(f"refusing {name!r}: not a regular file or directory "
                                           "(a link, device or fifo)")
                    path = _target(dest, name)
                    if path is None:
                        continue
                    if member.isdir():
                        os.makedirs(path, exist_ok=True)
                        continue
                    src = tf.extractfile(member)
                    if src is None:
                        raise PublishError(f"cannot read {name!r} in {source}")
                    with src:
                        _write_member(path, src, member.mode & 0o777, name)
        else:
            raise PublishError(f"{source} is not a directory, .tar, .tar.gz, .tgz or .zip")
    except (tarfile.TarError, zipfile.BadZipFile, EOFError, OSError) as e:
        raise PublishError(f"cannot read the archive {source}: {e}")


def _is_code_root(path: str) -> bool:
    return all(os.path.isdir(os.path.join(path, d)) and not os.path.islink(os.path.join(path, d))
               for d in wbm_code.CODE_DIRS)


def find_root(top: str) -> str:
    """The code root: ``top`` itself, or its one top-level folder. Raises :class:`PublishError` listing
    what was found otherwise."""
    if _is_code_root(top):
        return top
    entries = sorted(n for n in os.listdir(top) if n not in _JUNK)
    dirs = [n for n in entries if os.path.isdir(os.path.join(top, n)) and not os.path.islink(os.path.join(top, n))]
    if len(entries) == 1 and dirs and _is_code_root(os.path.join(top, dirs[0])):
        return os.path.join(top, dirs[0])
    shown = ", ".join(entries[:20]) + (f", ... ({len(entries)} entries)" if len(entries) > 20 else "")
    raise PublishError("no WBM code root: expected model/ and utilities/ either at the top of the source or in its "
                       f"single top-level folder. Found at the top: {shown or 'nothing'}")


def stage(root: str, dest: str) -> Dict[str, int]:
    """Copy ``model/`` and ``utilities/`` of ``root`` into ``dest`` with each file's mode, and return
    ``{rel: mode}``. A symlink or anything that is not a regular file is refused: a tree is published
    as it is, not as what it points to."""
    modes: Dict[str, int] = {}
    for d in wbm_code.CODE_DIRS:
        for dirpath, dirnames, filenames in os.walk(os.path.join(root, d)):
            dirnames.sort()
            for n in dirnames:
                full = os.path.join(dirpath, n)
                if os.path.islink(full):
                    raise PublishError(f"{os.path.relpath(full, root)} is a symlink to a directory; "
                                       "it cannot be published")
            os.makedirs(os.path.join(dest, os.path.relpath(dirpath, root)), exist_ok=True)
            for n in sorted(filenames):
                full = os.path.join(dirpath, n)
                rel = os.path.relpath(full, root).replace(os.sep, "/")
                st = os.lstat(full)
                if not stat.S_ISREG(st.st_mode):
                    raise PublishError(f"{rel} is not a regular file (a symlink or a special file); "
                                       "it cannot be published")
                mode = st.st_mode & 0o777
                if not mode & 0o400:
                    raise PublishError(f"{rel}: mode {oct(mode)} is not readable by its owner; it cannot be published")
                target = os.path.join(dest, *rel.split("/"))
                shutil.copyfile(full, target)
                os.chmod(target, mode)
                modes[rel] = mode
    return modes


def read_version(root: str) -> str:
    """The ``WBM_VERSION`` constant in ``model/wbm.pl``."""
    path = os.path.join(root, "model", "wbm.pl")
    try:
        with open(path, "rb") as fh:
            text = fh.read()
    except OSError as e:
        raise PublishError(f"cannot read model/wbm.pl: {e}")
    m = _VERSION_LINE_RE.search(text)
    if not m:
        raise PublishError("cannot find `use constant WBM_VERSION => '<version>';` in model/wbm.pl")
    version = m.group(2).decode("utf-8", "replace")
    if not _VERSION_OK_RE.match(version):
        raise PublishError(f"WBM_VERSION {version!r} in model/wbm.pl is not usable in a key "
                           "(letters, digits and . _ + - only)")
    return version


# ── plan ──────────────────────────────────────────────────────────────────────


@dataclass
class CodePlan:
    #: ``WBM_VERSION`` as the code declares it.
    version: str
    #: The directory under ``wbm-code/wbm/``: ``version`` or ``<version>-r<N>``.
    name: str
    tree_hash: str
    prefix: str
    #: Files, then ``SHA256SUMS``, then ``TREEHASH``: the order they are written in.
    actions: List[Action]
    sums_bytes: bytes
    treehash_bytes: bytes
    #: ``(rel, source mode, published mode)`` for each mode that was fixed.
    mode_fixes: List[Tuple[str, int, int]] = field(default_factory=list)


def build_plan(root: str, workdir: str, revision: Optional[int] = None) -> CodePlan:
    """Stage the code at ``root`` under ``workdir``, fix the modes of :data:`EXECUTABLE`, and turn it into
    one :class:`Action` per key. Touches no bucket."""
    version = read_version(root)
    name = version if revision is None else f"{version}-r{revision}"
    prefix = f"{PREFIX}{name}/"
    staged = os.path.join(workdir, "code")
    modes = stage(root, staged)

    fixes: List[Tuple[str, int, int]] = []
    for rel in EXECUTABLE:
        if rel not in modes:
            raise PublishError(f"{rel} is not in the source: WBM runs it directly, so this is not a WBM code tree")
        if not modes[rel] & 0o111:     # not executable: fix it; an executable one keeps the mode it has
            fixes.append((rel, modes[rel], 0o755))
            os.chmod(os.path.join(staged, *rel.split("/")), 0o755)
            modes[rel] = 0o755

    try:
        tree_hash = wbm_code.tree_hash(staged)
        sums = {rel: assets.sha256_file(os.path.join(staged, *rel.split("/"))) for rel in modes}
    except OpenghmError as e:
        raise PublishError(str(e))
    for rel in sums:
        if "\n" in rel or "\\" in rel:
            raise PublishError(f"{rel!r} has a backslash or a newline in its path; it cannot be published")

    actions = [Action(key=prefix + rel, rel=rel, kind="upload", source=os.path.join(staged, *rel.split("/")),
                      size=os.path.getsize(os.path.join(staged, *rel.split("/"))), sha256=sha, in_sums=True)
               for rel, sha in sorted(sums.items(), key=lambda kv: kv[0].encode("utf-8"))]
    sums_bytes = "".join(f"{sha}  ./{rel}\n" for rel, sha in
                         sorted(sums.items(), key=lambda kv: kv[0].encode("utf-8"))).encode("utf-8")
    treehash_bytes = (tree_hash + "\n").encode("ascii")
    for fname, data in ((SUMS_NAME, sums_bytes), (TREEHASH_NAME, treehash_bytes)):
        actions.append(Action(key=prefix + fname, rel=fname, kind="upload",
                              source=pub._write(os.path.join(workdir, fname), data), size=len(data),
                              sha256=hashlib.sha256(data).hexdigest(), in_sums=False))
    return CodePlan(version=version, name=name, tree_hash=tree_hash, prefix=prefix, actions=actions,
                    sums_bytes=sums_bytes, treehash_bytes=treehash_bytes, mode_fixes=fixes)


def published_tree_hash(anon: Anon, prefix: str) -> Optional[str]:
    """The tree hash ``prefix`` holds, or ``None`` when it has no ``TREEHASH`` (never published, or
    unfinished). Raises :class:`PublishError` (exit 4) when the key does not hold a tree hash."""
    try:
        if anon.head(prefix + TREEHASH_NAME) is None:
            return None
        text = anon.get(prefix + TREEHASH_NAME).decode("ascii", "replace").strip()
    except OpenghmError as e:
        raise PublishError(f"cannot read {prefix}{TREEHASH_NAME}: {e}", EXIT_UPLOAD_FAILED)
    if not _HEX64_RE.match(text):
        raise PublishError(f"{prefix}{TREEHASH_NAME} does not hold a tree hash; it is not replaced", EXIT_OTHER_BYTES)
    return text


def next_free_revision(anon: Anon, version: str, start: int = 1) -> int:
    """The smallest ``N >= start`` whose ``wbm-code/wbm/<version>-r<N>/`` has no ``TREEHASH``."""
    n = start
    while anon.head(f"{PREFIX}{version}-r{n}/{TREEHASH_NAME}") is not None:
        n += 1
    return n


def other_bytes_message(plan: CodePlan, published: str, anon: Anon, source: str) -> str:
    n = next_free_revision(anon, plan.version, 1)
    return (f"{plan.prefix} already holds code with tree hash {published}, but this source hashes to "
            f"{plan.tree_hash}. A published version is never replaced.\n"
            f"The next free revision is {plan.version}-r{n}; to publish this code under it, run again with "
            f"`openghm code publish {source} --revision {n}`")


# ── apply and verify ──────────────────────────────────────────────────────────


def apply_plan(plan: CodePlan, client: S3Client, *, jobs: int = 1, out: Callable[[str], None] = _echo) -> Counts:
    """Write the plan: files, ``SHA256SUMS``, ``TREEHASH``; each key read first. Nothing is replaced."""
    counts = Counts()
    lock = threading.Lock()

    def one(action: Action) -> None:
        try:
            what = pub.decide(action, client.head)
            if what == "upload":
                client.put(action.source, action.key, action.sha256)
        except S3Error as e:
            raise PublishError(f"{action.key}: {e}", EXIT_UPLOAD_FAILED)
        with lock:
            setattr(counts, what, getattr(counts, what) + 1)
            if what == "upload":
                counts.bytes_uploaded += action.size
            out(f"{what:<7} {action.key}")

    pub._run_phase(plan.actions[:-2], one, jobs)
    one(plan.actions[-2])    # SHA256SUMS
    one(plan.actions[-1])    # TREEHASH, last
    return counts


def verify(plan: CodePlan, anon: Anon) -> int:
    """:func:`publish.verify` (every key HEADed anonymously, ``SHA256SUMS`` re-read, modes and sha256
    checked), then ``TREEHASH`` is re-read and the tree hash is recomputed from the published
    ``SHA256SUMS``. Returns the key count; raises :class:`PublishError` (exit 7)."""
    count = pub.verify(plan, anon)     # type: ignore[arg-type]  # uses prefix, sums_bytes and actions only
    problems: List[str] = []
    try:
        if anon.get(plan.prefix + TREEHASH_NAME) != plan.treehash_bytes:
            problems.append(f"{TREEHASH_NAME}: what the bucket serves is not what was written")
        published = wbm_code.tree_hash_of_sums(fetch.parse_sums(anon.get(plan.prefix + SUMS_NAME).decode("utf-8")))
        if published != plan.tree_hash:
            problems.append(f"the tree hash of the published {SUMS_NAME} is {published}, expected {plan.tree_hash}")
    except OpenghmError as e:
        problems.append(str(e))
    if problems:
        raise PublishError(f"verification failed:\n{pub._problems(problems)}", EXIT_VERIFY_FAILED)
    return count


# ── the command ───────────────────────────────────────────────────────────────


@dataclass
class CodePublishResult:
    version: str
    name: str
    prefix: str
    tree_hash: str
    dry_run: bool
    already_published: bool = False
    counts: Counts = field(default_factory=Counts)
    verified: int = 0
    mode_fixes: List[Tuple[str, int, int]] = field(default_factory=list)
    #: What happened to ``wbm-code/manifest.json``: ``added``, ``unchanged``, or ``failed`` (then
    #: ``manifest_error`` says why and the CLI exits 8).
    manifest: str = ""
    manifest_error: Optional[str] = None


def _list_in_manifest(result: CodePublishResult, anon: Anon, client: Optional[S3Client],
                      out: Callable[[str], None]) -> None:
    """The last step: list the version. A failure is recorded, not raised: the code is already published."""
    try:
        result.manifest = manifest.record(anon, client, result.name, result.tree_hash, dry_run=result.dry_run,
                                          out=out)
    except (PublishError, OpenghmError) as e:
        result.manifest, result.manifest_error = "failed", str(e)


def publish_code(
    source: str,
    *,
    revision: Optional[int] = None,
    base_url: Optional[str] = None,
    s3cfg: str = "~/.s3cfg",
    s3cmd: str = "s3cmd",
    dry_run: bool = False,
    jobs: int = 4,
    client: Optional[S3Client] = None,
    out: Callable[[str], None] = _echo,
) -> CodePublishResult:
    """Publish the WBM code in ``source`` (see the module docstring).

    With ``dry_run`` nothing is written: the plan is printed with each key's action, decided from
    anonymous reads, so it needs no credentials. ``client`` replaces the ``s3cmd`` one (tests).
    Raises :class:`PublishError`, whose ``code`` is the exit code.
    """
    base_url = (base_url or fetch.S3_BASE).rstrip("/")
    bucket = pub.bucket_of(base_url)
    if revision is not None and revision < 1:
        raise PublishError(f"--revision {revision} is not a revision number (1 or more)")
    source = os.path.abspath(os.path.expanduser(source))
    if not os.path.exists(source):
        raise PublishError(f"source not found: {source}")
    if not dry_run and client is None:
        exe, cfg = pub.check_credentials(s3cfg, s3cmd)
        client = pub.make_client(exe, cfg, bucket)

    with tempfile.TemporaryDirectory(prefix="openghm-code-publish-") as workdir:
        if os.path.isdir(source):
            root = find_root(source)
        else:
            unpacked = os.path.join(workdir, "unpacked")
            os.makedirs(unpacked)
            extract(source, unpacked)
            root = find_root(unpacked)
        plan = build_plan(root, workdir, revision)
        anon = Anon(base_url)
        result = CodePublishResult(plan.version, plan.name, plan.prefix, plan.tree_hash, dry_run,
                                   mode_fixes=plan.mode_fixes)
        out(f"version: {plan.version}")
        out(f"tree hash: {plan.tree_hash}")
        out(f"key prefix: {plan.prefix}")
        for rel, old, new in plan.mode_fixes:
            out(f"mode fix: {rel} is {oct(old)[2:].zfill(4)} in the source, published as {oct(new)[2:].zfill(4)} "
                "(WBM runs it directly)")

        published = published_tree_hash(anon, plan.prefix)
        if published is not None:
            if published != plan.tree_hash:
                raise PublishError(other_bytes_message(plan, published, anon, source), EXIT_OTHER_BYTES)
            result.already_published = True
            manifest.check_record(anon, plan.name, plan.tree_hash)
            out(f"already published: {plan.prefix} holds this tree hash; nothing is changed")
            for rel in EXECUTABLE:
                info = anon.head(plan.prefix + rel)
                if info is not None and info.mode is not None and not info.mode & 0o111:
                    out(f"warning: {plan.prefix}{rel} is published with mode {oct(info.mode)[2:].zfill(4)}, "
                        "not executable; a published object is not changed")
            _list_in_manifest(result, anon, client, out)
            return result

        manifest.check_record(anon, plan.name, plan.tree_hash)     # refuse before the first byte is written
        if dry_run:
            out("dry run: nothing is written")
        counts = result.counts
        if dry_run:
            for a in plan.actions:
                what = pub.decide(a, anon.head)
                setattr(counts, what, getattr(counts, what) + 1)
                if what == "upload":
                    counts.bytes_uploaded += a.size
                out(f"{what:<7} {a.key}")
            _list_in_manifest(result, anon, client, out)
            return result
        result.counts = apply_plan(plan, client, jobs=jobs, out=out)
        result.verified = verify(plan, anon)
        _list_in_manifest(result, anon, client, out)
    return result
