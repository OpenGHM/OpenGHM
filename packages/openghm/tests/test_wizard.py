"""Wizard logic tests (no TTY): the equivalent-command formatter, and that the
field ``key``s line up with the core option names so answers build correctly.
"""

from __future__ import annotations

from openghm.runtime import RuntimeContext
from openghm.network import NetworkOptions, build_network
from openghm.spatial import SpatialOptions, build_spatial
from openghm.temporal import TemporalOptions, build_temporal
from openghm.mounts import DataMountSpec
from openghm.cli.fields import PRECLIP_REQUIRED, SPATIAL_REQUIRED, TEMPORAL_REQUIRED
from openghm.cli.format import FlagToken, format_openghm_command

SING = RuntimeContext(runtime="singularity", image="/sif")


def test_format_reconstructs_spatial():
    s = format_openghm_command(
        "spatial",
        [DataMountSpec("gt", "/p/gt"), DataMountSpec("masks", "/p/m")],
        "/w",
        [
            FlagToken("--mt", "/work/x.csv"),
            FlagToken("--data", "runoff_y"),
            FlagToken("--mask", "US_states_6min"),
            FlagToken("--method", "sum"),
            FlagToken("--verbose"),
        ],
    )
    assert s.startswith("openghm spatial")
    assert "--mount gt=/p/gt" in s
    assert "--mount masks=/p/m" in s
    assert "--work /w" in s
    assert "--data runoff_y" in s
    assert "--method sum" in s
    assert "--verbose" in s and "--verbose '" not in s  # bare boolean flag
    assert "singularity" not in s


def test_format_quotes_spaces():
    s = format_openghm_command("spatial", [], "/w", [FlagToken("--metadata", "Run off:mm:%.1f")])
    assert "--metadata 'Run off:mm:%.1f'" in s


def test_field_keys_match_option_names():
    assert [f.key for f in SPATIAL_REQUIRED] == ["mt", "data_code", "mask_code"]
    assert [f.key for f in TEMPORAL_REQUIRED] == ["mt", "src_code", "dst_code"]
    assert [f.key for f in PRECLIP_REQUIRED] == ["net", "output", "lon_min", "lon_max", "lat_min", "lat_max"]


def test_opts_keyed_by_field_key_build_spatial():
    opts = {"mt": "/work/x.csv", "data_code": "D", "mask_code": "M", "method": "sum", "verbose": True}
    cmd = build_spatial(SpatialOptions(work="/w", mounts=[("gt", "/p")], **opts), SING)
    assert "-c" in cmd.inner_cmd  # method sum
    assert "-v" in cmd.inner_cmd
    assert cmd.inner_cmd[cmd.inner_cmd.index("-mt") + 1] == "/work/x.csv"
    assert cmd.inner_cmd[-2:] == ["D", "M"]


def test_opts_temporal_ndc():
    cmd = build_temporal(
        TemporalOptions(work="/w", mounts=[], mt="/work/x.csv", src_code="S", dst_code="T", no_datacube_check=True),
        SING,
    )
    assert "-ndc" in cmd.inner_cmd
    assert cmd.inner_cmd[-2:] == ["S", "T"]


def test_opts_preclip_rectangle_init():
    cmd = build_network(
        "preclip",
        NetworkOptions(net="/d/n.tif", output="/work/o.asc", work="/w", mounts=[("n", "/d")],
                       lon_min=-80, lon_max=-70, lat_min=40, lat_max=45),
        SING,
    )
    assert "rectangle => { lonMin => -80" in cmd.generated_files[0].content
