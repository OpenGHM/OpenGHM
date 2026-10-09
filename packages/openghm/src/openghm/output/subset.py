"""``openghm output subset``: one variable of a run's output, cut by period and area.

One call reads one variable at one resolution (``daily``, ``monthly`` or ``yearly``) between two
dates and over a box or a point, and answers in one of three forms:

``nc``    the cut as a NetCDF-4 file at ``out`` (for a download): ``time``, ``lat``, ``lon``, a ``crs`` and
          the one variable, with its source attributes, units and fill value, ``lat`` as the source
          stores it (south to north; ``openghm_lat_order`` says so), compressed at deflate level 1.
``png``   a north-up map of one time step over the box, ``width`` x ``height`` pixels, each pixel the
          value of the cell its centre falls in, coloured by the variable's legend (the MT's range, our
          colours: :mod:`openghm.output.image`); fill and cells outside the grid are transparent. Written
          to ``out``, or returned base64 in the answer.
``json``  the values of the nearest cell to ``point`` over the period, as a time series.

**Dates.** ``YYYY``, ``YYYY-MM`` or ``YYYY-MM-DD``. A start rounds down to the first day it names and an
end up to the last. With a start and no end the period is the start's own (a day, a month, a year); with
neither the period is everything the output holds. A time step is taken when its period overlaps the
dates: a daily step is its day, a monthly step its month, a yearly step its year (the files stamp the
middle of the month and of the year). Every year between the dates must have a file: a gap is a
refusal that says which years exist, not a silent hole.

**Limits** (:mod:`openghm.output.limits`) are checked from the files' headers before any data is read:
the cells a call decodes (whole chunks, :func:`openghm.output.netcdf.cells_read`), what an ``nc`` would
hold uncompressed, and a map's size. A call over a limit is an :class:`openghm.errors.OpenghmError`
whose message says what was asked, what the limit is, and what to ask for instead.

**Values.** ``nc`` keeps the stored values. ``png`` shows ``stored * Var_Scale + Var_Offset``
(:mod:`openghm.output.mt`) against the legend, and ``json`` returns stored values unless ``display``
asks for the MT's.
"""

from __future__ import annotations

import base64
import calendar
import math
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Dict, Iterator, List, Optional, Tuple

from ..errors import OpenghmError
from . import image, limits, mt, netcdf
from .inventory import file_path, load_mt
from .netcdf import np
from .source import Source

FORMATS = ("nc", "png", "json")
RESOLUTIONS = ("daily", "monthly", "yearly")
_DATE = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$")
_YEAR_FILE = re.compile(r"wbm_(\d{4})\.nc$")
#: A variable's name is a path component of its monthly and yearly files: letters, digits, ``_``, ``-``, ``.``.
_VARIABLE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")
#: Attributes of a dataset that are HDF5's or netCDF-C's own bookkeeping, not the variable's.
_RESERVED_ATTRS = {"DIMENSION_LIST", "REFERENCE_LIST", "CLASS", "NAME", "coordinates"}
#: Global attributes of the source file kept in a subset.
_KEPT_GLOBAL = ("institution", "references", "Projection", "WBM_VERSION", "AggrMethod")


@dataclass
class Request:
    variable: str
    resolution: str
    format: str
    start: Optional[str] = None
    end: Optional[str] = None
    #: ``(west, south, east, north)`` in degrees.
    bbox: Optional[Tuple[float, float, float, float]] = None
    #: ``(lon, lat)``.
    point: Optional[Tuple[float, float]] = None
    width: Optional[int] = None
    height: Optional[int] = None
    out: Optional[str] = None
    #: ``json`` only: values as the MT shows them.
    display: bool = False


@dataclass
class _Piece:
    """The steps ``i0:i1`` of one year's file that the request takes."""

    year: int
    rel: str
    i0: int
    i1: int
    times: List[date]


@dataclass
class _Plan:
    pieces: List[_Piece]
    grid: "netcdf.Grid"
    #: The first file's ``lat`` and ``lon`` values, as stored.
    lats: "np.ndarray"
    lons: "np.ndarray"
    chunks: Optional[Tuple[int, int, int]]
    fill: Optional[float]
    attrs: dict
    global_attrs: dict
    crs: Optional[dict]

    @property
    def times(self) -> List[date]:
        return [d for p in self.pieces for d in p.times[p.i0:p.i1]]


# ---- dates ---------------------------------------------------------------------------------------


def parse_date(text: str, end: bool) -> date:
    """``YYYY[-MM[-DD]]`` as its first day, or its last when ``end``."""
    m = _DATE.match(text.strip())
    if not m:
        raise OpenghmError(f"{text!r} is not a date: use YYYY, YYYY-MM or YYYY-MM-DD")
    year, month, day = int(m.group(1)), m.group(2), m.group(3)
    try:
        if day:
            return date(year, int(month), int(day))
        if month:
            return date(year, int(month), calendar.monthrange(year, int(month))[1] if end else 1)
        return date(year, 12, 31) if end else date(year, 1, 1)
    except ValueError:
        raise OpenghmError(f"{text!r} is not a calendar date")


def _period(resolution: str, d: date) -> Tuple[date, date]:
    """The days a time step stamped ``d`` stands for."""
    if resolution == "daily":
        return d, d
    if resolution == "monthly":
        return date(d.year, d.month, 1), date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])
    return date(d.year, 1, 1), date(d.year, 12, 31)


def _range(req: Request) -> Tuple[Optional[date], Optional[date]]:
    """``(first day, last day)`` the dates name; None for an open end."""
    lo = parse_date(req.start, end=False) if req.start else None
    if req.end:
        hi = parse_date(req.end, end=True)
    elif req.start:
        hi = parse_date(req.start, end=True)
    else:
        hi = None
    if lo and hi and hi < lo:
        raise OpenghmError(f"the period ends ({hi}) before it starts ({lo})")
    return lo, hi


# ---- checking the request ------------------------------------------------------------------------


def _check(req: Request) -> None:
    if req.resolution not in RESOLUTIONS:
        raise OpenghmError(f"resolution must be one of {', '.join(RESOLUTIONS)} (climatology is listed by `output inventory`, not cut)")
    if req.format not in FORMATS:
        raise OpenghmError(f"format must be one of {', '.join(FORMATS)}")
    if not _VARIABLE.match(req.variable or ""):
        raise OpenghmError(f"{req.variable!r} is not a variable name")
    if req.bbox is not None:
        w, s, e, n = req.bbox
        if not all(math.isfinite(v) for v in req.bbox) or not (w < e and s < n):
            raise OpenghmError("--bbox is W,S,E,N in degrees with W < E and S < N")
    if req.point is not None and not all(math.isfinite(v) for v in req.point):
        raise OpenghmError("--point is LON,LAT in degrees")
    if req.format == "json":
        if req.point is None:
            raise OpenghmError("--format json needs --point LON,LAT")
        if req.bbox is not None:
            raise OpenghmError("--format json takes --point, not --bbox")
        if req.out:
            raise OpenghmError("--out is for the nc and png formats; json is printed")
    else:
        if req.point is not None:
            raise OpenghmError(f"--point is for --format json; {req.format} takes --bbox")
        if req.display:
            raise OpenghmError("--display is for --format json (png is always shown as displayed)")
    if req.format == "nc":
        if not req.out:
            raise OpenghmError("--format nc needs --out PATH")
    if req.format != "png" and (req.width or req.height):
        raise OpenghmError("--width and --height are for --format png")
    for name, v in (("--width", req.width), ("--height", req.height)):
        if v is not None and not 1 <= v <= limits.MAX_IMAGE_SIDE:
            raise OpenghmError(f"{name} must be between 1 and {limits.MAX_IMAGE_SIDE}")
    if req.width and req.height and req.width * req.height > limits.MAX_IMAGE_PIXELS:
        raise OpenghmError(f"a map may have at most {limits.MAX_IMAGE_PIXELS:,} pixels; {req.width} x {req.height} is {req.width * req.height:,}")


# ---- planning: which steps of which files --------------------------------------------------------


def _years_present(source: Source, req: Request) -> List[int]:
    """The years that have a file for the variable at the resolution, from the listing."""
    subdir = "daily" if req.resolution == "daily" else f"{req.resolution}/{req.variable}"
    years = set()
    for rel in source.list_files(subdir):
        m = _YEAR_FILE.search(rel)
        if m and rel.startswith(subdir + "/") and "/" not in rel[len(subdir) + 1:]:
            years.add(int(m.group(1)))
    return sorted(years)


def _plan(source: Source, req: Request, years: List[int], lo: Optional[date], hi: Optional[date]) -> _Plan:
    """Open each year's file for its header only: time axis, grid and the variable's dataset; take the
    steps in the period. Nothing is read from a data chunk."""
    if not years:
        what = "daily output" if req.resolution == "daily" else f"{req.resolution} output of variable {req.variable!r}"
        raise OpenghmError(f"the run has no {what}")
    first_year = lo.year if lo else years[0]
    last_year = hi.year if hi else years[-1]
    missing = [y for y in range(first_year, last_year + 1) if y not in years]
    if missing:
        span = f"{years[0]}-{years[-1]}" if years == list(range(years[0], years[-1] + 1)) else ", ".join(map(str, years))
        raise OpenghmError(
            f"no {req.resolution} file for {req.variable!r} in {', '.join(map(str, missing[:5]))}"
            f"{' ...' if len(missing) > 5 else ''}; the years it has: {span}"
        )
    lo_d = lo or date.min
    hi_d = hi or date.max
    pieces: List[_Piece] = []
    plan_grid: Optional[netcdf.Grid] = None
    lats = lons = None
    chunks = fill = attrs = None
    global_attrs: dict = {}
    crs = None
    for year in range(first_year, last_year + 1):
        rel = file_path(req.resolution, req.variable, year)
        h5 = source.open_nc(rel)
        try:
            grid = netcdf.read_grid(h5)
            if plan_grid is None:
                plan_grid = grid
                lats, lons = h5["lat"][:], h5["lon"][:]
            elif not grid.same_as(plan_grid):
                raise OpenghmError(f"{rel} is on a different grid from the first year's")
            if req.variable not in h5:
                names = sorted(netcdf.data_variables(h5))
                raise OpenghmError(f"{rel} has no variable {req.variable!r}; it has {', '.join(names[:12])}"
                                   f"{' ...' if len(names) > 12 else ''}")
            ds = h5[req.variable]
            if ds.ndim != 3 or ds.shape[1:] != (grid.rows, grid.cols):
                raise OpenghmError(f"{req.variable!r} in {rel} is not a (time, lat, lon) variable")
            times = netcdf.read_times(h5)
            if len(times) != ds.shape[0]:
                raise OpenghmError(f"{rel}: the time axis has {len(times)} values and {req.variable!r} {ds.shape[0]} steps")
            take = [i for i, d in enumerate(times) if _period(req.resolution, d)[0] <= hi_d and _period(req.resolution, d)[1] >= lo_d]
            if take:
                if take != list(range(take[0], take[-1] + 1)):
                    raise OpenghmError(f"{rel}: the time axis is not in order")
                pieces.append(_Piece(year, rel, take[0], take[-1] + 1, times))
            if chunks is None:
                chunks, fill = ds.chunks, netcdf.fill_value(ds)
                attrs = _copy_attrs(ds)
                global_attrs = {k: _plain(h5.attrs[k]) for k in _KEPT_GLOBAL if k in h5.attrs}
                if "crs" in h5:
                    crs = {k: _plain(v) for k, v in h5["crs"].attrs.items() if k not in _RESERVED_ATTRS and not k.startswith("_")}
        finally:
            source.close_nc(h5)
    if not pieces:
        raise OpenghmError(f"no {req.resolution} time step of {req.variable!r} falls in "
                           f"{lo_d if lo else 'the start'} .. {hi_d if hi else 'the end'}")
    assert plan_grid is not None
    return _Plan(pieces, plan_grid, lats, lons, chunks, fill, attrs or {}, global_attrs, crs)


def _plain(value):
    """An attribute as a value h5netcdf can write: text as ``str``, numbers as numpy scalars/arrays."""
    if isinstance(value, (bytes, np.bytes_)):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, np.ndarray) and value.dtype.kind in "SO":
        return netcdf.text_attr(value)
    return value


def _copy_attrs(ds) -> dict:
    return {k: _plain(v) for k, v in ds.attrs.items()
            if not k.startswith("_") and k not in _RESERVED_ATTRS}


# ---- the cell window -----------------------------------------------------------------------------


def _edges(grid: "netcdf.Grid", rows: Tuple[int, int], cols: Tuple[int, int]) -> dict:
    hy, hx = abs(grid.dlat) / 2, abs(grid.dlon) / 2
    lats = (grid.lat(rows[0]), grid.lat(rows[1] - 1))
    lons = (grid.lon(cols[0]), grid.lon(cols[1] - 1))
    return {"west": min(lons) - hx, "south": min(lats) - hy, "east": max(lons) + hx, "north": max(lats) + hy}


def _check_limits(plan: _Plan, steps: int, rows: Tuple[int, int], cols: Tuple[int, int], req: Request) -> int:
    """The cells the call decodes; a refusal when that, or an ``nc`` file's size, is over its limit."""
    total = 0
    for p in plan.pieces:
        ds_like = _Shape(plan.chunks)
        total += netcdf.cells_read(ds_like, p.i1 - p.i0, rows, cols)
    if total > limits.MAX_CELLS_READ:
        per_step = total // max(steps, 1)
        raise OpenghmError(
            f"this request reads {total / 1e6:,.0f} million cells ({steps:,} time steps of {per_step:,} cells: "
            f"a file's data is read in chunks, whole, however small the area); one call may read at most "
            f"{limits.MAX_CELLS_READ / 1e6:,.0f} million. Ask for a shorter period or a smaller area."
        )
    if req.format == "nc":
        size = steps * (rows[1] - rows[0]) * (cols[1] - cols[0]) * 4
        if size > limits.MAX_NC_BYTES:
            raise OpenghmError(
                f"this subset would hold {size / 2**30:.1f} GiB uncompressed ({steps:,} steps x "
                f"{rows[1] - rows[0]:,} x {cols[1] - cols[0]:,} cells); one download may hold at most "
                f"{limits.MAX_NC_BYTES / 2**30:.0f} GiB. Ask for a shorter period or a smaller area."
            )
    return total


class _Shape:
    """Just the ``chunks`` of a dataset, for :func:`openghm.output.netcdf.cells_read`."""

    def __init__(self, chunks) -> None:
        self.chunks = chunks


# ---- the three outputs ---------------------------------------------------------------------------


def _stored_units(plan: _Plan) -> Optional[str]:
    u = plan.attrs.get("units")
    return str(u) if u is not None else None


def _blocks(source: Source, plan: _Plan, req: Request, rows, cols) -> Iterator[Tuple[int, "np.ndarray"]]:
    per_step = max((rows[1] - rows[0]) * (cols[1] - cols[0]) * 4, 1)
    block = max(1, limits.WRITE_BLOCK_BYTES // per_step)
    done = 0
    for p in plan.pieces:
        h5 = source.open_nc(p.rel)
        try:
            ds = h5[req.variable]
            for s in range(p.i0, p.i1, block):
                e = min(s + block, p.i1)
                yield done + (s - p.i0), ds[s:e, rows[0]:rows[1], cols[0]:cols[1]]
        finally:
            source.close_nc(h5)
        done += p.i1 - p.i0


def _do_nc(source: Source, plan: _Plan, req: Request, rows, cols) -> dict:
    times = plan.times
    grid = plan.grid
    edges = _edges(grid, rows, cols)
    crs = dict(plan.crs) if plan.crs else None
    if crs is not None:
        dx, dy = abs(grid.dlon), abs(grid.dlat)
        crs["GeoTransform"] = f"{edges['west']!r} {dx!r} 0 {edges['north']!r} 0 {-dy!r}"
    attrs = dict(plan.attrs)
    attrs["grid_mapping"] = "crs"
    lat_order = "south-to-north" if grid.south_to_north else "north-to-south"
    glob = dict(plan.global_attrs)
    glob.update({
        "Conventions": "CF-1.8",
        "title": f"WBM {req.variable} ({req.resolution}), subset of the run {source.run}",
        "history": f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} openghm output subset "
                   f"--var {req.variable} --resolution {req.resolution}",
        "openghm_run": source.run,
        "openghm_source": source.describe()["base"],
        "openghm_period": f"{times[0].isoformat()} .. {times[-1].isoformat()}",
        "openghm_lat_order": f"{lat_order} (as the source stores it)",
    })
    size = netcdf.write_subset(
        req.out, name=req.variable, times=times, lats=plan.lats[rows[0]:rows[1]], lons=plan.lons[cols[0]:cols[1]],
        blocks=_blocks(source, plan, req, rows, cols), attrs=attrs, global_attrs=glob, fill=plan.fill, crs=crs,
    )
    return {"path": os.path.abspath(req.out), "bytes": size, "rows": rows[1] - rows[0], "cols": cols[1] - cols[0],
            "latOrder": lat_order, "bbox": edges, "units": _stored_units(plan), "fill": plan.fill}


def _json_number(x: float) -> Optional[float]:
    """A float32 value as the shortest number that reads back as it (``0.1``, not ``0.10000000149``);
    None for NaN."""
    return None if x != x else float(str(np.float32(x)))


def _do_json(source: Source, plan: _Plan, req: Request, row: int, col: int, display: Optional[mt.Display]) -> dict:
    values: List[Optional[float]] = []
    scale = display.scale if (req.display and display) else 1.0
    offset = display.offset if (req.display and display) else 0.0
    for p in plan.pieces:
        h5 = source.open_nc(p.rel)
        try:
            col_values = h5[req.variable][p.i0:p.i1, row, col]
        finally:
            source.close_nc(h5)
        ok = netcdf.valid_mask(col_values, plan.fill)
        for v, good in zip(col_values.tolist(), ok.tolist()):
            if not good:
                values.append(None)
            elif scale == 1.0 and offset == 0.0:
                values.append(_json_number(v))
            else:
                values.append(float(f"{float(v) * scale + offset:.9g}"))
    grid = plan.grid
    shown = bool(req.display and display)
    return {
        "point": {"lon": req.point[0], "lat": req.point[1], "row": row, "col": col,
                  "cellLon": float(plan.lons[col]), "cellLat": float(plan.lats[row])},
        "units": (display.units or _stored_units(plan)) if shown else _stored_units(plan),
        "valuesIn": "display" if shown else "stored",
        "fill": plan.fill,
        "times": [d.isoformat() for d in plan.times],
        "values": values,
    }


def _image_size(req: Request, grid: "netcdf.Grid", box: Tuple[float, float, float, float]) -> Tuple[int, int]:
    west, south, east, north = box
    w_deg, h_deg = east - west, north - south
    if req.width and req.height:
        return req.width, req.height
    if req.width:
        return req.width, max(1, round(req.width * h_deg / w_deg))
    if req.height:
        return max(1, round(req.height * w_deg / h_deg)), req.height
    w, h = max(1, round(w_deg / abs(grid.dlon))), max(1, round(h_deg / abs(grid.dlat)))
    shrink = max(w / limits.MAX_IMAGE_SIDE, h / limits.MAX_IMAGE_SIDE, math.sqrt(w * h / limits.MAX_IMAGE_PIXELS), 1.0)
    return max(1, int(w / shrink)), max(1, int(h / shrink))


def _map_geometry(plan: _Plan, req: Request):
    """The pixel grid of a map: ``(box, width, height, row of each pixel row, col of each pixel col,
    the cell window)``. A pixel takes the cell its centre falls in."""
    grid = plan.grid
    box = req.bbox or grid.bounds
    west, south, east, north = box
    width, height = _image_size(req, grid, box)
    if width * height > limits.MAX_IMAGE_PIXELS or max(width, height) > limits.MAX_IMAGE_SIDE:
        raise OpenghmError(f"a map may be at most {limits.MAX_IMAGE_SIDE} pixels on a side and {limits.MAX_IMAGE_PIXELS:,} "
                           f"in all; this box at this size is {width} x {height}. Ask for a smaller --width/--height.")
    lons = west + (np.arange(width) + 0.5) * (east - west) / width
    lats = north - (np.arange(height) + 0.5) * (north - south) / height
    cols_of = np.floor((lons - grid.lon0) / grid.dlon + 0.5).astype(np.int64)
    rows_of = np.floor((lats - grid.lat0) / grid.dlat + 0.5).astype(np.int64)
    ok_c = (cols_of >= 0) & (cols_of < grid.cols)
    ok_r = (rows_of >= 0) & (rows_of < grid.rows)
    if not ok_c.any() or not ok_r.any():
        gw, gs, ge, gn = grid.bounds
        raise OpenghmError(f"the box {west:g},{south:g},{east:g},{north:g} is outside the grid ({gw:g},{gs:g},{ge:g},{gn:g})")
    rows = (int(rows_of[ok_r].min()), int(rows_of[ok_r].max()) + 1)
    cols = (int(cols_of[ok_c].min()), int(cols_of[ok_c].max()) + 1)
    return box, width, height, rows_of, cols_of, ok_r, ok_c, rows, cols


def _do_png(source: Source, plan: _Plan, req: Request, geometry, display: Optional[mt.Display]) -> dict:
    box, width, height, rows_of, cols_of, ok_r, ok_c, rows, cols = geometry
    p = plan.pieces[0]
    h5 = source.open_nc(p.rel)
    try:
        block = h5[req.variable][p.i0, rows[0]:rows[1], cols[0]:cols[1]]
    finally:
        source.close_nc(h5)
    r = np.clip(rows_of - rows[0], 0, rows[1] - rows[0] - 1)
    c = np.clip(cols_of - cols[0], 0, cols[1] - cols[0] - 1)
    sample = block[np.ix_(r, c)].astype(np.float64)
    valid = netcdf.valid_mask(block, plan.fill)[np.ix_(r, c)] & ok_r[:, None] & ok_c[None, :]
    scale = display.scale if display else 1.0
    offset = display.offset if display else 0.0
    shown = sample * scale + offset

    legend = display.legend if display else None
    auto = legend is None
    if auto:
        have = shown[valid]
        lo, hi = (float(have.min()), float(have.max())) if have.size else (0.0, 1.0)
        if not hi > lo:
            hi = lo + 1.0
        ramp_name, log, requested = image.FALLBACK_RAMP, False, image.FALLBACK_RAMP
    else:
        lo, hi = legend.min, legend.max
        requested = legend.ramp
        ramp_name, _known = image.resolve_ramp(legend.ramp)
        log = legend.log and lo > 0
    rgba = image.colorize(shown, valid, lo, hi, log, ramp_name)
    data = image.png_bytes(rgba)
    answer = {
        "width": width, "height": height, "northUp": True,
        "bbox": {"west": box[0], "south": box[1], "east": box[2], "north": box[3]},
        "time": plan.times[0].isoformat(),
        "units": (display.units if display and display.units else _stored_units(plan)),
        "legend": {"ramp": requested, "rampUsed": ramp_name, "min": lo, "max": hi, "log": log, "auto": auto,
                   "colors": image.legend_colors(ramp_name)},
        "valueRange": ({"min": float(shown[valid].min()), "max": float(shown[valid].max())} if valid.any() else None),
        "bytes": len(data),
        "path": None, "base64": None,
    }
    if req.out:
        parent = os.path.dirname(os.path.abspath(req.out))
        os.makedirs(parent, mode=0o700, exist_ok=True)
        part = req.out + ".part"
        try:
            with open(part, "wb") as fh:
                fh.write(data)
            os.replace(part, req.out)
        except BaseException:
            try:
                os.remove(part)
            except OSError:
                pass
            raise
        answer["path"] = os.path.abspath(req.out)
    else:
        answer["base64"] = base64.b64encode(data).decode("ascii")
    return answer


# ---- entry point ---------------------------------------------------------------------------------


def subset(source: Source, req: Request) -> dict:
    """Cut ``req`` from ``source`` and return the answer (see the module docstring for each format's)."""
    netcdf.require()
    _check(req)
    lo, hi = _range(req)
    years = _years_present(source, req)
    plan = _plan(source, req, years, lo, hi)
    steps = sum(p.i1 - p.i0 for p in plan.pieces)
    grid = plan.grid

    display: Optional[mt.Display] = None
    if req.format == "png" or req.display:
        _name, records = load_mt(source, source.list_files("", recursive=False), [])
        display = records.get((req.variable, req.resolution))
        if req.display and display is None:
            raise OpenghmError(f"the run's MT has no display settings for {req.variable!r} ({req.resolution}), "
                               "so --display has nothing to apply")

    row = col = 0
    geometry = None
    if req.format == "png":
        if steps != 1:
            raise OpenghmError(f"a map shows one time step; this period holds {steps} {req.resolution} steps. "
                               "Name one: a full date for daily, a month for monthly, a year for yearly.")
        geometry = _map_geometry(plan, req)
        rows, cols = geometry[-2], geometry[-1]
    elif req.format == "json":
        row, col = grid.row_of(req.point[1]), grid.col_of(req.point[0])
        if not (0 <= row < grid.rows and 0 <= col < grid.cols):
            w, s, e, n = grid.bounds
            raise OpenghmError(f"the point {req.point[0]:g},{req.point[1]:g} is outside the grid ({w:g},{s:g},{e:g},{n:g})")
        rows, cols = (row, row + 1), (col, col + 1)
    else:
        if req.bbox is None:
            rows, cols = (0, grid.rows), (0, grid.cols)
        else:
            win = netcdf.window(grid, *req.bbox)
            if win is None:
                w, s, e, n = grid.bounds
                raise OpenghmError(f"no cell centre lies in the box {','.join(f'{v:g}' for v in req.bbox)}; "
                                   f"the grid covers {w:g},{s:g},{e:g},{n:g} in cells of {abs(grid.dlon):.6f} degrees")
            rows, cols = win

    cells = _check_limits(plan, steps, rows, cols, req)
    if req.format == "nc":
        body = _do_nc(source, plan, req, rows, cols)
    elif req.format == "png":
        body = _do_png(source, plan, req, geometry, display)
    else:
        body = _do_json(source, plan, req, row, col, display)

    times = plan.times
    answer = {
        "format": req.format, "variable": req.variable, "resolution": req.resolution,
        "source": source.describe(),
        "period": {"first": times[0].isoformat(), "last": times[-1].isoformat(), "steps": steps},
        "read": {"cells": cells, "limit": limits.MAX_CELLS_READ},
    }
    answer.update(body)
    return answer


def describe(answer: dict) -> List[str]:
    """The answer as lines for a terminal (the full answer is ``--json``)."""
    p = answer["period"]
    head = f"{answer['variable']} {answer['resolution']} {p['first']} .. {p['last']} ({p['steps']} steps), {answer['read']['cells']:,} cells read"
    fmt = answer["format"]
    if fmt == "nc":
        return [head, f"wrote {answer['path']} ({answer['bytes']:,} bytes, {answer['rows']} x {answer['cols']} cells, lat {answer['latOrder']})"]
    if fmt == "png":
        lg = answer["legend"]
        where = answer["path"] or "(base64 in --json)"
        return [head, f"map {answer['width']} x {answer['height']} north-up, {answer['units'] or '-'}, "
                      f"{lg['rampUsed']} {lg['min']:g}..{lg['max']:g}{' log' if lg['log'] else ''}: {where}"]
    lines = [head, f"cell {answer['point']['row']},{answer['point']['col']} at "
                   f"{answer['point']['cellLon']:.4f},{answer['point']['cellLat']:.4f}; {answer['units'] or '-'} ({answer['valuesIn']})"]
    for t, v in list(zip(answer["times"], answer["values"]))[:20]:
        lines.append(f"  {t}  {'-' if v is None else v}")
    if len(answer["times"]) > 20:
        lines.append(f"  ... {len(answer['times']) - 20} more (--json has them all)")
    return lines
