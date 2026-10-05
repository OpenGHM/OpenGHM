"""Module-level functions — the primary ``import openghm`` surface.

Each function loads config, builds the container command, and runs it (or
dry-runs if ``dry_run=True``).  They accept the same keyword arguments as the
underlying ``*Options`` dataclasses, plus three control kwargs:

- ``runtime`` — override the container runtime (``singularity`` / ``apptainer`` / ``docker``)
- ``sif``     — override the SIF path (or docker image name)
- ``config_path`` — path to a ``config.toml`` (default: ``~/.openghm/config.toml``)
- ``dry_run`` — build the command but do not execute it
- ``capture`` — capture stdout/stderr into :class:`~openghm.types.RunResult`
"""

from __future__ import annotations

from .config import load_config
from .network import NetworkOptions, build_network
from .run import run_command
from .runtime import RuntimeContext
from .sim import SubmitOptions, build_run, build_submit
from .spatial import SpatialOptions, build_spatial
from .temporal import TemporalOptions, build_temporal
from .types import RunResult


def _ctx(runtime, sif, config_path) -> RuntimeContext:
    return RuntimeContext.from_config(load_config(path=config_path).config, runtime=runtime, sif=sif)


def preclip(
    *,
    runtime: str | None = None,
    sif: str | None = None,
    config_path: str | None = None,
    dry_run: bool = False,
    capture: bool = False,
    **kwargs,
) -> RunResult:
    """Rectangular clip (networkTools job #1)."""
    ctx = _ctx(runtime, sif, config_path)
    return run_command(build_network("preclip", NetworkOptions(**kwargs), ctx), dry_run=dry_run, capture=capture)


def subset(
    *,
    runtime: str | None = None,
    sif: str | None = None,
    config_path: str | None = None,
    dry_run: bool = False,
    capture: bool = False,
    **kwargs,
) -> RunResult:
    """Basin / polygon subset (networkTools job #2)."""
    ctx = _ctx(runtime, sif, config_path)
    return run_command(build_network("subset", NetworkOptions(**kwargs), ctx), dry_run=dry_run, capture=capture)


def spatial(
    *,
    runtime: str | None = None,
    sif: str | None = None,
    config_path: str | None = None,
    dry_run: bool = False,
    capture: bool = False,
    **kwargs,
) -> RunResult:
    """Area-weighted spatial aggregation over a mask."""
    ctx = _ctx(runtime, sif, config_path)
    return run_command(build_spatial(SpatialOptions(**kwargs), ctx), dry_run=dry_run, capture=capture)


def temporal(
    *,
    runtime: str | None = None,
    sif: str | None = None,
    config_path: str | None = None,
    dry_run: bool = False,
    capture: bool = False,
    **kwargs,
) -> RunResult:
    """Temporal aggregation (e.g. monthly → yearly)."""
    ctx = _ctx(runtime, sif, config_path)
    return run_command(build_temporal(TemporalOptions(**kwargs), ctx), dry_run=dry_run, capture=capture)


def submit(
    *,
    runtime: str | None = None,
    sif: str | None = None,
    config_path: str | None = None,
    dry_run: bool = False,
    capture: bool = False,
    now: str | None = None,
    **kwargs,
) -> RunResult:
    """Submit a WBM model run to SLURM (reads ``<snapshot_dir>/metadata.json``)."""
    config = load_config(path=config_path).config
    _ctx_, built = build_submit(SubmitOptions(**kwargs), config, runtime=runtime, sif=sif, now=now)
    return run_command(built, dry_run=dry_run, capture=capture)


def run(
    *,
    runtime: str | None = None,
    sif: str | None = None,
    config_path: str | None = None,
    dry_run: bool = False,
    capture: bool = False,
    now: str | None = None,
    **kwargs,
) -> RunResult:
    """Run a WBM model locally in the foreground — no SLURM (reads ``metadata.json``).

    Same snapshot mechanism as :func:`submit`, but runs the container ``exec``
    synchronously on this machine. Records the exit code into the sim's
    ``simulation.json`` when actually run.
    """
    from .sim import record_exit_code  # local imports to keep module import light
    from .spool import run_cached

    config = load_config(path=config_path).config
    _ctx_, built = build_run(SubmitOptions(**kwargs), config, runtime=runtime, sif=sif, now=now)
    if built.spool and not dry_run:
        result = run_cached(built, capture=capture)     # fill + link, run, harvest on exit 0
    else:
        result = run_command(built, dry_run=dry_run, capture=capture)
    if not result.dry_run:
        record_exit_code(built, result.exit_code or 0)
    return result
