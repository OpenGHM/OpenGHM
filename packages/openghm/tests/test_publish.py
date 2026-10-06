"""``snapshot publish`` against an in-memory bucket.

``Store`` is the bucket: a dict of objects, served read-only over HTTP (listing, GET, HEAD,
public objects only, like the real one) and written by ``FakeS3``, which plays ``s3cmd``.
So a publish runs the way it does live (anonymous reads of the base, authenticated writes,
anonymous verification) with no network and no credentials, and ``snapshot fetch`` can read
back what it wrote.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import subprocess
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from xml.sax.saxutils import escape

import pytest
from click.testing import CliRunner

from openghm import Config, fetch, publish as pub, spec
from openghm.cli.main import cli

BASE = "ba" * 32
NEW = "ce" * 32
MI = "52585562109e15bd7b06fad0e6deb17d1f4fa72a38474828adac5e74c169bc5d"
EXE, REG = 0o100755, 0o100644

BASE_EXAMPLE = json.loads(
    (spec.schemas_root() / "snapshot-spec" / "examples" / "wbm_storage_v2.0.0.json").read_text()
)

INIT = """{
  MT_Code_Name => {
    Output_dir => '/wbm/wbm_output/sim-1',
    Run_End    => '2001-12-31',
  },
  Spinup => { Start => '2000-01-01', End => '2000-12-31', Loops => 1 },
  Output_vars => 'runoff
                  discharge',
  PostProcessing => { Run => 1, Temporal_Aggregation => 1 },
}
"""


# ── the bucket ────────────────────────────────────────────────────────────────


def attrs(mode: int) -> str:
    return f"atime:1/ctime:2/gid:1000/gname:x/md5:00/mode:{mode}/mtime:3/uid:1000/uname:x"


class Obj:
    def __init__(self, body: bytes, meta=None, public=True, etag=None):
        self.body, self.meta, self.public = body, dict(meta or {}), public
        self.etag = etag if etag is not None else hashlib.md5(body).hexdigest()


class Store:
    def __init__(self):
        self.objects = {}
        self.writes = []                 # ("copy" | "put", key), in order
        store = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _object(self, send_body):
                url = urllib.parse.urlsplit(self.path)
                if url.path == "/openghm":
                    return self._list(urllib.parse.parse_qs(url.query))
                key = urllib.parse.unquote(url.path[len("/openghm/"):])
                obj = store.objects.get(key)
                if obj is None:
                    return self._send(404, b"", send_body)
                if not obj.public:
                    return self._send(403, b"", send_body)
                headers = {"ETag": f'"{obj.etag}"'}
                headers.update({f"x-amz-meta-{k}": v for k, v in obj.meta.items()})
                self._send(200, obj.body, send_body, headers)

            do_GET = lambda self: self._object(True)      # noqa: E731
            do_HEAD = lambda self: self._object(False)    # noqa: E731

            def _list(self, q):
                prefix = q.get("prefix", [""])[0]
                xml = ['<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
                       "<IsTruncated>false</IsTruncated>"]
                for k in sorted(k for k in store.objects if k.startswith(prefix)):
                    o = store.objects[k]
                    xml.append(f"<Contents><Key>{escape(k)}</Key><Size>{len(o.body)}</Size>"
                               f"<ETag>&quot;{o.etag}&quot;</ETag></Contents>")
                xml.append("</ListBucketResult>")
                self._send(200, "".join(xml).encode(), True)

            def _send(self, code, body, send_body, headers=None):
                self.send_response(code)
                self.send_header("Content-Length", str(len(body)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                if send_body:
                    self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/openghm"
        threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.01), daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def add(self, key, body: bytes, mode=REG, **kw):
        meta = kw.pop("meta", None) or {"s3cmd-attrs": attrs(mode)}
        self.objects[key] = Obj(body, meta, **kw)

    def keys(self, prefix=""):
        return sorted(k for k in self.objects if k.startswith(prefix))


class FakeS3(pub.S3Client):
    """What ``s3cmd`` does, with the failures a test asks for."""

    def __init__(self, store: Store):
        self.store = store
        self.fail_put, self.fail_copy, self.fail_head = set(), set(), set()
        self.private_put, self.short_put, self.no_mode_put = set(), set(), set()

    def head(self, key):
        if key in self.fail_head:
            raise pub.S3Error("boom")
        o = self.store.objects.get(key)
        return None if o is None else pub.ObjectInfo(size=len(o.body), etag=o.etag, meta=dict(o.meta))

    def copy(self, src, dst):
        if dst in self.fail_copy:
            raise pub.S3Error("s3cmd cp failed (exit 1)")
        o = self.store.objects[src]
        self.store.objects[dst] = Obj(o.body, o.meta, public=True, etag=o.etag)
        self.store.writes.append(("copy", dst))

    def put(self, path, key, sha256):
        if key in self.fail_put:
            raise pub.S3Error("s3cmd put failed (exit 1)")
        with open(path, "rb") as fh:
            body = fh.read()
        meta = {"sha256": sha256}
        if key not in self.no_mode_put:
            meta["s3cmd-attrs"] = attrs(os.stat(path).st_mode)
        self.store.objects[key] = Obj(body[:-1] if key in self.short_put else body, meta,
                                      public=key not in self.private_put)
        self.store.writes.append(("put", key))


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch):
    monkeypatch.setattr(fetch, "_BACKOFF", 0.0)


@pytest.fixture
def store():
    s = Store()
    base_meta = copy.deepcopy(BASE_EXAMPLE)
    base_meta["id"] = BASE
    files = {
        "model/wbm.pl": (b"#!/usr/bin/perl\nprint 1;\n", EXE),
        "model/lib/WBM.pm": (b"1;\n", REG),
        "utilities/tool.pl": (b"#!/usr/bin/perl\n", EXE),
        "gdal_test_files/probe.tif": (b"t" * 40, REG),
        "metadata.json": (json.dumps(base_meta).encode(), REG),
        # what the new tree does not carry over
        "wbm_init/wbm_test.init": (b"{ Output_dir => 'x' }\n", REG),
        "wbm_init/old.init": (b"{}\n", REG),
        "WBM_run_state/old.dat": (b"old state", REG),
        "spool/day.dat": (b"spool", REG),
        "data/x.nc": (b"data", REG),
    }
    for rel, (body, mode) in files.items():
        s.add(f"snapshots/{BASE}/{rel}", body, mode)
    sums = "".join(f"{hashlib.sha256(b).hexdigest()}  ./{rel}\n" for rel, (b, _m) in sorted(files.items()))
    s.add(f"snapshots/{BASE}/SHA256SUMS", sums.encode())
    s.add(f"snapshots/{BASE}/wbm_output/old/x.nc", b"old output")
    yield s
    s.close()


def make_run(root, *, years=(2000, 2001), variables=("runoff", "discharge"), **sidecar):
    run = root / "sim-1"
    rec = {"simulation_id": "sim-1", "snapshot": BASE, "init": "wbm_test.init", "model_input": MI,
           "exit_code": 0, "spool_mode": "cache"}
    rec.update(sidecar)
    (run / "wbm_init").mkdir(parents=True)
    (run / "wbm_init" / "wbm_test.init").write_text(INIT)
    (run / "wbm_init" / "wbm_SHORT.init").write_text("{}\n")
    (run / "simulation.json").write_text(json.dumps(rec))
    out = run / "wbm_output" / "sim-1"
    for rel in [f"daily/wbm_{y}.nc" for y in years] + [f"monthly/{v}/wbm_{y}.nc" for v in variables for y in years] \
            + ["wbm_test.log", "init_files/wbm_test.init"]:
        (out / rel).parent.mkdir(parents=True, exist_ok=True)
        (out / rel).write_bytes(f"content of {rel}".encode())
    (run / "WBM_run_state").mkdir()
    (run / "WBM_run_state" / "a.dat").write_bytes(b"state")
    (run / "WBM_run_state" / "a.dat").chmod(0o600)
    (run / "spool").mkdir()
    (run / "spool" / "day.dat").write_bytes(b"spool, never uploaded")
    os.symlink(str(run / "spool"), str(run / "spool-cache"))
    return run


def make_metadata(root, mutate=None):
    meta = copy.deepcopy(BASE_EXAMPLE)
    meta["id"] = BASE        # a copy of the base's document: publish sets its own id
    meta["about"]["name"] = "A published run"
    meta["about"]["isBasedOn"] = [{"kind": "snapshot", "id": BASE}]
    if mutate:
        mutate(meta)
    path = root / "metadata.json"
    path.write_text(json.dumps(meta))
    return path


@pytest.fixture
def run(tmp_path):
    return make_run(tmp_path)


@pytest.fixture
def meta_path(tmp_path):
    return make_metadata(tmp_path)


def go(run, meta_path, store, *, client=None, **kw):
    lines = []
    kw.setdefault("snapshot_id", NEW)
    kw.setdefault("jobs", 1)
    result = pub.publish(str(run), str(meta_path), base_url=store.url, client=client or FakeS3(store),
                         out=lines.append, **kw)
    return result, lines


def new_keys(store):
    return store.keys(f"snapshots/{NEW}/")


def code_of(run, meta_path, store, **kw):
    with pytest.raises(pub.PublishError) as e:
        go(run, meta_path, store, **kw)
    return e.value.code


# ── plan ──────────────────────────────────────────────────────────────────────


def _plan(run, meta_path, store, tmp_path):
    work = tmp_path / "work"
    work.mkdir(exist_ok=True)
    return pub.prepare(str(run), str(meta_path), NEW, store.url, str(work))


def test_plan_copies_the_base_and_uploads_the_run(run, meta_path, store, tmp_path):
    plan = _plan(run, meta_path, store, tmp_path)
    by_kind = {k: [a.rel for a in plan.actions if a.kind == k] for k in ("copy", "upload")}
    # the base's code and fixtures, server-side; not its metadata, sums, init, output, run state, spool or data
    assert by_kind["copy"] == ["gdal_test_files/probe.tif", "model/lib/WBM.pm", "model/wbm.pl", "utilities/tool.pl"]
    assert all(a.source == f"snapshots/{BASE}/{a.rel}" for a in plan.actions if a.kind == "copy")
    uploads = by_kind["upload"]
    assert uploads[:2] == ["wbm_init/wbm_SHORT.init", "wbm_init/wbm_test.init"]
    assert "wbm_output/sim-1/daily/wbm_2000.nc" in uploads and "WBM_run_state/a.dat" in uploads
    assert not any(r.startswith(("spool", "data")) or "old" in r for r in uploads)
    # SHA256SUMS, then metadata.json, last
    assert uploads[-2:] == ["SHA256SUMS", "metadata.json"]
    assert plan.actions[-1].key == f"snapshots/{NEW}/metadata.json"


def test_plan_sums_are_the_recipe(run, meta_path, store, tmp_path):
    plan = _plan(run, meta_path, store, tmp_path)
    sums = fetch.parse_sums(plan.sums_bytes.decode())
    base_sums = fetch.parse_sums(store.objects[f"snapshots/{BASE}/SHA256SUMS"].body.decode())
    # a copied file's line is the base's own
    for rel in ("model/wbm.pl", "model/lib/WBM.pm", "utilities/tool.pl", "gdal_test_files/probe.tif"):
        assert sums[rel] == base_sums[rel]
    # an uploaded one is hashed; output is a result and has no line, nor has SHA256SUMS itself
    assert sums["wbm_init/wbm_test.init"] == hashlib.sha256(INIT.encode()).hexdigest()
    assert sums["WBM_run_state/a.dat"] == hashlib.sha256(b"state").hexdigest()
    assert sums["metadata.json"] == hashlib.sha256(plan.metadata_bytes).hexdigest()
    assert not any(r.startswith(("wbm_output/", "spool/", "data/")) or r == "SHA256SUMS" for r in sums)
    assert set(sums) == {"model/wbm.pl", "model/lib/WBM.pm", "utilities/tool.pl", "gdal_test_files/probe.tif",
                         "wbm_init/wbm_test.init", "wbm_init/wbm_SHORT.init", "WBM_run_state/a.dat", "metadata.json"}
    assert plan.sums_bytes.decode().splitlines() == sorted(plan.sums_bytes.decode().splitlines(), key=lambda l: l[66:])
    # the same inputs give the same bytes
    again = _plan(run, meta_path, store, tmp_path)
    assert (again.sums_bytes, again.metadata_bytes) == (plan.sums_bytes, plan.metadata_bytes)


def test_the_new_metadata_carries_its_own_id(run, meta_path, store, tmp_path):
    plan = _plan(run, meta_path, store, tmp_path)
    doc = json.loads(plan.metadata_bytes)
    assert doc["id"] == NEW and doc["about"]["name"] == "A published run"
    assert spec.validate_document(doc, spec="snapshot-spec").ok


def test_an_id_less_metadata_gets_one_after_schema(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"$schema": "s", "slug": "x"}))
    assert list(pub.read_metadata(str(p), NEW)) == ["$schema", "id", "slug"]
    p.write_text(json.dumps({"slug": "x"}))
    assert list(pub.read_metadata(str(p), NEW)) == ["id", "slug"]


# ── check: each failure has its exit code and writes nothing ───────────────────


def _drop(meta, *path):
    for p in path[:-1]:
        meta = meta[p]
    del meta[path[-1]]


@pytest.mark.parametrize("mutate", [
    lambda m: _drop(m, "about", "license"),                                    # fails the spec
    lambda m: m["about"].__setitem__("isBasedOn", [{"kind": "run", "id": "1"}]),   # malformed isBasedOn
    lambda m: m["simulation"].__setitem__("init", "wbm_SHORT.init"),
    lambda m: m["uses"]["modelInput"].__setitem__("id", "0" * 64),
    lambda m: m["uses"]["container"].__setitem__("version", "9.9.9"),
    lambda m: m["about"].__setitem__("isBasedOn", [{"kind": "snapshot", "id": "0" * 64}]),
    lambda m: _drop(m, "about", "isBasedOn"),
], ids=["spec", "malformed-isBasedOn", "init", "model-input", "container", "other-base", "no-isBasedOn"])
def test_a_metadata_that_fails_or_disagrees_is_bad_input(mutate, tmp_path, run, store):
    meta_path = make_metadata(tmp_path, mutate)
    assert code_of(run, meta_path, store) == pub.EXIT_BAD_INPUT
    assert store.writes == [] and new_keys(store) == []


def _rm(run, rel):
    os.remove(run / "wbm_output" / "sim-1" / rel)


def _empty(run, rel):
    (run / "wbm_output" / "sim-1" / rel).write_bytes(b"")


@pytest.mark.parametrize("break_it", [
    lambda run: _rm(run, "daily/wbm_2001.nc"),
    lambda run: _rm(run, "monthly/discharge/wbm_2000.nc"),
    lambda run: _empty(run, "wbm_test.log"),
    lambda run: _empty(run, "daily/wbm_2000.nc"),
    lambda run: (run / "simulation.json").write_text(json.dumps(
        {"simulation_id": "sim-1", "snapshot": BASE, "init": "wbm_test.init", "model_input": MI, "exit_code": 1})),
    lambda run: __import__("shutil").rmtree(run / "wbm_output" / "sim-1"),
], ids=["no-year", "no-variable", "empty-log", "empty-daily", "run-failed", "no-output"])
def test_incomplete_output_is_its_own_exit_code(break_it, run, meta_path, store):
    break_it(run)
    assert code_of(run, meta_path, store) == pub.EXIT_OUTPUT_INCOMPLETE
    assert store.writes == [] and new_keys(store) == []


def test_the_message_names_what_is_missing(run, meta_path, store):
    _rm(run, "daily/wbm_2001.nc")
    with pytest.raises(pub.PublishError, match=r"daily/wbm_2001\.nc is missing"):
        go(run, meta_path, store)


def test_extra_output_files_are_fine(run, meta_path, store):
    (run / "wbm_output" / "sim-1" / "yearly" / "runoff").mkdir(parents=True)
    (run / "wbm_output" / "sim-1" / "yearly" / "runoff" / "wbm_2000.nc").write_bytes(b"y")
    go(run, meta_path, store)
    assert f"snapshots/{NEW}/wbm_output/sim-1/yearly/runoff/wbm_2000.nc" in store.objects


def test_what_the_init_does_not_state_is_not_checked_and_is_said(tmp_path, meta_path, store):
    run = make_run(tmp_path, years=(), variables=())
    (run / "wbm_init" / "wbm_test.init").write_text("{ Output_dir => 'x' }\n")
    result, lines = go(run, meta_path, store)
    notes = [l for l in lines if l.startswith("note:")]
    assert any("run period" in n for n in notes) and any("Output_vars" in n for n in notes)
    assert result.counts.upload > 0


def test_a_year_range_comes_from_run_start_or_the_spinup():
    years, variables, notes = pub.expected_output(INIT)
    assert (years, variables, notes) == ([2000, 2001], ["runoff", "discharge"], [])
    years, *_ = pub.expected_output(INIT.replace("Run_End    =>", "Run_Start => '2001-01-01', Run_End =>"))
    assert years == [2001]
    # monthly files are not expected without Temporal_Aggregation, nor are daily ones for a monthly file size
    assert pub.expected_output(INIT.replace("Temporal_Aggregation => 1", "Temporal_Aggregation => 0"))[1] is None
    assert pub.expected_output(INIT.replace("Run_End ", "File_Size => 'month', Run_End "))[0] is None


@pytest.mark.parametrize("bad", ["abc", "AB" * 32, "ab" * 31, BASE])
def test_a_bad_id_is_bad_input(bad, run, meta_path, store):
    assert code_of(run, meta_path, store, snapshot_id=bad) == pub.EXIT_BAD_INPUT
    assert store.writes == []


def test_a_base_that_is_not_published_is_bad_input(run, meta_path, store):
    for k in store.keys(f"snapshots/{BASE}/"):
        del store.objects[k]
    assert code_of(run, meta_path, store) == pub.EXIT_BAD_INPUT


def test_a_base_that_disagrees_with_its_sums_is_bad_input(run, meta_path, store):
    store.add(f"snapshots/{BASE}/model/stray.pl", b"unlisted")
    assert code_of(run, meta_path, store) == pub.EXIT_BAD_INPUT


def test_a_run_without_a_sidecar_is_bad_input(tmp_path, meta_path, store):
    (tmp_path / "empty").mkdir()
    assert code_of(tmp_path / "empty", meta_path, store) == pub.EXIT_BAD_INPUT
    assert code_of(tmp_path / "missing", meta_path, store) == pub.EXIT_BAD_INPUT


def test_a_symlinked_directory_in_the_output_is_refused(run, meta_path, store, tmp_path):
    os.symlink(str(tmp_path), str(run / "wbm_output" / "sim-1" / "link"))
    assert code_of(run, meta_path, store) == pub.EXIT_BAD_INPUT
    assert store.writes == []


# ── apply ─────────────────────────────────────────────────────────────────────


def test_a_fresh_publish_writes_the_tree_and_fetch_reads_it_back(run, meta_path, store, tmp_path):
    result, lines = go(run, meta_path, store)
    assert lines[0].startswith("snapshot id: ") and NEW in lines[0]      # before the first write
    assert result.counts.copy == 4 and result.counts.skip == 0 and result.verified == len(new_keys(store))
    # copies first, then uploads, SHA256SUMS, and metadata.json last
    kinds = [k for k, _ in store.writes]
    assert kinds == ["copy"] * 4 + ["put"] * (len(kinds) - 4)
    assert store.writes[-2][1].endswith("/SHA256SUMS") and store.writes[-1][1].endswith("/metadata.json")
    # nothing of the base's replaced part, the spool or the input
    assert not any(k.startswith(f"snapshots/{NEW}/{d}/") for k in store.objects for d in ("spool", "data"))
    assert f"snapshots/{NEW}/wbm_init/old.init" not in store.objects
    # public, with modes: copied ones are the base's, uploaded ones are the file's own
    assert all(store.objects[k].public for k in new_keys(store))
    o = store.objects
    assert o[f"snapshots/{NEW}/model/wbm.pl"].meta["s3cmd-attrs"] == o[f"snapshots/{BASE}/model/wbm.pl"].meta["s3cmd-attrs"]
    assert "mode:33152" in o[f"snapshots/{NEW}/WBM_run_state/a.dat"].meta["s3cmd-attrs"]      # 0o100600
    assert o[f"snapshots/{NEW}/WBM_run_state/a.dat"].meta["sha256"] == hashlib.sha256(b"state").hexdigest()
    # the result is a snapshot: fetch checks every file against SHA256SUMS and its mode, validate the spec
    dest = tmp_path / "fetched"
    cfg = Config(sif_dir=str(tmp_path / "sif"), model_input_dir=str(tmp_path / "mi"))
    got = fetch.fetch_snapshot(fetch.FetchOptions(snapshot_id=NEW, dest=str(dest), image=False, model_input=False,
                                                  base_url=store.url), cfg)
    assert got.ok, got.failed
    assert (dest / "model" / "wbm.pl").stat().st_mode & 0o777 == 0o755
    check = spec.validate_folder(dest, spec="snapshot-spec")
    assert check.ok, (check.document.errors, check.layout.missing_required)
    assert json.loads((dest / "metadata.json").read_text())["id"] == NEW


def test_uploading_in_parallel_gives_the_same_tree(run, meta_path, store):
    go(run, meta_path, store, jobs=4)
    # the phases still end in SHA256SUMS, then metadata.json
    assert [k for _, k in store.writes[-2:]] == [f"snapshots/{NEW}/SHA256SUMS", f"snapshots/{NEW}/metadata.json"]
    n = len(store.writes)
    # and a sequential run over it finds every key as it would have written it
    result, _ = go(run, meta_path, store, jobs=1)
    assert len(store.writes) == n and result.counts.copy == result.counts.upload == 0


def test_a_rerun_with_the_same_id_skips_every_key(run, meta_path, store):
    first, _ = go(run, meta_path, store)
    before = (len(store.writes), {k: o.body for k, o in store.objects.items()})
    second, lines = go(run, meta_path, store)
    assert len(store.writes) == before[0] and {k: o.body for k, o in store.objects.items()} == before[1]
    assert second.counts.skip == first.counts.copy + first.counts.upload and second.counts.copy == second.counts.upload == 0
    assert all(l.startswith(("snapshot id", "skip")) for l in lines)


def test_a_publish_that_dies_leaves_no_metadata_and_the_retry_completes(run, meta_path, store):
    fake = FakeS3(store)
    victim = f"snapshots/{NEW}/wbm_output/sim-1/monthly/runoff/wbm_2000.nc"
    fake.fail_put.add(victim)
    assert code_of(run, meta_path, store, client=fake) == pub.EXIT_UPLOAD_FAILED
    assert f"snapshots/{NEW}/metadata.json" not in store.objects and f"snapshots/{NEW}/SHA256SUMS" not in store.objects
    landed = list(store.writes)
    assert landed                                                    # some did land
    fake.fail_put.clear()
    result, _ = go(run, meta_path, store, client=fake)
    assert result.counts.skip == len(landed)                         # and they are skipped, not rewritten
    assert len({k for _, k in store.writes}) == len(store.writes)    # no key was written twice
    assert f"snapshots/{NEW}/metadata.json" in store.objects


def test_a_key_with_other_bytes_stops_the_publish_and_is_not_replaced(run, meta_path, store):
    key = f"snapshots/{NEW}/wbm_init/wbm_test.init"
    store.add(key, b"somebody else's bytes", meta={"sha256": "0" * 64})
    assert code_of(run, meta_path, store) == pub.EXIT_OTHER_BYTES
    assert store.objects[key].body == b"somebody else's bytes"
    assert f"snapshots/{NEW}/metadata.json" not in store.objects


def test_a_copy_target_with_other_bytes_stops_it_too(run, meta_path, store):
    key = f"snapshots/{NEW}/model/wbm.pl"
    store.add(key, b"#!/usr/bin/perl\nprint 2;\n", EXE)
    assert code_of(run, meta_path, store) == pub.EXIT_OTHER_BYTES
    # the keys before it were written, it was not, and nothing after it is
    assert store.objects[key].body.endswith(b"print 2;\n") and ("copy", key) not in store.writes
    assert f"snapshots/{NEW}/metadata.json" not in store.objects


def test_the_same_bytes_without_a_hash_are_recognised_by_their_md5(run, meta_path, store):
    key = f"snapshots/{NEW}/wbm_init/wbm_test.init"
    store.add(key, INIT.encode(), meta={"s3cmd-attrs": attrs(REG)})      # no x-amz-meta-sha256
    result, lines = go(run, meta_path, store)
    assert f"skip    {key}" in lines
    store.add(key, INIT.encode()[::-1], meta={})                          # same size, other bytes
    assert code_of(run, meta_path, store) == pub.EXIT_OTHER_BYTES


def test_a_published_snapshot_is_not_republished_with_other_metadata(run, tmp_path, store):
    first = make_metadata(tmp_path)
    go(run, first, store)
    published = store.objects[f"snapshots/{NEW}/metadata.json"].body
    n = len(store.writes)
    other = make_metadata(tmp_path, lambda m: m["about"].__setitem__("description", "another description"))
    assert code_of(run, other, store) == pub.EXIT_OTHER_BYTES
    assert store.objects[f"snapshots/{NEW}/metadata.json"].body == published and len(store.writes) == n


def test_the_id_is_minted_when_none_is_given(run, meta_path, store):
    result, lines = go(run, meta_path, store, snapshot_id=None)
    assert pub._HEX64_RE.match(result.snapshot_id) and result.snapshot_id != NEW
    assert lines[0] == f"snapshot id: {result.snapshot_id}"
    assert f"snapshots/{result.snapshot_id}/metadata.json" in store.objects


def test_an_s3_failure_is_exit_6(run, meta_path, store):
    fake = FakeS3(store)
    fake.fail_copy.add(f"snapshots/{NEW}/model/wbm.pl")
    assert code_of(run, meta_path, store, client=fake) == pub.EXIT_UPLOAD_FAILED
    n = len(store.writes)
    fake = FakeS3(store)
    fake.fail_head.add(f"snapshots/{NEW}/metadata.json")      # read first, before anything more is written
    assert code_of(run, meta_path, store, client=fake) == pub.EXIT_UPLOAD_FAILED
    assert len(store.writes) == n


# ── verify ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("attr, key", [
    ("private_put", "wbm_output/sim-1/daily/wbm_2000.nc"),      # not public-read
    ("short_put", "wbm_output/sim-1/wbm_test.log"),             # the wrong size
    ("no_mode_put", "WBM_run_state/a.dat"),                     # the mode did not land
])
def test_verification_catches_what_did_not_land(attr, key, run, meta_path, store):
    fake = FakeS3(store)
    getattr(fake, attr).add(f"snapshots/{NEW}/{key}")
    assert code_of(run, meta_path, store, client=fake) == pub.EXIT_VERIFY_FAILED


def test_verification_catches_a_copy_that_is_not_public(run, meta_path, store):
    class PrivateCopies(FakeS3):
        def copy(self, src, dst):
            super().copy(src, dst)
            self.store.objects[dst].public = False

    with pytest.raises(pub.PublishError, match="not readable anonymously") as e:
        go(run, meta_path, store, client=PrivateCopies(store))
    assert e.value.code == pub.EXIT_VERIFY_FAILED


# ── credentials ───────────────────────────────────────────────────────────────


def test_a_missing_s3cfg_stops_before_anything_is_read(tmp_path):
    with pytest.raises(pub.PublishError) as e:
        pub.publish(str(tmp_path / "no-run"), str(tmp_path / "no-meta"), s3cfg=str(tmp_path / "nope"),
                    base_url="http://127.0.0.1:9/openghm", out=lambda l: None)
    assert e.value.code == pub.EXIT_NO_CREDENTIALS and "nope" in str(e.value)


def test_check_credentials(tmp_path):
    cfg = tmp_path / "s3cfg"
    cfg.write_text("access_key = SECRET\n")
    exe, path = pub.check_credentials(str(cfg), sys.executable)
    assert path == str(cfg) and exe
    with pytest.raises(pub.PublishError, match="not on PATH") as e:
        pub.check_credentials(str(cfg), "no-such-s3cmd-anywhere")
    assert e.value.code == pub.EXIT_NO_CREDENTIALS
    cfg.chmod(0)
    try:
        if os.access(str(cfg), os.R_OK):
            pytest.skip("running as a user who reads anything")
        with pytest.raises(pub.PublishError) as e:
            pub.check_credentials(str(cfg), sys.executable)
        assert e.value.code == pub.EXIT_NO_CREDENTIALS and "SECRET" not in str(e.value)
    finally:
        cfg.chmod(0o600)


# ── the s3cmd backend, with the process seam ───────────────────────────────────


class Runner:
    def __init__(self, *results):
        self.results, self.calls = list(results), []

    def __call__(self, argv, **kw):
        self.calls.append(argv)
        rc, out, err = self.results.pop(0)
        return subprocess.CompletedProcess(argv, rc, out, err)


INFO = """s3://openghm/snapshots/x/model/wbm.pl (object):
   File size: 1234
   Last mod:  Thu, 26 Sep 2026 00:00:00 GMT
   MIME type: application/octet-stream
   Storage:   STANDARD
   MD5 sum:   0123456789abcdef0123456789abcdef
   SSE:       none
   Policy:    none
   CORS:      none
   ACL:       EES260008: FULL_CONTROL
   ACL:       *anon*: READ
   URL:       https://s3.example/openghm/snapshots/x/model/wbm.pl
   x-amz-meta-s3cmd-attrs: atime:1/gname:x/mode:33261/uname:x
   x-amz-meta-sha256: abc123
"""


def test_s3cmd_info_is_parsed():
    r = Runner((0, INFO, ""))
    info = pub.S3CmdClient("/usr/bin/s3cmd", "/home/u/.s3cfg", "openghm", runner=r).head("snapshots/x/model/wbm.pl")
    assert (info.size, info.etag, info.meta["sha256"], info.mode) == (1234, "0123456789abcdef0123456789abcdef", "abc123", 0o755)
    assert r.calls == [["/usr/bin/s3cmd", "-c", "/home/u/.s3cfg", "info", "s3://openghm/snapshots/x/model/wbm.pl"]]


@pytest.mark.parametrize("rc, err", [(12, ""), (1, "ERROR: S3 error: 404 (Not Found)"), (1, "NoSuchKey")])
def test_s3cmd_info_of_an_absent_key_is_none(rc, err):
    assert pub.S3CmdClient("s3cmd", "c", "b", runner=Runner((rc, "", err))).head("k") is None


def test_s3cmd_failures_are_errors_with_the_exit_code():
    c = lambda *res: pub.S3CmdClient("s3cmd", "c", "b", runner=Runner(*res))      # noqa: E731
    with pytest.raises(pub.S3Error, match=r"info failed \(exit 77\).*Access Denied"):
        c((77, "", "ERROR: Access Denied")).head("k")
    with pytest.raises(pub.S3Error, match="no 'File size'"):
        c((0, "something else\n", "")).head("k")
    with pytest.raises(pub.S3Error, match=r"put failed \(exit 1\)"):
        c((1, "", "upload failed")).put("/tmp/a.nc", "k", "0" * 64)
    with pytest.raises(pub.S3Error, match=r"cp failed \(exit 2\)"):
        c((2, "", "")).copy("a", "b")
    boom = pub.S3CmdClient("/no/such/s3cmd", "c", "b")
    with pytest.raises(pub.S3Error, match="cannot run"):
        boom.head("k")


def test_s3cmd_put_and_cp_arguments():
    r = Runner((0, "", ""), (0, "", ""))
    c = pub.S3CmdClient("s3cmd", "/c/.s3cfg", "openghm", runner=r)
    c.put("/run/wbm_output/sim/daily/wbm_2000.nc", "snapshots/n/wbm_output/sim/daily/wbm_2000.nc", "ab" * 32)
    c.copy("snapshots/b/model/wbm.pl", "snapshots/n/model/wbm.pl")
    put, cp = r.calls
    assert put[:5] == ["s3cmd", "-c", "/c/.s3cfg", "put", "--acl-public"] and "--preserve" in put
    assert f"--add-header=x-amz-meta-sha256:{'ab' * 32}" in put
    assert any(a.startswith("--mime-type=") for a in put) and "--mime-type=application/x-netcdf" in put
    assert put[-2:] == ["/run/wbm_output/sim/daily/wbm_2000.nc", "s3://openghm/snapshots/n/wbm_output/sim/daily/wbm_2000.nc"]
    assert cp == ["s3cmd", "-c", "/c/.s3cfg", "cp", "--acl-public", "s3://openghm/snapshots/b/model/wbm.pl",
                  "s3://openghm/snapshots/n/model/wbm.pl"]


def test_the_bucket_is_the_base_urls_last_segment():
    assert pub.bucket_of("https://s3.anvil.rcac.purdue.edu/openghm/") == "openghm"
    assert pub.bucket_of(fetch.S3_BASE) == "openghm"
    with pytest.raises(pub.OpenghmError):
        pub.bucket_of("https://s3.anvil.rcac.purdue.edu")


# ── anonymous reads ───────────────────────────────────────────────────────────


def test_anonymous_head_and_get(store):
    store.add("snapshots/q/a b.txt", b"hello", mode=EXE)
    store.add("snapshots/q/private", b"x", public=False)
    anon = pub.Anon(store.url)
    info = anon.head("snapshots/q/a b.txt")
    assert (info.size, info.mode, info.etag) == (5, 0o755, hashlib.md5(b"hello").hexdigest())
    assert anon.get("snapshots/q/a b.txt") == b"hello"
    assert anon.head("snapshots/q/private") is None and anon.head("snapshots/q/none") is None
    with pytest.raises(pub.OpenghmError, match="HTTP 404"):
        anon.get("snapshots/q/none")


# ── the CLI ───────────────────────────────────────────────────────────────────


def _invoke(*args):
    return CliRunner().invoke(cli, ["snapshot", "publish", *args])


def test_help_documents_the_exit_codes():
    out = _invoke("--help")
    assert out.exit_code == 0
    for word in ("--dry-run", "--s3cfg", "--s3cmd", "--base-url", "--metadata", "--id", "Exit codes"):
        assert word in out.output


def test_dry_run_lists_every_key_with_its_action_and_writes_nothing(run, meta_path, store):
    out = _invoke(str(run), "--metadata", str(meta_path), "--id", NEW, "--base-url", store.url, "--dry-run",
                  "--s3cfg", "/does/not/exist")           # a dry run needs no credentials
    assert out.exit_code == 0, out.output
    lines = [l for l in out.output.splitlines() if l.split(" ")[0] in ("copy", "upload", "skip")]
    n_files = sum(len(f) for _, _, f in os.walk(run / "wbm_init")) + sum(len(f) for _, _, f in os.walk(run / "wbm_output")) \
        + sum(len(f) for _, _, f in os.walk(run / "WBM_run_state"))
    assert len(lines) == 4 + n_files + 2
    assert sum(l.startswith("copy") for l in lines) == 4 and sum(l.startswith("upload") for l in lines) == n_files + 2
    assert f"upload  snapshots/{NEW}/metadata.json" in lines and lines[-1].endswith("/metadata.json")
    assert "plan: 4 copy," in out.output and "dry run" in out.output
    assert store.writes == [] and new_keys(store) == []


def test_dry_run_after_a_publish_is_all_skip(run, meta_path, store):
    go(run, meta_path, store)
    out = _invoke(str(run), "--metadata", str(meta_path), "--id", NEW, "--base-url", store.url, "--dry-run")
    assert out.exit_code == 0 and "0 copy, 0 upload" in out.output
    assert not any(l.startswith(("copy", "upload")) for l in out.output.splitlines())


def test_dry_run_reports_what_would_stop(run, meta_path, store):
    store.add(f"snapshots/{NEW}/WBM_run_state/a.dat", b"other", meta={"sha256": "0" * 64})
    out = _invoke(str(run), "--metadata", str(meta_path), "--id", NEW, "--base-url", store.url, "--dry-run")
    assert out.exit_code == pub.EXIT_OTHER_BYTES and "already holds other bytes" in out.output


def test_cli_exit_codes(run, meta_path, store, tmp_path, monkeypatch):
    cfg = tmp_path / "s3cfg"
    cfg.write_text("access_key = SECRET\nsecret_key = SECRET\n")
    monkeypatch.setattr(pub, "make_client", lambda exe, c, bucket: FakeS3(store))
    common = [str(run), "--metadata", str(meta_path), "--base-url", store.url, "--s3cfg", str(cfg), "--s3cmd", sys.executable]
    # no credentials
    out = _invoke(str(run), "--metadata", str(meta_path), "--base-url", store.url, "--s3cfg", str(tmp_path / "missing"))
    assert out.exit_code == pub.EXIT_NO_CREDENTIALS and store.writes == []
    # a real publish: the id is printed before the first key is written, and is the one that was written
    out = _invoke(*common, "--jobs", "1")
    assert out.exit_code == 0, out.output
    lines = out.output.splitlines()
    first_write = next(i for i, l in enumerate(lines) if l.startswith(("copy", "upload")))
    assert lines[0].startswith("snapshot id: ") and first_write > 0
    new_id = lines[0].split(": ")[1]
    assert f"published: snapshots/{new_id}/" in out.output and f"snapshots/{new_id}/metadata.json" in store.objects
    assert "SECRET" not in out.output
    # the same id again: everything is skipped
    out = _invoke(*common, "--id", new_id)
    assert out.exit_code == 0 and "0 copied, 0 uploaded" in out.output
    # other metadata under that id
    other = make_metadata(tmp_path, lambda m: m["about"].__setitem__("description", "changed"))
    out = _invoke(str(run), "--metadata", str(other), "--base-url", store.url, "--s3cfg", str(cfg),
                  "--s3cmd", sys.executable, "--id", new_id)
    assert out.exit_code == pub.EXIT_OTHER_BYTES
    # bad input
    out = _invoke(str(run), "--metadata", str(tmp_path / "nope.json"), "--base-url", store.url, "--dry-run")
    assert out.exit_code == pub.EXIT_BAD_INPUT


def test_the_readme_documents_every_exit_code():
    codes = {n: getattr(pub, n) for n in dir(pub) if n.startswith("EXIT_")}
    assert len(set(codes.values())) == len(codes) == 7
    readme = (__import__("pathlib").Path(__file__).parents[1] / "README.md").read_text()
    for name, code in codes.items():
        assert f"| {code} |" in readme, name
