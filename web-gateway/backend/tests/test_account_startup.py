"""The startup steps for `users` (app/core/account_startup.py): lowercasing the
emails stored before requests were lowercased, and the unique index on the
CILogon identity.
"""

from __future__ import annotations

import asyncio
import inspect
import logging

from route_helpers import make_user

import main
from app.core import account_startup


def add(db, sub: str, email: str) -> None:
    db.users.docs[sub] = {**make_user(sub), "email": email}


def emails(db) -> dict[str, str]:
    return {u["_id"]: u["email"] for u in db.users.docs.values()}


def test_stored_emails_are_lowercased_in_place(db):
    add(db, "u1", "Ada.Lovelace@Purdue.EDU")
    add(db, "u2", "already@example.org")
    assert asyncio.run(account_startup.lowercase_emails(db)) == 1
    assert emails(db) == {"u1": "ada.lovelace@purdue.edu", "u2": "already@example.org"}


def test_running_it_again_changes_nothing(db):
    add(db, "u1", "Ada@Purdue.edu")
    asyncio.run(account_startup.lowercase_emails(db))
    assert asyncio.run(account_startup.lowercase_emails(db)) == 0
    assert emails(db) == {"u1": "ada@purdue.edu"}


def test_accounts_that_would_collide_are_left_alone_and_named_in_a_warning(db, caplog):
    add(db, "u1", "Kim@Example.org")
    add(db, "u2", "kim@example.org")
    add(db, "u3", "Fine@Example.org")
    with caplog.at_level(logging.WARNING, logger="app.core.account_startup"):
        assert asyncio.run(account_startup.lowercase_emails(db)) == 1
    assert emails(db) == {
        "u1": "Kim@Example.org",
        "u2": "kim@example.org",
        "u3": "fine@example.org",
    }
    (warning,) = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert "u1" in warning.getMessage() and "u2" in warning.getMessage()
    assert "u3" not in warning.getMessage()


def test_two_mixed_case_spellings_of_one_address_are_both_left_alone(db, caplog):
    add(db, "u1", "Kim@Example.org")
    add(db, "u2", "KIM@example.org")
    with caplog.at_level(logging.WARNING, logger="app.core.account_startup"):
        assert asyncio.run(account_startup.lowercase_emails(db)) == 0
    assert emails(db) == {"u1": "Kim@Example.org", "u2": "KIM@example.org"}
    assert "u1" in caplog.text and "u2" in caplog.text


class RecordingDB:
    """Records the indexes asked of `users`, which the fake Mongo does not enforce."""

    def __init__(self) -> None:
        self.indexes: list[tuple[tuple, dict]] = []
        self.users = self

    async def create_index(self, *args, **kwargs) -> None:
        self.indexes.append((args, kwargs))


def test_the_identity_index_is_unique_and_partial_on_strings():
    db = RecordingDB()
    asyncio.run(account_startup.ensure_sso_identity_index(db))
    assert db.indexes == [
        (
            ("sso_external_id",),
            {
                "unique": True,
                "partialFilterExpression": {"sso_external_id": {"$type": "string"}},
            },
        )
    ]


def test_startup_runs_both_steps():
    source = inspect.getsource(main.lifespan)
    assert "account_startup.lowercase_emails(db)" in source
    assert "account_startup.ensure_sso_identity_index(db)" in source
