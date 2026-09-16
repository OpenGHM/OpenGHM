"""Pluggable container runtime.

Translates ``(runtime, image, mounts, inner cmd)`` into the argv to spawn::

    singularity/apptainer:  <bin> exec -c -e -B h:c ... SIF  <cmd...>
    docker:                 docker run --rm -v h:c ... IMAGE <cmd...>
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional

from .config import Config
from .types import Mount, Runtime


@dataclass(frozen=True)
class RuntimeContext:
    runtime: str
    #: SIF path (singularity/apptainer) or image ref (docker).
    image: str

    @classmethod
    def from_config(
        cls,
        config: Config,
        *,
        runtime: Optional[str] = None,
        sif: Optional[str] = None,
    ) -> "RuntimeContext":
        rt = runtime or config.runtime
        image = sif or (config.docker_image if rt == "docker" else config.resolve_sif())
        return cls(runtime=rt, image=image)


def _bind_flag(rt: str) -> str:
    return "-v" if rt == "docker" else "-B"


def _bind_value(m: Mount) -> str:
    return f"{m.host}:{m.container}:ro" if m.readonly else f"{m.host}:{m.container}"


def build_argv(ctx: RuntimeContext, mounts: List[Mount], inner_cmd: List[str]) -> List[str]:
    """Build the full argv to spawn for a container invocation."""
    binds: List[str] = []
    for m in mounts:
        binds.append(_bind_flag(ctx.runtime))
        binds.append(_bind_value(m))
    if ctx.runtime == "docker":
        return ["docker", "run", "--rm", *binds, ctx.image, *inner_cmd]
    # singularity / apptainer: -c (contain) -e (cleanenv), matching wbm-tools.
    return [ctx.runtime, "exec", "-c", "-e", *binds, ctx.image, *inner_cmd]


# Mirrors the TS `shq` exactly (NOT shlex.quote — the safe-char set differs):
# quote unless the whole token matches this set.
_SHQ_SAFE = re.compile(r"^[A-Za-z0-9_./:=+-]+$")


def _shq(s: str) -> str:
    """Shell-quote a single argument for the dry-run display only."""
    if _SHQ_SAFE.match(s):
        return s
    return "'" + s.replace("'", "'\\''") + "'"


def display_command(argv: List[str]) -> str:
    return " ".join(_shq(a) for a in argv)
