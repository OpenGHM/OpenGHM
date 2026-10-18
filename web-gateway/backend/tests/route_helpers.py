"""In-memory stand-in for the Mongo collections the job and user routes
touch, plus document and token builders for route-level tests.

The fake covers exactly what the routes call — `find_one`, `find` (its cursor sorts, skips, limits, iterates and `to_list`s), `insert_one`
(a second document with the same `_id` raises `DuplicateKeyError`),
`update_one` (`$set`, `$unset`, `$addToSet`, `$pull`; `upsert=True` creates the document from the query's equalities and the `$set`), `delete_one`, `delete_many`,
`count_documents` — with equality, `$in`, `$ne`, `$exists`, `$gte`, `$lt` and `$regex` matching,
on a dotted path (`publish.state`) as well as a plain key. It is not a Mongo emulator: a route that starts using
another operator fails loudly here instead of silently matching nothing.

Datetimes behave like a `tz_aware=True` Motor client (app/core/database.py):
whatever goes in, BSON keeps as UTC milliseconds, and what comes out is aware
UTC. A route that compares a document's datetime with a naive one fails here
as it would against a real database, and a route's JSON carries the offset.
"""

from __future__ import annotations

import copy
import re
from datetime import datetime, timezone
from typing import Any

from pymongo.errors import DuplicateKeyError

from app.core.roles import Role
from app.core.security import create_access_token


def bson_roundtrip(value: Any) -> Any:
    """A copy of `value` as a tz-aware Motor client returns it after storing it:
    every datetime aware UTC, truncated to milliseconds like BSON's date; a
    naive datetime is taken as UTC, as the driver does on write."""
    if isinstance(value, datetime):
        value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
        value = value.astimezone(timezone.utc)
        return value.replace(microsecond=value.microsecond // 1000 * 1000)
    if isinstance(value, dict):
        return {k: bson_roundtrip(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [bson_roundtrip(v) for v in value]
    return copy.deepcopy(value)


_ABSENT = object()


def _lookup(doc: dict, key: str) -> Any:
    """The value at a dotted path, or `_ABSENT` when any step of it is missing."""
    value: Any = doc
    for part in key.split("."):
        if not isinstance(value, dict) or part not in value:
            return _ABSENT
        value = value[part]
    return value


def _assign(doc: dict, key: str, value: Any) -> None:
    """Set the value at a dotted path, creating the dicts on the way."""
    *parents, last = key.split(".")
    for part in parents:
        doc = doc.setdefault(part, {})
    doc[last] = value


def _matches(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        found = _lookup(doc, key)
        value = None if found is _ABSENT else found
        cond = bson_roundtrip(cond)
        if isinstance(cond, dict):
            for op, arg in cond.items():
                if op == "$in":
                    ok = value in arg
                elif op == "$ne":
                    ok = value != arg
                elif op == "$exists":
                    ok = (found is not _ABSENT) == arg
                elif op == "$gte":
                    ok = value is not None and value >= arg
                elif op == "$lt":
                    ok = value is not None and value < arg
                elif op == "$regex":
                    ok = isinstance(value, str) and re.search(arg, value) is not None
                else:
                    raise NotImplementedError(f"fake Mongo: unsupported operator {op}")
                if not ok:
                    return False
        elif value != cond:
            return False
    return True


class FakeCursor:
    def __init__(self, docs: list[dict]) -> None:
        self._docs = docs

    def sort(self, key: str | list[tuple[str, int]], direction: int = 1):
        """A key and a direction, or Mongo's list of (key, direction) pairs.
        A missing or null value sorts lowest, as in Mongo."""
        keys = [(key, direction)] if isinstance(key, str) else key
        # Stable sorts from the least significant key up.
        for name, way in reversed(keys):
            self._docs.sort(
                key=lambda d: (d.get(name) is not None, d.get(name) or 0),
                reverse=way < 0,
            )
        return self

    def skip(self, n: int):
        self._docs = self._docs[n:]
        return self

    def limit(self, n: int):
        self._docs = self._docs[:n]
        return self

    async def to_list(self, length: int | None = None) -> list[dict]:
        return list(self._docs if length is None else self._docs[:length])

    def __aiter__(self):
        async def gen():
            for doc in self._docs:
                yield doc

        return gen()


class FakeAggregate:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    async def to_list(self, _length):
        return self._rows

    def __aiter__(self):
        async def gen():
            for row in self._rows:
                yield row

        return gen()


class FakeCollection:
    def __init__(self) -> None:
        self.docs: dict[str, dict] = {}

    async def find_one(self, query: dict, **_kw):
        for doc in self.docs.values():
            if _matches(doc, query):
                return copy.deepcopy(doc)
        return None

    def find(self, query: dict, _projection: dict | None = None):
        return FakeCursor([copy.deepcopy(d) for d in self.docs.values() if _matches(d, query)])

    def aggregate(self, pipeline: list[dict]):
        # Only the stats route's shape: [{"$match": q}, {"$group": count by status}].
        match, group = pipeline
        assert group == {"$group": {"_id": "$status", "count": {"$sum": 1}}}
        counts: dict[str, int] = {}
        for d in self.docs.values():
            if _matches(d, match["$match"]):
                counts[d["status"]] = counts.get(d["status"], 0) + 1
        return FakeAggregate([{"_id": k, "count": v} for k, v in counts.items()])

    async def insert_one(self, doc: dict):
        if doc["_id"] in self.docs:
            raise DuplicateKeyError(f"E11000 duplicate key error: {{ _id: {doc['_id']!r} }}")
        self.docs[doc["_id"]] = bson_roundtrip(doc)

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        assert set(update) <= {"$set", "$unset", "$addToSet", "$pull"}, (
            "fake Mongo: only $set, $unset, $addToSet and $pull are supported"
        )
        for doc in self.docs.values():
            if _matches(doc, query):
                for key, value in update.get("$set", {}).items():
                    _assign(doc, key, bson_roundtrip(value))
                for key in update.get("$unset", {}):
                    doc.pop(key, None)
                for key, item in update.get("$addToSet", {}).items():
                    items = doc.setdefault(key, [])
                    item = bson_roundtrip(item)
                    if item not in items:
                        items.append(item)
                for key, item in update.get("$pull", {}).items():
                    doc[key] = [i for i in doc.get(key, []) if i != bson_roundtrip(item)]
                return type("R", (), {"matched_count": 1})()
        if upsert:
            doc: dict = {k: v for k, v in query.items() if not isinstance(v, dict)}
            for key, value in update.get("$set", {}).items():
                _assign(doc, key, bson_roundtrip(value))
            self.docs[doc["_id"]] = doc
        return type("R", (), {"matched_count": 0})()

    async def delete_one(self, query: dict):
        for key, doc in list(self.docs.items()):
            if _matches(doc, query):
                del self.docs[key]
                return type("R", (), {"deleted_count": 1})()
        return type("R", (), {"deleted_count": 0})()

    async def delete_many(self, query: dict):
        gone = [key for key, doc in self.docs.items() if _matches(doc, query)]
        for key in gone:
            del self.docs[key]
        return type("R", (), {"deleted_count": len(gone)})()

    async def count_documents(self, query: dict) -> int:
        return sum(1 for d in self.docs.values() if _matches(d, query))


class FakeDB:
    def __init__(self) -> None:
        self._collections: dict[str, FakeCollection] = {}

    def __getattr__(self, name: str) -> FakeCollection:
        if name.startswith("_"):
            raise AttributeError(name)
        return self._collections.setdefault(name, FakeCollection())

    def __getitem__(self, name: str) -> FakeCollection:
        return getattr(self, name)


NOW = datetime(2026, 9, 30, tzinfo=timezone.utc)


def make_user(
    sub: str,
    role: Role = Role.USER,
    *,
    email_verified: bool = True,
    is_active: bool = True,
    can_run_simulations: bool | None = None,
) -> dict:
    """A user document. `can_run_simulations=None` leaves the key out, like a
    legacy document."""
    doc = {
        "_id": sub,
        "email": f"{sub}@example.org",
        "name": sub,
        "role": role.value,
        "email_verified": email_verified,
        "is_active": is_active,
        "created_at": NOW,
        "updated_at": NOW,
    }
    if can_run_simulations is not None:
        doc["can_run_simulations"] = can_run_simulations
    return doc


def make_job(job_id: str, owner: str, status: str = "DRAFT") -> dict:
    doc = {
        "_id": job_id,
        "user_id": owner,
        "user_email": f"{owner}@example.org",
        "dataset_id": "ds-1",
        "dataset_title": "Dataset one",
        "slug": None,
        "about": None,
        "model_input_id": None,
        "slurm_job_id": "12345" if status != "DRAFT" else None,
        "slurm_job_name": "",
        "status": status,
        "status_reason": None,
        "parameters": {
            "temporal_range_start": "2000-01-01",
            "temporal_range_end": "2000-12-31",
            "variables": ["runoff", "discharge"],
        },
        "slurm_config": {},
        "created_at": NOW,
        "submitted_at": None,
        "started_at": None,
        "completed_at": None,
        "updated_at": NOW,
    }
    if status != "DRAFT":
        # A draft has no `sim_id` key at all (see jobs._new_draft_document).
        doc["sim_id"] = f"sim-{job_id}"
    return doc


def token_for(sub: str, role: Role = Role.USER) -> dict[str, str]:
    """Authorization header carrying a token minted by the app's own function."""
    token = create_access_token(
        {"sub": sub, "email": f"{sub}@example.org", "role": role.value, "name": sub}
    )
    return {"Authorization": f"Bearer {token}"}




REMOTE_BASE = "/anvil/scratch/x-openghm/openghm"
OUTPUT_BASE = "/anvil/scratch/x-openghm/simulations"


def make_sent_job(job_id: str, owner: str, status: str = "RUNNING", **extra) -> dict:
    """A job SLURM has an id for, with everything a submit records: slurmly's
    directory under `REMOTE_BASE/jobs/`, the work directory under
    `OUTPUT_BASE`, and a submit time long enough ago to be past slurmly's
    grace window."""
    doc = make_job(job_id, owner, status)
    sim_id = f"sim-{job_id}"
    directory = f"{REMOTE_BASE}/jobs/slurmly-1a2b3c4d"
    doc.update(
        slurm_job_id="12345",
        slurm_job_name=sim_id,
        internal_job_id="slurmly-1a2b3c4d",
        remote_job_dir=directory,
        remote_script_path=f"{directory}/run.sh",
        stdout_path=f"{directory}/stdout.log",
        stderr_path=f"{directory}/stderr.log",
        slurmly_submitted_at="2026-09-30T00:00:00Z",
        submitted_at=NOW,
        work_dir=f"{OUTPUT_BASE}/{sim_id}",
    )
    doc.update(extra)
    return doc


SIM = "sim-20260930-0a1b2c"

#: The `outcome.json` of a job that ran clean, as `job_script.OUTCOME_PY`
#: writes it.
SUCCESS_OUTCOME = {
    "schema": 1,
    "sim_id": SIM,
    "snapshot_id": "fc66a2cd",
    "toolkit_commit": "abc1234",
    "host": "a000.anvil.rcac.purdue.edu",
    "slurm_job_id": "20981234",
    "started_at": "2026-09-30T14:00:00Z",
    "ended_at": "2026-09-30T14:14:00Z",
    "phase": "check",
    "signal": None,
    "restart_count": 0,
    "steps": {"fetch": {"exit_code": 0}, "run": {"exit_code": 0}},
    "staged": True,
    "wbm": {
        "log": f"wbm_output/{SIM}/wbm_test.log",
        "all_done": True,
        "markers": [],
        "tail": ["Time used for the job - 829s", "All Done!"],
    },
    "output": {
        "nc_count": 16,
        "total_bytes": 123456,
        "file_count": 17,
        "files": [{"path": f"wbm_output/{SIM}/daily/wbm_2000.nc", "bytes": 1}],
        "truncated": False,
    },
    "ok": True,
}
