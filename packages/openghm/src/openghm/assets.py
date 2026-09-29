"""Container image acquisition — manifest lookup + resumable download + checksum.

``pip install openghm`` never fetches an image. Downloads happen only here,
driven by ``openghm sif pull``, the ``openghm init`` wizard, or
``openghm snapshot fetch`` (which downloads the image a snapshot pins), and only
after the user asks (the images are hundreds of MB).

Images live in the existing S3 bucket
(``s3.anvil.rcac.purdue.edu/openghm/containers``). ``manifest.json`` in that
bucket describes what is published::

    {"manifestVersion": 1,
     "images": {"<image>": {"aliases": {"latest": "<version>"},
                            "versions": {"<version>": {"key", "size", "sha256",
                                                       "status", "oras"}}}}}

An image is named ``<image>:<version>``. The bucket holds it at
``<key>``; it is cached at ``<sif_dir>/<image>/<version>/<filename>``. If the
manifest cannot be fetched we fall back to :data:`BUILTIN_MANIFEST`, a copy of it.
"""

from __future__ import annotations

import hashlib
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from .errors import OpenghmError

#: Base URL of the bucket (no trailing slash); manifest ``key``s are relative to it.
BUCKET_BASE = "https://s3.anvil.rcac.purdue.edu/openghm"
MANIFEST_URL = f"{BUCKET_BASE}/containers/manifest.json"

#: The image behind ``config.sif`` (network / spatial / temporal tools).
TOOLS_IMAGE = "wbm-tools-lite"

#: Selectors from before the manifest named images by ``<image>:<version>``.
LEGACY_SELECTORS: Dict[str, str] = {
    "lite": f"{TOOLS_IMAGE}:latest",
    "1.0.0": "wbm-v1-lite:1.0.0",
    "2.0.0": "wbm-v2-lite:2.0.0",
}


@dataclass(frozen=True)
class ImageSpec:
    """One downloadable container image, one version of it."""

    image: str               #: image name, e.g. "wbm-v2-lite"
    version: str             #: e.g. "2.0.0" (tools-lite is dated: "2026-05-31")
    filename: str            #: file name in the bucket / on disk
    object_key: Optional[str] = None  #: bucket key, relative to BUCKET_BASE
    size: Optional[int] = None       #: bytes, if known
    sha256: Optional[str] = None     #: hex digest of the file, if known
    oras: Optional[str] = None       #: the same image in the OCI registry, if any
    aliases: Tuple[str, ...] = ()    #: manifest aliases pointing at this version
    url: Optional[str] = None        #: explicit URL (defaults to BUCKET_BASE/object_key)

    @property
    def key(self) -> str:
        """The image's name, ``<image>:<version>``."""
        return f"{self.image}:{self.version}"

    def download_url(self) -> str:
        return self.url or f"{BUCKET_BASE}/{self.object_key}"

    def human_size(self) -> str:
        return human_bytes(self.size) if self.size is not None else "unknown size"


def _spec(image: str, version: str, size: int, sha256: str, oras: str, *,
          latest: bool = True) -> ImageSpec:
    filename = f"{image}-{version}.sif"
    return ImageSpec(image, version, filename, f"containers/{image}/{version}/{filename}",
                     size, sha256, oras, ("latest",) if latest else ())


#: Copy of the published ``containers/manifest.json`` (the fallback when it cannot
#: be fetched). ``tests/fixtures/containers-manifest.json`` is the recorded original;
#: a test keeps the two equal.
BUILTIN_MANIFEST: Dict[str, ImageSpec] = {
    s.key: s for s in (
        _spec("wbm-v1-lite", "1.0.0", 328_179_712,
              "404a5d6f3b7209441b2680b45f2f117b32ba300ab138ce2a76debe44d706294d",
              "oras://registry.openghm.org/openghm/wbm-v1-lite@sha256:"
              "9ed50f847705272cafb2ce4bc7d3538dff12ce36fb4b8fe45617bc84a95be15f"),
        _spec("wbm-v2-lite", "2.0.0", 335_466_496,
              "4ef9e35b3c15f08721a165cccb15266ab812f5fa51e0266d36061e9a77f222ea",
              "oras://registry.openghm.org/openghm/wbm-v2-lite@sha256:"
              "a9fc0281ed4010fcb89c788edcd53639cfc4fe76e5bc6b245d8c407d7cc76f43"),
        _spec("wbm-tools-lite", "2026-05-31", 309_235_712,
              "409eb15bcb9f3c637853f340c202f384fc97dc2e65c2ebc58632b292adc723a8",
              "oras://registry.openghm.org/openghm/wbm-tools-lite@sha256:"
              "419b002d7323e89c9a0392161ef67a33d90aab84e35341f915a8ce777e24eb5f"),
    )
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


def parse_manifest(raw: dict) -> Dict[str, ImageSpec]:
    """Parse a published ``manifest.json`` into specs keyed ``<image>:<version>``.

    Raises ``ValueError`` when ``raw`` is not a manifest this reader understands.
    """
    if raw.get("manifestVersion") != 1 or not isinstance(raw.get("images"), dict):
        raise ValueError("not a manifestVersion 1 manifest")
    out: Dict[str, ImageSpec] = {}
    for image, entry in raw["images"].items():
        aliases = entry.get("aliases") or {}
        for version, v in (entry.get("versions") or {}).items():
            object_key = v["key"]
            spec = ImageSpec(
                image=image,
                version=version,
                filename=object_key.rsplit("/", 1)[-1],
                object_key=object_key,
                size=v.get("size"),
                sha256=v.get("sha256"),
                oras=v.get("oras"),
                aliases=tuple(sorted(a for a, target in aliases.items() if target == version)),
            )
            out[spec.key] = spec
    return out


def load_manifest(*, timeout: float = 10.0) -> Dict[str, ImageSpec]:
    """Fetch ``containers/manifest.json``; fall back to :data:`BUILTIN_MANIFEST`.

    Returns specs keyed ``<image>:<version>``. Any network or parse failure is
    non-fatal — we just use the built-in copy.
    """
    try:
        with urllib.request.urlopen(MANIFEST_URL, timeout=timeout) as resp:  # noqa: S310
            out = parse_manifest(json.loads(resp.read().decode("utf-8")))
    except (urllib.error.URLError, OSError, ValueError, KeyError, AttributeError):
        return dict(BUILTIN_MANIFEST)
    return out or dict(BUILTIN_MANIFEST)


def resolve_spec(selector: str, manifest: Optional[Dict[str, ImageSpec]] = None) -> ImageSpec:
    """Look up an image by selector.

    ``<image>:<version>`` names one image exactly. ``<image>`` and
    ``<image>:<alias>`` (``latest``) follow the manifest's alias. The selectors
    from before the manifest was rewritten (:data:`LEGACY_SELECTORS`) still work.
    """
    manifest = manifest if manifest is not None else load_manifest()
    selector = LEGACY_SELECTORS.get(selector, selector)
    spec = manifest.get(selector)
    if spec is None:
        image, _, tag = selector.partition(":")
        matches = [s for s in manifest.values()
                   if s.image == image and (tag or "latest") in s.aliases]
        spec = matches[0] if len(matches) == 1 else None
    if spec is None:
        avail = ", ".join(sorted(manifest)) or "(none)"
        raise OpenghmError(f"unknown image {selector!r} (available: {avail})")
    return spec


def spec_from_container(container: dict) -> ImageSpec:
    """The image a snapshot pins (``metadata.json`` ``uses.container``) as a spec.

    ``https`` is where it is downloaded from and ``digest`` (``sha256:<hex>``) is
    the sha256 of the file at that URL.
    """
    missing = [k for k in ("image", "version", "digest", "https") if not container.get(k)]
    if missing:
        raise OpenghmError(
            f"uses.container.{', uses.container.'.join(missing)} missing in metadata.json "
            "(run `openghm snapshot validate` on this folder)"
        )
    digest = str(container["digest"])
    if not digest.startswith("sha256:"):
        raise OpenghmError(f"uses.container.digest is not a sha256 digest: {digest!r}")
    https = str(container["https"])
    return ImageSpec(
        image=str(container["image"]),
        version=str(container["version"]),
        filename=https.rsplit("/", 1)[-1],
        sha256=digest[len("sha256:"):],
        oras=container.get("oras"),
        url=https,
    )


def cache_path(config, spec: ImageSpec) -> str:
    """Where ``spec`` is stored under the config's ``sif_dir`` cache."""
    return config.image_path(spec.image, spec.version, spec.filename)


def is_present(config, spec: ImageSpec) -> bool:
    return os.path.exists(cache_path(config, spec))


def sha256_file(path: str) -> str:
    """Hex sha256 of the file at ``path``."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _verify_checksum(path: str, sha256: str) -> None:
    got = sha256_file(path)
    if got != sha256:
        # A partial file that fails its checksum is not resumable.
        os.remove(path)
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
    if existing and spec.size is not None and existing >= spec.size:
        # A complete (or overlong) partial file: nothing to resume, and a Range
        # past the end would be refused. Verify it below or start over.
        if existing > spec.size:
            existing = 0
        else:
            return _finish(part, dest, spec.sha256)

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

    return _finish(part, dest, spec.sha256)


def _finish(part: str, dest: str, sha256: Optional[str]) -> str:
    if sha256:
        _verify_checksum(part, sha256)
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


def ensure_image(config, selector: str, *, console=None) -> str:
    """Return the local path to the image ``selector`` names, downloading it if absent."""
    spec = resolve_spec(selector)
    dest = cache_path(config, spec)
    if os.path.exists(dest):
        return dest
    return download(spec, dest, console=console)
