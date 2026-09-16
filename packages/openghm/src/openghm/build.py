"""Assemble a BuiltCommand from a runtime context, mounts, and the inner command."""

from __future__ import annotations

from typing import List, Optional

from .runtime import RuntimeContext, build_argv, display_command
from .types import BuiltCommand, GeneratedFile, Mount


def assemble(
    ctx: RuntimeContext,
    mounts: List[Mount],
    inner_cmd: List[str],
    generated_files: Optional[List[GeneratedFile]] = None,
) -> BuiltCommand:
    generated_files = generated_files or []
    argv = build_argv(ctx, mounts, inner_cmd)
    return BuiltCommand(
        argv=argv,
        mounts=mounts,
        inner_cmd=inner_cmd,
        generated_files=generated_files,
        display=display_command(argv),
    )
