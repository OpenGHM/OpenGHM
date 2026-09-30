"""Fixtures for route-level tests: the fake Mongo (tests/route_helpers.py)
injected through `get_db`, the slurm service faked so no SSH happens, and a
FastAPI app with only the job and user routers mounted (no lifespan, so
nothing connects to Mongo or Anvil).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from slurmly import SubmittedJob
from route_helpers import FakeDB

from app.api.v1 import jobs as jobs_router
from app.api.v1 import users as users_router
from app.core import audit, authz
from app.core.config import settings
from app.services import slurm


@pytest.fixture
def db(monkeypatch) -> FakeDB:
    fake = FakeDB()
    get_fake = lambda: fake  # noqa: E731
    for module in (jobs_router, users_router, audit, authz):
        monkeypatch.setattr(module, "get_db", get_fake)
    fake.datasets.docs["ds-1"] = {
        "_id": "ds-1",
        "document": {
            "about": {"name": "Dataset one"},
            "simulation": {
                "spatialCoverage": {
                    "northlimit": 57.1667, "southlimit": 21.75,
                    "eastlimit": -60.5833, "westlimit": -127.8333,
                },
                "temporalCoverage": {"start": "2000-01-01", "end": "2000-12-31"},
                "outputVariables": [{"name": "runoff"}, {"name": "discharge"}],
                "recommendedCompute": {"cores": 16, "walltime": "15:00"},
            },
        },
    }

    # No SSH: stand-ins for the four slurm service calls the job routes make.
    # The submit route does its own bookkeeping, so the fake only answers with
    # what slurmly would (tests/test_job_submit.py swaps it to make it fail).
    async def submit_job(job, snapshot, body):
        return SubmittedJob(
            internal_job_id="slurmly-1a2b3c4d",
            slurm_job_id="12345",
            remote_job_dir="/anvil/scratch/x-openghm/openghm/slurmly-1a2b3c4d",
            remote_script_path="/anvil/scratch/x-openghm/openghm/slurmly-1a2b3c4d/run.sh",
            stdout_path="/anvil/scratch/x-openghm/openghm/slurmly-1a2b3c4d/stdout.log",
            stderr_path="/anvil/scratch/x-openghm/openghm/slurmly-1a2b3c4d/stderr.log",
            submitted_at="2026-09-30T00:00:00Z",
        )

    async def update_job_status(job_id: str) -> dict:
        return await fake.jobs.find_one({"_id": job_id})

    async def cancel_job(slurm_job_id: str) -> bool:
        return True

    async def get_job_logs(job_id: str) -> tuple[str, str, bool]:
        return "out", "err", False

    monkeypatch.setattr(slurm, "submit_job", submit_job)
    monkeypatch.setattr(slurm, "update_job_status", update_job_status)
    monkeypatch.setattr(slurm, "cancel_job", cancel_job)
    monkeypatch.setattr(slurm, "get_job_logs", get_job_logs)

    monkeypatch.setattr(settings, "JOB_MAX_ACTIVE_PER_USER", 2)
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", "/home/x-openghm/apps/openghm/abc1234")
    # A developer's local .env turns the X-Mock-Role bypass on; a test that
    # wants it says so, every other one runs as production.
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "ALLOW_MOCK_AUTH", False)
    return fake


@pytest.fixture
def client(db) -> TestClient:
    app = FastAPI()
    app.include_router(jobs_router.router, prefix="/api/v1")
    app.include_router(users_router.router, prefix="/api/v1")
    # Not entered as a context manager: that would run the lifespan.
    return TestClient(app)
