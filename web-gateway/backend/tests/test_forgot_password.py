"""POST /auth/forgot-password mails any active account that has a password or
a verified address, so an account CILogon created (no password) can get one.
It answers 200 whatever the address is, so it cannot be used to find accounts.
"""

from __future__ import annotations

from route_helpers import make_user

from app.core.security import hash_password

ANSWER = {"detail": "If an account exists for that email, a reset link has been sent."}


def add_user(db, sub: str, **over) -> dict:
    doc = make_user(sub)
    doc["password_hash"] = hash_password("a-long-password-1")
    doc.update(over)
    doc = {k: v for k, v in doc.items() if v is not None}
    db.users.docs[sub] = doc
    return doc


def forgot(auth_client, email: str):
    response = auth_client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert response.status_code == 200
    assert response.json() == ANSWER
    return response


def test_an_account_with_a_password_gets_a_reset_link(auth_client, db, sent_emails):
    add_user(db, "u1", email_verified=False)
    forgot(auth_client, "u1@example.org")
    ((to, message),) = sent_emails
    assert to == "u1@example.org"
    assert message.subject == "Reset your OpenGHM password"
    assert "/auth/reset-password?token=" in message.text
    assert "&set=1" not in message.text
    assert db.users.docs["u1"]["reset_token_hash"]


def test_a_cilogon_only_account_with_a_verified_email_gets_a_link_to_set_one(
    auth_client, db, sent_emails
):
    add_user(
        db, "u1", password_hash=None, sso_provider="cilogon", sso_external_id="held"
    )
    forgot(auth_client, "u1@example.org")
    ((to, message),) = sent_emails
    assert to == "u1@example.org"
    assert message.subject == "Set a password for your OpenGHM account"
    assert "/auth/reset-password?token=" in message.text
    assert "&set=1" in message.text
    assert db.users.docs["u1"]["reset_token_hash"]


def test_a_reset_link_sets_the_first_password_of_a_cilogon_only_account(
    auth_client, db, sent_emails
):
    add_user(
        db, "u1", password_hash=None, sso_provider="cilogon", sso_external_id="held"
    )
    forgot(auth_client, "u1@example.org")
    token = sent_emails[0][1].text.split("token=")[1].split("&")[0].split()[0]
    reset = auth_client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "brand-new-pass-1"},
    )
    assert reset.status_code == 200, reset.text
    login = auth_client.post(
        "/api/v1/auth/login",
        json={"email": "u1@example.org", "password": "brand-new-pass-1"},
    )
    assert login.status_code == 200, login.text


def test_an_account_with_neither_a_password_nor_a_verified_email_gets_nothing(
    auth_client, db, sent_emails
):
    add_user(db, "u1", password_hash=None, email_verified=False)
    forgot(auth_client, "u1@example.org")
    assert sent_emails == []
    assert "reset_token_hash" not in db.users.docs["u1"]


def test_a_deactivated_account_gets_nothing(auth_client, db, sent_emails):
    add_user(db, "u1", is_active=False)
    add_user(db, "u2", email="u2@example.org", password_hash=None, is_active=False)
    forgot(auth_client, "u1@example.org")
    forgot(auth_client, "u2@example.org")
    assert sent_emails == []


def test_an_unknown_address_gets_the_same_answer_and_no_email(
    auth_client, db, sent_emails
):
    forgot(auth_client, "nobody@example.org")
    assert sent_emails == []


def test_the_address_is_matched_whatever_its_case(auth_client, db, sent_emails):
    add_user(db, "u1")
    forgot(auth_client, "U1@Example.ORG")
    assert [to for to, _ in sent_emails] == ["u1@example.org"]
