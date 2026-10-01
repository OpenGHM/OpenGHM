"""The job list and its counts (mission 2026-09-30-workspace-without-mocks):
`GET /jobs` orders by last update by default and by creation on request, its
`status` filter reaches DRAFT, and `GET /jobs/stats` counts every bucket the
list has a tab for. Always scoped to the caller's own jobs.

Runs the real routes against the fake Mongo (tests/conftest.py).
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from route_helpers import NOW, make_job, make_user, token_for

OWNER = "owner"
OTHER = "other"


def _seed(db, job_id: str, owner: str, status: str, *, created: int, updated: int | None):
    """A job created `created` minutes and updated `updated` minutes after NOW
    (None: a legacy document with no `updated_at`)."""
    doc = make_job(job_id, owner, status)
    doc["created_at"] = NOW + timedelta(minutes=created)
    if updated is None:
        del doc["updated_at"]
    else:
        doc["updated_at"] = NOW + timedelta(minutes=updated)
    db.jobs.docs[job_id] = doc


@pytest.fixture
def owner_headers(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)
    return token_for(OWNER)


def _ids(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def test_list_defaults_to_last_updated_first(client, db, owner_headers):
    # "old" was created first but touched last; "new" is the reverse.
    _seed(db, "old", OWNER, "RUNNING", created=0, updated=30)
    _seed(db, "new", OWNER, "DRAFT", created=20, updated=20)
    _seed(db, "mid", OWNER, "FAILED", created=10, updated=25)

    assert _ids(client.get("/api/v1/jobs", headers=owner_headers)) == ["old", "mid", "new"]
    assert _ids(client.get("/api/v1/jobs?sort=updated", headers=owner_headers)) == [
        "old", "mid", "new",
    ]


def test_list_sorted_by_created(client, db, owner_headers):
    _seed(db, "old", OWNER, "RUNNING", created=0, updated=30)
    _seed(db, "new", OWNER, "DRAFT", created=20, updated=20)
    _seed(db, "mid", OWNER, "FAILED", created=10, updated=25)

    assert _ids(client.get("/api/v1/jobs?sort=created", headers=owner_headers)) == [
        "new", "mid", "old",
    ]


def test_equal_updated_at_falls_back_to_created_at(client, db, owner_headers):
    _seed(db, "a", OWNER, "DRAFT", created=1, updated=5)
    _seed(db, "b", OWNER, "DRAFT", created=3, updated=5)
    _seed(db, "c", OWNER, "DRAFT", created=2, updated=5)

    assert _ids(client.get("/api/v1/jobs", headers=owner_headers)) == ["b", "c", "a"]


def test_a_document_without_updated_at_sorts_last(client, db, owner_headers):
    _seed(db, "legacy", OWNER, "COMPLETED", created=50, updated=None)
    _seed(db, "recent", OWNER, "COMPLETED", created=1, updated=1)

    assert _ids(client.get("/api/v1/jobs", headers=owner_headers)) == ["recent", "legacy"]


def test_unknown_sort_is_rejected(client, db, owner_headers):
    assert client.get("/api/v1/jobs?sort=name", headers=owner_headers).status_code == 422


def test_status_filter_reaches_drafts_and_active(client, db, owner_headers):
    _seed(db, "draft", OWNER, "DRAFT", created=0, updated=0)
    _seed(db, "running", OWNER, "RUNNING", created=1, updated=1)
    _seed(db, "pending", OWNER, "PENDING", created=2, updated=2)
    _seed(db, "done", OWNER, "COMPLETED", created=3, updated=3)

    assert _ids(client.get("/api/v1/jobs?status=draft", headers=owner_headers)) == ["draft"]
    assert _ids(client.get("/api/v1/jobs?status=active", headers=owner_headers)) == [
        "pending", "running",
    ]


def test_list_is_scoped_to_the_caller(client, db, owner_headers):
    _seed(db, "mine", OWNER, "DRAFT", created=0, updated=0)
    _seed(db, "theirs", OTHER, "DRAFT", created=1, updated=1)

    assert _ids(client.get("/api/v1/jobs", headers=owner_headers)) == ["mine"]


def test_stats_count_every_bucket(client, db, owner_headers):
    statuses = {
        "DRAFT": 2,
        "PENDING": 1,
        "RUNNING": 2,
        "COMPLETING": 1,
        "COMPLETED": 3,
        "FAILED": 1,
        "CANCELLED": 2,
    }
    n = 0
    for status, count in statuses.items():
        for _ in range(count):
            n += 1
            _seed(db, f"j{n}", OWNER, status, created=n, updated=n)
    # Someone else's jobs are not counted.
    _seed(db, "x1", OTHER, "DRAFT", created=0, updated=0)
    _seed(db, "x2", OTHER, "CANCELLED", created=0, updated=0)

    response = client.get("/api/v1/jobs/stats", headers=owner_headers)

    assert response.status_code == 200
    assert response.json() == {
        "total": 12,
        "running": 4,  # PENDING + RUNNING + COMPLETING: every active status
        "completed": 3,
        "failed": 1,
        "draft": 2,
        "cancelled": 2,
    }


def test_stats_of_nothing_are_zero(client, db, owner_headers):
    assert client.get("/api/v1/jobs/stats", headers=owner_headers).json() == {
        "total": 0, "running": 0, "completed": 0, "failed": 0, "draft": 0, "cancelled": 0,
    }
