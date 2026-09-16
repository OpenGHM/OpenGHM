"""Container image acquisition — manifest parsing, cache paths, sizes."""

from __future__ import annotations

import io
import json

import pytest

from openghm import Config
from openghm import assets
from openghm.errors import OpenghmError


def test_human_bytes():
    assert assets.human_bytes(None) == "unknown size"
    assert assets.human_bytes(512) == "512 B"
    assert assets.human_bytes(317 * 1024 * 1024) == "317 MB"
    assert assets.human_bytes(1_944_821_760).endswith("GB")


def test_resolve_spec_builtin_and_unknown():
    lite = assets.resolve_spec("lite", assets.BUILTIN_MANIFEST)
    assert lite.filename == "wbm_tools_lite.sif" and lite.kind == "lite"
    v2 = assets.resolve_spec("2.0.0", assets.BUILTIN_MANIFEST)
    assert v2.kind == "wbm" and v2.size == 1_944_821_760
    with pytest.raises(OpenghmError, match="unknown image"):
        assets.resolve_spec("9.9.9", assets.BUILTIN_MANIFEST)


def test_cache_path_lite_and_wbm(tmp_path):
    cfg = Config(sif_dir=str(tmp_path / "sif"))
    lite = assets.resolve_spec("lite", assets.BUILTIN_MANIFEST)
    v2 = assets.resolve_spec("2.0.0", assets.BUILTIN_MANIFEST)
    assert assets.cache_path(cfg, lite) == str(tmp_path / "sif" / "lite" / "wbm_tools_lite.sif")
    assert assets.cache_path(cfg, v2) == str(tmp_path / "sif" / "wbm" / "2.0.0" / "wbm_opensource_v2.0.0.sif")


def test_download_url_default():
    v1 = assets.resolve_spec("1.0.0", assets.BUILTIN_MANIFEST)
    assert v1.download_url() == f"{assets.BUCKET_BASE}/wbm_opensource_v1.0.0.sif"


def test_load_manifest_parses_remote(monkeypatch):
    doc = {"images": {"2.0.0": {"filename": "wbm_opensource_v2.0.0.sif", "kind": "wbm",
                                "size": 123, "sha256": "abc"}}}

    def fake_urlopen(url, timeout=0):
        return io.BytesIO(json.dumps(doc).encode("utf-8"))

    monkeypatch.setattr(assets.urllib.request, "urlopen", fake_urlopen)
    manifest = assets.load_manifest()
    assert manifest["2.0.0"].size == 123 and manifest["2.0.0"].sha256 == "abc"


def test_load_manifest_falls_back_on_error(monkeypatch):
    def boom(url, timeout=0):
        raise OSError("no network")

    monkeypatch.setattr(assets.urllib.request, "urlopen", boom)
    manifest = assets.load_manifest()
    assert set(manifest) == set(assets.BUILTIN_MANIFEST)
