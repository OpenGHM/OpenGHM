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
    assert sorted(str(p.relative_to(cache)) for p in cache.rglob("*") if p.is_file()) == sorted(
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
    assert sidecar["spool"] == {"downloaded": 0, "linked": 0, "failed": 0, "fill_error": None,
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
