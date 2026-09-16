"""Dry-run contract tests (ported from the Node vitest suite).

Assert structure — mounts as a set, the inner argv, the generated init — not
byte-identical strings (that is what test_goldens covers).
"""

from __future__ import annotations

import pytest

from openghm import BuiltCommand
from openghm.network import NetworkOptions, build_network
from openghm.runtime import RuntimeContext
from openghm.spatial import SpatialOptions, build_spatial
from openghm.temporal import TemporalOptions, build_temporal
from openghm.errors import OpenghmError

SING = RuntimeContext(runtime="singularity", image="/sif/wbm_tools_lite.sif")
NET = "/snap/data/Global_tracking/network"
MASKS = "/snap/data/Global_tracking/masks"
GTOUT = "/snap/wbm_output/Global_tracking"
WORK = "/scratch/wbm_lite_test"


def bind_set(cmd: BuiltCommand):
    return {f"{m.host}:{m.container}" for m in cmd.mounts}


# ---- network preclip (golden: 120x96) --------------------------------------

def test_preclip_mounts_and_inner():
    cmd = build_network(
        "preclip",
        NetworkOptions(net=f"{NET}/05min_flwdir.tif", output=f"{WORK}/preclip_test.asc",
                       work=WORK, mounts=[("network", NET)],
                       lon_min=-110, lon_max=-100, lat_min=40, lat_max=48, verbose=True),
        SING,
    )
    assert bind_set(cmd) == {f"{NET}:/data/network", f"{WORK}:/work"}
    assert cmd.inner_cmd == ["/wbm/utilities/networkTools", "-v", "/work/preclip.init"]


def test_preclip_init_matches_golden():
    cmd = build_network(
        "preclip",
        NetworkOptions(net=f"{NET}/05min_flwdir.tif", output=f"{WORK}/preclip_test.asc",
                       work=WORK, mounts=[("network", NET)],
                       lon_min=-110, lon_max=-100, lat_min=40, lat_max=48),
        SING,
    )
    init = cmd.generated_files[0].content
    assert "Net_file => '/data/network/05min_flwdir.tif'" in init
    assert "preclip => {" in init
    assert "output_file => '/work/preclip_test.asc'" in init
    assert "truncation_check => 1" in init
    assert "trim_nodata => 0" in init
    assert "rectangle => { lonMin => -110, lonMax => -100, latMin => 40, latMax => 48 }" in init
    assert "inscribe" not in init  # preclip golden has none


def test_preclip_singularity_exec_prefix():
    cmd = build_network(
        "preclip",
        NetworkOptions(net=f"{NET}/05min_flwdir.tif", output=f"{WORK}/p.asc", work=WORK,
                       mounts=[("network", NET)], lon_min=-110, lon_max=-100, lat_min=40, lat_max=48),
        SING,
    )
    assert cmd.argv[:4] == ["singularity", "exec", "-c", "-e"]
    assert "/sif/wbm_tools_lite.sif" in cmd.argv


# ---- network subset (golden: 551x367, 15 basins) ---------------------------

def test_subset_rect_init():
    cmd = build_network(
        "subset",
        NetworkOptions(net=f"{NET}/05min_flwdir.tif", output=f"{WORK}/subset_test.asc",
                       work=WORK, mounts=[("network", NET)],
                       lon_min=-110, lon_max=-100, lat_min=40, lat_max=48, trim_nodata=True),
        SING,
    )
    init = cmd.generated_files[0].content
    assert "subset => {" in init
    assert "output_file => '/work/subset_test.asc'" in init
    assert "trim_nodata => 1" in init
    assert "rectangle => { lonMin => -110, lonMax => -100, latMin => 40, latMax => 48, inscribe => 0 }" in init
    assert "truncation_check" not in init  # subset golden has none
    assert cmd.inner_cmd[-1] == "/work/subset.init"


def test_subset_polygon_mode():
    cmd = build_network(
        "subset",
        NetworkOptions(net=f"{NET}/05min_flwdir.tif", output=f"{WORK}/admin.asc", work=WORK,
                       mounts=[("network", NET)], shapefile="/shp/admin.shp",
                       id_field="ObjectID", ids=[153], inscribe=True),
        SING,
    )
    assert "/shp:/data/shp" in bind_set(cmd)
    init = cmd.generated_files[0].content
    assert (
        "polygon => { file => '/data/shp/admin.shp', shp_var => 'ObjectID', "
        "polIDs => [153], proj => 'epsg:4326', inscribe => 1 }"
    ) in init


# ---- spatial ----------------------------------------------------------------

def test_spatial_inner_and_mounts():
    cmd = build_spatial(
        SpatialOptions(mt=f"{WORK}/test.MT.csv", data_code="Global_tracking_runoff_y",
                       mask_code="US_states_6min", output=f"{WORK}/output_runoff_by_state.nc",
                       work=WORK, mounts=[("gt_output", GTOUT), ("masks", MASKS)], verbose=True),
        SING,
    )
    inner = cmd.inner_cmd
    assert inner[0] == "/wbm/utilities/spatial_aggregation.pl"
    assert "-v" in inner and "-mt" in inner
    assert inner[inner.index("-mt") + 1] == "/work/test.MT.csv"
    assert inner[inner.index("-f") + 1] == "/work/US_states_6min.msk"
    assert inner[-3:] == ["Global_tracking_runoff_y", "US_states_6min", "/work/output_runoff_by_state.nc"]
    assert bind_set(cmd) == {f"{GTOUT}:/data/gt_output", f"{MASKS}:/data/masks", f"{WORK}:/work"}


def test_spatial_requires_mt():
    with pytest.raises(OpenghmError, match="--mt"):
        build_spatial(SpatialOptions(mt="", data_code="X", mask_code="Y", work=WORK), SING)


def test_spatial_sum_maps_to_c():
    cmd = build_spatial(
        SpatialOptions(mt=f"{WORK}/t.csv", data_code="X", mask_code="Y", work=WORK, method="sum"),
        SING,
    )
    assert "-c" in cmd.inner_cmd


# ---- temporal ---------------------------------------------------------------

def test_temporal_inner():
    cmd = build_temporal(
        TemporalOptions(mt=f"{WORK}/test.MT.csv", src_code="Global_tracking_runoff_m",
                        dst_code="test_runoff_yearly", start="2000-01-01", end="2002-12-31",
                        no_datacube_check=True, work=WORK, mounts=[("gt_output", GTOUT)], verbose=True),
        SING,
    )
    inner = cmd.inner_cmd
    assert inner[0] == "/wbm/utilities/temporal_aggregation.pl"
    assert "-v" in inner and "-ndc" in inner
    assert inner[inner.index("-mt") + 1] == "/work/test.MT.csv"
    assert inner[inner.index("-sd") + 1] == "2000-01-01"
    assert inner[inner.index("-ed") + 1] == "2002-12-31"
    assert inner[-2:] == ["Global_tracking_runoff_m", "test_runoff_yearly"]


def test_temporal_category_maps_to_a2():
    cmd = build_temporal(
        TemporalOptions(mt=f"{WORK}/t.csv", src_code="A", dst_code="B", work=WORK, method="category"),
        SING,
    )
    assert cmd.inner_cmd[cmd.inner_cmd.index("-a") + 1] == "2"


# ---- docker runtime ---------------------------------------------------------

def test_docker_runtime_translation():
    cmd = build_network(
        "preclip",
        NetworkOptions(net=f"{NET}/05min_flwdir.tif", output=f"{WORK}/p.asc", work=WORK,
                       mounts=[("network", NET)], lon_min=-110, lon_max=-100, lat_min=40, lat_max=48),
        RuntimeContext(runtime="docker", image="wbm-lite:latest"),
    )
    assert cmd.argv[:3] == ["docker", "run", "--rm"]
    assert "-v" in cmd.argv
    assert f"{NET}:/data/network" in cmd.argv
    assert "wbm-lite:latest" in cmd.argv
