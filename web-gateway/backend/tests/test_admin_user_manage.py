"""An admin edits a user's name and organization (PATCH /users/{id}) and
deletes an account (DELETE /users/{id}), with the guards that keep the system
from losing its last admin or a running job's owner."""

from __future__ import annotations

from app.core.roles import Role

from route_helpers import make_job, make_user, token_for

ADMIN = token_for("admin", Role.ADMIN)


def _admin(db):
    db.users.docs["admin"] = make_user("admin", Role.ADMIN)


def test_an_admin_fixes_a_name_and_clears_an_organization(auth_client, db):
    _admin(db)
    db.users.docs["alice"] = make_user("alice")
    db.users.docs["alice"]["organization"] = "Old Lab"

    response = auth_client.patch(
        "/api/v1/users/alice",
        json={"name": "  Alice Smith ", "organization": "  "},
        headers=ADMIN,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Alice Smith"
    assert response.json()["organization"] is None
    assert db.users.docs["alice"]["name"] == "Alice Smith"
    assert db.users.docs["alice"]["organization"] is None


def test_a_blank_name_is_refused(auth_client, db):
    _admin(db)
    db.users.docs["alice"] = make_user("alice")
    for bad in ("   ", None):
        response = auth_client.patch("/api/v1/users/alice", json={"name": bad}, headers=ADMIN)
        assert response.status_code == 422
    assert db.users.docs["alice"]["name"] == "alice"


def test_staff_cannot_edit_or_delete(auth_client, db):
    db.users.docs["staff"] = make_user("staff", Role.STAFF)
    db.users.docs["alice"] = make_user("alice")
    staff = token_for("staff", Role.STAFF)
    assert auth_client.patch("/api/v1/users/alice", json={"name": "X"}, headers=staff).status_code == 403
    assert auth_client.delete("/api/v1/users/alice", headers=staff).status_code == 403
    assert "alice" in db.users.docs


def test_an_admin_deletes_an_account_and_it_is_audited(auth_client, db):
    _admin(db)
    db.users.docs["alice"] = make_user("alice")
    db.jobs.docs["job-1"] = make_job("job-1", "alice", "COMPLETED")

    response = auth_client.delete("/api/v1/users/alice", headers=ADMIN)
    assert response.status_code == 204
    assert "alice" not in db.users.docs
    # What she made stays.
    assert "job-1" in db.jobs.docs

    [event] = [e for e in db.audit_events.docs.values() if e["action"] == "user_deleted"]
    assert event["actor_id"] == "admin" and event["target_id"] == "alice"
    assert event["detail"]["email"] == "alice@example.org"


def test_delete_is_refused_for_self_the_last_admin_and_a_running_job(auth_client, db):
    _admin(db)
    db.users.docs["alice"] = make_user("alice")
    db.jobs.docs["job-1"] = make_job("job-1", "alice", "RUNNING")

    assert auth_client.delete("/api/v1/users/admin", headers=ADMIN).status_code == 400
    assert auth_client.delete("/api/v1/users/alice", headers=ADMIN).status_code == 409
    assert auth_client.delete("/api/v1/users/nobody", headers=ADMIN).status_code == 404

    db.users.docs["root"] = make_user("root", Role.ADMIN, is_active=False)
    # An inactive admin does not count, so the only active admin is the caller:
    # deleting a second, active admin is allowed, deleting the last one is not.
    db.users.docs["admin2"] = make_user("admin2", Role.ADMIN)
    assert auth_client.delete("/api/v1/users/admin2", headers=ADMIN).status_code == 204
    assert "alice" in db.users.docs


def test_an_admin_changes_an_address_and_it_starts_unverified(auth_client, db):
    _admin(db)
    db.users.docs["alice"] = make_user("alice")
    db.users.docs["alice"]["verify_token_hash"] = "h"

    response = auth_client.patch(
        "/api/v1/users/alice", json={"email": "Alice.New@Example.org"}, headers=ADMIN
    )
    assert response.status_code == 200
    alice = db.users.docs["alice"]
    assert alice["email"] == "alice.new@example.org"
    assert alice["email_verified"] is False
    assert "verify_token_hash" not in alice
    [event] = [e for e in db.audit_events.docs.values() if e["action"] == "user_admin_updated"]
    assert event["detail"]["previous_email"] == "alice@example.org"


def test_an_address_in_use_or_malformed_is_refused(auth_client, db):
    _admin(db)
    db.users.docs["alice"] = make_user("alice")
    db.users.docs["bob"] = make_user("bob")
    taken = auth_client.patch("/api/v1/users/alice", json={"email": "bob@example.org"}, headers=ADMIN)
    assert taken.status_code == 409
    bad = auth_client.patch("/api/v1/users/alice", json={"email": "nope"}, headers=ADMIN)
    assert bad.status_code == 422
    assert db.users.docs["alice"]["email"] == "alice@example.org"
