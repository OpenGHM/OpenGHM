"""CILogon sign-in works like "Sign in with Google" on an ordinary site:
a connected identity signs in to its account, an unknown one is connected to
the account with the same email (or creates one), and a signed-in user can
connect an identity from the profile whatever its email is.

Runs the real routes against the fake Mongo (tests/conftest.py `auth_client`).
"""

from __future__ import annotations

import asyncio

import pytest
from route_helpers import NOW, make_user, token_for

from app.core import pending_sso, sessions
from app.core.security import hash_password, hash_token
from app.models.user import SsoLoginRequest

from conftest import SSO_SECRET

SECRET = {"X-Internal-Auth": SSO_SECRET}
IDENTITY = {
    "email": "ada@purdue.edu",
    "name": "Ada Lovelace",
    "external_id": "http://cilogon.org/serverA/users/1",
    "provider": "cilogon",
    "organization": "Purdue University Main Campus",
}


def add_user(db, sub: str, **over) -> dict:
    """An account with a password and a verified address, unless `over` says
    otherwise; a key set to None is left out."""
    doc = make_user(sub)
    doc["password_hash"] = hash_password("a-long-password-1")
    doc.update(over)
    doc = {k: v for k, v in doc.items() if v is not None}
    db.users.docs[sub] = doc
    return doc


def sign_in(auth_client, **over):
    return auth_client.post(
        "/api/v1/auth/sso-login",
        json={**IDENTITY, **over},
        headers={**SECRET, "User-Agent": "Firefox"},
    )


def start_session(db, auth_client, user_id: str) -> str:
    session_id, _ = asyncio.run(sessions.create_session(user_id, "old device"))
    return session_id


def audit_actions(db, action: str) -> list[dict]:
    return [e for e in db.audit_events.docs.values() if e["action"] == action]


class TestConnectedIdentity:
    def test_signs_in_to_the_account_it_is_connected_to(self, auth_client, db):
        add_user(
            db,
            "u1",
            email="ada@example.org",
            name="Ada L.",
            sso_provider="cilogon",
            sso_external_id=IDENTITY["external_id"],
            sso_email="ada@purdue.edu",
        )
        response = sign_in(auth_client)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "ok"
        # The account's own name and email, not the identity's.
        assert body["auth"]["user"]["id"] == "u1"
        assert body["auth"]["user"]["email"] == "ada@example.org"
        assert body["auth"]["user"]["name"] == "Ada L."
        assert len(db.users.docs) == 1
        assert [s["user_id"] for s in db.refresh_tokens.docs.values()] == ["u1"]

    def test_refreshes_the_address_cilogon_gave_this_time(self, auth_client, db):
        add_user(
            db,
            "u1",
            sso_provider="cilogon",
            sso_external_id=IDENTITY["external_id"],
            sso_email="old@purdue.edu",
        )
        sign_in(auth_client)
        assert db.users.docs["u1"]["sso_email"] == "ada@purdue.edu"

    def test_keeps_the_address_when_cilogon_gives_none(self, auth_client, db):
        add_user(
            db,
            "u1",
            sso_provider="cilogon",
            sso_external_id=IDENTITY["external_id"],
            sso_email="old@purdue.edu",
        )
        response = sign_in(auth_client, email=None)
        assert response.json()["status"] == "ok"
        assert db.users.docs["u1"]["sso_email"] == "old@purdue.edu"

    def test_fills_an_empty_organization_but_never_overwrites_one(
        self, auth_client, db
    ):
        add_user(db, "u1", sso_external_id=IDENTITY["external_id"], organization=None)
        add_user(
            db,
            "u2",
            email="u2@example.org",
            sso_external_id="other",
            organization="Mine",
        )
        sign_in(auth_client)
        sign_in(auth_client, external_id="other")
        assert db.users.docs["u1"]["organization"] == "Purdue University Main Campus"
        assert db.users.docs["u2"]["organization"] == "Mine"

    def test_a_deactivated_account_is_refused(self, auth_client, db):
        add_user(db, "u1", sso_external_id=IDENTITY["external_id"], is_active=False)
        response = sign_in(auth_client)
        assert response.status_code == 401
        assert "deactivated" in response.json()["detail"]
        assert db.refresh_tokens.docs == {}

    def test_needs_the_internal_secret(self, auth_client, db):
        for headers in ({}, {"X-Internal-Auth": "wrong"}):
            response = auth_client.post(
                "/api/v1/auth/sso-login", json=IDENTITY, headers=headers
            )
            assert response.status_code == 401
        assert db.users.docs == {}


class TestMatchingEmail:
    def test_a_verified_account_is_connected_and_keeps_its_password(
        self, auth_client, db
    ):
        add_user(db, "u1", email="ada@purdue.edu", email_verified=True)
        old_session = start_session(db, auth_client, "u1")
        response = sign_in(auth_client)
        assert response.status_code == 200, response.text
        assert response.json()["auth"]["user"]["id"] == "u1"
        user = db.users.docs["u1"]
        assert user["sso_provider"] == "cilogon"
        assert user["sso_external_id"] == IDENTITY["external_id"]
        assert user["sso_email"] == "ada@purdue.edu"
        assert user["email_verified"] is True
        assert user["password_hash"]
        # Nothing was suspect, so the account's other devices stay signed in.
        assert old_session in db.refresh_tokens.docs
        assert len(db.users.docs) == 1
        (event,) = audit_actions(db, "sso_account_linked")
        assert event["detail"] == {
            "provider": "cilogon",
            "via": "email",
            "password_removed": False,
        }

    def test_an_unverified_account_loses_its_password_and_every_session(
        self, auth_client, db
    ):
        # Someone may have registered the owner's address first: whatever
        # password and sessions the account has are theirs, not the owner's.
        add_user(db, "u1", email="ada@purdue.edu", email_verified=False)
        add_user(db, "u2", email="u2@example.org")
        squatter = start_session(db, auth_client, "u1")
        bystander = start_session(db, auth_client, "u2")

        response = sign_in(auth_client)
        assert response.status_code == 200, response.text

        user = db.users.docs["u1"]
        assert "password_hash" not in user
        assert user["email_verified"] is True
        assert user["sso_external_id"] == IDENTITY["external_id"]
        assert squatter not in db.refresh_tokens.docs
        assert bystander in db.refresh_tokens.docs
        # The sign-in that did it holds the one session the account now has.
        assert [s["user_id"] for s in db.refresh_tokens.docs.values()].count("u1") == 1
        (event,) = audit_actions(db, "sso_account_linked")
        assert event["detail"] == {
            "provider": "cilogon",
            "via": "email",
            "password_removed": True,
        }

    def test_the_removed_password_no_longer_signs_in(self, auth_client, db):
        add_user(db, "u1", email="ada@purdue.edu", email_verified=False)
        sign_in(auth_client)
        login = auth_client.post(
            "/api/v1/auth/login",
            json={"email": "ada@purdue.edu", "password": "a-long-password-1"},
        )
        assert login.status_code == 401

    def test_the_address_is_matched_whatever_its_case(self, auth_client, db):
        add_user(db, "u1", email="ada@purdue.edu")
        response = sign_in(auth_client, email="Ada@Purdue.EDU")
        assert response.json()["auth"]["user"]["id"] == "u1"
        assert len(db.users.docs) == 1
        assert db.users.docs["u1"]["sso_email"] == "ada@purdue.edu"

    def test_a_deactivated_account_is_refused_and_left_alone(self, auth_client, db):
        add_user(
            db, "u1", email="ada@purdue.edu", is_active=False, email_verified=False
        )
        response = sign_in(auth_client)
        assert response.status_code == 401
        assert "deactivated" in response.json()["detail"]
        assert "sso_external_id" not in db.users.docs["u1"]
        assert db.users.docs["u1"]["password_hash"]
        assert db.refresh_tokens.docs == {}

    def test_an_account_connected_to_a_different_identity_is_refused(
        self, auth_client, db
    ):
        add_user(
            db,
            "u1",
            email="ada@purdue.edu",
            sso_provider="cilogon",
            sso_external_id="http://cilogon.org/serverA/users/other",
        )
        response = sign_in(auth_client)
        assert response.status_code == 409
        assert response.json()["detail"] == (
            "This email's OpenGHM account is connected to a different CILogon "
            "identity. Sign in with that one."
        )
        assert db.users.docs["u1"]["sso_external_id"].endswith("/other")
        assert db.refresh_tokens.docs == {}


class TestNoMatchingAccount:
    def test_creates_an_account_that_remembers_the_address(self, auth_client, db):
        response = sign_in(auth_client)
        assert response.status_code == 200, response.text
        (user,) = db.users.docs.values()
        assert user["email"] == "ada@purdue.edu"
        assert user["sso_email"] == "ada@purdue.edu"
        assert user["sso_external_id"] == IDENTITY["external_id"]
        assert user["email_verified"] is True
        assert user["password_hash"] is None
        assert user["organization"] == "Purdue University Main Campus"
        assert response.json()["auth"]["user"]["id"] == user["_id"]
        assert len(audit_actions(db, "sso_account_created")) == 1

    def test_the_address_is_stored_lowercase(self, auth_client, db):
        sign_in(auth_client, email="Ada.Lovelace@Purdue.EDU")
        (user,) = db.users.docs.values()
        assert user["email"] == user["sso_email"] == "ada.lovelace@purdue.edu"


class TestNoEmailFromCilogon:
    def test_asks_for_the_missing_fields_as_before(self, auth_client, db):
        response = sign_in(auth_client, email=None)
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "needs_completion"
        assert body["auth"] is None
        assert db.users.docs == {}
        (pending,) = db.pending_sso_signups.docs.values()
        assert pending["kind"] == "signup"
        assert pending["_id"] == hash_token(body["completion_token"])

    def test_completing_it_still_creates_the_account_with_a_lowercase_email(
        self, auth_client, db
    ):
        token = sign_in(auth_client, email=None).json()["completion_token"]
        response = auth_client.post(
            "/api/v1/auth/complete-sso-signup",
            json={
                "completion_token": token,
                "email": "Typed@Example.ORG",
                "name": "Ada",
            },
        )
        assert response.status_code == 200, response.text
        (user,) = db.users.docs.values()
        assert user["email"] == "typed@example.org"
        assert user["email_verified"] is False
        assert db.pending_sso_signups.docs == {}

    def test_a_connect_token_cannot_complete_a_signup(self, auth_client, db):
        add_user(db, "u1")
        intent = auth_client.post(
            "/api/v1/auth/sso-connect-intent", headers=token_for("u1")
        )
        response = auth_client.post(
            "/api/v1/auth/complete-sso-signup",
            json={
                "completion_token": intent.json()["connect_token"],
                "email": "x@example.org",
                "name": "X",
            },
        )
        assert response.status_code == 400

    def test_an_old_pending_document_without_kind_is_a_signup(self, auth_client, db):
        asyncio.run(
            pending_sso.create_pending(hash_token("old"), "ext", "cilogon", "A", None)
        )
        del db.pending_sso_signups.docs[hash_token("old")]["kind"]
        response = auth_client.post(
            "/api/v1/auth/complete-sso-signup",
            json={"completion_token": "old", "email": "a@example.org", "name": "A"},
        )
        assert response.status_code == 200, response.text


class TestLowercasedEmails:
    @pytest.mark.parametrize(
        "model, extra",
        [
            ("LoginRequest", {"password": "x"}),
            ("RegisterRequest", {"password": "a-long-password-1", "name": "N"}),
            ("ForgotPasswordRequest", {}),
            ("CompleteSsoSignupRequest", {"completion_token": "t", "name": "N"}),
            ("SsoLoginRequest", {"external_id": "e", "provider": "cilogon"}),
        ],
    )
    def test_every_request_model_lowercases_the_whole_address(self, model, extra):
        from app.models import user as models

        request = getattr(models, model)(email="Ada.Lovelace@Purdue.EDU", **extra)
        assert request.email == "ada.lovelace@purdue.edu"

    def test_an_sso_login_without_an_email_stays_without_one(self):
        assert SsoLoginRequest(external_id="e", provider="cilogon").email is None

    def test_register_stores_the_lowercase_address_and_login_finds_it(
        self, auth_client, db
    ):
        response = auth_client.post(
            "/api/v1/auth/register",
            json={
                "email": "New.Person@Example.ORG",
                "password": "a-long-password-1",
                "name": "N",
            },
        )
        assert response.status_code == 201, response.text
        assert response.json()["email"] == "new.person@example.org"
        (user,) = db.users.docs.values()
        assert user["email"] == "new.person@example.org"
        login = auth_client.post(
            "/api/v1/auth/login",
            json={"email": "NEW.person@example.org", "password": "a-long-password-1"},
        )
        assert login.status_code == 200, login.text

    def test_registering_a_differently_cased_address_is_a_duplicate(
        self, auth_client, db
    ):
        add_user(db, "u1", email="ada@example.org")
        response = auth_client.post(
            "/api/v1/auth/register",
            json={
                "email": "ADA@example.org",
                "password": "a-long-password-1",
                "name": "N",
            },
        )
        assert response.status_code == 409


class TestConnectFromTheProfile:
    def intent(self, auth_client, user_id: str) -> str:
        response = auth_client.post(
            "/api/v1/auth/sso-connect-intent", headers=token_for(user_id)
        )
        assert response.status_code == 200, response.text
        return response.json()["connect_token"]

    def test_the_intent_needs_a_signed_in_user(self, auth_client, db):
        add_user(db, "u1")
        assert auth_client.post("/api/v1/auth/sso-connect-intent").status_code == 401

    def test_the_intent_is_stored_for_ten_minutes_as_a_connect_document(
        self, auth_client, db
    ):
        add_user(db, "u1")
        token = self.intent(auth_client, "u1")
        doc = db.pending_sso_signups.docs[hash_token(token)]
        assert doc["kind"] == "connect"
        assert doc["user_id"] == "u1"
        assert doc["expires_at"] - doc["created_at"] == pending_sso.CONNECT_EXPIRE
        assert pending_sso.CONNECT_EXPIRE.total_seconds() == 600

    def test_an_account_with_an_identity_cannot_start_another(self, auth_client, db):
        add_user(db, "u1", sso_provider="cilogon", sso_external_id="held")
        response = auth_client.post(
            "/api/v1/auth/sso-connect-intent", headers=token_for("u1")
        )
        assert response.status_code == 409
        assert db.pending_sso_signups.docs == {}

    def test_attaches_the_identity_without_touching_the_accounts_email(
        self, auth_client, db
    ):
        add_user(
            db, "u1", email="ada@gmail.com", organization=None, email_verified=False
        )
        token = self.intent(auth_client, "u1")
        response = sign_in(auth_client, connect_token=token)
        assert response.status_code == 200, response.text
        assert response.json() == {
            "status": "connected",
            "auth": None,
            "completion_token": None,
        }
        user = db.users.docs["u1"]
        assert user["email"] == "ada@gmail.com"
        assert user["sso_provider"] == "cilogon"
        assert user["sso_external_id"] == IDENTITY["external_id"]
        assert user["sso_email"] == "ada@purdue.edu"
        # CILogon vouched for another address than the account's own.
        assert user["email_verified"] is False
        assert user["organization"] == "Purdue University Main Campus"
        # Not a sign-in: no session, and the intent is spent.
        assert db.refresh_tokens.docs == {}
        assert db.pending_sso_signups.docs == {}
        (event,) = audit_actions(db, "sso_account_linked")
        assert event["detail"] == {"provider": "cilogon", "via": "profile"}
        assert event["actor_id"] == "u1"

    def test_verifies_the_address_only_when_it_is_the_one_cilogon_gave(
        self, auth_client, db
    ):
        add_user(db, "u1", email="ada@purdue.edu", email_verified=False)
        sign_in(auth_client, connect_token=self.intent(auth_client, "u1"))
        assert db.users.docs["u1"]["email_verified"] is True

    def test_never_overwrites_an_organization_the_user_has(self, auth_client, db):
        add_user(db, "u1", organization="Mine")
        sign_in(auth_client, connect_token=self.intent(auth_client, "u1"))
        assert db.users.docs["u1"]["organization"] == "Mine"

    def test_an_identity_another_account_holds_is_refused(self, auth_client, db):
        add_user(db, "u1")
        add_user(
            db, "u2", email="u2@example.org", sso_external_id=IDENTITY["external_id"]
        )
        token = self.intent(auth_client, "u1")
        response = sign_in(auth_client, connect_token=token)
        assert response.status_code == 409
        assert response.json()["detail"] == (
            "This CILogon identity is already connected to another OpenGHM account."
        )
        assert "sso_external_id" not in db.users.docs["u1"]
        # Spent whatever happens: it is not usable a second time.
        assert db.pending_sso_signups.docs == {}
        assert sign_in(auth_client, connect_token=token).status_code == 400

    def test_an_account_that_got_an_identity_meanwhile_is_refused(
        self, auth_client, db
    ):
        add_user(db, "u1")
        token = self.intent(auth_client, "u1")
        db.users.docs["u1"]["sso_external_id"] = "connected-in-another-tab"
        response = sign_in(auth_client, connect_token=token)
        assert response.status_code == 409
        assert db.users.docs["u1"]["sso_external_id"] == "connected-in-another-tab"
        assert db.pending_sso_signups.docs == {}

    def test_a_deactivated_account_is_refused_and_the_intent_spent(
        self, auth_client, db
    ):
        add_user(db, "u1")
        token = self.intent(auth_client, "u1")
        db.users.docs["u1"]["is_active"] = False
        response = sign_in(auth_client, connect_token=token)
        assert response.status_code == 401
        assert "deactivated" in response.json()["detail"]
        assert "sso_external_id" not in db.users.docs["u1"]
        assert db.pending_sso_signups.docs == {}

    def test_an_unknown_or_expired_token_is_a_400(self, auth_client, db):
        add_user(db, "u1")
        assert sign_in(auth_client, connect_token="nope").status_code == 400
        token = self.intent(auth_client, "u1")
        db.pending_sso_signups.docs[hash_token(token)]["expires_at"] = NOW
        assert sign_in(auth_client, connect_token=token).status_code == 400
        assert "sso_external_id" not in db.users.docs["u1"]
        assert len(db.users.docs) == 1

    def test_a_connect_token_needs_the_internal_secret_too(self, auth_client, db):
        add_user(db, "u1")
        token = self.intent(auth_client, "u1")
        response = auth_client.post(
            "/api/v1/auth/sso-login", json={**IDENTITY, "connect_token": token}
        )
        assert response.status_code == 401
        assert "sso_external_id" not in db.users.docs["u1"]


class TestDisconnect:
    def test_removes_the_identity_of_an_account_that_has_a_password(
        self, auth_client, db
    ):
        add_user(
            db,
            "u1",
            sso_provider="cilogon",
            sso_external_id="held",
            sso_email="ada@purdue.edu",
        )
        response = auth_client.delete("/api/v1/users/me/sso", headers=token_for("u1"))
        assert response.status_code == 204, response.text
        user = db.users.docs["u1"]
        assert not {"sso_provider", "sso_external_id", "sso_email"} & user.keys()
        assert user["password_hash"]
        (event,) = audit_actions(db, "sso_account_unlinked")
        assert event["actor_id"] == "u1"
        assert event["detail"] == {"provider": "cilogon"}

    def test_the_identity_can_then_be_connected_elsewhere(self, auth_client, db):
        add_user(
            db, "u1", sso_provider="cilogon", sso_external_id=IDENTITY["external_id"]
        )
        add_user(db, "u2", email="u2@example.org")
        auth_client.delete("/api/v1/users/me/sso", headers=token_for("u1"))
        token = auth_client.post(
            "/api/v1/auth/sso-connect-intent", headers=token_for("u2")
        ).json()["connect_token"]
        assert sign_in(auth_client, connect_token=token).json()["status"] == "connected"

    def test_refused_when_none_is_connected(self, auth_client, db):
        add_user(db, "u1")
        response = auth_client.delete("/api/v1/users/me/sso", headers=token_for("u1"))
        assert response.status_code == 400
        assert audit_actions(db, "sso_account_unlinked") == []

    def test_refused_when_it_is_the_only_way_to_sign_in(self, auth_client, db):
        add_user(
            db, "u1", password_hash=None, sso_provider="cilogon", sso_external_id="held"
        )
        response = auth_client.delete("/api/v1/users/me/sso", headers=token_for("u1"))
        assert response.status_code == 400
        assert response.json()["detail"] == (
            "This account has no password, so CILogon is its only way to sign in."
        )
        assert db.users.docs["u1"]["sso_external_id"] == "held"

    def test_needs_a_signed_in_user(self, auth_client, db):
        assert auth_client.delete("/api/v1/users/me/sso").status_code == 401


class TestWhatTheProfileShows:
    def test_me_says_how_the_account_signs_in_without_the_secrets(
        self, auth_client, db
    ):
        add_user(
            db,
            "u1",
            sso_provider="cilogon",
            sso_external_id="held",
            sso_email="ada@purdue.edu",
        )
        body = auth_client.get("/api/v1/users/me", headers=token_for("u1")).json()
        assert body["sso_provider"] == "cilogon"
        assert body["sso_email"] == "ada@purdue.edu"
        assert body["has_password"] is True
        assert "sso_external_id" not in body
        assert "password_hash" not in body

    def test_me_of_a_cilogon_only_account_has_no_password(self, auth_client, db):
        add_user(db, "u1", password_hash=None)
        body = auth_client.get("/api/v1/users/me", headers=token_for("u1")).json()
        assert body["has_password"] is False
        assert body["sso_provider"] is None
        assert body["sso_email"] is None

    def test_patching_the_profile_answers_the_same_shape(self, auth_client, db):
        add_user(
            db,
            "u1",
            sso_provider="cilogon",
            sso_external_id="held",
            sso_email="a@purdue.edu",
        )
        body = auth_client.patch(
            "/api/v1/users/me", json={"name": "New name"}, headers=token_for("u1")
        ).json()
        assert body["name"] == "New name"
        assert body["has_password"] is True
        assert body["sso_email"] == "a@purdue.edu"

    def test_the_admin_detail_shows_them_too_and_never_the_secrets(
        self, auth_client, db
    ):
        from app.core.roles import Role

        db.users.docs["admin"] = make_user("admin", Role.ADMIN)
        add_user(
            db,
            "u1",
            sso_provider="cilogon",
            sso_external_id="held",
            sso_email="ada@purdue.edu",
        )
        response = auth_client.get(
            "/api/v1/users/u1", headers=token_for("admin", Role.ADMIN)
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["sso_provider"] == "cilogon"
        assert body["sso_email"] == "ada@purdue.edu"
        assert body["has_password"] is True
        assert "sso_external_id" not in body
        assert "password_hash" not in body


def test_a_mailed_identity_link_that_lost_the_race_is_a_409_and_spent(auth_client, db, monkeypatch):
    """confirm-link applying an identity another account took after the mail
    went out: the unique index refuses it, and the answer is 409, not 500."""
    from datetime import datetime, timedelta, timezone

    from pymongo.errors import DuplicateKeyError

    add_user(
        db,
        "sam",
        pending_link={"type": "sso", "sso_provider": "cilogon", "sso_external_id": "taken"},
        link_token_hash=hash_token("link-token"),
        link_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    real_update = db.users.update_one

    async def unique_index(query, update, **kwargs):
        if update.get("$set", {}).get("sso_external_id") == "taken":
            raise DuplicateKeyError("E11000 duplicate key error: sso_external_id")
        return await real_update(query, update, **kwargs)

    monkeypatch.setattr(db.users, "update_one", unique_index)
    response = auth_client.post("/api/v1/auth/confirm-link", json={"token": "link-token"})
    assert response.status_code == 409
    sam = db.users.docs["sam"]
    assert "sso_external_id" not in sam
    assert "pending_link" not in sam and "link_token_hash" not in sam
