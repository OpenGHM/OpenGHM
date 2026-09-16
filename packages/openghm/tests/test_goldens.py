"""Parity gate: the Python builders must reproduce, byte-for-byte, the JSON the
already-verified Node CLI emitted for the same inputs.

The goldens in ``tests/goldens/*.json`` were captured from the Node ``openghm``
with ``--json --dry-run`` (forced-default config) just before the Node project
was removed. We rebuild each here and compare the full payload dict.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from openghm import Config
from openghm.network import NetworkOptions, build_network
from openghm.runtime import RuntimeContext
from openghm.spatial import SpatialOptions, build_spatial
from openghm.temporal import TemporalOptions, build_temporal
from openghm.cli.render import build_payload

GOLDENS = Path(__file__).parent / "goldens"

# The goldens were captured with the Node CLI's fixed Anvil SIF path; pin it here
# so this parity gate is independent of the (now portable, per-user) default.
_NODE_SIF = "/home/x-openghm/apps/wbm/lite/wbm_tools_lite.sif"
SING = RuntimeContext.from_config(Config(sif=_NODE_SIF))  # singularity, pinned SIF
DOCKER = RuntimeContext.from_config(Config(sif=_NODE_SIF), runtime="docker")  # wbm-lite:latest


def _preclip_rect():
    return build_network(
        "preclip",
        NetworkOptions(
            net="/snap/net/05min_flwdir.tif", output="/work/preclip_test.asc",
            work="/scratch/work", mounts=[("network", "/snap/net")],
            lon_min=-110, lon_max=-100, lat_min=40, lat_max=48, verbose=True,
        ),
        SING,
    )


def _subset_rect():
    return build_network(
        "subset",
        NetworkOptions(
            net="/snap/net/05min_flwdir.tif", output="/work/subset_test.asc",
            work="/scratch/work", mounts=[("network", "/snap/net")],
            lon_min=-110, lon_max=-100, lat_min=40, lat_max=48,
            trim_nodata=True, verbose=True,
        ),
        SING,
    )


def _subset_shp():
    return build_network(
        "subset",
        NetworkOptions(
            net="/snap/net/05min_flwdir.tif", output="/work/subset_shp.asc",
            work="/scratch/work", mounts=[("network", "/snap/net")],
            shapefile="/snap/shp/basins.shp", id_field="BASIN_ID", ids=[1, 2, 3],
            inscribe=True, verbose=True,
        ),
        SING,
    )


def _spatial(ctx=SING):
    return build_spatial(
        SpatialOptions(
            mt="/work/test.MT.csv", data_code="Global_tracking_runoff_y",
            mask_code="US_states_6min", output="/work/output_runoff_by_state.nc",
            work="/scratch/work", mounts=[("gt_output", "/snap/gtout"), ("masks", "/snap/masks")],
            verbose=True,
        ),
        ctx,
    )


def _temporal():
    return build_temporal(
        TemporalOptions(
            mt="/work/test.MT.csv", src_code="Global_tracking_runoff_m",
            dst_code="test_runoff_yearly", no_datacube_check=True,
            start="2000-01-01", end="2002-12-31",
            work="/scratch/work", mounts=[("gt_output", "/snap/gtout")], verbose=True,
        ),
        SING,
    )


CASES = [
    ("preclip_rect.json", "network preclip", SING, _preclip_rect),
    ("subset_rect.json", "network subset", SING, _subset_rect),
    ("subset_shp.json", "network subset", SING, _subset_shp),
    ("spatial.json", "spatial", SING, _spatial),
    ("temporal.json", "temporal", SING, _temporal),
    ("spatial_docker.json", "spatial", DOCKER, lambda: _spatial(DOCKER)),
]


@pytest.mark.parametrize("filename,command,ctx,build", CASES, ids=[c[0] for c in CASES])
def test_matches_node_golden(filename, command, ctx, build):
    golden = json.loads((GOLDENS / filename).read_text())
    payload = build_payload(command, ctx.runtime, ctx.image, build(), result=None)
    assert payload == golden
