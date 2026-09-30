"""Every datetime the API returns carries its UTC offset.

The defect: Motor's client was not `tz_aware`, so a datetime written as aware
UTC came back naive, pydantic serialised it as `2026-09-30T14:26:13.075000`
with no `Z`, and a browser read that as local time (nine hours off in Korea).
The fix is at the source, in `app/core/database.py`; the fake Mongo in
tests/route_helpers.py mimics that client, so these tests fail if a route
hands out a naive datetime again.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone

import bson
import pytest
from bson.codec_options import CodecOptions

from app.api.v1 import admin as admin_router
from app.core import database
from app.core.roles import Role

from route_helpers import NOW, FakeDB, bson_roundtrip, make_job, make_sent_job, make_user, token_for

OWNER = "owner"
HEADERS = token_for(OWNER)

# An ISO date-time with no `Z` and no numeric offset.
NAIVE_ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?$")
AWARE_ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|\+00:00)$")


def _timestamps(node, path="$") -> list[tuple[str, str]]:
    """Every string in a JSON document that looks like an ISO date-time."""
    found = []
    if isinstance(node, dict):
        for key, value in node.items():
            found += _timestamps(value, f"{path}.{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            found += _timestamps(value, f"{path}[{i}]")
    elif isinstance(node, str) and re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d", node):
        found.append((path, node))
    return found


def _assert_all_aware(body) -> list[tuple[str, str]]:
    stamps = _timestamps(body)
    assert stamps, "the response carries no timestamps at all"
    for path, value in stamps:
        assert not NAIVE_ISO.match(value), f"{path} has no UTC offset: {value}"
        assert AWARE_ISO.match(value), f"{path} is not a UTC date-time: {value}"
    return stamps


@pytest.fixture(autouse=True)
def owner(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)


def _seed_naive(db, job_id="job-1", status="RUNNING"):
    """A job written with naive datetimes, as the pre-fix client returned them.
    `insert_one` on the fake does what a tz-aware Motor client does with them:
    they come back aware UTC."""
    doc = make_sent_job(job_id, OWNER, status)
    doc["created_at"] = datetime(2026, 9, 30, 14, 26, 13, 75000)
    doc["updated_at"] = datetime(2026, 9, 30, 14, 26, 14)
    doc["submitted_at"] = datetime(2026, 9, 30, 14, 26, 13, 75000)
    doc["started_at"] = datetime(2026, 9, 30, 14, 27, 0)
    asyncio.run(db.jobs.insert_one(doc))


@pytest.mark.parametrize("path", ["/api/v1/jobs/job-1", "/api/v1/jobs/job-1/status"])
def test_job_route_timestamps_carry_a_utc_offset(client, db, path):
    _seed_naive(db)

    response = client.get(path, headers=HEADERS)

    assert response.status_code == 200
    stamps = dict(_assert_all_aware(response.json()))
    assert stamps["$.submitted_at"].startswith("2026-09-30T14:26:13.075")
    assert stamps["$.started_at"].startswith("2026-09-30T14:27:00")


def test_job_list_timestamps_carry_a_utc_offset(client, db):
    _seed_naive(db)

    response = client.get("/api/v1/jobs", headers=HEADERS)

    assert response.status_code == 200
    _assert_all_aware(response.json())


def test_a_route_that_writes_a_timestamp_reads_it_back_with_an_offset(client, db):
    # PATCH stamps `updated_at` with datetime.now(timezone.utc), then reads back.
    db.jobs.docs["job-2"] = make_job("job-2", OWNER)

    response = client.patch("/api/v1/jobs/job-2", json={"slug": "renamed"}, headers=HEADERS)

    assert response.status_code == 200
    _assert_all_aware(response.json())


# ---- the fake mimics a tz-aware Motor client -----------------------------------


def test_fake_returns_aware_utc_whatever_went_in(db):
    korea = timezone(timedelta(hours=9))
    asyncio.run(
        db.things.insert_one(
            {
                "_id": "t",
                "naive": datetime(2026, 9, 30, 14, 26, 13, 75123),
                "korea": datetime(2026, 9, 30, 23, 26, 13, tzinfo=korea),
                "nested": {"list": [datetime(2026, 9, 30, 1, 2, 3)]},
            }
        )
    )

    doc = asyncio.run(db.things.find_one({"_id": "t"}))

    assert doc["naive"] == datetime(2026, 9, 30, 14, 26, 13, 75000, tzinfo=timezone.utc)  # ms, like BSON
    assert doc["naive"].utcoffset() == timedelta(0)
    assert doc["korea"] == datetime(2026, 9, 30, 14, 26, 13, tzinfo=timezone.utc)
    assert doc["korea"].utcoffset() == timedelta(0)
    assert doc["nested"]["list"][0].tzinfo is timezone.utc


def test_fake_update_returns_aware_utc(db):
    asyncio.run(db.things.insert_one({"_id": "t"}))
    asyncio.run(db.things.update_one({"_id": "t"}, {"$set": {"at": datetime(2026, 9, 30, 1, 2, 3)}}))

    assert asyncio.run(db.things.find_one({"_id": "t"}))["at"].tzinfo is timezone.utc


def test_fake_query_matches_a_datetime_however_it_is_spelled(db):
    asyncio.run(db.things.insert_one({"_id": "t", "at": NOW}))

    assert asyncio.run(db.things.find_one({"at": NOW.replace(tzinfo=None)})) is not None


# ---- the client itself ---------------------------------------------------------


def test_the_motor_client_is_tz_aware_utc(monkeypatch):
    async def build():
        monkeypatch.setattr(database, "_client", None)
        client = database.get_client()
        try:
            return client.codec_options
        finally:
            client.close()
            monkeypatch.setattr(database, "_client", None)

    options: CodecOptions = asyncio.run(build())

    assert options.tz_aware is True
    assert options.tzinfo is timezone.utc
    # What BSON decoding does with such options: aware UTC out of naive/aware in.
    for written in (datetime(2026, 9, 30, 14, 26, 13, 75000), datetime(2026, 9, 30, 14, 26, 13, 75000, tzinfo=timezone.utc)):
        read = bson.decode(bson.encode({"at": written}), codec_options=options)["at"]
        assert read == datetime(2026, 9, 30, 14, 26, 13, 75000, tzinfo=timezone.utc)
        assert read.utcoffset() == timedelta(0)


# ---- the stats time series, which used to patch naive keys by hand --------------


class _AggregateOf:
    def __init__(self, rows):
        self.rows = rows

    def aggregate(self, _pipeline):
        async def gen():
            for row in self.rows:
                yield row

        return gen()


def test_time_series_matches_aware_bucket_keys(monkeypatch):
    # $dateTrunc keys come back aware UTC from the tz-aware client.
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    rows = [{"_id": today, "count": 4}]
    monkeypatch.setattr(admin_router, "get_db", lambda: {"jobs": _AggregateOf(rows)})

    series = asyncio.run(admin_router._time_series("jobs", "jobs", 3, "day", "UTC"))

    assert series.total == 4
    assert series.points[-1].count == 4
    assert all(p.bucket.utcoffset() == timedelta(0) for p in series.points)
