"""``wbm-code/manifest.json`` — the index of published WBM code versions, and its policy status.

The one mutable object under ``wbm-code/`` (the published trees under ``wbm-code/wbm/<version>/``
are immutable, rule 1), like ``containers/manifest.json`` is for the images. Only the toolkit
writes it: ``openghm code publish`` adds a version, ``openghm code manifest sync`` builds or
refreshes it from the bucket, ``openghm code set-status`` changes a version's status.

The format (``manifestVersion`` 1)::

    {
      "manifestVersion": 1,
      "code": {
        "wbm": {
          "aliases": { "latest": "23.9.0" },
          "versions": {
            "22.1.1": { "treeHash": "<64 hex>", "status": "current", "published": "2026-10-07" },
            "23.9.0": { "treeHash": "<64 hex>", "status": "current", "published": "2026-10-07" }
          }
        }
      }
    }

A version is a ``WBM_VERSION`` value, optionally with a ``-r<N>`` suffix (:func:`version_key` orders
them). ``status`` is ``current`` (a new snapshot draft may start from a snapshot on this code; several
versions may be current), ``legacy`` (existing snapshots on it keep working and stay visible, no new draft
starts from them) or ``withdrawn`` (known bad; the entry also carries ``"reason"``, and only a withdrawn
one does). ``aliases.latest`` is the highest version by :func:`version_key`, informational only.
``published`` is an ISO ``YYYY-MM-DD`` date in UTC. A parse is strict: any other shape is an error.

:func:`serialise` is the one writer: fixed key order, versions in :func:`version_key` order, 2-space
indent, a trailing newline.

Exit codes of a failure here (:class:`ManifestError` and the :class:`PublishError` the writers raise):
2 bad input (an unknown version, ``withdrawn`` without a reason, no manifest to read), 4 the bucket holds a
manifest that is not valid or disagrees with a ``TREEHASH`` (nothing is replaced), 5 no credentials,
6 an S3 call failed, 7 the manifest read back after the write is not what was written.

Stdlib only; Python 3.9 (Anvil).
"""

from __future__ import annotations

import copy
import datetime as _dt
import email.utils
import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

from . import fetch
from . import publish as pub
from .errors import OpenghmError
from .publish import (EXIT_BAD_INPUT, EXIT_OTHER_BYTES, EXIT_UPLOAD_FAILED, EXIT_VERIFY_FAILED, Anon,
                      PublishError, S3Client, S3Error)

MANIFEST_KEY = "wbm-code/manifest.json"
PREFIX = "wbm-code/wbm/"
TREEHASH_NAME = "TREEHASH"
PRODUCT = "wbm"
MANIFEST_VERSION = 1
STATUSES = ("current", "legacy", "withdrawn")

_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
_VERSION_OK_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+-]*$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_REVISION_RE = re.compile(r"^(.*)-r([0-9]+)$")
_NUMERIC_RE = re.compile(r"^[0-9]+$")


def _echo(line: str) -> None:
    print(line, flush=True)


class ManifestError(PublishError):
    """The manifest is not valid, or disagrees with the bucket. Exit 4 unless said otherwise."""

    def __init__(self, message: str, code: int = EXIT_OTHER_BYTES):
        super().__init__(message, code)


# ── version order ─────────────────────────────────────────────────────────────


def version_key(version: str) -> tuple:
    """The sort key of a version. The base is split on ``.`` and its numeric parts compare as integers; a
    part that is not numeric compares as a string, after every numeric one. A ``-r<N>`` suffix sorts
    after the same base without it, and by ``N``. So ``22.1.1 < 23.9.0 < 23.10.0`` and
    ``23.9.0 < 23.9.0-r1 < 23.9.0-r2 < 23.9.1``."""
    m = _REVISION_RE.match(version)
    base, revision = (m.group(1), int(m.group(2))) if m else (version, -1)
    parts = tuple((0, int(p), "") if _NUMERIC_RE.match(p) else (1, 0, p) for p in base.split("."))
    return (parts, revision, version)


def latest_of(versions) -> Optional[str]:
    """The highest of ``versions`` by :func:`version_key`, or ``None`` when there are none."""
    return max(versions, key=version_key) if versions else None


# ── the document ──────────────────────────────────────────────────────────────

Manifest = dict


def empty() -> Manifest:
    return {"manifestVersion": MANIFEST_VERSION, "code": {PRODUCT: {"aliases": {}, "versions": {}}}}


def versions_of(manifest: Manifest) -> Dict[str, dict]:
    """The ``code.wbm.versions`` mapping of a parsed manifest, created when absent."""
    prod = manifest["code"].setdefault(PRODUCT, {"aliases": {}, "versions": {}})
    return prod["versions"]


def today_utc() -> str:
    return _dt.datetime.now(_dt.timezone.utc).date().isoformat()


def _fail(msg: str, where: str) -> ManifestError:
    return ManifestError(f"{where} is not a valid WBM code manifest: {msg}")


def _check_entry(version: str, entry, where: str) -> None:
    if not _VERSION_OK_RE.match(version):
        raise _fail(f"{version!r} is not a version string", where)
    if not isinstance(entry, dict):
        raise _fail(f"version {version}: expected an object", where)
    extra = sorted(set(entry) - {"treeHash", "status", "published", "reason"})
    if extra:
        raise _fail(f"version {version}: unknown key(s) {', '.join(extra)}", where)
    th = entry.get("treeHash")
    if not (isinstance(th, str) and _HEX64_RE.match(th)):
        raise _fail(f"version {version}: treeHash must be 64 lower-case hex digits", where)
    status = entry.get("status")
    if status not in STATUSES:
        raise _fail(f"version {version}: status {status!r} is not one of {', '.join(STATUSES)}", where)
    date = entry.get("published")
    if not (isinstance(date, str) and _DATE_RE.match(date)):
        raise _fail(f"version {version}: published must be an ISO date (YYYY-MM-DD)", where)
    try:
        _dt.date.fromisoformat(date)
    except ValueError:
        raise _fail(f"version {version}: published {date!r} is not a date", where)
    reason = entry.get("reason")
    if status == "withdrawn":
        if not (isinstance(reason, str) and reason.strip()):
            raise _fail(f"version {version}: a withdrawn version needs a non-empty reason", where)
    elif "reason" in entry:
        raise _fail(f"version {version}: only a withdrawn version carries a reason", where)


def validate(doc, where: str = MANIFEST_KEY) -> Manifest:
    """``doc`` (parsed JSON) as a manifest, or a :class:`ManifestError` saying what is wrong."""
    if not isinstance(doc, dict) or set(doc) != {"manifestVersion", "code"}:
        raise _fail("expected an object with exactly manifestVersion and code", where)
    if doc["manifestVersion"] != MANIFEST_VERSION or isinstance(doc["manifestVersion"], bool):
        raise _fail(f"manifestVersion must be {MANIFEST_VERSION}, found {doc['manifestVersion']!r}", where)
    code = doc["code"]
    if not isinstance(code, dict):
        raise _fail("code must be an object", where)
    for name, prod in code.items():
        if not isinstance(prod, dict) or set(prod) != {"aliases", "versions"}:
            raise _fail(f"code.{name}: expected an object with exactly aliases and versions", where)
        aliases, versions = prod["aliases"], prod["versions"]
        if not isinstance(aliases, dict) or not isinstance(versions, dict):
            raise _fail(f"code.{name}: aliases and versions must be objects", where)
        for version, entry in versions.items():
            _check_entry(version, entry, where)
        if set(aliases) - {"latest"}:
            raise _fail(f"code.{name}.aliases: only 'latest' is known", where)
        if "latest" in aliases and aliases["latest"] not in versions:
            raise _fail(f"code.{name}.aliases.latest {aliases['latest']!r} is not a listed version", where)
    return doc


def parse(data, where: str = MANIFEST_KEY) -> Manifest:
    """Strictly parse manifest bytes or text. Raises :class:`ManifestError` (exit 4)."""
    try:
        text = data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else data
        doc = json.loads(text)
    except (ValueError, UnicodeDecodeError) as e:
        raise _fail(f"not JSON ({e})", where)
    return validate(doc, where)


def serialise(manifest: Manifest) -> bytes:
    """The manifest as it is written: fixed key order, versions in :func:`version_key` order, 2-space
    indent, a trailing newline."""
    code = {}
    for name in sorted(manifest["code"]):
        prod = manifest["code"][name]
        versions = {}
        for v in sorted(prod["versions"], key=version_key):
            e = prod["versions"][v]
            out = {"treeHash": e["treeHash"], "status": e["status"], "published": e["published"]}
            if "reason" in e:
                out["reason"] = e["reason"]
            versions[v] = out
        aliases = {"latest": prod["aliases"]["latest"]} if "latest" in prod["aliases"] else {}
        code[name] = {"aliases": aliases, "versions": versions}
    doc = {"manifestVersion": manifest["manifestVersion"], "code": code}
    return (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def refresh_latest(manifest: Manifest) -> None:
    """Set ``aliases.latest`` of every product to its highest version (dropping it when there is none)."""
    for prod in manifest["code"].values():
        top = latest_of(prod["versions"])
        if top is None:
            prod["aliases"].pop("latest", None)
        else:
            prod["aliases"]["latest"] = top


# ── changes ───────────────────────────────────────────────────────────────────


def add_version(manifest: Manifest, version: str, tree_hash: str, published: str) -> bool:
    """List ``version`` as ``current`` and refresh ``aliases.latest``. ``False`` (nothing changed) when it is
    already listed with the same tree hash; a :class:`ManifestError` (exit 4) when it is listed with another,
    since an entry is never overwritten."""
    versions = versions_of(manifest)
    have = versions.get(version)
    if have is not None:
        if have["treeHash"] != tree_hash:
            raise ManifestError(f"{MANIFEST_KEY} lists {version} with tree hash {have['treeHash']}, but this is "
                                f"{tree_hash}. An entry is never replaced: if the published code is right, fix "
                                "the manifest by hand with care; if this is new code, publish it under the next "
                                "free -r<N>")
        return False
    versions[version] = {"treeHash": tree_hash, "status": "current", "published": published}
    refresh_latest(manifest)
    return True


def check_status_args(status: str, reason: Optional[str]) -> Optional[str]:
    """The reason, stripped, once ``status`` and ``reason`` agree; :class:`PublishError` (exit 2) otherwise."""
    if status not in STATUSES:
        raise PublishError(f"status {status!r} is not one of {', '.join(STATUSES)}")
    reason = reason.strip() if reason is not None else None
    if status == "withdrawn" and not reason:
        raise PublishError("withdrawn needs --reason TEXT: why the version is known bad")
    if status != "withdrawn" and reason:
        raise PublishError(f"--reason is only for withdrawn; {status} carries none")
    return reason


def set_status(manifest: Manifest, version: str, status: str, reason: Optional[str] = None) -> Tuple[dict, dict]:
    """Change ``version``'s status. Returns ``(before, after)`` entries (equal when it is a no-op). Raises
    :class:`PublishError` (exit 2) for a version that is not listed, an unknown status, ``withdrawn`` without
    a reason, or a reason on any other status."""
    reason = check_status_args(status, reason)
    versions = versions_of(manifest)
    if version not in versions:
        listed = ", ".join(sorted(versions, key=version_key)) or "none"
        raise PublishError(f"{version} is not in {MANIFEST_KEY} (listed: {listed}); a version is added by "
                           "`openghm code publish` or `openghm code manifest sync`")
    before = copy.deepcopy(versions[version])
    after = {"treeHash": before["treeHash"], "status": status, "published": before["published"]}
    if status == "withdrawn":
        after["reason"] = reason
    versions[version] = after
    return before, copy.deepcopy(after)


def describe(entry: dict) -> str:
    text = f"status={entry['status']}"
    if "reason" in entry:
        text += f" reason={json.dumps(entry['reason'], ensure_ascii=False)}"
    return text


# ── the bucket ────────────────────────────────────────────────────────────────


def read_manifest(anon: Anon) -> Optional[Manifest]:
    """The manifest the bucket serves, parsed strictly, or ``None`` when there is none. Raises
    :class:`ManifestError` (exit 4) for one that is not valid and :class:`PublishError` (exit 6) when it cannot
    be read."""
    try:
        if anon.head(MANIFEST_KEY) is None:
            return None
        data = anon.get(MANIFEST_KEY)
    except OpenghmError as e:
        raise PublishError(f"cannot read {MANIFEST_KEY}: {e}", EXIT_UPLOAD_FAILED)
    return parse(data)


def read_or_empty(anon: Anon) -> Tuple[Manifest, bool]:
    """``(manifest, existed)``: an absent manifest is the empty one."""
    m = read_manifest(anon)
    return (empty(), False) if m is None else (m, True)


def write_manifest(manifest: Manifest, client: S3Client, anon: Anon) -> bytes:
    """Write ``manifest`` public-read through ``client.put``, then read it back anonymously and compare.
    Returns the bytes written. Raises :class:`PublishError`: exit 6 when the put fails, exit 7 when what the
    bucket serves afterwards is not what was written."""
    data = serialise(manifest)
    with tempfile.TemporaryDirectory(prefix="openghm-wbm-manifest-") as tmp:
        path = pub._write(os.path.join(tmp, "manifest.json"), data)
        try:
            client.put(path, MANIFEST_KEY, hashlib.sha256(data).hexdigest())
        except S3Error as e:
            raise PublishError(f"{MANIFEST_KEY}: {e}", EXIT_UPLOAD_FAILED)
    try:
        served = anon.get(MANIFEST_KEY)
    except OpenghmError as e:
        raise PublishError(f"{MANIFEST_KEY} was written but cannot be read back anonymously: {e}",
                           EXIT_VERIFY_FAILED)
    if served != data:
        raise PublishError(f"{MANIFEST_KEY} was written, but what the bucket serves is not what was written "
                           "(another writer, or not public-read)", EXIT_VERIFY_FAILED)
    return data


def client_for(base_url: str, s3cfg: str, s3cmd: str) -> S3Client:
    """The ``s3cmd`` client for the bucket of ``base_url``. Raises :class:`PublishError` (exit 5)."""
    exe, cfg = pub.check_credentials(s3cfg, s3cmd)
    return pub.make_client(exe, cfg, pub.bucket_of(base_url))


def record(anon: Anon, client: Optional[S3Client], version: str, tree_hash: str, *, dry_run: bool,
           out: Callable[[str], None] = _echo) -> str:
    """The ``code publish`` step: list ``version`` as ``current`` unless it is already listed with this tree hash.
    Reads the manifest afresh, then writes (read-modify-write) unless ``dry_run``. Returns ``"added"`` or
    ``"unchanged"``; raises :class:`PublishError` (a conflict is exit 4)."""
    manifest, existed = read_or_empty(anon)
    date = today_utc()
    if not add_version(manifest, version, tree_hash, date):
        out(f"manifest: {MANIFEST_KEY} already lists {version}; unchanged")
        return "unchanged"
    shown = f"manifest: {version} -> current, published {date}; latest {manifest['code'][PRODUCT]['aliases']['latest']}"
    if dry_run:
        out(f"{shown} ({'created' if not existed else 'updated'} on a real run; dry run, nothing is written)")
        return "added"
    assert client is not None
    write_manifest(manifest, client, anon)
    out(f"{shown} ({MANIFEST_KEY} {'updated' if existed else 'created'})")
    return "added"


def check_record(anon: Anon, version: str, tree_hash: str) -> None:
    """Before a publish writes anything: would :func:`record` refuse? Raises :class:`PublishError` for a
    manifest that is not valid or lists ``version`` with another tree hash."""
    manifest, _ = read_or_empty(anon)
    add_version(manifest, version, tree_hash, today_utc())


# ── sync ──────────────────────────────────────────────────────────────────────


def _last_modified_date(header: Optional[str]) -> Optional[str]:
    if not header:
        return None
    try:
        when = email.utils.parsedate_to_datetime(header)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=_dt.timezone.utc)
    return when.astimezone(_dt.timezone.utc).date().isoformat()


@dataclass
class SyncResult:
    manifest: Manifest
    added: List[str] = field(default_factory=list)
    unchanged: int = 0
    changed: bool = False


def sync(base_url: str, anon: Anon, client: Optional[S3Client], *, dry_run: bool,
         out: Callable[[str], None] = _echo) -> SyncResult:
    """Build or refresh the manifest from the bucket: every ``wbm-code/wbm/<version>/`` with a ``TREEHASH`` that
    the manifest lacks is added as ``current``, published = the ``TREEHASH`` object's Last-Modified date (UTC).
    Existing entries are kept as they are. A listed version whose tree hash differs from the bucket's
    ``TREEHASH`` is an error (:class:`ManifestError`, exit 4) and nothing is written. Prefixes without a
    ``TREEHASH`` (unfinished) are not listed."""
    manifest, existed = read_or_empty(anon)
    versions = versions_of(manifest)
    try:
        folders = fetch.list_folders(base_url.rstrip("/"), PREFIX)
    except OpenghmError as e:
        raise PublishError(f"cannot list {PREFIX}: {e}", EXIT_UPLOAD_FAILED)
    result = SyncResult(manifest)
    problems: List[str] = []
    seen = set()
    for name in folders:
        key = f"{PREFIX}{name}/{TREEHASH_NAME}"
        if not _VERSION_OK_RE.match(name):
            out(f"skip    {PREFIX}{name}/: not a version string")
            continue
        try:
            info = anon.head(key)
            text = None if info is None else anon.get(key).decode("ascii", "replace").strip()
        except OpenghmError as e:
            raise PublishError(f"cannot read {key}: {e}", EXIT_UPLOAD_FAILED)
        if info is None:
            out(f"skip    {PREFIX}{name}/: no {TREEHASH_NAME} (an unfinished publish)")
            continue
        if not _HEX64_RE.match(text or ""):
            problems.append(f"{key} does not hold a tree hash")
            continue
        seen.add(name)
        have = versions.get(name)
        if have is None:
            date = _last_modified_date(getattr(info, "last_modified", None))
            if date is None:
                date = today_utc()
                out(f"note    {key} has no Last-Modified; using today's date")
            versions[name] = {"treeHash": text, "status": "current", "published": date}
            result.added.append(name)
            out(f"add     {name}  {text}  current  published {date}")
        elif have["treeHash"] != text:
            problems.append(f"{name}: the manifest says {have['treeHash']}, the bucket's {TREEHASH_NAME} says {text}")
        else:
            result.unchanged += 1
    for name in sorted(set(versions) - seen, key=version_key):
        out(f"warning: the manifest lists {name}, but {PREFIX}{name}/ has no finished tree in the bucket; "
            "the entry is kept")
    if problems:
        raise ManifestError("the manifest and the bucket disagree; nothing is written:\n" + pub._problems(problems))
    before_latest = manifest["code"][PRODUCT]["aliases"].get("latest")
    refresh_latest(manifest)
    result.changed = bool(result.added) or manifest["code"][PRODUCT]["aliases"].get("latest") != before_latest
    if not result.changed and existed:
        out(f"{MANIFEST_KEY} is up to date ({result.unchanged} version(s)); nothing is written")
        return result
    if not versions:
        out(f"no published WBM code versions under {PREFIX}; nothing is written")
        result.changed = False
        return result
    latest = manifest["code"][PRODUCT]["aliases"]["latest"]
    if dry_run:
        out(f"dry run: would {'update' if existed else 'create'} {MANIFEST_KEY}: {len(result.added)} added, "
            f"{result.unchanged} unchanged, latest {latest}; nothing is written")
        return result
    assert client is not None
    write_manifest(manifest, client, anon)
    out(f"{MANIFEST_KEY} {'updated' if existed else 'created'}: {len(result.added)} added, "
        f"{result.unchanged} unchanged, latest {latest}")
    return result


def set_status_command(anon: Anon, client: Optional[S3Client], version: str, status: str,
                       reason: Optional[str], *, dry_run: bool, out: Callable[[str], None] = _echo) -> bool:
    """``openghm code set-status``: change one entry, print before and after, write unless ``dry_run``.
    Returns whether anything changed."""
    reason = check_status_args(status, reason)
    manifest = read_manifest(anon)
    if manifest is None:
        raise PublishError(f"{MANIFEST_KEY} does not exist; create it with `openghm code manifest sync`")
    before, after = set_status(manifest, version, status, reason)
    out(f"version: {version}")
    out(f"before:  {describe(before)}")
    out(f"after:   {describe(after)}")
    if before == after:
        out("no change: the version already has this status")
        return False
    if dry_run:
        out("dry run: nothing is written")
        return True
    assert client is not None
    write_manifest(manifest, client, anon)
    out(f"{MANIFEST_KEY} updated")
    return True
