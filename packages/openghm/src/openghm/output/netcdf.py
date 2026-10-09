"""Reading WBM's NetCDF-4 output with h5py, and writing a subset of it with h5netcdf.

What WBM writes (checked on the three published snapshots, 2026-10-08/09):

* ``float v(time, lat, lon)``, ``_FillValue = missing_value = -9999``, with ``units`` and ``long_name``,
  and one chunk per time step over the whole grid (Global: nine chunks per step), deflate level 1;
* ``time`` an ``int`` of ``days since 1900-01-01`` (standard calendar): daily files stamp each day,
  monthly files the middle of each month, yearly files the middle of the year;
* ``lat`` and ``lon`` are double cell centres, ``lat`` stored **south to north** although
  ``crs:GeoTransform`` describes a north-up grid. Maps are drawn north-up by looking cells up by
  coordinate, so the storage order never reaches a picture; a downloaded subset keeps the storage
  order and says so in its ``openghm_lat_order`` attribute.

Imports h5py and numpy at module level: import it only after the optional extra is known to be there
(:func:`require`).
"""

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

from ..errors import OpenghmError

try:
    import h5py
    import numpy as np

    AVAILABLE = True
except ImportError:  # the `output` extra is not installed
    AVAILABLE = False

EXTRA_HINT = "this command needs h5py, numpy and h5netcdf: pip install 'openghm[output]'"
_UNITS = re.compile(r"^\s*days\s+since\s+(\d{4})-(\d{2})-(\d{2})", re.IGNORECASE)
#: How far a coordinate step may differ from the grid's own step before the grid is called irregular.
_REGULAR = 1e-3


def require() -> None:
    """Raise a plain :class:`RuntimeError` (the CLI exits 1: an installation fault, not a refusal) when
    the optional extra is missing."""
    if not AVAILABLE:
        raise RuntimeError(EXTRA_HINT)


def text_attr(value) -> str:
    """An HDF5 attribute as ``str``: h5py returns ``str`` for variable-length strings, ``bytes`` or
    ``numpy.bytes_`` for NetCDF's fixed-length ones, and an array for a one-element array."""
    if isinstance(value, np.ndarray):
        value = value.ravel()[0] if value.size else ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def number_attr(value) -> Optional[float]:
    try:
        return float(np.asarray(value).ravel()[0])
    except (TypeError, ValueError, IndexError):
        return None


@dataclass(frozen=True)
class Grid:
    """A regular lat/lon grid by its first cell centre and step; ``dlat < 0`` would be north-up."""

    rows: int
    cols: int
    lat0: float
    dlat: float
    lon0: float
    dlon: float

    @property
    def south_to_north(self) -> bool:
        return self.dlat > 0

    def lat(self, i: int) -> float:
        return self.lat0 + i * self.dlat

    def lon(self, j: int) -> float:
        return self.lon0 + j * self.dlon

    @property
    def bounds(self) -> Tuple[float, float, float, float]:
        """``(west, south, east, north)``: the outer edges of the outermost cells."""
        lats = (self.lat(0), self.lat(self.rows - 1))
        lons = (self.lon(0), self.lon(self.cols - 1))
        hy, hx = abs(self.dlat) / 2, abs(self.dlon) / 2
        return min(lons) - hx, min(lats) - hy, max(lons) + hx, max(lats) + hy

    def row_of(self, lat: float) -> int:
        """The row whose centre is nearest ``lat`` (not clipped)."""
        return int(math.floor((lat - self.lat0) / self.dlat + 0.5))

    def col_of(self, lon: float) -> int:
        return int(math.floor((lon - self.lon0) / self.dlon + 0.5))

    def same_as(self, other: "Grid") -> bool:
        step = min(abs(self.dlat), abs(self.dlon)) * _REGULAR
        return (self.rows, self.cols) == (other.rows, other.cols) and all(
            abs(a - b) <= step for a, b in
            ((self.lat0, other.lat0), (self.lon0, other.lon0), (self.dlat, other.dlat), (self.dlon, other.dlon))
        )


def _axis(values, name: str) -> Tuple[float, float]:
    """``(first, step)`` of a regular coordinate array; a refusal when it is not one."""
    if len(values) < 2:
        raise OpenghmError(f"the {name} axis has {len(values)} value(s): not a grid")
    step = float(values[1] - values[0])
    if step == 0 or not np.allclose(np.diff(values), step, rtol=0, atol=abs(step) * _REGULAR):
        raise OpenghmError(f"the {name} axis is not regular")
    return float(values[0]), step


def read_grid(h5) -> Grid:
    """The grid of a WBM file, from its ``lat`` and ``lon``."""
    try:
        lat, lon = h5["lat"][:], h5["lon"][:]
    except KeyError as e:
        raise OpenghmError(f"the file has no {e.args[0]} coordinate")
    lat0, dlat = _axis(lat, "lat")
    lon0, dlon = _axis(lon, "lon")
    return Grid(len(lat), len(lon), lat0, dlat, lon0, dlon)


def read_times(h5) -> List[date]:
    """The dates of the ``time`` axis. Only ``days since YYYY-MM-DD`` is understood."""
    try:
        ds = h5["time"]
    except KeyError:
        raise OpenghmError("the file has no time coordinate")
    m = _UNITS.match(text_attr(ds.attrs.get("units", "")))
    if not m:
        raise OpenghmError(f"unsupported time units {text_attr(ds.attrs.get('units', ''))!r}: only 'days since YYYY-MM-DD'")
    base = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return [base + timedelta(days=int(round(float(v)))) for v in ds[:]]


def data_variables(h5) -> Dict[str, "h5py.Dataset"]:
    """The ``(time, lat, lon)`` float datasets of a file, in file order."""
    if "time" not in h5 or "lat" not in h5 or "lon" not in h5:
        raise OpenghmError("the file has no time/lat/lon coordinates")
    shape = (h5["time"].shape[0], h5["lat"].shape[0], h5["lon"].shape[0])
    out = {}
    for name, obj in h5.items():
        if isinstance(obj, h5py.Dataset) and obj.shape == shape and obj.dtype.kind == "f":
            out[name] = obj
    return out


def fill_value(ds) -> Optional[float]:
    for key in ("_FillValue", "missing_value"):
        if key in ds.attrs:
            v = number_attr(ds.attrs[key])
            if v is not None:
                return v
    return None


def valid_mask(values, fill: Optional[float]):
    """True where ``values`` holds data: finite, and not the fill value."""
    ok = np.isfinite(values)
    if fill is not None:
        ok &= values != np.asarray(fill, dtype=values.dtype)
    return ok


def cells_read(ds, steps: int, rows: Tuple[int, int], cols: Tuple[int, int]) -> int:
    """What reading ``steps`` consecutive time steps of the half-open window ``rows`` x ``cols`` of
    ``ds`` decodes: whole chunks, whatever part of them the window needs. An unchunked dataset is
    read by the window's own cells."""
    ct, cy, cx = ds.chunks or (1, 1, 1)

    def span(lo: int, hi: int, size: int) -> int:
        return (hi - 1) // size - lo // size + 1

    return span(0, steps, ct) * ct * span(rows[0], rows[1], cy) * cy * span(cols[0], cols[1], cx) * cx


def window(grid: Grid, west: float, south: float, east: float, north: float) -> Optional[Tuple[Tuple[int, int], Tuple[int, int]]]:
    """The half-open ``((row0, row1), (col0, col1))`` of the cells whose centres lie in the box,
    or None when none do."""
    def span(first: float, step: float, n: int, lo: float, hi: float) -> Optional[Tuple[int, int]]:
        a, b = sorted(((lo - first) / step, (hi - first) / step))
        i0, i1 = int(math.ceil(a - 1e-9)), int(math.floor(b + 1e-9))
        i0, i1 = max(i0, 0), min(i1, n - 1)
        return (i0, i1 + 1) if i0 <= i1 else None

    rows = span(grid.lat0, grid.dlat, grid.rows, south, north)
    cols = span(grid.lon0, grid.dlon, grid.cols, west, east)
    return (rows, cols) if rows and cols else None


def _char(value):
    """Text as fixed-length bytes, which netCDF reads as an ``NC_CHAR`` attribute (what every reader
    expects) rather than the ``NC_STRING`` h5py would write for ``str``."""
    return np.bytes_(value.encode("utf-8")) if isinstance(value, str) else value


def write_subset(path: str, *, name: str, times: List[date], lats, lons, blocks, attrs: dict,
                 global_attrs: dict, fill: Optional[float], crs: Optional[dict] = None) -> int:
    """Write one variable over ``times`` and the window as NetCDF-4 and return the file's size.

    ``lats`` and ``lons`` are the source's own coordinate values of the window (``lat`` as stored).
    ``blocks`` yields ``(first_step, array)`` with ``array`` of shape ``(n, len(lats), len(lons))``
    in the order of ``times``. The file is written to ``<path>.part`` and renamed, so ``path`` is
    only ever a complete file; a failure removes the partial one. The variable keeps its source
    attributes, its fill value and its ``grid_mapping``. The parent directory is created (mode 0700)
    when missing.
    """
    import h5netcdf

    base = date(1900, 1, 1)
    ny, nx = len(lats), len(lons)
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, mode=0o700, exist_ok=True)
    part = path + ".part"
    try:
        with h5netcdf.File(part, "w") as f:
            f.dimensions = {"time": len(times), "lat": ny, "lon": nx}
            t = f.create_variable("time", ("time",), "i4", data=np.array([(d - base).days for d in times], dtype="i4"))
            t.attrs["long_name"] = _char("Time")
            t.attrs["units"] = _char("days since 1900-01-01")
            t.attrs["calendar"] = _char("standard")
            la = f.create_variable("lat", ("lat",), "f8", data=np.asarray(lats, dtype="f8"))
            la.attrs["long_name"], la.attrs["standard_name"], la.attrs["units"] = (
                _char("latitude"), _char("latitude"), _char("degrees_north"))
            lo = f.create_variable("lon", ("lon",), "f8", data=np.asarray(lons, dtype="f8"))
            lo.attrs["long_name"], lo.attrs["standard_name"], lo.attrs["units"] = (
                _char("longitude"), _char("longitude"), _char("degrees_east"))
            if crs:
                c = f.create_variable("crs", (), "S1")
                for k, v in crs.items():
                    c.attrs[k] = _char(v)
            chunks = (1, min(ny, 1024), min(nx, 1024))
            kw = {"chunks": chunks, "compression": "gzip", "compression_opts": 1}
            if fill is not None:
                kw["fillvalue"] = np.float32(fill)
            v = f.create_variable(name, ("time", "lat", "lon"), "f4", **kw)
            for k, val in attrs.items():
                if k not in ("_FillValue",):
                    v.attrs[k] = _char(val)
            for k, val in global_attrs.items():
                f.attrs[k] = _char(val)
            for first, block in blocks:
                v[first:first + block.shape[0], :, :] = block
        os.replace(part, path)
    except BaseException:
        try:
            os.remove(part)
        except OSError:
            pass
        raise
    return os.path.getsize(path)
