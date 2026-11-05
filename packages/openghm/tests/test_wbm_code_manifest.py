"""``wbm-code/manifest.json``: the version order, the strict format, and the commands that write it
(``code publish``, ``code manifest sync``, ``code set-status``) against the in-memory bucket of ``test_publish``."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from openghm import code_publish as cp, publish as pub, wbm_code_manifest as wm
from openghm.cli.main import cli
from test_code_publish import FILES, WBM_PL, make_tree
from test_publish import FakeS3, Store, _no_backoff  # noqa: F401  (the fixture is autouse)

KEY = "wbm-code/manifest.json"
H1, H2, H3 = "11" * 32, "22" * 32, "33" * 32
DATE = "2026-11-06"


@pytest.fixture
def store():
    s = Store()
    yield s
    s.close()


@pytest.fixture(autouse=True)
def _today(monkeypatch):
    monkeypatch.setattr(wm, "today_utc", lambda: DATE)


def entry(h=H1, status="current", published="2026-10-07", **extra):
    return {"treeHash": h, "status": status, "published": published, **extra}


def doc(versions, latest=None):
    return {"manifestVersion": 1, "code": {"wbm": {"aliases": {"latest": latest} if latest else {},
                                                    "versions": versions}}}


def put_manifest(store, d):
    raw = d if isinstance(d, bytes) else json.dumps(d).encode()
    store.add(KEY, raw)


def served(store):
    return json.loads(store.objects[KEY].body)


def tree(tmp_path: Path, version: str, name: str, body: bytes = b"1;\n") -> Path:
    wbm_pl = WBM_PL.replace(b"1.2.3", version.encode())
    return make_tree(tmp_path / name, {**FILES, "model/wbm.pl": (wbm_pl, 0o755), "model/RIMS.pm": (body, 0o644)})


def publish(src, store, **kw):
    lines = []
    kw.setdefault("jobs", 1)
    kw.setdefault("client", FakeS3(store))
    res = cp.publish_code(str(src), base_url=store.url, out=lines.append, **kw)
    return res, lines


def add_tree(store, name, tree_hash, modified=None, finished=True):
    store.add(f"wbm-code/wbm/{name}/model/wbm.pl", b"x")
    if finished:
        store.add(f"wbm-code/wbm/{name}/TREEHASH", (tree_hash + "\n").encode())
        if modified:
            store.objects[f"wbm-code/wbm/{name}/TREEHASH"].modified = modified


def sync(store, **kw):
    lines = []
    anon = pub.Anon(store.url)
    kw.setdefault("dry_run", False)
    res = wm.sync(store.url, anon, None if kw["dry_run"] else FakeS3(store), out=lines.append, **kw)
    return res, lines


def fail(fn, code, match=None):
    with pytest.raises(pub.PublishError, match=match) as e:
        fn()
    assert e.value.code == code
    return e.value


# ── order ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("chain", [
    ["22.1.1", "23.9.0", "23.10.0"],
    ["23.9.0", "23.9.0-r1", "23.9.0-r2", "23.9.1"],
    ["23.9.0-r2", "23.9.0-r10"],
    ["23.9", "23.9.0"],
    ["23.10.0", "23.10.0-beta", "unstable"],        # a non-numeric part sorts after the numeric ones
])
def test_version_order(chain):
    keys = [wm.version_key(v) for v in chain]
    assert keys == sorted(keys) and len(set(keys)) == len(keys)
    assert sorted(reversed(chain), key=wm.version_key) == chain
    assert wm.latest_of(set(chain)) == chain[-1]


def test_latest_of_nothing():
    assert wm.latest_of({}) is None


# ── the format ────────────────────────────────────────────────────────────────


def test_serialise_is_stable_and_round_trips():
    m = doc({"23.10.0": entry(H2, published="2026-10-08"), "23.9.0-r1": entry(H3, "withdrawn", reason="bad"),
             "22.1.1": entry(H1, "legacy"), "23.9.0": entry(H2)}, latest="23.10.0")
    data = wm.serialise(wm.parse(json.dumps(m)))
    text = data.decode()
    assert text.endswith("}\n") and not text.endswith("\n\n")
    assert list(json.loads(text)["code"]["wbm"]["versions"]) == ["22.1.1", "23.9.0", "23.9.0-r1", "23.10.0"]
    assert text.startswith('{\n  "manifestVersion": 1,\n  "code": {\n    "wbm": {\n      "aliases": {\n        "latest"')
    assert ('"23.9.0-r1": {\n          "treeHash": "%s",\n          "status": "withdrawn",\n          "published": '
            '"2026-10-07",\n          "reason": "bad"\n        }' % H3) in text
    assert wm.serialise(wm.parse(data)) == data
    assert json.loads(text) == m


@pytest.mark.parametrize("bad,match", [
    (b"not json", "not JSON"),
    (b"[]", "exactly manifestVersion and code"),
    (json.dumps({"manifestVersion": 2, "code": {}}).encode(), "manifestVersion must be 1"),
    (json.dumps({"manifestVersion": 1, "code": {}, "extra": 1}).encode(), "exactly manifestVersion and code"),
    (json.dumps(doc({"1.0.0": entry(status="deprecated")})).encode(), "status 'deprecated'"),
    (json.dumps(doc({"1.0.0": entry(h="abc")})).encode(), "treeHash"),
    (json.dumps(doc({"1.0.0": entry(published="07/10/2026")})).encode(), "ISO date"),
    (json.dumps(doc({"1.0.0": entry(published="2026-13-40")})).encode(), "not a date"),
    (json.dumps(doc({"1.0.0": entry(status="withdrawn")})).encode(), "needs a non-empty reason"),
    (json.dumps(doc({"1.0.0": entry(reason="x")})).encode(), "only a withdrawn version carries a reason"),
    (json.dumps(doc({"1.0.0": entry(extra=1)})).encode(), "unknown key"),
    (json.dumps(doc({"1.0.0": entry()}, latest="9.9.9")).encode(), "not a listed version"),
    (json.dumps(doc({"../x": entry()})).encode(), "not a version string"),
    (json.dumps({"manifestVersion": 1, "code": {"wbm": {"versions": {}}}}).encode(), "aliases and versions"),
])
def test_parse_is_strict(bad, match):
    fail(lambda: wm.parse(bad), 4, match)


def test_reading_a_malformed_manifest_is_an_error(store):
    put_manifest(store, b'{"manifestVersion": 1, "code": {"wbm": {"aliases": {}, "versions": {"1": {}}}}}')
    fail(lambda: wm.read_manifest(pub.Anon(store.url)), 4, "not a valid WBM code manifest")
    r = CliRunner().invoke(cli, ["code", "manifest", "--base-url", store.url])
    assert r.exit_code == 4 and "not a valid" in r.output


# ── publish ───────────────────────────────────────────────────────────────────


def test_publish_adds_a_current_entry_and_latest(tmp_path, store):
    res, lines = publish(tree(tmp_path, "1.2.3", "a"), store)
    assert res.manifest == "added" and res.manifest_error is None
    assert served(store) == doc({"1.2.3": entry(res.tree_hash, published=DATE)}, latest="1.2.3")
    assert store.objects[KEY].public
    assert store.objects[KEY].body == wm.serialise(wm.parse(store.objects[KEY].body))
    assert any(l.startswith("manifest: 1.2.3 -> current, published 2026-11-06") for l in lines)
    # a newer version and a revision: the old entries are untouched, latest follows the order
    res2, _ = publish(tree(tmp_path, "1.10.0", "b"), store)
    res3, _ = publish(tree(tmp_path, "1.2.3", "c", b"changed;\n"), store, revision=1)
    m = served(store)["code"]["wbm"]
    assert list(m["versions"]) == ["1.2.3", "1.2.3-r1", "1.10.0"] and m["aliases"] == {"latest": "1.10.0"}
    assert m["versions"]["1.2.3"] == entry(res.tree_hash, published=DATE)
    assert m["versions"]["1.2.3-r1"]["treeHash"] == res3.tree_hash


def test_publish_leaves_existing_entries_untouched(tmp_path, store):
    put_manifest(store, doc({"0.9.0": entry(H1, "legacy", "2026-01-02"), "9.0.0": entry(H2, "withdrawn", reason="bad")},
                            latest="9.0.0"))
    publish(tree(tmp_path, "1.2.3", "a"), store)
    m = served(store)["code"]["wbm"]
    assert m["versions"]["0.9.0"] == entry(H1, "legacy", "2026-01-02")
    assert m["versions"]["9.0.0"] == entry(H2, "withdrawn", reason="bad")
    assert m["aliases"]["latest"] == "9.0.0" and m["versions"]["1.2.3"]["status"] == "current"


def test_publishing_the_same_version_again_changes_nothing(tmp_path, store):
    src = tree(tmp_path, "1.2.3", "a")
    publish(src, store)
    before = store.objects[KEY].body
    store.writes.clear()
    res, lines = publish(src, store)
    assert res.already_published and res.manifest == "unchanged" and store.writes == []
    assert store.objects[KEY].body == before
    assert any("already lists 1.2.3; unchanged" in l for l in lines)


def test_a_manifest_entry_with_another_hash_is_refused_before_any_write(tmp_path, store):
    put_manifest(store, doc({"1.2.3": entry(H1)}, latest="1.2.3"))
    store.writes.clear()
    e = fail(lambda: publish(tree(tmp_path, "1.2.3", "a"), store), 4, "never replaced")
    assert H1 in str(e) and store.writes == [] and store.keys("wbm-code/wbm/") == []
    assert served(store)["code"]["wbm"]["versions"]["1.2.3"]["treeHash"] == H1
    # also when the code is already published with the hash the manifest does not have
    other = Store()
    try:
        publish(tree(tmp_path, "1.2.3", "b"), other)
        put_manifest(other, doc({"1.2.3": entry(H1)}, latest="1.2.3"))
        fail(lambda: publish(tmp_path / "b", other), 4, "never replaced")
    finally:
        other.close()


def test_a_malformed_manifest_stops_the_publish_before_any_write(tmp_path, store):
    put_manifest(store, b"{}")
    store.writes.clear()
    fail(lambda: publish(tree(tmp_path, "1.2.3", "a"), store), 4, "not a valid WBM code manifest")
    assert store.writes == []


def test_dry_run_shows_the_manifest_action_and_writes_nothing(tmp_path, store):
    src = tree(tmp_path, "1.2.3", "a")
    lines = []
    cp.publish_code(str(src), base_url=store.url, dry_run=True, s3cfg=str(tmp_path / "none"), out=lines.append)
    assert store.writes == [] and KEY not in store.objects
    assert any(l.startswith("manifest: 1.2.3 -> current") and "dry run" in l for l in lines)
    publish(src, store)
    store.writes.clear()
    lines.clear()
    cp.publish_code(str(src), base_url=store.url, dry_run=True, out=lines.append)
    assert store.writes == [] and any("already lists 1.2.3; unchanged" in l for l in lines)


def test_a_manifest_write_failure_is_its_own_error_and_the_code_stays_published(tmp_path, store, monkeypatch):
    src = tree(tmp_path, "1.2.3", "a")
    s3 = FakeS3(store)
    s3.fail_put = {KEY}
    res, _ = publish(src, store, client=s3)
    assert res.manifest == "failed" and "s3cmd put failed" in res.manifest_error
    assert res.verified > 0 and "wbm-code/wbm/1.2.3/TREEHASH" in store.keys("wbm-code/wbm/") and KEY not in store.objects

    monkeypatch.setattr(pub, "make_client", lambda exe, cfg, bucket: s3)
    monkeypatch.setattr(pub, "check_credentials", lambda cfg, exe: (exe, cfg))
    r = CliRunner().invoke(cli, ["code", "publish", str(src), "--base-url", store.url])
    assert r.exit_code == 8 and "already published" in r.output
    assert "openghm code manifest sync" in r.output and "wbm-code/manifest.json was not updated" in r.output
    # a fresh publish whose manifest write fails: the same exit, and it says the code was published and verified
    other = Store()
    try:
        s3b = FakeS3(other)
        s3b.fail_put = {KEY}
        monkeypatch.setattr(pub, "make_client", lambda exe, cfg, bucket: s3b)
        r = CliRunner().invoke(cli, ["code", "publish", str(src), "--base-url", other.url])
        assert r.exit_code == 8 and "published at wbm-code/wbm/1.2.3/ and verified" in r.output
    finally:
        other.close()
    # repair: running the same publish again, or sync, lists it
    s3.fail_put = set()
    res2, _ = publish(src, store)
    assert res2.already_published and res2.manifest == "added" and "1.2.3" in served(store)["code"]["wbm"]["versions"]


def test_a_manifest_that_reads_back_wrong_is_exit_7(tmp_path, store):
    s3 = FakeS3(store)
    s3.private_put = {KEY}
    res, _ = publish(tree(tmp_path, "1.2.3", "a"), store, client=s3)
    assert res.manifest == "failed" and "cannot be read back" in res.manifest_error
    fail(lambda: wm.write_manifest(wm.empty(), s3, pub.Anon(store.url)), 7)


# ── sync ──────────────────────────────────────────────────────────────────────


def test_sync_builds_the_manifest_from_the_bucket(store):
    add_tree(store, "23.9.0", H2, "Wed, 07 Oct 2026 23:30:00 GMT")
    add_tree(store, "22.1.1", H1, "Tue, 06 Oct 2026 01:00:00 GMT")
    add_tree(store, "23.9.0-r1", H3, "Thu, 08 Oct 2026 08:00:00 GMT")
    add_tree(store, "24.0.0", H3, finished=False)                         # unfinished: no TREEHASH
    store.add("wbm-code/wbm/stray file/x", b"x")                          # not a version string
    res, lines = sync(store)
    assert res.added == ["22.1.1", "23.9.0", "23.9.0-r1"] and res.changed
    assert served(store) == doc({"22.1.1": entry(H1, published="2026-10-06"),
                                 "23.9.0": entry(H2, published="2026-10-07"),
                                 "23.9.0-r1": entry(H3, published="2026-10-08")}, latest="23.9.0-r1")
    assert any("skip" in l and "24.0.0" in l and "unfinished" in l for l in lines)
    assert any("skip" in l and "not a version string" in l for l in lines)
    # a second sync has nothing to do and writes nothing
    store.writes.clear()
    res2, lines2 = sync(store)
    assert not res2.changed and store.writes == [] and any("up to date" in l for l in lines2)


def test_sync_keeps_existing_entries_and_adds_the_missing_ones(store):
    put_manifest(store, doc({"22.1.1": entry(H1, "legacy", "2026-01-01")}, latest="22.1.1"))
    add_tree(store, "22.1.1", H1, "Tue, 06 Oct 2026 01:00:00 GMT")
    add_tree(store, "23.9.0", H2, "Wed, 07 Oct 2026 12:00:00 GMT")
    sync(store)
    m = served(store)["code"]["wbm"]
    assert m["versions"]["22.1.1"] == entry(H1, "legacy", "2026-01-01")      # status and date are not redone
    assert m["versions"]["23.9.0"] == entry(H2, "current", "2026-10-07") and m["aliases"] == {"latest": "23.9.0"}


def test_sync_refreshes_a_stale_latest_and_warns_about_an_entry_without_a_tree(store):
    put_manifest(store, doc({"1.0.0": entry(H1), "2.0.0": entry(H2)}, latest="1.0.0"))
    add_tree(store, "1.0.0", H1)
    res, lines = sync(store)
    assert res.changed and served(store)["code"]["wbm"]["aliases"] == {"latest": "2.0.0"}
    assert any(l.startswith("warning:") and "2.0.0" in l for l in lines)


def test_sync_mismatch_is_an_error_and_writes_nothing(store):
    put_manifest(store, doc({"22.1.1": entry(H1)}, latest="22.1.1"))
    add_tree(store, "22.1.1", H2)
    add_tree(store, "23.9.0", H3)
    store.writes.clear()
    e = fail(lambda: sync(store), 4, "nothing is written")
    assert H1 in str(e) and H2 in str(e) and store.writes == []
    r = CliRunner().invoke(cli, ["code", "manifest", "sync", "--dry-run", "--base-url", store.url])
    assert r.exit_code == 4 and "22.1.1" in r.output
    # a TREEHASH that is not a hash is an error too
    store.objects["wbm-code/wbm/23.9.0/TREEHASH"].body = b"garbage\n"
    put_manifest(store, doc({}))
    fail(lambda: sync(store), 4, "does not hold a tree hash")


def test_sync_dry_run_writes_nothing(store):
    add_tree(store, "1.0.0", H1, "Tue, 06 Oct 2026 01:00:00 GMT")
    res, lines = sync(store, dry_run=True)
    assert res.added == ["1.0.0"] and store.writes == [] and KEY not in store.objects
    assert any("dry run: would create" in l for l in lines)


def test_sync_of_an_empty_bucket_writes_nothing(store):
    res, lines = sync(store)
    assert not res.changed and store.writes == [] and any("no published WBM code versions" in l for l in lines)


# ── set-status ────────────────────────────────────────────────────────────────


def set_status(store, version, status, reason=None, **kw):
    lines = []
    kw.setdefault("dry_run", False)
    changed = wm.set_status_command(pub.Anon(store.url), None if kw["dry_run"] else FakeS3(store), version, status,
                                    reason, out=lines.append, **kw)
    return changed, lines


@pytest.fixture
def two(store):
    put_manifest(store, doc({"22.1.1": entry(H1), "23.9.0": entry(H2)}, latest="23.9.0"))
    store.writes.clear()
    return store


def test_set_status_flows(two):
    changed, lines = set_status(two, "22.1.1", "legacy")
    assert changed and lines[1:3] == ["before:  status=current", "after:   status=legacy"]
    assert served(two)["code"]["wbm"]["versions"]["22.1.1"] == entry(H1, "legacy")
    changed, lines = set_status(two, "22.1.1", "withdrawn", " found broken ")
    assert changed and lines[2] == 'after:   status=withdrawn reason="found broken"'
    assert served(two)["code"]["wbm"]["versions"]["22.1.1"]["reason"] == "found broken"
    two.writes.clear()
    changed, lines = set_status(two, "22.1.1", "withdrawn", "found broken")        # a no-op
    assert not changed and two.writes == [] and any(l.startswith("no change") for l in lines)
    changed, lines = set_status(two, "22.1.1", "current")                          # the reason is dropped
    assert changed and served(two)["code"]["wbm"]["versions"]["22.1.1"] == entry(H1)
    assert "reason" in lines[1]
    # the other entry and latest were not touched
    assert served(two)["code"]["wbm"]["versions"]["23.9.0"] == entry(H2)
    assert served(two)["code"]["wbm"]["aliases"] == {"latest": "23.9.0"}


def test_set_status_refusals(two):
    fail(lambda: set_status(two, "22.1.1", "withdrawn"), 2, "needs --reason")
    fail(lambda: set_status(two, "22.1.1", "withdrawn", "  "), 2, "needs --reason")
    fail(lambda: set_status(two, "22.1.1", "legacy", "why"), 2, "only for withdrawn")
    fail(lambda: set_status(two, "9.9.9", "legacy"), 2, "not in wbm-code/manifest.json")
    fail(lambda: set_status(two, "22.1.1", "deprecated"), 2, "not one of")
    assert two.writes == []
    empty = Store()
    try:
        fail(lambda: set_status(empty, "1.0.0", "legacy"), 2, "manifest sync")
    finally:
        empty.close()


def test_set_status_dry_run_writes_nothing(two):
    before = two.objects[KEY].body
    changed, lines = set_status(two, "22.1.1", "legacy", dry_run=True)
    assert changed and two.writes == [] and two.objects[KEY].body == before
    assert any("dry run" in l for l in lines)


# ── the commands ──────────────────────────────────────────────────────────────


def test_cli_manifest_set_status_and_sync(store, monkeypatch):
    monkeypatch.setattr(pub, "make_client", lambda exe, cfg, bucket: FakeS3(store))
    monkeypatch.setattr(pub, "check_credentials", lambda cfg, exe: (exe, cfg))
    run = lambda *a: CliRunner().invoke(cli, ["code", *a, "--base-url", store.url])      # noqa: E731
    r = run("manifest")
    assert r.exit_code == 2 and "manifest sync" in r.output
    add_tree(store, "23.9.0", H2, "Wed, 07 Oct 2026 12:00:00 GMT")
    r = run("manifest", "sync", "--dry-run")
    assert r.exit_code == 0 and KEY not in store.objects
    r = run("manifest", "sync")
    assert r.exit_code == 0 and KEY in store.objects
    r = run("manifest")
    assert r.exit_code == 0 and r.output == store.objects[KEY].body.decode()
    assert json.loads(r.output)["code"]["wbm"]["aliases"] == {"latest": "23.9.0"}
    r = run("set-status", "23.9.0", "withdrawn")
    assert r.exit_code == 2 and "--reason" in r.output
    r = run("set-status", "23.9.0", "withdrawn", "--reason", "wrong results")
    assert r.exit_code == 0 and "wrong results" in r.output
    r = run("set-status", "23.9.0", "withdrawn", "--reason", "wrong results")
    assert r.exit_code == 0 and "no change" in r.output
    r = run("set-status", "1.0.0", "legacy")
    assert r.exit_code == 2
    monkeypatch.undo()
    r = CliRunner().invoke(cli, ["code", "set-status", "23.9.0", "legacy", "--base-url", store.url,
                                 "--s3cfg", "/nonexistent/s3cfg"])
    assert r.exit_code == 5
