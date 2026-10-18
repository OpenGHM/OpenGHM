"""One password minimum, enforced by the API: registration, a reset link and a
change all refuse a short one with a 422 that names the field and the rule, the
shape the frontend turns into "Password: must be at least 8 characters".
"""

from __future__ import annotations

import pytest
from route_helpers import make_user, token_for

from app.core.security import hash_password, verify_password
from app.models.user import MIN_PASSWORD_LENGTH

CURRENT = "a-long-password-1"
SEVEN = "x" * (MIN_PASSWORD_LENGTH - 1)
EIGHT = "x" * MIN_PASSWORD_LENGTH


def too_short(response, field: str) -> None:
    assert response.status_code == 422, response.text
    (error,) = response.json()["detail"]
    assert error["loc"][-1] == field
    assert error["msg"] == "must be at least 8 characters"


def add_user(db, sub: str = "u1", **over) -> dict:
    doc = make_user(sub)
    doc["password_hash"] = hash_password(CURRENT)
    doc.update(over)
    db.users.docs[sub] = doc
    return doc


def register(auth_client, password: str):
    return auth_client.post(
        "/api/v1/auth/register",
        json={"email": "new@example.org", "password": password, "name": "New Person"},
    )


def test_the_minimum_is_eight():
    assert MIN_PASSWORD_LENGTH == 8


def test_registering_with_a_short_password_is_refused(auth_client, db):
    too_short(register(auth_client, SEVEN), "password")
    assert db.users.docs == {}


def test_registering_with_the_shortest_allowed_password_works(auth_client):
    assert register(auth_client, EIGHT).status_code == 201


def test_a_short_password_staged_on_a_cilogon_account_is_refused(auth_client, db, sent_emails):
    add_user(db, password_hash=None, sso_provider="cilogon", sso_external_id="held", email="new@example.org")
    too_short(register(auth_client, SEVEN), "password")
    assert sent_emails == []
    assert "pending_link" not in db.users.docs["u1"]


@pytest.mark.parametrize("password, status", [(SEVEN, 422), (EIGHT, 200)])
def test_a_reset_link_takes_only_a_long_enough_password(
    auth_client, db, sent_emails, password, status
):
    add_user(db)
    auth_client.post("/api/v1/auth/forgot-password", json={"email": "u1@example.org"})
    token = sent_emails[0][1].text.split("token=")[1].split("&")[0].split()[0]
    response = auth_client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": password}
    )
    assert response.status_code == status, response.text
    if status == 422:
        too_short(response, "new_password")
        assert verify_password(CURRENT, db.users.docs["u1"]["password_hash"])


def test_a_change_to_a_short_password_is_refused_and_keeps_the_old_one(auth_client, db):
    add_user(db)
    response = auth_client.post(
        "/api/v1/auth/change-password",
        json={"current_password": CURRENT, "new_password": SEVEN},
        headers=token_for("u1"),
    )
    too_short(response, "new_password")
    assert verify_password(CURRENT, db.users.docs["u1"]["password_hash"])


def test_a_change_to_the_shortest_allowed_password_works(auth_client, db):
    add_user(db)
    response = auth_client.post(
        "/api/v1/auth/change-password",
        json={"current_password": CURRENT, "new_password": EIGHT},
        headers=token_for("u1"),
    )
    assert response.status_code == 200, response.text
