"""POST /auth/login counts failed password sign-ins per email and per client IP
(app.core.login_throttle) and refuses with 429, before the password is checked,
once a key has used up its failures inside the window.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from conftest import SSO_SECRET
from route_helpers import make_user

from app.api.v1 import auth as auth_router
from app.core import login_throttle
from app.core.login_throttle import EMAIL_LIMIT, IP_LIMIT, WINDOW

PASSWORD = "a-long-password-1"
TRUSTED = {"X-Internal-Auth": SSO_SECRET, "X-Client-IP": "128.210.7.7"}


@pytest.fixture(autouse=True)
def _cheap_bcrypt(monkeypatch):
    """Dozens of wrong guesses per test: compare plainly instead of paying
    bcrypt for each. What is under test is the counting, not the hash."""
    monkeypatch.setattr(auth_router, "verify_password", lambda plain, hashed: plain == PASSWORD)


def add_user(db, sub: str = "u1") -> dict:
    doc = make_user(sub)
    doc["password_hash"] = "placeholder"
    db.users.docs[sub] = doc
    return doc


def attempt(auth_client, email: str = "u1@example.org", password: str = "wrong-password", headers=None):
    return auth_client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}, headers=headers or {}
    )


def fail(auth_client, times: int, email: str = "u1@example.org", headers=None) -> None:
    for _ in range(times):
        assert attempt(auth_client, email, headers=headers).status_code == 401


def audited(db, action: str) -> list[dict]:
    return [e for e in db.audit_events.docs.values() if e["action"] == action]


def age_failures(db, by: timedelta) -> None:
    for doc in db.login_failures.docs.values():
        doc["created_at"] -= by
        doc["expires_at"] -= by


def test_failures_under_the_email_limit_still_sign_in(auth_client, db):
    add_user(db)
    fail(auth_client, EMAIL_LIMIT - 1)
    assert attempt(auth_client, password=PASSWORD).status_code == 200


def test_the_failure_past_the_email_limit_is_a_429(auth_client, db):
    add_user(db)
    fail(auth_client, EMAIL_LIMIT)
    response = attempt(auth_client)
    assert response.status_code == 429
    assert response.json() == {"detail": "Too many sign-in attempts. Try again in a few minutes."}


def test_a_correct_password_does_not_get_past_a_throttled_email(auth_client, db):
    add_user(db)
    fail(auth_client, EMAIL_LIMIT)
    assert attempt(auth_client, password=PASSWORD).status_code == 429
    assert db.refresh_tokens.docs == {}


def test_a_blocked_attempt_is_not_counted(auth_client, db):
    add_user(db)
    fail(auth_client, EMAIL_LIMIT)
    for _ in range(5):
        attempt(auth_client)
    assert len(db.login_failures.docs) == EMAIL_LIMIT


def test_another_email_is_not_throttled_by_it(auth_client, db):
    add_user(db)
    add_user(db, "u2")
    fail(auth_client, EMAIL_LIMIT)
    assert attempt(auth_client, "u2@example.org", PASSWORD).status_code == 200


def test_email_case_does_not_dodge_the_counter(auth_client, db):
    add_user(db)
    for i in range(EMAIL_LIMIT):
        email = "U1@Example.org" if i % 2 else "u1@example.org"
        assert attempt(auth_client, email).status_code == 401
    assert attempt(auth_client, "u1@EXAMPLE.org", PASSWORD).status_code == 429


def test_an_unknown_email_counts_like_a_wrong_password(auth_client, db):
    fail(auth_client, EMAIL_LIMIT, email="nobody@example.org")
    response = attempt(auth_client, "nobody@example.org")
    assert response.status_code == 429
    # The same refusal a real address gets once it is throttled: nothing in it
    # says whether an account exists.
    add_user(db)
    fail(auth_client, EMAIL_LIMIT)
    assert attempt(auth_client).json() == response.json()


def test_an_account_without_a_password_counts_like_an_unknown_email(auth_client, db):
    doc = add_user(db)
    doc["password_hash"] = None
    fail(auth_client, EMAIL_LIMIT)
    assert attempt(auth_client).status_code == 429


def test_a_successful_sign_in_clears_that_emails_failures(auth_client, db):
    add_user(db)
    fail(auth_client, EMAIL_LIMIT - 1)
    assert attempt(auth_client, password=PASSWORD).status_code == 200
    assert db.login_failures.docs == {}
    fail(auth_client, EMAIL_LIMIT - 1)
    assert attempt(auth_client, password=PASSWORD).status_code == 200


def test_a_successful_sign_in_leaves_another_emails_failures(auth_client, db):
    add_user(db)
    add_user(db, "u2")
    fail(auth_client, 3, email="u2@example.org")
    assert attempt(auth_client, password=PASSWORD).status_code == 200
    assert len(db.login_failures.docs) == 3


def test_failures_expire_with_the_window(auth_client, db):
    add_user(db)
    fail(auth_client, EMAIL_LIMIT)
    assert attempt(auth_client, password=PASSWORD).status_code == 429
    age_failures(db, WINDOW + timedelta(seconds=1))
    assert attempt(auth_client, password=PASSWORD).status_code == 200


def test_failures_still_inside_the_window_still_count(auth_client, db):
    add_user(db)
    fail(auth_client, EMAIL_LIMIT)
    age_failures(db, WINDOW - timedelta(minutes=1))
    assert attempt(auth_client, password=PASSWORD).status_code == 429


def test_a_wrong_password_after_expiry_starts_a_fresh_count(auth_client, db):
    add_user(db)
    fail(auth_client, EMAIL_LIMIT)
    age_failures(db, WINDOW + timedelta(seconds=1))
    fail(auth_client, EMAIL_LIMIT)
    assert attempt(auth_client).status_code == 429


def test_the_ip_limit_blocks_every_email_from_that_address(auth_client, db):
    add_user(db)
    for i in range(IP_LIMIT):
        # One failure per address, so no email reaches its own limit.
        assert attempt(auth_client, f"guess{i}@example.org", headers=TRUSTED).status_code == 401
    response = attempt(auth_client, password=PASSWORD, headers=TRUSTED)
    assert response.status_code == 429
    assert response.json()["detail"] == "Too many sign-in attempts. Try again in a few minutes."


def test_under_the_ip_limit_still_signs_in(auth_client, db):
    add_user(db)
    for i in range(IP_LIMIT - 1):
        assert attempt(auth_client, f"guess{i}@example.org", headers=TRUSTED).status_code == 401
    assert attempt(auth_client, password=PASSWORD, headers=TRUSTED).status_code == 200


def test_another_ip_is_not_blocked(auth_client, db):
    add_user(db)
    for i in range(IP_LIMIT):
        attempt(auth_client, f"guess{i}@example.org", headers=TRUSTED)
    other = {**TRUSTED, "X-Client-IP": "128.210.7.8"}
    assert attempt(auth_client, password=PASSWORD, headers=other).status_code == 200


def test_a_successful_sign_in_does_not_clear_the_ips_failures(auth_client, db):
    add_user(db)
    fail(auth_client, 3, headers=TRUSTED)
    assert attempt(auth_client, password=PASSWORD, headers=TRUSTED).status_code == 200
    assert {d["kind"] for d in db.login_failures.docs.values()} == {"ip"}
    assert len(db.login_failures.docs) == 3


def test_ip_failures_expire_with_the_window(auth_client, db):
    add_user(db)
    for i in range(IP_LIMIT):
        attempt(auth_client, f"guess{i}@example.org", headers=TRUSTED)
    age_failures(db, WINDOW + timedelta(seconds=1))
    assert attempt(auth_client, password=PASSWORD, headers=TRUSTED).status_code == 200


def test_a_throttled_attempt_is_audited_with_a_reason_and_no_password(auth_client, db):
    add_user(db)
    fail(auth_client, EMAIL_LIMIT)
    attempt(auth_client, password=PASSWORD)
    (event,) = audited(db, "login_throttled")
    assert event["actor_id"] == "anonymous"
    assert event["detail"] == {
        "attempted_email": "u1@example.org",
        "reason": "too_many_failures_for_email",
    }
    assert PASSWORD not in str(db.audit_events.docs)
    assert len(audited(db, "login_failed")) == EMAIL_LIMIT
    assert audited(db, "login_succeeded") == []


def test_an_ip_throttle_is_audited_as_one(auth_client, db):
    for i in range(IP_LIMIT):
        attempt(auth_client, f"guess{i}@example.org", headers=TRUSTED)
    attempt(auth_client, "someone@example.org", headers=TRUSTED)
    (event,) = audited(db, "login_throttled")
    assert event["detail"]["reason"] == "too_many_failures_for_ip"


# ---- which address counts ------------------------------------------------------


@pytest.mark.parametrize(
    "headers",
    [
        {"X-Client-IP": "128.210.7.7"},
        {"X-Internal-Auth": "wrong", "X-Client-IP": "128.210.7.7"},
        {"X-Internal-Auth": SSO_SECRET},
        {"X-Internal-Auth": SSO_SECRET, "X-Client-IP": "not-an-ip"},
    ],
)
def test_an_address_without_proof_or_not_an_address_is_not_counted(auth_client, db, headers):
    fail(auth_client, 2, email="nobody@example.org", headers=headers)
    assert {d["kind"] for d in db.login_failures.docs.values()} == {"email"}


def test_with_no_secret_configured_no_address_is_believed(auth_client, db, monkeypatch):
    monkeypatch.setattr(login_throttle.settings, "INTERNAL_SERVICE_SECRET", "")
    fail(auth_client, 2, email="nobody@example.org", headers={"X-Internal-Auth": "", **TRUSTED})
    assert {d["kind"] for d in db.login_failures.docs.values()} == {"email"}


def test_an_unproven_header_cannot_spend_someone_elses_ip(auth_client, db):
    for i in range(IP_LIMIT):
        attempt(auth_client, f"guess{i}@example.org", headers=TRUSTED)
    spoofed = {"X-Client-IP": "128.210.7.7"}
    assert attempt(auth_client, "nobody@example.org", headers=spoofed).status_code == 401


def test_an_ipv6_address_counts_by_its_64(auth_client):
    ip = login_throttle.client_ip
    first = ip(SSO_SECRET, "2607:f8b0:4004:c1b:aaaa::1")
    assert first == "2607:f8b0:4004:c1b::/64"
    assert first == ip(SSO_SECRET, "2607:f8b0:4004:c1b:bbbb::9")
    assert first != ip(SSO_SECRET, "2607:f8b0:4004:c1c::1")
    assert ip(SSO_SECRET, "128.210.7.7") == "128.210.7.7"


@pytest.mark.parametrize(
    "address",
    [
        "10.42.14.0",  # the Anvil Cloud ingress's SNAT address
        "127.0.0.1",
        "::1",
        "192.168.1.5",
        "169.254.1.1",
        "100.64.0.1",  # shared CGNAT
        "203.0.113.7",  # documentation range
        "fe80::1",
        "fd00::1",
        "2001:db8::1",  # documentation range
        "::ffff:10.42.14.0",  # IPv4-mapped, private
    ],
)
def test_a_non_public_address_is_never_a_client(address):
    assert login_throttle.client_ip(SSO_SECRET, address) is None


def test_an_ipv4_mapped_public_address_is_keyed_as_the_ipv4(auth_client):
    assert login_throttle.client_ip(SSO_SECRET, "::ffff:128.210.7.7") == "128.210.7.7"


@pytest.mark.parametrize("address", ["10.42.14.0", "127.0.0.1", "::1"])
def test_a_proxy_address_does_not_lock_everyone_out(auth_client, db, address):
    add_user(db)
    proxy = {**TRUSTED, "X-Client-IP": address}
    for i in range(IP_LIMIT + 5):
        assert attempt(auth_client, f"guess{i}@example.org", headers=proxy).status_code == 401
    assert {d["kind"] for d in db.login_failures.docs.values()} == {"email"}
    assert attempt(auth_client, password=PASSWORD, headers=proxy).status_code == 200


def test_a_failure_document_carries_its_own_expiry(auth_client, db):
    add_user(db)
    fail(auth_client, 1)
    (doc,) = [d for d in db.login_failures.docs.values() if d["kind"] == "email"]
    assert doc["key"] == "u1@example.org"
    assert doc["expires_at"] - doc["created_at"] == WINDOW


def test_cilogon_sign_in_is_not_throttled_and_counts_nothing(auth_client, db):
    doc = add_user(db)
    doc.update(sso_provider="cilogon", sso_external_id="held", sso_email="u1@example.org")
    fail(auth_client, EMAIL_LIMIT)
    response = auth_client.post(
        "/api/v1/auth/sso-login",
        json={
            "email": "u1@example.org",
            "name": "U",
            "external_id": "held",
            "provider": "cilogon",
        },
        headers={"X-Internal-Auth": SSO_SECRET},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ok"
    assert len(db.login_failures.docs) == EMAIL_LIMIT
