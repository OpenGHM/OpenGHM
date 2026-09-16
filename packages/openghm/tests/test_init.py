"""``openghm init`` — pure decision logic + non-interactive config writing."""

from __future__ import annotations

import sys

import pytest

from openghm import Config
from openghm.cli import init as initmod

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib


def test_detect_environment_shape(monkeypatch):
    monkeypatch.setattr(initmod.shutil, "which", lambda t: "/usr/bin/x" if t == "docker" else None)
    env = initmod.detect_environment()
    assert set(env) == set(initmod.PROBE_TOOLS)
    assert env["docker"] is True and env["sbatch"] is False


def test_suggested_runtime_prefers_singularity():
    assert initmod.suggested_runtime({"singularity": True, "docker": True}) == "singularity"
    assert initmod.suggested_runtime({"docker": True}) == "docker"
    assert initmod.suggested_runtime({}) is None


def test_apply_answers_overlays_and_ignores_unknown():
    cfg = initmod.apply_answers({"runtime": "docker", "account": "abc", "bogus": "x"})
    assert isinstance(cfg, Config)
    assert cfg.runtime == "docker" and cfg.account == "abc"
    # unknown key ignored, untouched fields keep defaults
    assert not hasattr(cfg, "bogus")
    assert cfg.partition == Config().partition


def test_presets_apply():
    anvil = initmod.apply_answers(initmod.PRESETS["anvil"])
    assert anvil.runtime == "singularity" and anvil.account == "ees260008"
    assert anvil.output_base == "/anvil/scratch/x-openghm/simulations"
    local = initmod.apply_answers(initmod.PRESETS["local"])
    assert local.runtime == "docker" and local.output_base == "~/.openghm/runs"


def test_non_interactive_writes_config(tmp_path, capsys):
    path = tmp_path / "config.toml"
    initmod.run_init(non_interactive=True, preset="local", config_path=str(path))
    assert path.exists()
    data = tomllib.loads(path.read_text())
    assert data["runtime"] == "docker"
    assert data["output_base"] == "~/.openghm/runs"
    assert "No images were downloaded" in capsys.readouterr().out


def test_non_interactive_requires_preset(tmp_path):
    with pytest.raises(SystemExit):
        initmod.run_init(non_interactive=True, preset=None, config_path=str(tmp_path / "c.toml"))
