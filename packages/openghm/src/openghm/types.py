"""Shared, UI-agnostic types for the openghm core.

These dataclasses are the core's data contract: builders return a
:class:`BuiltCommand`, the CLI renders it, ``run`` executes it, and a future GUI
can consume it directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

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


@dataclass
class RunResult:
    """The outcome of running (or dry-running) a :class:`BuiltCommand`."""

    dry_run: bool
    argv: List[str]
    display: str
    exit_code: Optional[int] = None
    stdout: Optional[str] = None
    stderr: Optional[str] = None
