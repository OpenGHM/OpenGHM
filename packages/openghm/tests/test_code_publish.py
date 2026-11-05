"""``openghm code publish`` against the in-memory bucket of ``test_publish`` (no network, no credentials)."""

from __future__ import annotations

import hashlib
import io
import os
import tarfile
import zipfile
from pathlib import Path

import pytest
from click.testing import CliRunner

from openghm import code as wbm_code, code_publish as cp, fetch, publish as pub
from openghm.cli.main import cli
from test_publish import EXE, FakeS3, REG, Store, _no_backoff  # noqa: F401  (the fixture is autouse)

WBM_PL = b"#!/usr/bin/perl\nuse constant WBM_VERSION =>\t'1.2.3';\t# comment\nprint 1;\n"
FILES = {
    "model/wbm.pl": (WBM_PL, 0o755),
    "model/RIMS.pm": (b"1;\n", 0o644),
    "model/_Inline/lib/auto/x.so": (b"\x7fELF", 0o555),
    "utilities/build_spool.pl": (b"#!/usr/bin/perl\n", 0o755),
    "utilities/tool.sh": (b"echo\n", 0o644),
}
PREFIX = "wbm-code/wbm/1.2.3/"


@pytest.fixture
def store():
    s = Store()
    yield s
    s.close()


def make_tree(root: Path, files=None) -> Path:
    for rel, (body, mode) in (files or FILES).items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)
        p.chmod(mode)
    return root


def make_tar(path: Path, tree: Path, wrap=None, mode="w:gz") -> Path:
    with tarfile.open(path, mode) as tf:
        for f in sorted(tree.rglob("*")):
            arc = f.relative_to(tree).as_posix()
            tf.add(str(f), arcname=f"{wrap}/{arc}" if wrap else arc, recursive=False)
    return path


def go(source, store, *, client=None, **kw):
    lines = []
    kw.setdefault("jobs", 1)
    result = cp.publish_code(str(source), base_url=store.url, client=client or FakeS3(store),
                             out=lines.append, **kw)
    return result, lines


def exit_code(source, store, **kw):
    with pytest.raises(pub.PublishError) as e:
        go(source, store, **kw)
    return e.value.code


def keys(store):
    return store.keys("wbm-code/")


def expected_hash(tree: Path) -> str:
    return wbm_code.tree_hash(tree)


# ── sources ───────────────────────────────────────────────────────────────────


def test_directory_source_publishes_the_whole_tree(tmp_path, store):
    tree = make_tree(tmp_path / "src")
    result, lines = go(tree, store)
    assert (result.version, result.prefix, result.already_published) == ("1.2.3", PREFIX, False)
    assert result.tree_hash == expected_hash(tree)
    # every file (_Inline included), SHA256SUMS and TREEHASH, and nothing else
    assert keys(store) == sorted([PREFIX + r for r in FILES] + [PREFIX + "SHA256SUMS", PREFIX + "TREEHASH"])
    assert store.objects[PREFIX + "TREEHASH"].body == (result.tree_hash + "\n").encode()
    sums = fetch.parse_sums(store.objects[PREFIX + "SHA256SUMS"].body.decode())
    assert sums == {r: hashlib.sha256(b).hexdigest() for r, (b, _m) in FILES.items()}
    assert store.objects[PREFIX + "SHA256SUMS"].body.decode().splitlines()[0].endswith("  ./model/RIMS.pm")
    assert wbm_code.tree_hash_of_sums(sums) == result.tree_hash      # _Inline is in the sums, not in the hash
    # modes are the source's own, public-read, with the sha256
    for rel, (body, mode) in FILES.items():
        o = store.objects[PREFIX + rel]
        assert o.public and o.meta["sha256"] == hashlib.sha256(body).hexdigest()
        assert pub.ObjectInfo(0, meta=o.meta).mode == mode
    assert result.verified == len(FILES) + 2
    assert result.mode_fixes == []


def test_version_is_read_from_wbm_pl(tmp_path):
    tree = make_tree(tmp_path / "src")
    assert cp.read_version(str(tree)) == "1.2.3"
    (tree / "model/wbm.pl").write_bytes(b'# use constant WBM_VERSION => "0.0.0";\nuse constant  WBM_VERSION=>"23.9.0";\n')
    assert cp.read_version(str(tree)) == "23.9.0"
    (tree / "model/wbm.pl").write_bytes(b"print 1;\n")
    with pytest.raises(pub.PublishError, match="WBM_VERSION"):
        cp.read_version(str(tree))
    (tree / "model/wbm.pl").write_bytes(b"use constant WBM_VERSION => '../x';\n")
    with pytest.raises(pub.PublishError, match="not usable in a key"):
        cp.read_version(str(tree))


@pytest.mark.parametrize("name,mode", [("c.tar", "w"), ("c.tar.gz", "w:gz"), ("c.tgz", "w:gz")])
def test_tarball_with_one_wrapping_folder(tmp_path, store, name, mode):
    tree = make_tree(tmp_path / "src")
    tar = make_tar(tmp_path / name, tree, wrap="WBM_v1.2.3", mode=mode)
    result, _ = go(tar, store)
    assert result.tree_hash == expected_hash(tree)
    assert PREFIX + "model/wbm.pl" in keys(store)
    assert pub.ObjectInfo(0, meta=store.objects[PREFIX + "model/_Inline/lib/auto/x.so"].meta).mode == 0o555


def test_tarball_without_a_wrapping_folder_and_zip(tmp_path, store):
    tree = make_tree(tmp_path / "src")
    r1, _ = go(make_tar(tmp_path / "flat.tar.gz", tree), store)
    zp = tmp_path / "c.zip"
    with zipfile.ZipFile(zp, "w") as zf:
        for rel, (body, mode) in FILES.items():
            zi = zipfile.ZipInfo(f"top/{rel}")
            zi.external_attr = (0o100000 | mode) << 16
            zf.writestr(zi, body)
    store2 = Store()
    try:
        r2, _ = go(zp, store2)
        assert r2.tree_hash == r1.tree_hash == expected_hash(tree)
        assert pub.ObjectInfo(0, meta=store2.objects[PREFIX + "model/wbm.pl"].meta).mode == 0o755
    finally:
        store2.close()


def test_no_code_root_lists_what_was_found(tmp_path, store):
    (tmp_path / "src" / "model").mkdir(parents=True)
    (tmp_path / "src" / "README").write_text("x")
    assert exit_code(tmp_path / "src", store) == 2
    (tmp_path / "two" / "a").mkdir(parents=True)
    (tmp_path / "two" / "b").mkdir()
    with pytest.raises(pub.PublishError, match=r"Found at the top: a, b"):
        cp.find_root(str(tmp_path / "two"))
    assert keys(store) == []


def test_archive_with_path_traversal_is_refused(tmp_path, store):
    for bad in ("../evil.pl", "/abs/evil.pl", "x/../../evil.pl"):
        tar = tmp_path / "bad.tar"
        with tarfile.open(tar, "w") as tf:
            info = tarfile.TarInfo(bad)
            info.size = 1
            tf.addfile(info, io.BytesIO(b"x"))
        assert exit_code(tar, store) == 2
        assert not (tmp_path / "evil.pl").exists()
    zp = tmp_path / "bad.zip"
    with zipfile.ZipFile(zp, "w") as zf:
        zf.writestr("../evil.pl", b"x")
    assert exit_code(zp, store) == 2
    assert keys(store) == []


def test_symlinks_and_special_members_are_refused(tmp_path, store):
    tar = tmp_path / "link.tar"
    with tarfile.open(tar, "w") as tf:
        info = tarfile.TarInfo("model/wbm.pl")
        info.type, info.linkname = tarfile.SYMTYPE, "/etc/passwd"
        tf.addfile(info)
    assert exit_code(tar, store) == 2
    hard = tmp_path / "hard.tar"
    with tarfile.open(hard, "w") as tf:
        info = tarfile.TarInfo("model/wbm.pl")
        info.type, info.linkname = tarfile.LNKTYPE, "other"
        tf.addfile(info)
    assert exit_code(hard, store) == 2
    dev = tmp_path / "dev.tar"
    with tarfile.open(dev, "w") as tf:
        info = tarfile.TarInfo("model/dev")
        info.type = tarfile.CHRTYPE
        tf.addfile(info)
    assert exit_code(dev, store) == 2
    # a symlink in a directory source
    tree = make_tree(tmp_path / "src")
    os.symlink("RIMS.pm", tree / "model/link.pm")
    assert exit_code(tree, store) == 2
    os.remove(tree / "model/link.pm")
    os.symlink(str(tmp_path), tree / "model/linked_dir")
    assert exit_code(tree, store) == 2
    assert keys(store) == []


# ── the bucket ────────────────────────────────────────────────────────────────


def test_same_hash_is_already_published_and_changes_nothing(tmp_path, store):
    tree = make_tree(tmp_path / "src")
    go(tree, store)
    store.writes.clear()
    result, lines = go(tree, store)
    assert result.already_published and store.writes == []
    assert any(l.startswith("already published") for l in lines)


def test_already_published_warns_about_a_non_executable_build_spool(tmp_path, store):
    tree = make_tree(tmp_path / "src")
    go(tree, store)
    store.objects[PREFIX + "utilities/build_spool.pl"].meta["s3cmd-attrs"] = "mode:33188"    # 0644
    _, lines = go(tree, store)
    assert any(l.startswith("warning:") and "build_spool.pl" in l for l in lines)


def test_same_version_other_hash_is_refused_with_the_next_revision(tmp_path, store):
    tree = make_tree(tmp_path / "src")
    go(tree, store)
    (tree / "model/RIMS.pm").write_bytes(b"2;\n")
    store.writes.clear()
    with pytest.raises(pub.PublishError) as e:
        go(tree, store)
    assert e.value.code == 4 and store.writes == []
    assert "1.2.3-r1" in str(e.value) and "--revision 1" in str(e.value)
    # publishing under it works, and the hint then moves on
    result, _ = go(tree, store, revision=1)
    assert result.prefix == "wbm-code/wbm/1.2.3-r1/" and PREFIX + "model/RIMS.pm" in keys(store)
    assert store.objects[PREFIX + "model/RIMS.pm"].body == b"1;\n"       # the published one is untouched
    (tree / "model/RIMS.pm").write_bytes(b"3;\n")
    with pytest.raises(pub.PublishError, match="--revision 2"):
        go(tree, store)
    # the same revision again with other bytes is refused too
    with pytest.raises(pub.PublishError, match="--revision 2") as e2:
        go(tree, store, revision=1)
    assert e2.value.code == 4


def test_dry_run_writes_nothing_and_needs_no_credentials(tmp_path, store):
    tree = make_tree(tmp_path / "src", {**FILES, "model/wbm.pl": (WBM_PL, 0o644)})
    out = []
    result = cp.publish_code(str(tree), base_url=store.url, dry_run=True, s3cfg=str(tmp_path / "none"),
                             out=out.append)
    assert keys(store) == [] and store.writes == []
    assert result.dry_run and result.counts.upload == len(FILES) + 2
    text = "\n".join(out)
    assert "version: 1.2.3" in text and f"tree hash: {result.tree_hash}" in text
    assert "mode fix: model/wbm.pl" in text and f"upload  {PREFIX}TREEHASH" in text


def test_mode_fix_for_wbm_pl_and_build_spool(tmp_path, store):
    tree = make_tree(tmp_path / "src", {**FILES, "model/wbm.pl": (WBM_PL, 0o644),
                                        "utilities/build_spool.pl": (b"#!/usr/bin/perl\n", 0o644)})
    result, lines = go(tree, store)
    assert sorted(r for r, _o, _n in result.mode_fixes) == ["model/wbm.pl", "utilities/build_spool.pl"]
    for rel in ("model/wbm.pl", "utilities/build_spool.pl"):
        assert pub.ObjectInfo(0, meta=store.objects[PREFIX + rel].meta).mode == 0o755
        assert any(l.startswith(f"mode fix: {rel} ") and "0644" in l and "0755" in l for l in lines)
    # every other file keeps its source mode, and the source is not touched
    assert pub.ObjectInfo(0, meta=store.objects[PREFIX + "utilities/tool.sh"].meta).mode == 0o644
    assert (tree / "utilities/build_spool.pl").stat().st_mode & 0o777 == 0o644
    # the fix changes no byte, so the hash is the source's
    assert result.tree_hash == expected_hash(tree)


def test_a_source_without_wbm_pl_or_build_spool_is_not_wbm_code(tmp_path, store):
    files = {k: v for k, v in FILES.items() if k != "utilities/build_spool.pl"}
    assert exit_code(make_tree(tmp_path / "src", files), store) == 2


def test_treehash_is_uploaded_last(tmp_path, store):
    go(make_tree(tmp_path / "src"), store)
    order = [k for _kind, k in store.writes]
    assert order[-1] == PREFIX + "TREEHASH" and order[-2] == PREFIX + "SHA256SUMS"
    assert len(order) == len(FILES) + 2


def test_retry_after_a_partial_upload_continues(tmp_path, store):
    tree = make_tree(tmp_path / "src")
    s3 = FakeS3(store)
    s3.fail_put = {PREFIX + "utilities/tool.sh"}
    assert exit_code(tree, store, client=s3) == 6
    assert PREFIX + "TREEHASH" not in keys(store)                 # unfinished: no TREEHASH
    done = set(keys(store))
    assert done and PREFIX + "utilities/tool.sh" not in done
    store.writes.clear()
    result, lines = go(tree, store)
    assert result.counts.skip == len(done) and result.counts.upload == len(FILES) + 2 - len(done)
    assert not any(k in done for _kind, k in store.writes)          # nothing written twice
    assert PREFIX + "TREEHASH" in keys(store)


def test_a_key_with_other_bytes_stops_the_publish(tmp_path, store):
    tree = make_tree(tmp_path / "src")
    store.add(PREFIX + "model/RIMS.pm", b"other bytes")
    assert exit_code(tree, store) == 4
    assert PREFIX + "TREEHASH" not in keys(store)
    assert store.objects[PREFIX + "model/RIMS.pm"].body == b"other bytes"


def test_verify_failures_are_exit_7(tmp_path, store):
    tree = make_tree(tmp_path / "src")
    s3 = FakeS3(store)
    s3.private_put = {PREFIX + "model/RIMS.pm"}
    assert exit_code(tree, store, client=s3) == 7


# ── the command ───────────────────────────────────────────────────────────────


def test_cli_publish_and_exit_codes(tmp_path, store, monkeypatch):
    tree = make_tree(tmp_path / "src")
    monkeypatch.setattr(pub, "make_client", lambda exe, cfg, bucket: FakeS3(store))
    monkeypatch.setattr(pub, "check_credentials", lambda cfg, exe: (exe, cfg))
    runner = CliRunner(mix_stderr=False) if "mix_stderr" in CliRunner.__init__.__code__.co_varnames else CliRunner()
    base = ["code", "publish", str(tree), "--base-url", store.url]
    r = runner.invoke(cli, base + ["--dry-run"])
    assert r.exit_code == 0 and "plan: 7 upload" in r.output and keys(store) == []
    r = runner.invoke(cli, base)
    assert r.exit_code == 0, r.output
    assert f"published: {PREFIX}" in r.output
    r = runner.invoke(cli, base)
    assert r.exit_code == 0 and "already published" in r.output
    (tree / "model/RIMS.pm").write_bytes(b"changed")
    r = runner.invoke(cli, base)
    assert r.exit_code == 4 and "--revision 1" in r.output
    r = runner.invoke(cli, ["code", "publish", str(tmp_path / "missing"), "--base-url", store.url])
    assert r.exit_code == 2
    assert "publish" in runner.invoke(cli, ["code", "--help"]).output
