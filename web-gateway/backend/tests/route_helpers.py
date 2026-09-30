"""In-memory stand-in for the Mongo collections the job and user routes
touch, plus document and token builders for route-level tests.

The fake covers exactly what the routes call — `find_one`, `find`, `insert_one`,
`update_one` (`$set`, `$unset`, `$addToSet`, `$pull`), `delete_one`,
`count_documents` — with equality, `$in`, `$ne` and `$exists` matching. It is not a Mongo emulator: a route that starts using
another operator fails loudly here instead of silently matching nothing.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone

from app.core.roles import Role
from app.core.security import create_access_token


def _matches(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        value = doc.get(key)
        if isinstance(cond, dict):
            for op, arg in cond.items():
                if op == "$in":
                    ok = value in arg
                elif op == "$ne":
                    ok = value != arg
                elif op == "$exists":
                    ok = (key in doc) == arg
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

    def sort(self, key: str, direction: int):
        self._docs.sort(key=lambda d: d[key], reverse=direction < 0)
        return self

    def skip(self, n: int):
        self._docs = self._docs[n:]
        return self

    def limit(self, n: int):
        self._docs = self._docs[:n]
        return self

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
        self.docs[doc["_id"]] = copy.deepcopy(doc)

    async def update_one(self, query: dict, update: dict):
        assert set(update) <= {"$set", "$unset", "$addToSet", "$pull"}, (
            "fake Mongo: only $set, $unset, $addToSet and $pull are supported"
        )
        for doc in self.docs.values():
            if _matches(doc, query):
                doc.update(copy.deepcopy(update.get("$set", {})))
                for key in update.get("$unset", {}):
                    doc.pop(key, None)
                for key, item in update.get("$addToSet", {}).items():
                    items = doc.setdefault(key, [])
                    if item not in items:
                        items.append(copy.deepcopy(item))
                for key, item in update.get("$pull", {}).items():
                    doc[key] = [i for i in doc.get(key, []) if i != item]
                return type("R", (), {"matched_count": 1})()
        return type("R", (), {"matched_count": 0})()

    async def delete_one(self, query: dict):
        for key, doc in list(self.docs.items()):
            if _matches(doc, query):
                del self.docs[key]
                break

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
