"""``--spool cache``: the variant, the S3 fill, the links, the harvest, and a run around them.

No network and no container: the init is evaluated by a fake (one test runs the real
``perl`` script on the host), S3 is the local HTTP bucket of ``test_fetch``, and WBM is a
script that reads or builds spool files the way WBM does (``-e`` on the path, which follows
a symlink, then read or write).
"""

from __future__ import annotations

import copy
import errno
import hashlib
import json
import multiprocessing
import os
import shutil
import subprocess
import sys
import textwrap
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from click.testing import CliRunner

from openghm import Config, fetch, spool
from openghm.cli.main import cli
from openghm.errors import OpenghmError
from openghm.run import stage_files
from openghm.sim import SubmitOptions, build_run, build_submit
from openghm.types import SpoolPlan

from test_fetch import Bucket, _Obj
from test_sim_run import _make_snapshot, tmp_model_input

MID = "2" * 64
NET = "net"

#: The init a run evaluates to (strings only, as the perl evaluator gives it).
INIT = {
    "ID": "run1",
    "Comment": "a comment",
    "Project": "a project",
    "MT_Code_Name": {
        "MT_ID": "m1", "Output_dir": "/wbm/wbm_output/run1",
        "Run_Start": "2000-01-01", "Run_End": "2001-12-31", "File_Size": "year",
    },
    "Spinup": {"State_ID": "", "Loops": "1", "Start": "1998-01-01", "End": "1998-12-31"},
    "Output_vars": "runoff discharge",
    "MT_Precip": {"Primary": "/wbm/data/climate/precip/merra2.init"},
    "precipFraction": "",
    "Network": f"/wbm/data/network/{NET}.asc",
    "Projection": "epsg:4326",
    "wbmParam": {"scrPrintScale": "1"},
    "PostProcessing": {"Forks": "8", "Run": "1"},
    "spool_dir": "/wbm/spool/",
}


def _sums(path: Path, files: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(f"{sha}  ./{rel}\n" for rel, sha in sorted(files.items())), encoding="utf-8")


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _plan(tmp_path: Path, *, sim_id="sim1", s3_base="http://127.0.0.1:9/openghm", digest=None) -> SpoolPlan:
    snap, mi = tmp_path / "snap", tmp_path / "mi" / MID
    if not (snap / "SHA256SUMS").exists():
        _sums(snap / "SHA256SUMS", {
            "model/wbm.pl": _sha("wbm"), "model/lib/RIMS.pm": _sha("rims"),
            "utilities/tool": _sha("tool"), "wbm_init/wbm_test.init": _sha("init"),
            "metadata.json": _sha("meta"),
        })
    if not (mi / "SHA256SUMS").exists():
        _sums(mi / "SHA256SUMS", {f"network/{NET}.asc": _sha("network"), "climate/p.nc": _sha("p")})
    return SpoolPlan(
        sim_id=sim_id, workdir=str(tmp_path / "out" / sim_id), snapshot=str(snap),
        init_container="/wbm/wbm_init/wbm_test.init", runtime="singularity",
        image=str(tmp_path / "x.sif"), image_digest=digest or "sha256:" + "a" * 64,
        model_input_id=MID, model_input_path=str(mi), cache_root=str(tmp_path / "spools"),
        s3_base=s3_base, eval_mounts=[],
    )


def _vid(plan: SpoolPlan, init=None) -> str:
    init = copy.deepcopy(INIT if init is None else init)
    return spool.variant(plan, evaluator=lambda _p: init).id


def _changed(**edits):
    """INIT with ``edits`` applied: ``"MT_Code_Name.Run_End": "2005-12-31"`` reaches into a block."""
    init = copy.deepcopy(INIT)
    for path, value in edits.items():
        *blocks, key = path.split(".")
        target = init
        for b in blocks:
            target = target[b]
        if value is None:
            target.pop(key, None)
        else:
            target[key] = value
    return init


# ── the variant ───────────────────────────────────────────────────────────────


def test_variant_is_16_hex_characters_in_the_cache_layout(tmp_path):
    plan = _plan(tmp_path)
    v = spool.variant(plan, evaluator=lambda _p: copy.deepcopy(INIT))
    assert len(v.id) == 16 and int(v.id, 16) >= 0
    assert v.dir == str(tmp_path / "spools" / MID / NET / v.id)
    assert v.network == NET and v.years == (1998, 2002)
    assert set(v.inputs) == {"image", "code", "network", "init"}
    assert v.inputs["network"] == _sha("network") and v.inputs["image"] == "sha256:" + "a" * 64


@pytest.mark.parametrize("edit", [
    {"ID": "another"},
    {"Comment": "other prose"},
    {"Project": None},
    {"MT_Code_Name.Run_Start": "1990-01-01"},
    {"MT_Code_Name.Run_End": "2020-12-31"},
    {"MT_Code_Name.Output_dir": "/wbm/wbm_output/elsewhere"},
    {"MT_Code_Name.MT_ID": "renamed"},
    {"MT_Code_Name.File_Size": "month"},
    {"Output_vars": "runoff"},
    {"Output_dir": "/wbm/wbm_output/top-level"},
    {"Spinup.Start": "1990-01-01", "Spinup.Loops": "3"},
    {"Spinup": None},
    {"spinup_state_ID": "an-old-state"},
    {"PostProcessing.Forks": "1"},
    {"PostProcessing": None},
    {"spool_dir": "/somewhere/else/"},
], ids=lambda e: next(iter(e)))
def test_variant_ignores_what_only_names_or_times_the_run(tmp_path, edit):
    plan = _plan(tmp_path)
    assert _vid(plan, _changed(**edit)) == _vid(plan)


@pytest.mark.parametrize("edit", [
    {"MT_Precip.Primary": "/wbm/data/climate/precip/era5.init"},       # a dataset path
    {"MT_Precip": {"Primary": "/wbm/data/climate/precip/merra2.init", "Secondary": "x.init"}},
    {"precipFraction": "0.5"},                                          # a patch value
    {"Projection": "epsg:3857"},
    {"Network": "/wbm/data/network/other.asc"},
    {"wbmParam.scrPrintScale": "2"},
    {"Routing": "LRR"},                                                 # an added setting
])
def test_variant_follows_what_a_spool_file_depends_on(tmp_path, edit):
    plan = _plan(tmp_path)
    init = _changed(**edit)
    if "Network" in edit:       # the other network needs a line in the model input's sums
        _sums(Path(plan.model_input_path) / "SHA256SUMS", {f"network/{NET}.asc": _sha("network"), "network/other.asc": _sha("n")})
    assert _vid(plan, init) != _vid(plan)


def test_variant_follows_the_network_file(tmp_path):
    plan = _plan(tmp_path)
    before = _vid(plan)
    _sums(Path(plan.model_input_path) / "SHA256SUMS", {f"network/{NET}.asc": _sha("a different network")})
    assert _vid(plan) != before


def test_variant_follows_the_model_code_and_nothing_else_in_the_snapshot(tmp_path):
    plan = _plan(tmp_path)
    before = _vid(plan)
    sums = Path(plan.snapshot) / "SHA256SUMS"
    text = sums.read_text()
    # a line outside model/ and utilities/ (an init, the metadata) is not code
    sums.write_text(text.replace(_sha("init"), _sha("another init")).replace(_sha("meta"), _sha("m2")))
    assert _vid(plan) == before
    # a model line, or a utilities line, is
    sums.write_text(text.replace(_sha("rims"), _sha("rims, edited")))
    assert _vid(plan) != before
    sums.write_text(text.replace(_sha("tool"), _sha("tool, edited")))
    assert _vid(plan) != before
    # the same lines, differently written and ordered
    sums.write_text("\n".join(l.replace("  ./", "  ") for l in reversed(text.splitlines())) + "\n")
    assert _vid(plan) == before


def test_variant_follows_the_image(tmp_path):
    assert _vid(_plan(tmp_path)) != _vid(_plan(tmp_path, digest="sha256:" + "b" * 64))


def test_variant_of_an_image_override_is_the_files_hash(tmp_path):
    plan = _plan(tmp_path)
    Path(plan.image).write_bytes(b"sif bytes")
    plan.image_digest = None
    assert spool.variant(plan, evaluator=lambda _p: copy.deepcopy(INIT)).inputs["image"] == \
        "sha256:" + hashlib.sha256(b"sif bytes").hexdigest()


def test_variant_names_what_is_missing(tmp_path):
    plan = _plan(tmp_path)
    for bad, match in [({"Network": None}, "no Network"), ({"Network": "/elsewhere/n.asc"}, "not a file of the model input"),
                       ({"Network": "/wbm/data/network/absent.asc"}, "no line")]:
        with pytest.raises(OpenghmError, match=match):
            spool.variant(plan, evaluator=lambda _p, b=bad: _changed(**b))


def test_the_period_a_run_reads():
    assert spool._years(INIT) == (1998, 2002)       # spinup start .. run end + 1
    assert spool._years(_changed(**{"Spinup": None})) == (2000, 2002)
    assert spool._years(_changed(**{"Spinup.Start": "2005-01-01"})) == (2000, 2002)
    # unknown rather than guessed: no Run_Start (WBM starts where the forcing does), no Run_End
    assert spool._years(_changed(**{"MT_Code_Name.Run_Start": None})) == (None, 2002)
    assert spool._years(_changed(**{"MT_Code_Name.Run_End": None})) == (1998, None)


def test_network_name_is_wbms_spool_directory():
    assert spool.network_name("/wbm/data/network/Merrimack_stn210_Subset.asc") == "Merrimack_stn210_Subset"
    assert spool.network_name("/wbm/data/n/global.v2.tif") == "global.v2"


# ── the init, evaluated by perl ───────────────────────────────────────────────

_HAS_PERL = shutil.which("perl") is not None and subprocess.run(
    ["perl", "-MJSON::PP", "-MDigest::SHA", "-e1"], capture_output=True).returncode == 0


@pytest.mark.skipif(not _HAS_PERL, reason="no perl with JSON::PP on this host")
def test_container_evaluator_runs_the_perl_script_over_the_init_as_wbm_reads_it(tmp_path):
    dataset = tmp_path / "wbm_data" / "p.init"
    dataset.parent.mkdir()
    dataset.write_bytes(b"{ File => 'p.nc' }\n")
    init_dir = tmp_path / "wbm_init"
    init_dir.mkdir()
    # tabs, a Windows line end, a bare number, a value-less `=> ,`, a list, a nested block, a path to an init file
    (init_dir / "wbm_test.init").write_bytes((
        "{\nID\t=> 'run1',\r\nLoops => 3,\nprecipFraction => ,\nList => [1, 'b'],\n"
        f"MT_Precip => {{ Primary => '{dataset}' }},\nPlain => '/no/such/file.init',\n"
        "Spinup => { Start => '2000-01-01' },\n}\n").encode())
    plan = _plan(tmp_path)
    plan.eval_mounts = [(str(init_dir), "/wbm/wbm_init")]
    seen = {}

    def fake_runtime(argv, **kw):       # what the container would do: perl, with /wbm/wbm_init bound
        seen["argv"] = argv
        assert argv[0] == "singularity" and argv[1] == "exec" and "-B" in argv
        perl = argv.index("perl")
        args = list(argv[perl:])
        args[-1] = str(init_dir / "wbm_test.init")      # the bind, resolved
        return subprocess.run(args, **kw)

    got = spool.container_evaluator(plan, run=fake_runtime)
    assert seen["argv"][seen["argv"].index("-B") + 1] == f"{init_dir}:/wbm/wbm_init:ro"    # read-only
    assert got["ID"] == "run1" and got["Loops"] == "3" and got["precipFraction"] == "" and got["List"] == ["1", "b"]
    assert got["Spinup"] == {"Start": "2000-01-01"}
    assert got["MT_Precip"]["Primary"] == {"init_file": str(dataset), "sha256": hashlib.sha256(b"{ File => 'p.nc' }\n").hexdigest()}
    assert got["Plain"] == "/no/such/file.init"                      # a path that is not a file stays a string


def test_container_evaluator_reports_perl_failing():
    plan = SpoolPlan(sim_id="s", workdir="/w", snapshot="/s", init_container="/wbm/wbm_init/a.init",
                     runtime="docker", image="img:1", image_digest=None, model_input_id="m",
                     model_input_path="/m", cache_root="/c", s3_base="http://x", eval_mounts=[("/h", "/wbm/wbm_init")])
    seen = {}

    def fake(argv, **kw):
        seen["argv"] = argv
        return subprocess.CompletedProcess(argv, 255, "", "cannot read the init /wbm/wbm_init/a.init: syntax error\n")

    with pytest.raises(OpenghmError, match="syntax error"):
        spool.container_evaluator(plan, run=fake)
    assert seen["argv"][:4] == ["docker", "run", "--rm", "-v"] and "/h:/wbm/wbm_init:ro" in seen["argv"]


# ── link ──────────────────────────────────────────────────────────────────────


def _put(vdir: Path, rel: str, body: bytes = b"data") -> None:
    (vdir / rel).parent.mkdir(parents=True, exist_ok=True)
    (vdir / rel).write_bytes(body)
    (vdir / (rel + ".hdr")).write_bytes(b"hdr " + body)


def _variant(plan: SpoolPlan) -> spool.Variant:
    return spool.variant(plan, evaluator=lambda _p: copy.deepcopy(INIT))


def test_link_selects_by_year_and_links_to_the_container_path(tmp_path):
    plan = _plan(tmp_path)
    v = _variant(plan)                     # years 1998..2002
    vdir = Path(v.dir)
    for year in range(1996, 2005):
        _put(vdir, f"Precip/{year}-06-15.dat")
    _put(vdir, "Precip/0000-06-15.dat")    # climatology: always
    _put(vdir, "Precip/2000-06-00.dat")    # monthly and yearly names carry a year too
    _put(vdir, "Precip/2007-00-00.dat")
    _put(vdir, "Temp_Precip/2001-01-01.dat")
    _put(vdir, "mod_obs/001.dat")          # climate bias: no date, always
    for day in range(1, 366):
        _put(vdir, f"LAI_MinMax/{day:03d}.dat")
    for day in range(1, 101):
        _put(vdir, f"Half_MinMax/{day:03d}.dat")    # WBM rebuilds all 365 unless it finds 365
    (vdir / "Precip/2000-01-02.dat").write_bytes(b"no hdr")      # a pair needs both
    (vdir / "Cell_Table.dat").write_bytes(b"network level")      # never

    # Precip: 1998..2002, the climatology and a monthly name of 2000; one pair in Temp_Precip, in mod_obs, 365 in LAI_MinMax
    assert spool.link(plan, v) == 7 + 1 + 1 + 365
    run = Path(plan.run_spool) / NET
    precip = sorted(p.name for p in (run / "Precip").iterdir() if p.name.endswith(".dat"))
    assert precip == ["0000-06-15.dat", "1998-06-15.dat", "1999-06-15.dat", "2000-06-00.dat",
                      "2000-06-15.dat", "2001-06-15.dat", "2002-06-15.dat"]
    link = run / "Precip" / "2000-06-15.dat"
    assert link.is_symlink() and os.readlink(link) == "/wbm/spool/.cache/Precip/2000-06-15.dat"
    assert os.readlink(str(link) + ".hdr") == "/wbm/spool/.cache/Precip/2000-06-15.dat.hdr"
    assert (run / "Temp_Precip" / "2001-01-01.dat").is_symlink()
    assert (run / "mod_obs" / "001.dat").is_symlink()
    assert len(list((run / "LAI_MinMax").iterdir())) == 2 * 365
    assert not (run / "Half_MinMax").exists()
    assert not (run / "Cell_Table.dat").exists() and not (run / "Precip" / "2000-01-02.dat").exists()
    # relinking replaces links and leaves a file the run built itself
    (run / "Precip" / "1998-06-15.dat").unlink()
    (run / "Precip" / "1998-06-15.dat").write_bytes(b"built")
    assert spool.link(plan, v) > 0
    assert (run / "Precip" / "1998-06-15.dat").read_bytes() == b"built"
    assert (run / "Precip" / "1999-06-15.dat").is_symlink()


def test_link_from_an_empty_cache_links_nothing(tmp_path):
    plan = _plan(tmp_path)
    assert spool.link(plan, _variant(plan)) == 0
    assert not (Path(plan.run_spool) / NET).exists()


def test_a_period_the_init_does_not_bound_takes_every_year(tmp_path):
    plan = _plan(tmp_path)
    init = _changed(**{"MT_Code_Name.Run_Start": None, "MT_Code_Name.Run_End": None})
    v = spool.variant(plan, evaluator=lambda _p: copy.deepcopy(init))
    for year in (1901, 2050):
        _put(Path(v.dir), f"Precip/{year}-01-01.dat")
    assert spool.link(plan, v) == 2


# ── harvest ───────────────────────────────────────────────────────────────────


def _built_spool(plan: SpoolPlan, v: spool.Variant) -> Path:
    """A run's own spool after WBM: dataset days, and network-level files that are never cached."""
    run = Path(plan.run_spool) / NET
    for rel in ("Precip/2000-01-01.dat", "Precip/2000-01-02.dat", "Temp/2000-01-01.dat",
                "mod_obs/001.dat", "LAI_MinMax/001.dat"):
        _put(run, rel, rel.encode())
    for top in ("Cell_Table.dat", "Cell_Table.dat.hdr", "reservoir_count.tif", "landCoverOneID.tif"):
        (run / top).write_bytes(b"network level")
    (run / "Orphan").mkdir()
    (run / "Orphan" / "2000-01-01.dat").write_bytes(b"no hdr")                 # half a pair
    (run / "Orphan" / "2000-01-02.dat.hdr").write_bytes(b"no dat")
    (run / "Linked").mkdir()
    (run / "Linked" / "2000-01-01.dat").symlink_to("/wbm/spool/.cache/Linked/2000-01-01.dat")
    (run / "Linked" / "2000-01-01.dat.hdr").symlink_to("/wbm/spool/.cache/Linked/2000-01-01.dat.hdr")
    os.makedirs(v.dir, exist_ok=True)       # what `prepare` does
    spool._point(plan.cache_link, v.dir)
    return run


def test_harvest_moves_regular_pairs_of_dataset_directories_only(tmp_path):
    plan = _plan(tmp_path)
    v = _variant(plan)
    run = _built_spool(plan, v)
    assert spool.harvest(plan) == {"harvested": 5, "already_present": 0}
    cache = Path(v.dir)
    assert sorted(str(p.relative_to(cache)) for p in cache.rglob("*")
                  if p.is_file() and ".units" not in p.parts) == sorted(
        f"{d}{ext}" for d in ("Precip/2000-01-01.dat", "Precip/2000-01-02.dat", "Temp/2000-01-01.dat",
                              "mod_obs/001.dat", "LAI_MinMax/001.dat") for ext in ("", ".hdr"))
    assert (cache / "Precip/2000-01-01.dat").read_bytes() == b"Precip/2000-01-01.dat"
    # moved, not copied; what was not a pair, a link or below a dataset directory stays where it was
    assert not (run / "Precip" / "2000-01-01.dat").exists()
    for stays in ("Cell_Table.dat", "Cell_Table.dat.hdr", "reservoir_count.tif", "landCoverOneID.tif",
                  "Orphan/2000-01-01.dat", "Orphan/2000-01-02.dat.hdr"):
        assert (run / stays).is_file(), stays
    assert (run / "Linked" / "2000-01-01.dat").is_symlink()
    assert not (cache / "Cell_Table.dat").exists() and not (cache / "Orphan").exists()
    assert not (cache / "Linked").exists()


def test_harvest_moves_hdr_before_dat_and_never_overwrites(tmp_path, monkeypatch):
    plan = _plan(tmp_path)
    v = _variant(plan)
    run = _built_spool(plan, v)
    _put(Path(v.dir), "Precip/2000-01-01.dat", b"the first run's")     # another run got there first
    order = []
    real = spool._move_in
    monkeypatch.setattr(spool, "_move_in", lambda src, dst, tmp: (order.append(os.path.basename(dst)), real(src, dst, tmp))[1])
    assert spool.harvest(plan) == {"harvested": 4, "already_present": 1}
    for i in range(0, len(order), 2):
        assert order[i + 1] == order[i][:-len(".hdr")] and order[i].endswith(".dat.hdr")
    assert (Path(v.dir) / "Precip/2000-01-01.dat").read_bytes() == b"the first run's"
    assert (Path(v.dir) / "Precip/2000-01-01.dat.hdr").read_bytes() == b"hdr the first run's"
    assert not (run / "Precip" / "2000-01-01.dat").exists()     # the duplicate is dropped
    assert not (run / "Precip" / "2000-01-01.dat.hdr").exists()


def test_harvest_across_filesystems_copies_through_the_cache_tmp(tmp_path, monkeypatch):
    plan = _plan(tmp_path)
    v = _variant(plan)
    run = _built_spool(plan, v)
    real = os.link

    def link(src, dst, **kw):
        if os.sep + ".tmp" + os.sep not in str(src):
            raise OSError(errno.EXDEV, "Invalid cross-device link")
        return real(src, dst, **kw)

    monkeypatch.setattr(os, "link", link)
    assert spool.harvest(plan)["harvested"] == 5
    assert (Path(v.dir) / "Precip/2000-01-01.dat").read_bytes() == b"Precip/2000-01-01.dat"
    assert not (run / "Precip" / "2000-01-01.dat").exists()
    assert not (tmp_path / "spools" / ".tmp" / "sim1").exists()


def test_harvest_without_prepare_is_refused(tmp_path):
    with pytest.raises(OpenghmError, match="spool prepare"):
        spool.harvest(_plan(tmp_path))


def _harvest_worker(raw: dict) -> dict:
    return spool.harvest(SpoolPlan.from_dict(raw))


def test_two_processes_harvesting_the_same_days_both_finish_and_leave_one_copy(tmp_path):
    days = 150
    plans = [_plan(tmp_path, sim_id=f"sim{i}") for i in (1, 2)]
    v = _variant(plans[0])
    for plan in plans:
        run = Path(plan.run_spool) / NET
        for d in range(days):
            _put(run, f"Precip/2000-{1 + d // 28:02d}-{1 + d % 28:02d}.dat", b"same bytes")
        os.makedirs(v.dir, exist_ok=True)
        spool._point(plan.cache_link, v.dir)
    with multiprocessing.get_context("spawn").Pool(2) as pool:
        counts = pool.map(_harvest_worker, [p.to_dict() for p in plans])
    assert sum(c["harvested"] for c in counts) == days            # each day moved in once ...
    assert sum(c["already_present"] for c in counts) == days      # ... and found there by the other
    cache = Path(v.dir) / "Precip"
    assert len(list(cache.glob("*.dat"))) == days and len(list(cache.glob("*.dat.hdr"))) == days
    assert {p.read_bytes() for p in cache.glob("*.dat")} == {b"same bytes"}
    for plan in plans:
        assert not any(Path(plan.run_spool, NET, "Precip").iterdir())


# ── fill from S3 ──────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def no_myquota(monkeypatch):
    """The machine's own ``myquota`` (Anvil has one) is never asked: tests pass a fake."""
    monkeypatch.setattr(spool, "MYQUOTA", "/nonexistent/myquota")


@pytest.fixture
def bucket(monkeypatch):
    monkeypatch.setattr(fetch, "_BACKOFF", 0.0)
    b = Bucket()
    yield b
    b.close()


def _publish(bucket: Bucket, v: spool.Variant, rel: str, body: bytes = b"day") -> None:
    prefix = f"spools/{MID}/{v.network}/{v.id}/"
    bucket.objects[prefix + rel] = _Obj(body)
    bucket.objects[prefix + rel + ".hdr"] = _Obj(b"hdr " + body)


def _gets(bucket: Bucket, v: spool.Variant) -> list:
    return sorted(k.split(v.id + "/", 1)[1] for k in bucket.gets)


def test_fill_downloads_only_the_selected_pairs_the_cache_lacks(tmp_path, bucket):
    plan = _plan(tmp_path, s3_base=bucket.url)
    v = _variant(plan)                                   # years 1998..2002
    for year in (1996, 1998, 2000, 2002, 2003):
        _publish(bucket, v, f"Precip/{year}-03-01.dat", f"{year}".encode())
    _publish(bucket, v, "Precip/0000-03-01.dat")
    _publish(bucket, v, "mod_obs/001.dat")               # no date: always taken
    _publish(bucket, v, "LAI_MinMax/001.dat")
    bucket.objects[f"spools/{MID}/{NET}/{v.id}/Precip/2000-04-01.dat"] = _Obj(b"orphan: no hdr")
    bucket.objects[f"spools/{MID}/{NET}/{v.id}/Precip/readme.txt"] = _Obj(b"not spool")
    bucket.objects[f"spools/{MID}/{NET}/{v.id}/Cell_Table.dat"] = _Obj(b"network level")
    bucket.objects[f"spools/{MID}/{NET}/{v.id}/Cell_Table.dat.hdr"] = _Obj(b"network level")
    bucket.objects[f"spools/{MID}/{NET}/another-variant/Precip/2000-03-01.dat"] = _Obj(b"x")
    _put(Path(v.dir), "Precip/2000-03-01.dat", b"already here")          # in the cache: not fetched

    got = spool.fill(plan, v)
    assert got == {"downloaded": 5, "failed": 0, "error": None}
    cache = Path(v.dir)
    have = sorted(str(p.relative_to(cache)) for p in cache.rglob("*.dat"))
    assert have == ["LAI_MinMax/001.dat", "Precip/0000-03-01.dat", "Precip/1998-03-01.dat",
                    "Precip/2000-03-01.dat", "Precip/2002-03-01.dat", "mod_obs/001.dat"]
    assert (cache / "Precip/2000-03-01.dat").read_bytes() == b"already here"      # not replaced
    assert (cache / "Precip/1998-03-01.dat").read_bytes() == b"1998"
    assert (cache / "Precip/1998-03-01.dat.hdr").read_bytes() == b"hdr 1998"
    fetched = _gets(bucket, v)
    assert "Precip/1996-03-01.dat" not in fetched and "Precip/2003-03-01.dat" not in fetched
    assert "Precip/2000-04-01.dat" not in fetched and "Cell_Table.dat" not in fetched
    assert "Precip/2000-03-01.dat" not in fetched and "Precip/2000-03-01.dat.hdr" not in fetched
    assert len(fetched) == 2 * 5
    assert not (tmp_path / "spools" / ".tmp" / "sim1").exists()

    # a second fill finds everything it wants and fetches nothing
    bucket.gets.clear()
    assert spool.fill(plan, v)["downloaded"] == 0 and bucket.gets == []


def test_fill_with_nothing_published_is_not_an_error(tmp_path, bucket):
    plan = _plan(tmp_path, s3_base=bucket.url)
    assert spool.fill(plan, _variant(plan)) == {"downloaded": 0, "failed": 0, "error": None}
    assert bucket.lists == 1 and bucket.gets == []


def test_fill_follows_the_listing_across_pages(tmp_path, bucket):
    plan = _plan(tmp_path, s3_base=bucket.url)
    v = _variant(plan)
    for d in range(1, 8):                                # 14 objects, 3 per page
        _publish(bucket, v, f"Precip/2000-01-{d:02d}.dat")
    assert spool.fill(plan, v)["downloaded"] == 7 and bucket.lists >= 5


def test_fill_checks_the_size_against_the_listing(tmp_path, bucket, monkeypatch):
    plan = _plan(tmp_path, s3_base=bucket.url)
    v = _variant(plan)
    _publish(bucket, v, "Precip/2000-01-01.dat", b"complete")
    _publish(bucket, v, "Precip/2000-01-02.dat", b"truncated in transit")
    real = fetch._open

    class Short:
        def __init__(self, resp):
            self.resp, self.done = resp, False

        def __enter__(self):
            return self

        def __exit__(self, *a):
            self.resp.close()

        def read(self, n=-1):
            if self.done:
                return b""
            self.done = True
            return self.resp.read()[:5]

    monkeypatch.setattr(fetch, "_open", lambda url: Short(real(url)) if "2000-01-02.dat" in url and "hdr" not in url else real(url))
    got = spool.fill(plan, v)
    assert got["downloaded"] == 1 and got["failed"] == 1 and "size 5, the listing says" in got["error"]
    cache = Path(v.dir) / "Precip"
    assert (cache / "2000-01-01.dat").is_file() and not (cache / "2000-01-02.dat").exists()
    assert not (tmp_path / "spools" / ".tmp" / "sim1").exists()


def test_fill_retries_a_transient_error(tmp_path, bucket):
    plan = _plan(tmp_path, s3_base=bucket.url)
    v = _variant(plan)
    _publish(bucket, v, "Precip/2000-01-01.dat")
    bucket.fail_once.add(f"spools/{MID}/{NET}/{v.id}/Precip/2000-01-01.dat")
    assert spool.fill(plan, v) == {"downloaded": 1, "failed": 0, "error": None}


def test_fill_tolerates_an_unreachable_bucket(tmp_path):
    plan = _plan(tmp_path)                               # nothing listens on port 9
    got = spool.fill(plan, _variant(plan))
    assert got["downloaded"] == 0 and "cannot reach" in got["error"]


# ── a run around them ─────────────────────────────────────────────────────────

#: Stands in for ``singularity exec``: it finds its binds in the argv and reads or builds
#: ``<spool>/net/Precip/<day>.dat`` the way WBM does (``-e`` follows a link, which resolves
#: inside the container; a day that exists is read, one that does not is written), then
#: writes a network-level file, a report, and exits as told.
_FAKE_WBM = """#!{python}
import json, os, sys
conf = json.load(open(os.environ["FAKE_WBM"]))
argv = sys.argv[1:]
binds = {{}}
for i, a in enumerate(argv):
    if a == "-B":
        host, container = argv[i + 1].split(":")[:2]
        binds[container] = host
spool, cache = binds["/wbm/spool"], binds["/wbm/spool/.cache"]
report = {{"built": [], "read": [], "link_targets": []}}
for day in conf["days"]:
    path = os.path.join(spool, "net", "Precip", day + ".dat")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    target = path
    if os.path.islink(path):
        container = os.readlink(path)
        report["link_targets"].append(container)
        target = os.path.join(cache, container[len("/wbm/spool/.cache/"):])
    if os.path.exists(target):
        assert open(target, "rb").read() == ("day " + day).encode()
        report["read"].append(day)
    else:
        open(path, "wb").write(("day " + day).encode())
        open(path + ".hdr", "wb").write(b"hdr")
        report["built"].append(day)
open(os.path.join(spool, "net", "Cell_Table.dat"), "wb").write(b"per run")
json.dump(report, open(os.path.join(os.path.dirname(spool), "report.json"), "w"))
sys.exit(conf["exit"])
"""


@pytest.fixture
def fake_wbm(tmp_path, monkeypatch):
    script = tmp_path / "bin" / "singularity"
    script.parent.mkdir()
    script.write_text(_FAKE_WBM.format(python=sys.executable))
    script.chmod(0o755)
    conf = tmp_path / "fake_wbm.json"
    monkeypatch.setenv("FAKE_WBM", str(conf))
    monkeypatch.setenv("PATH", f"{script.parent}{os.pathsep}{os.environ['PATH']}")

    def run_as(days, exit=0):
        conf.write_text(json.dumps({"days": days, "exit": exit}))
        return "singularity"

    return run_as


def _config(tmp_path: Path, **kw) -> Config:
    return Config(output_base=str(tmp_path / "out"), sif_dir=str(tmp_path / "sif"),
                  model_input_dir=str(tmp_path / "model-inputs"), spool_cache=str(tmp_path / "spools"), **kw)


def _runnable(tmp_path: Path, bucket: Bucket, monkeypatch) -> Path:
    """A snapshot ``sim run`` resolves, with the ``SHA256SUMS`` files a variant reads."""
    monkeypatch.setattr(fetch, "S3_BASE", bucket.url)
    snap = _make_snapshot(tmp_path)
    _sums(snap / "SHA256SUMS", {"model/wbm.pl": _sha("wbm"), "utilities/tool": _sha("tool")})
    _sums(tmp_model_input(tmp_path) / "SHA256SUMS", {f"network/{NET}.asc": _sha("network")})
    return snap


def _evaluate(_plan):
    return copy.deepcopy(INIT)


def _run(snap, tmp_path, sim_id, runtime, *, spool_cache=None, **opts):
    cfg = _config(tmp_path)
    if spool_cache:
        cfg = Config(**{**cfg.__dict__, "spool_cache": str(spool_cache)})
    _c, built = build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id=sim_id, **opts), cfg, runtime=runtime)
    logs = []
    result = spool.run_cached(built, evaluator=_evaluate, log=logs.append, capture=True)
    work = tmp_path / "out" / sim_id
    return result, json.loads((work / "simulation.json").read_text()), json.loads((work / "report.json").read_text()), logs


def test_a_second_run_of_the_same_draft_builds_and_harvests_nothing(tmp_path, bucket, monkeypatch, fake_wbm):
    snap = _runnable(tmp_path, bucket, monkeypatch)
    runtime = fake_wbm(["2000-01-01", "2000-01-02"])

    result, sidecar, report, logs = _run(snap, tmp_path, "first", runtime)
    assert result.exit_code == 0
    assert report["built"] == ["2000-01-01", "2000-01-02"] and report["read"] == []
    pruned = sidecar["spool"].pop("prune")                  # no myquota here: nothing to prune
    assert pruned["deleted"] == [] and "myquota" in pruned["reason"]
    assert sidecar["spool"] == {"downloaded": 0, "linked": 0, "failed": 0, "fill_error": None, "dangling": 0,
                                "harvested": 2, "already_present": 0}
    assert sidecar["spool_mode"] == "cache" and sidecar["exit_code"] is None   # the CLI records the exit code
    variant_dir = Path(sidecar["spool_cache"])
    assert variant_dir == tmp_path / "spools" / MID / NET / sidecar["spool_variant"]
    assert sorted(p.name for p in (variant_dir / "Precip").iterdir()) == sorted(
        f"2000-01-0{d}.dat{e}" for d in (1, 2) for e in ("", ".hdr"))
    assert not (variant_dir / "Cell_Table.dat").exists()                     # per run, never cached
    assert any("harvested 2 days" in l for l in logs)

    result, sidecar2, report2, _ = _run(snap, tmp_path, "second", runtime)
    assert report2["built"] == [] and report2["read"] == ["2000-01-01", "2000-01-02"]
    assert report2["link_targets"] == ["/wbm/spool/.cache/Precip/2000-01-01.dat", "/wbm/spool/.cache/Precip/2000-01-02.dat"]
    assert sidecar2["spool_variant"] == sidecar["spool_variant"]
    assert sidecar2["spool"]["linked"] == 2 and sidecar2["spool"]["harvested"] == 0
    # what the run wrote into its own spool is still its own: the links, and the per-run file
    own = tmp_path / "out" / "second" / "spool" / NET
    assert (own / "Precip" / "2000-01-01.dat").is_symlink() and (own / "Cell_Table.dat").is_file()

    # a day the cache lacks is built, then harvested
    _, sidecar3, report3, _ = _run(snap, tmp_path, "third", fake_wbm(["2000-01-02", "2000-01-03"]))
    assert (report3["read"], report3["built"]) == (["2000-01-02"], ["2000-01-03"])
    assert sidecar3["spool"]["harvested"] == 1 and (variant_dir / "Precip" / "2000-01-03.dat").is_file()


def test_a_run_that_exits_non_zero_harvests_nothing(tmp_path, bucket, monkeypatch, fake_wbm):
    snap = _runnable(tmp_path, bucket, monkeypatch)
    result, sidecar, report, logs = _run(snap, tmp_path, "failing", fake_wbm(["2000-01-01"], exit=3))
    assert result.exit_code == 3 and report["built"] == ["2000-01-01"]
    assert "harvested" not in sidecar["spool"] and not any("harvested" in l for l in logs)
    variant_dir = Path(sidecar["spool_cache"])
    assert not any(variant_dir.rglob("*.dat"))
    assert (tmp_path / "out" / "failing" / "spool" / NET / "Precip" / "2000-01-01.dat").is_file()   # left in the run


def test_a_run_with_an_empty_cache_takes_the_published_days_from_s3(tmp_path, bucket, monkeypatch, fake_wbm):
    snap = _runnable(tmp_path, bucket, monkeypatch)
    plan = build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id="probe"), _config(tmp_path))[1].spool
    v = spool.variant(plan, evaluator=_evaluate)
    for day in ("2000-01-01", "2000-01-02"):
        _publish(bucket, v, f"Precip/{day}.dat", f"day {day}".encode())
    runtime = fake_wbm(["2000-01-01", "2000-01-02", "2000-01-03"])

    _, sidecar, report, _ = _run(snap, tmp_path, "from-s3", runtime, spool_cache=tmp_path / "scratch-cache")
    assert sidecar["spool_variant"] == v.id
    assert report["read"] == ["2000-01-01", "2000-01-02"] and report["built"] == ["2000-01-03"]
    assert sidecar["spool"]["downloaded"] == 2 and sidecar["spool"]["linked"] == 2 and sidecar["spool"]["harvested"] == 1


def test_a_bucket_that_cannot_be_reached_does_not_stop_the_run(tmp_path, monkeypatch, fake_wbm):
    monkeypatch.setattr(fetch, "S3_BASE", "http://127.0.0.1:9/openghm")
    snap = _make_snapshot(tmp_path)
    _sums(snap / "SHA256SUMS", {"model/wbm.pl": _sha("wbm")})
    _sums(tmp_model_input(tmp_path) / "SHA256SUMS", {f"network/{NET}.asc": _sha("network")})
    result, sidecar, report, logs = _run(snap, tmp_path, "offline", fake_wbm(["2000-01-01"]))
    assert result.exit_code == 0 and report["built"] == ["2000-01-01"]
    assert "cannot reach" in sidecar["spool"]["fill_error"] and sidecar["spool"]["harvested"] == 1
    assert any("S3 fill incomplete" in l for l in logs)


def test_run_cached_needs_a_cache_build(tmp_path, bucket, monkeypatch):
    snap = _runnable(tmp_path, bucket, monkeypatch)
    _c, built = build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id="s", spool="fresh"), _config(tmp_path))
    with pytest.raises(OpenghmError, match="not built with --spool cache"):
        spool.run_cached(built)


# ── the cap: units, leases, prune ─────────────────────────────────────────────

NOW = datetime(2026, 10, 6, 12, 0, 0, tzinfo=timezone.utc)

_MYQUOTA = """\
Type        Location                  Size      Limit     Use    Files     Limit     Use
===================================================================================================
home        x-someone                 1.2GB     25.0GB    5%     8.1K      -         -
scratch     /anvil/scratch/x-someone  2.1TB     100.0TB   2%     {used}    {limit}   6%
"""


def _quota(used: str, limit: str = "100"):
    """A ``subprocess.run`` that answers as ``myquota`` would."""
    def run(argv, **_kw):
        return subprocess.CompletedProcess(argv, 0, stdout=_MYQUOTA.format(used=used, limit=limit), stderr="")
    return run


def _stamp(days_ago: float = 0, hours: float = 0) -> str:
    return spool._utc(NOW - timedelta(days=days_ago, hours=hours))


def _unit(root: Path, vid: str, unit: str, last_used: str, *, on_s3=False, pairs=5, network=NET) -> Path:
    """``pairs`` days (``2 * pairs`` files) of ``unit`` in the variant ``vid`` of ``root``, indexed."""
    vdir = root / MID / network / vid
    for i in range(1, pairs + 1):
        name = f"{unit}-01-{i:02d}.dat" if unit != "clim" else f"{i:03d}.dat"
        _put(vdir, f"{'Precip' if unit != 'clim' else 'mod_obs'}/{name}", b"x" * 10)
    spool._write_json(str(vdir / ".units" / f"{unit}.json"), {
        "files": 2 * pairs, "bytes": pairs * (10 + 14),     # a day is 10 bytes and its header 14
        "last_used": last_used, "on_s3": on_s3})
    return vdir


def _remaining(root: Path) -> set:
    """``(variant, unit)`` of the units that still have a ``.dat`` under ``root``."""
    return {(p.parents[1].name, spool.unit_of(p.name)) for p in root.rglob("*.dat")
            if ".leases" not in p.parts and ".tmp" not in p.parts}


def _prune(root: Path, used: str, *, now=NOW, limit="100", **kw):
    kw.setdefault("high", 0.8)
    kw.setdefault("low", 0.5)
    return spool.prune(str(root), run=_quota(used, limit), now=now, **kw)


@pytest.mark.parametrize("text, expect", [
    (_MYQUOTA.format(used="59.6K", limit="1.0M"), (59_600, 1_000_000)),
    (_MYQUOTA.format(used="812", limit="2K"), (812, 2_000)),
    (_MYQUOTA.format(used="1.5M", limit="1.2G"), (1_500_000, 1_200_000_000)),
    # no header line: the last three columns are Files, Limit, Use
    ("scratch  /anvil/scratch/x  2.1TB  100.0TB  2%  59.6K  1.0M  6%\n", (59_600, 1_000_000)),
    # the columns are counted from the right: a location with spaces does not shift them
    ("Type Location Size Limit Use Files Limit Use\nscratch /a b/c 2.1TB 100TB 2% 3K 1M 0%\n", (3_000, 1_000_000)),
])
def test_parse_myquota_reads_the_scratch_row(text, expect):
    assert spool.parse_myquota(text) == expect


@pytest.mark.parametrize("text", [
    "",
    "Type Location Size Limit Use Files Limit Use\nhome x 1GB 2GB 5% 8.1K - -\n",              # no scratch row
    "Type Location Size Limit Use Files Limit Use\nscratch x 1GB 2GB 5% many lots 6%\n",     # counts do not read
    "Type Location Size Limit Use Files Limit Use\nscratch x 1GB 2GB 5% 8.1K 0 6%\n",         # no limit
    "scratch  x  2.1TB  100.0TB  2%\n",                                                         # too few columns
])
def test_parse_myquota_refuses_what_it_cannot_read(text):
    with pytest.raises(OpenghmError, match="scratch file quota"):
        spool.parse_myquota(text)


def test_read_quota_names_why_there_is_none(monkeypatch):
    with pytest.raises(OpenghmError, match="not on this machine"):
        spool.read_quota()                                  # the autouse fixture points at nothing
    failing = lambda argv, **kw: subprocess.CompletedProcess(argv, 3, stdout="", stderr="no such user")
    with pytest.raises(OpenghmError, match="exited 3: no such user"):
        spool.read_quota(run=failing)


def test_a_unit_is_a_year_or_the_climatology():
    assert spool.unit_of("2000-06-15.dat") == "2000" and spool.unit_of("2000-06-00.dat.hdr") == "2000"
    assert spool.unit_of("0000-06-15.dat") == "clim" and spool.unit_of("0000-06-15.dat.hdr") == "clim"
    assert spool.unit_of("001.dat") == "clim" and spool.unit_of("365.dat.hdr") == "clim"


def test_refresh_index_counts_dat_and_hdr_by_unit_and_sets_on_s3_from_the_listing(tmp_path):
    vdir = tmp_path / "v"
    for rel in ("Precip/2000-01-01.dat", "Precip/2000-01-02.dat", "Temp/2001-01-01.dat",
                "Precip/0000-01-01.dat", "mod_obs/001.dat", "LAI_MinMax/002.dat"):
        _put(vdir, rel, b"123456")
    (vdir / "Precip" / "2000-01-03.dat.part").write_bytes(b"not spool data")
    (vdir / ".units").mkdir(parents=True, exist_ok=True)
    (vdir / ".units" / "2009-01-01.dat").write_bytes(b"an index directory is never data")
    listing = {f"{rel}{ext}": 1 for rel in ("Precip/2000-01-01.dat", "Precip/2000-01-02.dat", "mod_obs/001.dat")
               for ext in ("", ".hdr")}
    spool.refresh_index(str(vdir), ["2000", "2001", "clim", "1990"], NOW, used=["2000"], listing=listing)
    got = {u: json.loads((vdir / ".units" / f"{u}.json").read_text()) for u in ("2000", "2001", "clim")}
    assert got["2000"] == {"files": 4, "bytes": 6 + 10 + 6 + 10, "last_used": _stamp(), "on_s3": True}
    assert got["2001"]["files"] == 2 and got["2001"]["on_s3"] is False           # the listing lacks it
    assert got["clim"]["files"] == 6 and got["clim"]["on_s3"] is False           # 0000-, mod_obs and _MinMax
    assert not (vdir / ".units" / "1990.json").exists()                          # nothing there: no index
    # not in `used`: last_used stays; `built` files only the run has make on_s3 false
    spool.refresh_index(str(vdir), ["2000"], NOW + timedelta(days=1), built=True)
    again = json.loads((vdir / ".units" / "2000.json").read_text())
    assert again["last_used"] == _stamp() and again["on_s3"] is False
    spool.refresh_index(str(vdir), ["2000"], NOW + timedelta(days=1))            # no listing: stays as it was
    assert json.loads((vdir / ".units" / "2000.json").read_text())["on_s3"] is False


# prune


def test_no_myquota_means_no_pruning(tmp_path):
    _unit(tmp_path, "v1", "2000", _stamp(100))
    got = spool.prune(str(tmp_path), high=0.8, low=0.5, now=NOW)
    assert got["deleted"] == [] and got["used"] is None and "myquota" in got["reason"]
    assert _remaining(tmp_path) == {("v1", "2000")}
    unreadable = lambda argv, **kw: subprocess.CompletedProcess(argv, 0, stdout="scratch ???\n", stderr="")
    logs = []
    got = spool.prune(str(tmp_path), high=0.8, low=0.5, run=unreadable, log=logs.append)
    assert got["deleted"] == [] and "scratch file quota" in got["reason"] and len(logs) == 1
    assert _remaining(tmp_path) == {("v1", "2000")}


def test_below_the_high_threshold_nothing_is_deleted(tmp_path):
    _unit(tmp_path, "v1", "2000", _stamp(100))
    got = _prune(tmp_path, "79")                                  # 79%: below 80%
    assert got["deleted"] == [] and got["after"] == 79 and "below 80%" in got["reason"]
    assert _remaining(tmp_path) == {("v1", "2000")}


def test_at_or_above_high_the_oldest_units_go_first_until_the_projection_is_at_or_below_low(tmp_path):
    for i, year in enumerate(("2000", "2001", "2002", "2003", "2004")):
        _unit(tmp_path, "v1", year, _stamp(50 - 10 * i))           # 2000 is the oldest
    _unit(tmp_path, "v2", "2000", _stamp(60))                     # another variant: older than all of them
    logs = []
    got = _prune(tmp_path, "80", log=logs.append)                  # exactly 80%: at the threshold
    # 10 files a unit; 80 - 50 = 30 to delete: the three oldest units
    assert [(d["variant_dir"].split(os.sep)[-1], d["unit"]) for d in got["deleted"]] == [
        ("v2", "2000"), ("v1", "2000"), ("v1", "2001")][:3] and got["deleted_files"] == 30
    assert got["used"] == 80 and got["after"] == 50 and got["after"] <= 0.5 * 100
    assert got["deleted_bytes"] == sum(d["bytes"] for d in got["deleted"]) == 3 * 120
    assert _remaining(tmp_path) == {("v1", "2002"), ("v1", "2003"), ("v1", "2004")}
    assert not (tmp_path / MID / NET / "v1" / ".units" / "2000.json").exists()
    assert (tmp_path / MID / NET / "v1" / ".units" / "2002.json").exists()
    assert any("deleted 3 units, 30 files" in l for l in logs) and any("v2" in l for l in logs)


def test_pruning_stops_at_the_target_and_says_when_the_cache_is_not_the_quota(tmp_path):
    _unit(tmp_path, "v1", "2000", _stamp(5))
    got = _prune(tmp_path, "95")                  # 45 files over; the cache holds 10
    assert got["deleted_files"] == 10 and got["after"] == 85 and "not what holds the quota" in got["reason"]
    assert _remaining(tmp_path) == set()
    assert _prune(tmp_path, "95")["deleted"] == []            # nothing left to delete


def test_among_units_last_used_the_same_day_one_s3_holds_goes_first(tmp_path):
    _unit(tmp_path, "v1", "2000", _stamp(3), on_s3=False)                        # earlier that day, only here
    _unit(tmp_path, "v1", "2001", _stamp(3, hours=-8), on_s3=True)               # later that day, on S3
    _unit(tmp_path, "v1", "2002", _stamp(4), on_s3=False)                        # an earlier day beats on_s3
    _unit(tmp_path, "v1", "2003", _stamp(2), on_s3=True)
    got = _prune(tmp_path, "70", high=0.6)                       # 70 - 50 = 20 files: two units
    assert [d["unit"] for d in got["deleted"]] == ["2002", "2001"]
    assert _remaining(tmp_path) == {("v1", "2000"), ("v1", "2003")}


def _lease(root: Path, sim: str, vdir: Path, units, expires: datetime) -> Path:
    path = root / ".leases" / f"{sim}.json"
    spool._write_json(str(path), {"variant_dir": str(vdir), "units": units, "expires": spool._utc(expires)})
    return path


def test_a_unit_an_unexpired_lease_names_is_never_deleted(tmp_path):
    v1 = _unit(tmp_path, "v1", "2000", _stamp(90))
    _unit(tmp_path, "v1", "2001", _stamp(80))
    v2 = _unit(tmp_path, "v2", "2000", _stamp(70))
    lease = _lease(tmp_path, "running", v1, ["2000"], NOW + timedelta(hours=1))
    got = _prune(tmp_path, "90")                                  # 40 files to delete; the cache holds 30 to give
    assert [(d["variant_dir"].split(os.sep)[-1], d["unit"]) for d in got["deleted"]] == [("v1", "2001"), ("v2", "2000")]
    assert _remaining(tmp_path) == {("v1", "2000")} and lease.exists() and got["after"] == 70
    assert (v1 / "Precip" / "2000-01-01.dat").exists() and not (v2 / "Precip" / "2000-01-01.dat").exists()


def test_an_expired_lease_is_removed_and_its_units_are_candidates(tmp_path):
    v1 = _unit(tmp_path, "v1", "2000", _stamp(90))
    expired = _lease(tmp_path, "gone", v1, ["2000"], NOW - timedelta(seconds=1))
    live = _lease(tmp_path, "live", v1, ["2000"], NOW + timedelta(hours=2))
    junk = tmp_path / ".leases" / "notes.txt"
    junk.write_text("not a lease")
    # the live lease still protects it, and the expired one is removed on the way
    got = _prune(tmp_path, "90")
    assert got["deleted"] == [] and got["expired_leases"] == 1 and got["skipped_leased"] == 0
    assert not expired.exists() and live.exists() and junk.exists()
    live.unlink()
    assert [d["unit"] for d in _prune(tmp_path, "90")["deleted"]] == ["2000"]
    assert _remaining(tmp_path) == set()


def test_leases_are_read_again_before_each_deletion(tmp_path, monkeypatch):
    v1 = _unit(tmp_path, "v1", "2000", _stamp(90))
    _unit(tmp_path, "v1", "2001", _stamp(80))
    _unit(tmp_path, "v1", "2002", _stamp(70))
    real = spool._delete_unit

    def delete(vdir, unit):
        out = real(vdir, unit)
        if unit == "2000":                       # a run starts while the first unit goes: it leases the next
            _lease(tmp_path, "newcomer", v1, ["2001"], NOW + timedelta(hours=1))
        return out

    monkeypatch.setattr(spool, "_delete_unit", delete)
    got = _prune(tmp_path, "95")                  # 45 files to delete
    assert [d["unit"] for d in got["deleted"]] == ["2000", "2002"] and got["skipped_leased"] == 1
    assert _remaining(tmp_path) == {("v1", "2001")}


def test_a_unit_goes_index_first_then_dat_files_then_hdr_files(tmp_path, monkeypatch):
    vdir = _unit(tmp_path, "v1", "2000", _stamp(9), pairs=3)
    order = []
    real = os.unlink
    monkeypatch.setattr(os, "unlink", lambda p, *a, **k: (order.append(os.path.relpath(p, vdir)), real(p, *a, **k))[1])
    got = _prune(tmp_path, "90")
    assert got["deleted_files"] == 6
    assert order[0] == os.path.join(".units", "2000.json")
    kinds = [".hdr" if o.endswith(".hdr") else ".dat" for o in order[1:]]
    assert kinds == [".dat"] * 3 + [".hdr"] * 3


def test_a_dry_run_deletes_nothing_and_prints_the_same_plan(tmp_path):
    v1 = _unit(tmp_path, "v1", "2000", _stamp(90))
    _unit(tmp_path, "v1", "2001", _stamp(80))
    _unit(tmp_path, "v1", "2002", _stamp(70))
    expired = _lease(tmp_path, "gone", v1, ["2002"], NOW - timedelta(hours=1))
    before = sorted(str(p) for p in tmp_path.rglob("*"))
    logs = []
    plan = _prune(tmp_path, "95", dry_run=True, log=logs.append)
    assert sorted(str(p) for p in tmp_path.rglob("*")) == before and expired.exists()
    assert plan["dry_run"] is True and plan["deleted_files"] == 30 and plan["after"] == 65
    assert any("would delete 3 units, 30 files" in l for l in logs) and any("would be 65" in l for l in logs)
    done = _prune(tmp_path, "95")
    assert [d["unit"] for d in done["deleted"]] == [d["unit"] for d in plan["deleted"]]
    assert done["deleted_files"] == plan["deleted_files"] and not expired.exists()


def test_a_variant_without_an_index_is_counted_when_pruning_first_sees_it(tmp_path):
    vdir = tmp_path / MID / NET / "legacy"
    for year in ("2000", "2001"):
        for d in (1, 2):
            _put(vdir, f"Precip/{year}-01-{d:02d}.dat", b"y" * 7)
    old = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc).timestamp()
    for f in (vdir / "Precip").glob("2000-*"):
        os.utime(f, (old, old))
    got = _prune(tmp_path, "90", dry_run=True)
    assert [d["unit"] for d in got["deleted"]] == ["2000", "2001"] and got["deleted"][0]["last_used"] == "2026-01-02T03:04:05Z"
    assert got["deleted"][0]["files"] == 4 and got["deleted"][0]["on_s3"] is False
    assert not (vdir / ".units").exists()                          # a dry run writes nothing
    _prune(tmp_path, "90")
    assert not any(vdir.rglob("*.dat"))


def test_a_unit_without_an_index_in_an_indexed_variant_is_counted_too(tmp_path):
    vdir = _unit(tmp_path, "v1", "2000", _stamp(10))
    for d in (1, 2):
        _put(vdir, f"Precip/2005-01-{d:02d}.dat")                  # a file the index never heard of
    (vdir / ".units" / "2000.json").write_text("{not json")        # and an index that cannot be read
    spool._write_json(str(vdir / ".units" / "2003.json"), {        # and one of a year a purge emptied
        "files": 40, "bytes": 1, "last_used": _stamp(500), "on_s3": True})
    got = _prune(tmp_path, "80", dry_run=True)
    assert sorted(d["unit"] for d in got["deleted"]) == ["2000", "2005"]
    assert sorted(d["files"] for d in got["deleted"]) == [4, 10]
    _prune(tmp_path, "80")
    assert not (vdir / ".units" / "2003.json").exists() and not (vdir / ".units" / "2005.json").exists()


def test_dot_directories_of_the_cache_are_never_spool_data(tmp_path):
    _unit(tmp_path, "v1", "2000", _stamp(10))
    for hidden in (".tmp/sim1/Precip/2000-01-01.dat", ".leases/x/Precip/2000-01-01.dat"):
        _put(tmp_path, hidden)
    got = _prune(tmp_path, "90")
    assert [d["unit"] for d in got["deleted"]] == ["2000"]
    assert (tmp_path / ".tmp/sim1/Precip/2000-01-01.dat").exists() and (tmp_path / ".leases/x/Precip/2000-01-01.dat").exists()


@pytest.mark.parametrize("high, low", [(0.5, 0.5), (0.5, 0.8), (0.8, -0.1), (1.5, 0.5)])
def test_low_must_be_below_high(tmp_path, high, low):
    _unit(tmp_path, "v1", "2000", _stamp(10))
    with pytest.raises(OpenghmError, match="thresholds"):
        _prune(tmp_path, "95", high=high, low=low)
    assert _remaining(tmp_path) == {("v1", "2000")}


# leases, links and the run around them


def _sidecar(plan: SpoolPlan, **extra) -> Path:
    path = Path(plan.workdir) / "simulation.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"spool_plan": plan.to_dict(), **extra}))
    return path


def test_walltimes_are_slurms():
    for text, hours in (("24:00:00", 24), ("1-00:00:00", 24), ("4-00:00:00", 96), ("90", 1.5), ("2-12", 60),
                        ("1-02:30", 26.5), ("30:00", 0.5)):
        assert spool._walltime(text) == timedelta(hours=hours), text
    assert spool._walltime("soon") is None and spool._walltime(None) is None


def test_prepare_leases_the_linked_units_until_the_walltime_and_harvest_releases_them(tmp_path, bucket):
    plan = _plan(tmp_path, s3_base=bucket.url)
    v = _variant(plan)
    for rel in ("Precip/1999-06-15.dat", "Precip/2000-06-15.dat", "Precip/2010-06-15.dat", "Precip/0000-06-15.dat",
                "mod_obs/001.dat"):
        _put(Path(v.dir), rel)
    _sidecar(plan, walltime="2:00:00")
    before = datetime.now(timezone.utc)
    got = spool.prepare(plan, evaluator=_evaluate)
    lease = tmp_path / "spools" / ".leases" / "sim1.json"
    rec = json.loads(lease.read_text())
    assert rec["variant_dir"] == v.dir and rec["units"] == ["1999", "2000", "clim"]       # 2010 is out of the years
    until = spool._parse_utc(rec["expires"])
    assert before + timedelta(hours=2) - timedelta(seconds=2) <= until <= datetime.now(timezone.utc) + timedelta(hours=2)
    # the index: counted, last_used set for the linked units, the one not linked left alone
    units = tmp_path / "spools" / MID / NET / v.id / ".units"
    assert sorted(p.name for p in units.iterdir()) == ["1999.json", "2000.json", "clim.json"]
    assert json.loads((units / "2000.json").read_text())["files"] == 2
    assert json.loads((units / "clim.json").read_text())["files"] == 4
    assert got["dangling"] == 0 and got["linked"] == 4

    run = Path(plan.run_spool) / NET / "Precip"
    (run / "2003-01-01.dat").write_bytes(b"built")
    (run / "2003-01-01.dat.hdr").write_bytes(b"hdr")
    spool.harvest(plan)
    assert not lease.exists()
    assert json.loads((units / "2003.json").read_text()) == {
        "files": 2, "bytes": 8, "on_s3": False, "last_used": json.loads((units / "2003.json").read_text())["last_used"]}


def test_a_lease_without_a_walltime_runs_97_hours(tmp_path, bucket):
    plan = _plan(tmp_path, s3_base=bucket.url)
    _put(Path(_variant(plan).dir), "Precip/2000-06-15.dat")
    spool.prepare(plan, evaluator=_evaluate)                # no simulation.json at all
    rec = json.loads((tmp_path / "spools" / ".leases" / "sim1.json").read_text())
    left = spool._parse_utc(rec["expires"]) - datetime.now(timezone.utc)
    assert timedelta(hours=96, minutes=59) < left <= timedelta(hours=97)


def test_prepare_takes_on_s3_from_the_listing_it_reads(tmp_path, bucket):
    plan = _plan(tmp_path, s3_base=bucket.url)
    v = _variant(plan)
    for rel in ("Precip/2000-06-15.dat", "Precip/2001-06-15.dat"):
        _put(Path(v.dir), rel)
    _publish(bucket, v, "Precip/2000-06-15.dat")              # S3 holds 2000, and a 2002 the cache lacks
    _publish(bucket, v, "Precip/2002-06-15.dat")
    spool.prepare(plan, evaluator=_evaluate)
    units = Path(v.dir) / ".units"
    got = {p.stem: json.loads(p.read_text()) for p in units.iterdir()}
    assert got["2000"]["on_s3"] is True and got["2001"]["on_s3"] is False
    assert got["2002"]["files"] == 2 and got["2002"]["on_s3"] is True      # downloaded by the fill, not linked by name only


def test_prepare_removes_a_link_whose_target_is_gone_and_counts_it(tmp_path, bucket, monkeypatch):
    plan = _plan(tmp_path, s3_base=bucket.url)
    v = _variant(plan)
    for rel in ("Precip/2000-06-15.dat", "Precip/2000-06-16.dat"):
        _put(Path(v.dir), rel)
    _sidecar(plan)
    real = spool.link

    def link_then_a_prune_strikes(p, variant, chosen=None):
        n = real(p, variant, chosen)
        (Path(v.dir) / "Precip" / "2000-06-15.dat").unlink()          # the target is gone: the .hdr stays
        return n

    monkeypatch.setattr(spool, "link", link_then_a_prune_strikes)
    logs = []
    got = spool.prepare(plan, evaluator=_evaluate, log=logs.append)
    run = Path(plan.run_spool) / NET / "Precip"
    assert sorted(p.name for p in run.iterdir()) == ["2000-06-16.dat", "2000-06-16.dat.hdr"]   # the pair goes together
    assert got["linked"] == 2 and got["dangling"] == 1
    assert json.loads(Path(plan.workdir, "simulation.json").read_text())["spool"]["dangling"] == 1
    assert any("1 linked days were gone" in l for l in logs)


def test_prepare_holds_a_lease_on_the_runs_years_while_it_fills(tmp_path, bucket, monkeypatch):
    plan = _plan(tmp_path, s3_base=bucket.url)
    _sidecar(plan)
    real = spool.fill
    seen = {}

    def fill_and_look(p, variant, listing=None):
        held, _expired = spool._leases(p.cache_root, datetime.now(timezone.utc))
        seen["held"] = {u for d, u in held if d == variant.dir}
        return real(p, variant, listing=listing)

    monkeypatch.setattr(spool, "fill", fill_and_look)
    spool.prepare(plan, evaluator=_evaluate, log=lambda *_: None)
    first, last = _variant(plan).years
    assert spool.CLIM_UNIT in seen["held"]
    if first is not None and last is not None:
        assert {str(y) for y in range(first, last + 1)} <= seen["held"]


def test_drop_dangling_leaves_working_links_files_and_other_targets_alone(tmp_path):
    plan = _plan(tmp_path)
    v = _variant(plan)
    _put(Path(v.dir), "Precip/2000-06-15.dat")
    spool.link(plan, v)
    run = Path(plan.run_spool) / NET / "Precip"
    (run / "2000-06-16.dat").write_bytes(b"built here")
    (run / "elsewhere.dat").symlink_to("/somewhere/else.dat")                 # not into the cache: not ours
    assert spool.drop_dangling(plan, v) == 0
    assert sorted(p.name for p in run.iterdir()) == ["2000-06-15.dat", "2000-06-15.dat.hdr", "2000-06-16.dat", "elsewhere.dat"]
    (Path(v.dir) / "Precip" / "2000-06-15.dat.hdr").unlink()
    assert spool.drop_dangling(plan, v) == 1
    assert sorted(p.name for p in run.iterdir()) == ["2000-06-16.dat", "elsewhere.dat"]


def test_link_ignores_the_index_directory(tmp_path):
    plan = _plan(tmp_path)
    v = _variant(plan)
    _put(Path(v.dir), "Precip/2000-06-15.dat")
    _put(Path(v.dir), ".units/2000-06-15.dat")
    assert spool.link(plan, v) == 1
    assert not (Path(plan.run_spool) / NET / ".units").exists()


def test_prepare_prunes_first_by_the_plans_thresholds_and_records_it(tmp_path, bucket, monkeypatch):
    plan = _plan(tmp_path, s3_base=bucket.url)
    plan.prune_high, plan.prune_low = 0.7, 0.2
    _sidecar(plan)
    _unit(tmp_path / "spools", "other", "1990", _stamp(400))
    monkeypatch.setattr(spool, "MYQUOTA", _fake_myquota_command(tmp_path, "90"))   # 90% of 100 files
    logs = []
    got = spool.prepare(plan, evaluator=_evaluate, log=logs.append)
    pruned = got["prune"]
    assert (pruned["high"], pruned["low"], pruned["used"], pruned["limit"]) == (0.7, 0.2, 90, 100)
    assert [d["unit"] for d in pruned["deleted"]] == ["1990"] and pruned["after"] == 80
    assert not list((tmp_path / "spools" / MID / NET / "other").rglob("*.dat"))
    assert logs[0].startswith("spool: scratch files 90 of 100")             # before anything else is said
    assert json.loads(Path(plan.workdir, "simulation.json").read_text())["spool"]["prune"] == pruned


def test_a_prune_that_fails_does_not_fail_the_run(tmp_path, bucket, monkeypatch):
    plan = _plan(tmp_path, s3_base=bucket.url)
    _sidecar(plan)
    _put(Path(_variant(plan).dir), "Precip/2000-06-15.dat")

    def boom(*_a, **_k):
        raise RuntimeError("the quota system fell over")

    monkeypatch.setattr(spool, "prune", boom)
    logs = []
    got = spool.prepare(plan, evaluator=_evaluate, log=logs.append)
    assert got["linked"] == 1 and got["prune"] == {"error": "the quota system fell over"}
    assert any("prune failed: the quota system fell over" in l for l in logs)
    side = json.loads(Path(plan.workdir, "simulation.json").read_text())
    assert side["spool"]["prune"] == {"error": "the quota system fell over"} and side["spool"]["linked"] == 1


def test_a_plan_whose_thresholds_are_wrong_still_runs(tmp_path, bucket):
    plan = _plan(tmp_path, s3_base=bucket.url)
    plan.prune_high, plan.prune_low = 0.3, 0.6
    _sidecar(plan)
    got = spool.prepare(plan, evaluator=_evaluate)
    assert "thresholds" in got["prune"]["error"]


def test_the_plan_carries_the_configs_thresholds(tmp_path, bucket, monkeypatch):
    snap = _runnable(tmp_path, bucket, monkeypatch)
    cfg = Config(**{**_config(tmp_path).__dict__, "spool_prune_high": 0.9, "spool_prune_low": 0.4})
    _c, built = build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id="t"), cfg, runtime="singularity")
    assert (built.spool.prune_high, built.spool.prune_low) == (0.9, 0.4)
    old = built.spool.to_dict()
    del old["prune_high"], old["prune_low"]                        # a plan recorded before the cap
    assert (SpoolPlan.from_dict(old).prune_high, SpoolPlan.from_dict(old).prune_low) == (0.8, 0.5)
    assert (Config().spool_prune_high, Config().spool_prune_low) == (0.8, 0.5)


def _fake_myquota_command(tmp_path: Path, used: str, limit: str = "100") -> str:
    script = tmp_path / "bin" / "myquota"
    script.parent.mkdir(exist_ok=True)
    script.write_text("#!/bin/sh\ncat <<'EOF'\n" + _MYQUOTA.format(used=used, limit=limit) + "EOF\n")
    script.chmod(0o755)
    return str(script)


def test_cli_spool_prune_dry_run_and_for_real(tmp_path, monkeypatch):
    cache = tmp_path / "spools"
    _unit(cache, "v1", "2000", spool._utc(datetime.now(timezone.utc) - timedelta(days=9)))
    _unit(cache, "v1", "2001", spool._utc(datetime.now(timezone.utc) - timedelta(days=1)))
    monkeypatch.setattr(spool, "MYQUOTA", _fake_myquota_command(tmp_path, "85"))
    cfg = str(_cli_config(tmp_path))
    runner = CliRunner()

    out = runner.invoke(cli, ["spool", "prune", "--dry-run", "--config", cfg, "--low", "0.75"])
    assert out.exit_code == 0, out.output
    assert "would delete 1 units, 10 files" in out.output and "2000" in out.output
    assert _remaining(cache) == {("v1", "2000"), ("v1", "2001")}

    out = runner.invoke(cli, ["spool", "prune", "--config", cfg, "--json", "--low", "0.75"])
    got = json.loads(out.output)
    assert out.exit_code == 0 and got["deleted_files"] == 10 and got["after"] == 75 and got["dry_run"] is False
    assert [d["unit"] for d in got["deleted"]] == ["2000"] and _remaining(cache) == {("v1", "2001")}

    out = runner.invoke(cli, ["spool", "prune", "--config", cfg, "--high", "0.9"])      # 75% < 90%
    assert out.exit_code == 0 and "nothing to delete" in out.output


def test_cli_spool_prune_refuses_low_at_or_above_high(tmp_path, monkeypatch):
    monkeypatch.setattr(spool, "MYQUOTA", _fake_myquota_command(tmp_path, "85"))
    out = CliRunner().invoke(cli, ["spool", "prune", "--config", str(_cli_config(tmp_path)),
                                   "--high", "0.5", "--low", "0.5"])
    assert out.exit_code == 2 and "thresholds" in out.output


def test_cli_spool_prune_without_myquota_deletes_nothing(tmp_path):
    out = CliRunner().invoke(cli, ["spool", "prune", "--config", str(_cli_config(tmp_path))])
    assert out.exit_code == 0 and "no pruning" in out.output and "myquota" in out.output


# ── spool status, prune --all, the quota's bytes ──────────────────────────────


@pytest.mark.parametrize("text, expect", [
    ("0B", 0), ("812B", 812), ("1KB", 1_000), ("1.5MB", 1_500_000), ("91.9GB", 91_900_000_000),
    ("2.1TB", 2_100_000_000_000), ("100.0TB", 100 * 10**12), ("1PB", 10**15), ("5", 5), ("2.5gb", 2_500_000_000),
])
def test_quota_sizes_are_decimal(text, expect):
    assert spool._quota_bytes(text) == expect


@pytest.mark.parametrize("text", ["", "-", "GB", "1.5XB", "1 GB", "much"])
def test_quota_sizes_refuse_what_is_not_one(text):
    with pytest.raises(ValueError):
        spool._quota_bytes(text)


@pytest.mark.parametrize("text, expect", [
    (_MYQUOTA.format(used="59.6K", limit="1.0M"),
     {"files_used": 59_600, "files_limit": 1_000_000, "bytes_used": 2_100_000_000_000, "bytes_limit": 100 * 10**12}),
    # no header line: Size Limit Use Files Limit Use from the right
    ("scratch  /anvil/scratch/x  91.9GB  100.0TB  0%  59.6K  1.0M  6%\n",
     {"files_used": 59_600, "files_limit": 1_000_000, "bytes_used": 91_900_000_000, "bytes_limit": 100 * 10**12}),
    # a location with spaces does not shift the columns counted from the right
    ("Type Location Size Limit Use Files Limit Use\nscratch /a b/c 512MB 1TB 0% 3K 1M 0%\n",
     {"files_used": 3_000, "files_limit": 1_000_000, "bytes_used": 512_000_000, "bytes_limit": 10**12}),
])
def test_parse_scratch_quota_reads_files_and_bytes(text, expect):
    assert spool.parse_scratch_quota(text) == expect


def test_parse_scratch_quota_refuses_what_it_cannot_read():
    with pytest.raises(OpenghmError, match="scratch file quota"):
        spool.parse_scratch_quota("")
    with pytest.raises(OpenghmError, match="scratch size quota"):
        spool.parse_scratch_quota("Type Location Size Limit Use Files Limit Use\nscratch x 1GB - 5% 8.1K 1M 6%\n")
    with pytest.raises(OpenghmError, match="scratch size quota"):
        spool.parse_scratch_quota("Type Location Files Limit Use\nscratch x 8.1K 1M 6%\n")     # no Size column
    with pytest.raises(OpenghmError, match="not on this machine"):
        spool.read_scratch_quota()


def _status(root: Path, *, used="60", limit="100", now=NOW):
    return spool.status(str(root), high=0.8, low=0.5, run=_quota(used, limit), now=now)


def test_status_counts_variants_units_leases_and_totals(tmp_path):
    v1 = _unit(tmp_path, "v1", "2000", _stamp(9), on_s3=True)
    _unit(tmp_path, "v1", "2001", _stamp(3))
    v2 = _unit(tmp_path, "v2", "clim", _stamp(1), pairs=2)
    # a unit with no index: counted from its files, last used its newest file's mtime, not on S3
    for i in (1, 2, 3):
        _put(tmp_path / MID / NET / "v1", f"Precip/2002-01-{i:02d}.dat", b"x" * 10)
    mtime = NOW.timestamp() - 5 * 86400
    for f in (tmp_path / MID / NET / "v1" / "Precip").glob("2002-*"):
        os.utime(f, (mtime, mtime))
    (tmp_path / MID / NET / "empty").mkdir()                      # a variant directory with no unit
    _lease(tmp_path, "run1", v1, ["2000", "2001"], NOW + timedelta(hours=3))
    _lease(tmp_path, "run2", v2, ["clim"], NOW + timedelta(days=1))
    _lease(tmp_path, "old", v1, ["2002"], NOW - timedelta(seconds=1))
    (tmp_path / ".leases" / "notes.txt").write_text("not a lease")

    got = _status(tmp_path)
    assert got["quota"] == {"files_used": 60, "files_limit": 100, "bytes_used": 2_100_000_000_000,
                            "bytes_limit": 100 * 10**12}
    assert got["quota_error"] is None and (got["high"], got["low"]) == (0.8, 0.5)
    assert got["cache_root"] == str(tmp_path)
    assert [(v["variant"], v["model_input_id"], v["network"], v["dir"]) for v in got["variants"]] == [
        ("v2", MID, NET, str(v2)), ("v1", MID, NET, str(v1))]                  # newest last use first
    v2s, v1s = got["variants"]
    assert v2s == {"model_input_id": MID, "network": NET, "variant": "v2", "dir": str(v2), "units": 1,
                   "files": 4, "bytes": 2 * 24, "last_used": _stamp(1), "on_s3_units": 0, "leased_units": 1}
    assert v1s["units"] == 3 and v1s["files"] == 10 + 10 + 6 and v1s["bytes"] == 5 * 24 * 2 + 3 * (10 + 14)
    assert v1s["last_used"] == _stamp(3) and v1s["on_s3_units"] == 1 and v1s["leased_units"] == 2
    # the expired lease and the stray file are not leases
    assert got["leases"] == [
        {"sim_id": "run1", "variant_dir": str(v1), "units": ["2000", "2001"], "expires": spool._utc(NOW + timedelta(hours=3))},
        {"sim_id": "run2", "variant_dir": str(v2), "units": ["clim"], "expires": spool._utc(NOW + timedelta(days=1))}]
    assert got["totals"] == {"units": 4, "files": 4 + 26, "bytes": 2 * 24 + v1s["bytes"]}
    assert (tmp_path / ".leases" / "old.json").exists()                      # nothing is deleted or written
    assert not (tmp_path / MID / NET / "v1" / ".units" / "2002.json").exists()
    assert json.loads(json.dumps(got)) == got


def test_status_of_an_empty_or_absent_cache_root(tmp_path):
    for root in (tmp_path, tmp_path / "absent"):
        got = _status(root)
        assert got["variants"] == [] and got["leases"] == [] and got["totals"] == {"units": 0, "files": 0, "bytes": 0}
        assert got["quota"]["files_used"] == 60


def test_status_without_myquota_has_a_null_quota_and_says_why(tmp_path):
    _unit(tmp_path, "v1", "2000", _stamp(1))
    got = spool.status(str(tmp_path), high=0.8, low=0.5, now=NOW)         # the autouse fixture: no myquota
    assert got["quota"] is None and "myquota" in got["quota_error"] and got["totals"]["units"] == 1


def test_cli_spool_status_json_and_table(tmp_path, monkeypatch):
    cache = tmp_path / "spools"
    _unit(cache, "v1", "2000", spool._utc(datetime.now(timezone.utc) - timedelta(days=2)), on_s3=True)
    monkeypatch.setattr(spool, "MYQUOTA", _fake_myquota_command(tmp_path, "85"))
    cfg = str(_cli_config(tmp_path))
    out = CliRunner().invoke(cli, ["spool", "status", "--config", cfg, "--json"])
    assert out.exit_code == 0, out.output
    got = json.loads(out.output)
    assert set(got) == {"quota", "quota_error", "high", "low", "cache_root", "variants", "leases", "totals"}
    assert got["quota"]["files_used"] == 85 and got["cache_root"] == str(cache)
    assert (got["high"], got["low"]) == (0.8, 0.5) and got["variants"][0]["on_s3_units"] == 1
    out = CliRunner().invoke(cli, ["spool", "status", "--config", cfg])
    assert out.exit_code == 0 and "85 of 100" in out.output and "v1" in out.output and "MODEL INPUT" in out.output
    assert _remaining(cache) == {("v1", "2000")}


def test_cli_spool_status_without_myquota(tmp_path):
    cfg = str(_cli_config(tmp_path))
    got = json.loads(CliRunner().invoke(cli, ["spool", "status", "--config", cfg, "--json"]).output)
    assert got["quota"] is None and got["variants"] == []
    out = CliRunner().invoke(cli, ["spool", "status", "--config", cfg])
    assert out.exit_code == 0 and "no quota" in out.output


def test_prune_all_deletes_every_unleased_unit_whatever_the_quota(tmp_path):
    v1 = _unit(tmp_path, "v1", "2000", _stamp(90))
    _unit(tmp_path, "v1", "2001", _stamp(80))
    _unit(tmp_path, "v2", "clim", _stamp(70))
    _unit(tmp_path, "v2", "2005", _stamp(60), on_s3=True)
    _lease(tmp_path, "running", v1, ["2000"], NOW + timedelta(hours=1))
    got = _prune(tmp_path, "10", everything=True)                        # 10% used: a plain prune does nothing
    assert got["all"] is True and got["dry_run"] is False and got["reason"] is None
    assert [(d["variant_dir"].split(os.sep)[-1], d["unit"]) for d in got["deleted"]] == [
        ("v1", "2001"), ("v2", "clim"), ("v2", "2005")]                    # the order prune uses
    assert got["deleted_files"] == 30 and got["deleted_bytes"] == 3 * 5 * 24
    assert got["skipped_leased"] == 1 and got["used"] == 10 and got["after"] == -20
    assert _remaining(tmp_path) == {("v1", "2000")} and (v1 / "Precip" / "2000-01-01.dat").exists()
    assert _prune(tmp_path, "10")["deleted"] == [] and "all" not in _prune(tmp_path, "10")


def test_prune_all_dry_run_deletes_and_writes_nothing(tmp_path):
    _unit(tmp_path, "v1", "2000", _stamp(90))
    _unit(tmp_path, "v1", "2001", _stamp(80))
    expired = _lease(tmp_path, "gone", tmp_path / MID / NET / "v1", ["2000"], NOW - timedelta(hours=1))
    got = _prune(tmp_path, "10", everything=True, dry_run=True)
    assert got["dry_run"] is True and got["deleted_files"] == 20 and len(got["deleted"]) == 2
    assert _remaining(tmp_path) == {("v1", "2000"), ("v1", "2001")} and expired.exists()
    assert (tmp_path / MID / NET / "v1" / ".units" / "2000.json").exists()


def test_prune_all_without_myquota_or_with_unusable_thresholds_still_clears(tmp_path):
    _unit(tmp_path, "v1", "2000", _stamp(90))
    got = spool.prune(str(tmp_path), high=0.5, low=0.5, everything=True, now=NOW)       # no myquota, low == high
    assert got["used"] is None and got["after"] is None and got["deleted_files"] == 10
    assert _remaining(tmp_path) == set()
    again = spool.prune(str(tmp_path), high=0.5, low=0.5, everything=True, now=NOW)
    assert again["deleted"] == [] and "empty" in again["reason"]
    with pytest.raises(OpenghmError, match="thresholds"):
        spool.prune(str(tmp_path), high=0.5, low=0.5, now=NOW)                          # without all it is refused


def test_cli_spool_prune_all(tmp_path, monkeypatch):
    cache = tmp_path / "spools"
    v1 = _unit(cache, "v1", "2000", spool._utc(datetime.now(timezone.utc) - timedelta(days=9)))
    _unit(cache, "v1", "2001", spool._utc(datetime.now(timezone.utc) - timedelta(days=1)))
    _unit(cache, "v1", "2002", spool._utc(datetime.now(timezone.utc) - timedelta(days=2)))
    _lease(cache, "running", v1, ["2002"], datetime.now(timezone.utc) + timedelta(hours=1))
    monkeypatch.setattr(spool, "MYQUOTA", _fake_myquota_command(tmp_path, "5"))          # 5%: far below high
    cfg = str(_cli_config(tmp_path))
    runner = CliRunner()

    out = runner.invoke(cli, ["spool", "prune", "--all", "--dry-run", "--config", cfg])
    assert out.exit_code == 0, out.output
    assert "would delete 2 units, 20 files" in out.output and "held by leases" in out.output
    assert _remaining(cache) == {("v1", "2000"), ("v1", "2001"), ("v1", "2002")}

    out = runner.invoke(cli, ["spool", "prune", "--all", "--json", "--config", cfg])
    got = json.loads(out.output)
    assert out.exit_code == 0 and got["all"] is True and got["deleted_files"] == 20 and got["skipped_leased"] == 1
    assert sorted(d["unit"] for d in got["deleted"]) == ["2000", "2001"] and _remaining(cache) == {("v1", "2002")}

    out = runner.invoke(cli, ["spool", "prune", "--config", cfg, "--json"])                 # without --all: below high
    assert json.loads(out.output)["deleted"] == [] and "all" not in json.loads(out.output)


# ── the CLI ───────────────────────────────────────────────────────────────────


def _cli_config(tmp_path: Path) -> Path:
    cfg = tmp_path / "config.toml"
    cfg.write_text("\n".join(f'{k} = "{v}"' for k, v in {
        "sif_dir": tmp_path / "sif", "model_input_dir": tmp_path / "model-inputs",
        "output_base": tmp_path / "out", "spool_cache": tmp_path / "spools"}.items()) + "\n")
    return cfg


def test_cli_spool_variant_prints_the_variant_and_its_inputs_as_json(tmp_path, bucket, monkeypatch):
    snap = _runnable(tmp_path, bucket, monkeypatch)
    seen = []

    def evaluator(plan):
        seen.append(plan)
        return copy.deepcopy(INIT)

    monkeypatch.setattr(spool, "container_evaluator", evaluator)
    out = CliRunner().invoke(cli, ["spool", "variant", str(snap), "--config", str(_cli_config(tmp_path)),
                                   "--run-end", "2001-12-31"])
    assert out.exit_code == 0, out.output
    got = json.loads(out.output)
    assert got["variant"] == _vid(seen[0]) and got["network"] == NET and got["years"] == [1998, 2002]
    assert got["dir"] == str(tmp_path / "spools" / MID / NET / got["variant"])
    assert got["inputs"]["network"] == _sha("network") and "Output_vars" not in got["inputs"]["init"]
    # the same code path as sim: the init under evaluation is the one sim generates for the run
    assert seen[0].init_container == "/wbm/wbm_init/wbm_test.init" and seen[0].sim_id == "variant"


def test_cli_spool_variant_init_option_and_errors(tmp_path, bucket, monkeypatch):
    snap = _runnable(tmp_path, bucket, monkeypatch)
    monkeypatch.setattr(spool, "container_evaluator", lambda plan: copy.deepcopy(INIT))
    out = CliRunner().invoke(cli, ["spool", "variant", str(snap), "--config", str(_cli_config(tmp_path)),
                                   "--init", "absent.init"])
    assert out.exit_code == 2 and "init file not found" in out.output


def test_cli_sbatch_steps_run_prepare_and_harvest_from_the_sim_dir(tmp_path, bucket, monkeypatch, fake_wbm):
    """What a ``sim submit`` job script does on the compute node, step by step."""
    snap = _runnable(tmp_path, bucket, monkeypatch)
    monkeypatch.setattr(spool, "container_evaluator", _evaluate)
    _c, built = build_submit(SubmitOptions(snapshot_dir=str(snap), simulation_id="batch"), _config(tmp_path))
    stage_files(built)              # `sim submit` stages, then sbatch starts the script
    work = tmp_path / "out" / "batch"
    runner = CliRunner()

    out = runner.invoke(cli, ["spool", "prepare", str(work)])
    assert out.exit_code == 0, out.output
    assert "downloaded 0 days, linked 0" in out.output
    side = json.loads((work / "simulation.json").read_text())
    assert side["spool"]["linked"] == 0 and (work / "spool-cache").resolve() == Path(side["spool_cache"]).resolve()
    assert (work / "spool" / ".cache").is_dir()                       # the mount point of the bind
    run = work / "spool" / NET / "Precip"
    run.mkdir(parents=True)
    (run / "2000-01-01.dat").write_bytes(b"built")
    (run / "2000-01-01.dat.hdr").write_bytes(b"hdr")
    out = runner.invoke(cli, ["spool", "harvest", str(work)])
    assert out.exit_code == 0 and "harvested 1 days" in out.output, out.output
    assert (Path(side["spool_cache"]) / "Precip" / "2000-01-01.dat").read_bytes() == b"built"
    assert json.loads((work / "simulation.json").read_text())["spool"]["harvested"] == 1


@pytest.mark.parametrize("args, match", [
    (["prepare", "{tmp}/absent"], "no simulation.json"),
    (["harvest", "{tmp}/fresh"], "no spool_plan"),
])
def test_cli_spool_steps_name_what_is_missing(tmp_path, args, match):
    (tmp_path / "fresh").mkdir()
    (tmp_path / "fresh" / "simulation.json").write_text(json.dumps({"spool_mode": "fresh"}))
    out = CliRunner().invoke(cli, ["spool", *[a.format(tmp=tmp_path) for a in args]])
    assert out.exit_code == 2 and match in out.output


def test_cli_sim_run_defaults_to_the_cache_and_lists_the_modes():
    out = CliRunner().invoke(cli, ["sim", "run", "--help"])
    assert "[default: cache]" in " ".join(out.output.split()) and "fresh" in out.output
    out = CliRunner().invoke(cli, ["sim", "submit", "--help"])
    assert "[default: cache]" in " ".join(out.output.split())


def test_cli_sim_run_with_the_cache_fills_runs_and_harvests(tmp_path, bucket, monkeypatch, fake_wbm):
    snap = _runnable(tmp_path, bucket, monkeypatch)
    monkeypatch.setattr(spool, "container_evaluator", _evaluate)
    runtime = fake_wbm(["2000-01-01"])
    out = CliRunner().invoke(cli, ["sim", "run", str(snap), "--id", "cli1", "--runtime", runtime,
                                   "--config", str(_cli_config(tmp_path))])      # `singularity` is the fake
    assert out.exit_code == 0, out.output
    side = json.loads((tmp_path / "out" / "cli1" / "simulation.json").read_text())
    assert side["exit_code"] == 0 and side["spool"]["harvested"] == 1 and side["spool_mode"] == "cache"
    assert "spool: variant" in out.output


def test_a_lease_is_as_long_as_the_walltime_the_run_was_given(tmp_path, bucket, monkeypatch, fake_wbm):
    snap = _runnable(tmp_path, bucket, monkeypatch)
    runtime = fake_wbm(["2000-01-01"], exit=3)               # exits non-zero: no harvest, so the lease stays
    before = datetime.now(timezone.utc)
    result, sidecar, _report, _ = _run(snap, tmp_path, "long", runtime, walltime="22:30:00")
    assert result.exit_code == 3 and sidecar["walltime"] == "22:30:00"
    rec = json.loads((tmp_path / "spools" / ".leases" / "long.json").read_text())
    until = spool._parse_utc(rec["expires"])
    assert before + timedelta(hours=22, minutes=30) - timedelta(seconds=2) <= until
    assert until <= datetime.now(timezone.utc) + timedelta(hours=22, minutes=30)
    # without the option the metadata's 15 minutes still rule
    _r, _s, _rep, _ = _run(snap, tmp_path, "short", runtime)
    short = spool._parse_utc(json.loads((tmp_path / "spools" / ".leases" / "short.json").read_text())["expires"])
    assert short <= datetime.now(timezone.utc) + timedelta(minutes=15)


def test_a_finished_run_survives_a_harvest_and_the_record_of_it_both_failing(tmp_path, bucket, monkeypatch, fake_wbm):
    snap = _runnable(tmp_path, bucket, monkeypatch)
    runtime = fake_wbm(["2000-01-01"])

    def harvest(plan, log=None):
        raise OpenghmError("the cache is full")

    real = spool._update_sidecar

    def update(plan, top, sp):
        if "harvest_error" in sp:
            raise OSError("read-only file system")
        real(plan, top, sp)
    monkeypatch.setattr(spool, "harvest", harvest)
    monkeypatch.setattr(spool, "_update_sidecar", update)
    cfg = _config(tmp_path)
    _c, built = build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id="x"), cfg, runtime=runtime)
    logs = []
    result = spool.run_cached(built, evaluator=_evaluate, log=logs.append, capture=True)
    assert result.exit_code == 0
    assert any("harvest failed: the cache is full" in l for l in logs)
    assert any("cannot record the harvest error" in l and "read-only" in l for l in logs)


def test_a_harvest_that_hits_an_unreadable_sidecar_is_recorded_or_reported_not_raised(
        tmp_path, bucket, monkeypatch, fake_wbm):
    snap = _runnable(tmp_path, bucket, monkeypatch)
    runtime = fake_wbm(["2000-01-01"])
    _c, built = build_run(SubmitOptions(snapshot_dir=str(snap), simulation_id="y"), _config(tmp_path), runtime=runtime)

    def harvest(plan, log=None):
        (Path(plan.workdir) / "simulation.json").write_text("{not json")   # now no update can read it
        raise OSError("boom")
    monkeypatch.setattr(spool, "harvest", harvest)
    result = spool.run_cached(built, evaluator=_evaluate, log=lambda m: None, capture=True)
    assert result.exit_code == 0
