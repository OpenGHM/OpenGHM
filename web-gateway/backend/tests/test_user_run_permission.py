"""`can_run_simulations` (ADR 0024) on the user routes: exposed on
GET /users/me, defaulting to False for a legacy document, settable only
through the admin PATCH, and audited there."""

from __future__ import annotations

from app.core.roles import Role

from route_helpers import make_job, make_user, token_for


def test_me_exposes_the_flag_and_defaults_it_to_false(client, db):
    db.users.docs["legacy"] = make_user("legacy")  # no key, like an old document
    db.users.docs["granted"] = make_user("granted", can_run_simulations=True)

    legacy = client.get("/api/v1/users/me", headers=token_for("legacy")).json()
    granted = client.get("/api/v1/users/me", headers=token_for("granted")).json()
    assert legacy["can_run_simulations"] is False
    assert granted["can_run_simulations"] is True


def test_admin_grants_and_revokes_the_flag_and_it_is_audited(client, db):
    db.users.docs["admin"] = make_user("admin", Role.ADMIN)
    db.users.docs["alice"] = make_user("alice")
    admin = token_for("admin", Role.ADMIN)

    granted = client.patch(
        "/api/v1/users/alice", json={"can_run_simulations": True}, headers=admin
    )
    assert granted.status_code == 200
    assert granted.json()["can_run_simulations"] is True
    assert db.users.docs["alice"]["can_run_simulations"] is True

    revoked = client.patch(
        "/api/v1/users/alice", json={"can_run_simulations": False}, headers=admin
    )
    assert revoked.json()["can_run_simulations"] is False

    events = [e for e in db.audit_events.docs.values() if e["action"] == "user_admin_updated"]
    assert [e["detail"]["can_run_simulations"] for e in events] == ["True", "False"]
    assert all(e["actor_id"] == "admin" and e["target_id"] == "alice" for e in events)


def test_granting_takes_effect_on_the_very_next_submit(client, db):
    db.users.docs["admin"] = make_user("admin", Role.ADMIN)
    db.users.docs["alice"] = make_user("alice")
    db.jobs.docs["draft-1"] = make_job("draft-1", "alice", "DRAFT")
    alice = token_for("alice")  # one token throughout: the gate reads the database

    assert client.post("/api/v1/jobs/draft-1/submit", headers=alice).status_code == 403
    client.patch(
        "/api/v1/users/alice",
        json={"can_run_simulations": True},
        headers=token_for("admin", Role.ADMIN),
    )
    assert client.post("/api/v1/jobs/draft-1/submit", headers=alice).status_code == 202


def test_only_an_admin_may_change_the_flag(client, db):
    db.users.docs["staff"] = make_user("staff", Role.STAFF)
    db.users.docs["alice"] = make_user("alice")
    response = client.patch(
        "/api/v1/users/alice",
        json={"can_run_simulations": True},
        headers=token_for("staff", Role.STAFF),
    )
    assert response.status_code == 403
    assert "can_run_simulations" not in db.users.docs["alice"]


def test_an_admin_cannot_change_their_own_flag(client, db):
    db.users.docs["admin"] = make_user("admin", Role.ADMIN)
    response = client.patch(
        "/api/v1/users/admin",
        json={"can_run_simulations": False},
        headers=token_for("admin", Role.ADMIN),
    )
    assert response.status_code == 400
    assert "run permission" in response.json()["detail"]
