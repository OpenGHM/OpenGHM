"""``openghm output inventory``: what a run's WBM output holds.

The answer is built from what **exists**: the file listing decides the variables, resolutions and
years; the run's MT (:mod:`openghm.output.mt`) only adds display settings, and a variable the MT
describes but no file holds is left out, while one with files and no MT record is listed with
``display: null``. The MT's own ``File_Path`` is a path inside the run's container and is not used:
WBM's layout is fixed, and each entry says where its files are (``path``, relative to the run
directory, with ``{year}``).

For a published snapshot the listing is the bucket's (ListObjectsV2), and the files opened are the
first daily file, the files with the first and last year (for the time axes) and, for a variable
that has no daily file, its first monthly or yearly file: a handful of range reads, not a download.

JSON shape (every key always present)::

    {"source": {...Source.describe()}, "mt": "<name>.MT.csv" | null,
     "grid": {"rows", "cols", "crs", "cellSize", "bounds": {"west","south","east","north"},
              "lat": {"first","last","step"}, "lon": {...}, "latOrder": "south-to-north"|"north-to-south"} | null,
     "resolutions": {"daily"|"monthly"|"yearly": {"years": [...], "first": "YYYY-MM-DD", "last": "YYYY-MM-DD",
                                                    "path": "..."},
                     "climatology": {"kinds": ["daily","monthly","yearly"]}},
     "variables": [{"name", "longName", "units",
                    "resolutions": {"daily"|"monthly"|"yearly": {"years", "path", "display"},
                                    "climatology": {"daily"|"monthly"|"yearly": {"path", "display"}}}}],
     "files": {"count", "bytes"}, "warnings": [...]}

``first`` and ``last`` are the first and last stamps of the time axes as stored: daily files stamp each
day, monthly files the middle of the month, yearly files the middle of the year. ``display`` is
:meth:`openghm.output.mt.Display.to_dict`; ``units`` is what the file stores.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from ..errors import OpenghmError
from . import mt, netcdf
from .source import Source

RESOLUTIONS = ("daily", "monthly", "yearly")
_DAILY = re.compile(r"^daily/wbm_(\d{4})\.nc$")
_PER_VARIABLE = re.compile(r"^(monthly|yearly)/([^/]+)/wbm_(\d{4})\.nc$")
_CLIMATOLOGY = re.compile(r"^climatology/wbm_(.+)_(dc|mc|yc)\.nc$")
_MT_FILE = re.compile(r"^[^/]+\.MT\.csv$")
_CLIMATOLOGY_KIND = {"dc": "daily", "mc": "monthly", "yc": "yearly"}
_CLIMATOLOGY_SERIES = {"daily": "daily_clim", "monthly": "monthly_clim", "yearly": "yearly_clim"}


def file_path(resolution: str, variable: str, year: object = "{year}") -> str:
    """The run-relative path of a variable's file for a year, in WBM's layout."""
    if resolution == "daily":
        return f"daily/wbm_{year}.nc"
    return f"{resolution}/{variable}/wbm_{year}.nc"


def climatology_path(variable: str, kind: str) -> str:
    suffix = {v: k for k, v in _CLIMATOLOGY_KIND.items()}[kind]
    return f"climatology/wbm_{variable}_{suffix}.nc"


def pick_mt(files: Dict[str, int], run: str) -> Optional[str]:
    """The run's MT among its files: ``<run>.MT.csv``, else the only ``*.MT.csv``, else None (a run's
    ``ID`` is its init's, and need not be the directory's name)."""
    names = sorted(f for f in files if _MT_FILE.match(f))
    if f"{run}.MT.csv" in names:
        return f"{run}.MT.csv"
    return names[0] if len(names) == 1 else None


def load_mt(source: Source, files: Dict[str, int], warnings: List[str]) -> Tuple[Optional[str], Dict[Tuple[str, str], mt.Display]]:
    """``(MT file name, its output records)``; an unreadable MT is a warning, not a failure."""
    name = pick_mt(files, source.run)
    if name is None:
        if any(_MT_FILE.match(f) for f in files):
            warnings.append("the run has several *.MT.csv and none is named for it: display settings are left out")
        return None, {}
    try:
        text = source.read_text(name)
    except OpenghmError as e:
        warnings.append(f"cannot read {name}: {e}")
        return name, {}
    return name, mt.parse(text or "")


def _grid_json(grid: "netcdf.Grid") -> dict:
    west, south, east, north = grid.bounds
    lats = sorted((grid.lat(0), grid.lat(grid.rows - 1)))
    lons = sorted((grid.lon(0), grid.lon(grid.cols - 1)))
    return {
        "rows": grid.rows, "cols": grid.cols, "crs": "EPSG:4326",
        "cellSize": abs(grid.dlon),
        "bounds": {"west": west, "south": south, "east": east, "north": north},
        "lat": {"first": lats[0], "last": lats[1], "step": abs(grid.dlat)},
        "lon": {"first": lons[0], "last": lons[1], "step": abs(grid.dlon)},
        "latOrder": "south-to-north" if grid.south_to_north else "north-to-south",
    }


def inventory(source: Source) -> dict:
    """Describe the output of ``source`` (see the module docstring for the shape)."""
    netcdf.require()
    warnings: List[str] = []
    files = source.list_files()

    daily_years: List[int] = []
    per_var: Dict[str, Dict[str, List[int]]] = {"monthly": {}, "yearly": {}}
    clim: Dict[str, Dict[str, str]] = {}
    for rel in sorted(files):
        m = _DAILY.match(rel)
        if m:
            daily_years.append(int(m.group(1)))
            continue
        m = _PER_VARIABLE.match(rel)
        if m:
            per_var[m.group(1)].setdefault(m.group(2), []).append(int(m.group(3)))
            continue
        m = _CLIMATOLOGY.match(rel)
        if m:
            clim.setdefault(m.group(1), {})[_CLIMATOLOGY_KIND[m.group(2)]] = rel
    if not (daily_years or per_var["monthly"] or per_var["yearly"] or clim):
        raise OpenghmError(f"no WBM output files (daily/, monthly/, yearly/, climatology/) under {source.run}")

    mt_name, display = load_mt(source, files, warnings)

    # ---- what the files themselves say: grid, time axes, variable names and attributes --------------
    grid: Optional[netcdf.Grid] = None
    attrs: Dict[str, Tuple[str, str]] = {}
    daily_names: List[str] = []

    def opened(rel: str):
        try:
            return source.open_nc(rel)
        except OpenghmError as e:
            warnings.append(str(e))
            return None

    def read_times(rel: str):
        h5 = opened(rel)
        if h5 is None:
            return []
        try:
            return netcdf.read_times(h5)
        except OpenghmError as e:
            warnings.append(f"{rel}: {e}")
            return []
        finally:
            source.close_nc(h5)

    def remember(h5, only: Optional[str] = None) -> None:
        for name, ds in netcdf.data_variables(h5).items():
            if only is None or name == only:
                attrs.setdefault(name, (netcdf.text_attr(ds.attrs.get("long_name", "")),
                                        netcdf.text_attr(ds.attrs.get("units", ""))))

    if daily_years:
        h5 = opened(file_path("daily", "", min(daily_years)))
        if h5 is not None:
            try:
                grid = netcdf.read_grid(h5)
                daily_names = list(netcdf.data_variables(h5))
                remember(h5)
            except OpenghmError as e:
                warnings.append(str(e))
            finally:
                source.close_nc(h5)

    resolutions: Dict[str, dict] = {}
    if daily_years:
        times = read_times(file_path("daily", "", min(daily_years))) + read_times(file_path("daily", "", max(daily_years)))
        resolutions["daily"] = {"years": sorted(daily_years), "path": file_path("daily", "")}
        resolutions["daily"].update(_bounds(times))
    for res in ("monthly", "yearly"):
        if not per_var[res]:
            continue
        years = sorted({y for ys in per_var[res].values() for y in ys})
        lo = next(v for v in sorted(per_var[res]) if years[0] in per_var[res][v])
        hi = next(v for v in sorted(per_var[res]) if years[-1] in per_var[res][v])
        times = read_times(file_path(res, lo, years[0])) + read_times(file_path(res, hi, years[-1]))
        resolutions[res] = {"years": years, "path": f"{res}/{{variable}}/wbm_{{year}}.nc"}
        resolutions[res].update(_bounds(times))
    if clim:
        resolutions["climatology"] = {"kinds": [k for k in ("daily", "monthly", "yearly") if any(k in v for v in clim.values())]}

    names = set(daily_names) | set(per_var["monthly"]) | set(per_var["yearly"]) | set(clim)
    # A variable with no daily file: its attributes (and the grid, when no daily file gave it) come
    # from its first monthly or yearly file, or its climatology file.
    for name in sorted(names - set(attrs)):
        rel = next((file_path(res, name, min(per_var[res][name])) for res in ("monthly", "yearly") if name in per_var[res]), None)
        rel = rel or next(iter(sorted(clim.get(name, {}).values())), None)
        h5 = opened(rel) if rel else None
        if h5 is None:
            continue
        try:
            if grid is None:
                grid = netcdf.read_grid(h5)
            remember(h5, only=name)
        except OpenghmError as e:
            warnings.append(f"{rel}: {e}")
        finally:
            source.close_nc(h5)

    # ---- the variables: the MT's order first, then the rest ------------------------------------------
    order: List[str] = []
    for var, _series in display:
        if var in names and var not in order:
            order.append(var)
    order += sorted(names - set(order))

    variables = []
    for name in order:
        long_name, units = attrs.get(name, ("", ""))
        per: Dict[str, dict] = {}
        if name in daily_names:
            per["daily"] = {"years": sorted(daily_years), "path": file_path("daily", name),
                            "display": _display(display, name, "daily")}
        for res in ("monthly", "yearly"):
            if name in per_var[res]:
                per[res] = {"years": sorted(per_var[res][name]), "path": file_path(res, name),
                            "display": _display(display, name, res)}
        if name in clim:
            per["climatology"] = {
                kind: {"path": rel, "display": _display(display, name, _CLIMATOLOGY_SERIES[kind])}
                for kind, rel in sorted(clim[name].items())
            }
        variables.append({"name": name, "longName": long_name or None, "units": units or None, "resolutions": per})

    return {
        "source": source.describe(),
        "mt": mt_name,
        "grid": None if grid is None else _grid_json(grid),
        "resolutions": resolutions,
        "variables": variables,
        "files": {"count": len(files), "bytes": sum(files.values())},
        "warnings": warnings,
    }


def _display(display: Dict[Tuple[str, str], mt.Display], name: str, series: str) -> Optional[dict]:
    d = display.get((name, series))
    return None if d is None else d.to_dict()


def _bounds(times) -> dict:
    if not times:
        return {"first": None, "last": None}
    return {"first": min(times).isoformat(), "last": max(times).isoformat()}


def describe(result: dict) -> List[str]:
    """The inventory as lines for a terminal."""
    src = result["source"]
    lines = [f"{src['kind']}: {src.get('path') or src.get('id')}  run {src['run']}  ({result['files']['count']} files, "
             f"{result['files']['bytes'] / 1e9:.2f} GB)"]
    g = result["grid"]
    if g:
        b = g["bounds"]
        lines.append(f"grid: {g['rows']} x {g['cols']} cells of {g['cellSize']:.6f} deg, "
                     f"{b['west']:.4f}..{b['east']:.4f} E, {b['south']:.4f}..{b['north']:.4f} N, stored {g['latOrder']}")
    for res, info in result["resolutions"].items():
        if res == "climatology":
            lines.append(f"{res}: {', '.join(info['kinds'])}")
        else:
            ys = info["years"]
            lines.append(f"{res}: {ys[0]}-{ys[-1]} ({len(ys)} years), {info['first']} .. {info['last']}")
    lines.append(f"{len(result['variables'])} variables:")
    for v in result["variables"]:
        have = ",".join(v["resolutions"])
        lines.append(f"  {v['name']:<22} {(v['units'] or ''):<10} {have}   {v['longName'] or ''}")
    for w in result["warnings"]:
        lines.append(f"warning: {w}")
    return lines
