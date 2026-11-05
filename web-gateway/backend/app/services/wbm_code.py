"""Which WBM code versions exist and what state each is in: the manifest of the
public bucket, `wbm-code/manifest.json` (ADR 0032), and the state of a snapshot's
own code against it.

The manifest lists every published code version under `code.wbm.versions` with a
status:

* `current`: a new snapshot draft may start from a snapshot on this code;
* `legacy`: snapshots on it keep working and stay visible, but no new draft
  starts from them;
* `withdrawn`: known bad (it carries a `reason`); nothing is submitted on it.

`code_state` says where one snapshot stands. The gateway reads the manifest over
the public bucket's HTTPS, as the backend has no S3 credentials, and keeps it in
the process for `CACHE_SECONDS`. A manifest that cannot be fetched or parsed is
*unreadable*: nothing is refused because of it (enforcement fails open, so a
network blip blocks no one) and every snapshot's state is `unknown`. A manifest
that cannot be read is logged and not retried for `RETRY_SECONDS`, so a page of
requests does not each wait on a dead network.

The parse is strict: a wrong shape, an unknown status, a bad hash or a `latest`
alias that names no listed version make the whole manifest unreadable, because a
half-understood list of statuses is worse than none. Keys it does not know are
left alone, so the toolkit can add to the file.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal, Mapping

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

Status = Literal["current", "legacy", "withdrawn"]
#: A snapshot's code against the manifest. `unlisted`: its version is not in the
#: manifest. `mismatch`: listed, but the snapshot's tree hash is not the listed
#: one. `unknown`: the manifest is unreadable or the snapshot names no code.
CodeState = Literal["current", "legacy", "withdrawn", "unlisted", "mismatch", "unknown"]

STATUSES: tuple[str, ...] = ("current", "legacy", "withdrawn")
MANIFEST_VERSION = 1
#: The code this module reads from the manifest, and the only `uses.modelCode.name` known.
CODE_NAME = "wbm"

CACHE_SECONDS = 60.0
RETRY_SECONDS = 15.0
_READ_TIMEOUT = 3.0
_HASH_RE = re.compile(r"^[0-9a-f]{64}$")


class ManifestInvalid(ValueError):
    """The manifest is not what `parse_manifest` accepts; the message says where."""


@dataclass(frozen=True)
class CodeVersion:
    version: str
    tree_hash: str
    status: Status
    published: str
    reason: str | None = None


@dataclass(frozen=True)
class Manifest:
    #: In the manifest's own order.
    versions: dict[str, CodeVersion]
    aliases: dict[str, str] = field(default_factory=dict)

    @property
    def current(self) -> list[str]:
        return [v.version for v in self.versions.values() if v.status == "current"]

    @property
    def latest(self) -> str | None:
        return self.aliases.get("latest")


# ---- parsing ---------------------------------------------------------------


def _mapping(value: Any, where: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ManifestInvalid(f"{where} must be an object")
    return value


def _text(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value:
        raise ManifestInvalid(f"{where} must be a non-empty string")
    return value


def parse_manifest(data: Any) -> Manifest:
    """The manifest in `data` (decoded JSON), or `ManifestInvalid`."""
    top = _mapping(data, "the manifest")
    # `True == 1` in Python, and a bool is not a version number.
    if type(top.get("manifestVersion")) is not int or top["manifestVersion"] != MANIFEST_VERSION:
        raise ManifestInvalid(f"manifestVersion must be {MANIFEST_VERSION}")
    code = _mapping(top.get("code"), "code")
    wbm = _mapping(code.get(CODE_NAME), f"code.{CODE_NAME}")
    raw_versions = _mapping(wbm.get("versions"), f"code.{CODE_NAME}.versions")
    raw_aliases = _mapping(wbm.get("aliases", {}), f"code.{CODE_NAME}.aliases")

    versions: dict[str, CodeVersion] = {}
    for name, entry in raw_versions.items():
        where = f"versions.{name}"
        _text(name, "a version name")
        item = _mapping(entry, where)
        tree_hash = item.get("treeHash")
        if not isinstance(tree_hash, str) or not _HASH_RE.fullmatch(tree_hash):
            raise ManifestInvalid(f"{where}.treeHash must be 64 lowercase hex digits")
        status = item.get("status")
        if status not in STATUSES:
            raise ManifestInvalid(f"{where}.status must be one of {', '.join(STATUSES)}")
        published = _text(item.get("published"), f"{where}.published")
        try:
            date.fromisoformat(published)
        except ValueError:
            raise ManifestInvalid(f"{where}.published must be a date (YYYY-MM-DD)") from None
        reason = item.get("reason")
        if reason is not None:
            reason = _text(reason, f"{where}.reason")
        versions[name] = CodeVersion(name, tree_hash, status, published, reason)

    aliases: dict[str, str] = {}
    for alias, target in raw_aliases.items():
        _text(alias, "an alias name")
        if not isinstance(target, str) or target not in versions:
            raise ManifestInvalid(f"aliases.{alias} must name a listed version")
        aliases[alias] = target
    return Manifest(versions=versions, aliases=aliases)


# ---- a snapshot's state ----------------------------------------------------


def _field(code: Any, name: str) -> Any:
    return code.get(name) if isinstance(code, Mapping) else getattr(code, name, None)


def code_state(uses_model_code: Any, manifest: Manifest | None) -> CodeState:
    """Where a snapshot's `uses.modelCode` (a mapping or the generated model, or
    None) stands against `manifest` (None: unreadable). Pure.

    `unknown` when the manifest is unreadable or the snapshot names no code;
    `unlisted` when its version is not in the manifest; `mismatch` when it is
    but the snapshot's tree hash is another, whatever the status (the bytes are
    not the ones listed); otherwise the listed status."""
    if manifest is None or uses_model_code is None:
        return "unknown"
    name, version, tree_hash = (_field(uses_model_code, f) for f in ("name", "version", "treeHash"))
    if not isinstance(version, str) or not version:
        return "unknown"
    # Only `wbm` is listed; the schema allows no other name today.
    entry = manifest.versions.get(version) if name in (None, CODE_NAME) else None
    if entry is None:
        return "unlisted"
    if tree_hash != entry.tree_hash:
        return "mismatch"
    return entry.status


def state_of_document(document: Mapping[str, Any], manifest: Manifest | None) -> CodeState:
    """`code_state` of a snapshot's `metadata.json` document."""
    uses = document.get("uses") if isinstance(document, Mapping) else None
    return code_state(uses.get("modelCode") if isinstance(uses, Mapping) else None, manifest)


# ---- reading the manifest ---------------------------------------------------

#: (manifest or None, when it was read on the monotonic clock). Nothing before the first read.
_cached: tuple[Manifest | None, float] | None = None


def reset() -> None:
    """Forget what was read (tests)."""
    global _cached
    _cached = None


def _now() -> float:
    return time.monotonic()


def manifest_url() -> str:
    base = settings.S3_PUBLIC_BASE_URL.rstrip("/")
    return f"{base}/{settings.S3_BUCKET}/wbm-code/manifest.json"


async def _fetch(url: str) -> Any:
    """The manifest's decoded JSON."""
    async with httpx.AsyncClient(timeout=_READ_TIMEOUT, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()


async def get_manifest() -> Manifest | None:
    """The manifest, read at most every `CACHE_SECONDS`; None when it cannot be
    fetched or parsed (logged), which is cached for `RETRY_SECONDS`."""
    global _cached
    if _cached is not None:
        kept, read_at = _cached
        if _now() - read_at < (CACHE_SECONDS if kept is not None else RETRY_SECONDS):
            return kept
    url = manifest_url()
    manifest: Manifest | None
    try:
        manifest = parse_manifest(await _fetch(url))
    except ManifestInvalid as exc:
        logger.warning("The WBM code manifest at %s is not valid: %s", url, exc)
        manifest = None
    except Exception as exc:  # network, HTTP status, JSON: all mean "could not read"
        logger.warning("Could not read the WBM code manifest at %s: %s", url, exc)
        manifest = None
    _cached = (manifest, _now())
    return manifest


async def state_of(document: Mapping[str, Any]) -> tuple[CodeState, Manifest | None]:
    """A snapshot document's code state and the manifest it was judged against."""
    manifest = await get_manifest()
    return state_of_document(document, manifest), manifest
