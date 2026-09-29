"""Container image acquisition — manifest parsing, selectors, cache paths, sizes."""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from openghm import Config
from openghm import assets
from openghm.errors import OpenghmError

#: A recorded copy of the published ``containers/manifest.json``.
MANIFEST_FIXTURE = Path(__file__).parent / "fixtures" / "containers-manifest.json"


def _recorded() -> dict:
    return json.loads(MANIFEST_FIXTURE.read_text(encoding="utf-8"))


def test_human_bytes():
    assert assets.human_bytes(None) == "unknown size"
    assert assets.human_bytes(512) == "512 B"
    assert assets.human_bytes(317 * 1024 * 1024) == "317 MB"
    assert assets.human_bytes(1_944_821_760).endswith("GB")


def test_parse_recorded_manifest():
    manifest = assets.parse_manifest(_recorded())
    assert set(manifest) == {"wbm-v1-lite:1.0.0", "wbm-v2-lite:2.0.0", "wbm-tools-lite:2026-05-31"}
    v2 = manifest["wbm-v2-lite:2.0.0"]
    assert (v2.image, v2.version) == ("wbm-v2-lite", "2.0.0")
    assert v2.filename == "wbm-v2-lite-2.0.0.sif"
    assert v2.object_key == "containers/wbm-v2-lite/2.0.0/wbm-v2-lite-2.0.0.sif"
    assert v2.size == 335466496
    assert v2.sha256 == "4ef9e35b3c15f08721a165cccb15266ab812f5fa51e0266d36061e9a77f222ea"
    assert v2.aliases == ("latest",)
    assert v2.download_url() == (
        "https://s3.anvil.rcac.purdue.edu/openghm/containers/wbm-v2-lite/2.0.0/wbm-v2-lite-2.0.0.sif"
    )


def test_builtin_manifest_mirrors_the_published_one():
    assert assets.BUILTIN_MANIFEST == assets.parse_manifest(_recorded())


def test_parse_manifest_rejects_other_shapes():
    with pytest.raises(ValueError):
        assets.parse_manifest({"images": {"2.0.0": {"filename": "x.sif"}}})   # the pre-1 shape
    with pytest.raises(ValueError):
        assets.parse_manifest({"manifestVersion": 2, "images": {}})


def test_resolve_spec_keys_aliases_and_legacy_selectors():
    m = assets.BUILTIN_MANIFEST
    assert assets.resolve_spec("wbm-v2-lite:2.0.0", m).key == "wbm-v2-lite:2.0.0"
    # an image name, or :latest, follows the manifest's alias
    assert assets.resolve_spec("wbm-v2-lite", m).version == "2.0.0"
    assert assets.resolve_spec("wbm-tools-lite:latest", m).version == "2026-05-31"
    # the selectors from before the manifest was rewritten
    assert assets.resolve_spec("lite", m).key == "wbm-tools-lite:2026-05-31"
    assert assets.resolve_spec("1.0.0", m).key == "wbm-v1-lite:1.0.0"
    assert assets.resolve_spec("2.0.0", m).key == "wbm-v2-lite:2.0.0"
    with pytest.raises(OpenghmError, match="unknown image"):
        assets.resolve_spec("wbm-v2-lite:9.9.9", m)
    with pytest.raises(OpenghmError, match="unknown image"):
        assets.resolve_spec("nope", m)


def test_cache_path(tmp_path):
    cfg = Config(sif_dir=str(tmp_path / "sif"))
    v2 = assets.resolve_spec("2.0.0", assets.BUILTIN_MANIFEST)
    assert assets.cache_path(cfg, v2) == str(
        tmp_path / "sif" / "wbm-v2-lite" / "2.0.0" / "wbm-v2-lite-2.0.0.sif")


def test_default_tools_sif_is_where_sif_pull_puts_it():
    cfg = Config()
    tools = assets.resolve_spec(assets.TOOLS_IMAGE, assets.BUILTIN_MANIFEST)
    assert Path(cfg.sif).expanduser() == Path(assets.cache_path(cfg, tools))


def test_spec_from_container():
    pin = {
        "image": "wbm-v2-lite", "version": "2.0.0", "digest": "sha256:" + "ab" * 32,
        "oras": "oras://r/x@sha256:" + "cd" * 32,
        "https": "https://h.test/openghm/containers/wbm-v2-lite/2.0.0/wbm-v2-lite-2.0.0.sif",
    }
    spec = assets.spec_from_container(pin)
    assert spec.key == "wbm-v2-lite:2.0.0" and spec.filename == "wbm-v2-lite-2.0.0.sif"
    assert spec.sha256 == "ab" * 32 and spec.download_url() == pin["https"]
    with pytest.raises(OpenghmError, match="uses.container.https"):
        assets.spec_from_container({k: v for k, v in pin.items() if k != "https"})
    with pytest.raises(OpenghmError, match="not a sha256 digest"):
        assets.spec_from_container({**pin, "digest": "md5:00"})


def test_load_manifest_parses_remote(monkeypatch):
    raw = _recorded()

    def fake_urlopen(url, timeout=0):
        assert url == assets.MANIFEST_URL
        return io.BytesIO(json.dumps(raw).encode("utf-8"))

    monkeypatch.setattr(assets.urllib.request, "urlopen", fake_urlopen)
    manifest = assets.load_manifest()
    assert manifest["wbm-v1-lite:1.0.0"].size == 328179712
    assert manifest["wbm-tools-lite:2026-05-31"].aliases == ("latest",)


@pytest.mark.parametrize("body", [b"not json", b'{"images": {"2.0.0": {"filename": "x"}}}'])
def test_load_manifest_falls_back_on_bad_manifest(monkeypatch, body):
    monkeypatch.setattr(assets.urllib.request, "urlopen", lambda url, timeout=0: io.BytesIO(body))
    assert assets.load_manifest() == assets.BUILTIN_MANIFEST


def test_load_manifest_falls_back_on_error(monkeypatch):
    def boom(url, timeout=0):
        raise OSError("no network")

    monkeypatch.setattr(assets.urllib.request, "urlopen", boom)
    assert set(assets.load_manifest()) == set(assets.BUILTIN_MANIFEST)


def test_download_verifies_and_removes_a_bad_partial(tmp_path):
    import hashlib
    src = tmp_path / "src.sif"
    src.write_bytes(b"image bytes")
    good = hashlib.sha256(b"image bytes").hexdigest()
    spec = assets.ImageSpec("img", "1", "src.sif", url=src.as_uri(), sha256=good, size=11)
    dest = tmp_path / "cache" / "img" / "1" / "src.sif"
    assets.download(spec, str(dest))
    assert dest.read_bytes() == b"image bytes"

    bad = assets.ImageSpec("img", "1", "src.sif", url=src.as_uri(), sha256="0" * 64, size=11)
    dest2 = tmp_path / "cache" / "bad.sif"
    with pytest.raises(OpenghmError, match="checksum mismatch"):
        assets.download(bad, str(dest2))
    assert not dest2.exists() and not Path(str(dest2) + ".part").exists()
