"""An admin marks a user's email address verified through PATCH /users/{id}:
one way only, audited, and the emailed link stops working."""

from __future__ import annotations

from app.core.roles import Role

from route_helpers import make_user, token_for


def test_an_admin_marks_an_address_verified_and_it_is_audited(client, db):
    db.users.docs["admin"] = make_user("admin", Role.ADMIN)
    db.users.docs["alice"] = make_user("alice", email_verified=False)
    db.users.docs["alice"].update(
        verify_token_hash="h", verify_token_expires_at="t", verify_token_sent_at="s"
    )

    response = client.patch(
        "/api/v1/users/alice",
        json={"email_verified": True},
        headers=token_for("admin", Role.ADMIN),
    )
    assert response.status_code == 200
    assert response.json()["email_verified"] is True
    alice = db.users.docs["alice"]
    assert alice["email_verified"] is True
    assert "verify_token_hash" not in alice and "verify_token_expires_at" not in alice

    [event] = [
        e for e in db.audit_events.docs.values() if e["action"] == "user_admin_updated"
    ]
    assert event["detail"] == {"email_verified": "True"}
    assert event["actor_id"] == "admin" and event["target_id"] == "alice"


def test_a_verification_cannot_be_taken_away(client, db):
    db.users.docs["admin"] = make_user("admin", Role.ADMIN)
    db.users.docs["alice"] = make_user("alice")
    response = client.patch(
        "/api/v1/users/alice",
        json={"email_verified": False},
        headers=token_for("admin", Role.ADMIN),
    )
    assert response.status_code == 422
    assert db.users.docs["alice"]["email_verified"] is True


def test_only_an_admin_and_never_for_their_own_address(client, db):
    db.users.docs["admin"] = make_user("admin", Role.ADMIN, email_verified=False)
    db.users.docs["staff"] = make_user("staff", Role.STAFF)
    db.users.docs["alice"] = make_user("alice", email_verified=False)

    as_staff = client.patch(
        "/api/v1/users/alice",
        json={"email_verified": True},
        headers=token_for("staff", Role.STAFF),
    )
    assert as_staff.status_code == 403
    own = client.patch(
        "/api/v1/users/admin",
        json={"email_verified": True},
        headers=token_for("admin", Role.ADMIN),
    )
    assert own.status_code == 400
    assert db.users.docs["alice"]["email_verified"] is False
    assert db.users.docs["admin"]["email_verified"] is False
