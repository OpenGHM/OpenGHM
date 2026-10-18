"""``openghm.continuation`` — what a rerun of ``sim run`` reads from a cut job's work directory.

Fixture directories are built in tmp with explicit mtimes: the rules compare file times, so the
clock never decides a test.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from openghm import continuation as c

ID = "wbm_x"
T0 = 1_700_000_000        # 2023-11-14T22:13:20Z


def touch(path: Path, seconds: float, data: bytes = b"x") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    ns = int(seconds * 10**9)
    os.utime(path, ns=(ns, ns))
    return path


def save(run_state: Path, at: int, *, wbm_id: str = ID, suffix: str = "") -> None:
    """One WBM save at second ``at``: ``.dat`` first, buckets, ``.yr_data.json`` last."""
    touch(run_state / f"{wbm_id}{suffix}.dat", at)
    touch(run_state / f"{wbm_id}{suffix}.bucket-1.dat", at + 1)
    touch(run_state / f"{wbm_id}{suffix}.sM.nonCrop.0.dat", at + 1)
    touch(run_state / f"{wbm_id}{suffix}.yr_data.json", at + 2)


# ── the init ───────────────────────────────────────────────────────────────────


def test_the_wbm_id_is_the_inits_id_not_a_longer_key():
    text = "{\nID\t=> 'run_a',\nMT_Code_Name => { MT_ID => 'x', Run_End => '2001-12-31' },\nSpinup => { State_ID => '' },\n}"
    assert c.wbm_id_of(text) == "run_a"
    assert c.run_end_of(text) == "2001-12-31"
    assert c.wbm_id_of("{ ID => \"b\" }") == "b"


def test_an_init_without_an_id_or_run_end_has_none():
    text = "{ MT_Code_Name => { MT_ID => 'x', State_ID => 'y' } }"
    assert c.wbm_id_of(text) is None and c.run_end_of(text) is None


# ── state_status ───────────────────────────────────────────────────────────────


def test_no_run_state_directory_or_no_dat_is_none(tmp_path):
    assert c.state_status(str(tmp_path / "missing"), ID).status == c.NONE
    (tmp_path / "rs").mkdir()
    assert c.state_status(str(tmp_path / "rs"), ID) == c.RunState(c.NONE)
    touch(tmp_path / "rs" / f"{ID}.yr_data.json", T0)                    # a json alone is no state
    assert c.state_status(str(tmp_path / "rs"), ID).status == c.NONE


def test_only_the_end_of_spinup_state_is_none(tmp_path):
    save(tmp_path, T0, suffix=".spinup")
    assert c.state_status(str(tmp_path), ID).status == c.NONE


def test_another_runs_state_is_not_this_ones(tmp_path):
    save(tmp_path, T0, wbm_id="wbm_x_other")
    assert c.state_status(str(tmp_path), ID).status == c.NONE


def test_a_whole_save_is_resumable_and_saved_at_is_the_jsons_time(tmp_path):
    save(tmp_path, T0)
    got = c.state_status(str(tmp_path), ID)
    assert got.status == c.RESUMABLE
    assert got.saved_at == "2023-11-14T22:13:22Z"
    assert got.dat_mtime_ns == T0 * 10**9


def test_a_work_directory_is_read_through_its_run_state_directory(tmp_path):
    save(tmp_path / "WBM_run_state", T0)
    assert c.state_status(str(tmp_path), ID).status == c.RESUMABLE


def test_a_dat_without_the_json_is_inconsistent(tmp_path):
    touch(tmp_path / f"{ID}.dat", T0)
    touch(tmp_path / f"{ID}.bucket-1.dat", T0 + 1)
    got = c.state_status(str(tmp_path), ID)
    assert got.status == c.INCONSISTENT and got.saved_at is None


@pytest.mark.parametrize("name", [f"{ID}.dat", f"{ID}.bucket-2.dat", f"{ID}.sM.irrCrop.1.dat", f"{ID}.snowBand.dat"])
def test_a_dat_file_newer_than_the_json_is_inconsistent(tmp_path, name):
    save(tmp_path, T0)
    touch(tmp_path / name, T0 + 10)             # the next save began and was cut
    assert c.state_status(str(tmp_path), ID).status == c.INCONSISTENT


def test_the_next_save_cut_before_the_first_file_leaves_the_old_one_resumable(tmp_path):
    save(tmp_path, T0)
    assert c.state_status(str(tmp_path), ID).status == c.RESUMABLE


def test_a_dat_as_new_as_the_json_is_not_newer(tmp_path):
    save(tmp_path, T0)
    touch(tmp_path / f"{ID}.bucket-2.dat", T0 + 2)         # the json's own second
    assert c.state_status(str(tmp_path), ID).status == c.RESUMABLE


def test_the_spinup_files_and_non_dat_files_are_ignored(tmp_path):
    save(tmp_path, T0)
    save(tmp_path, T0 + 100, suffix=".spinup")             # the end of the spinup, later and whole
    touch(tmp_path / f"{ID}.usgs_data.json", T0 + 50)       # written after the json, by design
    touch(tmp_path / f"{ID}.aqf_data.json", T0 + 50)
    touch(tmp_path / f"{ID}.log", T0 + 60)
    got = c.state_status(str(tmp_path), ID)
    assert got.status == c.RESUMABLE and got.saved_at == "2023-11-14T22:13:22Z"


def test_a_spinup_file_cut_halfway_does_not_make_the_state_inconsistent(tmp_path):
    save(tmp_path, T0)
    touch(tmp_path / f"{ID}.spinup.dat", T0 + 100)          # no spinup json: a cut inside that save
    assert c.state_status(str(tmp_path), ID).status == c.RESUMABLE


# ── prepare_rerun ──────────────────────────────────────────────────────────────


def output_tree(out: Path) -> dict:
    return {
        "old_daily": touch(out / "daily" / "wbm_2000.nc", T0 - 1000),
        "at_state": touch(out / "monthly" / "runoff" / "wbm_2000.nc", T0),          # as new as the dat: kept
        "new_daily": touch(out / "daily" / "wbm_2001.nc", T0 + 1000),
        "new_month": touch(out / "monthly" / "runoff" / "wbm_2001.nc", T0 + 5),
        "new_year": touch(out / "yearly" / "runoff" / "wbm_2001.nc", T0 + 5),
        "area": touch(out / "cell_area" / "area.nc", T0 + 1000),
        "log": touch(out / f"{ID}.log", T0 + 1000),
        "other": touch(out / "daily" / "readme.txt", T0 + 1000),
    }


def test_a_rerun_deletes_only_the_nc_newer_than_the_state(tmp_path):
    f = output_tree(tmp_path / "out")
    save(tmp_path / "rs", T0)
    deleted = c.prepare_rerun(str(tmp_path / "out"), c.state_status(str(tmp_path / "rs"), ID))
    assert deleted == sorted(str(f[k]) for k in ("new_daily", "new_month", "new_year"))
    for k in ("old_daily", "at_state", "area", "log", "other"):
        assert f[k].exists(), k
    for k in ("new_daily", "new_month", "new_year"):
        assert not f[k].exists(), k


def test_with_no_state_every_nc_goes_but_cell_area(tmp_path):
    f = output_tree(tmp_path / "out")
    deleted = c.prepare_rerun(str(tmp_path / "out"), c.RunState(c.NONE))
    assert len(deleted) == 5
    assert f["area"].exists() and f["log"].exists() and f["other"].exists()
    assert not any(f[k].exists() for k in ("old_daily", "at_state", "new_daily", "new_month", "new_year"))


def test_a_cell_area_deeper_in_the_tree_is_not_the_kept_one(tmp_path):
    deep = touch(tmp_path / "out" / "daily" / "cell_area" / "x.nc", T0 + 5)
    save(tmp_path / "rs", T0)
    c.prepare_rerun(str(tmp_path / "out"), c.state_status(str(tmp_path / "rs"), ID))
    assert not deep.exists()


def test_an_inconsistent_state_is_refused_and_nothing_is_deleted(tmp_path):
    f = output_tree(tmp_path / "out")
    with pytest.raises(c.RunStateInconsistent):
        c.prepare_rerun(str(tmp_path / "out"), c.RunState(c.INCONSISTENT, dat_mtime_ns=T0))
    assert all(p.exists() for p in f.values())


def test_a_missing_output_directory_has_nothing_to_delete(tmp_path):
    assert c.prepare_rerun(str(tmp_path / "none"), c.RunState(c.NONE)) == []


# ── last_day ───────────────────────────────────────────────────────────────────

SPIN = "Spinup 2/3 (2000-01-03) Balance=1.2e-9 Precip=0.1\n"
FILE = "File wbm_2001.nc (2001-12-31) Balance=-3.4e-10 Precip=0.2\n"


def test_last_day_of_a_log_still_in_the_spinup(tmp_path):
    log = tmp_path / "a.log"
    log.write_text("WBM  model run  ID: wbm_x\nSpinup 1/2 (2000-01-02) Balance=0\n" + SPIN)
    assert c.last_day(str(log)) == ("Spinup", "2000-01-03")


def test_last_day_of_a_finished_run_is_its_file_line(tmp_path):
    log = tmp_path / "a.log"
    log.write_text(SPIN + "File wbm_2000.nc (2000-12-31) Balance=0\n" + FILE + "\nrun time 5 h\n\n")
    assert c.last_day(str(log)) == ("File", "2001-12-31")


def test_last_day_reads_the_end_of_a_log_that_was_appended_to_by_reruns(tmp_path):
    log = tmp_path / "a.log"
    log.write_text(SPIN + "File wbm_2000.nc (2000-06-01) Balance=0\n")
    with open(log, "a") as fh:                                  # the next job appends
        fh.write("Previous run state files are read! Resume date is 2001-01-01.\n")
        fh.write("File wbm_2001.nc (2001-03-05) Balance=0\n")
    assert c.last_day(str(log)) == ("File", "2001-03-05")


def test_last_day_finds_a_day_line_far_from_the_end(tmp_path):
    log = tmp_path / "a.log"
    log.write_text(FILE + ("some message that is not a day line\n" * 5000))
    assert c.last_day(str(log), window=1024) == ("File", "2001-12-31")


def test_last_day_with_no_day_line_or_no_log_is_none(tmp_path):
    log = tmp_path / "a.log"
    log.write_text("WBM  model run  ID: wbm_x\nDestination dataset is up to date! Nothing to do...\n")
    assert c.last_day(str(log)) is None
    assert c.last_day(str(tmp_path / "missing.log")) is None
    log.write_text("")
    assert c.last_day(str(log)) is None


def test_a_line_that_only_looks_like_a_day_line_is_not_one(tmp_path):
    log = tmp_path / "a.log"
    log.write_text("  File wbm_2001.nc (2001-12-31) indented\nFile wbm_2001.nc 2001-12-31\n")
    assert c.last_day(str(log)) is None


# ── stopped_short ──────────────────────────────────────────────────────────────


def layout_with_log(tmp_path, text, run_end="2001-12-31"):
    lay = c.RunLayout(work_dir=str(tmp_path), sim_id="s1", wbm_id=ID, run_end=run_end)
    if text is not None:
        Path(lay.log_path).parent.mkdir(parents=True)
        Path(lay.log_path).write_text(text)
    return lay


def test_layout_paths(tmp_path):
    lay = c.RunLayout(work_dir="/w", sim_id="s1", wbm_id=ID, run_end=None)
    assert lay.run_state_dir == "/w/WBM_run_state"
    assert lay.output_dir == "/w/wbm_output/s1"
    assert lay.log_path == f"/w/wbm_output/s1/{ID}.log"


def test_a_log_that_reached_the_run_end_is_not_short(tmp_path):
    assert c.stopped_short(layout_with_log(tmp_path, SPIN + FILE)) is None


def test_a_log_that_stopped_in_a_file_line_before_the_end_is_short(tmp_path):
    lay = layout_with_log(tmp_path, SPIN + "File wbm_2001.nc (2001-06-30) Balance=0\n")
    assert c.stopped_short(lay) == "WBM stopped on 2001-06-30, before the run's end 2001-12-31"


def test_a_log_that_stopped_in_the_spinup_is_short(tmp_path):
    assert c.stopped_short(layout_with_log(tmp_path, SPIN)) == \
        "WBM stopped on 2000-01-03, before the run's end 2001-12-31"


def test_nothing_to_do_with_an_old_log_is_short(tmp_path):
    lay = layout_with_log(tmp_path, SPIN + "Destination dataset is up to date! Nothing to do...\n")
    assert "before the run's end" in c.stopped_short(lay)


def test_no_day_line_or_no_log_is_said_so(tmp_path):
    assert "has no day line" in c.stopped_short(layout_with_log(tmp_path, "nothing\n"))
    assert "has no day line" in c.stopped_short(layout_with_log(tmp_path / "x", None))


def test_an_init_without_a_run_end_has_nothing_to_check(tmp_path):
    assert c.stopped_short(layout_with_log(tmp_path, None, run_end=None)) is None


# ── layouts ────────────────────────────────────────────────────────────────────


def test_layout_from_work_dir_reads_the_sidecar_and_the_init(tmp_path):
    import json
    (tmp_path / "wbm_init").mkdir()
    (tmp_path / "wbm_init" / "a.init").write_text("{ ID => 'wbm_y', MT_Code_Name => { Run_End => '2002-12-31' } }")
    (tmp_path / "simulation.json").write_text(json.dumps({"init": "a.init", "simulation_id": "sim9"}))
    lay = c.layout_from_work_dir(str(tmp_path))
    assert (lay.sim_id, lay.wbm_id, lay.run_end) == ("sim9", "wbm_y", "2002-12-31")
    assert lay.output_dir == str(tmp_path / "wbm_output" / "sim9")


def test_layout_from_work_dir_raises_what_it_cannot_read(tmp_path):
    from openghm.errors import OpenghmError
    with pytest.raises(OpenghmError, match="not a directory"):
        c.layout_from_work_dir(str(tmp_path / "x"))
    with pytest.raises(OpenghmError, match="simulation.json"):
        c.layout_from_work_dir(str(tmp_path))
    (tmp_path / "simulation.json").write_text("{}")
    with pytest.raises(OpenghmError, match="does not name"):
        c.layout_from_work_dir(str(tmp_path))
    (tmp_path / "simulation.json").write_text('{"init": "a.init"}')
    with pytest.raises(OpenghmError, match="a.init"):
        c.layout_from_work_dir(str(tmp_path))
