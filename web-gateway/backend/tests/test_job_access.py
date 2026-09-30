"""Who may see, cancel and submit a job (mission
2026-09-30-only-signed-in-owners-run-jobs, ADR 0024): a route x caller matrix
over every job route, plus the submit gate's refusal codes and the
active-job limit.

Runs the real routers and the real auth dependencies against an in-memory
stand-in for Mongo (tests/conftest.py) with the slurm service faked, so no
SSH happens. Tokens come from the app's own `create_access_token`.
"""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.core.roles import Role

from route_helpers import make_job, make_user, token_for

OWNER = "owner"

# Each caller: how to authenticate, plus the users document to seed (None: no
# document, as for anonymous and mock callers).
CALLERS: dict[str, dict] = {
    "anonymous": {"headers": {}},
    "guest": {
        "user": make_user("guest", Role.GUEST),
        "headers": token_for("guest", Role.GUEST),
    },
    "unverified": {
        "user": make_user("unverified", email_verified=False, can_run_simulations=True),
        "headers": token_for("unverified"),
    },
    # A valid, unexpired token for an account an administrator has since
    # deactivated: get_current_user trusts the token, only the gate reads the DB.
    "deactivated": {
        "user": make_user("deactivated", is_active=False, can_run_simulations=True),
        "headers": token_for("deactivated"),
    },
    "not_permitted": {
        "user": make_user("not_permitted", can_run_simulations=False),
        "headers": token_for("not_permitted"),
    },
    "permitted_other": {
        "user": make_user("permitted_other", can_run_simulations=True),
        "headers": token_for("permitted_other"),
    },
    "owner": {
        "user": make_user(OWNER, can_run_simulations=True),
        "headers": token_for(OWNER),
    },
    "staff": {
        "user": make_user("staff", Role.STAFF),
        "headers": token_for("staff", Role.STAFF),
    },
    "admin": {
        "user": make_user("admin", Role.ADMIN),
        "headers": token_for("admin", Role.ADMIN),
    },
    # The dev X-Mock-Role bypass, switched on the way local `.env` has it.
    # Local dev signs in as these and their documents exist in local Mongo.
    "mock": {
        "user": make_user("mock-user-001"),
        "headers": {"X-Mock-Role": "user"},
        "mock_auth": True,
    },
    "mock_admin": {
        "user": make_user("mock-admin-001", Role.ADMIN),
        "headers": {"X-Mock-Role": "admin"},
        "mock_auth": True,
    },
}

# name -> (method, path template, JSON body, status of the job it targets)
ROUTES: dict[str, tuple[str, str, dict | None, str | None]] = {
    "list": ("GET", "/api/v1/jobs", None, None),
    "stats": ("GET", "/api/v1/jobs/stats", None, None),
    "submit": ("POST", "/api/v1/jobs/{id}/submit", None, "DRAFT"),
    "derive": ("POST", "/api/v1/jobs/derive/ds-1", {}, None),
    "get": ("GET", "/api/v1/jobs/{id}", None, "RUNNING"),
    "status": ("GET", "/api/v1/jobs/{id}/status", None, "RUNNING"),
    "logs": ("GET", "/api/v1/jobs/{id}/logs", None, "RUNNING"),
    "cancel": ("POST", "/api/v1/jobs/{id}/cancel", None, "RUNNING"),
    # PATCH and DELETE act on a draft: a submitted job is read-only (409).
    "patch": ("PATCH", "/api/v1/jobs/{id}", {"slug": "renamed"}, "DRAFT"),
    "delete": ("DELETE", "/api/v1/jobs/{id}", None, "DRAFT"),
}

# Expected status per route, for every caller that is not anonymous. The job
# a by-id route targets belongs to OWNER.
#
# - A guest holds neither job:view:own nor job:submit, so every route refuses
#   it on the route's own permission, before any job is looked up.
# - Everyone else who is not the owner gets 404 for the job routes, the same
#   answer as for a missing id. staff and admin hold job:view:any and
#   job:cancel:any but deliberately no edit/delete "any": 404 for those.
# - `submit` is the gate of ADR 0024, then the owner alone (404 for anyone
#   else, staff and admin included: no "any" permission submits another
#   user's draft); `derive` (a draft) only needs an active account, so an
#   unverified, unpermitted or mock user may still prepare one.
NOT_OWNER = {"list": 200, "stats": 200, "get": 404, "status": 404, "logs": 404,
             "cancel": 404, "patch": 404, "delete": 404}
EXPECTED: dict[str, dict[str, int]] = {
    "anonymous": {r: 401 for r in ROUTES},
    "guest": {r: 403 for r in ROUTES},
    "unverified": {**NOT_OWNER, "submit": 403, "derive": 201},
    "deactivated": {**NOT_OWNER, "submit": 403, "derive": 403},
    "not_permitted": {**NOT_OWNER, "submit": 403, "derive": 201},
    "permitted_other": {**NOT_OWNER, "submit": 404, "derive": 201},
    "owner": {"list": 200, "stats": 200, "submit": 202, "derive": 201, "get": 200,
              "status": 200, "logs": 200, "cancel": 200, "patch": 200, "delete": 204},
    "staff": {**NOT_OWNER, "get": 200, "status": 200, "logs": 200, "cancel": 200,
              "submit": 404, "derive": 201},
    "admin": {**NOT_OWNER, "get": 200, "status": 200, "logs": 200, "cancel": 200,
              "submit": 404, "derive": 201},
    # A mock identity may prepare drafts (no allocation spent) but never runs.
    "mock": {**NOT_OWNER, "submit": 403, "derive": 201},
    # Holds job:view:any and job:cancel:any like any admin, but never runs.
    "mock_admin": {**NOT_OWNER, "get": 200, "status": 200, "logs": 200, "cancel": 200,
                   "submit": 403, "derive": 201},
}


@pytest.mark.parametrize("route", list(ROUTES))
@pytest.mark.parametrize("caller", list(CALLERS))
def test_route_by_caller(client, db, monkeypatch, caller, route):
    spec = CALLERS[caller]
    if spec.get("mock_auth"):
        monkeypatch.setattr(settings, "ENVIRONMENT", "development")
        monkeypatch.setattr(settings, "ALLOW_MOCK_AUTH", True)
    if "user" in spec:
        db.users.docs[spec["user"]["_id"]] = spec["user"]
    db.users.docs[OWNER] = CALLERS["owner"]["user"]

    method, path, body, job_status = ROUTES[route]
    if job_status is not None:
        db.jobs.docs["job-1"] = make_job("job-1", OWNER, job_status)
    path = path.format(id="job-1")

    response = client.request(method, path, json=body, headers=spec["headers"])
    assert response.status_code == EXPECTED[caller][route], response.text


def test_non_owner_404_is_the_same_answer_as_a_missing_id(client, db):
    """No 403: a stranger cannot tell a job that exists from one that does not."""
    db.users.docs["permitted_other"] = CALLERS["permitted_other"]["user"]
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "RUNNING")
    headers = CALLERS["permitted_other"]["headers"]
    for suffix in ("", "/status", "/logs"):
        real = client.get(f"/api/v1/jobs/job-1{suffix}", headers=headers)
        missing = client.get(f"/api/v1/jobs/nope{suffix}", headers=headers)
        assert (real.status_code, real.json()) == (missing.status_code, missing.json())
    real = client.post("/api/v1/jobs/job-1/cancel", headers=headers)
    missing = client.post("/api/v1/jobs/nope/cancel", headers=headers)
    assert (real.status_code, real.json()) == (missing.status_code, missing.json())


def test_non_owner_cancel_leaves_the_job_running(client, db):
    db.users.docs["permitted_other"] = CALLERS["permitted_other"]["user"]
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "RUNNING")
    client.post("/api/v1/jobs/job-1/cancel", headers=CALLERS["permitted_other"]["headers"])
    assert db.jobs.docs["job-1"]["status"] == "RUNNING"


def test_staff_cancelling_another_users_job_is_allowed_and_recorded(client, db):
    db.users.docs["staff"] = CALLERS["staff"]["user"]
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "RUNNING")
    response = client.post("/api/v1/jobs/job-1/cancel", headers=CALLERS["staff"]["headers"])
    assert response.status_code == 200
    # A cancel is a request until SLURM confirms it (ADR 0026): the job keeps
    # running here, and who asked is on it.
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "RUNNING"
    assert stored["cancel_requested_by"] == "staff"
    assert stored["cancel_requested_by_email"] == "staff@example.org"
    assert response.json()["cancel_requested_by_email"] == "staff@example.org"


# ---- the submit gate's refusals are distinguishable --------------------


_draft_count = 0


def _submit(client, db, headers, owner=OWNER):
    """Submit a fresh draft owned by `owner`."""
    global _draft_count
    _draft_count += 1
    job_id = f"draft-{_draft_count}"
    db.jobs.docs[job_id] = make_job(job_id, owner, "DRAFT")
    return client.post(f"/api/v1/jobs/{job_id}/submit", headers=headers)


@pytest.mark.parametrize(
    "caller, code",
    [
        ("guest", "not_permitted_to_run"),
        ("unverified", "email_not_verified"),
        ("deactivated", "account_inactive"),
        ("not_permitted", "not_permitted_to_run"),
    ],
)
def test_submit_refusal_carries_a_stable_code(client, db, caller, code):
    db.users.docs[caller] = CALLERS[caller]["user"]
    response = _submit(client, db, CALLERS[caller]["headers"])
    assert response.status_code == 403
    detail = response.json()["detail"]
    assert detail["code"] == code
    assert detail["message"]


def test_submit_trusts_the_database_role_not_the_token(client, db):
    """A token claiming `admin` for a user who is only `user` in the database."""
    db.users.docs["liar"] = make_user("liar", Role.USER, can_run_simulations=False)
    response = _submit(client, db, token_for("liar", Role.ADMIN))
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "not_permitted_to_run"


def test_submit_with_a_valid_token_but_no_user_document(client, db):
    response = _submit(client, db, token_for("ghost"))
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "account_not_found"


def test_legacy_user_document_without_the_flag_is_not_permitted(client, db):
    db.users.docs["legacy"] = make_user("legacy")  # no can_run_simulations key
    response = _submit(client, db, token_for("legacy"))
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "not_permitted_to_run"


def test_a_mock_identity_without_a_document_cannot_derive_a_draft(client, db, monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")
    monkeypatch.setattr(settings, "ALLOW_MOCK_AUTH", True)
    response = client.post(
        "/api/v1/jobs/derive/ds-1", json={}, headers={"X-Mock-Role": "user"}
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "account_not_found"


@pytest.mark.parametrize("environment, allow_mock", [("production", False), ("development", True)])
def test_a_mock_identity_is_refused_whatever_the_environment(
    client, db, monkeypatch, environment, allow_mock
):
    """Refused by id, not by ENVIRONMENT: even a real user document carrying a
    mock id, and a token signed with the real key, cannot submit."""
    monkeypatch.setattr(settings, "ENVIRONMENT", environment)
    monkeypatch.setattr(settings, "ALLOW_MOCK_AUTH", allow_mock)
    db.users.docs["mock-admin-001"] = make_user("mock-admin-001", Role.ADMIN)
    response = _submit(
        client, db, token_for("mock-admin-001", Role.ADMIN), owner="mock-admin-001"
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "mock_identity"
    assert {j["status"] for j in db.jobs.docs.values()} == {"DRAFT"}


# ---- the active-job limit ----------------------------------------------


def test_limit_answers_429_then_allows_a_submit_after_a_job_ends(client, db):
    db.users.docs[OWNER] = CALLERS["owner"]["user"]
    headers = CALLERS["owner"]["headers"]
    db.jobs.docs["a"] = make_job("a", OWNER, "PENDING")
    db.jobs.docs["b"] = make_job("b", OWNER, "RUNNING")
    db.jobs.docs["draft"] = make_job("draft", OWNER, "DRAFT")  # does not count
    db.jobs.docs["c"] = make_job("c", OWNER, "COMPLETED")  # does not count

    blocked = _submit(client, db, headers)
    assert blocked.status_code == 429
    detail = blocked.json()["detail"]
    assert detail["code"] == "active_job_limit"
    assert (detail["active"], detail["limit"]) == (2, 2)
    assert "2" in detail["message"] and "cancel" in detail["message"]

    db.jobs.docs["b"]["status"] = "COMPLETED"
    assert _submit(client, db, headers).status_code == 202
    # That submit is now active (SUBMITTED) next to "a": at the limit again.
    assert _submit(client, db, headers).status_code == 429


@pytest.mark.parametrize("status", ["PENDING", "SUBMITTED", "RUNNING", "COMPLETING"])
def test_every_active_status_counts_against_the_limit(client, db, status):
    db.users.docs[OWNER] = CALLERS["owner"]["user"]
    db.jobs.docs["a"] = make_job("a", OWNER, status)
    db.jobs.docs["b"] = make_job("b", OWNER, "RUNNING")
    assert _submit(client, db, CALLERS["owner"]["headers"]).status_code == 429


def test_another_users_active_jobs_do_not_count(client, db):
    db.users.docs[OWNER] = CALLERS["owner"]["user"]
    db.jobs.docs["a"] = make_job("a", "someone-else", "RUNNING")
    db.jobs.docs["b"] = make_job("b", "someone-else", "RUNNING")
    assert _submit(client, db, CALLERS["owner"]["headers"]).status_code == 202


@pytest.mark.parametrize("caller", ["staff", "admin"])
def test_staff_and_admin_are_exempt_from_the_limit(client, db, caller):
    db.users.docs[caller] = CALLERS[caller]["user"]
    for i in range(3):
        db.jobs.docs[f"j{i}"] = make_job(f"j{i}", caller, "RUNNING")
    assert _submit(client, db, CALLERS[caller]["headers"], owner=caller).status_code == 202
