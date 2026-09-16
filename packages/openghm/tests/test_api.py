"""Public API tests: `import openghm` ergonomics."""

from __future__ import annotations

import openghm
from openghm import RunResult


def test_public_surface():
    for name in ["preclip", "subset", "spatial", "temporal",
                 "RunResult", "Mount", "OpenghmError", "load_config"]:
        assert hasattr(openghm, name), name
    assert isinstance(openghm.__version__, str)


def test_spatial_dry_run():
    res = openghm.spatial(
        mt="/work/test.MT.csv", data_code="RUNOFF_Y", mask_code="US_states_6min",
        work="/scratch/work", mounts={"gt_output": "/snap/gtout"},
        output="/work/out.nc", dry_run=True,
    )
    assert isinstance(res, RunResult)
    assert res.dry_run is True
    assert res.argv[0] == "singularity"
    assert res.display.startswith("singularity exec -c -e")


def test_temporal_dry_run():
    res = openghm.temporal(
        mt="/work/t.MT.csv", src_code="RUNOFF_M", dst_code="RUNOFF_Y",
        work="/scratch/work", no_datacube_check=True, dry_run=True,
    )
    assert isinstance(res, RunResult)
    assert "-ndc" in res.argv


def test_preclip_docker_runtime():
    res = openghm.preclip(
        net="/snap/net/n.tif", output="/work/p.asc", work="/scratch/work",
        mounts={"network": "/snap/net"}, lon_min=-110, lon_max=-100,
        lat_min=40, lat_max=48, runtime="docker", dry_run=True,
    )
    assert res.argv[:3] == ["docker", "run", "--rm"]
    assert "wbm-lite:latest" in res.argv


def test_mounts_dict_and_list():
    a = openghm.spatial(mt="/work/t.csv", data_code="D", mask_code="M",
                        work="/w", mounts={"gt": "/p"}, dry_run=True)
    b = openghm.spatial(mt="/work/t.csv", data_code="D", mask_code="M",
                        work="/w", mounts=[("gt", "/p")], dry_run=True)
    assert a.argv == b.argv
