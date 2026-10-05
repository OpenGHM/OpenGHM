"""GET /admin/anvil/scratch and POST /admin/anvil/spool-cache/clear: the two
admin views over Anvil's scratch quota and spool cache.

`slurm.run_remote` is replaced by a recorder, so no SSH runs; what the toolkit
prints is whatever the test says it printed. The audit log is the in-memory
Mongo (tests/conftest.py).
"""

from __future__ import annotations

import asyncio
import json
import shlex
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from slurmly.exceptions import SlurmlyError

from app.api.v1 import admin as admin_router
from app.core.config import settings
from app.core.roles import Permission, ROLE_PERMISSIONS, Role
from app.services import slurm

from route_helpers import make_user, token_for

HOME = "/home/x-openghm/apps/openghm/abc1234"
SCRATCH = "/api/v1/admin/anvil/scratch"
CLEAR = "/api/v1/admin/anvil/spool-cache/clear"
ADMIN = token_for("root", Role.ADMIN)

STATUS = {
    "quota": {"files_used": 59_600, "files_limit": 1_000_000, "bytes_used": 91_900_000_000,
              "bytes_limit": 100_000_000_000_000},
    "quota_error": None, "high": 0.8, "low": 0.5,
    "cache_root": "/anvil/scratch/x-openghm/spools",
    "variants": [{"model_input_id": "m" * 64, "network": "net", "variant": "0123456789abcdef",
                  "dir": "/anvil/scratch/x-openghm/spools/m/net/0123456789abcdef", "units": 3,
                  "files": 300, "bytes": 3_000_000, "last_used": "2026-10-05T12:00:00Z",
                  "on_s3_units": 2, "leased_units": 1}],
    "leases": [{"sim_id": "sim-1", "variant_dir": "/anvil/scratch/x-openghm/spools/m/net/0123456789abcdef",
                "units": ["2000"], "expires": "2026-10-09T12:00:00Z"}],
    "totals": {"units": 3, "files": 300, "bytes": 3_000_000},
}
PRUNE = {
    "all": True, "dry_run": False, "high": 0.8, "low": 0.5, "used": 59_600, "limit": 1_000_000,
    "after": 59_200, "reason": None, "deleted_files": 400, "deleted_bytes": 4_000_000,
    "skipped_leased": 1, "expired_leases": 0,
    "deleted": [
        {"variant_dir": "/v/a", "unit": "2001", "files": 150, "bytes": 1_500_000,
         "last_used": "2026-09-01T00:00:00Z", "on_s3": True},
        {"variant_dir": "/v/a", "unit": "clim", "files": 250, "bytes": 2_500_000,
         "last_used": "2026-09-02T00:00:00Z", "on_s3": False},
    ],
}


class Remote:
    """What `run_remote` was asked, and the answer to give."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.answer = SimpleNamespace(exit_status=0, stdout="{}", stderr="")

    def json(self, data) -> None:
        self.answer = SimpleNamespace(exit_status=0, stdout=json.dumps(data), stderr="")


@pytest.fixture
def remote(monkeypatch) -> Remote:
    fake = Remote()

    async def run_remote(command, **kw):
        fake.calls.append({"command": command, **kw})
        if isinstance(fake.answer, Exception):
            raise fake.answer
        return fake.answer

    monkeypatch.setattr(slurm, "run_remote", run_remote)
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", HOME)
    return fake


@pytest.fixture
def api(db) -> TestClient:
    app = FastAPI()
    app.include_router(admin_router.router, prefix="/api/v1")
    return TestClient(app)


def _detail(response) -> dict:
    return response.json()["detail"]


# ---- permissions -------------------------------------------------------------


def test_only_admins_hold_the_permissions_these_routes_need():
    for role in Role:
        for permission in (Permission.SYSTEM_VIEW, Permission.SYSTEM_MANAGE):
            assert (permission in ROLE_PERMISSIONS[role]) is (role is Role.ADMIN)


@pytest.mark.parametrize("role", [Role.STAFF, Role.USER, Role.GUEST])
def test_a_non_admin_is_refused_and_nothing_runs(api, remote, db, role):
    headers = token_for("someone", role)
    assert api.get(SCRATCH, headers=headers).status_code == 403
    assert api.post(CLEAR, json={}, headers=headers).status_code == 403
    assert remote.calls == [] and db.audit_events.docs == {}


def test_no_token_is_refused(api, remote):
    assert api.get(SCRATCH).status_code in (401, 403)
    assert api.post(CLEAR, json={}).status_code in (401, 403)
    assert remote.calls == []


# ---- GET /admin/anvil/scratch ------------------------------------------------


def test_scratch_returns_the_toolkits_answer_and_the_time_it_was_asked(api, remote):
    remote.json(STATUS)
    response = api.get(SCRATCH, headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    checked_at = body.pop("checked_at")
    assert body == STATUS
    assert checked_at.endswith("Z") or checked_at.endswith("+00:00")


def test_scratch_with_no_quota_passes_the_reason_on(api, remote):
    remote.json({**STATUS, "quota": None, "quota_error": "myquota is not on this machine",
                 "variants": [], "leases": [], "totals": {"units": 0, "files": 0, "bytes": 0}})
    body = api.get(SCRATCH, headers=ADMIN).json()
    assert body["quota"] is None and body["quota_error"] == "myquota is not on this machine"
    assert body["variants"] == []


def test_scratch_runs_spool_status_from_the_configured_home(api, remote):
    remote.json(STATUS)
    api.get(SCRATCH, headers=ADMIN)
    (call,) = remote.calls
    assert shlex.split(call["command"]) == [
        f"{HOME}/bin/openghm", "spool", "status", "--config", f"{HOME}/gateway.toml", "--json"]
    assert call["operation"] == "spool_status" and call["retry_safe"] is True
    assert call["timeout"] and call["timeout"] > 0


def test_the_command_quotes_a_home_with_odd_characters(api, remote, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", "/home/x y/$(touch pwned)/abc;1234/")
    remote.json(STATUS)
    api.get(SCRATCH, headers=ADMIN)
    home = "/home/x y/$(touch pwned)/abc;1234"      # the trailing slash is dropped, as in a job script
    assert shlex.split(remote.calls[0]["command"]) == [
        f"{home}/bin/openghm", "spool", "status", "--config", f"{home}/gateway.toml", "--json"]


@pytest.mark.parametrize("home", ["", "relative/path"])
def test_scratch_without_a_usable_toolkit_home_is_503_not_configured(api, remote, monkeypatch, home):
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", home)
    response = api.get(SCRATCH, headers=ADMIN)
    assert response.status_code == 503 and _detail(response)["code"] == "anvil_not_configured"
    assert _detail(response)["message"] and remote.calls == []


def test_scratch_without_ssh_credentials_is_503_not_configured(api, remote):
    remote.answer = slurm.AnvilNotConfigured("no ssh key")
    response = api.get(SCRATCH, headers=ADMIN)
    assert response.status_code == 503 and _detail(response)["code"] == "anvil_not_configured"


@pytest.mark.parametrize("failure", [SlurmlyError("connection lost"), OSError("refused"), asyncio.TimeoutError()])
def test_scratch_with_a_transport_failure_is_503_unreachable(api, remote, failure):
    remote.answer = failure
    response = api.get(SCRATCH, headers=ADMIN)
    assert response.status_code == 503 and _detail(response)["code"] == "anvil_unreachable"
    assert "connection lost" not in json.dumps(response.json())


def test_scratch_with_a_failing_toolkit_is_502_with_the_stderr_tail(api, remote):
    remote.answer = SimpleNamespace(exit_status=2, stdout="", stderr="x" * 1000 + "openghm: no such config\n")
    response = api.get(SCRATCH, headers=ADMIN)
    assert response.status_code == 502 and _detail(response)["code"] == "spool_status_failed"
    message = _detail(response)["message"]
    assert message.endswith("openghm: no such config") and len(message) <= 400


def test_scratch_with_a_silent_failure_still_says_something(api, remote):
    remote.answer = SimpleNamespace(exit_status=127, stdout="", stderr="")
    response = api.get(SCRATCH, headers=ADMIN)
    assert response.status_code == 502 and "127" in _detail(response)["message"]


@pytest.mark.parametrize("stdout", ["", "not json", "[1, 2]", '{"quota": null}', json.dumps({**STATUS, "high": "much"})])
def test_scratch_with_an_answer_it_cannot_read_is_502(api, remote, stdout):
    remote.answer = SimpleNamespace(exit_status=0, stdout=stdout, stderr="")
    response = api.get(SCRATCH, headers=ADMIN)
    assert response.status_code == 502 and _detail(response)["code"] == "spool_status_failed"


# ---- POST /admin/anvil/spool-cache/clear -------------------------------------


def _audit(db) -> list[dict]:
    return list(db.audit_events.docs.values())


def test_clear_deletes_and_answers_with_the_counts(api, remote, db):
    remote.json(PRUNE)
    response = api.post(CLEAR, json={}, headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "dry_run": False, "deleted_units": 2, "deleted_files": 400, "deleted_bytes": 4_000_000,
        "skipped_leased": 1,
        "deleted": [{"variant_dir": "/v/a", "unit": "2001", "files": 150, "bytes": 1_500_000},
                    {"variant_dir": "/v/a", "unit": "clim", "files": 250, "bytes": 2_500_000}],
    }
    (call,) = remote.calls
    assert shlex.split(call["command"]) == [
        f"{HOME}/bin/openghm", "spool", "prune", "--all", "--config", f"{HOME}/gateway.toml", "--json"]
    assert call["operation"] == "spool_clear" and call["retry_safe"] is True
    assert call["timeout"] and call["timeout"] >= 300


def test_clear_writes_one_system_audit_event_with_the_counts(api, remote, db):
    remote.json(PRUNE)
    api.post(CLEAR, json={"dry_run": False}, headers=ADMIN)
    (event,) = _audit(db)
    assert event["action"] == "spool_cache_cleared" and event["category"] == "system"
    assert event["actor_id"] == "root" and event["actor_email"] == "root@example.org"
    assert event["detail"] == {"deleted_units": 2, "deleted_files": 400, "deleted_bytes": 4_000_000,
                               "skipped_leased": 1}


def test_a_dry_run_passes_the_flag_and_writes_no_audit_event(api, remote, db):
    remote.json({**PRUNE, "dry_run": True})
    response = api.post(CLEAR, json={"dry_run": True}, headers=ADMIN)
    assert response.status_code == 200 and response.json()["dry_run"] is True
    assert response.json()["deleted_units"] == 2
    assert shlex.split(remote.calls[0]["command"]) == [
        f"{HOME}/bin/openghm", "spool", "prune", "--all", "--dry-run", "--config", f"{HOME}/gateway.toml", "--json"]
    assert _audit(db) == []


def test_clear_with_no_body_is_not_a_dry_run(api, remote, db):
    remote.json(PRUNE)
    assert api.post(CLEAR, headers=ADMIN).json()["dry_run"] is False
    assert "--dry-run" not in remote.calls[0]["command"] and len(_audit(db)) == 1


def test_clearing_an_empty_cache_is_still_recorded(api, remote, db):
    remote.json({**PRUNE, "deleted": [], "deleted_files": 0, "deleted_bytes": 0, "skipped_leased": 0})
    body = api.post(CLEAR, json={}, headers=ADMIN).json()
    assert body["deleted_units"] == 0 and body["deleted"] == []
    assert _audit(db)[0]["detail"]["deleted_units"] == 0


def test_clear_not_configured_is_503_and_runs_nothing(api, remote, db, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", "")
    response = api.post(CLEAR, json={}, headers=ADMIN)
    assert response.status_code == 503 and _detail(response)["code"] == "anvil_not_configured"
    assert remote.calls == [] and _audit(db) == []


def test_clear_unreachable_is_503_and_writes_no_audit_event(api, remote, db):
    remote.answer = SlurmlyError("connection lost")
    response = api.post(CLEAR, json={}, headers=ADMIN)
    assert response.status_code == 503 and _detail(response)["code"] == "anvil_unreachable"
    assert _audit(db) == []


def test_clear_with_a_failing_toolkit_is_502_spool_clear_failed(api, remote, db):
    remote.answer = SimpleNamespace(exit_status=2, stdout="", stderr="openghm: cannot read the config\n")
    response = api.post(CLEAR, json={}, headers=ADMIN)
    assert response.status_code == 502
    assert _detail(response) == {"code": "spool_clear_failed", "message": "openghm: cannot read the config"}
    assert _audit(db) == []


@pytest.mark.parametrize("stdout", ["", "nope", "[]", '{"deleted": []}', '{"deleted": [{"unit": "1"}], "deleted_files": 0,'
                                    ' "deleted_bytes": 0, "skipped_leased": 0}'])
def test_clear_with_an_answer_it_cannot_read_is_502(api, remote, db, stdout):
    remote.answer = SimpleNamespace(exit_status=0, stdout=stdout, stderr="")
    response = api.post(CLEAR, json={}, headers=ADMIN)
    assert response.status_code == 502 and _detail(response)["code"] == "spool_clear_failed"
    assert _audit(db) == []


def test_clear_refuses_a_body_that_is_not_a_flag(api, remote):
    assert api.post(CLEAR, json={"dry_run": "maybe"}, headers=ADMIN).status_code == 422
    assert remote.calls == []


def test_the_timeout_and_retry_safety_reach_the_transport(api, anvil, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", HOME)
    anvil.results.append((lambda command: "spool prune" in command, (0, json.dumps(PRUNE), "")))
    assert api.post(CLEAR, json={}, headers=ADMIN).status_code == 200
    (sent,) = [call for call in anvil.transport.runs if "spool prune" in call.command]
    assert sent.retry_safe is True and sent.timeout == 900
