"""``openghm snapshot fetch`` — download a published snapshot tree, ready to run.

Reads ``snapshots/<id>/`` from the public bucket with anonymous HTTPS (no
credentials, no S3 client): ListObjectsV2 for the keys, plain GETs for the
bytes. Stdlib only, so it runs on Anvil's python 3.9 with the rest of the package.

What is downloaded:

- everything under ``snapshots/<id>/`` **except** ``wbm_output/`` (a snapshot
  carries output it does not consume, ADR 0009; the fetched tree gets an empty
  one, which the layout requires) and ``WBM_run_state/`` (a new run starts its
  own);
- ``spool/`` only with ``spool="auto"`` and only if the snapshot has one;
- the container image the document pins (``uses.container.https``), into the
  ``sif_dir`` cache, unless ``image=False``.

How each file is checked:

- a file with a ``SHA256SUMS`` line: its sha256;
- a file without a line (spool files, by design, and ``SHA256SUMS`` itself): its
  MD5 against the ETag when the ETag is a plain MD5 (no ``-``, i.e. not
  multipart);
- every file: its size against the listing.

Each file is streamed to ``<rel>.part`` while hashing, checked, given its mode
from the ``x-amz-meta-s3cmd-attrs`` object header (ADR 0022; an object without
one is a failure, because guessing a mode is how ``wbm.pl`` stopped being
executable), and renamed into place. A file already at its final path with the
right size and hash is skipped, so an interrupted fetch resumes where it stopped.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

from . import assets
from .errors import OpenghmError

#: The bucket ``snapshots/<id>/`` lives in (no trailing slash). Tests point
#: :attr:`FetchOptions.base_url` at a local fixture instead.
S3_BASE = "https://s3.anvil.rcac.purdue.edu/openghm"

#: Top-level directories of a snapshot that are never fetched.
EXCLUDED_DIRS = ("wbm_output", "WBM_run_state")
SPOOL_DIR = "spool"
SPOOL_MODES = ("auto", "skip")

METADATA_NAME = "metadata.json"
SUMS_NAME = "SHA256SUMS"

_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_SUMS_LINE_RE = re.compile(r"^([0-9a-f]{64}) [ *](?:\./)?(.+)$")
_MODE_RE = re.compile(r"(?:^|/)mode:(\d+)(?:/|$)")
_ATTRS_HEADER = "x-amz-meta-s3cmd-attrs"

_CHUNK = 1024 * 1024
_TIMEOUT = 60
#: Attempts per object for a transient network error, and the pause between them.
_ATTEMPTS = 3
_BACKOFF = 1.0
#: How many failed paths ``format_failures`` prints before summarising the rest.
_MAX_LISTED = 50


@dataclass
class FetchOptions:
    """Inputs for ``snapshot fetch`` (see the CLI for flag names)."""

    snapshot_id: str
    #: Where the tree goes. Defaults to ``./<snapshot_id>``.
    dest: Optional[str] = None
    #: ``auto`` → fetch ``spool/`` if the snapshot has one; ``skip`` → never.
    spool: str = "auto"
    #: Fetch the pinned container image too.
    image: bool = True
    jobs: int = 8
    #: The bucket's URL; defaults to :data:`S3_BASE` (looked up at call time).
    base_url: Optional[str] = None


@dataclass
class _Item:
    """One object to fetch."""

    rel: str
    size: int
    etag: str
    sha256: Optional[str]      #: from SHA256SUMS; without one the ETag's MD5 is checked


@dataclass
class FetchResult:
    dest: str
    downloaded: int = 0
    skipped: int = 0
    bytes_downloaded: int = 0
    #: ``(path, reason)`` for everything that did not end up valid at its path.
    failed: List[Tuple[str, str]] = field(default_factory=list)
    #: ``fetched`` / ``absent`` (the snapshot has none) / ``skipped`` (``--spool skip``).
    spool: str = "skipped"
    spool_files: int = 0
    #: Absolute path of the pinned image, when it was requested and is valid.
    image_path: Optional[str] = None

    @property
    def ok(self) -> bool:
        return not self.failed


# ── listing ───────────────────────────────────────────────────────────────────


def _local(tag: str) -> str:
    """An XML tag without its namespace."""
    return tag.rsplit("}", 1)[-1]


class _TransientError(OpenghmError):
    """A network failure worth retrying (unreachable, or a 5xx)."""


def _open(url: str):
    try:
        return urllib.request.urlopen(url, timeout=_TIMEOUT)  # noqa: S310
    except urllib.error.HTTPError as e:
        cls = _TransientError if e.code >= 500 else OpenghmError
        raise cls(f"{url}: HTTP {e.code} {e.reason}")
    except urllib.error.URLError as e:
        raise _TransientError(f"cannot reach {url}: {e.reason}")


def list_objects(base_url: str, prefix: str) -> List[Tuple[str, int, str]]:
    """Every ``(key, size, etag)`` under ``prefix``, following pagination.

    Anonymous ``GET <base>?list-type=2``. ETags are returned unquoted.
    """
    out: List[Tuple[str, int, str]] = []
    token: Optional[str] = None
    while True:
        query = f"list-type=2&prefix={urllib.parse.quote(prefix, safe='/')}&max-keys=1000"
        if token:
            query += f"&continuation-token={urllib.parse.quote(token, safe='')}"
        url = f"{base_url}?{query}"
        try:
            with _open(url) as resp:
                root = ET.fromstring(resp.read())
        except (ET.ParseError, OSError, http.client.HTTPException) as e:
            raise OpenghmError(f"cannot read the listing at {url}: {e}")
        truncated, token = False, None
        for el in root:
            name = _local(el.tag)
            if name == "Contents":
                f = {_local(c.tag): (c.text or "") for c in el}
                out.append((f["Key"], int(f["Size"]), f.get("ETag", "").strip('"')))
            elif name == "IsTruncated":
                truncated = (el.text or "").strip().lower() == "true"
            elif name == "NextContinuationToken":
                token = el.text
        if not truncated:
            return out
        if not token:
            raise OpenghmError(f"the listing at {url} is truncated but has no continuation token")


def parse_sums(text: str) -> Dict[str, str]:
    """``SHA256SUMS`` (``<sha256>  ./<relpath>`` lines) → ``{relpath: sha256}``."""
    sums: Dict[str, str] = {}
    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        m = _SUMS_LINE_RE.match(line)
        if not m:
            raise OpenghmError(f"{SUMS_NAME} line {n} is not '<sha256>  ./<path>': {line!r}")
        sums[m.group(2)] = m.group(1)
    return sums


def select(rel: str, spool: str) -> Optional[str]:
    """Whether a snapshot-relative path is fetched: ``None`` if so, else why not."""
    top = rel.split("/", 1)[0]
    if top in EXCLUDED_DIRS:
        return f"{top}/ is not fetched"
    if top == SPOOL_DIR and spool != "auto":
        return "spool/ skipped"
    return None


def _safe_rel(rel: str) -> bool:
    parts = rel.split("/")
    return not rel.startswith("/") and "" not in parts and ".." not in parts and "." not in parts


# ── one object ────────────────────────────────────────────────────────────────


def _md5():
    return hashlib.md5(usedforsecurity=False)  # an integrity check against the ETag


def _mode_of(headers) -> int:
    attrs = headers.get(_ATTRS_HEADER)
    m = _MODE_RE.search(attrs or "")
    if not m:
        raise OpenghmError(
            f"no mode in the {_ATTRS_HEADER} header (ADR 0022): got {attrs!r}"
        )
    return int(m.group(1)) & 0o777   # never carry setuid/setgid/sticky from a bucket


def _md5_checkable(item: _Item) -> bool:
    """A file with no hash line is checked against a plain-MD5 ETag."""
    return not item.sha256 and bool(item.etag) and "-" not in item.etag


def _already_valid(final: str, item: _Item) -> bool:
    """True when ``final`` is present with the right size and hash / MD5."""
    try:
        if os.path.getsize(final) != item.size or not os.path.isfile(final):
            return False
        if item.sha256:
            return assets.sha256_file(final) == item.sha256
        if _md5_checkable(item):
            h = _md5()
            with open(final, "rb") as fh:
                for chunk in iter(lambda: fh.read(_CHUNK), b""):
                    h.update(chunk)
            return h.hexdigest() == item.etag
        return True
    except OSError:
        return False


def _download_once(url: str, final: str, item: _Item) -> None:
    part = final + ".part"
    os.makedirs(os.path.dirname(final), exist_ok=True)
    sha = hashlib.sha256() if item.sha256 else None
    md5 = _md5() if _md5_checkable(item) else None
    got = 0
    try:
        with _open(url) as resp:
            mode = _mode_of(resp.headers)
            with open(part, "wb") as fh:
                for chunk in iter(lambda: resp.read(_CHUNK), b""):
                    fh.write(chunk)
                    got += len(chunk)
                    if sha:
                        sha.update(chunk)
                    if md5:
                        md5.update(chunk)
        if got != item.size:
            raise OpenghmError(f"size {got}, the listing says {item.size}")
        if sha and sha.hexdigest() != item.sha256:
            raise OpenghmError(f"sha256 {sha.hexdigest()} does not match {SUMS_NAME} ({item.sha256})")
        if md5 and md5.hexdigest() != item.etag:
            raise OpenghmError(f"md5 {md5.hexdigest()} does not match the ETag ({item.etag})")
        os.chmod(part, mode)
        os.replace(part, final)
    except BaseException:
        try:
            os.remove(part)
        except OSError:
            pass
        raise


def _is_transient(e: BaseException) -> bool:
    return isinstance(e, (_TransientError, socket.timeout, ConnectionError, http.client.HTTPException))


def _fetch_item(base_url: str, prefix: str, dest: str, item: _Item) -> Tuple[str, int]:
    """Fetch (or skip) one object. Returns ``("downloaded" | "skipped", bytes)``.

    Raises on failure; a transient network error is retried.
    """
    final = os.path.join(dest, *item.rel.split("/"))
    if _already_valid(final, item):
        return "skipped", 0
    url = f"{base_url}/{urllib.parse.quote(prefix + item.rel, safe='/')}"
    for attempt in range(1, _ATTEMPTS + 1):
        try:
            _download_once(url, final, item)
            return "downloaded", item.size
        except (OpenghmError, OSError, http.client.HTTPException) as e:
            if attempt == _ATTEMPTS or not _is_transient(e):
                raise
            time.sleep(_BACKOFF * attempt)
    raise AssertionError("unreachable")  # pragma: no cover


# ── the whole snapshot ──────────────────────────────────────────────────────────


def fetch_snapshot(
    opts: FetchOptions,
    config,
    *,
    console=None,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> FetchResult:
    """Download snapshot ``opts.snapshot_id`` into ``opts.dest`` (see the module docstring).

    Raises :class:`OpenghmError` for what stops the whole fetch (an unknown id, no
    ``SHA256SUMS``, a bad ``metadata.json``); per-file problems are collected in
    :attr:`FetchResult.failed` so one bad object does not hide the others.
    ``on_progress(done, total)`` is called as files complete.
    """
    if not _ID_RE.match(opts.snapshot_id):
        raise OpenghmError(f"not a snapshot id: {opts.snapshot_id!r}")
    if opts.spool not in SPOOL_MODES:
        raise OpenghmError(f"--spool must be one of {', '.join(SPOOL_MODES)} (got {opts.spool!r})")
    base = (opts.base_url or S3_BASE).rstrip("/")
    prefix = f"snapshots/{opts.snapshot_id}/"
    dest = os.path.abspath(opts.dest or opts.snapshot_id)
    result = FetchResult(dest=dest)

    listing = list_objects(base, prefix)
    if not listing:
        raise OpenghmError(f"nothing under {prefix} in {base} (is the snapshot id right?)")

    # What is on offer, by snapshot-relative path.
    on_offer: Dict[str, Tuple[int, str]] = {}
    for key, size, etag in listing:
        rel = key[len(prefix):]
        if not rel or rel.endswith("/"):
            continue          # a directory placeholder
        if not _safe_rel(rel):
            result.failed.append((rel, "unsafe path in the listing"))
            continue
        on_offer[rel] = (size, etag)
    for name in (METADATA_NAME, SUMS_NAME):
        if name not in on_offer:
            raise OpenghmError(f"{prefix}{name} is not in the bucket; this is not a snapshot")

    spool_present = any(r.split("/", 1)[0] == SPOOL_DIR for r in on_offer)
    result.spool = ("skipped" if opts.spool == "skip" else "fetched" if spool_present else "absent")

    # SHA256SUMS first, then metadata.json (which it may list): everything else
    # is checked against them.
    def head(name: str, sha256: Optional[str]) -> None:
        size, etag = on_offer[name]
        outcome, n = _fetch_item(base, prefix, dest, _Item(name, size, etag, sha256))
        _count(result, outcome, n)

    head(SUMS_NAME, None)
    with open(os.path.join(dest, SUMS_NAME), "r", encoding="utf-8") as fh:
        sums = parse_sums(fh.read())
    head(METADATA_NAME, sums.get(METADATA_NAME))
    try:
        with open(os.path.join(dest, METADATA_NAME), "r", encoding="utf-8") as fh:
            container = (json.load(fh).get("uses") or {}).get("container") or {}
    except (OSError, ValueError) as e:
        raise OpenghmError(f"cannot read {METADATA_NAME}: {e}")
    image_spec = assets.spec_from_container(container) if opts.image else None

    # What to fetch, and what the document and the bucket disagree about.
    items: List[_Item] = []
    for rel, sha256 in sums.items():
        if select(rel, opts.spool) is None and rel not in on_offer:
            result.failed.append((rel, f"listed in {SUMS_NAME} but not in the bucket"))
    for rel, (size, etag) in sorted(on_offer.items()):
        if rel in (METADATA_NAME, SUMS_NAME) or select(rel, opts.spool) is not None:
            continue
        sha256 = sums.get(rel)
        if sha256 is None and rel.split("/", 1)[0] != SPOOL_DIR:
            result.failed.append((rel, f"in the bucket but has no {SUMS_NAME} line"))
            continue
        items.append(_Item(rel, size, etag, sha256))
    result.spool_files = sum(1 for i in items if i.rel.split("/", 1)[0] == SPOOL_DIR)

    done = 0
    with ThreadPoolExecutor(max_workers=max(1, opts.jobs)) as pool:
        futures = {pool.submit(_fetch_item, base, prefix, dest, i): i for i in items}
        for fut in as_completed(futures):
            item = futures[fut]
            try:
                outcome, n = fut.result()
                _count(result, outcome, n)
            except (OpenghmError, OSError, http.client.HTTPException) as e:
                result.failed.append((item.rel, str(e)))
            done += 1
            if on_progress:
                on_progress(done, len(items))

    # The layout requires wbm_output/, and its contents are not fetched: an
    # empty one keeps the tree valid (`openghm snapshot validate`) without
    # pretending to carry the published output.
    os.makedirs(os.path.join(dest, "wbm_output"), exist_ok=True)

    if image_spec is not None:
        _fetch_image(image_spec, config, result, console)

    result.failed.sort()
    return result


def _count(result: FetchResult, outcome: str, n: int) -> None:
    if outcome == "downloaded":
        result.downloaded += 1
        result.bytes_downloaded += n
    else:
        result.skipped += 1


def _fetch_image(spec: assets.ImageSpec, config, result: FetchResult, console) -> None:
    """The pinned image into the ``sif_dir`` cache, checked against ``digest``."""
    path = assets.cache_path(config, spec)
    label = f"image {spec.key}"
    try:
        if os.path.isfile(path) and assets.sha256_file(path) == spec.sha256:
            result.skipped += 1
        else:
            assets.download(spec, path, console=console)   # resumes; checks the digest
            result.downloaded += 1
            result.bytes_downloaded += os.path.getsize(path)
    except (OpenghmError, OSError) as e:
        result.failed.append((label, str(e)))
        return
    result.image_path = path


def summary_line(result: FetchResult) -> str:
    """``downloaded N, skipped M, failed K (X downloaded)``."""
    return (f"downloaded {result.downloaded}, skipped {result.skipped}, "
            f"failed {len(result.failed)} ({assets.human_bytes(result.bytes_downloaded)} downloaded)")


def format_failures(result: FetchResult) -> List[str]:
    """One line per failed path (the first ``_MAX_LISTED``)."""
    lines = [f"  {path}: {reason}" for path, reason in result.failed[:_MAX_LISTED]]
    if len(result.failed) > _MAX_LISTED:
        lines.append(f"  ... and {len(result.failed) - _MAX_LISTED} more")
    return lines
