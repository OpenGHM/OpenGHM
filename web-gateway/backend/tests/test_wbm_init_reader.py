"""The backend's reader of WBM's init (app/wbm_init/reader.py): the dialect it reads, what it
refuses, and that it agrees with the toolkit's full reader on every published init.

The toolkit (`openghm`) is a dev dependency only: the backend never imports it at runtime,
so the comparison is skipped where it is not installed.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.wbm_init import reader

REPO = Path(__file__).resolve().parents[3]
TOOLKIT_FIXTURES = REPO / "packages" / "openghm" / "tests" / "fixtures"


def test_reads_quotes_barewords_numbers_blocks_and_comments():
    text = """
    {
    ID => 'wbm_test',   # a comment
    "Project" => "My \\"project\\"",
    MT_Code_Name => { Run_Start => '2000-01-01', Run_End => 2001 },
    wbmParam => { alpha => 5, RhRt2 => 0.56, nested => { deep => x } },
    Output_vars => 'runoff
                    discharge',
    }
    """
    assert reader.read(text) == {
        "ID": "wbm_test",
        "Project": 'My "project"',
        "MT_Code_Name": {"Run_Start": "2000-01-01", "Run_End": "2001"},
        "wbmParam": {"alpha": "5", "RhRt2": "0.56", "nested": {"deep": "x"}},
        "Output_vars": "runoff\n                    discharge",
    }


def test_numbers_keep_their_text():
    assert reader.read("{ a => 1.50, b => 1e-3, c => '0' }") == {"a": "1.50", "b": "1e-3", "c": "0"}


def test_an_empty_value_doubled_and_trailing_commas():
    text = "{ Var_Scale => , a => 1,, b => 2,, c => ,\n d => }"
    assert reader.read(text) == {"Var_Scale": "", "a": "1", "b": "2", "c": "", "d": ""}


def test_single_quotes_unescape_only_backslash_and_quote():
    assert reader.read(r"{ a => 'it\'s a\\b\n' }") == {"a": "it's a\\b\\n"}
    assert reader.read(r'{ a => "line\nbreak" }') == {"a": "line\nbreak"}


def test_a_key_written_twice_has_the_last_value():
    assert reader.read("{ a => 1, b => 2, a => 3 }") == {"a": "3", "b": "2"}


def test_a_trailing_semicolon_is_allowed():
    assert reader.read("{ a => 1 };") == {"a": "1"}


@pytest.mark.parametrize(
    "text",
    [
        "a => 1",  # no opening brace
        "{ a => 1",  # never closed
        "{ a => 'open }",  # string never closed
        "{ a => [1, 2] }",  # arrays are not part of the dialect
        "{ a 1 }",  # no =>
        "{ a => 1 } extra",
    ],
)
def test_refuses_what_it_cannot_read(text):
    with pytest.raises(reader.InitSyntaxError):
        reader.read(text)


def test_lookup_follows_a_key_path_and_stops_at_a_string():
    values = reader.read("{ a => { b => { c => 1 } }, s => 'x' }")
    assert reader.lookup(values, "a.b.c") == "1"
    assert reader.lookup(values, "a.b") == {"c": "1"}
    assert reader.lookup(values, "a.x") is None
    assert reader.lookup(values, "s.y") is None


def _published_inits() -> list[Path]:
    return sorted(
        [*(TOOLKIT_FIXTURES / "post_processing").glob("*.init"), *(TOOLKIT_FIXTURES / "wbm_init").rglob("*.init")]
    )


def test_the_published_inits_are_found():
    if not TOOLKIT_FIXTURES.is_dir():
        pytest.skip("the toolkit's fixtures are not in this checkout")
    assert len(_published_inits()) >= 10


def test_agrees_with_the_toolkit_reader_on_the_published_inits():
    wbm_init = pytest.importorskip("openghm.wbm_init")
    inits = _published_inits()
    if not inits:
        pytest.skip("the toolkit's fixtures are not in this checkout")
    for init in inits:
        text = init.read_text(encoding="utf-8")
        ours, theirs = reader.read(text), wbm_init.to_python(text)
        assert ours == theirs, init.name
        assert list(ours) == list(theirs), init.name  # same order too
