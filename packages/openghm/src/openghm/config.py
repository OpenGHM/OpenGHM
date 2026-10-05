"""Config: built-in Anvil defaults merged over ``~/.openghm/config.toml``.

The file is lazily created on first load if absent (no separate ``init`` step).
Unknown keys are ignored; an invalid ``runtime`` is rejected.

A plain dataclass (not pydantic) keeps the dependency set pure-Python, which
matters for a clean ``pip install`` on Anvil's older Spack toolchain — the config
is tiny enough that validation by hand is trivial.
"""

from __future__ import annotations

import dataclasses
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .errors import OpenghmError
from .types import RUNTIMES, SPOOL_PRUNE_HIGH, SPOOL_PRUNE_LOW

if sys.version_info >= (3, 11):  # pragma: no cover - exercised by version
    import tomllib
else:  # Python 3.9 / 3.10 on Anvil → tomli backport
    import tomli as tomllib

#: Legacy Anvil shared-install layout. Kept as a fallback so an existing Anvil
#: deployment keeps working with no config file, even though the portable
#: defaults now point at a per-user cache (``sif_dir``). The path is
#: allocation-specific, so it is never hardcoded here — set
#: ``OPENGHM_ANVIL_LEGACY_WBM`` in the environment of a deployment that needs
#: it. Unset (the default for every other install), the fallback simply never
#: resolves, which is the correct behavior off that one shared install.
_ANVIL_APPS_WBM = os.environ.get("OPENGHM_ANVIL_LEGACY_WBM", "")


@dataclass(frozen=True)
class Config:
    """openghm configuration (portable defaults; Anvil legacy fallback in resolvers)."""

    #: Container runtime used to run the tools-lite image.
    runtime: str = "singularity"
    #: SIF path for singularity/apptainer (the tools-lite image). This is where
    #: ``openghm sif pull wbm-tools-lite`` puts the manifest's latest today; a
    #: test keeps it equal to that path.
    sif: str = "~/.openghm/sif/wbm-tools-lite/2026-05-31/wbm-tools-lite-2026-05-31.sif"
    #: Cache root for downloaded images (``openghm sif pull`` / ``openghm init``).
    sif_dir: str = "~/.openghm/sif"
    #: Cache root for model inputs (``openghm snapshot fetch`` / ``openghm model-input
    #: fetch``): each one is ``<model_input_dir>/<id>/``, shared by every snapshot
    #: that links it.
    model_input_dir: str = "~/.openghm/model-inputs"
    #: Cache root for spool files (``sim run`` / ``sim submit`` with ``--spool cache``):
    #: each variant is ``<spool_cache>/<model input id>/<network>/<variant>/``,
    #: shared by every run of that variant. Keep it on the filesystem of
    #: ``output_base``: a run's new files are moved into it by hard link.
    spool_cache: str = "~/.openghm/spools"
    #: The spool cache is pruned (least recently used years first, see
    #: :func:`openghm.spool.prune`) when the scratch file quota is this fraction used
    #: or more, down to ``spool_prune_low``.
    spool_prune_high: float = SPOOL_PRUNE_HIGH
    spool_prune_low: float = SPOOL_PRUNE_LOW
    #: Image ref for the docker runtime (local builds).
    docker_image: str = "wbm-lite:latest"

    # Used by `sim submit` / `sim run` (SLURM defaults + per-sim work/output root).
    # A snapshot is addressed by folder path, so no snapshot_root registry is needed.
    # `account` has no default: it names a specific allocation, and no allocation
    # is correct for a stranger's install. `openghm init` prompts for it; without
    # one set, `sim submit`/`sim run` pass an empty --account and SLURM itself
    # rejects the job with a clear error, rather than silently billing someone
    # else's allocation.
    output_base: str = "~/.openghm/runs"
    account: str = ""
    partition: str = "shared"

    @classmethod
    def from_dict(cls, raw: dict) -> "Config":
        """Build from a parsed-TOML dict, ignoring unknown keys (like zod strip)."""
        valid = {f.name for f in dataclasses.fields(cls)}
        kwargs = {k: v for k, v in raw.items() if k in valid}
        config = cls(**kwargs)
        if config.runtime not in RUNTIMES:
            raise OpenghmError(
                f"invalid runtime in config: {config.runtime!r} "
                f"(expected one of {', '.join(RUNTIMES)})"
            )
        return config

    def resolve_sif(self) -> str:
        """Absolute path to the tools-lite SIF.

        Expands ``~`` in the configured path; if that file is absent but the
        legacy Anvil shared install exists, use that instead (so Anvil keeps
        working without a config file).
        """
        cache = os.path.expanduser(self.sif)
        if not os.path.exists(cache) and _ANVIL_APPS_WBM:
            legacy = f"{_ANVIL_APPS_WBM}/lite/wbm_tools_lite.sif"
            if os.path.exists(legacy):
                return legacy
        return cache

    def image_path(self, image: str, version: str, filename: str) -> str:
        """Where the image ``<image>:<version>`` is cached: ``<sif_dir>/<image>/<version>/<filename>``.

        Used for every image — the tools image, and the model image a snapshot
        pins (``sim`` looks for it here; ``openghm sif pull`` and
        ``openghm snapshot fetch`` put it here).
        """
        return os.path.join(os.path.expanduser(self.sif_dir), image, version, filename)

    def model_input_path(self, model_input_id: str) -> str:
        """Where the model input ``<id>`` is cached: ``<model_input_dir>/<id>``.

        ``sim`` binds it at ``/wbm/data``; ``openghm snapshot fetch`` and
        ``openghm model-input fetch`` put it here.
        """
        return os.path.join(os.path.expanduser(self.model_input_dir), model_input_id)

    def resolve_spool_cache(self) -> str:
        """The spool cache root, with ``~`` expanded."""
        return os.path.expanduser(self.spool_cache)

    def resolve_output_base(self) -> str:
        """Per-sim work/output root, with ``~`` expanded."""
        return os.path.expanduser(self.output_base)


def default_config_path() -> Path:
    return Path.home() / ".openghm" / "config.toml"


def _render_default_toml(c: Config) -> str:
    """TOML written on first run (or by ``openghm init``); comments document each key."""
    return "\n".join(
        [
            "# openghm config. Edit here or re-run `openghm init` to change it.",
            "",
            f'runtime       = "{c.runtime}"   # singularity | apptainer | docker',
            f'sif           = "{c.sif}"   # tools-lite image (network/spatial/temporal)',
            f'sif_dir       = "{c.sif_dir}"   # cache root for downloaded images',
            f'model_input_dir = "{c.model_input_dir}"   # cache root for downloaded model inputs',
            f'spool_cache  = "{c.spool_cache}"   # cache root for spool files shared by runs (same filesystem as output_base)',
            f'spool_prune_high = {c.spool_prune_high}   # prune the spool cache at this fraction of the scratch file quota used',
            f'spool_prune_low  = {c.spool_prune_low}   # ... down to this fraction (must be below spool_prune_high)',
            f'docker_image  = "{c.docker_image}"',
            "",
            "# sim submit / sim run defaults (per-sim work/output root + SLURM):",
            f'output_base   = "{c.output_base}"',
            f'account       = "{c.account}"',
            f'partition     = "{c.partition}"',
            "",
        ]
    )


@dataclass
class LoadedConfig:
    config: Config
    path: str
    #: Whether the file was just created.
    created: bool


def load_config(path: Optional[str] = None, *, create: bool = True) -> LoadedConfig:
    """Load config from ``path`` (or ``~/.openghm/config.toml``).

    If the file is absent and ``create`` is true, it is written with the Anvil
    defaults. A read-only filesystem falls back to in-memory defaults silently.
    """
    p = Path(path) if path else default_config_path()

    if p.exists():
        with open(p, "rb") as fh:
            raw = tomllib.load(fh)
        return LoadedConfig(config=Config.from_dict(raw), path=str(p), created=False)

    config = Config()
    created = False
    if create:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(_render_default_toml(config), encoding="utf-8")
            created = True
        except OSError:
            # Read-only FS or perms — fall back to in-memory defaults silently.
            pass
    return LoadedConfig(config=config, path=str(p), created=created)
