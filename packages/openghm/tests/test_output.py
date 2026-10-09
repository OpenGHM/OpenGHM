"""``openghm output inventory`` and ``subset`` (ADR 0033) on small synthetic WBM output.

The files are built here with h5py in WBM's layout: ``float v(time, lat, lon)`` with a fill value, ``lat``
stored south to north, one chunk per time step, ``time`` as ``days since 1900-01-01`` (daily files stamp
each day, monthly files the middle of the month, yearly files July 1). The run is a 6 x 8 grid of half
degree cells. The MT is a trimmed copy of a real CONUS run's (``fixtures/output/wbm_test.MT.csv``).
A snapshot is read through a local HTTP server that plays the bucket: ListObjectsV2 with a delimiter,
``HEAD`` and ``Range`` requests.

Needs the optional extra (``pip install -e '.[output,dev]'``); without it the module is skipped.
"""

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import threading
import urllib.parse
import zlib
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from xml.sax.saxutils import escape

import pytest

np = pytest.importorskip("numpy")
h5py = pytest.importorskip("h5py")
pytest.importorskip("h5netcdf")

from click.testing import CliRunner  # noqa: E402

from openghm import Config, fetch  # noqa: E402
from openghm.cli.main import cli  # noqa: E402
from openghm.errors import OpenghmError, OutputMissing  # noqa: E402
from openghm.output import image, inventory, limits, mt, netcdf, subset  # noqa: E402
from openghm.output.rangefile import Http, HttpStatusError, RangeFile  # noqa: E402
from openghm.output.source import FolderSource, SnapshotSource  # noqa: E402

FIXTURE_MT = Path(__file__).parent / "fixtures" / "output" / "wbm_test.MT.csv"
EPOCH = date(1900, 1, 1)
ROWS, COLS = 6, 8
LAT = 40.25 + 0.5 * np.arange(ROWS)          # south to north, as WBM stores it
LON = -100.75 + 0.5 * np.arange(COLS)
FILL = np.float32(-9999)
SNAPSHOT_ID = "ab" * 32


# ---- building a run ------------------------------------------------------------------------------


def write_nc(path: Path, times, variables: dict, *, resolution: str, lat=LAT, lon=LON, units: dict = None) -> None:
    """A WBM-like file: ``variables`` is ``{name: float32 array (time, lat, lon)}``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    units = units or {}
    with h5py.File(path, "w") as f:
        t = f.create_dataset("time", data=np.array([(d - EPOCH).days for d in times], dtype="i4"))
        t.attrs["units"] = "days since 1900-01-01"
        t.attrs["calendar"] = "standard"
        t.attrs["resolution"] = resolution
        f.create_dataset("lat", data=lat).attrs["units"] = "degrees_north"
        f.create_dataset("lon", data=lon).attrs["units"] = "degrees_east"
        crs = f.create_dataset("crs", shape=(), dtype="S1")
        crs.attrs["GeoTransform"] = "-101.0 0.5 0 43.0 0 -0.5"
        crs.attrs["srs_ref"] = "epsg:4326"
        for name, data in variables.items():
            ds = f.create_dataset(name, data=data.astype("f4"), chunks=(1, len(lat), len(lon)),
                                  compression="gzip", compression_opts=1)
            ds.attrs["_FillValue"] = FILL
            ds.attrs["missing_value"] = FILL
            ds.attrs["units"] = units.get(name, "mm/day")
            ds.attrs["long_name"] = name.capitalize()
        f.attrs["AggrMethod"] = "average"


def days(year: int, n: int = None):
    n = n or (366 if year % 4 == 0 else 365)
    return [date(year, 1, 1) + timedelta(days=i) for i in range(n)]


def daily_array(n: int, offset: float = 0.0):
    """``v[t, i, j] = t + i/10 + j/1000``, with a fill at (t=1, 0, 0)."""
    t = np.arange(n)[:, None, None]
    i = np.arange(ROWS)[None, :, None]
    j = np.arange(COLS)[None, None, :]
    a = (t + i / 10.0 + j / 1000.0 + offset).astype("f4")
    a[1, 0, 0] = FILL
    return a


def make_run(root: Path, sim: str = "sim-1", run: str = "run1", mt_text: str = None) -> Path:
    """``<root>/<sim>/wbm_output/<run>/`` with daily 2000 and 2002 (none for 2001), monthly and yearly
    runoff 2000, a monthly-only ``extra``, climatology placeholders, and the MT."""
    work = root / sim
    out = work / "wbm_output" / run
    write_nc(out / "daily" / "wbm_2000.nc", days(2000),
             {"runoff": daily_array(366), "discharge": daily_array(366, 100.0)}, resolution="daily")
    write_nc(out / "daily" / "wbm_2002.nc", days(2002),
             {"runoff": daily_array(365, 1000.0), "discharge": daily_array(365, 1100.0)}, resolution="daily")
    # Monthly: stored per day, increasing northwards so that the map shows the lat flip: the displayed
    # value (x 30 mm/month) runs 0..100 up the grid.
    north = (np.arange(ROWS) / (ROWS - 1) * (100.0 / 30.0)).astype("f4")
    monthly = np.broadcast_to(north[None, :, None], (12, ROWS, COLS)).copy()
    monthly[:, 2, 3] = FILL
    mids = [date(2000, m, 16) for m in range(1, 13)]
    write_nc(out / "monthly" / "runoff" / "wbm_2000.nc", mids, {"runoff": monthly, "runoff_sigma": monthly * 0}, resolution="monthly")
    write_nc(out / "yearly" / "runoff" / "wbm_2000.nc", [date(2000, 7, 1)], {"runoff": monthly[:1]}, resolution="yearly")
    write_nc(out / "monthly" / "extra" / "wbm_2000.nc", mids, {"extra": monthly * 2}, resolution="monthly", units={"extra": "kg"})
    for name in ("wbm_runoff_dc.nc", "wbm_runoff_mc.nc"):
        (out / "climatology").mkdir(parents=True, exist_ok=True)
        (out / "climatology" / name).write_bytes(b"x")
    (out / "cell_area").mkdir(exist_ok=True)
    (out / "cell_area" / "full_cell_area.nc").write_bytes(b"x")
    (out / "wbm_test.MT.csv").write_text(mt_text if mt_text is not None else FIXTURE_MT.read_text())
    return work


@pytest.fixture
def work(tmp_path) -> Path:
    return make_run(tmp_path)


def source_of(work: Path) -> FolderSource:
    return FolderSource(str(work))


def cut(src, variable="runoff", resolution="daily", fmt="json", **kw):
    return subset.subset(src, subset.Request(variable=variable, resolution=resolution, format=fmt, **kw))


# ---- the MT --------------------------------------------------------------------------------------


def test_the_mt_gives_display_units_scale_and_legend_for_the_output_records_only():
    records = mt.parse(FIXTURE_MT.read_text())
    daily = records[("runoff", "daily")]
    monthly = records[("runoff", "monthly")]
    assert (daily.units, daily.scale, daily.offset) == ("mm/day", 1.0, 0.0)
    assert daily.legend == mt.Legend("DarkBlue", 0.0, 20.0, False)
    assert (monthly.units, monthly.scale) == ("mm/month", 30.0)
    assert records[("runoff", "yearly")].scale == 365.0
    # a record whose files do not exist is still a record: the inventory decides what exists
    assert ("streamAge", "daily") in records and ("runoff", "monthly_clim") in records
    log = records[("discharge", "daily")]
    assert log.legend == mt.Legend("Rainbow", 0.1, 100000.0, True) and log.processing == "log:zero"
    assert log.round == "%.3f"
    # the input datasets after the blank line are not output
    assert ("PRECTOTCORR", "daily") not in records


def test_a_legend_that_does_not_parse_is_none():
    assert mt.parse_legend("") is None
    assert mt.parse_legend("DarkBlue(20:0)") is None
    assert mt.parse_legend("DarkBlue(1:1e6)Log") == mt.Legend("DarkBlue", 1.0, 1e6, True)
    assert mt.parse("not an mt") == {}


# ---- the inventory -------------------------------------------------------------------------------


def test_inventory_lists_what_exists_not_what_the_mt_claims(work):
    inv = inventory.inventory(source_of(work))
    names = [v["name"] for v in inv["variables"]]
    # MT order first (runoff, discharge), then what the MT does not know; streamAge has no file
    assert names == ["runoff", "discharge", "extra"]
    runoff = inv["variables"][0]
    assert runoff["longName"] == "Runoff" and runoff["units"] == "mm/day"
    assert runoff["resolutions"]["daily"]["years"] == [2000, 2002]      # 2001 is missing
    assert runoff["resolutions"]["daily"]["path"] == "daily/wbm_{year}.nc"
    assert runoff["resolutions"]["monthly"]["years"] == [2000]
    assert runoff["resolutions"]["monthly"]["path"] == "monthly/runoff/wbm_{year}.nc"
    assert runoff["resolutions"]["monthly"]["display"]["units"] == "mm/month"
    assert runoff["resolutions"]["monthly"]["display"]["scale"] == 30.0
    assert runoff["resolutions"]["yearly"]["years"] == [2000]
    # climatology: dc and mc exist, yc does not, though the MT lists all three
    assert sorted(runoff["resolutions"]["climatology"]) == ["daily", "monthly"]
    assert runoff["resolutions"]["climatology"]["daily"]["path"] == "climatology/wbm_runoff_dc.nc"
    assert "yearly" not in runoff["resolutions"]["climatology"]
    discharge = inv["variables"][1]
    assert sorted(discharge["resolutions"]) == ["daily"]                 # the MT's monthly record has no file
    assert discharge["resolutions"]["daily"]["display"]["legend"] == {"ramp": "Rainbow", "min": 0.1, "max": 100000.0, "log": True}
    extra = inv["variables"][2]
    assert extra["units"] == "kg" and extra["resolutions"]["monthly"]["display"] is None
    assert list(extra["resolutions"]) == ["monthly"]


def test_inventory_describes_the_grid_the_time_axes_and_the_files(work):
    inv = inventory.inventory(source_of(work))
    g = inv["grid"]
    assert (g["rows"], g["cols"], g["crs"], g["cellSize"]) == (ROWS, COLS, "EPSG:4326", 0.5)
    assert g["bounds"] == {"west": -101.0, "south": 40.0, "east": -97.0, "north": 43.0}
    assert g["latOrder"] == "south-to-north"
    r = inv["resolutions"]
    assert (r["daily"]["first"], r["daily"]["last"]) == ("2000-01-01", "2002-12-31")
    assert r["daily"]["years"] == [2000, 2002]
    assert (r["monthly"]["first"], r["monthly"]["last"]) == ("2000-01-16", "2000-12-16")
    assert (r["yearly"]["first"], r["yearly"]["last"]) == ("2000-07-01", "2000-07-01")
    assert r["climatology"] == {"kinds": ["daily", "monthly"]}
    assert inv["mt"] == "wbm_test.MT.csv"           # named for the init's ID, not the directory
    # daily 2, monthly 2 (runoff, extra), yearly 1, climatology 2, cell_area 1, the MT
    assert inv["files"]["count"] == 2 + 2 + 1 + 2 + 1 + 1 and inv["warnings"] == []
    assert inv["source"]["run"] == "run1"
    json.dumps(inv)


def test_inventory_without_an_mt_lists_the_variables_with_no_display(work):
    (work / "wbm_output" / "run1" / "wbm_test.MT.csv").unlink()
    inv = inventory.inventory(source_of(work))
    assert inv["mt"] is None
    assert [v["name"] for v in inv["variables"]] == ["discharge", "extra", "runoff"]
    assert all(r["display"] is None for v in inv["variables"] for k, r in v["resolutions"].items() if k != "climatology")


def test_a_file_that_cannot_be_opened_is_a_warning_not_a_failure(work):
    (work / "wbm_output" / "run1" / "daily" / "wbm_2002.nc").write_bytes(b"not hdf5")
    inv = inventory.inventory(source_of(work))
    assert inv["resolutions"]["daily"]["years"] == [2000, 2002]
    assert inv["resolutions"]["daily"]["last"] == "2000-12-31"
    assert any("wbm_2002.nc" in w for w in inv["warnings"])


def test_folder_source_finds_the_run_and_refuses_when_there_is_none(tmp_path, work):
    assert source_of(work).run == "run1"
    with pytest.raises(OutputMissing, match="does not exist"):
        FolderSource(str(tmp_path / "nothing"))
    (tmp_path / "empty").mkdir()
    with pytest.raises(OutputMissing, match="wbm_output"):
        FolderSource(str(tmp_path / "empty"))
    shutil.copytree(work / "wbm_output" / "run1", work / "wbm_output" / "run2")
    with pytest.raises(OpenghmError, match="several runs.*--run"):
        FolderSource(str(work))
    assert FolderSource(str(work), run="run2").run == "run2"
    with pytest.raises(OpenghmError, match="no run 'zzz'"):
        FolderSource(str(work), run="zzz")
    # the directory named for the simulation is the one a plain call takes
    shutil.copytree(work / "wbm_output" / "run1", work / "wbm_output" / "sim-1")
    assert FolderSource(str(work)).run == "sim-1"


# ---- subset: json --------------------------------------------------------------------------------


def stored(work: Path, rel: str, name: str, *index):
    """``name`` of the run's file ``rel`` read straight with h5py (and the file closed again)."""
    with h5py.File(work / "wbm_output" / "run1" / rel, "r") as f:
        return f[name][index] if index else f[name][:]


def cell(row, col):
    """``(lon, lat)`` of a cell's centre."""
    return float(LON[col]), float(LAT[row])


def test_a_point_series_is_the_cells_values_and_fill_is_null(work):
    row, col = 3, 5
    lon, lat = cell(row, col)
    a = cut(source_of(work), "runoff", "daily", "json", start="2000-01-01", end="2000-01-05", point=(lon + 0.1, lat - 0.1))
    assert (a["point"]["row"], a["point"]["col"]) == (row, col)
    assert a["point"]["cellLon"] == lon and a["point"]["cellLat"] == lat
    assert a["times"] == [f"2000-01-0{d}" for d in range(1, 6)]
    expected = [float(str(np.float32(t + row / 10.0 + col / 1000.0))) for t in range(5)]
    assert a["values"] == expected
    assert a["units"] == "mm/day" and a["valuesIn"] == "stored" and a["fill"] == -9999.0
    assert a["period"] == {"first": "2000-01-01", "last": "2000-01-05", "steps": 5}
    # the cell that holds a fill value on day 2 answers null there
    lon0, lat0 = cell(0, 0)
    b = cut(source_of(work), "runoff", "daily", "json", start="2000-01-01", end="2000-01-03", point=(lon0, lat0))
    assert b["values"][1] is None and b["values"][0] == 0.0 and b["values"][2] == 2.0


def test_the_series_value_is_what_h5py_reads_from_that_cell(work):
    a = cut(source_of(work), "discharge", "daily", "json", start="2000-03", point=(-99.3, 42.6))
    r, c = int(np.argmin(abs(LAT - 42.6))), int(np.argmin(abs(LON + 99.3)))
    start = (date(2000, 3, 1) - date(2000, 1, 1)).days
    assert len(a["values"]) == 31
    assert np.allclose(a["values"], stored(work, "daily/wbm_2000.nc", "discharge")[start:start + 31, r, c])


def test_a_start_alone_is_its_own_day_month_or_year(work):
    src = source_of(work)
    assert cut(src, point=cell(2, 2), start="2000-06-15")["period"]["steps"] == 1
    assert cut(src, point=cell(2, 2), start="2000-06")["period"]["steps"] == 30
    assert cut(src, point=cell(2, 2), start="2000")["period"]["steps"] == 366
    # a month is one monthly step whichever day of it is named; mid-month stamps are overlapped, not matched
    m = cut(src, resolution="monthly", point=cell(2, 2), start="2000-03-31")
    assert m["times"] == ["2000-03-16"]
    assert cut(src, resolution="monthly", point=cell(2, 2), start="2000-03", end="2000-05")["period"]["steps"] == 3
    assert cut(src, resolution="yearly", point=cell(2, 2), start="2000-12-31")["times"] == ["2000-07-01"]


def test_display_applies_the_scale_and_needs_an_mt_record(work):
    src = source_of(work)
    stored = cut(src, resolution="monthly", point=cell(4, 1), start="2000-01")["values"][0]
    shown = cut(src, resolution="monthly", point=cell(4, 1), start="2000-01", display=True)
    assert shown["valuesIn"] == "display" and shown["units"] == "mm/month"
    assert shown["values"][0] == pytest.approx(stored * 30, rel=1e-6)
    with pytest.raises(OpenghmError, match="no display settings"):
        cut(src, "extra", "monthly", "json", point=cell(1, 1), start="2000-01", display=True)


def test_a_missing_year_is_refused_with_the_years_that_exist(work):
    src = source_of(work)
    with pytest.raises(OpenghmError, match=r"no daily file for 'runoff' in 2001.*the years it has: 2000, 2002"):
        cut(src, point=cell(1, 1), start="2000-12-01", end="2002-01-31")
    with pytest.raises(OpenghmError, match="2001"):
        cut(src, point=cell(1, 1))             # no dates: the whole output, which has a hole
    with pytest.raises(OpenghmError, match="no daily file.*1999"):
        cut(src, point=cell(1, 1), start="1999-12-31", end="2000-01-02")
    assert cut(src, point=cell(1, 1), start="2002-02-01", end="2002-02-02")["period"]["steps"] == 2


def test_requests_that_do_not_hold_together_are_refused(work):
    src = source_of(work)
    for kw, msg in [
        (dict(fmt="json"), "needs --point"),
        (dict(fmt="json", point=cell(1, 1), bbox=(-101, 40, -99, 42)), "not --bbox"),
        (dict(fmt="png", point=cell(1, 1), start="2000-01-01"), "--point is for"),
        (dict(fmt="nc", start="2000-01-01"), "needs --out"),
        (dict(fmt="json", point=cell(1, 1), out="x"), "--out is for"),
        (dict(fmt="json", point=cell(1, 1), width=10), "--width and --height are for"),
        (dict(fmt="json", point=(0, 0), start="2000-01-01"), "outside the grid"),
        (dict(fmt="json", point=cell(1, 1), start="2000-02-30"), "not a calendar date"),
        (dict(fmt="json", point=cell(1, 1), start="2000/01"), "not a date"),
        (dict(fmt="json", point=cell(1, 1), start="2000-05", end="2000-04"), "before it starts"),
        (dict(fmt="png", start="2000-01-01", bbox=(-99, 40, -100, 42)), "W < E"),
        (dict(fmt="json", point=cell(1, 1), start="1999-01-01", end="1999-01-02"), "1999"),
    ]:
        kw.setdefault("fmt", "json")
        fmt = kw.pop("fmt")
        with pytest.raises(OpenghmError, match=msg):
            cut(src, fmt=fmt, **kw)
    with pytest.raises(OpenghmError, match="no variable 'nope'|has no daily"):
        cut(src, "nope", point=cell(1, 1), start="2000-01-01", fmt="json")
    with pytest.raises(OpenghmError, match="no monthly output of variable 'discharge'"):
        cut(src, "discharge", "monthly", point=cell(1, 1), start="2000-01", fmt="json")
    with pytest.raises(OpenghmError, match="not a variable name"):
        cut(src, "../x", "monthly", point=cell(1, 1), start="2000-01", fmt="json")
    with pytest.raises(OpenghmError, match="resolution must be"):
        cut(src, resolution="climatology", point=cell(1, 1), fmt="json")


# ---- subset: nc ----------------------------------------------------------------------------------


def test_an_nc_subset_is_a_netcdf_file_of_one_variable_over_the_box(work, tmp_path):
    out = tmp_path / "dl" / "sub.nc"
    a = cut(source_of(work), "runoff", "daily", "nc", start="2000-01-03", end="2000-01-06",
            bbox=(-100.1, 40.9, -98.4, 42.1), out=str(out))
    # cell centres in the box: lon -99.75, -99.25, -98.75 ; lat 41.25, 41.75
    assert (a["rows"], a["cols"], a["latOrder"]) == (2, 3, "south-to-north")
    assert a["path"] == str(out) and a["bytes"] == out.stat().st_size and a["period"]["steps"] == 4
    assert not os.path.exists(str(out) + ".part")
    assert a["bbox"] == {"west": -100.0, "south": 41.0, "east": -98.5, "north": 42.0}
    with h5py.File(out) as f:
        assert [k for k, v in f.items() if v.ndim == 3] == ["runoff"]          # one data variable
        assert sorted(f) == ["crs", "lat", "lon", "runoff", "time"]
        v = f["runoff"]
        assert v.shape == (4, 2, 3) and v.dtype == np.float32
        assert v.attrs["units"] == b"mm/day" or v.attrs["units"] == "mm/day"
        assert float(v.attrs["_FillValue"][0]) == -9999.0 and float(v.attrs["missing_value"][0]) == -9999.0
        assert np.allclose(f["lat"][:], [41.25, 41.75]) and np.allclose(f["lon"][:], [-99.75, -99.25, -98.75])
        assert list(f["time"][:]) == [(date(2000, 1, d) - EPOCH).days for d in (3, 4, 5, 6)]
        assert np.array_equal(v[:], stored(work, "daily/wbm_2000.nc", "runoff")[2:6, 2:4, 2:5])
        text = lambda x: x.decode() if isinstance(x, bytes) else str(x)   # noqa: E731
        assert "south-to-north" in text(f.attrs["openghm_lat_order"])
        assert text(f.attrs["openghm_run"]) == "run1" and text(f.attrs["Conventions"]) == "CF-1.8"
        assert text(f["time"].attrs["units"]) == "days since 1900-01-01"
        gt = [float(x) for x in text(f["crs"].attrs["GeoTransform"]).split()]
        assert gt == [-100.0, 0.5, 0.0, 42.0, 0.0, -0.5]


@pytest.mark.skipif(shutil.which("ncdump") is None, reason="ncdump is not installed")
def test_an_nc_subset_opens_with_ncdump(work, tmp_path):
    out = tmp_path / "sub.nc"
    cut(source_of(work), "runoff", "daily", "nc", start="2000-01-03", end="2000-01-04", out=str(out))
    header = subprocess.run(["ncdump", "-h", str(out)], capture_output=True, text=True, check=True).stdout
    assert "float runoff(time, lat, lon)" in header and "_FillValue = -9999.f" in header
    assert header.count("(time, lat, lon)") == 1


def test_an_nc_subset_streams_in_blocks_across_years_and_files(work, tmp_path, monkeypatch):
    monkeypatch.setattr(limits, "WRITE_BLOCK_BYTES", ROWS * COLS * 4 * 3)        # three steps at a time
    out = tmp_path / "all.nc"
    cut(source_of(work), "runoff", "daily", "nc", start="2002-01-01", end="2002-01-10", out=str(out))
    with h5py.File(out) as f:
        assert np.array_equal(f["runoff"][:], stored(work, "daily/wbm_2002.nc", "runoff")[:10])


def test_a_failed_nc_write_leaves_no_file(work, tmp_path, monkeypatch):
    out = tmp_path / "x.nc"

    def broken(*a, **k):
        yield 0, np.zeros((1, ROWS, COLS), dtype="f4")
        raise OSError("disk full")

    monkeypatch.setattr(subset, "_blocks", broken)
    with pytest.raises(OSError):
        cut(source_of(work), "runoff", "daily", "nc", start="2000-01-03", end="2000-01-04", out=str(out))
    assert os.listdir(tmp_path) == [d for d in os.listdir(tmp_path) if d != "x.nc" and d != "x.nc.part"]


def test_a_box_with_no_cell_centre_is_refused(work, tmp_path):
    with pytest.raises(OpenghmError, match="no cell centre lies in the box"):
        cut(source_of(work), "runoff", "daily", "nc", start="2000-01-03", bbox=(-100.1, 40.3, -99.9, 40.4), out=str(tmp_path / "x.nc"))
    with pytest.raises(OpenghmError, match="no cell centre"):
        cut(source_of(work), "runoff", "daily", "nc", start="2000-01-03", bbox=(10, 10, 20, 20), out=str(tmp_path / "x.nc"))


# ---- subset: png ---------------------------------------------------------------------------------


def decode_png(data: bytes):
    """``(width, height, rgba array)`` of the PNGs this module writes (8-bit RGBA, filter 0)."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, size = 8, b"", None
    while pos < len(data):
        n, tag = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        assert struct.unpack(">I", data[pos + 8 + n:pos + 12 + n])[0] == zlib.crc32(tag + body) & 0xFFFFFFFF
        if tag == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            assert (depth, ctype) == (8, 6)
            size = (w, h)
        elif tag == b"IDAT":
            idat += body
        pos += 12 + n
    w, h = size
    raw = np.frombuffer(zlib.decompress(idat), dtype=np.uint8).reshape(h, 1 + 4 * w)
    assert (raw[:, 0] == 0).all()
    return w, h, raw[:, 1:].reshape(h, w, 4)


def test_a_map_is_north_up_coloured_by_the_legend_with_fill_transparent(work, tmp_path):
    out = tmp_path / "m.png"
    a = cut(source_of(work), "runoff", "monthly", "png", start="2000-03", out=str(out))
    w, h, rgba = decode_png(out.read_bytes())
    assert (w, h) == (COLS, ROWS) == (a["width"], a["height"])      # one pixel per cell by default
    assert a["path"] == str(out) and a["base64"] is None and a["bytes"] == out.stat().st_size
    ramp = image.lut("DarkBlue")
    # stored value runs 0..100/30 from the south row to the north row; x30 against DarkBlue(0:100):
    # the top image row is the north (the last stored row) and takes the ramp's end, the bottom the start
    assert tuple(rgba[0, 0]) == (*ramp[255], 255) and tuple(rgba[ROWS - 1, 0]) == (*ramp[0], 255)
    mid = rgba[ROWS - 1 - 2, 5]                                   # south-to-north row 2
    assert tuple(mid[:3]) == tuple(ramp[int(np.floor(2 / (ROWS - 1) * 255 + 0.5))]) and mid[3] == 255
    assert rgba[ROWS - 1 - 2, 3, 3] == 0                          # the fill cell (row 2, col 3) is transparent
    assert a["units"] == "mm/month" and a["time"] == "2000-03-16" and a["northUp"] is True
    lg = a["legend"]
    assert (lg["ramp"], lg["rampUsed"], lg["min"], lg["max"], lg["log"], lg["auto"]) == ("DarkBlue", "DarkBlue", 0.0, 100.0, False, False)
    assert lg["colors"][0] == "#f7fbff" and len(lg["colors"]) == 9
    assert a["valueRange"] == {"min": pytest.approx(0.0, abs=1e-3), "max": pytest.approx(100.0, rel=1e-5)}
    assert a["bbox"] == {"west": -101.0, "south": 40.0, "east": -97.0, "north": 43.0}


def test_a_map_without_out_is_base64_in_the_answer(work):
    a = cut(source_of(work), "runoff", "monthly", "png", start="2000-03")
    import base64

    w, h, _ = decode_png(base64.b64decode(a["base64"]))
    assert (w, h) == (COLS, ROWS) and a["path"] is None


def test_a_map_over_a_box_at_a_size_samples_the_cell_each_pixel_centre_falls_in(work):
    import base64

    a = cut(source_of(work), "runoff", "monthly", "png", start="2000-03", bbox=(-101, 40, -99, 41.5), width=8, height=6)
    w, h, rgba = decode_png(base64.b64decode(a["base64"]))
    assert (w, h) == (8, 6)
    # the box covers cols 0-3 and rows 0-2: two pixels across per cell, two down; the top two image rows are row 2 (fill at col 3)
    assert (rgba[0:2, 6:8, 3] == 0).all() and (rgba[0:2, 0:6, 3] == 255).all()
    assert (rgba[2:4, :, 3] == 255).all()
    # width alone keeps the box's shape
    b = cut(source_of(work), "runoff", "monthly", "png", start="2000-03", bbox=(-101, 40, -99, 41.5), width=40)
    assert (b["width"], b["height"]) == (40, 30)
    # outside the grid is transparent: the box reaches two columns beyond the west edge
    c = cut(source_of(work), "runoff", "monthly", "png", start="2000-03", bbox=(-102, 40, -100, 41), width=4, height=2)
    _, _, px = decode_png(base64.b64decode(c["base64"]))
    assert (px[:, :2, 3] == 0).all() and (px[:, 2:, 3] == 255).all()
    with pytest.raises(OpenghmError, match="outside the grid"):
        cut(source_of(work), "runoff", "monthly", "png", start="2000-03", bbox=(10, 10, 20, 20))


def test_a_log_legend_leaves_zero_and_negative_values_transparent(work):
    import base64

    a = cut(source_of(work), "discharge", "daily", "png", start="2000-01-01")
    lg = a["legend"]
    assert (lg["ramp"], lg["min"], lg["max"], lg["log"]) == ("Rainbow", 0.1, 100000.0, True)
    _, _, rgba = decode_png(base64.b64decode(a["base64"]))
    # discharge day 0 is 100 + i/10 + j/1000 > 0 everywhere but the cell (row 0, col 0) of day 1 is fill, not on day 0
    assert (rgba[:, :, 3] == 255).all()
    assert tuple(rgba[ROWS - 1, 0][:3]) == tuple(image.lut("Rainbow")[int(np.floor((np.log10(100.0) + 1) / 6 * 255 + 0.5))])
    colors = image.colorize(np.array([[0.0, -1.0, 10.0]]), np.ones((1, 3), bool), 0.1, 1e5, True, "Rainbow")
    assert list(colors[0, :, 3]) == [0, 0, 255]


def test_a_variable_the_mt_does_not_describe_is_drawn_over_its_own_range(work):
    a = cut(source_of(work), "extra", "monthly", "png", start="2000-01")
    lg = a["legend"]
    assert lg["auto"] is True and lg["rampUsed"] == "Rainbow" and lg["log"] is False
    assert (lg["min"], lg["max"]) == (a["valueRange"]["min"], a["valueRange"]["max"])
    assert a["units"] == "kg"


def test_an_unknown_ramp_is_drawn_with_the_fallback_and_says_so(tmp_path):
    text = FIXTURE_MT.read_text().replace("DarkBlue(0:100)", "Plasma(0:100)")
    work = make_run(tmp_path, mt_text=text)
    a = cut(source_of(work), "runoff", "monthly", "png", start="2000-03")
    assert (a["legend"]["ramp"], a["legend"]["rampUsed"], a["legend"]["auto"]) == ("Plasma", "Rainbow", False)


def test_a_map_is_one_time_step(work):
    with pytest.raises(OpenghmError, match="one time step; this period holds 31"):
        cut(source_of(work), "runoff", "daily", "png", start="2000-01")
    with pytest.raises(OpenghmError, match="one time step; this period holds 12"):
        cut(source_of(work), "runoff", "monthly", "png", start="2000")


def test_every_ramp_has_a_256_level_table_and_ends_where_it_should():
    for name in image.RAMPS:
        table = image.lut(name)
        assert table.shape == (256, 3) and table.dtype == np.uint8
    assert tuple(image.lut("RainbowRB")[0]) == tuple(image.lut("RainbowBR")[255])
    assert image.resolve_ramp("darkblue") == ("DarkBlue", True)
    assert image.resolve_ramp("Plasma") == ("Rainbow", False)


# ---- limits --------------------------------------------------------------------------------------


def test_a_call_over_the_cell_limit_is_refused_before_anything_is_read(work, monkeypatch):
    monkeypatch.setattr(limits, "MAX_CELLS_READ", 100 * ROWS * COLS)
    src = source_of(work)
    with pytest.raises(OpenghmError, match=r"reads 0 million cells \(366 time steps of 48 cells.*at most 0 million"):
        cut(src, point=cell(1, 1), start="2000")
    assert cut(src, point=cell(1, 1), start="2000-01", end="2000-03")["read"] == {"cells": 91 * ROWS * COLS, "limit": 100 * ROWS * COLS}


def test_the_cells_a_call_reads_are_whole_chunks_whatever_the_area():
    class Ds:
        chunks = (1, 580, 1440)
    # Global: one pixel for a year touches 365 chunks of 835,200 cells; a bounding box in two chunks touches both
    assert netcdf.cells_read(Ds, 365, (100, 101), (100, 101)) == 365 * 580 * 1440
    assert netcdf.cells_read(Ds, 1, (500, 700), (0, 1)) == 2 * 580 * 1440
    assert netcdf.cells_read(Ds, 1, (0, 1740), (0, 4320)) == 9 * 580 * 1440

    class Whole:
        chunks = None
    assert netcdf.cells_read(Whole, 3, (0, 2), (0, 5)) == 3 * 2 * 5


def test_an_nc_over_the_size_limit_is_refused(work, tmp_path, monkeypatch):
    monkeypatch.setattr(limits, "MAX_NC_BYTES", 10 * ROWS * COLS * 4)
    with pytest.raises(OpenghmError, match=r"would hold 0\.0 GiB uncompressed \(20 steps x 6 x 8 cells\)"):
        cut(source_of(work), "runoff", "daily", "nc", start="2000-01-01", end="2000-01-20", out=str(tmp_path / "x.nc"))
    assert not (tmp_path / "x.nc").exists()
    cut(source_of(work), "runoff", "daily", "nc", start="2000-01-01", end="2000-01-10", out=str(tmp_path / "x.nc"))


def test_a_map_over_the_size_limit_is_refused(work, monkeypatch):
    with pytest.raises(OpenghmError, match="between 1 and 4096"):
        cut(source_of(work), "runoff", "monthly", "png", start="2000-03", width=5000)
    monkeypatch.setattr(limits, "MAX_IMAGE_PIXELS", 100)
    with pytest.raises(OpenghmError, match="at most 100 pixels"):
        cut(source_of(work), "runoff", "monthly", "png", start="2000-03", width=20, height=20)
    # the default (one pixel per cell, 48) fits; a bigger grid is shrunk to fit rather than refused
    a = cut(source_of(work), "runoff", "monthly", "png", start="2000-03", bbox=(-101, 40, -97, 43))
    assert a["width"] * a["height"] <= 100


# ---- HTTP: a snapshot's output through a bucket --------------------------------------------------


class Bucket:
    """A bucket on a local HTTP server: ListObjectsV2 with prefix, delimiter and pages of 4, HEAD and ranged GET."""

    def __init__(self, objects: dict):
        self.objects = objects
        self.ranges = []
        self.ignore_range = False
        bucket = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def _send(self, code, body=b"", headers=None, head=False):
                self.send_response(code)
                self.send_header("Content-Length", str(len(body)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                if not head:
                    self.wfile.write(body)

            def do_HEAD(self):
                self.do_GET(head=True)

            def do_GET(self, head=False):
                url = urllib.parse.urlsplit(self.path)
                q = urllib.parse.parse_qs(url.query)
                if url.path == "/openghm":
                    return self._list(q)
                key = urllib.parse.unquote(url.path[len("/openghm/"):])
                body = bucket.objects.get(key)
                if body is None:
                    return self._send(404, b"", head=head)
                rng = self.headers.get("Range")
                if rng and not bucket.ignore_range:
                    a, b = rng[len("bytes="):].split("-")
                    a, b = int(a), min(int(b), len(body) - 1)
                    bucket.ranges.append((key, a, b))
                    return self._send(206, body[a:b + 1], {"Content-Range": f"bytes {a}-{b}/{len(body)}"}, head)
                self._send(200, body, head=head)

            def _list(self, q):
                prefix = q.get("prefix", [""])[0]
                delim = q.get("delimiter", [""])[0]
                token = int(q.get("continuation-token", ["0"])[0])
                files, folders = [], set()
                for k in sorted(bucket.objects):
                    if not k.startswith(prefix):
                        continue
                    rest = k[len(prefix):]
                    if delim and delim in rest:
                        folders.add(prefix + rest.split(delim)[0] + delim)
                    else:
                        files.append(k)
                entries = [("f", k) for k in files] + [("p", p) for p in sorted(folders)]
                page = entries[token:token + 4]
                more = token + 4 < len(entries)
                xml = ['<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
                       f"<IsTruncated>{str(more).lower()}</IsTruncated>"]
                for kind, k in page:
                    if kind == "f":
                        xml.append(f"<Contents><Key>{escape(k)}</Key><Size>{len(bucket.objects[k])}</Size><ETag>&quot;x&quot;</ETag></Contents>")
                    else:
                        xml.append(f"<CommonPrefixes><Prefix>{escape(k)}</Prefix></CommonPrefixes>")
                if more:
                    xml.append(f"<NextContinuationToken>{token + 4}</NextContinuationToken>")
                xml.append("</ListBucketResult>")
                self._send(200, "".join(xml).encode(), {"Content-Type": "application/xml"})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/openghm"
        threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.01), daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def bucket(work):
    """The run as a published snapshot's ``wbm_output/``, plus a file outside it."""
    objects = {f"snapshots/{SNAPSHOT_ID}/metadata.json": b"{}"}
    root = work / "wbm_output"
    for p in root.rglob("*"):
        if p.is_file():
            objects[f"snapshots/{SNAPSHOT_ID}/wbm_output/{p.relative_to(root).as_posix()}"] = p.read_bytes()
    b = Bucket(objects)
    yield b
    b.close()


def test_a_range_file_reads_through_a_block_cache(tmp_path, bucket):
    body = bytes(range(256)) * 4096                      # 1 MiB
    bucket.objects["blob"] = body
    f = RangeFile(f"{bucket.url}/blob", block_size=64 * 1024, cache_blocks=4)
    assert f.size == len(body)                            # a HEAD found it
    assert f.read(10) == body[:10] and f.tell() == 10
    assert f.fetches == 1 and f.fetched_bytes == 64 * 1024
    assert f.read(100) == body[10:110] and f.fetches == 1  # still the same block
    f.seek(200_000)
    assert f.read(5) == body[200_000:200_005]
    f.seek(-5, 2)
    assert f.read() == body[-5:] and f.read() == b""
    # a read across blocks is one request for the run of blocks it lacks
    before = f.fetches
    f.seek(300_000)
    assert f.read(150_000) == body[300_000:450_000] and f.fetches - before == 1
    # least recently used blocks go: with four kept, reading the first again fetches again
    f.seek(0)
    before = f.fetches
    f.read(1)
    f.seek(900_000)
    f.read(1)
    f.seek(0)
    f.read(1)
    assert f.fetches - before >= 2
    buf = bytearray(7)
    f.seek(3)
    assert f.readinto(buf) == 7 and bytes(buf) == body[3:10]
    f.close()


def test_a_server_that_ignores_range_is_an_error(bucket):
    bucket.objects["blob"] = b"x" * 1000
    bucket.ignore_range = True
    with pytest.raises(OpenghmError, match="must support range requests"):
        RangeFile(f"{bucket.url}/blob", size=1000).read(10)


def test_http_status_errors_and_unreachable_servers(bucket):
    http = Http(attempts=2, backoff=0)
    with pytest.raises(HttpStatusError) as e:
        http.get(f"{bucket.url}/missing")
    assert e.value.status == 404
    dead = Http(attempts=2, backoff=0, timeout=2)
    with pytest.raises(OpenghmError, match="cannot reach"):
        dead.get("http://127.0.0.1:9/x")


def test_h5py_reads_an_hdf5_file_over_http_and_fetches_less_than_the_file(bucket, work):
    key = f"snapshots/{SNAPSHOT_ID}/wbm_output/run1/daily/wbm_2000.nc"
    f = RangeFile(f"{bucket.url}/{key}", size=len(bucket.objects[key]), block_size=4096, cache_blocks=64)
    with h5py.File(f, "r") as h5:
        v = h5["runoff"][10, :, :]
    assert np.array_equal(v, stored(work, "daily/wbm_2000.nc", "runoff")[10])
    assert f.fetched_bytes < len(bucket.objects[key])


def snapshot_source(bucket, **kw):
    return SnapshotSource(SNAPSHOT_ID, base_url=bucket.url, **kw)


def test_a_snapshots_inventory_is_the_folders_apart_from_the_source(work, bucket):
    from_folder = inventory.inventory(source_of(work))
    src = snapshot_source(bucket)
    try:
        from_bucket = inventory.inventory(src)
    finally:
        src.close()
    assert from_bucket["source"] == {"kind": "snapshot", "id": SNAPSHOT_ID, "run": "run1",
                                     "base": f"{bucket.url}/snapshots/{SNAPSHOT_ID}/wbm_output/run1/"}
    from_folder.pop("source"), from_bucket.pop("source")
    assert from_bucket == from_folder
    assert bucket.ranges and all(b - a < 1_000_000 for _key, a, b in bucket.ranges)       # ranges, never whole files


def test_a_snapshots_subsets_equal_the_folders(work, bucket, tmp_path):
    src = snapshot_source(bucket)
    try:
        a = cut(src, "runoff", "daily", "json", start="2000-01-03", end="2000-01-06", point=cell(3, 5))
        b = cut(source_of(work), "runoff", "daily", "json", start="2000-01-03", end="2000-01-06", point=cell(3, 5))
        a.pop("source"), b.pop("source")
        assert a == b
        p = cut(src, "runoff", "monthly", "png", start="2000-03")
        q = cut(source_of(work), "runoff", "monthly", "png", start="2000-03")
        assert p["base64"] == q["base64"]
        cut(src, "runoff", "daily", "nc", start="2002-02-01", end="2002-02-03", out=str(tmp_path / "s.nc"))
        with h5py.File(tmp_path / "s.nc") as f:
            assert f["runoff"].shape == (3, ROWS, COLS)
        with pytest.raises(OpenghmError, match="no daily file.*2001"):
            cut(src, "runoff", "daily", "json", start="2001-01-01", point=cell(1, 1))
    finally:
        src.close()


def test_a_snapshot_without_output_is_missing_and_an_id_is_checked(bucket):
    with pytest.raises(OutputMissing, match="published no output"):
        SnapshotSource("cd" * 32, base_url=bucket.url)
    with pytest.raises(OpenghmError, match="not a snapshot id"):
        SnapshotSource("../x", base_url=bucket.url)
    bucket.objects[f"snapshots/{SNAPSHOT_ID}/wbm_output/run2/daily/wbm_2000.nc"] = b"x"
    with pytest.raises(OpenghmError, match="several runs"):
        snapshot_source(bucket)
    assert snapshot_source(bucket, run="run2").run == "run2"


def test_the_bucket_url_comes_from_config_and_defaults_to_the_fetch_one():
    assert Config().s3_base_url == "" and Config.from_dict({"s3_base_url": "http://x/b"}).s3_base_url == "http://x/b"
    assert SnapshotSource.__init__.__defaults__[0] is None


# ---- the command line ----------------------------------------------------------------------------


def run_cli(*args):
    try:
        runner = CliRunner(mix_stderr=False)     # click < 8.2 mixes stderr into stdout unless told not to
    except TypeError:                              # click >= 8.2 always keeps them apart
        runner = CliRunner()
    return runner.invoke(cli, ["output", *args])


def test_cli_inventory_json_and_text(work, tmp_path):
    cfg = tmp_path / "config.toml"
    cfg.write_text("")
    r = run_cli("inventory", str(work), "--config", str(cfg), "--json")
    assert r.exit_code == 0, r.stderr
    data = json.loads(r.stdout)
    assert [v["name"] for v in data["variables"]] == ["runoff", "discharge", "extra"]
    assert sorted(data) == ["files", "grid", "mt", "resolutions", "source", "variables", "warnings"]
    t = run_cli("inventory", str(work), "--config", str(cfg))
    assert t.exit_code == 0 and "3 variables" in t.stdout and "daily: 2000-2002 (2 years)" in t.stdout


def test_cli_exit_codes_distinguish_a_wrong_request_from_no_output_from_a_failure(work, tmp_path, monkeypatch):
    cfg = tmp_path / "config.toml"
    cfg.write_text("")
    common = ["--config", str(cfg)]
    base = ["subset", str(work), "--var", "runoff", "--resolution", "daily", *common]
    ok = run_cli(*base, "--format", "json", "--point", "-99.3,42.6", "--start", "2000-01-01", "--json")
    assert ok.exit_code == 0 and json.loads(ok.stdout)["values"] == [pytest.approx(5 / 10.0 + 3 / 1000.0)]
    refused = run_cli(*base, "--format", "json", "--start", "2000-01-01")        # no --point
    assert refused.exit_code == 2 and refused.stderr.startswith("openghm: --format json needs --point")
    over = run_cli(*base, "--format", "json", "--point", "-99.3,42.6", "--start", "2001-01-01")
    assert over.exit_code == 2 and "no daily file" in over.stderr
    nothing = run_cli("inventory", str(tmp_path / "void"), *common)
    assert nothing.exit_code == 3 and nothing.stderr.startswith("openghm: ")
    both = run_cli("inventory", str(work), "--snapshot", SNAPSHOT_ID, *common)
    assert both.exit_code == 2 and "name the output to read" in both.stderr
    bad = run_cli(*base, "--format", "json", "--point", "x,y")
    assert bad.exit_code == 2 and "expected LON,LAT in degrees" in bad.stderr
    monkeypatch.setattr(netcdf, "AVAILABLE", False)
    missing = run_cli("inventory", str(work), *common)
    assert missing.exit_code == 1 and "pip install 'openghm[output]'" in missing.stderr


def test_cli_reads_a_snapshot_from_the_configured_bucket(bucket, tmp_path):
    cfg = tmp_path / "config.toml"
    cfg.write_text(f's3_base_url = "{bucket.url}"\n')
    r = run_cli("inventory", "--snapshot", SNAPSHOT_ID, "--config", str(cfg), "--json")
    assert r.exit_code == 0, r.stderr
    assert json.loads(r.stdout)["source"]["id"] == SNAPSHOT_ID
    out = tmp_path / "x.png"
    p = run_cli("subset", "--snapshot", SNAPSHOT_ID, "--config", str(cfg), "--var", "runoff", "--resolution", "monthly",
                "--format", "png", "--start", "2000-03", "--out", str(out), "--json")
    assert p.exit_code == 0, p.stderr
    assert json.loads(p.stdout)["path"] == str(out) and decode_png(out.read_bytes())[:2] == (COLS, ROWS)
    n = run_cli("inventory", "--snapshot", "ee" * 32, "--config", str(cfg))
    assert n.exit_code == 3


def test_cli_nc_and_text_summaries(work, tmp_path):
    cfg = tmp_path / "config.toml"
    cfg.write_text("")
    out = tmp_path / "n.nc"
    r = run_cli("subset", str(work), "--config", str(cfg), "--var", "runoff", "--resolution", "daily", "--format", "nc",
                "--start", "2000-01-03", "--end", "2000-01-04", "--bbox", "-101,40,-99,42", "--out", str(out))
    assert r.exit_code == 0 and f"wrote {out}" in r.stdout and out.exists()
    t = run_cli("subset", str(work), "--config", str(cfg), "--var", "runoff", "--resolution", "daily", "--format", "json",
                "--start", "2000-01-03", "--end", "2000-01-04", "--point", "-99.3,42.6")
    assert t.exit_code == 0 and "2000-01-03" in t.stdout
