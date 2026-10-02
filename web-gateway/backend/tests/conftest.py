"""Fixtures for route-level tests: the fake Mongo (tests/route_helpers.py)
injected through `get_db`, the slurm service faked so no SSH happens, and a
FastAPI app with only the job and user routers mounted (no lifespan, so
nothing connects to Mongo or Anvil).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import shlex
from dataclasses import dataclass, field

from slurmly import SlurmSSHClient, SubmittedJob, get_preset
from slurmly.testing import FakeTransport
from route_helpers import FakeDB

from app.api.v1 import jobs as jobs_router
from app.api.v1 import users as users_router
from app.core import audit, authz
from app.core.config import settings
from app.services import job_live, run_start, slurm


@pytest.fixture(autouse=True)
def _fresh_job_live():
    """The SLURM answers and reads job_live shares are process-wide; a test
    starts without another's."""
    job_live.reset()
    yield
    job_live.reset()


@pytest.fixture(autouse=True)
def _no_s3_read(monkeypatch):
    """No test reaches Anvil S3: reading a snapshot's init (run_start) fails, which
    the code takes as "could not check" and blocks nothing. A test that wants an
    init replaces `run_start._fetch_init`. The rules it read stay process-wide,
    so each test starts without another's."""

    async def no_network(url: str) -> str:
        raise OSError("no network in tests")

    monkeypatch.setattr(run_start, "_fetch_init", no_network)
    run_start.reset()
    yield
    run_start.reset()


@pytest.fixture
def db(monkeypatch) -> FakeDB:
    fake = FakeDB()
    get_fake = lambda: fake  # noqa: E731
    for module in (jobs_router, users_router, audit, authz, slurm):
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

    async def read_log(doc: dict, stream: str, offset, limit) -> dict:
        return {"exists": True, "data": "out", "offset": 0, "next_offset": 3, "size": 3, "eof": True}

    # What a submit that may have reached SLURM does to clean up after itself,
    # recorded rather than run. A test that cares reads or replaces them.
    async def scancel_by_name(sim_id: str) -> bool:
        cleanup_calls.append(("scancel_by_name", sim_id))
        return True

    async def remove_failed_submit_dirs(sim_id: str) -> None:
        cleanup_calls.append(("remove_failed_submit_dirs", sim_id))

    cleanup_calls: list[tuple[str, str]] = []
    fake.cleanup_calls = cleanup_calls

    monkeypatch.setattr(slurm, "submit_job", submit_job)
    monkeypatch.setattr(slurm, "update_job_status", update_job_status)
    monkeypatch.setattr(slurm, "cancel_job", cancel_job)
    monkeypatch.setattr(slurm, "read_log", read_log)
    monkeypatch.setattr(slurm, "scancel_by_name", scancel_by_name)
    monkeypatch.setattr(slurm, "remove_failed_submit_dirs", remove_failed_submit_dirs)

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


# ---- a real slurmly client over a fake transport ------------------------------

REMOTE_BASE = "/anvil/scratch/x-openghm/openghm"


@dataclass
class Anvil:
    """slurmly's real client, its SSH transport replaced by an in-memory one.
    `commands` is every remote command run, in order. `files` is what `cat`
    and `tail` find, by path; `results` overrides the answer to a command
    (first predicate that matches). `found` is what the batched lookup
    returns (`JobInfo` by SLURM id) and `lookups` the ids it was asked for."""

    client: SlurmSSHClient
    transport: FakeTransport
    files: dict[str, str] = field(default_factory=dict)
    results: list = field(default_factory=list)
    found: dict = field(default_factory=dict)
    lookups: list[list[str]] = field(default_factory=list)
    lookup_error: Exception | None = None

    @property
    def commands(self) -> list[str]:
        return [call.command for call in self.transport.runs]

    def answer(self, command: str):
        for matches, result in self.results:
            if matches(command):
                if isinstance(result, Exception):
                    raise result
                return result
        if command.startswith("sacct "):  # a working sacct that knows no such job
            return (0, '{"jobs": [], "errors": []}', "")
        words = shlex.split(command) if command.startswith(("[ -f", "test -f")) else []
        if words[:2] in (["[", "-f"], ["test", "-f"]):
            path = words[2]
            if path not in self.files:
                return (1, "", "")
            text = self.files[path]
            if "tail" in words:
                lines = text.splitlines()[-int(words[words.index("-n") + 1]):]
                text = "\n".join(lines) + "\n"
            return (0, text, "")
        return (0, "", "")


@pytest.fixture
def anvil(monkeypatch, db) -> Anvil:
    preset = get_preset("purdue_anvil")
    settings_patch = {
        "ANVIL_SSH_USERNAME": "x-openghm",
        "ANVIL_REMOTE_BASE_DIR": REMOTE_BASE,
        "ANVIL_OUTPUT_BASE": "/anvil/scratch/x-openghm/simulations",
    }
    for key, value in settings_patch.items():
        monkeypatch.setattr(settings, key, value)

    transport = FakeTransport()
    client = SlurmSSHClient(
        transport=transport,
        remote_base_dir=REMOTE_BASE,
        cluster_profile=preset.cluster_profile,
        execution_profiles=slurm.gateway_execution_profiles(),
    )
    fake = Anvil(client=client, transport=transport)
    transport.handler = fake.answer

    async def get_jobs(ids, **_kw):
        fake.lookups.append(list(ids))
        if fake.lookup_error is not None:
            raise fake.lookup_error
        return {i: fake.found[i] for i in ids if i in fake.found}

    async def get_client():
        return client

    monkeypatch.setattr(client, "get_jobs", get_jobs)
    monkeypatch.setattr(slurm, "get_slurm_client", get_client)
    return fake
