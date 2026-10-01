"""What GET /admin/system reports about the runtime settings."""

from __future__ import annotations

from app.core.config import settings
from app.services import system_info


def test_the_sweep_is_reported_with_both_its_intervals(monkeypatch):
    monkeypatch.setattr(settings, "JOB_BACKGROUND_SYNC_ACTIVE_INTERVAL", 10)
    monkeypatch.setattr(settings, "JOB_BACKGROUND_SYNC_INTERVAL", 60)
    summary = system_info._settings_summary()
    assert summary.job_status_sweep == "every 10 s while a job is active, every 60 s otherwise"


def test_the_shared_answer_window_is_reported(monkeypatch):
    monkeypatch.setattr(settings, "JOB_LIVE_TTL_SECONDS", 5)
    assert system_info._settings_summary().job_live_ttl_seconds == 5


def test_the_intervals_follow_the_settings(monkeypatch):
    monkeypatch.setattr(settings, "JOB_BACKGROUND_SYNC_ACTIVE_INTERVAL", 3)
    monkeypatch.setattr(settings, "JOB_BACKGROUND_SYNC_INTERVAL", 120)
    assert "every 3 s while" in system_info._settings_summary().job_status_sweep
    assert "every 120 s otherwise" in system_info._settings_summary().job_status_sweep
