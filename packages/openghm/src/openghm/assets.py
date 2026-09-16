"""Container image acquisition — manifest lookup + resumable download + checksum.

``pip install openghm`` never fetches an image. Downloads happen only here,
driven by ``openghm sif pull`` or the ``openghm init`` wizard, and only after the
user confirms (the images are hundreds of MB to ~2 GB).

Images live in the existing S3 bucket
(``s3.anvil.rcac.purdue.edu/openghm/containers``). A small ``manifest.json`` in
that bucket describes what is available (filename / size / checksum); if it is
absent we fall back to :data:`BUILTIN_MANIFEST` so sizes can still be shown.
"""

from __future__ import annotations

import hashlib
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Dict, Optional

from .errors import OpenghmError

#: Base URL of the container bucket (no trailing slash).
BUCKET_BASE = "https://s3.anvil.rcac.purdue.edu/openghm/containers"
MANIFEST_URL = f"{BUCKET_BASE}/manifest.json"


@dataclass(frozen=True)
class ImageSpec:
    """One downloadable container image."""

    key: str                 #: user-facing selector: "lite", "1.0.0", "2.0.0"
    filename: str            #: file name in the bucket / on disk
    kind: str                #: "lite" (tools) or "wbm" (versioned model)
    size: Optional[int] = None       #: bytes, if known
    sha256: Optional[str] = None     #: hex digest, if known
    url: Optional[str] = None        #: explicit URL (defaults to BUCKET_BASE/filename)

    def download_url(self) -> str:
        return self.url or f"{BUCKET_BASE}/{self.filename}"

    def human_size(self) -> str:
        return human_bytes(self.size) if self.size is not None else "unknown size"


#: Known images (fallback when the bucket has no manifest.json). Sizes are the
#: measured byte counts from dev/openghm_portable_install_plan.md.
BUILTIN_MANIFEST: Dict[str, ImageSpec] = {
    "lite": ImageSpec("lite", "wbm_tools_lite.sif", "lite", size=317 * 1024 * 1024),
    "1.0.0": ImageSpec("1.0.0", "wbm_opensource_v1.0.0.sif", "wbm", size=539_910_144),
    "2.0.0": ImageSpec("2.0.0", "wbm_opensource_v2.0.0.sif", "wbm", size=1_944_821_760),
}


def human_bytes(n: Optional[int]) -> str:
    """Human-readable byte count, e.g. ``317 MB`` / ``1.9 GB``."""
    if n is None:
        return "unknown size"
    size = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            if unit in ("B", "KB"):
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}".replace(".0 ", " ")
        size /= 1024
    return f"{n} B"


def load_manifest(*, timeout: float = 10.0) -> Dict[str, ImageSpec]:
    """Fetch ``manifest.json`` from the bucket; fall back to :data:`BUILTIN_MANIFEST`.

    A manifest maps ``key -> {filename, kind, size, sha256, url}``. Any network or
    parse failure is non-fatal — we just use the built-in table.
    """
    try:
        with urllib.request.urlopen(MANIFEST_URL, timeout=timeout) as resp:  # noqa: S310
            raw = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return dict(BUILTIN_MANIFEST)
    out: Dict[str, ImageSpec] = {}
    for key, v in (raw.get("images") or raw).items():
        if not isinstance(v, dict):
            continue
        out[key] = ImageSpec(
            key=key,
            filename=v.get("filename", f"wbm_opensource_v{key}.sif"),
            kind=v.get("kind", "wbm"),
            size=v.get("size"),
            sha256=v.get("sha256"),
            url=v.get("url"),
        )
    return out or dict(BUILTIN_MANIFEST)


def resolve_spec(key: str, manifest: Optional[Dict[str, ImageSpec]] = None) -> ImageSpec:
    """Look up an image by key ("lite" / a version like "2.0.0")."""
    manifest = manifest if manifest is not None else load_manifest()
    spec = manifest.get(key)
    if spec is None:
        avail = ", ".join(sorted(manifest)) or "(none)"
        raise OpenghmError(f"unknown image {key!r} (available: {avail})")
    return spec


def cache_path(config, spec: ImageSpec) -> str:
    """Where ``spec`` is stored under the config's ``sif_dir`` cache."""
    base = os.path.expanduser(config.sif_dir)
    if spec.kind == "lite":
        return os.path.join(base, "lite", spec.filename)
    return os.path.join(base, "wbm", spec.key, spec.filename)


def is_present(config, spec: ImageSpec) -> bool:
    return os.path.exists(cache_path(config, spec))


def _verify_checksum(path: str, sha256: str) -> None:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    got = h.hexdigest()
    if got != sha256:
        raise OpenghmError(
            f"checksum mismatch for {os.path.basename(path)}: expected {sha256}, got {got}"
        )


def download(spec: ImageSpec, dest: str, *, console=None, resume: bool = True) -> str:
    """Download ``spec`` to ``dest`` with a progress bar; resume a partial file.

    Uses an HTTP ``Range`` request to continue an interrupted download rather than
    restarting a multi-GB transfer. Verifies the SHA-256 afterward when the
    manifest provides one. Returns ``dest``.
    """
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    part = dest + ".part"
    existing = os.path.getsize(part) if (resume and os.path.exists(part)) else 0

    req = urllib.request.Request(spec.download_url())
    if existing:
        req.add_header("Range", f"bytes={existing}-")

    try:
        resp = urllib.request.urlopen(req, timeout=60)  # noqa: S310
    except urllib.error.HTTPError as e:
        if e.code == 403:
            raise OpenghmError(
                f"{spec.filename}: HTTP 403 (access denied). This image's bucket ACL "
                "may not allow anonymous download yet — contact the bucket owner."
            )
        raise OpenghmError(f"cannot download {spec.filename}: HTTP {e.code} {e.reason}")
    except urllib.error.URLError as e:
        raise OpenghmError(
            f"cannot reach {spec.download_url()}: {e.reason}. "
            "The S3 endpoint may be unreachable from outside the campus/Anvil network."
        )

    with resp:
        status = getattr(resp, "status", 200)
        # Server ignored our Range → start over from byte 0.
        if existing and status != 206:
            existing = 0
        length = resp.headers.get("Content-Length")
        remaining = int(length) if length is not None else None
        total = (spec.size if spec.size is not None
                 else (existing + remaining if remaining is not None else None))
        mode = "ab" if existing else "wb"

        progress = _make_progress(console)
        if progress is not None:
            with progress:
                task = progress.add_task(f"↓ {spec.filename}", total=total, completed=existing)
                with open(part, mode) as fh:
                    for chunk in iter(lambda: resp.read(1024 * 256), b""):
                        fh.write(chunk)
                        progress.update(task, advance=len(chunk))
        else:
            with open(part, mode) as fh:
                for chunk in iter(lambda: resp.read(1024 * 256), b""):
                    fh.write(chunk)

    if spec.sha256:
        _verify_checksum(part, spec.sha256)
    os.replace(part, dest)
    return dest


def _make_progress(console):
    """A rich download progress bar, or ``None`` if rich/console is unavailable."""
    if console is None:
        return None
    try:
        from rich.progress import (
            BarColumn, DownloadColumn, Progress, TextColumn, TimeRemainingColumn,
            TransferSpeedColumn,
        )
    except ImportError:  # pragma: no cover
        return None
    return Progress(
        TextColumn("[bold blue]{task.description}"),
        BarColumn(),
        DownloadColumn(),
        TransferSpeedColumn(),
        TimeRemainingColumn(),
        console=console,
    )


def ensure_image(config, key: str, *, console=None) -> str:
    """Return the local path to image ``key``, downloading it if absent."""
    spec = resolve_spec(key)
    dest = cache_path(config, spec)
    if os.path.exists(dest):
        return dest
    return download(spec, dest, console=console)
