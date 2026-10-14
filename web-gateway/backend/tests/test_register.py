"""POST /auth/register creates the account and starts no session: the form
sends the user to sign in, and that sign-in is the device's one session.

Runs the real route against the fake Mongo (tests/conftest.py).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import auth as auth_router
from app.core import sessions


@pytest.fixture
def auth_client(db, monkeypatch) -> TestClient:
    for module in (auth_router, sessions):
        monkeypatch.setattr(module, "get_db", lambda: db)

    async def recaptcha_ok(token):
        return True

    async def no_email(*args, **kwargs):
        return None

    monkeypatch.setattr(auth_router, "verify_recaptcha", recaptcha_ok)
    monkeypatch.setattr(auth_router, "_send_verification_email", no_email)
    app = FastAPI()
    app.include_router(auth_router.router, prefix="/api/v1")
    return TestClient(app)


def test_register_creates_the_account_and_no_session(auth_client, db):
    response = auth_client.post(
        "/api/v1/auth/register",
        json={
            "email": "new@example.org",
            "password": "a-long-password-1",
            "name": "New Person",
        },
        headers={"User-Agent": "node"},
    )
    assert response.status_code == 201, response.text
    assert response.json() == {"status": "registered", "email": "new@example.org"}
    assert [u["email"] for u in db.users.docs.values()].count("new@example.org") == 1
    assert db.refresh_tokens.docs == {}
