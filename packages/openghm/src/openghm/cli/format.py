"""Reconstruct the equivalent non-interactive ``openghm`` command for the wizard.

This is the wizard's preview — it shows the user the command they could have
typed (and can save/replay), NOT the underlying ``singularity exec`` line.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional

from ..mounts import DataMountSpec

# Mirrors the TS `q` exactly (its safe-char set differs from `shq`).
_Q_SAFE = re.compile(r"^[A-Za-z0-9_.,:=+/@-]+$")


def _q(s: str) -> str:
    if _Q_SAFE.match(s):
        return s
    return "'" + s.replace("'", "'\\''") + "'"


@dataclass
class FlagToken:
    flag: str
    #: omitted (``None``) for boolean flags (rendered bare)
    value: Optional[str] = None


def format_openghm_command(
    command: str,
    mounts: List[DataMountSpec],
    work: Optional[str],
    tokens: List[FlagToken],
) -> str:
    parts: List[str] = [f"openghm {command}"]
    for m in mounts:
        parts.append(f"--mount {_q(m.name + '=' + m.dir)}")
    if work:
        parts.append(f"--work {_q(work)}")
    for t in tokens:
        parts.append(t.flag if t.value is None else f"{t.flag} {_q(t.value)}")
    return " \\\n  ".join(parts)
