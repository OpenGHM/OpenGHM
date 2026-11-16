"""Reading a run's WBM output through the backend (ADR 0033, mission 2026-10-09-wbm-output-can-be-read).

The routes `/jobs/{id}/output...` (a draft's run on scratch: its owner, staff and admins) and
`/repository/datasets/{id}/output...` (a published snapshot: anyone), their error mapping, and the download
that is written on Anvil by the toolkit, streamed back over SFTP and deleted.

`slurm.run_remote`, `anvil_files.stream_file` and `anvil_files.remove_file` are replaced by an in-memory
Anvil, so no SSH runs and the backend needs neither the toolkit nor h5py. What the toolkit prints is
whatever the test says it printed; its real answers are exercised in packages/openghm/tests/test_output.py.
The SFTP helpers themselves (`anvil_files`) are tested in test_anvil_files.py.
"""

from __future__ import annotations

import asyncio
import base64
import json
import posixpath
import shlex
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from slurmly.exceptions import SlurmlyError

from app.api.v1 import wbm_output as routes
from app.core.config import settings
from app.core.roles import Role
from app.services import anvil_files, slurm, wbm_output

from route_helpers import make_job, make_user, token_for

HOME = "/home/x-openghm/apps/openghm/abc1234"
OUTPUT_BASE = "/anvil/scratch/x-openghm/simulations"
REMOTE_BASE = "/anvil/scratch/x-openghm/openghm"
DOWNLOADS = f"{REMOTE_BASE}/output-downloads"
OWNER = "owner"
OWNER_HEADERS = token_for(OWNER)
SNAPSHOT = "ab" * 32
SIM = "sim-job-1"
WORK_DIR = f"{OUTPUT_BASE}/{SIM}"
OPENGHM = f"{HOME}/bin/openghm"
CONFIG = f"{HOME}/gateway.toml"

PNG = b"\x89PNG\r\n\x1a\n" + b"fake png bytes"
NC = b"CDF-fake-netcdf-bytes" * 1000

INVENTORY = {"source": {"kind": "folder"}, "mt": "x.MT.csv", "grid": None, "resolutions": {}, "variables": [],
             "files": {"count": 0, "bytes": 0}, "warnings": []}
MAP = {"format": "png", "width": 8, "height": 6, "base64": base64.b64encode(PNG).decode(), "path": None,
       "legend": {"ramp": "DarkBlue", "min": 0.0, "max": 100.0, "log": False}, "units": "mm/month",
       "bbox": {"west": -101.0, "south": 40.0, "east": -97.0, "north": 43.0}}
SERIES = {"format": "json", "times": ["2000-01-01"], "values": [1.5], "units": "mm/day", "valuesIn": "stored"}


class Anvil:
    """What the three `slurm` calls were asked, and the answers. `toolkit` maps a command to
    `(exit status, stdout, stderr)`; the default answers by subcommand."""

    def __init__(self) -> None:
        self.commands: list[str] = []
        self.files: dict[str, bytes] = {}
        self.removed: list[str] = []
        self.streams: list[str] = []
        self.next: object | None = None       # a result (or an exception) for the next toolkit command
        self.nc_bytes = NC
        self.gone_after_toolkit = False

    # -- slurm.run_remote
    async def run_remote(self, command, **kw):
        self.commands.append(command)
        self.last_kw = kw
        if command.startswith("find "):
            return SimpleNamespace(exit_status=0, stdout="", stderr="")
        if self.next is not None:
            answer, self.next = self.next, None
            if isinstance(answer, BaseException):
                raise answer
            return SimpleNamespace(exit_status=answer[0], stdout=answer[1], stderr=answer[2])
        words = shlex.split(command)
        assert words[:2] == [OPENGHM, "output"], command
        assert words[-3:] == ["--config", CONFIG, "--json"], command
        if words[2] == "inventory":
            return self._ok(INVENTORY)
        if "--format" in words and words[words.index("--format") + 1] == "nc":
            path = words[words.index("--out") + 1]
            self.files[path] = self.nc_bytes
            return self._ok({"format": "nc", "variable": words[words.index("--var") + 1], "resolution": "daily",
                             "period": {"first": "2000-01-03", "last": "2000-01-06", "steps": 4},
                             "path": path, "bytes": len(self.nc_bytes)})
        fmt = words[words.index("--format") + 1]
        return self._ok(MAP if fmt == "png" else SERIES)

    @staticmethod
    def _ok(data):
        return SimpleNamespace(exit_status=0, stdout=json.dumps(data), stderr="")

    def toolkit_commands(self) -> list[list[str]]:
        return [shlex.split(c) for c in self.commands if not c.startswith("find ")]

    # -- anvil_files.stream_file / remove_file
    async def stream_file(self, path, *, chunk_size=1024 * 1024):
        self.streams.append(path)
        data = self.files[path]
        for i in range(0, len(data), 4096):
            yield data[i:i + 4096]

    async def remove_file(self, path):
        self.removed.append(path)
        self.files.pop(path, None)


@pytest.fixture
def anvil(monkeypatch, db) -> Anvil:
    fake = Anvil()
    monkeypatch.setattr(slurm, "run_remote", fake.run_remote)
    monkeypatch.setattr(anvil_files, "stream_file", fake.stream_file)
    monkeypatch.setattr(anvil_files, "remove_file", fake.remove_file)
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", HOME)
    monkeypatch.setattr(settings, "ANVIL_OUTPUT_BASE", OUTPUT_BASE)
    monkeypatch.setattr(settings, "ANVIL_SSH_USERNAME", "x-openghm")
    monkeypatch.setattr(settings, "ANVIL_REMOTE_BASE_DIR", REMOTE_BASE)
    monkeypatch.setattr(settings, "ANVIL_OUTPUT_DOWNLOAD_DIR", "")
    monkeypatch.setattr(wbm_output, "_last_sweep", 0.0)
    monkeypatch.setattr(wbm_output, "_slots", {})
    monkeypatch.setattr(wbm_output, "_answers", wbm_output.collections.OrderedDict())
    monkeypatch.setattr(wbm_output, "_answers_bytes", 0)
    monkeypatch.setattr(wbm_output, "_flights", {})
    return fake


@pytest.fixture
def api(db, anvil, monkeypatch) -> TestClient:
    monkeypatch.setattr(routes, "get_db", lambda: db)
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "COMPLETED")
    db.datasets.docs[SNAPSHOT] = {"_id": SNAPSHOT, "document": {"about": {"name": "Published"}}}
    app = FastAPI()
    app.include_router(routes.router, prefix="/api/v1")
    return TestClient(app)


JOB = "/api/v1/jobs/job-1/output"
SNAP = f"/api/v1/repository/datasets/{SNAPSHOT}/output"
MAP_QUERY = "variable=runoff&resolution=monthly&start=2000-03"
SERIES_QUERY = "variable=runoff&resolution=daily&point=-99.3,42.6&start=2000-01-01&end=2000-01-05"
SUBSET_QUERY = "variable=runoff&resolution=daily&start=2000-01-03&end=2000-01-06&bbox=-101,40,-99,42"


def _detail(response) -> dict:
    return response.json()["detail"]


# ---- who may read what ---------------------------------------------------------------------------


@pytest.mark.parametrize("suffix,query", [("", ""), ("/map", MAP_QUERY), ("/series", SERIES_QUERY), ("/subset", SUBSET_QUERY)])
def test_a_runs_output_is_for_its_owner_staff_and_admins(api, anvil, db, suffix, query):
    url = f"{JOB}{suffix}?{query}"
    for sub, role in (("staff", Role.STAFF), ("admin", Role.ADMIN)):
        db.users.docs[sub] = make_user(sub, role)
    assert api.get(url).status_code == 401
    assert api.get(url, headers=token_for("guest", Role.GUEST)).status_code == 403
    assert anvil.commands == []                                    # nothing ran for either
    # someone else's: the 404 a missing job gets, word for word, and nothing runs
    db.users.docs["other"] = make_user("other", can_run_simulations=True)
    other = api.get(url, headers=token_for("other"))
    missing = api.get(f"/api/v1/jobs/nope/output{suffix}?{query}", headers=token_for("other"))
    assert other.status_code == 404 and (other.status_code, other.json()) == (missing.status_code, missing.json())
    assert anvil.commands == []
    for headers in (OWNER_HEADERS, token_for("staff", Role.STAFF), token_for("admin", Role.ADMIN)):
        assert api.get(url, headers=headers).status_code == 200, suffix


@pytest.mark.parametrize("suffix,query", [("", ""), ("/map", MAP_QUERY), ("/series", SERIES_QUERY), ("/subset", SUBSET_QUERY)])
def test_a_published_snapshots_output_is_open_to_anyone(api, anvil, suffix, query):
    assert api.get(f"{SNAP}{suffix}?{query}").status_code == 200
    assert api.get(f"{SNAP}{suffix}?{query}", headers=OWNER_HEADERS).status_code == 200
    missing = api.get(f"/api/v1/repository/datasets/{'cd' * 32}/output{suffix}?{query}")
    assert missing.status_code == 404 and "not found" in missing.json()["detail"]
    # the unknown id ran nothing; the second read is the first one's kept answer (not a download's)
    assert len(anvil.toolkit_commands()) == (2 if suffix == "/subset" else 1)


def test_a_draft_that_never_ran_has_no_output_and_a_purged_run_is_gone(api, anvil, db):
    db.jobs.docs["draft"] = make_job("draft", OWNER, "DRAFT")
    r = api.get("/api/v1/jobs/draft/output", headers=OWNER_HEADERS)
    assert r.status_code == 404 and _detail(r)["code"] == "output_missing"
    db.jobs.docs["job-1"]["files"] = "purged"
    r = api.get(f"{JOB}/map?{MAP_QUERY}", headers=OWNER_HEADERS)
    assert r.status_code == 410 and _detail(r)["code"] == "output_purged" and "30 days" in _detail(r)["message"]
    assert anvil.commands == []


# ---- the commands run ----------------------------------------------------------------------------


def test_the_inventory_runs_the_toolkit_on_the_runs_work_directory_or_the_snapshot(api, anvil):
    assert api.get(JOB, headers=OWNER_HEADERS).json() == INVENTORY
    assert api.get(SNAP).json() == INVENTORY
    assert anvil.commands == [
        f"{OPENGHM} output inventory {WORK_DIR} --config {CONFIG} --json",
        f"{OPENGHM} output inventory --snapshot {SNAPSHOT} --config {CONFIG} --json",
    ]
    assert anvil.last_kw["operation"] == "output_inventory" and anvil.last_kw["retry_safe"] is True
    assert anvil.last_kw["timeout"] == wbm_output.INVENTORY_TIMEOUT_SECONDS


def test_the_work_directory_is_output_base_and_the_sim_id_not_what_the_request_says(api, anvil, db):
    db.jobs.docs["job-1"]["work_dir"] = "/somewhere/else/sim-job-1"
    api.get(JOB, headers=OWNER_HEADERS)
    assert shlex.split(anvil.commands[0])[3] == WORK_DIR


def test_a_map_is_a_png_and_its_parameters_become_the_toolkits_options(api, anvil):
    r = api.get(f"{JOB}/map?{MAP_QUERY}&bbox=-101,40,-99,41.5&width=800&height=600", headers=OWNER_HEADERS)
    assert r.status_code == 200 and r.content == PNG
    assert r.headers["content-type"] == "image/png" and r.headers["cache-control"] == "private, no-cache"
    assert anvil.toolkit_commands()[0][2:] == [
        "subset", WORK_DIR, "--var", "runoff", "--resolution", "monthly", "--format", "png", "--start", "2000-03",
        "--bbox", "-101,40,-99,41.5", "--width", "800", "--height", "600", "--config", CONFIG, "--json"]
    assert anvil.last_kw["operation"] == "output_map"
    pub = api.get(f"{SNAP}/map?{MAP_QUERY}")
    assert pub.headers["cache-control"] == "public, max-age=3600"
    assert anvil.toolkit_commands()[1][3:5] == ["--snapshot", SNAPSHOT]


def test_a_map_style_becomes_the_toolkits_options_and_none_changes_nothing(api, anvil):
    api.get(f"{SNAP}/map?{MAP_QUERY}")
    api.get(f"{SNAP}/map?{MAP_QUERY}&ramp=DarkRed&min=0.5&max=50&log=true")
    api.get(f"{SNAP}/map?{MAP_QUERY}&log=false")
    api.get(f"{SNAP}/map?{MAP_QUERY}&min=-5")
    base, full, nolog, only_min = anvil.toolkit_commands()
    assert not {"--ramp", "--min", "--max", "--log", "--no-log"} & set(base)
    assert full[:-3] == base[:-3] + ["--ramp", "DarkRed", "--min", "0.5", "--max", "50.0", "--log"]
    assert nolog[:-3] == base[:-3] + ["--no-log"]
    assert only_min[:-3] == base[:-3] + ["--min", "-5.0"]


@pytest.mark.parametrize("style", ["min=5&max=5", "min=9&max=1", "log=true&min=0", "log=true&min=-1&max=4",
                                   "ramp=Dark%20Blue", "ramp=Dark;rm", "ramp=1", "ramp=", "min=abc", "min=nan",
                                   "max=inf", "log=maybe"])
def test_a_map_style_that_cannot_be_drawn_is_refused_before_anything_runs(api, anvil, style):
    r = api.get(f"{SNAP}/map?{MAP_QUERY}&{style}")
    assert r.status_code == 422, r.text
    assert anvil.commands == []


def test_a_refused_pair_says_why(api):
    r = api.get(f"{SNAP}/map?{MAP_QUERY}&min=3&max=2")
    assert _detail(r) == {"code": "output_request_refused", "message": "min must be less than max."}
    r = api.get(f"{SNAP}/map?{MAP_QUERY}&log=true&min=0")
    assert "log scale" in _detail(r)["message"]


def test_a_ramp_the_toolkit_does_not_know_is_its_refusal_as_422(api, anvil):
    anvil.next = (2, "", "openghm: 'Plasma' is not a ramp this toolkit draws; choose one of DarkBlue, DarkRed\n")
    r = api.get(f"{SNAP}/map?{MAP_QUERY}&ramp=Plasma")
    assert r.status_code == 422 and _detail(r)["code"] == "output_request_refused"
    assert "'Plasma' is not a ramp" in _detail(r)["message"]
    assert anvil.toolkit_commands()[0][-5:-3] == ["--ramp", "Plasma"]


def test_a_map_with_json_encoding_is_the_toolkits_answer(api):
    r = api.get(f"{SNAP}/map?{MAP_QUERY}&encoding=json")
    assert r.status_code == 200 and r.json() == MAP and r.headers["content-type"].startswith("application/json")


def test_a_map_whose_png_is_not_base64_is_a_bad_gateway(api, anvil):
    anvil.next = (0, json.dumps({**MAP, "base64": "!!not base64!!"}), "")
    r = api.get(f"{SNAP}/map?{MAP_QUERY}")
    assert r.status_code == 502 and _detail(r)["code"] == "output_failed"


def test_a_series_is_the_toolkits_json(api, anvil):
    r = api.get(f"{JOB}/series?{SERIES_QUERY}&display=true", headers=OWNER_HEADERS)
    assert r.status_code == 200 and r.json() == SERIES
    assert anvil.toolkit_commands()[0][2:] == [
        "subset", WORK_DIR, "--var", "runoff", "--resolution", "daily", "--format", "json", "--point", "-99.3,42.6",
        "--start", "2000-01-01", "--end", "2000-01-05", "--display", "--config", CONFIG, "--json"]
    api.get(f"{SNAP}/series?variable=runoff&resolution=yearly&point=10,-20")
    assert anvil.toolkit_commands()[1][2:] == [
        "subset", "--snapshot", SNAPSHOT, "--var", "runoff", "--resolution", "yearly", "--format", "json",
        "--point", "10,-20", "--config", CONFIG, "--json"]


@pytest.mark.parametrize("url", [
    "/map?variable=runoff&resolution=monthly",                          # no start
    "/map?variable=runoff&resolution=hourly&start=2000",
    "/map?variable=runoff&resolution=daily&start=2000-1-1",
    "/map?variable=runoff&resolution=daily&start=2000-01-01&width=5000",
    "/map?variable=runoff&resolution=daily&start=2000-01-01&width=0",
    "/map?variable=runoff&resolution=daily&start=2000-01-01&bbox=1,2,3",
    "/map?variable=runoff%20x&resolution=daily&start=2000-01-01",
    "/map?variable=%24(reboot)&resolution=daily&start=2000-01-01",
    "/map?variable=runoff&resolution=daily&start=2000-01-01&bbox=1,2,3;rm",
    "/series?variable=runoff&resolution=daily&point=1,2,3",
    "/series?variable=runoff&resolution=daily",                         # no point
    "/series?variable=runoff&resolution=daily&point=1,2&start=20000101",
    "/subset?variable=runoff&resolution=climatology",
    "/subset?resolution=daily",
])
def test_a_malformed_query_is_refused_before_anything_runs(api, anvil, url):
    r = api.get(f"{SNAP}{url}")
    assert r.status_code == 422, r.text
    assert anvil.commands == []


def test_arguments_are_quoted_into_the_command(api, anvil, db):
    db.jobs.docs["job-1"]["sim_id"] = "sim-1"
    api.get(JOB, headers=OWNER_HEADERS)
    assert anvil.commands[0] == f"{OPENGHM} output inventory {OUTPUT_BASE}/sim-1 --config {CONFIG} --json"
    # an id that is not a valid path component never reaches a command
    db.jobs.docs["job-1"]["sim_id"] = "sim; touch /tmp/x"
    r = api.get(JOB, headers=OWNER_HEADERS)
    assert r.status_code == 404 and _detail(r)["code"] == "output_missing"
    assert len(anvil.commands) == 1


# ---- the toolkit's answers, as the routes map them -----------------------------------------------


@pytest.mark.parametrize("result,status,code,message", [
    ((2, "", "openghm: no daily file for 'runoff' in 2001; the years it has: 2000, 2002\n"), 422, "output_request_refused",
     "no daily file for 'runoff' in 2001; the years it has: 2000, 2002"),
    ((2, "", "UserWarning: x\nopenghm: this request reads 912 million cells; one call may read at most 400 million.\n"),
     422, "output_request_refused", "this request reads 912 million cells; one call may read at most 400 million."),
    ((3, "", "openghm: /anvil/x has no wbm_output/<run>/ folder\n"), 404, "output_missing",
     "/anvil/x has no wbm_output/<run>/ folder"),
    ((1, "", "openghm: this command needs h5py, numpy and h5netcdf: pip install 'openghm[output]'\n"), 502, "output_failed",
     "this command needs h5py, numpy and h5netcdf: pip install 'openghm[output]'"),
    ((139, "", ""), 502, "output_failed", "The toolkit exited with status 139."),
    ((0, "not json", ""), 502, "output_failed", "The toolkit's answer was not JSON."),
    ((0, "[1, 2]", ""), 502, "output_failed", "The toolkit's answer was not a JSON object."),
])
def test_the_toolkits_exit_status_decides_the_answer(api, anvil, result, status, code, message):
    for url in (f"{SNAP}", f"{SNAP}/series?{SERIES_QUERY}", f"{SNAP}/map?{MAP_QUERY}"):
        anvil.next = result
        r = api.get(url)
        assert r.status_code == status and _detail(r) == {"code": code, "message": message}, url


@pytest.mark.parametrize("error", [SlurmlyError("ssh down"), OSError("reset"), asyncio.TimeoutError()])
def test_anvil_not_answering_is_503_unreachable(api, anvil, error):
    anvil.next = error
    r = api.get(SNAP)
    assert r.status_code == 503 and _detail(r)["code"] == "anvil_unreachable"


def test_an_unconfigured_gateway_is_503_not_configured(api, anvil, monkeypatch):
    anvil.next = slurm.AnvilNotConfigured("no key")
    assert _detail(api.get(SNAP))["code"] == "anvil_not_configured"
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", "")
    r = api.get(SNAP)
    assert r.status_code == 503 and _detail(r)["code"] == "anvil_not_configured"
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", "relative/home")
    assert _detail(api.get(SNAP))["code"] == "anvil_not_configured"


def test_reads_beyond_the_concurrency_limit_wait_then_are_503_busy(db, anvil, monkeypatch):
    monkeypatch.setattr(wbm_output, "MAX_CONCURRENT_READS", 1)
    monkeypatch.setattr(wbm_output, "BUSY_WAIT_SECONDS", 0.05)
    release = asyncio.Event
    state = {}

    async def slow(command, **kw):
        await state["gate"].wait()
        return SimpleNamespace(exit_status=0, stdout=json.dumps(INVENTORY), stderr="")

    monkeypatch.setattr(slurm, "run_remote", slow)

    async def scenario():
        state["gate"] = release()
        source = wbm_output.OutputSource("run", WORK_DIR)
        first = asyncio.create_task(wbm_output.inventory(source))
        await asyncio.sleep(0.01)
        with pytest.raises(wbm_output.WbmOutputError) as busy:
            await wbm_output.inventory(source)
        assert (busy.value.http_status, busy.value.code) == (503, "output_busy")
        state["gate"].set()
        assert await first == INVENTORY
        assert await wbm_output.inventory(source) == INVENTORY      # the place was given back

    asyncio.run(scenario())


# ---- the map's image format ---------------------------------------------------------------------


def test_a_map_is_png_unless_webp_is_asked_for(api, anvil):
    anvil.next = (0, json.dumps({**MAP, "format": "webp", "mediaType": "image/webp"}), "")
    r = api.get(f"{SNAP}/map?{MAP_QUERY}&image=webp")
    assert r.status_code == 200 and r.content == PNG and r.headers["content-type"] == "image/webp"
    fmt = lambda c: c[c.index("--format") + 1]
    assert fmt(anvil.toolkit_commands()[0]) == "webp"
    r = api.get(f"{SNAP}/map?{MAP_QUERY}")
    assert r.headers["content-type"] == "image/png" and fmt(anvil.toolkit_commands()[1]) == "png"
    assert api.get(f"{SNAP}/map?{MAP_QUERY}&image=gif").status_code == 422


# ---- a snapshot's answers are kept ---------------------------------------------------------------


def _count(anvil) -> int:
    return len(anvil.toolkit_commands())


def test_a_snapshots_second_identical_call_is_answered_from_memory(api, anvil):
    first = api.get(f"{SNAP}/map?{MAP_QUERY}&encoding=json").json()
    assert api.get(f"{SNAP}/map?{MAP_QUERY}&encoding=json").json() == first
    api.get(SNAP)
    api.get(SNAP)
    api.get(f"{SNAP}/series?{SERIES_QUERY}")
    api.get(f"{SNAP}/series?{SERIES_QUERY}")
    assert _count(anvil) == 3


def test_a_runs_output_is_never_kept(api, anvil):
    api.get(JOB, headers=OWNER_HEADERS)
    api.get(JOB, headers=OWNER_HEADERS)
    assert _count(anvil) == 2 and not wbm_output._answers


def test_a_call_with_other_arguments_is_another_answer(api, anvil):
    api.get(f"{SNAP}/map?{MAP_QUERY}")
    api.get(f"{SNAP}/map?{MAP_QUERY}&width=100")
    api.get(f"{SNAP}/map?{MAP_QUERY}&image=webp")
    assert _count(anvil) == 3


def test_a_new_toolkit_install_does_not_get_the_old_answer(api, anvil, monkeypatch):
    seen = []

    async def run(command, **kw):
        seen.append(command)
        return SimpleNamespace(exit_status=0, stdout=json.dumps(INVENTORY), stderr="")

    monkeypatch.setattr(slurm, "run_remote", run)
    api.get(SNAP)
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", HOME + "-2")
    api.get(SNAP)
    assert len(seen) == 2 and HOME + "-2/bin" in seen[1]


def test_a_download_is_never_kept(api, anvil):
    api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    assert _count(anvil) == 2 and not wbm_output._answers


def test_a_failure_is_not_kept(api, anvil):
    anvil.next = (3, "", "openghm: no output")
    assert api.get(SNAP).status_code == 404
    assert api.get(SNAP).status_code == 200
    assert _count(anvil) == 2


def test_identical_calls_at_once_share_one_toolkit_call(db, anvil, monkeypatch):
    calls = []
    gate = {}

    async def slow(command, **kw):
        calls.append(command)
        await gate["go"].wait()
        return SimpleNamespace(exit_status=0, stdout=json.dumps(INVENTORY), stderr="")

    monkeypatch.setattr(slurm, "run_remote", slow)

    async def scenario():
        gate["go"] = asyncio.Event()
        source = wbm_output.snapshot_source(SNAPSHOT)
        tasks = [asyncio.create_task(wbm_output.inventory(source)) for _ in range(5)]
        await asyncio.sleep(0.01)
        gate["go"].set()
        assert await asyncio.gather(*tasks) == [INVENTORY] * 5
        assert await wbm_output.inventory(source) == INVENTORY

    asyncio.run(scenario())
    assert len(calls) == 1 and not wbm_output._flights


def test_a_failure_reaches_every_waiter_and_is_not_kept(db, anvil, monkeypatch):
    calls = []
    gate = {}

    async def failing(command, **kw):
        calls.append(command)
        await gate["go"].wait()
        return SimpleNamespace(exit_status=1, stdout="", stderr="openghm: boom")

    monkeypatch.setattr(slurm, "run_remote", failing)

    async def scenario():
        gate["go"] = asyncio.Event()
        source = wbm_output.snapshot_source(SNAPSHOT)
        tasks = [asyncio.create_task(wbm_output.inventory(source)) for _ in range(3)]
        await asyncio.sleep(0.01)
        gate["go"].set()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        assert all(isinstance(r, wbm_output.WbmOutputError) and r.code == "output_failed" for r in results)
        with pytest.raises(wbm_output.WbmOutputError):
            await wbm_output.inventory(source)

    asyncio.run(scenario())
    assert len(calls) == 2 and not wbm_output._answers and not wbm_output._flights


def test_a_waiter_that_leaves_does_not_end_the_call_for_the_others(db, anvil, monkeypatch):
    calls = []
    gate = {}

    async def slow(command, **kw):
        calls.append(command)
        await gate["go"].wait()
        return SimpleNamespace(exit_status=0, stdout=json.dumps(INVENTORY), stderr="")

    monkeypatch.setattr(slurm, "run_remote", slow)

    async def scenario():
        gate["go"] = asyncio.Event()
        source = wbm_output.snapshot_source(SNAPSHOT)
        first = asyncio.create_task(wbm_output.inventory(source))
        second = asyncio.create_task(wbm_output.inventory(source))
        await asyncio.sleep(0.01)
        first.cancel()
        gate["go"].set()
        assert await second == INVENTORY

    asyncio.run(scenario())
    assert len(calls) == 1


def test_a_hit_takes_no_place(db, anvil, monkeypatch):
    monkeypatch.setattr(wbm_output, "MAX_CONCURRENT_READS", 1)
    monkeypatch.setattr(wbm_output, "BUSY_WAIT_SECONDS", 0.05)

    async def scenario():
        source = wbm_output.snapshot_source(SNAPSHOT)
        await wbm_output.inventory(source)
        sem = asyncio.Semaphore(0)                       # every place taken
        wbm_output._slots[id(asyncio.get_running_loop())] = sem
        assert await wbm_output.inventory(source) == INVENTORY

    asyncio.run(scenario())


def test_the_cache_drops_the_least_recently_used_beyond_its_byte_budget(monkeypatch):
    monkeypatch.setattr(wbm_output, "_answers", wbm_output.collections.OrderedDict())
    monkeypatch.setattr(wbm_output, "_answers_bytes", 0)
    monkeypatch.setattr(wbm_output, "ANSWER_CACHE_BYTES", 100)
    for name in "abc":
        wbm_output._keep(name, {"k": name}, 25)         # 75 bytes
    wbm_output._answers.move_to_end("a")
    wbm_output._keep("d", {"k": "d"}, 25)
    wbm_output._keep("e", {"k": "e"}, 25)               # 125: the least recent, b, goes
    assert set(wbm_output._answers) == {"a", "c", "d", "e"} and wbm_output._answers_bytes == 100


def test_an_entry_over_a_quarter_of_the_budget_is_not_kept(monkeypatch):
    monkeypatch.setattr(wbm_output, "_answers", wbm_output.collections.OrderedDict())
    monkeypatch.setattr(wbm_output, "_answers_bytes", 0)
    monkeypatch.setattr(wbm_output, "ANSWER_CACHE_BYTES", 100)
    wbm_output._keep("big", {}, 26)
    wbm_output._keep("ok", {}, 25)
    assert list(wbm_output._answers) == ["ok"] and wbm_output._answers_bytes == 25


# ---- the download --------------------------------------------------------------------------------


def test_a_subset_is_written_on_anvil_streamed_back_and_deleted(api, anvil):
    r = api.get(f"{JOB}/subset?{SUBSET_QUERY}", headers=OWNER_HEADERS)
    assert r.status_code == 200 and r.content == NC
    assert r.headers["content-type"] == "application/x-netcdf"
    assert r.headers["content-length"] == str(len(NC))
    assert r.headers["content-disposition"] == 'attachment; filename="sim-job-1_runoff_daily_2000-01-03_2000-01-06.nc"'
    assert r.headers["cache-control"] == "private, no-store"
    (cmd,) = anvil.toolkit_commands()
    out = cmd[cmd.index("--out") + 1]
    assert posixpath.dirname(out) == DOWNLOADS and out.endswith(".nc") and len(posixpath.basename(out)) == 35
    assert cmd[2:cmd.index("--out")] == ["subset", WORK_DIR, "--var", "runoff", "--resolution", "daily", "--format", "nc",
                                         "--start", "2000-01-03", "--end", "2000-01-06", "--bbox", "-101,40,-99,42"]
    assert anvil.streams == [out]
    assert anvil.removed == [out, out + ".part"] and out not in anvil.files         # gone afterwards
    assert anvil.last_kw["timeout"] == wbm_output.SUBSET_TIMEOUT_SECONDS


def test_each_download_has_a_file_of_its_own_and_a_snapshots_is_named_for_it(api, anvil):
    api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    r = api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    a, b = ([w for w in c if w.endswith(".nc")][0] for c in anvil.toolkit_commands())
    assert a != b
    assert r.headers["content-disposition"].startswith(f'attachment; filename="{SNAPSHOT[:12]}_runoff_daily_')


def test_the_download_directory_is_configurable_and_must_be_absolute(api, anvil, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_OUTPUT_DOWNLOAD_DIR", "/anvil/scratch/x-openghm/dl/")
    api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    cmd = anvil.toolkit_commands()[0]
    assert posixpath.dirname(cmd[cmd.index("--out") + 1]) == "/anvil/scratch/x-openghm/dl"
    monkeypatch.setattr(settings, "ANVIL_OUTPUT_DOWNLOAD_DIR", "relative/dl")
    r = api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    assert r.status_code == 503 and _detail(r)["code"] == "anvil_not_configured"
    assert len(anvil.toolkit_commands()) == 1


def test_files_a_day_old_are_swept_before_a_download_at_most_every_ten_minutes(api, anvil, monkeypatch):
    api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    finds = [c for c in anvil.commands if c.startswith("find ")]
    assert len(finds) == 1
    assert finds[0] == (f"find {DOWNLOADS} -maxdepth 1 -type f \\( -name '*.nc' -o -name '*.nc.part' \\) -mmin +1440 -delete")
    assert anvil.commands.index(finds[0]) == 0                      # before the toolkit ran
    api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    assert len([c for c in anvil.commands if c.startswith("find ")]) == 1
    clock = {"t": 0.0}
    monkeypatch.setattr(wbm_output.time, "monotonic", lambda: clock["t"] + wbm_output._last_sweep + 601)
    api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    assert len([c for c in anvil.commands if c.startswith("find ")]) == 2


def test_a_sweep_that_fails_does_not_fail_the_download(api, anvil, monkeypatch):
    async def broken(command, **kw):
        if command.startswith("find "):
            raise OSError("sweep failed")
        return await anvil.run_remote(command, **kw)

    monkeypatch.setattr(slurm, "run_remote", broken)
    r = api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    assert r.status_code == 200 and r.content == NC


def test_a_subset_the_toolkit_refuses_leaves_nothing_to_remove(api, anvil):
    anvil.next = (2, "", "openghm: this request reads 912 million cells; one call may read at most 400 million.\n")
    r = api.get(f"{JOB}/subset?{SUBSET_QUERY}", headers=OWNER_HEADERS)
    assert r.status_code == 422 and "912 million" in _detail(r)["message"]
    assert anvil.removed == [] and anvil.streams == []


def test_a_subset_that_fails_removes_what_it_may_have_started_to_write(api, anvil):
    anvil.next = (1, "", "openghm: cannot read the output: OSError: boom\n")
    r = api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    assert r.status_code == 502
    words = anvil.toolkit_commands()[0]
    path = words[words.index("--out") + 1]
    assert anvil.removed == [path, path + ".part"]
    anvil.removed.clear()
    anvil.next = SlurmlyError("dropped")
    assert api.get(f"{SNAP}/subset?{SUBSET_QUERY}").status_code == 503
    assert len(anvil.removed) == 2                                 # an SSH timeout may have left a partial file


def test_a_toolkit_answer_without_the_file_it_was_asked_to_write_is_a_bad_gateway(api, anvil):
    anvil.next = (0, json.dumps({"format": "nc", "bytes": 5, "path": "/elsewhere.nc", "period": {}}), "")
    r = api.get(f"{SNAP}/subset?{SUBSET_QUERY}")
    assert r.status_code == 502 and _detail(r)["code"] == "output_failed"
    assert len(anvil.removed) == 2 and anvil.streams == []


def test_a_stream_that_breaks_or_is_short_still_deletes_the_file(anvil, monkeypatch):
    async def run():
        d = wbm_output.Download(path=f"{DOWNLOADS}/x.nc", size=len(NC), filename="x.nc")
        anvil.files[d.path] = NC
        got = []
        with pytest.raises(Exception) as exc:
            async for chunk in wbm_output.stream_download(d):
                got.append(chunk)
        return got, exc.value

    async def broken(path, *, chunk_size):
        yield NC[:10]
        raise OSError("sftp connection lost")
        yield b""  # pragma: no cover

    monkeypatch.setattr(anvil_files, "stream_file", broken)
    got, err = asyncio.run(run())
    assert got == [NC[:10]] and isinstance(err, OSError)
    assert anvil.removed == [f"{DOWNLOADS}/x.nc", f"{DOWNLOADS}/x.nc.part"]
    anvil.removed.clear()

    async def short(path, *, chunk_size):
        yield NC[:-1]

    monkeypatch.setattr(anvil_files, "stream_file", short)
    got, err = asyncio.run(run())
    assert isinstance(err, RuntimeError) and "not the" in str(err)
    assert anvil.removed[0] == f"{DOWNLOADS}/x.nc"


def test_a_client_that_goes_away_mid_download_still_deletes_the_file(anvil):
    async def scenario():
        d = wbm_output.Download(path=f"{DOWNLOADS}/y.nc", size=len(NC), filename="y.nc")
        anvil.files[d.path] = NC
        gen = wbm_output.stream_download(d)
        first = await gen.__anext__()
        assert first == NC[:4096]
        await gen.aclose()                                         # what a closed connection does to the stream
        assert anvil.removed[0] == d.path

    asyncio.run(scenario())


def test_a_removal_that_fails_is_logged_not_raised(anvil, monkeypatch, caplog):
    async def boom(path):
        raise OSError("sftp down")

    monkeypatch.setattr(anvil_files, "remove_file", boom)

    async def scenario():
        d = wbm_output.Download(path=f"{DOWNLOADS}/z.nc", size=len(NC), filename="z.nc")
        anvil.files[d.path] = NC
        return [c async for c in wbm_output.stream_download(d)]

    assert b"".join(asyncio.run(scenario())) == NC
    assert "could not remove" in caplog.text
