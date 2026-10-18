"""GET /admin/audit-log's filters (actor, day range) and GET /admin/user-labels:
the batched lookup behind the names the admin tables show in place of ids.

The router runs over the in-memory Mongo (tests/route_helpers.py).
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import admin as admin_router
from app.core.roles import Role

from route_helpers import make_user, token_for

AUDIT = "/api/v1/admin/audit-log"
LABELS = "/api/v1/admin/user-labels"
STAFF = token_for("staff", Role.STAFF)


@pytest.fixture
def api(db, monkeypatch) -> TestClient:
    monkeypatch.setattr(admin_router, "get_db", lambda: db)
    app = FastAPI()
    app.include_router(admin_router.router, prefix="/api/v1")
    return TestClient(app)


def _event(db, id_: str, actor: str, when: datetime, category: str = "job") -> None:
    db.audit_events.docs[id_] = {
        "_id": id_,
        "action": "job_submitted",
        "category": category,
        "actor_id": actor,
        "actor_email": f"{actor}@example.org",
        "target_id": None,
        "detail": None,
        "created_at": when,
    }


def _at(day: int, hour: int = 12) -> datetime:
    return datetime(2026, 10, day, hour, tzinfo=timezone.utc)


def _ids(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def test_the_actor_filter_keeps_only_that_users_events(api, db):
    _event(db, "a1", "alice", _at(1))
    _event(db, "b1", "bob", _at(2))
    _event(db, "a2", "alice", _at(3))
    _event(db, "s1", "system", _at(4))

    response = api.get(AUDIT, params={"actor_id": "alice"}, headers=STAFF)
    assert _ids(response) == ["a2", "a1"]
    assert response.json()["total_count"] == 2
    assert _ids(api.get(AUDIT, params={"actor_id": "system"}, headers=STAFF)) == ["s1"]
    assert _ids(api.get(AUDIT, headers=STAFF)) == ["s1", "a2", "b1", "a1"]


def test_the_day_range_includes_both_ends_in_utc(api, db):
    _event(db, "before", "alice", datetime(2026, 10, 1, 23, 59, 59, tzinfo=timezone.utc))
    _event(db, "first", "alice", _at(2, 0))
    _event(db, "last", "alice", datetime(2026, 10, 3, 23, 59, 59, tzinfo=timezone.utc))
    _event(db, "after", "alice", _at(4, 0))

    both = api.get(AUDIT, params={"date_from": "2026-10-02", "date_to": "2026-10-03"}, headers=STAFF)
    assert _ids(both) == ["last", "first"]
    assert _ids(api.get(AUDIT, params={"date_from": "2026-10-03"}, headers=STAFF)) == ["after", "last"]
    assert _ids(api.get(AUDIT, params={"date_to": "2026-10-02"}, headers=STAFF)) == ["first", "before"]


def test_the_filters_combine(api, db):
    _event(db, "a-in", "alice", _at(2), category="job")
    _event(db, "a-out", "alice", _at(9), category="job")
    _event(db, "b-in", "bob", _at(2), category="job")
    _event(db, "a-sys", "alice", _at(2), category="system")

    response = api.get(
        AUDIT,
        params={"actor_id": "alice", "category": "job", "date_from": "2026-10-01", "date_to": "2026-10-03"},
        headers=STAFF,
    )
    assert _ids(response) == ["a-in"]


def test_a_malformed_day_is_refused(api):
    assert api.get(AUDIT, params={"date_from": "yesterday"}, headers=STAFF).status_code == 422


def test_a_user_cannot_read_the_log(api, db):
    assert api.get(AUDIT, params={"actor_id": "alice"}, headers=token_for("alice")).status_code == 403


def test_labels_name_the_users_found_and_skip_the_rest(api, db):
    db.users.docs["alice"] = make_user("alice")
    db.users.docs["alice"]["name"] = "Alice Liddell"
    db.users.docs["bob"] = make_user("bob")

    response = api.get(LABELS, params=[("ids", "alice"), ("ids", "job-17"), ("ids", "alice"), ("ids", "system")], headers=STAFF)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [{"id": "alice", "name": "Alice Liddell", "email": "alice@example.org"}]
    }


def test_labels_with_no_ids_is_empty_and_asks_the_database_nothing(api, db, monkeypatch):
    def boom():
        raise AssertionError("no query expected")

    monkeypatch.setattr(admin_router, "get_db", boom)
    response = api.get(LABELS, headers=STAFF)
    assert response.status_code == 200 and response.json() == {"items": []}


def test_labels_refuse_more_than_a_hundred_ids(api):
    ids = [("ids", f"u{i}") for i in range(101)]
    assert api.get(LABELS, params=ids, headers=STAFF).status_code == 422


def test_labels_are_for_staff_and_admins_only(api, db):
    assert api.get(LABELS, params={"ids": "alice"}, headers=token_for("alice")).status_code == 403
    assert api.get(LABELS, params={"ids": "alice"}, headers=token_for("root", Role.ADMIN)).status_code == 200
