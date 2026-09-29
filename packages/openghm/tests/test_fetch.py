"""``snapshot fetch`` against a local HTTP server that plays the bucket.

The fixture serves what the real one does, to the extent fetch depends on it:
anonymous ListObjectsV2 XML (paginated, with quoted ETags and a continuation
token) at ``/openghm?list-type=2``, and object GETs at ``/openghm/<key>`` carrying
``x-amz-meta-s3cmd-attrs`` and an ETag.
"""

from __future__ import annotations

import hashlib
import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from xml.sax.saxutils import escape

import pytest
from click.testing import CliRunner

from openghm import Config, fetch
from openghm.cli.main import cli
from openghm.errors import OpenghmError

ID = "0f" * 32
PREFIX = f"snapshots/{ID}/"
IMAGE_KEY = "containers/wbm-x-lite/1.0.0/wbm-x-lite-1.0.0.sif"
PAGE = 3   # keys per listing page, so a tree this size takes several requests

_MODE_EXE = 0o100755
_MODE_REG = 0o100644


def _attrs(mode: int) -> str:
    return f"atime:1/ctime:2/gid:1000/gname:x/md5:00/mode:{mode}/mtime:3/uid:1000/uname:x"


class _Obj:
    def __init__(self, body: bytes, mode=_MODE_REG, etag=None):
        self.body, self.mode = body, mode
        self.etag = etag if etag is not None else hashlib.md5(body).hexdigest()


class Bucket:
    """A tiny fake bucket behind a threaded HTTP server."""

    def __init__(self):
        self.objects = {}          # key -> _Obj
        self.gets = []             # keys fetched, in order
        self.lists = 0
        self.fail_once = set()     # keys answered 503 the first time

        bucket = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):  # quiet
                pass

            def do_GET(self):
                url = urllib.parse.urlsplit(self.path)
                q = urllib.parse.parse_qs(url.query)
                if url.path == "/openghm":
                    return self._list(q)
                key = urllib.parse.unquote(url.path[len("/openghm/"):])
                obj = bucket.objects.get(key)
                if obj is None:
                    return self._send(404, b"")
                if key in bucket.fail_once:
                    bucket.fail_once.discard(key)
                    return self._send(503, b"")
                bucket.gets.append(key)
                headers = {"ETag": f'"{obj.etag}"'}
                if obj.mode is not None:
                    headers["x-amz-meta-s3cmd-attrs"] = _attrs(obj.mode)
                self._send(200, obj.body, headers)

            def _list(self, q):
                bucket.lists += 1
                prefix = q.get("prefix", [""])[0]
                token = q.get("continuation-token", [""])[0]
                keys = sorted(k for k in bucket.objects if k.startswith(prefix))
                start = int(token) if token else 0
                page = keys[start:start + PAGE]
                more = start + PAGE < len(keys)
                xml = ['<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
                       "<Name>openghm</Name>", f"<IsTruncated>{str(more).lower()}</IsTruncated>"]
                for k in page:
                    o = bucket.objects[k]
                    xml.append(f"<Contents><Key>{escape(k)}</Key><Size>{len(o.body)}</Size>"
                               f'<ETag>&quot;{o.etag}&quot;</ETag></Contents>')
                if more:
                    xml.append(f"<NextContinuationToken>{start + PAGE}</NextContinuationToken>")
                xml.append("</ListBucketResult>")
                self._send(200, "".join(xml).encode(), {"Content-Type": "application/xml"})

            def _send(self, code, body, headers=None):
                self.send_response(code)
                self.send_header("Content-Length", str(len(body)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/openghm"
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.01), daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def put(self, rel, body: bytes, **kw):
        self.objects[PREFIX + rel] = _Obj(body, **kw)

    def publish(self, *, spool=True, image_body=b"pretend sif"):
        """Fill the bucket with a snapshot the way ``snapshot-layout.md`` lays it out."""
        hashed = {
            "model/wbm.pl": (b"#!/usr/bin/perl\nprint 1;\n", _MODE_EXE),
            "model/lib/RIMS.pm": (b"1;\n", _MODE_REG),
            "utilities/tool": (b"#!/bin/sh\n", _MODE_EXE),
            "wbm_init/wbm_test.init": (b"{ Output_dir => 'x' }\n", _MODE_REG),
            "data/sub/a.nc": (b"a" * 100, _MODE_REG),
            "WBM_run_state/state.bin": (b"state", _MODE_REG),   # in SHA256SUMS, never fetched
        }
        meta = {
            "id": ID,
            "uses": {"container": {
                "image": "wbm-x-lite", "version": "1.0.0",
                "digest": "sha256:" + hashlib.sha256(image_body).hexdigest(),
                "https": f"{self.url}/{IMAGE_KEY}",
            }},
        }
        hashed["metadata.json"] = (json.dumps(meta).encode(), _MODE_REG)
        for rel, (body, mode) in hashed.items():
            self.put(rel, body, mode=mode)
        sums = "".join(f"{hashlib.sha256(b).hexdigest()}  ./{rel}\n"
                       for rel, (b, _m) in sorted(hashed.items()))
        self.put("SHA256SUMS", sums.encode())
        # output is carried but has no SHA256SUMS line and is never fetched
        self.put("wbm_output/run/out.nc", b"output")
        if spool:
            self.put("spool/plain.bin", b"spool bytes")                       # plain-MD5 ETag
            self.put("spool/big/multi.bin", b"multipart", etag="d41d8cd98f00b204e9800998ecf8427e-3")
        self.objects[IMAGE_KEY] = _Obj(image_body)
        return self


@pytest.fixture
def bucket(monkeypatch):
    monkeypatch.setattr(fetch, "_BACKOFF", 0.0)
    b = Bucket()
    yield b.publish()
    b.close()


def _cfg(tmp_path) -> Config:
    return Config(sif_dir=str(tmp_path / "sif"))


def _run(bucket, tmp_path, **kw):
    kw.setdefault("dest", str(tmp_path / "snap"))
    opts = fetch.FetchOptions(snapshot_id=ID, base_url=bucket.url, **kw)
    return fetch.fetch_snapshot(opts, _cfg(tmp_path))


def _image_path(tmp_path) -> Path:
    return tmp_path / "sif" / "wbm-x-lite" / "1.0.0" / "wbm-x-lite-1.0.0.sif"


# ── what is fetched ───────────────────────────────────────────────────────────


def test_fetch_auto_downloads_tree_spool_and_image(bucket, tmp_path):
    result = _run(bucket, tmp_path)
    snap = tmp_path / "snap"
    assert result.ok, result.failed
    # 6 of the 7 hashed files (WBM_run_state is not fetched) + SHA256SUMS + 2 spool + image
    assert (result.downloaded, result.skipped) == (5 + 2 + 2 + 1, 0)
    assert bucket.lists > 1                       # the listing was paginated
    assert (snap / "model" / "wbm.pl").read_bytes().startswith(b"#!/usr/bin/perl")
    assert (snap / "data" / "sub" / "a.nc").read_bytes() == b"a" * 100
    assert not (snap / "WBM_run_state").exists()
    # wbm_output/ is there, as the layout requires, but its contents are not
    assert (snap / "wbm_output").is_dir() and not any((snap / "wbm_output").iterdir())
    assert (snap / "spool" / "plain.bin").read_bytes() == b"spool bytes"
    assert (snap / "spool" / "big" / "multi.bin").exists()
    assert (snap / "metadata.json").exists() and (snap / "SHA256SUMS").exists()
    assert not list(snap.rglob("*.part"))
    assert (result.spool, result.spool_files) == ("fetched", 2)
    assert result.image_path == str(_image_path(tmp_path))
    assert _image_path(tmp_path).read_bytes() == b"pretend sif"
    assert fetch.summary_line(result).startswith("downloaded 10, skipped 0, failed 0")


def test_the_fetched_tree_has_the_wbm_output_the_layout_requires(bucket, tmp_path):
    from openghm import spec
    _run(bucket, tmp_path)
    layout = spec.validate_layout(tmp_path / "snap", spec="snapshot-spec")
    # the fixture bucket has no data_init/ or gdal_test_files/; wbm_output/ is
    # the one directory fetch itself is responsible for
    assert "wbm_output/" not in layout.missing_required


def test_modes_come_from_the_object_metadata(bucket, tmp_path):
    _run(bucket, tmp_path)
    snap = tmp_path / "snap"
    assert (snap / "model" / "wbm.pl").stat().st_mode & 0o777 == 0o755
    assert (snap / "utilities" / "tool").stat().st_mode & 0o777 == 0o755
    assert (snap / "model" / "lib" / "RIMS.pm").stat().st_mode & 0o777 == 0o644


def test_spool_skip_leaves_it_out(bucket, tmp_path):
    result = _run(bucket, tmp_path, spool="skip")
    assert result.ok and result.spool == "skipped"
    assert not (tmp_path / "snap" / "spool").exists()
    assert not any("spool/" in k for k in bucket.gets)


def test_spool_auto_when_the_snapshot_has_none(tmp_path, monkeypatch):
    monkeypatch.setattr(fetch, "_BACKOFF", 0.0)
    b = Bucket().publish(spool=False)
    try:
        result = _run(b, tmp_path)
    finally:
        b.close()
    assert result.ok and result.spool == "absent"
    assert not (tmp_path / "snap" / "spool").exists()


def test_spool_is_checked_by_md5_when_the_etag_is_one(bucket, tmp_path):
    bucket.objects[PREFIX + "spool/plain.bin"].body = b"spool BYTES"   # same size, wrong MD5
    result = _run(bucket, tmp_path)
    assert [p for p, _ in result.failed] == ["spool/plain.bin"]
    assert "md5" in result.failed[0][1]
    assert not (tmp_path / "snap" / "spool" / "plain.bin").exists()
    assert (tmp_path / "snap" / "spool" / "big" / "multi.bin").exists()   # multipart: size only


# ── integrity ──────────────────────────────────────────────────────────────────


def test_sha256sums_mismatch_fails_and_leaves_no_file(bucket, tmp_path):
    bucket.objects[PREFIX + "data/sub/a.nc"].body = b"b" * 100   # same size, other bytes
    result = _run(bucket, tmp_path)
    assert not result.ok
    assert [p for p, _ in result.failed] == ["data/sub/a.nc"]
    assert "sha256" in result.failed[0][1]
    snap = tmp_path / "snap"
    assert not (snap / "data" / "sub" / "a.nc").exists() and not list(snap.rglob("*.part"))
    assert (snap / "model" / "wbm.pl").exists()        # the others were still fetched


def test_a_wrong_size_fails(bucket, tmp_path, monkeypatch):
    # the object serves 99 bytes; the listing says 100
    bucket.objects[PREFIX + "data/sub/a.nc"].body = b"a" * 99
    real = fetch.list_objects
    monkeypatch.setattr(fetch, "list_objects", lambda base, prefix: [
        (k, 100 if k.endswith("a.nc") else size, etag) for k, size, etag in real(base, prefix)])
    result = _run(bucket, tmp_path)
    assert [p for p, _ in result.failed] == ["data/sub/a.nc"]
    assert "size 99" in result.failed[0][1]


def test_missing_mode_fails(bucket, tmp_path):
    bucket.objects[PREFIX + "model/lib/RIMS.pm"].mode = None
    result = _run(bucket, tmp_path)
    assert [p for p, _ in result.failed] == ["model/lib/RIMS.pm"]
    assert "mode" in result.failed[0][1]
    assert not (tmp_path / "snap" / "model" / "lib" / "RIMS.pm").exists()


def test_sums_line_without_an_object_fails(bucket, tmp_path):
    del bucket.objects[PREFIX + "utilities/tool"]
    result = _run(bucket, tmp_path)
    assert [p for p, _ in result.failed] == ["utilities/tool"]
    assert "not in the bucket" in result.failed[0][1]


def test_unhashed_object_outside_spool_fails(bucket, tmp_path):
    bucket.put("data/sub/extra.nc", b"stray")
    result = _run(bucket, tmp_path)
    assert [p for p, _ in result.failed] == ["data/sub/extra.nc"]
    assert "SHA256SUMS" in result.failed[0][1]
    assert not (tmp_path / "snap" / "data" / "sub" / "extra.nc").exists()


def test_unknown_snapshot_and_bad_id(bucket, tmp_path):
    with pytest.raises(OpenghmError, match="nothing under"):
        fetch.fetch_snapshot(
            fetch.FetchOptions(snapshot_id="ab" * 32, base_url=bucket.url, dest=str(tmp_path / "x")),
            _cfg(tmp_path))
    with pytest.raises(OpenghmError, match="not a snapshot id"):
        fetch.fetch_snapshot(fetch.FetchOptions(snapshot_id="../x", base_url=bucket.url), _cfg(tmp_path))


def test_a_transient_server_error_is_retried(bucket, tmp_path):
    bucket.fail_once.add(PREFIX + "model/wbm.pl")
    assert _run(bucket, tmp_path).ok
    assert (tmp_path / "snap" / "model" / "wbm.pl").exists()


# ── resume ─────────────────────────────────────────────────────────────────────


def test_a_second_run_downloads_nothing(bucket, tmp_path):
    first = _run(bucket, tmp_path)
    bucket.gets.clear()
    second = _run(bucket, tmp_path)
    assert second.ok and second.downloaded == 0 and second.skipped == first.downloaded
    assert bucket.gets == []
    assert fetch.summary_line(second).startswith("downloaded 0, skipped 10, failed 0")


def test_resume_refetches_only_what_is_not_valid(bucket, tmp_path):
    _run(bucket, tmp_path)
    snap = tmp_path / "snap"
    (snap / "data" / "sub" / "a.nc").write_bytes(b"z" * 100)     # right size, wrong hash
    (snap / "spool" / "plain.bin").write_bytes(b"short")         # wrong size
    (snap / "model" / "lib" / "RIMS.pm").unlink()                # missing
    (snap / "model" / "wbm.pl.part").write_bytes(b"half")        # a killed run's leftover
    bucket.gets.clear()
    result = _run(bucket, tmp_path)
    assert result.ok and result.downloaded == 3
    assert sorted(bucket.gets) == sorted(PREFIX + r for r in
                                         ("data/sub/a.nc", "spool/plain.bin", "model/lib/RIMS.pm"))
    assert (snap / "data" / "sub" / "a.nc").read_bytes() == b"a" * 100


# ── image ──────────────────────────────────────────────────────────────────────


def test_no_image_skips_it(bucket, tmp_path):
    result = _run(bucket, tmp_path, image=False)
    assert result.ok and result.image_path is None
    assert IMAGE_KEY not in bucket.gets
    assert not (tmp_path / "sif").exists()


def test_image_digest_mismatch_fails(bucket, tmp_path):
    bucket.objects[IMAGE_KEY].body = b"tampered sif"
    result = _run(bucket, tmp_path)
    assert [p for p, _ in result.failed] == ["image wbm-x-lite:1.0.0"]
    assert "checksum mismatch" in result.failed[0][1]
    assert result.image_path is None and not _image_path(tmp_path).exists()
    assert not list((tmp_path / "sif").rglob("*.part"))
    assert (tmp_path / "snap" / "model" / "wbm.pl").exists()   # the tree is still there


def test_a_cached_image_is_not_downloaded_again(bucket, tmp_path):
    _run(bucket, tmp_path)
    bucket.gets.clear()
    result = _run(bucket, tmp_path)
    assert IMAGE_KEY not in bucket.gets and result.image_path


# ── the command ────────────────────────────────────────────────────────────────


def test_cli_fetch_help():
    out = CliRunner().invoke(cli, ["snapshot", "fetch", "--help"])
    assert out.exit_code == 0
    for flag in ("--dest", "--spool", "--no-image", "--jobs"):
        assert flag in out.output


def _invoke(bucket, tmp_path, monkeypatch, *args):
    monkeypatch.setattr(fetch, "S3_BASE", bucket.url)
    cfg = tmp_path / "config.toml"
    cfg.write_text(f'sif_dir = "{tmp_path / "sif"}"\n')
    return CliRunner().invoke(
        cli, ["snapshot", "fetch", ID, "--config", str(cfg), "--dest", str(tmp_path / "snap"), *args])


def test_cli_fetch_reports_and_exits_0(bucket, tmp_path, monkeypatch):
    out = _invoke(bucket, tmp_path, monkeypatch, "--jobs", "2")
    assert out.exit_code == 0, out.output
    assert "downloaded 10, skipped 0, failed 0" in out.output
    assert "spool: 2 files" in out.output and str(_image_path(tmp_path)) in out.output


def test_cli_fetch_exits_1_and_lists_failures(bucket, tmp_path, monkeypatch):
    bucket.objects[PREFIX + "data/sub/a.nc"].body = b"b" * 100
    out = _invoke(bucket, tmp_path, monkeypatch, "--spool", "skip", "--no-image")
    assert out.exit_code == 1
    assert "failed 1" in out.output and "data/sub/a.nc" in out.output
