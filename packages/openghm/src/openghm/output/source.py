"""Where a run's WBM output is read from: a work directory on disk, or a published snapshot.

Both present the same thing, one run's output directory ``wbm_output/<run>/``::

    <run>.MT.csv  daily/wbm_<year>.nc  monthly/<variable>/wbm_<year>.nc
    yearly/<variable>/wbm_<year>.nc  climatology/wbm_<variable>_<dc|mc|yc>.nc  cell_area/ ...

* :class:`FolderSource` is ``<output_base>/<sim_id>`` (ADR 0023), found at ``wbm_output/<run>/``
  under it. h5py opens the files by path, with HDF5's file locking off: a run still writing its
  current year holds a lock on it, and scratch (GPFS) does not honour ``flock`` consistently.
* :class:`SnapshotSource` is ``snapshots/<id>/wbm_output/<run>/`` in the public bucket, listed with
  anonymous ListObjectsV2 (``SHA256SUMS`` leaves ``wbm_output/`` out, so it cannot say what exists)
  and read by HTTP range requests (:class:`openghm.output.rangefile.RangeFile`).

Neither imports h5py or numpy until :meth:`Source.open_nc`.
"""

from __future__ import annotations

import os
import posixpath
import re
from typing import Dict, List, Optional

from .. import fetch
from ..errors import OpenghmError, OutputMissing
from .rangefile import Http, HttpStatusError, RangeFile

OUTPUT_DIR = "wbm_output"
_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def _pick_run(runs: List[str], run: Optional[str], hint: str, where: str) -> str:
    """The run directory to read among ``runs``: the one asked for; the only one; the one named
    ``hint`` (the work directory's name, which is the simulation id); else a refusal that lists them."""
    if run is not None:
        if run not in runs:
            raise OpenghmError(f"no run {run!r} under {where}; it has: {', '.join(runs)}")
        return run
    if len(runs) == 1:
        return runs[0]
    if hint in runs:
        return hint
    raise OpenghmError(f"{where} holds several runs ({', '.join(runs)}); name one with --run")


class Source:
    """What :mod:`openghm.output.inventory` and :mod:`openghm.output.subset` need of a source."""

    kind = ""
    run = ""

    def describe(self) -> dict:
        """The source as the commands' answers name it."""
        raise NotImplementedError

    def list_files(self, subdir: str = "", recursive: bool = True) -> Dict[str, int]:
        """``{path relative to the run directory: size in bytes}`` of every file under ``subdir``
        (only the files directly in it when not ``recursive``)."""
        raise NotImplementedError

    def read_text(self, rel: str) -> Optional[str]:
        """A small text file of the run directory, or None when it is not there."""
        raise NotImplementedError

    def open_nc(self, rel: str):
        """An open, read-only ``h5py.File`` of ``rel``; the caller closes it (:meth:`close_nc`)."""
        raise NotImplementedError

    def close_nc(self, h5) -> None:
        h5.close()

    def close(self) -> None:
        pass


class FolderSource(Source):
    kind = "folder"

    def __init__(self, path: str, run: Optional[str] = None) -> None:
        self.path = os.path.abspath(os.path.expanduser(path))
        out = os.path.join(self.path, OUTPUT_DIR)
        if not os.path.isdir(self.path):
            raise OutputMissing(f"{self.path} does not exist: the simulation's files were purged, or it never ran there")
        runs = sorted(d for d in os.listdir(out) if os.path.isdir(os.path.join(out, d))) if os.path.isdir(out) else []
        if not runs:
            raise OutputMissing(f"{self.path} has no {OUTPUT_DIR}/<run>/ folder: the simulation has written no output "
                                "yet, or its files were purged")
        self.run = _pick_run(runs, run, os.path.basename(self.path), f"{self.path}/{OUTPUT_DIR}")
        self.root = os.path.join(out, self.run)

    def describe(self) -> dict:
        return {"kind": self.kind, "path": self.path, "run": self.run, "base": self.root}

    def list_files(self, subdir: str = "", recursive: bool = True) -> Dict[str, int]:
        top = os.path.join(self.root, subdir) if subdir else self.root
        out: Dict[str, int] = {}
        for dirpath, dirs, names in os.walk(top):
            if not recursive:
                dirs[:] = []
            for name in names:
                full = os.path.join(dirpath, name)
                try:
                    size = os.path.getsize(full)
                except OSError:
                    continue
                out[os.path.relpath(full, self.root).replace(os.sep, "/")] = size
        return out

    def read_text(self, rel: str) -> Optional[str]:
        try:
            with open(os.path.join(self.root, rel), encoding="utf-8", errors="replace") as fh:
                return fh.read()
        except FileNotFoundError:
            return None

    def open_nc(self, rel: str):
        import h5py

        full = os.path.join(self.root, rel)
        if not os.path.isfile(full):
            raise OpenghmError(f"{rel} is not in {self.root}")
        try:
            return h5py.File(full, "r", locking=False)
        except OSError as e:
            raise OpenghmError(f"cannot open {full}: {e}")


class SnapshotSource(Source):
    kind = "snapshot"

    def __init__(self, snapshot_id: str, base_url: Optional[str] = None, run: Optional[str] = None,
                 http: Optional[Http] = None) -> None:
        if not _ID_RE.match(snapshot_id or ""):
            raise OpenghmError(f"{snapshot_id!r} is not a snapshot id")
        self.snapshot_id = snapshot_id
        self.base_url = (base_url or fetch.S3_BASE).rstrip("/")
        self.http = http or Http()
        prefix = f"snapshots/{snapshot_id}/{OUTPUT_DIR}/"
        try:
            runs = fetch.list_folders(self.base_url, prefix)
        except OpenghmError as e:
            raise OpenghmError(f"cannot list the output of snapshot {snapshot_id}: {e}")
        if not runs:
            raise OutputMissing(f"snapshot {snapshot_id} has published no output under {prefix}")
        self.run = _pick_run(runs, run, "", prefix)
        self.prefix = f"{prefix}{self.run}/"
        self.url = f"{self.base_url}/{self.prefix}"
        self._sizes: Dict[str, int] = {}

    def describe(self) -> dict:
        return {"kind": self.kind, "id": self.snapshot_id, "run": self.run, "base": self.url}

    def _url(self, rel: str) -> str:
        from urllib.parse import quote

        return f"{self.base_url}/{quote(self.prefix + rel, safe='/')}"

    def list_files(self, subdir: str = "", recursive: bool = True) -> Dict[str, int]:
        sub = f"{subdir.rstrip('/')}/" if subdir else ""
        out = {key[len(self.prefix):]: size
               for key, size, _etag in fetch.list_objects(self.base_url, self.prefix + sub,
                                                          delimiter=None if recursive else "/")}
        self._sizes.update(out)
        return out

    def read_text(self, rel: str) -> Optional[str]:
        try:
            return self.http.get(self._url(rel)).decode("utf-8", errors="replace")
        except HttpStatusError as e:
            if e.status in (403, 404):
                return None
            raise

    def open_nc(self, rel: str):
        import h5py

        if rel not in self._sizes:
            self.list_files(posixpath.dirname(rel), recursive=False)
        if rel not in self._sizes:
            raise OpenghmError(f"{rel} is not in snapshot {self.snapshot_id}'s output")
        ranged = RangeFile(self._url(rel), size=self._sizes[rel], http_client=self.http)
        try:
            h5 = h5py.File(ranged, "r")
        except OSError as e:
            ranged.close()
            raise OpenghmError(f"cannot open {rel} of snapshot {self.snapshot_id}: {e}")
        h5._openghm_ranged = ranged  # closed with it
        return h5

    def close_nc(self, h5) -> None:
        ranged = getattr(h5, "_openghm_ranged", None)
        h5.close()
        if ranged is not None:
            ranged.close()

    def close(self) -> None:
        self.http.close()


def open_source(source: Optional[str], snapshot: Optional[str], run: Optional[str],
                base_url: Optional[str] = None) -> Source:
    """The source the command line names: a work directory, or ``--snapshot <id>``, not both."""
    if bool(source) == bool(snapshot):
        raise OpenghmError("name the output to read: a run's directory, or --snapshot <id>")
    if snapshot:
        return SnapshotSource(snapshot, base_url=base_url, run=run)
    return FolderSource(source, run=run)
