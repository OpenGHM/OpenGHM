"""``openghm snapshot fetch`` / ``openghm model-input fetch`` — download a
published tree, ready to run.

Reads ``snapshots/<id>/`` or ``model-inputs/<id>/`` from the public bucket with
anonymous HTTPS (no credentials, no S3 client): ListObjectsV2 for the keys, plain
GETs for the bytes. Stdlib only, so it runs on Anvil's python 3.9 with the rest of
the package.

What a snapshot fetch downloads:

- everything under ``snapshots/<id>/`` **except** ``wbm_output/`` (a snapshot
  carries output it does not consume, ADR 0009; the fetched tree gets an empty
  one, which the layout requires), ``WBM_run_state/`` (a new run starts its
  own), ``data/`` and ``data_init/`` (the input lives in the model input, ADR
  0015, even where a published tree still carries a copy), and ``spool/`` (a spool
  belongs to the model input and runs share it through the spool cache; an old
  tree that still lists one is fetched without it);
- a check, once the tree is down: the WBM code in ``model/`` and ``utilities/`` must hash to the
  tree hash ``uses.modelCode.treeHash`` pins (ADR 0032). A mismatch is a failure, and the model
  input and the image are then not downloaded; a ``metadata.json`` that pins no code stops the
  fetch (exit 2, like a missing model input id);
- the model input the document links (``uses.modelInput.id``), into the
  ``model_input_dir`` cache, unless ``model_input=False``;
- the container image the document pins (``uses.container.https``), into the
  ``sif_dir`` cache, unless ``image=False``.

A model input fetch downloads all of ``model-inputs/<id>/``, checked the same way.

How each file is checked:

- a file with a ``SHA256SUMS`` line: its sha256;
- ``SHA256SUMS`` itself, which has no line: its
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

from . import assets, code as wbm_code
from .errors import OpenghmError

#: The bucket ``snapshots/<id>/`` lives in (no trailing slash). Tests point
#: :attr:`FetchOptions.base_url` at a local fixture instead.
S3_BASE = "https://s3.anvil.rcac.purdue.edu/openghm"

#: Top-level directories of a snapshot that are never fetched.
EXCLUDED_DIRS = ("wbm_output", "WBM_run_state", "data", "data_init", "spool")

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
    #: Fetch the pinned container image too.
    image: bool = True
    #: Fetch the linked model input too, into ``config.model_input_path(id)``.
    model_input: bool = True
    jobs: int = 8
    #: The bucket's URL; defaults to :data:`S3_BASE` (looked up at call time).
    base_url: Optional[str] = None


@dataclass
class ModelInputOptions:
    """Inputs for ``model-input fetch`` (see the CLI for flag names)."""

    model_input_id: str
    #: Where the tree goes. Defaults to ``config.model_input_path(model_input_id)``.
    dest: Optional[str] = None
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
    #: Absolute path of the pinned image, when it was requested and is valid.
    image_path: Optional[str] = None
    #: Absolute path of the linked model input, when it was requested and is valid.
    model_input_path: Optional[str] = None

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


def _list_page(url: str):
    """One listing page, parsed. A transient failure (unreachable, a 5xx, a dropped connection)
    is tried again up to :data:`_ATTEMPTS` times with :data:`_BACKOFF` between; a 4xx (a 403, a
    404) and an unparseable body are not."""
    for attempt in range(1, _ATTEMPTS + 1):
        try:
            with _open(url) as resp:
                return ET.fromstring(resp.read())
        except (OpenghmError, OSError, http.client.HTTPException) as e:
            if attempt == _ATTEMPTS or not _is_transient(e):
                raise
            time.sleep(_BACKOFF * attempt)
    raise AssertionError("unreachable")  # pragma: no cover


def list_objects(base_url: str, prefix: str, delimiter: Optional[str] = None) -> List[Tuple[str, int, str]]:
    """Every ``(key, size, etag)`` under ``prefix``, following pagination.

    Anonymous ``GET <base>?list-type=2``. ETags are returned unquoted. Each page is retried on a
    transient error (see :func:`_list_page`). With ``delimiter="/"`` only the objects directly
    under ``prefix`` are returned (the folders are :func:`list_folders`'s).
    """
    out: List[Tuple[str, int, str]] = []
    token: Optional[str] = None
    while True:
        query = f"list-type=2&prefix={urllib.parse.quote(prefix, safe='/')}&max-keys=1000"
        if delimiter:
            query += f"&delimiter={urllib.parse.quote(delimiter, safe='')}"
        if token:
            query += f"&continuation-token={urllib.parse.quote(token, safe='')}"
        url = f"{base_url}?{query}"
        try:
            root = _list_page(url)
        except OpenghmError:
            raise
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


def list_folders(base_url: str, prefix: str) -> List[str]:
    """The names of the immediate subfolders of ``prefix`` (a key ending in ``/``), sorted: the
    ``CommonPrefixes`` of an anonymous ``GET <base>?list-type=2&delimiter=/``, each with ``prefix``
    and the trailing ``/`` taken off. Follows pagination; each page is retried like
    :func:`list_objects`'s."""
    out: List[str] = []
    token: Optional[str] = None
    while True:
        query = f"list-type=2&prefix={urllib.parse.quote(prefix, safe='/')}&delimiter=/&max-keys=1000"
        if token:
            query += f"&continuation-token={urllib.parse.quote(token, safe='')}"
        url = f"{base_url}?{query}"
        try:
            root = _list_page(url)
        except OpenghmError:
            raise
        except (ET.ParseError, OSError, http.client.HTTPException) as e:
            raise OpenghmError(f"cannot read the listing at {url}: {e}")
        truncated, token = False, None
        for el in root:
            name = _local(el.tag)
            if name == "CommonPrefixes":
                for c in el:
                    if _local(c.tag) == "Prefix" and c.text:
                        out.append(c.text[len(prefix):].rstrip("/"))
            elif name == "IsTruncated":
                truncated = (el.text or "").strip().lower() == "true"
            elif name == "NextContinuationToken":
                token = el.text
        if not truncated:
            return sorted(out)
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


def select(rel: str, excluded: Tuple[str, ...] = EXCLUDED_DIRS) -> Optional[str]:
    """Whether a tree-relative path is fetched: ``None`` if so, else why not.

    ``excluded`` is :data:`EXCLUDED_DIRS` for a snapshot and ``()`` for a model
    input, where every top-level directory (``spool/`` included) is fetched.
    """
    top = rel.split("/", 1)[0]
    if top in excluded:
        return f"{top}/ is not fetched"
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


# ── a whole tree ────────────────────────────────────────────────────────────────


def _fetch_tree(
    base: str,
    prefix: str,
    dest: str,
    result: FetchResult,
    *,
    kind: str,
    excluded: Tuple[str, ...],
    jobs: int,
    on_progress: Optional[Callable[[int, int], None]],
) -> dict:
    """Download ``<prefix>*`` into ``dest``, checked against its ``SHA256SUMS``.

    Shared by snapshots and model inputs. Counts go into ``result``, per-file
    failures into ``result.failed``. Returns the parsed ``metadata.json``. Raises
    :class:`OpenghmError` for what stops the whole fetch: no objects under the
    prefix, no ``SHA256SUMS`` or ``metadata.json`` (``kind`` names what is not
    there), an unreadable ``metadata.json``.
    """
    listing = list_objects(base, prefix)
    if not listing:
        raise OpenghmError(f"nothing under {prefix} in {base} (is the {kind} id right?)")

    # What is on offer, by tree-relative path.
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
            raise OpenghmError(f"{prefix}{name} is not in the bucket; this is not a {kind}")

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
            meta = json.load(fh)
    except (OSError, ValueError) as e:
        raise OpenghmError(f"cannot read {METADATA_NAME}: {e}")
    if not isinstance(meta, dict):
        raise OpenghmError(f"{METADATA_NAME} is not a JSON object")

    # What to fetch, and what the document and the bucket disagree about.
    items: List[_Item] = []
    for rel, sha256 in sums.items():
        if select(rel, excluded) is None and rel not in on_offer:
            result.failed.append((rel, f"listed in {SUMS_NAME} but not in the bucket"))
    for rel, (size, etag) in sorted(on_offer.items()):
        if rel in (METADATA_NAME, SUMS_NAME) or select(rel, excluded) is not None:
            continue
        sha256 = sums.get(rel)
        if sha256 is None:
            result.failed.append((rel, f"in the bucket but has no {SUMS_NAME} line"))
            continue
        items.append(_Item(rel, size, etag, sha256))

    # A killed run leaves ``<rel>.part``. It is the fetch's own scratch, and where the file is skipped
    # as already valid nothing would replace it: a stray in model/ would then change the code's hash.
    for rel in on_offer:
        if select(rel, excluded) is None and rel + ".part" not in on_offer:
            try:
                os.remove(os.path.join(dest, *(rel + ".part").split("/")))
            except OSError:
                pass

    done = 0
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
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
    return meta


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
    base = (opts.base_url or S3_BASE).rstrip("/")
    prefix = f"snapshots/{opts.snapshot_id}/"
    dest = os.path.abspath(opts.dest or opts.snapshot_id)
    result = FetchResult(dest=dest)

    meta = _fetch_tree(base, prefix, dest, result, kind="snapshot", excluded=EXCLUDED_DIRS,
                       jobs=opts.jobs, on_progress=on_progress)
    pinned = _pinned_tree_hash(meta)
    if not _code_matches(dest, pinned, result):
        result.failed.sort()
        return result     # not this snapshot's code: the model input and the image are not downloaded
    uses = meta.get("uses") or {}
    image_spec = assets.spec_from_container(uses.get("container") or {}) if opts.image else None
    model_input_id = _model_input_id(meta) if opts.model_input else None

    # The layout requires wbm_output/, and its contents are not fetched: an
    # empty one keeps the tree valid (`openghm snapshot validate`) without
    # pretending to carry the published output.
    os.makedirs(os.path.join(dest, "wbm_output"), exist_ok=True)

    if model_input_id is not None:
        _fetch_linked_model_input(model_input_id, base, config, result, opts.jobs, on_progress)
    if image_spec is not None:
        _fetch_image(image_spec, config, result, console)

    result.failed.sort()
    return result


def fetch_model_input(
    opts: ModelInputOptions,
    config,
    *,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> FetchResult:
    """Download model input ``opts.model_input_id`` into ``opts.dest``.

    ``dest`` defaults to the ``model_input_dir`` cache, where ``sim`` looks for
    it. Errors and failures are reported as for :func:`fetch_snapshot`.
    """
    if not _ID_RE.match(opts.model_input_id):
        raise OpenghmError(f"not a model input id: {opts.model_input_id!r}")
    base = (opts.base_url or S3_BASE).rstrip("/")
    prefix = f"model-inputs/{opts.model_input_id}/"
    dest = os.path.abspath(opts.dest or config.model_input_path(opts.model_input_id))
    result = FetchResult(dest=dest)
    _fetch_tree(base, prefix, dest, result, kind="model input", excluded=(),
                jobs=opts.jobs, on_progress=on_progress)
    if not result.failed:
        result.model_input_path = dest
    result.failed.sort()
    return result


#: The label a failed code check is listed under (``format_failures``).
CODE_LABEL = "WBM code"


def _pinned_tree_hash(meta: dict) -> str:
    """``uses.modelCode.treeHash`` of a snapshot's ``metadata.json`` (ADR 0032)."""
    pinned = (((meta.get("uses") or {}).get("modelCode")) or {}).get("treeHash")
    if not pinned:
        raise OpenghmError(
            "uses.modelCode.treeHash is missing in metadata.json: this snapshot does not pin its WBM "
            "code, so what was downloaded cannot be checked (ADR 0032)"
        )
    if not isinstance(pinned, str) or not re.match(r"^[0-9a-f]{64}$", pinned):
        raise OpenghmError(f"uses.modelCode.treeHash is not a sha256 (64 lowercase hex): {pinned!r}")
    return pinned


def _code_matches(dest: str, pinned: str, result: FetchResult) -> bool:
    """Whether the downloaded ``model/`` and ``utilities/`` hash to ``pinned``; if not, a failure
    is added to ``result``.

    Not checked, and ``True``, when a code file already failed: that failure names it, and the
    hash of a tree with a hole in it says nothing more.
    """
    if any(wbm_code.counts(path) for path, _why in result.failed):
        return True
    try:
        actual = wbm_code.tree_hash(dest)
    except OpenghmError as e:
        result.failed.append((CODE_LABEL, str(e)))
        return False
    if actual != pinned:
        result.failed.append((CODE_LABEL, wbm_code.mismatch_message("the fetched tree", actual, pinned)))
        return False
    return True


def _model_input_id(meta: dict) -> str:
    """``uses.modelInput.id`` of a snapshot's ``metadata.json``."""
    mid = ((meta.get("uses") or {}).get("modelInput") or {}).get("id")
    if not mid:
        raise OpenghmError(
            "uses.modelInput.id is missing in metadata.json "
            "(run `openghm snapshot validate` on this folder, or pass --no-model-input)"
        )
    if not isinstance(mid, str) or not _ID_RE.match(mid):
        raise OpenghmError(f"uses.modelInput.id is not a model input id: {mid!r}")
    return mid


def _fetch_linked_model_input(
    model_input_id: str, base: str, config, result: FetchResult, jobs: int,
    on_progress: Optional[Callable[[int, int], None]],
) -> None:
    """The linked model input into the cache; its counts and failures join ``result``.

    A second snapshot that links the same input finds every file valid and skips
    them all, so a shared input downloads once.
    """
    sub = FetchResult(dest=config.model_input_path(model_input_id))
    try:
        _fetch_tree(base, f"model-inputs/{model_input_id}/", sub.dest, sub, kind="model input",
                    excluded=(), jobs=jobs, on_progress=on_progress)
    except OpenghmError as e:
        result.failed.append((f"model input {model_input_id}", str(e)))
        return
    result.downloaded += sub.downloaded
    result.skipped += sub.skipped
    result.bytes_downloaded += sub.bytes_downloaded
    result.failed.extend((f"model-inputs/{model_input_id}/{rel}", why) for rel, why in sub.failed)
    if not sub.failed:
        result.model_input_path = sub.dest


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
