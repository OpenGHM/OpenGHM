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
MI_ID = "1e" * 32
MI_PREFIX = f"model-inputs/{MI_ID}/"
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
        self.list_failures = []    # statuses the next listing requests are answered with, in order

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
                if bucket.list_failures:
                    return self._send(bucket.list_failures.pop(0), b"")
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

    def put_mi(self, rel, body: bytes, **kw):
        self.objects[MI_PREFIX + rel] = _Obj(body, **kw)

    def publish_model_input(self):
        """A model input the way ``model-input-spec`` lays it out: root files,
        ``data_init/``, and data directories, all hashed, ``metadata.json`` too."""
        hashed = {
            "metadata.json": (json.dumps({"id": MI_ID}).encode(), _MODE_REG),
            "data_init/climate/t2m.init": (b"{ File => 'climate/t2m/*.nc' }\n", _MODE_REG),
            "climate/t2m/2000-01-01.nc": (b"n" * 50, _MODE_REG),
            "network/flowdir.tif": (b"t" * 20, _MODE_REG),
        }
        for rel, (body, mode) in hashed.items():
            self.put_mi(rel, body, mode=mode)
        sums = "".join(f"{hashlib.sha256(b).hexdigest()}  ./{rel}\n"
                       for rel, (b, _m) in sorted(hashed.items()))
        self.put_mi("SHA256SUMS", sums.encode())
        return self

    def publish(self, *, image_body=b"pretend sif"):
        """Fill the bucket with a snapshot the way ``snapshot-layout.md`` lays it out."""
        hashed = {
            "model/wbm.pl": (b"#!/usr/bin/perl\nprint 1;\n", _MODE_EXE),
            "model/lib/RIMS.pm": (b"1;\n", _MODE_REG),
            "utilities/tool": (b"#!/bin/sh\n", _MODE_EXE),
            "wbm_init/wbm_test.init": (b"{ Output_dir => 'x' }\n", _MODE_REG),
            "gdal_test_files/a.nc": (b"a" * 100, _MODE_REG),
            # published trees still carry a copy of the model input; it is never fetched
            "data/sub/a.nc": (b"d" * 100, _MODE_REG),
            "data_init/old.init": (b"{}\n", _MODE_REG),
            "WBM_run_state/state.bin": (b"state", _MODE_REG),   # in SHA256SUMS, never fetched
        }
        meta = {
            "id": ID,
            "uses": {"container": {
                "image": "wbm-x-lite", "version": "1.0.0",
                "digest": "sha256:" + hashlib.sha256(image_body).hexdigest(),
                "https": f"{self.url}/{IMAGE_KEY}",
            }, "modelInput": {"id": MI_ID}},
        }
        hashed["metadata.json"] = (json.dumps(meta).encode(), _MODE_REG)
        for rel, (body, mode) in hashed.items():
            self.put(rel, body, mode=mode)
        sums = "".join(f"{hashlib.sha256(b).hexdigest()}  ./{rel}\n"
                       for rel, (b, _m) in sorted(hashed.items()))
        self.put("SHA256SUMS", sums.encode())
        # output is carried but has no SHA256SUMS line and is never fetched
        self.put("wbm_output/run/out.nc", b"output")
        # an old tree still lists its own spool/, unhashed; it is never fetched
        self.put("spool/plain.bin", b"spool bytes")
        self.put("spool/big/multi.bin", b"multipart", etag="d41d8cd98f00b204e9800998ecf8427e-3")
        self.objects[IMAGE_KEY] = _Obj(image_body)
        return self


@pytest.fixture
def bucket(monkeypatch):
    monkeypatch.setattr(fetch, "_BACKOFF", 0.0)
    b = Bucket()
    yield b.publish().publish_model_input()
    b.close()


def _cfg(tmp_path) -> Config:
    return Config(sif_dir=str(tmp_path / "sif"), model_input_dir=str(tmp_path / "mi"))


def _run(bucket, tmp_path, **kw):
    kw.setdefault("dest", str(tmp_path / "snap"))
    kw.setdefault("model_input", False)   # the model input has its own tests below
    opts = fetch.FetchOptions(snapshot_id=ID, base_url=bucket.url, **kw)
    return fetch.fetch_snapshot(opts, _cfg(tmp_path))


def _image_path(tmp_path) -> Path:
    return tmp_path / "sif" / "wbm-x-lite" / "1.0.0" / "wbm-x-lite-1.0.0.sif"


# ── what is fetched ───────────────────────────────────────────────────────────


def test_fetch_downloads_tree_and_image(bucket, tmp_path):
    result = _run(bucket, tmp_path)
    snap = tmp_path / "snap"
    assert result.ok, result.failed
    # 6 of the 7 hashed files (WBM_run_state is not fetched) + SHA256SUMS + image
    assert (result.downloaded, result.skipped) == (5 + 2 + 1, 0)
    assert bucket.lists > 1                       # the listing was paginated
    assert (snap / "model" / "wbm.pl").read_bytes().startswith(b"#!/usr/bin/perl")
    assert (snap / "gdal_test_files" / "a.nc").read_bytes() == b"a" * 100
    assert not (snap / "WBM_run_state").exists()
    # wbm_output/ is there, as the layout requires, but its contents are not
    assert (snap / "wbm_output").is_dir() and not any((snap / "wbm_output").iterdir())
    assert (snap / "metadata.json").exists() and (snap / "SHA256SUMS").exists()
    assert not list(snap.rglob("*.part"))
    assert result.image_path == str(_image_path(tmp_path))
    assert _image_path(tmp_path).read_bytes() == b"pretend sif"
    assert fetch.summary_line(result).startswith("downloaded 8, skipped 0, failed 0")


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


def test_a_spool_in_the_listing_is_not_downloaded(bucket, tmp_path):
    # an old snapshot tree still lists spool/...; a spool belongs to the model input
    assert PREFIX + "spool/plain.bin" in bucket.objects and PREFIX + "spool/big/multi.bin" in bucket.objects
    result = _run(bucket, tmp_path)
    assert result.ok, result.failed
    assert not (tmp_path / "snap" / "spool").exists()
    assert not any("spool/" in k for k in bucket.gets)
    assert not hasattr(result, "spool")


def test_data_and_data_init_are_not_fetched_even_if_published(bucket, tmp_path):
    result = _run(bucket, tmp_path)
    snap = tmp_path / "snap"
    assert result.ok, result.failed
    assert not (snap / "data").exists() and not (snap / "data_init").exists()
    assert not any(k.startswith((PREFIX + "data/", PREFIX + "data_init/")) for k in bucket.gets)
    # an unhashed stray under data/ is ignored too, not reported
    bucket.put("data/sub/stray.nc", b"stray")
    assert _run(bucket, tmp_path).ok


# ── integrity ──────────────────────────────────────────────────────────────────


def test_sha256sums_mismatch_fails_and_leaves_no_file(bucket, tmp_path):
    bucket.objects[PREFIX + "gdal_test_files/a.nc"].body = b"b" * 100   # same size, other bytes
    result = _run(bucket, tmp_path)
    assert not result.ok
    assert [p for p, _ in result.failed] == ["gdal_test_files/a.nc"]
    assert "sha256" in result.failed[0][1]
    snap = tmp_path / "snap"
    assert not (snap / "gdal_test_files" / "a.nc").exists() and not list(snap.rglob("*.part"))
    assert (snap / "model" / "wbm.pl").exists()        # the others were still fetched


def test_a_wrong_size_fails(bucket, tmp_path, monkeypatch):
    # the object serves 99 bytes; the listing says 100
    bucket.objects[PREFIX + "gdal_test_files/a.nc"].body = b"a" * 99
    real = fetch.list_objects
    monkeypatch.setattr(fetch, "list_objects", lambda base, prefix: [
        (k, 100 if k.endswith("a.nc") else size, etag) for k, size, etag in real(base, prefix)])
    result = _run(bucket, tmp_path)
    assert [p for p, _ in result.failed] == ["gdal_test_files/a.nc"]
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


def test_unhashed_object_fails(bucket, tmp_path):
    bucket.put("gdal_test_files/extra.nc", b"stray")
    result = _run(bucket, tmp_path)
    assert [p for p, _ in result.failed] == ["gdal_test_files/extra.nc"]
    assert "SHA256SUMS" in result.failed[0][1]
    assert not (tmp_path / "snap" / "gdal_test_files" / "extra.nc").exists()


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


def test_a_transient_listing_error_is_retried(bucket, tmp_path):
    bucket.list_failures = [503, 500]
    assert _run(bucket, tmp_path).ok
    assert (tmp_path / "snap" / "model" / "wbm.pl").exists()


def test_a_listing_that_keeps_failing_gives_up_after_a_few_attempts(bucket):
    bucket.list_failures = [503] * 10
    with pytest.raises(OpenghmError, match="HTTP 503"):
        fetch.list_objects(bucket.url, PREFIX)
    assert bucket.lists == fetch._ATTEMPTS


@pytest.mark.parametrize("status", [403, 404])
def test_a_listing_refusal_is_not_retried(bucket, status):
    bucket.list_failures = [status, 200, 200]
    with pytest.raises(OpenghmError, match=f"HTTP {status}"):
        fetch.list_objects(bucket.url, PREFIX)
    assert bucket.lists == 1


def test_an_unreachable_listing_is_retried_then_reported(monkeypatch):
    calls = []

    def refuse(url):
        calls.append(url)
        raise fetch._TransientError("cannot reach " + url)
    monkeypatch.setattr(fetch, "_open", refuse)
    monkeypatch.setattr(fetch, "_BACKOFF", 0.0)
    with pytest.raises(OpenghmError, match="cannot reach"):
        fetch.list_objects("http://127.0.0.1:9/openghm", PREFIX)
    assert len(calls) == fetch._ATTEMPTS


# ── resume ─────────────────────────────────────────────────────────────────────


def test_a_second_run_downloads_nothing(bucket, tmp_path):
    first = _run(bucket, tmp_path)
    bucket.gets.clear()
    second = _run(bucket, tmp_path)
    assert second.ok and second.downloaded == 0 and second.skipped == first.downloaded
    assert bucket.gets == []
    assert fetch.summary_line(second).startswith("downloaded 0, skipped 8, failed 0")


def test_resume_refetches_only_what_is_not_valid(bucket, tmp_path):
    _run(bucket, tmp_path)
    snap = tmp_path / "snap"
    (snap / "gdal_test_files" / "a.nc").write_bytes(b"z" * 100)     # right size, wrong hash
    (snap / "utilities" / "tool").write_bytes(b"short")          # wrong size
    (snap / "model" / "lib" / "RIMS.pm").unlink()                # missing
    (snap / "model" / "wbm.pl.part").write_bytes(b"half")        # a killed run's leftover
    bucket.gets.clear()
    result = _run(bucket, tmp_path)
    assert result.ok and result.downloaded == 3
    assert sorted(bucket.gets) == sorted(PREFIX + r for r in
                                         ("gdal_test_files/a.nc", "utilities/tool", "model/lib/RIMS.pm"))
    assert (snap / "gdal_test_files" / "a.nc").read_bytes() == b"a" * 100


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


# ── the model input ────────────────────────────────────────────────────────────


def _mi_dir(tmp_path) -> Path:
    return tmp_path / "mi" / MI_ID


def test_snapshot_fetch_also_fetches_the_linked_model_input(bucket, tmp_path):
    result = _run(bucket, tmp_path, model_input=True)
    mi = _mi_dir(tmp_path)
    assert result.ok, result.failed
    # 8 for the snapshot + its image, and the model input's 4 files + SHA256SUMS
    assert (result.downloaded, result.skipped) == (8 + 5, 0)
    assert result.model_input_path == str(mi)
    assert (mi / "climate" / "t2m" / "2000-01-01.nc").read_bytes() == b"n" * 50
    assert (mi / "data_init" / "climate" / "t2m.init").exists()
    assert (mi / "metadata.json").exists() and (mi / "SHA256SUMS").exists()
    assert not list(mi.rglob("*.part"))
    # the input is in the cache, not in the snapshot
    assert not (tmp_path / "snap" / "data").exists()


def test_no_model_input_leaves_it_out(bucket, tmp_path):
    result = _run(bucket, tmp_path, model_input=False)
    assert result.ok and result.model_input_path is None
    assert not (tmp_path / "mi").exists()
    assert not any(k.startswith(MI_PREFIX) for k in bucket.gets)


def test_a_shared_model_input_downloads_once(bucket, tmp_path):
    first = _run(bucket, tmp_path, model_input=True)
    bucket.gets.clear()
    other = _run(bucket, tmp_path, model_input=True, dest=str(tmp_path / "snap2"))
    assert other.ok
    assert not any(k.startswith(MI_PREFIX) for k in bucket.gets)
    # the second snapshot's tree downloads; the input (5 files) and the image are skipped
    assert other.skipped == 5 + 1 and other.downloaded == first.downloaded - 5 - 1


def test_a_model_input_file_with_a_wrong_hash_fails(bucket, tmp_path):
    bucket.objects[MI_PREFIX + "climate/t2m/2000-01-01.nc"].body = b"m" * 50
    result = _run(bucket, tmp_path, model_input=True)
    assert [p for p, _ in result.failed] == [f"model-inputs/{MI_ID}/climate/t2m/2000-01-01.nc"]
    assert "sha256" in result.failed[0][1]
    assert result.model_input_path is None
    assert (tmp_path / "snap" / "model" / "wbm.pl").exists()   # the snapshot is still there


def test_a_missing_model_input_is_a_failure_not_a_crash(bucket, tmp_path):
    for k in [k for k in bucket.objects if k.startswith(MI_PREFIX)]:
        del bucket.objects[k]
    result = _run(bucket, tmp_path, model_input=True)
    assert [p for p, _ in result.failed] == [f"model input {MI_ID}"]
    assert "nothing under" in result.failed[0][1]
    assert (tmp_path / "snap" / "model" / "wbm.pl").exists()


def test_a_snapshot_with_no_model_input_link_is_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr(fetch, "_BACKOFF", 0.0)
    b = Bucket().publish()
    try:
        meta = json.loads(b.objects[PREFIX + "metadata.json"].body)
        del meta["uses"]["modelInput"]
        body = json.dumps(meta).encode()
        b.put("metadata.json", body)
        sums = b.objects[PREFIX + "SHA256SUMS"].body.decode().splitlines()
        sums = [f"{hashlib.sha256(body).hexdigest()}  ./metadata.json" if l.endswith("./metadata.json") else l
                for l in sums]
        b.put("SHA256SUMS", ("\n".join(sums) + "\n").encode())
        with pytest.raises(OpenghmError, match="uses.modelInput.id"):
            _run(b, tmp_path, model_input=True)
        assert _run(b, tmp_path, model_input=False).ok
    finally:
        b.close()


def _fetch_mi(bucket, tmp_path, **kw):
    opts = fetch.ModelInputOptions(model_input_id=MI_ID, base_url=bucket.url, **kw)
    return fetch.fetch_model_input(opts, _cfg(tmp_path))


def test_model_input_fetch_defaults_to_the_cache(bucket, tmp_path):
    result = _fetch_mi(bucket, tmp_path)
    assert result.ok and (result.downloaded, result.skipped) == (5, 0)
    assert result.dest == result.model_input_path == str(_mi_dir(tmp_path))
    assert (_mi_dir(tmp_path) / "network" / "flowdir.tif").read_bytes() == b"t" * 20
    assert fetch.summary_line(result).startswith("downloaded 5, skipped 0, failed 0")
    again = _fetch_mi(bucket, tmp_path)
    assert (again.downloaded, again.skipped) == (0, 5)


def test_model_input_fetch_to_a_dest(bucket, tmp_path):
    result = _fetch_mi(bucket, tmp_path, dest=str(tmp_path / "elsewhere"))
    assert result.ok and (tmp_path / "elsewhere" / "data_init" / "climate" / "t2m.init").exists()
    assert not (tmp_path / "mi").exists()


def test_model_input_fetch_fetches_every_directory(bucket, tmp_path):
    # no directory is excluded, not even one named like a snapshot's
    bucket.put_mi("data/extra.nc", b"x")
    bucket.put_mi("spool/s.bin", b"y")
    sums = bucket.objects[MI_PREFIX + "SHA256SUMS"].body.decode()
    sums += f"{hashlib.sha256(b'x').hexdigest()}  ./data/extra.nc\n{hashlib.sha256(b'y').hexdigest()}  ./spool/s.bin\n"
    bucket.put_mi("SHA256SUMS", sums.encode())
    result = _fetch_mi(bucket, tmp_path)
    assert result.ok, result.failed
    assert (_mi_dir(tmp_path) / "data" / "extra.nc").exists() and (_mi_dir(tmp_path) / "spool" / "s.bin").exists()


def test_model_input_fetch_errors(bucket, tmp_path):
    with pytest.raises(OpenghmError, match="nothing under model-inputs/"):
        fetch.fetch_model_input(
            fetch.ModelInputOptions(model_input_id="ab" * 32, base_url=bucket.url), _cfg(tmp_path))
    with pytest.raises(OpenghmError, match="not a model input id"):
        fetch.fetch_model_input(fetch.ModelInputOptions(model_input_id="../x", base_url=bucket.url),
                                _cfg(tmp_path))
    # a snapshot id is not a model input id: nothing lives under that prefix
    with pytest.raises(OpenghmError, match="nothing under"):
        fetch.fetch_model_input(fetch.ModelInputOptions(model_input_id=ID, base_url=bucket.url), _cfg(tmp_path))


def test_model_input_fetch_reports_a_bad_file(bucket, tmp_path):
    bucket.objects[MI_PREFIX + "network/flowdir.tif"].body = b"u" * 20
    result = _fetch_mi(bucket, tmp_path)
    assert [p for p, _ in result.failed] == ["network/flowdir.tif"]
    assert result.model_input_path is None
    assert not (_mi_dir(tmp_path) / "network" / "flowdir.tif").exists()


# ── the command ────────────────────────────────────────────────────────────────


def test_cli_fetch_help():
    out = CliRunner().invoke(cli, ["snapshot", "fetch", "--help"])
    assert out.exit_code == 0
    for flag in ("--dest", "--no-image", "--no-model-input", "--jobs"):
        assert flag in out.output


def _invoke(bucket, tmp_path, monkeypatch, *args):
    monkeypatch.setattr(fetch, "S3_BASE", bucket.url)
    cfg = tmp_path / "config.toml"
    cfg.write_text(f'sif_dir = "{tmp_path / "sif"}"\nmodel_input_dir = "{tmp_path / "mi"}"\n')
    return CliRunner().invoke(
        cli, ["snapshot", "fetch", ID, "--config", str(cfg), "--dest", str(tmp_path / "snap"), *args])


def test_cli_fetch_reports_and_exits_0(bucket, tmp_path, monkeypatch):
    out = _invoke(bucket, tmp_path, monkeypatch, "--jobs", "2", "--no-model-input")
    assert out.exit_code == 0, out.output
    assert "downloaded 8, skipped 0, failed 0" in out.output
    assert "spool" not in out.output and str(_image_path(tmp_path)) in out.output
    assert "model input:" not in out.output and not (tmp_path / "mi").exists()


def test_cli_fetch_prints_no_progress_counter_when_stderr_is_not_a_tty(bucket, tmp_path, monkeypatch):
    # A batch job's stderr is a file: the counter would be thousands of lines
    # of noise, and the summary line already reports the result.
    out = _invoke(bucket, tmp_path, monkeypatch, "--jobs", "2")
    assert out.exit_code == 0, out.output
    assert " files" not in out.output
    assert "downloaded 13, skipped 0, failed 0" in out.output
    out = CliRunner().invoke(
        cli, ["model-input", "fetch", MI_ID, "--config", str(tmp_path / "config.toml"),
              "--dest", str(tmp_path / "there")])
    assert out.exit_code == 0 and "/5 files" not in out.output


def test_cli_fetch_keeps_the_progress_counter_on_a_tty(bucket, tmp_path, monkeypatch):
    import click.testing

    # CliRunner's stderr is never a terminal; make it look like one.
    monkeypatch.setattr(click.testing._NamedTextIOWrapper, "isatty", lambda self: True)
    out = _invoke(bucket, tmp_path, monkeypatch, "--jobs", "2", "--no-model-input")
    assert out.exit_code == 0, out.output
    assert "5/5 files" in out.output


def test_cli_fetch_includes_the_model_input_by_default(bucket, tmp_path, monkeypatch):
    out = _invoke(bucket, tmp_path, monkeypatch, "--jobs", "2")
    assert out.exit_code == 0, out.output
    assert "downloaded 13, skipped 0, failed 0" in out.output
    assert f"model input: {_mi_dir(tmp_path)}" in out.output
    assert (_mi_dir(tmp_path) / "data_init" / "climate" / "t2m.init").exists()
    assert not (tmp_path / "snap" / "data").exists()


def test_cli_model_input_fetch(bucket, tmp_path, monkeypatch):
    monkeypatch.setattr(fetch, "S3_BASE", bucket.url)
    cfg = tmp_path / "config.toml"
    cfg.write_text(f'model_input_dir = "{tmp_path / "mi"}"\n')
    out = CliRunner().invoke(cli, ["model-input", "fetch", MI_ID, "--config", str(cfg), "--jobs", "2"])
    assert out.exit_code == 0, out.output
    assert f"model input: {_mi_dir(tmp_path)}" in out.output
    assert "downloaded 5, skipped 0, failed 0" in out.output
    out = CliRunner().invoke(cli, ["model-input", "fetch", MI_ID, "--config", str(cfg),
                                   "--dest", str(tmp_path / "there")])
    assert out.exit_code == 0 and f"model input: {tmp_path / 'there'}" in out.output
    assert (tmp_path / "there" / "metadata.json").exists()


def test_cli_model_input_fetch_errors(bucket, tmp_path, monkeypatch):
    monkeypatch.setattr(fetch, "S3_BASE", bucket.url)
    cfg = tmp_path / "config.toml"
    cfg.write_text(f'model_input_dir = "{tmp_path / "mi"}"\n')
    out = CliRunner().invoke(cli, ["model-input", "fetch", "ab" * 32, "--config", str(cfg)])
    assert out.exit_code == 2 and "nothing under model-inputs/" in out.output
    bucket.objects[MI_PREFIX + "network/flowdir.tif"].body = b"u" * 20
    out = CliRunner().invoke(cli, ["model-input", "fetch", MI_ID, "--config", str(cfg)])
    assert out.exit_code == 1 and "failed 1" in out.output and "network/flowdir.tif" in out.output


def test_cli_fetch_exits_1_and_lists_failures(bucket, tmp_path, monkeypatch):
    bucket.objects[PREFIX + "gdal_test_files/a.nc"].body = b"b" * 100
    out = _invoke(bucket, tmp_path, monkeypatch, "--no-image")
    assert out.exit_code == 1
    assert "failed 1" in out.output and "gdal_test_files/a.nc" in out.output
