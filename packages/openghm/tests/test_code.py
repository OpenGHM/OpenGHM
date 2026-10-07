"""``openghm.code`` — the tree hash that pins WBM code (ADR 0032) — and ``openghm code hash``.

The recipe is cross-checked against the shell pipeline ADR 0032 says it equals, on a fixture
tree built to trip the usual differences (sort order, ``_Inline``, symlinks), and on the copy
of the WBM code that ships in ``images/wbm-tools-lite/wbm`` when this is run from a checkout.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from click.testing import CliRunner

from openghm import code, spec
from openghm.cli.main import cli
from openghm.errors import OpenghmError

IMAGE_CODE = Path(__file__).resolve().parents[3] / "images" / "wbm-tools-lite" / "wbm"
SNAPSHOT_EXAMPLE = json.loads(
    (spec.schemas_root() / "snapshot-spec" / "examples" / "wbm_storage_v2.0.0.json").read_text()
)

_SHA256SUM = next((c for c in (["sha256sum"], ["shasum", "-a", "256"]) if shutil.which(c[0])), None)
needs_shell = pytest.mark.skipif(_SHA256SUM is None or not shutil.which("find") or not shutil.which("xargs"),
                                 reason="no sha256sum/shasum, find or xargs")


def shell_recipe(root: Path) -> str:
    """The pipeline from ADR 0032, run in ``root``."""
    sums = " ".join(_SHA256SUM)
    cmd = ("find model utilities -type f -not -path '*/_Inline/*' -print0 | LC_ALL=C sort -z "
           f"| xargs -0 {sums} | {sums}")
    out = subprocess.run(["sh", "-c", cmd], cwd=str(root), stdout=subprocess.PIPE, check=True,
                         universal_newlines=True).stdout
    return out.split()[0]


def write(root: Path, rel: str, body: bytes = b"x") -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)


@pytest.fixture
def tree(tmp_path):
    """Names whose order depends on how they are compared, and what the recipe leaves out."""
    for rel in ("model/wbm.pl", "model/a-b", "model/a.pl", "model/a/b", "model/A/c", "model/lib/Z.pm",
                "model/lib/a b.pm", "model/Ünï.pm", "utilities/tool", "utilities/sub/deep/x"):
        write(tmp_path, rel, rel.encode())
    # left out: an _Inline directory at any depth, and what is not under model/ or utilities/
    write(tmp_path, "model/_Inline/lib/auto/x.so", b"compiled")
    write(tmp_path, "utilities/sub/_Inline/y", b"y")
    write(tmp_path, "metadata.json", b"{}")
    write(tmp_path, "wbm_init/a.init", b"{}")
    return tmp_path


# ── the recipe ───────────────────────────────────────────────────────────────


@needs_shell
def test_tree_hash_equals_the_shell_pipeline_on_a_fixture_tree(tree):
    assert code.tree_hash(tree) == shell_recipe(tree)


@needs_shell
@pytest.mark.skipif(not IMAGE_CODE.is_dir(), reason="images/wbm-tools-lite/wbm is not in this checkout")
def test_tree_hash_equals_the_shell_pipeline_on_the_image_copy():
    assert code.tree_hash(IMAGE_CODE) == shell_recipe(IMAGE_CODE)


@pytest.mark.skipif(not IMAGE_CODE.is_dir(), reason="images/wbm-tools-lite/wbm is not in this checkout")
def test_the_v2_example_pins_the_copy_in_the_image_directory():
    pin = SNAPSHOT_EXAMPLE["uses"]["modelCode"]
    assert pin["version"] == "23.9.0" and pin["treeHash"].startswith("664c291d7a5b98d5")
    assert code.tree_hash(IMAGE_CODE) == pin["treeHash"]


def test_the_recipe_written_out_by_hand(tmp_path):
    write(tmp_path, "model/wbm.pl", b"one")
    write(tmp_path, "utilities/tool", b"two")
    lines = (f"{hashlib.sha256(b'one').hexdigest()}  model/wbm.pl\n"
             f"{hashlib.sha256(b'two').hexdigest()}  utilities/tool\n")
    assert code.tree_hash(tmp_path) == hashlib.sha256(lines.encode()).hexdigest()


def test_the_hash_is_lowercase_hex_and_does_not_depend_on_where_the_tree_is(tree, tmp_path_factory):
    other = tmp_path_factory.mktemp("elsewhere")
    shutil.copytree(tree, other / "copy")
    h = code.tree_hash(tree)
    assert len(h) == 64 and h == h.lower() and int(h, 16) >= 0
    assert code.tree_hash(other / "copy") == h


def test_only_the_code_counts(tree):
    h = code.tree_hash(tree)
    write(tree, "metadata.json", b"changed")
    write(tree, "wbm_init/new.init", b"new")
    write(tree, "model/_Inline/lib/auto/x.so", b"recompiled")
    write(tree, "model/deep/_Inline/z", b"z")
    assert code.tree_hash(tree) == h


def test_a_changed_added_or_removed_code_file_changes_the_hash(tree):
    h = code.tree_hash(tree)
    write(tree, "model/wbm.pl", b"changed")
    changed = code.tree_hash(tree)
    assert changed != h
    write(tree, "utilities/new", b"new")
    added = code.tree_hash(tree)
    assert added not in (h, changed)
    os.remove(tree / "utilities" / "new")
    os.remove(tree / "model" / "a-b")
    assert code.tree_hash(tree) not in (h, changed, added)


def test_a_file_mode_is_not_part_of_the_hash(tree):
    h = code.tree_hash(tree)
    os.chmod(tree / "model" / "wbm.pl", 0o755)
    assert code.tree_hash(tree) == h


def test_a_symlink_is_not_a_regular_file_and_is_not_hashed(tree):
    h = code.tree_hash(tree)
    os.symlink(str(tree / "model" / "wbm.pl"), str(tree / "model" / "link.pl"))
    os.symlink(str(tree / "utilities"), str(tree / "model" / "linked-dir"))
    assert code.tree_hash(tree) == h


@needs_shell
def test_symlinks_agree_with_the_shell_too(tree):
    os.symlink(str(tree / "model" / "wbm.pl"), str(tree / "model" / "link.pl"))
    os.symlink(str(tree / "utilities"), str(tree / "model" / "linked-dir"))
    assert code.tree_hash(tree) == shell_recipe(tree)


def test_a_tree_without_the_code_directories_is_an_error(tmp_path):
    with pytest.raises(OpenghmError, match="not a directory"):
        code.tree_hash(tmp_path)
    (tmp_path / "model").mkdir()
    with pytest.raises(OpenghmError, match="utilities"):
        code.tree_hash(tmp_path)


def test_a_path_the_shell_recipe_would_escape_is_refused(tmp_path):
    write(tmp_path, "utilities/x", b"x")
    write(tmp_path, "model/back\\slash", b"x")
    with pytest.raises(OpenghmError, match="backslash or a newline"):
        code.tree_hash(tmp_path)


# ── from SHA256SUMS ────────────────────────────────────────────────────────────


def test_the_hash_from_sums_equals_the_hash_of_the_folder(tree):
    sums = {}
    for p in sorted(tree.rglob("*")):
        if p.is_file():
            sums[p.relative_to(tree).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    # everything a snapshot's SHA256SUMS lists goes in, _Inline included: what does not count is ignored
    assert "model/_Inline/lib/auto/x.so" in sums and "metadata.json" in sums
    assert code.tree_hash_of_sums(sums) == code.tree_hash(tree)
    assert code.tree_hash_of_sums(list(sums.items())) == code.tree_hash(tree)


def test_counts():
    assert code.counts("model/wbm.pl") and code.counts("utilities/a/b")
    assert not code.counts("model/_Inline/x") and not code.counts("utilities/a/_Inline/b/c")
    assert not code.counts("wbm_init/a.init") and not code.counts("metadata.json") and not code.counts("model")
    assert not code.counts("models/x") and not code.counts("x/model/y")


# ── the CLI ────────────────────────────────────────────────────────────────────


def test_cli_code_hash_prints_the_hash_and_nothing_else(tree):
    out = CliRunner().invoke(cli, ["code", "hash", str(tree)])
    assert out.exit_code == 0, out.output
    assert out.output == code.tree_hash(tree) + "\n"


def test_cli_code_hash_defaults_to_the_current_directory(tree, monkeypatch):
    monkeypatch.chdir(tree)
    out = CliRunner().invoke(cli, ["code", "hash"])
    assert out.exit_code == 0 and out.output.strip() == code.tree_hash(tree)


def test_cli_code_hash_of_a_folder_without_code_exits_2(tmp_path):
    out = CliRunner().invoke(cli, ["code", "hash", str(tmp_path)])
    assert out.exit_code == 2 and "no WBM code to hash" in out.output


def _snapshot_folder(root: Path) -> Path:
    for d in ("model", "utilities", "wbm_init", "gdal_test_files", "wbm_output"):
        (root / d).mkdir()
    write(root, "model/wbm.pl", b"print 1;\n")
    write(root, "utilities/tool", b"print 2;\n")
    doc = copy.deepcopy(SNAPSHOT_EXAMPLE)
    doc["uses"]["modelCode"]["treeHash"] = code.tree_hash(root)
    (root / "metadata.json").write_text(json.dumps(doc))
    return root


def test_cli_snapshot_validate_passes_on_the_pinned_code(tmp_path):
    folder = _snapshot_folder(tmp_path)
    out = CliRunner().invoke(cli, ["snapshot", "validate", str(folder)])
    assert out.exit_code == 0, out.output
    assert "code: ok" in out.output and code.tree_hash(folder)[:16] in out.output


def test_cli_snapshot_validate_fails_naming_both_hashes_when_the_code_changed(tmp_path):
    folder = _snapshot_folder(tmp_path)
    pinned = code.tree_hash(folder)
    write(folder, "model/wbm.pl", b"print 'changed';\n")
    actual = code.tree_hash(folder)
    out = CliRunner().invoke(cli, ["snapshot", "validate", str(folder)])
    assert out.exit_code == 1
    assert "code: FAILED" in out.output and pinned in out.output and actual in out.output
    assert "metadata.json: ok" in out.output and "layout: ok" in out.output


def test_cli_snapshot_validate_json_reports_the_code_half(tmp_path):
    folder = _snapshot_folder(tmp_path)
    ok = json.loads(CliRunner().invoke(cli, ["snapshot", "validate", str(folder), "--json"]).output)
    assert ok["ok"] and ok["code"] == {"ok": True, "tree_hash": code.tree_hash(folder),
                                       "pinned": code.tree_hash(folder)}
    pinned = code.tree_hash(folder)
    write(folder, "utilities/tool", b"changed")
    out = CliRunner().invoke(cli, ["snapshot", "validate", str(folder), "--json"])
    bad = json.loads(out.output)
    assert out.exit_code == 1 and not bad["ok"] and bad["document"]["ok"] and bad["layout"]["ok"]
    assert bad["code"]["ok"] is False and bad["code"]["pinned"] == pinned != bad["code"]["tree_hash"]


def test_cli_model_input_validate_has_no_code_half(tmp_path):
    (tmp_path / "data_init").mkdir()
    doc = json.loads((spec.schemas_root() / "model-input-spec" / "examples" / "wbm_ancillary_data_v2.0.0.json").read_text())
    (tmp_path / "metadata.json").write_text(json.dumps(doc))
    out = CliRunner().invoke(cli, ["model-input", "validate", str(tmp_path), "--json"])
    assert out.exit_code == 0, out.output
    assert json.loads(out.output)["code"] is None
