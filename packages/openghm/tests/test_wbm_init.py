"""``openghm.wbm_init``: the reader of WBM's init dialect, the editor, the changes file (ADR 0038).

The fixtures are published inits (the six model inits under ``fixtures/post_processing/``,
Wyoming's, and some data inits under ``fixtures/wbm_init/``). Where ``perl`` is on the PATH the
reader's result is compared with perl's own ``eval`` of the same text, after WBM's preprocessing.
"""

from __future__ import annotations

import difflib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from openghm import wbm_init as w
from openghm.errors import OpenghmError

FIXTURES = Path(__file__).parent / "fixtures"
MODEL_INITS = sorted((FIXTURES / "post_processing").glob("*.init")) + [FIXTURES / "wbm_init" / "Wyoming_tracking.init"]
DATA_INITS = sorted((FIXTURES / "wbm_init" / "data_init").glob("*.init"))
ALL_INITS = MODEL_INITS + DATA_INITS

PERL = shutil.which("perl")
needs_perl = pytest.mark.skipif(PERL is None, reason="perl is not on the PATH")

#: What ``WBM.pm`` ``read_init`` does to the text, then the result as JSON with every scalar a string.
_PERL_EVAL = r"""
use JSON::PP;
my $file = shift @ARGV;
open(my $fh, '<:encoding(UTF-8)', $file) or die "cannot open $file: $!\n";
my $str = do { local $/; <$fh> }; close $fh;
$str =~ s/\r//g;
$str =~ s/=>\s*,/=> '',/g;
my $att = eval $str;
die "cannot read the init: " . ($@ || "not a hash") . "\n" unless ref($att) eq 'HASH';
sub plain {
  my ($v) = @_;
  return undef unless defined $v;
  return { map { $_ => plain($v->{$_}) } keys %$v } if ref($v) eq 'HASH';
  return "$v";
}
print JSON::PP->new->ascii->canonical->encode(plain($att)), "\n";
"""


def perl_eval(text: str, tmp_path: Path) -> dict:
    init = tmp_path / "eval.init"
    init.write_text(text, encoding="utf-8", newline="")
    script = tmp_path / "eval.pl"
    script.write_text(_PERL_EVAL, encoding="utf-8")
    done = subprocess.run([PERL, str(script), str(init)], capture_output=True, text=True, encoding="utf-8")
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


def same_values(mine, theirs) -> bool:
    """Equal trees; two leaves that are both numbers are equal when the numbers are (perl
    prints ``1.0`` as ``1``)."""
    if isinstance(mine, dict) or isinstance(theirs, dict):
        return (isinstance(mine, dict) and isinstance(theirs, dict) and list(sorted(mine)) == list(sorted(theirs))
                and all(same_values(mine[k], theirs[k]) for k in mine))
    if mine == theirs:
        return True
    try:
        return float(mine) == float(theirs)
    except (TypeError, ValueError):
        return False


def assert_perl_agrees(text: str, tmp_path: Path) -> None:
    mine, theirs = w.to_python(text), perl_eval(text, tmp_path)
    assert same_values(mine, theirs), (mine, theirs)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", newline="")


def edit(text: str, **ops) -> str:
    ed = w.InitEditor(text, convert_spinup=False)
    for path in ops.get("unset", []):
        ed.unset(path)
    for path, value in ops.get("set", {}).items():
        ed.set(path, value)
    return ed.text


def changed_lines(before: str, after: str) -> list:
    """The lines of a unified diff that are not context."""
    diff = difflib.unified_diff(before.splitlines(), after.splitlines(), lineterm="", n=0)
    return [ln for ln in diff if ln[:1] in "+-" and not ln.startswith(("+++", "---"))]


# ── the reader ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("path", ALL_INITS, ids=lambda p: p.name)
def test_every_published_init_parses(path):
    tree = w.parse(read(path))
    assert tree.entries
    assert w.to_python(read(path))


@needs_perl
@pytest.mark.parametrize("path", ALL_INITS, ids=lambda p: p.name)
def test_the_values_are_the_ones_perl_reads(path, tmp_path):
    assert_perl_agrees(read(path), tmp_path)


def test_a_model_init_reads_as_nested_dicts_in_file_order():
    d = w.to_python(read(FIXTURES / "wbm_init" / "Wyoming_tracking.init"))
    assert list(d)[:4] == ["ID", "Comment", "MT_Code_Name", "Spinup"]
    assert d["MT_Code_Name"]["Run_End"] == "2009-12-31"
    assert d["Spinup"] == {"Start": "2000-01-01", "End": "2004-12-31", "Loops": "2"}
    assert d["Irrigation"]["ReturnCoeff"] == "0.5"
    assert d["Output_vars"].split() == [v for v in d["Output_vars"].split()] and "runoff_ps" in d["Output_vars"].split()
    assert d["PostProcessing"]["Polygon_Aggregation"] == ""


def test_the_dialect_comments_commas_quotes_and_the_fat_comma_repair():
    text = (
        "# a model init\n"
        "{\n"
        "  A => 1,, # two commas and a comment\n"
        "  'B' => \"two words\",\n"
        '  "C" => \'it\\\'s a \\\\ path\',\n'
        "  D => ,\n"
        "  E =>\n"
        "  ,\n"
        "  F => { G => bare_word, H => -273.15, },\n"
        "  I => 'x#not a comment',\n"
        "  J => \"tab\\there\",\n"
        "},;\n"
    )
    # the last line is `},;`: a comma after the closing brace is not part of the dialect
    with pytest.raises(w.InitSyntaxError):
        w.to_python(text)
    d = w.to_python(text.replace("},;", "};"))
    assert d == {
        "A": "1", "B": "two words", "C": "it's a \\ path", "D": "", "E": "",
        "F": {"G": "bare_word", "H": "-273.15"}, "I": "x#not a comment", "J": "tab\there",
    }


@needs_perl
def test_the_dialect_example_reads_as_perl_reads_it(tmp_path):
    text = (
        "{\n A => 1,, # c\n 'B' => \"two words\",\n C => 'it\\'s a \\\\ path',\n D => ,\n E =>\n ,\n"
        " F => { G => bare, H => -273.15, },\n I => 'x#y',\n}\n"
    )
    assert_perl_agrees(text, tmp_path)


def test_spans_point_at_the_source_text():
    text = "{\n  Run => 1,\n  Name => 'a b',\n  Blk => { X => ,\n },\n}"
    tree = w.parse(text)
    run, name, blk = tree.entries
    assert text[run.key_start:run.key_end] == "Run" and text[run.value.start:run.value.end] == "1"
    assert text[name.value.start:name.value.end] == "'a b'"
    assert text[blk.value.start:blk.value.end].startswith("{ X => ,") and text[blk.value.end - 1] == "}"
    x = blk.value.entries[0]
    assert x.value.form == "empty" and x.value.start == x.value.end == text.index(",", text.index("X"))
    assert text[run.comma] == ","


def test_a_key_written_twice_has_its_last_value():
    assert w.to_python("{ A => 1, B => 2, A => 3 }") == {"A": "3", "B": "2"}


@pytest.mark.parametrize("text, message", [
    ("A => 1", "must begin with '{'"),
    ("{ A => 1", "never closed"),
    ("{ A => 'x }", "never closed"),
    ("{ A 1 }", "expected '=>'"),
    ("{ A => [1, 2] }", "array"),
    ("{ A => 1 } extra", "after the closing"),
])
def test_text_that_is_not_an_init_is_refused_with_its_place(text, message):
    with pytest.raises(w.InitSyntaxError, match=message) as e:
        w.parse(text)
    assert "line 1" in str(e.value)


def test_read_scalar_and_lookup_by_path():
    text = read(FIXTURES / "wbm_init" / "Wyoming_tracking.init")
    assert w.read_scalar(text, "MT_Code_Name.Run_Start") == "2000-01-01"
    assert w.read_scalar(text, "MT_Code_Name.Nope") is None
    assert w.read_scalar(text, "MT_Code_Name") is None          # a block
    assert w.read_scalar(text, "Routing.velocity") is None      # a scalar on the way
    assert isinstance(w.lookup(text, "Spinup"), w.Block)


# ── the editor: values and layout ─────────────────────────────────────────────

_V2 = (
    "{\n"
    "MT_Code_Name\t=>  {\n"
    "          File_Size\t=> 'year',\n"
    "          MT_ID\t\t=> 'WMB_test_runoff',\n"
    "          Run_End\t=> '2001-12-31'\n"
    "        },\n"
    "Output_vars\t=> 'runoff',\n"
    "}\n"
)


def test_replacing_a_value_changes_only_that_line_of_a_published_init():
    text = read(FIXTURES / "wbm_init" / "Wyoming_tracking.init")
    out = edit(text, set={"MT_Code_Name.Run_End": "2005-12-31"})
    assert changed_lines(text, out) == [
        "-          Run_End\t=> '2009-12-31',", "+          Run_End\t=> '2005-12-31',"]
    # byte for byte: everything outside the value's span is the original
    node = w.lookup(text, "MT_Code_Name.Run_End")
    assert out == text[:node.start] + "'2005-12-31'" + text[node.end:]


@pytest.mark.parametrize("path", MODEL_INITS, ids=lambda p: p.name)
def test_an_edit_keeps_every_untouched_byte_in_every_model_init(path):
    text = read(path)
    node = w.lookup(text, "Output_vars")
    out = edit(text, set={"Output_vars": "runoff"})
    assert out == text[:node.start] + "'runoff'" + text[node.end:]
    w.parse(out)


def test_a_multi_line_value_is_replaced_whole_and_the_lines_after_it_stay():
    text = read(FIXTURES / "post_processing" / "fc66a2cd_wbm_SHORT.init")
    out = edit(text, set={"Output_vars": "runoff discharge"})
    assert "\t\t\t soilMoist" not in out
    assert out.count("Output_vars") == 1
    assert out.endswith(text[text.index("MT_Precip"):])
    assert w.to_python(out)["Output_vars"] == "runoff discharge"


def test_a_value_is_set_inside_a_nested_block():
    text = read(FIXTURES / "wbm_init" / "Wyoming_tracking.init")
    out = edit(text, set={"Spinup.Loops": 0, "wbmParam.compBalance": 1})
    d = w.to_python(out)
    assert d["Spinup"]["Loops"] == "0" and d["wbmParam"]["compBalance"] == "1"
    assert changed_lines(text, out) == [
        "-\tLoops\t=> 2", "+\tLoops\t=> 0",
        "-\t  compBalance   => 0 },", "+\t  compBalance   => 1 },"]


def test_a_missing_key_is_added_at_the_end_of_its_block_with_the_indent_of_the_last_entry():
    out = edit(_V2, set={"MT_Code_Name.Run_Start": "2000-01-01"})
    assert out == _V2.replace(
        "          Run_End\t=> '2001-12-31'\n",
        "          Run_End\t=> '2001-12-31',\n          Run_Start => '2000-01-01',\n")
    # the entry before it had no comma, so it gained one; the entry before the closing brace has one now
    assert w.to_python(out)["MT_Code_Name"]["Run_Start"] == "2000-01-01"


def test_an_entry_added_after_a_last_entry_with_a_comma_keeps_that_comma_once():
    text = "{\n  A => 1,\n  B => 2,\n}\n"
    assert edit(text, set={"C": 3}) == "{\n  A => 1,\n  B => 2,\n  C => 3,\n}\n"


def test_insertion_uses_the_tabs_of_the_last_entry():
    text = "{\n\tBlock => {\n\t\tA => 1,\n\t\tB => 2\n\t},\n}\n"
    assert edit(text, set={"Block.C": 3}) == "{\n\tBlock => {\n\t\tA => 1,\n\t\tB => 2,\n\t\tC => 3,\n\t},\n}\n"


def test_insertion_uses_the_spaces_of_the_last_entry():
    text = "{\n   Block => {\n     A => 1\n   },\n}\n"
    out = edit(text, set={"Block.C": "x"})
    assert out == "{\n   Block => {\n     A => 1,\n     C => 'x',\n   },\n}\n"


def test_insertion_keeps_a_trailing_comment_of_the_last_entry():
    text = "{\n  A => 1, # one\n  B => 2 # two\n}\n"
    out = edit(text, set={"C": 3})
    assert out == "{\n  A => 1, # one\n  B => 2, # two\n  C => 3,\n}\n"
    assert w.to_python(out) == {"A": "1", "B": "2", "C": "3"}


def test_insertion_into_a_one_line_block():
    text = "{\nwbmParam => {scrPrintScale => 1},\nB => { X => 1, Y => 2, },\n}\n"
    out = edit(text, set={"wbmParam.alpha": 3, "B.Z": "z"})
    assert "wbmParam => {scrPrintScale => 1, alpha => 3}," in out
    assert "B => { X => 1, Y => 2, Z => 'z', }," in out
    assert w.to_python(out)["wbmParam"] == {"scrPrintScale": "1", "alpha": "3"}


def test_insertion_where_the_closing_brace_shares_the_last_entry_line():
    text = "{\n  A => 1,\n  Blk => { X => 1,\n    Y => 2 },\n}\n"
    out = edit(text, set={"Blk.Z": 3})
    assert out == "{\n  A => 1,\n  Blk => { X => 1,\n    Y => 2, Z => 3 },\n}\n"


def test_insertion_into_an_empty_block():
    for empty in ("{}", "{ }", "{\n  }"):
        text = f"{{\n  Blk => {empty},\n  Other => 1,\n}}\n"
        out = edit(text, set={"Blk.X": 1})
        assert w.to_python(out) == {"Blk": {"X": "1"}, "Other": "1"}
        assert "    X => 1," in out


def test_insertion_into_the_top_level_of_the_init():
    text = "{\nID => 'x',\nOutput_vars => 'a'\n}\n"
    assert edit(text, set={"Network": "/wbm/data/n.asc"}) == (
        "{\nID => 'x',\nOutput_vars => 'a',\nNetwork => '/wbm/data/n.asc',\n}\n")


def test_a_missing_block_and_the_keys_in_it_are_created_from_an_object():
    out = edit(_V2, set={"Spinup": {"Start": "2000-01-01", "End": "2000-12-31", "Loops": 2}})
    assert out == _V2.replace(
        "Output_vars\t=> 'runoff',\n",
        "Output_vars\t=> 'runoff',\nSpinup => {\n  Start => '2000-01-01',\n  End => '2000-12-31',\n  Loops => 2,\n},\n")


def test_a_deep_path_creates_each_missing_block():
    out = edit(_V2, set={"Irrigation.Crops.Rice": 1})
    assert w.to_python(out)["Irrigation"] == {"Crops": {"Rice": "1"}}
    assert out.startswith(_V2[:_V2.index("Output_vars")])


def test_an_object_replaces_the_block_it_is_set_on_and_a_scalar_replaces_a_block():
    text = "{\n  Blk => { A => 1, B => 2 },\n  Other => 'x',\n}\n"
    assert w.to_python(edit(text, set={"Blk": {"C": 3}}))["Blk"] == {"C": "3"}
    assert w.to_python(edit(text, set={"Blk": "file.init"}))["Blk"] == "file.init"
    assert w.to_python(edit(text, set={"Other": {"A": "b"}}))["Other"] == {"A": "b"}


@pytest.mark.parametrize("empty", ["''", '""', ""])
def test_setting_a_key_under_an_empty_string_parent_creates_the_block(empty):
    text = f"{{\n  Irrigation\t=> {empty},\n  Other => 1,\n}}\n"
    out = edit(text, set={"Irrigation.ExtraCoeff": 1.5})
    assert w.to_python(out) == {"Irrigation": {"ExtraCoeff": "1.5"}, "Other": "1"}
    assert "Irrigation\t=> {\n    ExtraCoeff => 1.5,\n  },\n" in out


def test_a_parent_that_is_a_string_asks_for_the_whole_block_as_an_object():
    text = "{\n  Routing => 'LRR',\n}\n"
    with pytest.raises(OpenghmError) as e:
        edit(text, set={"Routing.velocity": 1})
    msg = str(e.value)
    assert "'Routing'" in msg and "'LRR'" in msg and "whole block as an object" in msg
    # writing it as an object is what works
    assert w.to_python(edit(text, set={"Routing": {"velocity": 1}})) == {"Routing": {"velocity": "1"}}


def test_a_parent_that_is_a_block_file_cannot_be_edited():
    text = "{\n  Reservoirs => '/wbm/data_init/dams/HydConDams_Global_v2.0.init',\n}\n"
    with pytest.raises(OpenghmError, match="Reservoirs.*block file.*cannot be edited"):
        edit(text, set={"Reservoirs.Capacity": "x"})


def test_the_values_are_written_by_the_writer_rules():
    out = edit("{\n  A => 0,\n}\n", set={
        "S": "it's", "T": "a\\b", "U": "x\\'", "N1": 0.5, "N2": 3, "N3": 3.0, "N4": -0.25, "N5": 1e-07,
        "Blk": {"K": "v", "In": {"Deep": 1}}})
    assert "S => 'it\\'s'," in out
    assert "T => 'a\\\\b'," in out
    assert "U => 'x\\\\\\''," in out
    assert "N1 => 0.5," in out and ".5" not in out.replace("0.5", "")
    assert "N2 => 3," in out and "N3 => 3.0," in out and "N4 => -0.25," in out and "N5 => 1e-07," in out
    assert "  Blk => {\n    K => 'v',\n    In => {\n      Deep => 1,\n    },\n  },\n}" in out
    d = w.to_python(out)
    assert d["S"] == "it's" and d["T"] == "a\\b" and d["U"] == "x\\'"


@needs_perl
def test_the_escaped_strings_read_back_the_same_in_perl(tmp_path):
    out = edit("{\n  A => 0,\n}\n", set={"S": "it's", "T": "a\\b", "U": "x\\'", "V": "two\nlines", "N": 0.5})
    assert_perl_agrees(out, tmp_path)


@pytest.mark.parametrize("value, message", [
    (True, "boolean"), (None, "null"), ([1], "list"), (float("nan"), "not a number"),
    ({"bad key": 1}, "not a valid init key"), ({"A": None}, "null"),
])
def test_values_the_writer_refuses(value, message):
    with pytest.raises(OpenghmError, match=message):
        edit("{\n A => 1,\n}\n", set={"B": value})


def test_a_line_ending_of_crlf_is_kept_on_the_lines_that_are_added():
    text = "{\r\n  A => 1,\r\n  B => 2\r\n}\r\n"
    out = edit(text, set={"C": 3, "Blk": {"X": 1}})
    assert "\n" not in out.replace("\r\n", "")
    assert out.startswith("{\r\n  A => 1,\r\n  B => 2,\r\n  C => 3,\r\n  Blk => {\r\n    X => 1,\r\n  },\r\n}")


# ── the editor: unset ─────────────────────────────────────────────────────────


def test_unset_removes_a_middle_entry_and_its_line():
    text = "{\n  A => 1,\n  B => 2,\n  C => 3,\n}\n"
    assert edit(text, unset=["B"]) == "{\n  A => 1,\n  C => 3,\n}\n"


def test_unset_of_a_last_entry_without_a_comma_takes_the_comma_before_it():
    text = "{\n  A => 1,\n  B => 2\n}\n"
    assert edit(text, unset=["B"]) == "{\n  A => 1\n}\n"


def test_unset_of_a_last_entry_with_a_comma_leaves_the_comma_before_it():
    text = "{\n  A => 1,\n  B => 2,\n}\n"
    assert edit(text, unset=["B"]) == "{\n  A => 1,\n}\n"


def test_unset_of_the_only_entry():
    assert edit("{\n  Blk => {\n    A => 1\n  },\n}\n", unset=["Blk.A"]) == "{\n  Blk => {\n  },\n}\n"
    assert edit("{ A => 1 }", unset=["A"]) == "{ }"
    assert edit("{A => 1,}", unset=["A"]) == "{}"


def test_unset_inside_a_one_line_block():
    text = "{ Blk => { X => 1, Y => 2, Z => 3 }, }"
    assert edit(text, unset=["Blk.Y"]) == "{ Blk => { X => 1, Z => 3 }, }"
    assert edit(text, unset=["Blk.Z"]) == "{ Blk => { X => 1, Y => 2 }, }"
    assert edit(text, unset=["Blk.X"]) == "{ Blk => { Y => 2, Z => 3 }, }"


def test_unset_of_a_block_removes_all_of_it():
    text = read(FIXTURES / "wbm_init" / "Wyoming_tracking.init")
    out = edit(text, unset=["Glaciers", "Runoff_mask"])
    assert "Glaciers" not in out and "Runoff_mask" not in out and "glArea" not in out
    assert w.to_python(out).keys() == w.to_python(text).keys() - {"Glaciers", "Runoff_mask"}
    assert "landCollapse" in out


def test_unset_of_a_multi_line_value_removes_every_line_of_it():
    text = read(FIXTURES / "post_processing" / "fc66a2cd_wbm_SHORT.init")
    out = edit(text, unset=["Output_vars"])
    assert "Output_vars" not in out and "soilMoist" not in out and "grdWater" not in out
    w.parse(out)


def test_unset_of_a_missing_key_changes_nothing():
    text = read(FIXTURES / "wbm_init" / "Wyoming_tracking.init")
    assert edit(text, unset=["Nope", "Nope.Deeper", "MT_Code_Name.Nope", "Routing.velocity", "ID.x"]) == text


def test_unset_keeps_a_comment_line_that_stood_alone():
    text = "{\n  # keep me\n  A => 1,\n  B => 2, # goes with B\n}\n"
    assert edit(text, unset=["B"]) == "{\n  # keep me\n  A => 1,\n}\n"


def test_unset_removes_a_key_written_twice():
    assert w.to_python(edit("{\n A => 1,\n B => 2,\n A => 3,\n}\n", unset=["A"])) == {"B": "2"}


def test_unset_then_set_puts_the_key_back_at_the_end():
    out = edit("{\n  A => 1,\n  B => 2,\n}\n", unset=["A"], set={"A": 9})
    assert out == "{\n  B => 2,\n  A => 9,\n}\n"


# ── the editor: flat spinup keys ───────────────────────────────────────────────


def test_flat_spinup_keys_become_a_block_where_the_first_one_was():
    text = read(FIXTURES / "post_processing" / "fc66a2cd_wbm_SHORT.init")
    ed = w.InitEditor(text)
    ed.convert_flat_spinup()
    out = ed.text
    assert "\nspinup_state_ID" not in out and "Spinup_Loops" not in out and "Spinup_Start" not in out
    assert ("          },\n"
            "Spinup => {\n"
            "  State_ID => '',\n"
            "  Loops => 1,\n"
            "  Start => '2000-01-01',\n"
            "  End => '2000-12-31',\n"
            "},\nOutput_vars") in out
    d = w.to_python(out)
    assert d["Spinup"] == {"State_ID": "", "Loops": "1", "Start": "2000-01-01", "End": "2000-12-31"}
    assert w.to_python(text).keys() - d.keys() == {"spinup_state_ID", "Spinup_Loops", "Spinup_Start", "Spinup_End"}
    assert len(changed_lines(text, out)) == 4 + 6      # four lines out, six in


@needs_perl
def test_the_converted_spinup_evaluates_in_perl(tmp_path):
    text = read(FIXTURES / "post_processing" / "fc66a2cd_wbm_SHORT.init")
    ed = w.InitEditor(text)
    ed.convert_flat_spinup()
    assert_perl_agrees(ed.text, tmp_path)
    assert perl_eval(ed.text, tmp_path)["Spinup"]["Loops"] == "1"
    assert not [k for k in perl_eval(ed.text, tmp_path) if k.lower().startswith("spinup_")]


def test_the_editor_converts_before_its_first_change_and_not_when_told_not_to():
    text = "{\n  Spinup_Loops => 1,\n  Spinup_Start => '2000-01-01',\n  ID => 'x',\n}\n"
    ed = w.InitEditor(text)
    ed.set("ID", "y")
    assert w.to_python(ed.text) == {"Spinup": {"Loops": "1", "Start": "2000-01-01"}, "ID": "y"}
    kept = w.InitEditor(text, convert_spinup=False)
    kept.set("ID", "y")
    assert "Spinup_Loops => 1," in kept.text


def test_flat_spinup_keys_join_the_spinup_block_the_init_has():
    text = "{\n  Spinup => { Start => '1999-01-01' },\n  Spinup_Start => '2000-01-01',\n  spinup_loops => 2,\n}\n"
    ed = w.InitEditor(text)
    ed.convert_flat_spinup()
    assert w.to_python(ed.text) == {"Spinup": {"Start": "1999-01-01", "Loops": "2"}}


def test_an_init_without_flat_spinup_keys_is_left_alone():
    text = read(FIXTURES / "wbm_init" / "Wyoming_tracking.init")
    ed = w.InitEditor(text)
    ed.convert_flat_spinup()
    assert ed.text == text


# ── the changes file ───────────────────────────────────────────────────────────


def test_a_changes_file_is_loaded_from_a_path_or_a_dict(tmp_path):
    body = {"code_version": "23.9.0", "set": {"MT_Code_Name.Run_End": "2005-12-31", "wbmParam": {"alpha": 3}},
            "unset": ["Irrigation.irrAreaGrwth"]}
    path = tmp_path / "changes.json"
    path.write_text(json.dumps(body), encoding="utf-8")
    from_file = w.load_changes(path)
    assert from_file == w.load_changes(body) == w.load_changes(str(path))
    assert from_file.to_dict() == body
    assert w.load_changes({"code_version": "22.1.1"}).to_dict() == {"code_version": "22.1.1"}


@pytest.mark.parametrize("body, message", [
    ({"set": {}}, "code_version"),
    ({"code_version": ""}, "code_version"),
    ({"code_version": 23}, "code_version"),
    ({"code_version": "23.9.0", "sett": {}}, "unknown field.*'sett'"),
    ({"code_version": "23.9.0", "set": []}, "set must be an object"),
    ({"code_version": "23.9.0", "unset": "A"}, "unset must be a list"),
    ({"code_version": "23.9.0", "unset": [1]}, "unset must be a list"),
])
def test_a_changes_file_with_the_wrong_shape_is_refused(body, message):
    with pytest.raises(OpenghmError, match=message):
        w.load_changes(body)


def test_a_changes_file_that_is_not_a_json_object_is_refused(tmp_path):
    array = tmp_path / "array.json"
    array.write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(OpenghmError, match="must be a JSON object"):
        w.load_changes(array)


def test_an_unreadable_changes_file_is_refused_with_its_path(tmp_path):
    with pytest.raises(OpenghmError, match="cannot read the changes file .*nope.json"):
        w.load_changes(tmp_path / "nope.json")
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    with pytest.raises(OpenghmError, match="cannot read the changes file .*bad.json"):
        w.load_changes(bad)


def _check(version="23.9.0", snapshot="23.9.0", **kw):
    w.check_changes(w.Changes(code_version=version, **kw), snapshot)


def test_a_valid_changes_file_passes_the_checks():
    _check(set={"MT_Code_Name.Run_End": "2005-12-31", "Output_vars": "runoff", "wbmParam.alpha": 3,
                "PostProcessing.Run": 1, "Spinup": {"Start": "2000-01-01"}},
           unset=["Irrigation.irrAreaGrwth"])
    _check(version="22.1.1", snapshot="22.1.1", set={"PET": "/wbm/data_init/pet.init", "Spinup.Loops": 1})


@pytest.mark.parametrize("path", ["", "1A", "A..B", "A.", ".A", "A-B", "A.B C", "A.1", "A/B", "A[0]"])
def test_a_malformed_key_path_is_refused_naming_it(path):
    with pytest.raises(OpenghmError, match="not an init key path") as e:
        _check(set={path: 1})
    assert repr(path) in str(e.value)
    with pytest.raises(OpenghmError, match="not an init key path"):
        _check(unset=[path])


def test_a_code_version_that_is_not_the_snapshots_is_refused():
    with pytest.raises(OpenghmError, match=r"code_version '22\.1\.1'.*'23\.9\.0'"):
        _check(version="22.1.1", snapshot="23.9.0")


@pytest.mark.parametrize("set_", [
    {"Comment": "Vörösmarty"},
    {"Blk": {"Name": "café"}},
    {"Naïve": 1},
    {"Blk": {"Köy": "x"}},
])
def test_a_non_ascii_key_or_value_is_refused_naming_the_key(set_):
    with pytest.raises(OpenghmError, match="non-ASCII") as e:
        _check(set=set_)
    assert next(iter(set_)) in str(e.value) or "Na" in str(e.value)


@pytest.mark.parametrize("path", ["FreeWaterEvap", "FreeWaterEvap.x", "MT_relHumidity", "spinup_state_ID",
                                  "Spinup_Start", "SPINUP_LOOPS", "spinup_end"])
@pytest.mark.parametrize("version", ["22.1.1", "23.9.0"])
def test_keys_fatal_on_both_versions_are_refused(path, version):
    with pytest.raises(OpenghmError) as e:
        _check(version=version, snapshot=version, set={path: "x"})
    assert repr(path) in str(e.value)


def test_unsetting_a_fatal_key_is_allowed():
    _check(unset=["FreeWaterEvap", "MT_relHumidity", "Spinup_Start"])


@pytest.mark.parametrize("set_", [
    {"Spinup.Save_Vars": 0},
    {"Spinup": {"Start": "2000-01-01", "Save_Vars": 1}},
    {"PET": {"Method": "x"}},
    {"PET.Method": "x"},
    {"MT_Precip": {"Primary": "/wbm/data_init/p.init", "Time_Series": "daily[1]"}},
    {"MT_Precip.Primary.Time_Series": "daily[2]"},
    {"Time_Series": "daily[24]"},
])
def test_keys_fatal_on_22_1_1_are_refused_there(set_):
    with pytest.raises(OpenghmError) as e:
        _check(version="22.1.1", snapshot="22.1.1", set=set_)
    assert "22.1.1" in str(e.value)
    # ... and mean nothing to 23.9.0
    _check(set=set_)


def test_pet_as_a_string_and_a_plain_time_series_are_fine_on_22_1_1():
    _check(version="22.1.1", snapshot="22.1.1", set={"PET": "/wbm/data_init/pet.init", "Time_Series": "daily"})


@pytest.mark.parametrize("value, message", [(True, "boolean"), (None, "null"), ([1, 2], "list")])
def test_a_value_that_is_not_a_string_a_number_or_an_object_is_refused(value, message):
    with pytest.raises(OpenghmError, match=message) as e:
        _check(set={"Some.Key": value})
    assert "Some.Key" in str(e.value)


# ── applying a changes file ───────────────────────────────────────────────────


def test_applying_a_changes_file_edits_unsets_and_converts():
    text = read(FIXTURES / "post_processing" / "fc66a2cd_wbm_SHORT.init")
    changes = w.load_changes({
        "code_version": "23.9.0",
        "set": {"MT_Code_Name.Run_End": "2000-12-31", "Output_vars": "runoff", "Spinup.Loops": 0,
                "PostProcessing.Run": 0, "wbmParam.alpha": 3},
        "unset": ["Comment"],
    })
    out = w.apply_changes(text, changes)
    d = w.to_python(out)
    assert d["MT_Code_Name"]["Run_End"] == "2000-12-31" and d["MT_Code_Name"]["Run_Start"] == "2000-01-01"
    assert d["Output_vars"] == "runoff" and "Comment" not in d
    assert d["Spinup"] == {"State_ID": "", "Loops": "0", "Start": "2000-01-01", "End": "2000-12-31"}
    assert d["PostProcessing"]["Run"] == "0" and d["wbmParam"] == {"scrPrintScale": "1", "alpha": "3"}
    assert not [k for k in d if k.lower().startswith("spinup_")]


def test_a_changes_file_with_nothing_in_it_returns_the_text_itself():
    text = read(FIXTURES / "post_processing" / "fc66a2cd_wbm_SHORT.init")      # flat spinup keys and all
    assert w.apply_changes(text, w.Changes(code_version="23.9.0")) is text


@needs_perl
@pytest.mark.parametrize("path", MODEL_INITS, ids=lambda p: p.name)
def test_an_edited_init_evaluates_in_perl_as_the_reader_says(path, tmp_path):
    text = read(path)
    changes = w.Changes(code_version="23.9.0", set={
        "MT_Code_Name.Run_End": "2003-12-31", "Output_vars": "runoff discharge", "Spinup.Loops": 0,
        "Irrigation": {"ExtraCoeff": 0.5, "Note": "it's"}, "NewBlock.Deeper.Key": 1,
    }, unset=["Comment", "Nothing.Here"])
    out = w.apply_changes(text, changes)
    assert_perl_agrees(out, tmp_path)
    d = perl_eval(out, tmp_path)
    assert d["MT_Code_Name"]["Run_End"] == "2003-12-31"
    assert d["Irrigation"] == {"ExtraCoeff": "0.5", "Note": "it's"}
    assert d["NewBlock"] == {"Deeper": {"Key": "1"}}
    assert d["Spinup"]["Loops"] == "0"


def test_touches_says_whether_a_change_reaches_a_key():
    c = w.Changes(code_version="1", set={"MT_Code_Name.Run_End": "x", "PostProcessing": {"Run": 1}}, unset=["A.B"])
    assert w.touches(c, "MT_Code_Name.Run_End")
    assert not w.touches(c, "MT_Code_Name.Run_Start")
    assert w.touches(c, "PostProcessing.Run") and w.touches(c, "A.B.C") and w.touches(c, "A")
    assert not w.touches(None, "A")


# ── forks: copies of data .init files (ADR 0039) ──────────────────────────────

T2M = "/wbm/data_init/climate/merra2_t2m_d.init"
T2M_TO = "/wbm/wbm_init/datasets/merra2_t2m_d__0a1b2c3d.init"
#: The three shipped data inits that hold non-ASCII text (identical in both model inputs), as the fixtures.
NON_ASCII = {"irrigation_irrEfficiency.init": "irrEfficiency", "crops_mirca_cropAreaFraction.init": "mirca_cropAreaFraction",
             "crops_rice_percolationRate.init": "rice_percolationRate"}


def fork(source=T2M, to=T2M_TO, **set_):
    return w.Fork(source=source, to=to, set=set_)


def test_forks_are_loaded_and_written_back_in_the_order_forks_set_unset():
    body = {"code_version": "23.9.0",
            "forks": [{"from": T2M, "to": T2M_TO, "set": {"Var_Scale": 1.1}},
                      {"from": "/wbm/data/crops/x.init", "to": "/wbm/wbm_init/datasets/x__1.init"}],
            "set": {"MT_airT.Primary": T2M_TO}, "unset": ["Comment"]}
    changes = w.load_changes(body)
    assert changes.forks == [fork(Var_Scale=1.1), w.Fork("/wbm/data/crops/x.init", "/wbm/wbm_init/datasets/x__1.init")]
    assert changes.to_dict() == {**body, "forks": [body["forks"][0], body["forks"][1]]}
    assert list(changes.to_dict()) == ["code_version", "forks", "set", "unset"]
    assert w.load_changes({"code_version": "23.9.0", "forks": []}).to_dict() == {"code_version": "23.9.0"}


@pytest.mark.parametrize("forks, message", [
    ("x", "forks must be a list of objects"),
    (["x"], "forks must be a list of objects"),
    ([{"to": T2M_TO}], r"forks\[0\] needs from"),
    ([{"from": T2M}], r"forks\[0\] needs to"),
    ([{"from": T2M, "to": 3}], r"forks\[0\] needs to"),
    ([{"from": T2M, "to": T2M_TO, "sett": {}}], r"forks\[0\] has unknown field.*'sett'"),
    ([{"from": T2M, "to": T2M_TO, "set": []}], r"forks\[0\].set must be an object"),
])
def test_forks_of_the_wrong_shape_are_refused(forks, message):
    with pytest.raises(OpenghmError, match=message):
        w.load_changes({"code_version": "23.9.0", "forks": forks})


def test_a_valid_fork_passes_the_checks():
    _check(forks=[fork(Var_Scale=1.1, Var_Offset=-2, Units="mm/day"), fork("/wbm/data/crops/a.init", "/wbm/wbm_init/b.init")])


@pytest.mark.parametrize("source", [
    "/wbm/model/x.init", "/wbm/wbm_init/x.init", "wbm/data_init/x.init", "/wbm/data_init/x.csv",
    "/wbm/data_init/../model/x.init", "/wbm/data_init//x.init", "/wbm/data_init/./x.init", "/wbm/data_init/",
])
def test_a_fork_original_outside_the_model_input_is_refused(source):
    with pytest.raises(OpenghmError, match="forks.0.: from"):
        _check(forks=[fork(source=source)])


@pytest.mark.parametrize("to", [
    "/wbm/data_init/x.init", "/wbm/wbm_init/datasets/x.csv", "/wbm/wbm_init/../model/x.init", "/wbm/wbm_init/a//x.init",
    "/wbm/wbm_init/.init", "/wbm/wbm_init/-x.init", "/wbm/wbm_init/a b.init", "/wbm/wbm_init/café.init", "/wbm/wbm_init/x;y.init",
])
def test_a_fork_copy_outside_wbm_init_or_badly_named_is_refused(to):
    with pytest.raises(OpenghmError, match="forks.0.: to"):
        _check(forks=[fork(to=to)])


def test_two_forks_cannot_make_the_same_copy():
    with pytest.raises(OpenghmError, match=r"forks\[1\]: to .* another fork"):
        _check(forks=[fork(Var_Scale=2), fork(Var_Scale=3)])


@pytest.mark.parametrize("set_, message", [
    ({"Var.Scale": 1}, "not a descriptor key"),
    ({"Var Scale": 1}, "not a descriptor key"),
    ({"Code_Name": "other"}, "Code_Name"),
    ({"Var_Scale": True}, "boolean"),
    ({"Var_Scale": None}, "null"),
    ({"Var_Scale": float("nan")}, "not a number"),
    ({"Var_Scale": [1]}, "not a list"),
    ({"Var_Scale": {"a": 1}}, "not a dict"),
    ({"Units": "m³"}, "non-ASCII"),
])
def test_a_fork_set_that_cannot_be_written_is_refused(set_, message):
    with pytest.raises(OpenghmError, match=message) as e:
        _check(forks=[w.Fork(T2M, T2M_TO, set_)])
    assert "forks[0]" in str(e.value)


def test_forks_are_checked_with_the_rest_of_the_changes_file():
    with pytest.raises(OpenghmError, match="non-ASCII"):
        _check(forks=[fork()], set={"Comment": "café"})
    with pytest.raises(OpenghmError, match="forks.0"):
        _check(version="22.1.1", snapshot="22.1.1", forks=[fork(source="/x.init")])


# -- transliteration

@pytest.mark.parametrize("text, ascii_", [
    ("Döll", "Doll"), ("Vörösmarty", "Vorosmarty"), ("café naïve Ångström", "cafe naive Angstrom"),
    ("2000 – 2010", "2000 - 2010"), ("a—b − ‑", "a-b - -"),
    ("‘x’ “y”", "'x' \"y\""), ("wait…", "wait..."), ("20 °C", "20 degC"),
    ("µm μm", "um um"), ("2 × 3 ± 1", "2 x 3 +/- 1"), ("Straße", "Strasse"),
    ("æ Æ œ Œ", "ae AE oe OE"), ("ø Ø đ Đ ł Ł", "o O d D l L"),
    ("é", "e"),                       # a letter and a combining accent already apart
    (" x", " x"), ("ﬁsh", "fish"), ("m²", "m2"),
    ("plain ascii", "plain ascii"),
])
def test_text_is_transliterated_to_ascii(text, ascii_):
    assert w.to_ascii(text) == ascii_


@pytest.mark.parametrize("ch", ["中", "½", "€", "\U0001f600", "Ж"])
def test_a_character_with_no_ascii_spelling_is_refused_naming_it_and_its_line(ch):
    with pytest.raises(OpenghmError, match="no ASCII spelling") as e:
        w.to_ascii(f"fine\nline two {ch}", "the file")
    assert f"U+{ord(ch):04X}" in str(e.value) and "line 2" in str(e.value) and "the file" in str(e.value)


def test_nothing_is_ever_written_as_a_question_mark():
    for ch in "中€Ж":
        with pytest.raises(OpenghmError):
            w.to_ascii(ch)


def test_the_table_spells_non_ascii_characters_in_ascii():
    for ch, spelled in w._ASCII_TABLE.items():
        assert not ch.isascii() and spelled.isascii() and spelled


# -- the copy

def test_a_forks_copy_has_the_set_values_and_its_own_name_as_code_name():
    text = read(FIXTURES / "wbm_init" / "data_init" / "climate_merra2_t2m_d.init")
    out = w.fork_text(text, fork(Var_Scale=1.1, Var_Offset=-270, Units="degC"))
    d = w.to_python(out)
    assert (d["Var_Scale"], d["Var_Offset"], d["Units"]) == ("1.1", "-270", "degC")
    assert d["Code_Name"] == "merra2_t2m_d__0a1b2c3d"
    assert changed_lines(text, out) == [
        "-Code_Name\t=> 'merra2_t2m_d',", "+Code_Name\t=> 'merra2_t2m_d__0a1b2c3d',",
        "-Units\t\t=> 'C',", "-Var_Scale\t=> 1,", "-Var_Offset\t=> -273.15,",
        "+Units\t\t=> 'degC',", "+Var_Scale\t=> 1.1,", "+Var_Offset\t=> -270,"]


def test_a_copy_with_an_empty_set_changes_only_code_name():
    text = read(FIXTURES / "wbm_init" / "data_init" / "climate_merra2_t2m_d.init")
    out = w.fork_text(text, fork())
    assert changed_lines(text, out) == ["-Code_Name\t=> 'merra2_t2m_d',", "+Code_Name\t=> 'merra2_t2m_d__0a1b2c3d',"]


@pytest.mark.parametrize("empty", ["''", ",", '""'])
def test_an_empty_value_the_original_has_is_filled_in(empty):
    text = f"{{\nCode_Name => 'a',\nVar_Scale => {empty}\n, Var_Name => 'V',\n}}\n"
    out = w.fork_text(text, w.Fork("/wbm/data_init/a.init", "/wbm/wbm_init/datasets/a__1.init", {"Var_Scale": 2.5}))
    assert w.to_python(out) == {"Code_Name": "a__1", "Var_Scale": "2.5", "Var_Name": "V"}


def test_a_key_the_original_lacks_is_added_and_a_line_ending_is_kept():
    text = "{\r\nCode_Name => 'a',\r\nVar_Name => 'V'\r\n}\r\n"
    out = w.fork_text(text, w.Fork("/wbm/data_init/a.init", "/wbm/wbm_init/datasets/a__1.init", {"Var_Offset": 3}))
    assert w.to_python(out) == {"Code_Name": "a__1", "Var_Name": "V", "Var_Offset": "3"}
    assert "\r\n" in out and "\n" not in out.replace("\r\n", "")


@pytest.mark.parametrize("name, code_name", NON_ASCII.items())
def test_the_shipped_non_ascii_data_inits_come_out_ascii(name, code_name):
    text = read(FIXTURES / "wbm_init" / "data_init" / name)
    assert not text.isascii()
    out = w.fork_text(text, w.Fork(f"/wbm/data_init/x/{code_name}.init", f"/wbm/wbm_init/datasets/{code_name}__f.init", {}))
    assert out.isascii()
    d_before, d_after = w.to_python(text), w.to_python(out)
    assert d_after.pop("Code_Name") == f"{code_name}__f" and d_before.pop("Code_Name") != d_after.get("Code_Name")
    # only free text differs, and only by its non-ASCII characters
    for key in d_after:
        assert d_after[key] == w.to_ascii(d_before[key])
    assert "Doll" in out or "Vorosmarty" in out


def test_the_en_dash_of_the_mirca_citation_is_a_hyphen():
    out = w.fork_text(read(FIXTURES / "wbm_init" / "data_init" / "crops_mirca_cropAreaFraction.init"),
                      w.Fork("/wbm/data_init/crops/mirca_cropAreaFraction.init", "/wbm/wbm_init/datasets/m__1.init"))
    assert "Siebert, S. & Doll, P. (2010): MIRCA2000 - Global monthly" in out


@needs_perl
@pytest.mark.parametrize("name", NON_ASCII)
def test_a_fork_evaluates_in_perl_as_the_reader_says(name, tmp_path):
    out = w.fork_text(read(FIXTURES / "wbm_init" / "data_init" / name),
                      w.Fork("/wbm/data_init/x.init", "/wbm/wbm_init/datasets/x__1.init", {"Var_Scale": 1.1, "Units": "u"}))
    assert_perl_agrees(out, tmp_path)


@pytest.mark.parametrize("original, message", [
    ("Code_Name => 'a'", "cannot read the init"),
    ("{ Var_Name => 'V' }", "no Code_Name"),
    ("{ Code_Name => { A => 1 } }", "no Code_Name"),
    ("{ Code_Name => 'a', Note => '中' }", "no ASCII spelling"),
])
def test_a_file_that_is_not_a_descriptor_or_has_no_spelling_is_not_forked(original, message):
    with pytest.raises(OpenghmError, match=message) as e:
        w.fork_text(original, w.Fork("/wbm/data_init/a.init", "/wbm/wbm_init/datasets/a__1.init"))
    assert "/wbm/data_init/a.init" in str(e.value)


def test_a_source_path_is_looked_up_in_the_model_input_as_wbm_does(tmp_path):
    root = str(tmp_path)
    assert w.fork_source_path(root, "/wbm/data_init/climate/p.init") == str(tmp_path / "data_init" / "climate" / "p.init")
    assert w.fork_source_path(root, "/wbm/data/data_init/climate/p.init") == str(tmp_path / "data_init" / "climate" / "p.init")
    assert w.fork_source_path(root, "/wbm/data/crops/p.init") == str(tmp_path / "crops" / "p.init")
