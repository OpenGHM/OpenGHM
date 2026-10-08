"""``PostProcessing => { Run => 1 }`` — reading and editing the init, reading the generated script,
checking a finished run, and the step run from what ``simulation.json`` recorded.

The fixtures are real. ``fc66a2cd_*.init`` are inits of the v2 CONUS dataset ``fc66a2cd…`` and
``v1_*.init`` of the v1 Global one, as published. ``PostProcessing.pl`` is what WBM 2.0.0 generated
for a run of ``fc66a2cd_wbm_test.init`` with ``Run => 1`` (three variables, ``climatology`` 1,
``TA_depth`` year; on Anvil it wrote nine files to ``climatology/``), and ``init_files_wbm_test.init``
is WBM's own dump of the init that run read (``wbm_output/<id>/init_files/``).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from openghm import post_processing as pp
from openghm.post_processing import (
    block_value, check, expected_outputs, finish, is_true, remove_block_key, requested_run_value, restore,
    run_post_processing, set_block_value, set_run_value,
)

FIXTURES = Path(__file__).parent / "fixtures" / "post_processing"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# ── reading Run ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("name,literal", [
    ("fc66a2cd_wbm_SHORT.init", "1"),
    ("fc66a2cd_wbm_SHORT_standard.init", "1"),
    ("fc66a2cd_wbm_test.init", "0"),
    ("v1_Global_tracking.init", "0"),
    ("v1_test.init", "0"),                     # Run is the block's first key
    ("init_files_wbm_test.init", "1"),         # WBM's own dump of the init
])
def test_requested_run_value_on_the_real_inits(name, literal):
    assert requested_run_value(fixture(name)) == literal
    assert is_true(literal) == (literal == "1")


@pytest.mark.parametrize("literal,truth", [
    ("1", True), ("0", False), ("'1'", True), ("'0'", False), ("''", False), ('""', False),
    ("", False), ("undef", False), ("0.0", False), ("'0.0'", True), ("2", True), ("'yes'", True),
    ("$run", True),
])
def test_is_true_is_perls(literal, truth):
    assert is_true(literal) is truth


def test_no_block_no_run_and_the_keys_outside_the_block_are_not_read():
    assert requested_run_value("{\n  ID => 'x',\n}\n") is None
    # Run_Start / Run_End / a Run in another block are not the block's Run
    outside = """{
  MT_Code_Name => { Run_Start => '2000-01-01', Run_End => '2000-12-31', Run => 1 },
  Run => 1,
  Run_End => 1,
  PostProcessing => { Forks => 4, Temporal_Aggregation => 1 },
}
"""
    assert requested_run_value(outside) is None
    assert set_run_value(outside, "0") == outside


def test_run_start_and_run_end_before_and_after_the_block_are_left_alone():
    text = """{
  MT_Code_Name => { Run_Start => '2000-01-01', Run_End => '2000-12-31' },
  PostProcessing => { Run_Start => 1, Run_End => 1, Run => 1, Forks => 4 },
  Run_End => '1',
}
"""
    assert requested_run_value(text) == "1"
    out = set_run_value(text, "0")
    assert out == text.replace("Run_End => 1, Run => 1,", "Run_End => 1, Run => 0,")
    assert out.count("Run_Start") == 2 and out.count("Run_End") == 3


@pytest.mark.parametrize("value", ["1", "'1'", '"1"', "0", "''", "'0'"])
def test_quoted_and_bare_values_with_or_without_a_comma(value):
    for tail in (",\n  Forks => 4\n", "\n"):
        text = f"{{\n  PostProcessing => {{\n    Run => {value}{tail}  }}\n}}\n"
        assert requested_run_value(text) == value
        assert set_run_value(text, "7") == text.replace(f"Run => {value}", "Run => 7")


def test_a_run_inside_a_nested_hash_is_not_the_blocks():
    text = """{
  PostProcessing => {
    Polygon_Aggregation => { Run => 1 },
    Run => 0,
  },
}
"""
    assert requested_run_value(text) == "0"
    assert set_run_value(text, "1") == text.replace("Run => 0", "Run => 1")


def test_a_commented_block_and_a_commented_run_are_skipped():
    text = """{
  # PostProcessing => { Run => 1 },
  PostProcessing => {
    # Run => 1,
    Run => 0,   # 1 would launch the script
  },
}
"""
    assert requested_run_value(text) == "0"
    out = set_run_value(text, "1")
    assert out == text.replace("Run => 0,", "Run => 1,")              # the comments are untouched


def test_a_quoted_key_and_a_quoted_block_name():
    text = "{ 'PostProcessing' => { 'Run' => 1, Forks => 4 } }\n"
    assert requested_run_value(text) == "1"
    assert set_run_value(text, "0") == "{ 'PostProcessing' => { 'Run' => 0, Forks => 4 } }\n"


def test_a_run_with_no_value_is_false_and_can_be_set():
    text = "{\n  PostProcessing => {\n    Run => ,\n    Forks => 4\n  }\n}\n"
    assert requested_run_value(text) == ""
    assert set_run_value(text, "1") == text.replace("Run => ,", "Run => 1,")


def test_unbalanced_braces_read_as_no_block():
    assert requested_run_value("{ PostProcessing => { Run => 1,\n") is None


def test_a_brace_inside_a_string_does_not_end_the_block():
    text = "{ PostProcessing => { Comment => '}', Run => 1 } }\n"
    assert requested_run_value(text) == "1"


# ── editing Run ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("name", [
    "fc66a2cd_wbm_SHORT.init", "fc66a2cd_wbm_SHORT_standard.init", "fc66a2cd_wbm_test.init",
    "v1_Global_tracking.init", "v1_test.init", "init_files_wbm_test.init",
])
def test_set_run_value_changes_that_value_and_nothing_else(name):
    text = fixture(name)
    before = requested_run_value(text)
    flipped = "0" if before == "1" else "1"
    out = set_run_value(text, flipped)
    assert requested_run_value(out) == flipped
    old, new = text.splitlines(keepends=True), out.splitlines(keepends=True)
    assert len(old) == len(new)
    changed = [(a, b) for a, b in zip(old, new) if a != b]
    assert len(changed) == 1
    a, b = changed[0]
    assert a.split("=>")[0] == b.split("=>")[0]                     # the key and its whitespace
    assert a.replace(before, flipped, 1) == b
    assert set_run_value(out, before) == text                       # and it goes back, byte for byte


def test_hold_and_restore_on_the_snapshot_init_and_on_wbms_dump():
    """The staged init says Run => 0; the dump WBM writes of it says 0; the restore puts 1 back."""
    snapshot_init = fixture("fc66a2cd_wbm_SHORT.init")
    staged = set_run_value(snapshot_init, "0")
    assert requested_run_value(staged) == "0"
    assert set_run_value(staged, "1") == snapshot_init
    dump = fixture("init_files_wbm_test.init")
    held = set_run_value(dump, "0")
    assert "Run\t\t=> 0," in held
    assert set_run_value(held, "1") == dump


def test_crlf_and_tabs_survive_the_edit():
    text = "{\r\n  PostProcessing\t=> {\r\n\tRun\t\t=> 1,\r\n\tForks => 4\r\n  }\r\n}\r\n"
    assert set_run_value(text, "0") == text.replace("=> 1,", "=> 0,")


# ── Forks (and any other key of the block) ─────────────────────────────────────

_FORKS = {
    "fc66a2cd_wbm_SHORT.init": "8", "fc66a2cd_wbm_SHORT_standard.init": "8", "fc66a2cd_wbm_test.init": "4",
    "v1_Global_tracking.init": "8", "v1_test.init": "4", "init_files_wbm_test.init": "4",
}


@pytest.mark.parametrize("name,forks", _FORKS.items())
def test_forks_on_the_real_inits_set_and_removed_round_trip(name, forks):
    text = fixture(name)
    assert block_value(text, "Forks") == forks
    bigger = set_block_value(text, "Forks", "52")
    assert block_value(bigger, "Forks") == "52" and requested_run_value(bigger) == requested_run_value(text)
    assert set_block_value(bigger, "Forks", forks) == text                  # byte for byte
    # a changed value is the only difference
    assert [(a, b) for a, b in zip(text.splitlines(), bigger.splitlines()) if a != b] == [
        (a, a.replace(forks, "52")) for a in text.splitlines() if re.match(r"\s*Forks\b", a)]
    # without the entry, putting it in puts back what was there, as its own first line of the block
    without = remove_block_key(text, "Forks")
    assert block_value(without, "Forks") is None and "Forks" not in without
    inserted = set_block_value(without, "Forks", "52", insert=True)
    assert block_value(inserted, "Forks") == "52" and remove_block_key(inserted, "Forks") == without
    assert len(inserted.splitlines()) == len(text.splitlines())
    assert requested_run_value(inserted) == requested_run_value(text)


def test_an_inserted_forks_takes_the_indentation_of_the_block_and_its_line_ending():
    text = fixture("fc66a2cd_wbm_test.init")
    without = remove_block_key(text, "Forks")
    out = set_block_value(without, "Forks", "32", insert=True)
    assert "PostProcessing\t=>  {\n          Forks => 32,\n          Polygon_Aggregation" in out
    crlf = without.replace("\n", "\r\n")
    out = set_block_value(crlf, "Forks", "32", insert=True)
    assert "{\r\n          Forks => 32,\r\n          Polygon" in out and out.count("\r\n") == out.count("\n")
    assert remove_block_key(out, "Forks") == crlf


@pytest.mark.parametrize("text,inserted", [
    ("{\n  PostProcessing => { Run => 1 }\n}\n", "{\n  PostProcessing => { Forks => 8, Run => 1 }\n}\n"),
    ("{\n  PostProcessing => {Run => 1}\n}\n", "{\n  PostProcessing => {Forks => 8, Run => 1}\n}\n"),
    ("{\n  PostProcessing => {\n  }\n}\n", "{\n  PostProcessing => {\n    Forks => 8,\n  }\n}\n"),
    ("{\n  PostProcessing => {\n\tRun => 1\n  }\n}\n", "{\n  PostProcessing => {\n\tForks => 8,\n\tRun => 1\n  }\n}\n"),
    ("{\n  PostProcessing => {  \n\tRun => 1\n  }\n}\n", "{\n  PostProcessing => {  \n\tForks => 8,\n\tRun => 1\n  }\n}\n"),
])
def test_forks_is_inserted_in_one_line_empty_and_tabbed_blocks_too(text, inserted):
    assert set_block_value(text, "Forks", "8") == text                       # no insert asked: unchanged
    out = set_block_value(text, "Forks", "8", insert=True)
    assert out == inserted and block_value(out, "Forks") == "8"
    assert remove_block_key(out, "Forks") == text


def test_forks_outside_the_block_or_nested_or_longer_are_not_the_blocks():
    text = """{
  Forks => 99,
  Other => { Forks => 77 },
  PostProcessing => {
    Forks_extra => 5,
    Nested => { Forks => 6 },
    # Forks => 7,
    Run => 1,
    ForksX => 3
  },
  Forks2 => 1,
}
"""
    assert block_value(text, "Forks") is None
    out = set_block_value(text, "Forks", "8", insert=True)
    assert block_value(out, "Forks") == "8"
    assert out.count("Forks => 99,") == 1 and "Forks => 77" in out and "Forks => 6" in out and "Forks => 7," in out
    assert remove_block_key(text, "Forks") == text                          # nothing of the block's to remove
    assert remove_block_key(out, "Forks") == text
    assert set_block_value(set_block_value(text, "Forks", "4", insert=True), "Forks", "9").count("Forks => 9,") == 1
    assert set_block_value("{\n  Forks => 99,\n}\n", "Forks", "8", insert=True) == "{\n  Forks => 99,\n}\n"   # no block


def test_forks_with_an_empty_or_quoted_value_reads_and_restores_as_written():
    text = "{\n  PostProcessing => {\n    Forks => '8',\n    Run => 1,\n  }\n}\n"
    assert block_value(text, "Forks") == "'8'"
    assert set_block_value(set_block_value(text, "Forks", "4"), "Forks", "'8'") == text
    empty = text.replace("'8'", "")
    assert block_value(empty, "Forks") == "" and set_block_value(set_block_value(empty, "Forks", "4"), "Forks", "") == empty


# ── the generated script ───────────────────────────────────────────────────────


def test_the_real_script_expects_nine_climatology_files():
    exp = expected_outputs(fixture("PostProcessing.pl"))
    assert exp == {
        "variables": 3, "suffixes": ["_dc", "_mc", "_yc"], "climatology": 9, "spatial_agg": False,
    }


def _script(**flags) -> str:
    """The real script with some of its flags (and ``TA_depth``) set to other values."""
    text = fixture("PostProcessing.pl")
    for name, value in flags.items():
        pattern = rf"(my \${name}\s*=\s*)'?\w+'?" if name == "TA_depth" else rf"(my \${name}\s*=\s*)\d+"
        replacement = rf"\g<1>'{value}'" if name == "TA_depth" else rf"\g<1>{value}"
        text, n = re.subn(pattern, replacement, text, count=1)
        assert n == 1, name
    return text


@pytest.mark.parametrize("flags,suffixes,spatial", [
    ({"climatology": 0}, [], False),
    ({"temporal_agg": 0}, [], False),                     # climatology is inside `if ($temporal_agg)`
    ({"TA_depth": "month"}, ["_dc", "_mc"], False),
    ({"TA_depth": "day"}, ["_dc"], False),
    ({"monthly": 1}, ["_mc", "_yc"], False),
    ({"spatial_agg": 1}, ["_dc", "_mc", "_yc"], True),
])
def test_expected_outputs_follow_the_flags(flags, suffixes, spatial):
    exp = expected_outputs(_script(**flags))
    assert exp["suffixes"] == suffixes
    assert exp["climatology"] == 3 * len(suffixes)
    assert exp["spatial_agg"] is spatial


def test_expected_outputs_counts_the_variables_it_lists():
    text = fixture("PostProcessing.pl").replace("\tWMB_test_streamAge\n", "")
    assert expected_outputs(text)["variables"] == 2
    assert expected_outputs(text)["climatology"] == 6


@pytest.mark.parametrize("text", ["", "print 1;\n", fixture("PostProcessing.pl").replace("@param", "@params")])
def test_expected_outputs_of_a_script_it_cannot_read_is_none(text):
    assert expected_outputs(text) is None


# ── checking a finished run ────────────────────────────────────────────────────

_DONE = "\nDataCube aggregation started for 3 WBM output variables (4 forks):\n\nDone (1)- x\n\nAll Done!\n\n"


def _climatology(out: Path, *names: str) -> None:
    (out / "climatology").mkdir(parents=True, exist_ok=True)
    for n in names:
        (out / "climatology" / n).write_bytes(b"x")


NINE = [f"wbm_{v}_{s}.nc" for v in ("discharge", "runoff", "streamAge") for s in ("dc", "mc", "yc")]


def test_check_passes_with_the_nine_files_and_all_done(tmp_path):
    _climatology(tmp_path, *NINE)
    exp = expected_outputs(fixture("PostProcessing.pl"))
    r = check(str(tmp_path), _DONE, 0, exp)
    assert r == {
        "all_done": True, "expected": {"climatology": 9, "spatial_agg": False},
        "found": {"climatology": 9, "spatial_agg": 0}, "cant_exec": 0, "problems": [], "ok": True,
    }


def test_check_fails_an_empty_climatology_that_still_printed_all_done(tmp_path):
    """Anvil job 21163850: every call failed and the script printed 'All Done!' anyway."""
    (tmp_path / "climatology").mkdir()
    log = 'Can\'t exec "/wbm/utilities//temporal_aggregation.pl": No such file or directory at x line 1.\n' * 3 + _DONE
    r = check(str(tmp_path), log, 0, expected_outputs(fixture("PostProcessing.pl")))
    assert r["ok"] is False and r["all_done"] is True and r["cant_exec"] == 3
    assert r["found"]["climatology"] == 0
    assert any("3 'Can't exec'" in p for p in r["problems"])
    assert any("climatology/ holds 0 of the 9" in p and "_dc 0 of 3" in p for p in r["problems"])


def test_check_fails_when_one_file_is_missing(tmp_path):
    _climatology(tmp_path, *[n for n in NINE if n != "wbm_runoff_yc.nc"])
    r = check(str(tmp_path), _DONE, 0, expected_outputs(fixture("PostProcessing.pl")))
    assert r["ok"] is False and r["found"]["climatology"] == 8
    assert any("_yc 2 of 3" in p for p in r["problems"])


def test_check_counts_a_multi_year_yc_only_toward_yc(tmp_path):
    """Extra renamed `_2001-2002_yc.nc` files must not stand in for a missing `_dc`."""
    _climatology(tmp_path, *[n for n in NINE if n != "wbm_runoff_dc.nc"],
                 "wbm_runoff_2001-2002_yc.nc", "wbm_discharge_2001-2002_yc.nc")
    r = check(str(tmp_path), _DONE, 0, expected_outputs(fixture("PostProcessing.pl")))
    assert r["ok"] is False and r["found"]["climatology"] == 8


@pytest.mark.parametrize("log,code,what", [
    ("some output\n", 0, "All Done"),                     # killed or died before the end
    (_DONE, 2, "exited with code 2"),
    (_DONE, None, "exited with code None"),
])
def test_check_needs_exit_0_and_all_done(tmp_path, log, code, what):
    _climatology(tmp_path, *NINE)
    r = check(str(tmp_path), log, code, expected_outputs(fixture("PostProcessing.pl")))
    assert r["ok"] is False and any(what in p for p in r["problems"])


def test_check_wants_spatial_agg_not_empty_when_asked(tmp_path):
    _climatology(tmp_path, *NINE)
    exp = expected_outputs(_script(spatial_agg=1))
    r = check(str(tmp_path), _DONE, 0, exp)
    assert r["ok"] is False and "spatial_agg/ is empty" in r["problems"]
    (tmp_path / "spatial_agg").mkdir()
    (tmp_path / "spatial_agg" / "wbm_runoff_d.7.nc").write_bytes(b"x")
    r = check(str(tmp_path), _DONE, 0, exp)
    assert r["ok"] is True and r["found"]["spatial_agg"] == 1


def test_check_without_expectations_fails(tmp_path):
    r = check(str(tmp_path), _DONE, 0, None)
    assert r["ok"] is False and r["expected"] is None and r["found"] is None


def test_check_with_nothing_requested_passes_on_all_done(tmp_path):
    r = check(str(tmp_path), _DONE, 0, expected_outputs(_script(climatology=0)))
    assert r["ok"] is True and r["found"] == {"climatology": 0, "spatial_agg": 0}


# ── running it ─────────────────────────────────────────────────────────────────


def _output(tmp_path: Path, *, script=True) -> Path:
    out = tmp_path / "wbm_output" / "sim1"
    out.mkdir(parents=True)
    if script:
        (out / "PostProcessing.pl").write_text(fixture("PostProcessing.pl"))
    return out


def fake_runner(*, files=NINE, log=_DONE, code=0, calls=None):
    def run(argv, log_path):
        if calls is not None:
            calls.append((argv, log_path))
        Path(log_path).write_text(log)
        _climatology(Path(log_path).parent, *files)
        return code
    return run


def test_run_post_processing_runs_the_argv_logging_beside_the_script(tmp_path):
    out = _output(tmp_path)
    calls = []
    rec = run_post_processing(["singularity", "exec", "x"], str(out), runner=fake_runner(calls=calls))
    assert calls == [(["singularity", "exec", "x"], str(out / "PostProcessing.log"))]
    assert rec["exit_code"] == 0 and rec["ok"] is True
    assert rec["log"] == str(out / "PostProcessing.log")
    assert rec["tail"][-2:] == ["", ""] or "All Done!" in rec["tail"]
    assert isinstance(rec["seconds"], int)


def test_the_tail_is_the_last_forty_lines(tmp_path):
    out = _output(tmp_path)
    log = "".join(f"line {i}\n" for i in range(100)) + _DONE
    rec = run_post_processing(["x"], str(out), runner=fake_runner(log=log))
    assert len(rec["tail"]) == 40 and rec["tail"][-1] == ""
    assert "All Done!" in rec["tail"]


def test_a_run_that_left_no_script_is_not_run(tmp_path):
    out = _output(tmp_path, script=False)
    calls = []
    rec = run_post_processing(["x"], str(out), runner=fake_runner(calls=calls))
    assert calls == [] and rec["ok"] is False and rec["exit_code"] is None
    assert "wrote no PostProcessing.pl" in rec["problems"][0]


def test_the_default_runner_logs_stdout_and_stderr(tmp_path):
    import sys
    log = tmp_path / "PostProcessing.log"
    code = pp._run_logged([sys.executable, "-c", "import sys; print('out'); print('err', file=sys.stderr); sys.exit(3)"],
                          str(log))
    assert code == 3 and sorted(log.read_text().split()) == ["err", "out"]


def test_the_default_runner_reports_a_runtime_that_cannot_start(tmp_path):
    log = tmp_path / "PostProcessing.log"
    assert pp._run_logged([str(tmp_path / "no-such-runtime"), "exec"], str(log)) == 127
    assert "cannot start" in log.read_text()


# ── putting the init back ──────────────────────────────────────────────────────


def _sim_dir(tmp_path: Path, *, run_value="1", wbm_run="0") -> Path:
    """A run's work directory as `sim run` leaves it: the staged init (Run held at 0), WBM's dump
    of it, the script WBM wrote, and the sidecar."""
    work = tmp_path / "sim1"
    (work / "wbm_init").mkdir(parents=True)
    (work / "wbm_init" / "wbm_test.init").write_text(
        set_run_value(fixture("fc66a2cd_wbm_test.init"), wbm_run), encoding="utf-8")
    out = work / "wbm_output" / "sim1"
    (out / "init_files").mkdir(parents=True)
    (out / "init_files" / "wbm_test.init").write_text(
        set_run_value(fixture("init_files_wbm_test.init"), wbm_run), encoding="utf-8")
    (out / "PostProcessing.pl").write_text(fixture("PostProcessing.pl"))
    (work / "simulation.json").write_text(json.dumps({
        "simulation_id": "sim1", "init": "wbm_test.init", "exit_code": None,
        "post_processing": {"requested": True, "run_value": run_value, "argv": ["singularity", "exec", "x"]},
    }, indent=2) + "\n")
    return work


def test_restore_writes_the_value_into_both_copies(tmp_path):
    work = _sim_dir(tmp_path)
    paths = restore(str(work), "sim1", "wbm_test.init", "1")
    assert paths == [str(work / "wbm_init" / "wbm_test.init"),
                     str(work / "wbm_output" / "sim1" / "init_files" / "wbm_test.init")]
    assert requested_run_value((work / "wbm_init" / "wbm_test.init").read_text()) == "1"
    # the dump is the dump WBM wrote with Run => 1, byte for byte
    assert (work / "wbm_output" / "sim1" / "init_files" / "wbm_test.init").read_text() == fixture("init_files_wbm_test.init")
    assert restore(str(work), "sim1", "wbm_test.init", "1") == []          # nothing left to do


def test_restore_skips_a_copy_that_is_not_there(tmp_path):
    work = _sim_dir(tmp_path)
    (work / "wbm_output" / "sim1" / "init_files" / "wbm_test.init").unlink()
    assert restore(str(work), "sim1", "wbm_test.init", "1") == [str(work / "wbm_init" / "wbm_test.init")]


def _forks_sim_dir(tmp_path: Path, *, forks_value, forks=52) -> Path:
    """A run staged with ``Forks`` at ``forks`` where the init had ``forks_value`` (None: no key)."""
    work = _sim_dir(tmp_path)
    for rel in ("wbm_init/wbm_test.init", "wbm_output/sim1/init_files/wbm_test.init"):
        f = work / rel
        f.write_text(set_block_value(f.read_text(), "Forks", str(forks)))
    side = json.loads((work / "simulation.json").read_text())
    side["post_processing"].update(forks_value=forks_value, forks=forks)
    (work / "simulation.json").write_text(json.dumps(side))
    return work


def test_restore_puts_forks_back_in_both_copies_and_leaves_it_alone_without_forks_value(tmp_path):
    work = _forks_sim_dir(tmp_path, forks_value="4")
    init, dump = work / "wbm_init" / "wbm_test.init", work / "wbm_output" / "sim1" / "init_files" / "wbm_test.init"
    restore(str(work), "sim1", "wbm_test.init", "1")                        # no forks_value: Forks stays
    assert block_value(init.read_text(), "Forks") == "52" and requested_run_value(init.read_text()) == "1"
    restore(str(work), "sim1", "wbm_test.init", "1", forks_value="4")
    assert init.read_text() == fixture("fc66a2cd_wbm_test.init").replace("Run\t\t=> 0", "Run\t\t=> 1")
    assert dump.read_text() == fixture("init_files_wbm_test.init")           # WBM's dump shape, byte for byte


def test_restore_removes_the_forks_entry_the_run_added(tmp_path):
    work = _forks_sim_dir(tmp_path, forks_value=None)
    init = work / "wbm_init" / "wbm_test.init"
    restore(str(work), "sim1", "wbm_test.init", "1", forks_value=None)
    assert "Forks" not in init.read_text() and "Forks" not in (
        work / "wbm_output" / "sim1" / "init_files" / "wbm_test.init").read_text()
    assert restore(str(work), "sim1", "wbm_test.init", "1", forks_value=None) == []   # again: nothing to do


def test_finish_puts_forks_back_as_recorded_and_keeps_the_record_fields(tmp_path):
    work = _forks_sim_dir(tmp_path, forks_value="4")
    rec = finish(str(work / "simulation.json"), 0, runner=fake_runner())
    assert rec["forks"] == 52 and rec["forks_value"] == "4" and rec["ok"] is True
    assert json.loads((work / "simulation.json").read_text())["post_processing"] == rec
    assert block_value((work / "wbm_init" / "wbm_test.init").read_text(), "Forks") == "4"
    assert block_value((work / "wbm_output" / "sim1" / "init_files" / "wbm_test.init").read_text(), "Forks") == "4"


def test_finish_after_a_failed_wbm_or_a_failed_step_restores_forks_too(tmp_path):
    for code, runner in ((3, fake_runner()), (0, fake_runner(files=[], log="oops\n", code=1))):
        work = _forks_sim_dir(tmp_path / str(code), forks_value=None)
        finish(str(work / "simulation.json"), code, runner=runner)
        assert "Forks" not in (work / "wbm_init" / "wbm_test.init").read_text()
        assert requested_run_value((work / "wbm_init" / "wbm_test.init").read_text()) == "1"


def test_finish_does_not_touch_forks_when_the_run_did_not_change_it(tmp_path):
    work = _sim_dir(tmp_path)                                               # the old record: no forks fields
    finish(str(work / "simulation.json"), 0, runner=fake_runner())
    assert block_value((work / "wbm_init" / "wbm_test.init").read_text(), "Forks") == "4"
    work = _forks_sim_dir(tmp_path / "unknown", forks_value="4", forks=52)  # forks None: cores were unknown
    side = json.loads((work / "simulation.json").read_text())
    side["post_processing"]["forks"] = None
    (work / "simulation.json").write_text(json.dumps(side))
    finish(str(work / "simulation.json"), 0, runner=fake_runner())
    assert block_value((work / "wbm_init" / "wbm_test.init").read_text(), "Forks") == "52"


# ── finish: the step from the sidecar ──────────────────────────────────────────


def test_finish_success_records_the_step_and_restores_the_init(tmp_path):
    work = _sim_dir(tmp_path)
    rec = finish(str(work / "simulation.json"), 0, runner=fake_runner())
    assert rec["ok"] is True and rec["exit_code"] == 0 and rec["all_done"] is True
    assert rec["log"] == "wbm_output/sim1/PostProcessing.log"
    side = json.loads((work / "simulation.json").read_text())
    assert side["post_processing"] == rec and side["exit_code"] is None
    assert list(rec) == ["requested", "run_value", "argv", "exit_code", "seconds", "log", "tail", "all_done",
                         "expected", "found", "cant_exec", "problems", "ok"]
    assert requested_run_value((work / "wbm_init" / "wbm_test.init").read_text()) == "1"
    assert requested_run_value(
        (work / "wbm_output" / "sim1" / "init_files" / "wbm_test.init").read_text()) == "1"


def test_finish_failure_is_recorded_and_the_init_is_restored_too(tmp_path):
    work = _sim_dir(tmp_path)
    rec = finish(str(work / "simulation.json"), 0, runner=fake_runner(files=[], log="oops\n", code=1))
    assert rec["ok"] is False and rec["exit_code"] == 1 and rec["found"]["climatology"] == 0
    assert json.loads((work / "simulation.json").read_text())["post_processing"]["ok"] is False
    assert requested_run_value((work / "wbm_init" / "wbm_test.init").read_text()) == "1"


def test_finish_after_a_failed_wbm_skips_the_step_but_restores_the_init(tmp_path):
    work = _sim_dir(tmp_path)
    calls = []
    rec = finish(str(work / "simulation.json"), 3, runner=fake_runner(calls=calls))
    assert calls == []
    assert rec["exit_code"] is None and rec["ok"] is None
    assert rec["requested"] is True and rec["run_value"] == "1" and rec["argv"] == ["singularity", "exec", "x"]
    assert requested_run_value((work / "wbm_init" / "wbm_test.init").read_text()) == "1"
    assert requested_run_value(
        (work / "wbm_output" / "sim1" / "init_files" / "wbm_test.init").read_text()) == "1"


def test_finish_restores_the_init_when_the_runner_raises(tmp_path):
    work = _sim_dir(tmp_path)

    def boom(argv, log_path):
        raise RuntimeError("killed")
    with pytest.raises(RuntimeError):
        finish(str(work / "simulation.json"), 0, runner=boom)
    assert requested_run_value((work / "wbm_init" / "wbm_test.init").read_text()) == "1"


def test_finish_restores_a_quoted_literal_as_it_was_written(tmp_path):
    work = _sim_dir(tmp_path, run_value="'1'")
    finish(str(work / "simulation.json"), 0, runner=fake_runner())
    assert requested_run_value((work / "wbm_init" / "wbm_test.init").read_text()) == "'1'"


def test_finish_does_nothing_for_a_run_that_did_not_ask(tmp_path):
    work = tmp_path / "sim1"
    work.mkdir()
    for side in ({"simulation_id": "sim1", "init": "i"},
                 {"simulation_id": "sim1", "init": "i", "post_processing": {"requested": False}}):
        (work / "simulation.json").write_text(json.dumps(side))
        assert finish(str(work / "simulation.json"), 0, runner=fake_runner()) is None
        assert json.loads((work / "simulation.json").read_text()) == side


def test_finish_with_an_unreadable_sidecar_raises_openghm_error(tmp_path):
    from openghm.errors import OpenghmError
    (tmp_path / "simulation.json").write_text("{not json")
    with pytest.raises(OpenghmError, match="cannot read"):
        finish(str(tmp_path / "simulation.json"), 0)
