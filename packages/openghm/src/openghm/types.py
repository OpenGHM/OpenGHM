"""Shared, UI-agnostic types for the openghm core.

These dataclasses are the core's data contract: builders return a
:class:`BuiltCommand`, the CLI renders it, ``run`` executes it, and a future GUI
can consume it directly.
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple

try:  # Python 3.8+: Literal is in typing
    from typing import Literal
except ImportError:  # pragma: no cover
    from typing_extensions import Literal  # type: ignore

#: A container runtime: one of ``"singularity"``, ``"apptainer"``, ``"docker"``.
Runtime = Literal["singularity", "apptainer", "docker"]

#: The valid runtime strings, for validation.
RUNTIMES = ("singularity", "apptainer", "docker")


@dataclass(frozen=True)
class Mount:
    """A single host→container bind mount."""

    host: str
    container: str
    #: Bind read-only (``:ro``). Off by default to match wbm-tools.
    readonly: bool = False


@dataclass(frozen=True)
class GeneratedFile:
    """A file the CLI generates (e.g. a networkTools ``.init``) and stages before running."""

    host_path: str
    content: str


@dataclass(frozen=True)
class DirCopy:
    """A directory to copy on the host before running (e.g. a per-sim ``wbm_init``)."""

    src: str
    dst: str


#: Where ``--spool cache`` binds the variant directory inside the container: a
#: nested bind under ``/wbm/spool``, whose mount point (``<workdir>/spool/.cache``)
#: ``stage_files`` creates, so it exists in the bound directory.
SPOOL_CACHE_BIND = "/wbm/spool/.cache"
#: The run's own symlink (``<workdir>/spool-cache``) to its variant directory, the
#: host side of that bind. The variant is known only once the init is evaluated,
#: after the argv is built, so ``spool prepare`` points this at it.
SPOOL_CACHE_LINK = "spool-cache"
#: The scratch file quota fraction at which the spool cache is pruned, and the fraction
#: pruning brings it down to (``spool_prune_high`` / ``spool_prune_low`` in the config).
SPOOL_PRUNE_HIGH = 0.80
SPOOL_PRUNE_LOW = 0.50


@dataclass
class SpoolPlan:
    """What a ``--spool cache`` run needs besides its container exec.

    Built with the command, stored in ``simulation.json`` (``spool_plan``) so
    ``openghm spool prepare|harvest <sim dir>`` can act from a SLURM job on a
    compute node, and consumed by :mod:`openghm.spool`.
    """

    sim_id: str
    #: ``<output_base>/<sim_id>``; its ``spool/`` is the run's own spool.
    workdir: str
    #: The snapshot folder: its ``SHA256SUMS`` names the model code.
    snapshot: str
    #: The generated init as the container sees it (``/wbm/wbm_init/<name>``).
    init_container: str
    runtime: str
    #: The image the run executes, and the digest the snapshot pins for it
    #: (``sha256:<hex>``; ``None`` for a ``--sif`` override, which is hashed).
    image: str
    image_digest: Optional[str]
    model_input_id: str
    model_input_path: str
    #: ``<spool_cache>`` with ``~`` expanded.
    cache_root: str
    #: The bucket the cache is filled from.
    s3_base: str
    #: ``(host, container)`` of the read-only binds an init is evaluated under.
    eval_mounts: List[Tuple[str, str]] = field(default_factory=list)
    #: The config's ``spool_prune_high`` / ``spool_prune_low`` when the plan was built:
    #: what ``spool prepare`` prunes the cache by on the compute node.
    prune_high: float = SPOOL_PRUNE_HIGH
    prune_low: float = SPOOL_PRUNE_LOW

    @property
    def init_host(self) -> str:
        return os.path.join(self.workdir, "wbm_init", os.path.basename(self.init_container))

    @property
    def run_spool(self) -> str:
        return os.path.join(self.workdir, "spool")

    @property
    def cache_link(self) -> str:
        return os.path.join(self.workdir, SPOOL_CACHE_LINK)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "SpoolPlan":
        kwargs = {k: v for k, v in raw.items() if k in cls.__dataclass_fields__}
        kwargs["eval_mounts"] = [tuple(m) for m in kwargs.get("eval_mounts", [])]
        return cls(**kwargs)


@dataclass(frozen=True)
class BuiltCommand:
    """The fully-resolved plan for one container invocation."""

    #: The container runtime binary + all args, ready to spawn.
    argv: List[str]
    mounts: List[Mount]
    #: The command run *inside* the container (script + its args), for display.
    inner_cmd: List[str]
    #: Files that must exist on the host before running (generated init, etc.).
    generated_files: List[GeneratedFile] = field(default_factory=list)
    #: Directories to create on the host before running (per-sim output dirs).
    staged_dirs: List[str] = field(default_factory=list)
    #: Directory copies to perform on the host before running (before generated_files,
    #: so a generated file overwrites its copied counterpart).
    staged_copies: List[DirCopy] = field(default_factory=list)
    #: Human-readable, shell-safe one-liner for ``--dry-run``.
    display: str = ""
    #: ``--spool cache``: what to fill and link before the run and harvest after.
    spool: Optional[SpoolPlan] = None


@dataclass
class RunResult:
    """The outcome of running (or dry-running) a :class:`BuiltCommand`."""

    dry_run: bool
    argv: List[str]
    display: str
    exit_code: Optional[int] = None
    stdout: Optional[str] = None
    stderr: Optional[str] = None
