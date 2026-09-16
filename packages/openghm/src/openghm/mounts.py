"""Mount model. Mirrors the ``run/wbm-tools`` launcher convention exactly::

    data dirs  -> /data/<name>   (inputs)
    work dir   -> /work          (generated init, MT, outputs)

Host paths the user supplies are translated to these container paths. A path
that is already container-absolute (starts with ``/data`` or ``/work``) is passed
through untouched — so power users can hand-author MTs/inits with container paths
and just declare the mounts.
"""

from __future__ import annotations

import os
import posixpath
import re
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Set, Union

from .errors import OpenghmError
from .types import Mount

_CONTAINER_PREFIXES = ("/data", "/work")


@dataclass(frozen=True)
class DataMountSpec:
    """An explicit ``--mount NAME=DIR`` data mount → ``/data/NAME``."""

    name: str
    dir: str


#: Accepted shapes for a `mounts` argument across the public API.
MountsArg = Union[None, Dict[str, str], Iterable[object]]


def normalize_mounts(mounts: MountsArg) -> List[DataMountSpec]:
    """Coerce a dict / list-of-specs / list-of-(name,dir) into ``[DataMountSpec]``."""
    if not mounts:
        return []
    if isinstance(mounts, dict):
        return [DataMountSpec(name, d) for name, d in mounts.items()]
    out: List[DataMountSpec] = []
    for m in mounts:
        if isinstance(m, DataMountSpec):
            out.append(m)
        elif isinstance(m, dict):
            out.append(DataMountSpec(m["name"], m["dir"]))
        elif isinstance(m, (tuple, list)) and len(m) == 2:
            out.append(DataMountSpec(m[0], m[1]))
        else:
            raise OpenghmError(f"invalid mount spec: {m!r} (use NAME=DIR / DataMountSpec)")
    return out


def is_container_path(p: str) -> bool:
    return any(p == c or p.startswith(c + "/") for c in _CONTAINER_PREFIXES)


def _sanitize(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", name) or "d"


class MountSet:
    """Translates host paths → container paths, auto-mounting under /data or /work."""

    def __init__(self) -> None:
        # host dir -> container dir (/data/<name>)
        self._data_dirs: Dict[str, str] = {}
        # container names in use, for dedup
        self._used_names: Set[str] = set()
        self._work_host: Optional[str] = None

    def set_work(self, host_dir: str) -> None:
        """Set the single /work mount (host dir)."""
        abs_dir = os.path.abspath(host_dir)
        if self._work_host is not None and self._work_host != abs_dir:
            raise OpenghmError(
                f"only one --work mount is supported (have {self._work_host}, got {abs_dir})"
            )
        self._work_host = abs_dir

    def has_work(self) -> bool:
        return self._work_host is not None

    def add_data_dir(self, name: str, host_dir: str) -> str:
        """Explicit ``--mount NAME=DIR`` → /data/<NAME>."""
        cname = _sanitize(name)
        container = posixpath.join("/data", cname)
        abs_dir = os.path.abspath(host_dir)
        self._data_dirs[abs_dir] = container
        self._used_names.add(cname)
        return container

    def resolve_input(self, p: str, preferred_name: str) -> str:
        """Translate an INPUT path to its container path, auto-mounting its dir.

        Container paths pass through unchanged.
        """
        if is_container_path(p):
            return p
        abs_path = os.path.abspath(p)
        directory = os.path.dirname(abs_path)
        container = self._data_dirs.get(directory)
        if not container:
            cname = _sanitize(preferred_name)
            i = 2
            while cname in self._used_names:
                cname = f"{_sanitize(preferred_name)}{i}"
                i += 1
            self._used_names.add(cname)
            container = posixpath.join("/data", cname)
            self._data_dirs[directory] = container
        return posixpath.join(container, os.path.basename(abs_path))

    def resolve_work(self, p: str) -> str:
        """Translate an OUTPUT/work path to a /work path.

        Sets the work mount from the path's dir when not already set. Container
        paths pass through unchanged.
        """
        if is_container_path(p):
            return p
        abs_path = os.path.abspath(p)
        if not self._work_host:
            self._work_host = os.path.dirname(abs_path)
        rel = os.path.relpath(abs_path, self._work_host)
        if rel.startswith("..") or rel.startswith("/"):
            raise OpenghmError(
                f"path {abs_path} is not under the --work dir {self._work_host}; "
                "pass --work explicitly or move the file under it"
            )
        return posixpath.join("/work", rel)

    def work_container(self) -> str:
        return "/work"

    def work_host_dir(self) -> Optional[str]:
        return self._work_host

    def to_mounts(self) -> List[Mount]:
        """All mounts, sorted by container path for deterministic output."""
        mounts: List[Mount] = [
            Mount(host=host, container=container)
            for host, container in self._data_dirs.items()
        ]
        if self._work_host:
            mounts.append(Mount(host=self._work_host, container="/work"))
        mounts.sort(key=lambda m: m.container)
        return mounts
