"""A run's output on Anvil scratch, browsed and downloaded as one ZIP (ADR 0040,
mission 2026-10-25-scratch-run-download): `GET /jobs/{id}/files`, `.../files/folder` and
`POST .../files/archive`, `app.services.run_files`, and the shared writer in `tree_archive`.

No SSH: `anvil_files.sftp_session` is replaced by an in-memory SFTP server (`FakeSftp`) that has
folders, files, symbolic links, sizes that need no bytes behind them, and reads that can
break. The ZIP writer's own behaviour for published objects is `test_tree_archive`'s.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import posixpath
import zipfile
from contextlib import asynccontextmanager
from types import SimpleNamespace

import asyncssh
import pytest
from conftest import raises_stream_error
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import run_files as routes
from app.core.config import settings
from app.core.roles import Role
from app.services import anvil_files, run_files, slurm, tree_archive, tree_browse
from route_helpers import make_job, make_user, token_for

OUTPUT_BASE = "/anvil/scratch/x-openghm/simulations"
OWNER = "owner"
OWNER_HEADERS = token_for(OWNER)
SIM = "sim-job-1"
ROOT = f"{OUTPUT_BASE}/{SIM}/wbm_output/{SIM}"
STAMP = 1_790_000_000  # 2026-09-21T13:33:20Z
STAMP_ISO = "2026-09-21T14:13:20Z"

DAILY = {f"daily/wbm_{y}.nc": bytes([65 + i]) * (100 + i) for i, y in enumerate((2000, 2001, 2002))}
FILES = {
    **DAILY,
    "monthly/runoff/wbm_2000.nc": b"monthly-runoff-2000" * 50,
    "monthly/discharge/wbm_2000.nc": b"monthly-discharge-2000" * 40,
    "wbm_test.MT.csv": b"a,b\n1,2\n",
    "EarthAtlas_runoff.url": b"[InternetShortcut]\n",
}


class FakeSftp:
    """The part of asyncssh's `SFTPClient` that `run_files` uses, over dicts."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.dirs: set[str] = {"/"}
        self.links: dict[str, str] = {}
        self.sizes: dict[str, int] = {}  # what a listing says, when it is not the data's length
        self.opened: list[str] = []  # paths the file stream was asked to read
        self.streams: list[list[tuple[str, int]]] = []  # one entry list per remote process
        self.stream_open = 0
        self.listed: list[str] = []
        self.break_after: dict[str, int] = {}  # path -> bytes before the connection is lost
        self.gone: set[str] = set()  # paths that vanish between the listing and the read
        self.grow: set[str] = set()  # paths that have more bytes than they were listed with
        self.sessions = 0
        self.unreachable: BaseException | None = None
        self.python_error: BaseException | None = None    # what the login-node pre-flight raises
        self.preflights = 0

    def put(self, path: str, data: bytes = b"") -> None:
        self.files[path] = data
        self.mkdir(posixpath.dirname(path))

    def mkdir(self, path: str) -> None:
        while path and path not in self.dirs:
            self.dirs.add(path)
            path = posixpath.dirname(path)

    def link(self, path: str, target: str) -> None:
        self.links[path] = target
        self.mkdir(posixpath.dirname(path))

    def _resolve(self, path: str) -> str:
        parts = [p for p in path.split("/") if p]
        done = "/"
        for index, part in enumerate(parts):
            here = posixpath.join(done, part)
            if here in self.links:
                rest = "/".join(parts[index + 1 :])
                return self._resolve(posixpath.join(self.links[here], rest) if rest else self.links[here])
            done = here
        return done

    def _exists(self, real: str) -> bool:
        return real in self.files or real in self.dirs

    async def realpath(self, path: str) -> str:
        real = self._resolve(path)
        if not self._exists(real):
            raise asyncssh.SFTPNoSuchFile("no such file")
        return real

    async def readdir(self, path: str):
        real = self._resolve(path)
        self.listed.append(real)
        if real in self.files:
            raise asyncssh.SFTPFailure("not a directory")
        if real not in self.dirs:
            raise asyncssh.SFTPNoSuchFile("no such file")
        out = [SimpleNamespace(filename=".", attrs=SimpleNamespace(type=2, size=0, mtime=STAMP)),
               SimpleNamespace(filename="..", attrs=SimpleNamespace(type=2, size=0, mtime=STAMP))]
        for child in sorted(self.dirs | set(self.files) | set(self.links)):
            if child != real and posixpath.dirname(child) == real:
                if child in self.links:
                    kind, size = 3, 0
                elif child in self.dirs:
                    kind, size = 2, 4096
                else:
                    kind, size = 1, self.sizes.get(child, len(self.files[child]))
                out.append(SimpleNamespace(filename=posixpath.basename(child),
                                           attrs=SimpleNamespace(type=kind, size=size, mtime=STAMP)))
        return out


class FakeStream:
    """`anvil_files.FileStream` over the same dicts: it answers as the remote script does (a
    file that is gone, another size than listed, or grown is an error), in the entries' order,
    and a path in `break_after` loses the connection after that many bytes."""

    def __init__(self, fake: FakeSftp, entries: list[tuple[str, int]]) -> None:
        self.fake, self.entries, self.at = fake, entries, 0

    def read_file(self, path: str, size: int):
        if self.at >= len(self.entries) or self.entries[self.at] != (path, size):
            raise anvil_files.RemoteReadError(f"{path}: not the next file of the stream")
        self.at += 1
        return self._read(path, size)

    async def _read(self, path: str, size: int):
        fake = self.fake
        fake.opened.append(path)
        if path in fake.gone or path not in fake.files:
            raise anvil_files.RemoteReadError(f"{path}: FileNotFoundError: no such file")
        data = fake.files[path] + (b"EXTRA" if path in fake.grow else b"")
        if len(fake.files[path]) != size:
            raise anvil_files.RemoteReadError(f"{path} is {len(fake.files[path])} bytes, {size} expected")
        if path in fake.grow:
            raise anvil_files.RemoteReadError(f"{path} grew while it was read")
        limit = fake.break_after.get(path)
        for at in range(0, len(data), 4096):
            piece = data[at : at + 4096]
            if limit is not None and at + len(piece) > limit:
                yield piece[: max(limit - at, 0)] if limit > at else b""
                raise asyncssh.ConnectionLost("connection lost")
            await asyncio.sleep(0)
            yield piece


@pytest.fixture
def sftp(monkeypatch) -> FakeSftp:
    fake = FakeSftp()
    for path, data in FILES.items():
        fake.put(f"{ROOT}/{path}", data)
    fake.put(f"{OUTPUT_BASE}/{SIM}/simulation.json", b"{}")  # beside the output, not in it

    @asynccontextmanager
    async def session():
        if fake.unreachable is not None:
            raise fake.unreachable
        fake.sessions += 1
        yield fake

    @asynccontextmanager
    async def stream_files(entries):
        if fake.unreachable is not None:
            raise fake.unreachable
        fake.streams.append(list(entries))
        fake.stream_open += 1
        try:
            yield FakeStream(fake, list(entries))
        finally:
            fake.stream_open -= 1

    async def check_remote_python():
        fake.preflights += 1
        if fake.python_error is not None:
            raise fake.python_error

    monkeypatch.setattr(anvil_files, "check_remote_python", check_remote_python)
    monkeypatch.setattr(anvil_files, "sftp_session", session)
    monkeypatch.setattr(anvil_files, "stream_files", stream_files)
    monkeypatch.setattr(settings, "ANVIL_OUTPUT_BASE", OUTPUT_BASE)
    monkeypatch.setattr(tree_archive, "_active", 0)
    return fake


@pytest.fixture
def api(db, sftp) -> TestClient:
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "COMPLETED")
    app = FastAPI()
    app.include_router(routes.router, prefix="/api/v1")
    return TestClient(app)


LIST = "/api/v1/jobs/job-1/files"
FOLDER = "/api/v1/jobs/job-1/files/folder"
ARCHIVE = "/api/v1/jobs/job-1/files/archive"


def post(api, folder, names, headers=OWNER_HEADERS):
    return api.post(ARCHIVE, json={"folder": folder, "names": names}, headers=headers)


def opened(body: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(body))


def detail(response) -> dict:
    return response.json()["detail"]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---- who, and which run ------------------------------------------------------------------------


@pytest.mark.parametrize("url", [LIST, FOLDER, ARCHIVE])
def test_the_owner_staff_and_admins_may_read_a_runs_files_and_no_one_else(api, sftp, db, url):
    def ask(headers):
        if url == ARCHIVE:
            return post(api, "daily/", ["wbm_2000.nc"], headers)
        return api.get(f"{url}?path=daily/", headers=headers)

    for sub, role in (("staff", Role.STAFF), ("admin", Role.ADMIN)):
        db.users.docs[sub] = make_user(sub, role)
    assert (api.post(ARCHIVE) if url == ARCHIVE else api.get(url)).status_code == 401
    assert ask(token_for("guest", Role.GUEST)).status_code == 403
    db.users.docs["other"] = make_user("other", can_run_simulations=True)
    other = ask(token_for("other"))
    missing = api.get("/api/v1/jobs/nope/files", headers=token_for("other")) if url != ARCHIVE else api.post(
        "/api/v1/jobs/nope/files/archive", json={"folder": "", "names": ["x"]}, headers=token_for("other"))
    assert other.status_code == 404 and (other.status_code, other.json()) == (missing.status_code, missing.json())
    assert sftp.sessions == 0 and sftp.opened == []                    # nothing was asked of Anvil for any of them
    for headers in (OWNER_HEADERS, token_for("staff", Role.STAFF), token_for("admin", Role.ADMIN)):
        assert ask(headers).status_code == 200, url


@pytest.mark.parametrize("url", [LIST, FOLDER, ARCHIVE])
def test_a_draft_that_never_ran_a_running_run_and_a_purged_one_say_so(api, sftp, db, url):
    def ask():
        if url == ARCHIVE:
            return post(api, "daily/", ["wbm_2000.nc"])
        return api.get(url, headers=OWNER_HEADERS)

    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    r = ask()
    assert r.status_code == 404 and detail(r)["code"] == "output_missing"
    for status in ("PENDING", "SUBMITTED", "RUNNING", "COMPLETING"):
        db.jobs.docs["job-1"] = make_job("job-1", OWNER, status)
        r = ask()
        assert r.status_code == 409 and detail(r)["code"] == "run_not_finished", status
    db.jobs.docs["job-1"] = {**make_job("job-1", OWNER, "COMPLETED"), "files": "purged"}
    r = ask()
    assert r.status_code == 410 and detail(r)["code"] == "output_purged" and "30 days" in detail(r)["message"]
    assert sftp.sessions == 0


@pytest.mark.parametrize("status", ["COMPLETED", "FAILED", "CANCELLED"])
def test_a_run_that_has_stopped_can_be_read_whatever_its_verdict(api, db, status):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, status)
    assert api.get(LIST, headers=OWNER_HEADERS).status_code == 200


def test_the_output_directory_is_built_from_the_sim_id_not_from_the_request_or_the_work_dir(api, sftp, db):
    db.jobs.docs["job-1"]["work_dir"] = "/somewhere/else/sim-job-1"
    r = api.get(LIST, headers=OWNER_HEADERS)
    assert r.status_code == 200 and sftp.listed == [ROOT]
    db.jobs.docs["job-1"]["sim_id"] = "sim; touch /tmp/x"
    r = api.get(LIST, headers=OWNER_HEADERS)
    assert r.status_code == 404 and detail(r)["code"] == "output_missing"


def test_a_run_whose_output_directory_is_not_there_is_404_output_missing(api, sftp):
    for path in [p for p in sftp.files if p.startswith(f"{OUTPUT_BASE}/{SIM}/wbm_output")]:
        del sftp.files[path]
    sftp.dirs = {d for d in sftp.dirs if not d.startswith(f"{OUTPUT_BASE}/{SIM}/wbm_output")}
    for r in (api.get(LIST, headers=OWNER_HEADERS), api.get(FOLDER, headers=OWNER_HEADERS),
              post(api, "", ["daily/"])):
        assert r.status_code == 404 and detail(r)["code"] == "output_missing"
    assert tree_archive._active == 0


# ---- the listing -------------------------------------------------------------------------------


def test_the_listing_is_one_folder_with_folders_first_and_the_files_sizes_and_times(api):
    r = api.get(LIST, headers=OWNER_HEADERS)
    assert r.status_code == 200
    assert r.json() == {
        "id": SIM, "path": "", "nextCursor": None,
        "folders": [{"name": "daily", "path": "daily/"}, {"name": "monthly", "path": "monthly/"}],
        "files": [
            {"name": "EarthAtlas_runoff.url", "path": "EarthAtlas_runoff.url", "size": 19, "lastModified": STAMP_ISO},
            {"name": "wbm_test.MT.csv", "path": "wbm_test.MT.csv", "size": 8, "lastModified": STAMP_ISO},
        ],
    }
    r = api.get(f"{LIST}?path=monthly/runoff", headers=OWNER_HEADERS).json()
    assert r["path"] == "monthly/runoff/" and r["folders"] == []
    assert r["files"] == [{"name": "wbm_2000.nc", "path": "monthly/runoff/wbm_2000.nc", "size": 19 * 50, "lastModified": STAMP_ISO}]


def test_the_listing_pages_by_offset(api, sftp, monkeypatch):
    monkeypatch.setattr(run_files, "PAGE_SIZE", 2)
    first = api.get(f"{LIST}?path=daily/", headers=OWNER_HEADERS).json()
    assert [f["name"] for f in first["files"]] == ["wbm_2000.nc", "wbm_2001.nc"] and first["nextCursor"] == "2"
    last = api.get(f"{LIST}?path=daily/&cursor=2", headers=OWNER_HEADERS).json()
    assert [f["name"] for f in last["files"]] == ["wbm_2002.nc"] and last["nextCursor"] is None
    assert api.get(f"{LIST}?path=daily/&cursor=x", headers=OWNER_HEADERS).status_code == 422


def test_a_folder_that_is_not_there_or_is_a_file_is_404(api):
    for path in ("nothing/", "daily/wbm_2000.nc", "daily/wbm_2000.nc/"):
        r = api.get(f"{LIST}?path={path}", headers=OWNER_HEADERS)
        assert r.status_code == 404 and detail(r)["code"] == "path_not_found", path


# ---- paths stay inside the output --------------------------------------------------------------


@pytest.mark.parametrize("path", ["../", "daily/../..", "/etc", "daily//x", "./daily", "a\\b", "daily/\x01", "x/" * 500])
def test_a_path_that_is_not_confined_to_the_output_is_422_and_nothing_is_asked_of_anvil(api, sftp, path):
    for url in (LIST, FOLDER):
        r = api.get(url, params={"path": path}, headers=OWNER_HEADERS)
        assert r.status_code == 422 and detail(r)["code"] == "invalid_path", (url, path)
    r = post(api, path, ["x.nc"])
    assert r.status_code == 422 and detail(r)["code"] == "invalid_path"
    assert sftp.sessions == 0 and tree_archive._active == 0


@pytest.mark.parametrize("names", [[], [".."], ["../x"], ["a/b"], ["daily/../x/"], [""], ["a\\b"], [str(n) for n in range(1001)]])
def test_names_that_are_not_entries_of_the_folder_are_422(api, sftp, names):
    r = post(api, "", names)
    assert r.status_code == 422 and detail(r)["code"] == "invalid_selection"
    assert sftp.sessions == 0


def test_a_link_is_never_listed_followed_or_packed(api, sftp):
    sftp.put("/anvil/scratch/other-user/secret.txt", b"secret")
    sftp.link(f"{ROOT}/daily/escape", "/anvil/scratch/other-user")       # a folder out of the output
    sftp.link(f"{ROOT}/daily/secret.txt", "/anvil/scratch/other-user/secret.txt")
    sftp.link(f"{ROOT}/inside", f"{ROOT}/daily")                         # a link that stays inside is not followed either
    listing = api.get(f"{LIST}?path=daily/", headers=OWNER_HEADERS).json()
    assert [f["name"] for f in listing["files"]] == list(f.split("/")[1] for f in DAILY) and listing["folders"] == []
    assert "inside" not in [f["name"] for f in api.get(LIST, headers=OWNER_HEADERS).json()["folders"]]
    # a path through a link is refused, whether or not it ends inside the output
    for path in ("daily/escape/", "inside/"):
        for url in (LIST, FOLDER):
            r = api.get(f"{url}?path={path}", headers=OWNER_HEADERS)
            assert r.status_code == 404 and detail(r)["code"] == "path_not_found", (url, path)
    # a name that is a link is not an entry
    for names in (["secret.txt"], ["escape/"]):
        r = post(api, "daily/", names)
        assert r.status_code == 404 and detail(r)["code"] == "path_not_found"
    # and a folder with a link in it packs only what is real
    r = post(api, "", ["daily/"])
    assert r.status_code == 200
    assert sorted(opened(r.content).namelist()) == sorted(f"daily/{n.split('/')[1]}" for n in DAILY)
    assert "/anvil/scratch/other-user/secret.txt" not in sftp.opened
    assert tree_archive._active == 0


def test_the_output_directory_may_itself_be_reached_through_a_link(api, sftp):
    # scratch is often a link (`/anvil/scratch` into a filesystem of its own): only where a
    # folder ends up, compared with where the output directory ends up, matters.
    moved = {p: d for p, d in sftp.files.items()}
    sftp.files, sftp.dirs = {}, {"/"}
    for path, data in moved.items():
        sftp.put(path.replace("/anvil/scratch", "/gpfs/anvil/scratch"), data)
    sftp.link("/anvil/scratch", "/gpfs/anvil/scratch")
    r = api.get(f"{LIST}?path=daily/", headers=OWNER_HEADERS)
    assert r.status_code == 200 and len(r.json()["files"]) == 3
    assert post(api, "", ["daily/"]).status_code == 200


# ---- the total of a folder ---------------------------------------------------------------------


def test_a_folder_is_totalled_at_any_depth(api):
    r = api.get(f"{FOLDER}?path=monthly/", headers=OWNER_HEADERS)
    total = sum(len(FILES[p]) for p in FILES if p.startswith("monthly/"))
    assert r.status_code == 200 and r.json() == {
        "path": "monthly/", "files": 2, "bytes": total,
        "limit_bytes": tree_browse.ARCHIVE_LIMIT_BYTES, "fits": True, "complete": True,
    }
    everything = api.get(FOLDER, headers=OWNER_HEADERS).json()
    assert everything["path"] == "" and everything["files"] == len(FILES)
    assert everything["bytes"] == sum(len(d) for d in FILES.values())


def test_an_empty_folder_fits_and_a_folder_over_the_limit_does_not(api, sftp):
    sftp.mkdir(f"{ROOT}/empty")
    assert api.get(f"{FOLDER}?path=empty/", headers=OWNER_HEADERS).json() == {
        "path": "empty/", "files": 0, "bytes": 0, "limit_bytes": tree_browse.ARCHIVE_LIMIT_BYTES, "fits": True, "complete": True}
    half = tree_browse.ARCHIVE_LIMIT_BYTES // 2 + 1
    sftp.sizes[f"{ROOT}/daily/wbm_2000.nc"] = half
    sftp.sizes[f"{ROOT}/daily/wbm_2001.nc"] = half
    r = api.get(f"{FOLDER}?path=daily/", headers=OWNER_HEADERS).json()
    assert r["bytes"] > 10 * 1024 * 1024 * 1024 and r["fits"] is False and r["complete"] is True


def test_a_folder_with_too_many_files_is_cut_off_and_does_not_fit(api, monkeypatch):
    monkeypatch.setattr(run_files, "SCAN_MAX_FILES", 4)
    r = api.get(FOLDER, headers=OWNER_HEADERS).json()
    assert r["complete"] is False and r["fits"] is False and r["files"] == 4


def test_a_walk_that_takes_too_long_is_a_503(api, sftp, monkeypatch):
    monkeypatch.setattr(run_files, "SCAN_TIMEOUT_SECONDS", 0.05)
    original = sftp.readdir

    async def slow(path):
        await asyncio.sleep(1)
        return await original(path)

    sftp.readdir = slow
    r = api.get(FOLDER, headers=OWNER_HEADERS)
    assert r.status_code == 503 and detail(r)["code"] == "anvil_unreachable" and "too long" in detail(r)["message"]


# ---- the archive -------------------------------------------------------------------------------


def test_a_file_and_a_folder_come_down_as_one_stored_zip_that_keeps_the_tree(api, sftp):
    r = post(api, "", ["daily/", "wbm_test.MT.csv", "monthly/"])
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert r.headers["content-disposition"] == f'attachment; filename="{SIM}-files.zip"'
    assert r.headers["cache-control"] == "private, no-store"
    assert int(r.headers["content-length"]) == len(r.content)
    zf = opened(r.content)
    want = {p: d for p, d in FILES.items() if p.startswith(("daily/", "monthly/")) or p == "wbm_test.MT.csv"}
    assert sorted(zf.namelist()) == sorted(want)
    for name, data in want.items():
        assert sha(zf.read(name)) == sha(data)
    assert {i.compress_type for i in zf.infolist()} == {zipfile.ZIP_STORED}
    assert zf.testzip() is None and tree_archive._active == 0 and sftp.sessions == 1 and len(sftp.streams) == 1 and sftp.stream_open == 0  # one SFTP channel to list, one process to read


def test_a_folder_viewed_deeper_keeps_names_relative_to_it_and_one_entry_names_the_file(api):
    r = post(api, "monthly/", ["runoff/", "discharge/"])
    assert sorted(opened(r.content).namelist()) == ["discharge/wbm_2000.nc", "runoff/wbm_2000.nc"]
    assert r.headers["content-disposition"] == f'attachment; filename="{SIM}-monthly.zip"'
    r = post(api, "daily/", ["wbm_2001.nc"])
    assert opened(r.content).namelist() == ["wbm_2001.nc"]
    assert r.headers["content-disposition"] == f'attachment; filename="{SIM}-wbm_2001.nc.zip"'


def test_a_browser_form_posts_the_same_thing(api):
    r = api.post(ARCHIVE, data={"folder": "daily/", "names": ["wbm_2000.nc", "wbm_2002.nc"]}, headers=OWNER_HEADERS)
    assert r.status_code == 200 and sorted(opened(r.content).namelist()) == ["wbm_2000.nc", "wbm_2002.nc"]
    assert api.post(ARCHIVE, data={"folder": "daily/"}, headers=OWNER_HEADERS).status_code == 422


def test_a_name_the_folder_does_not_hold_is_404_and_a_file_is_not_a_folder(api, sftp):
    for names in (["nope.nc"], ["nope/"], ["wbm_test.MT.csv/"], ["daily"]):
        r = post(api, "", names)
        assert r.status_code == 404 and detail(r)["code"] == "path_not_found", names
    assert sftp.opened == [] and tree_archive._active == 0


def test_a_folder_with_nothing_in_it_has_nothing_to_download(api, sftp):
    sftp.mkdir(f"{ROOT}/empty")
    r = post(api, "", ["empty/"])
    assert r.status_code == 404 and tree_archive._active == 0


# ---- the limit, before a byte is sent ----------------------------------------------------------


def test_a_selection_over_the_limit_is_413_before_any_byte_is_read(api, sftp):
    limit = tree_browse.ARCHIVE_LIMIT_BYTES
    sftp.sizes[f"{ROOT}/daily/wbm_2000.nc"] = limit
    sftp.sizes[f"{ROOT}/daily/wbm_2001.nc"] = 1
    r = post(api, "", ["daily/"])
    assert r.status_code == 413 and detail(r)["code"] == "selection_too_large"
    assert detail(r)["limit_bytes"] == limit and detail(r)["bytes"] > limit
    r = post(api, "daily/", ["wbm_2000.nc", "wbm_2001.nc"])           # files only: the same
    assert r.status_code == 413
    assert sftp.opened == [] and tree_archive._active == 0
    # exactly the limit is allowed
    sftp.sizes[f"{ROOT}/daily/wbm_2001.nc"] = 0
    sftp.sizes[f"{ROOT}/daily/wbm_2002.nc"] = 0
    archive = asyncio.run(run_files.open_archive(SIM, "daily/", ["wbm_2000.nc"]))
    archive.release()


def test_the_limit_adds_up_across_the_folders_ticked(api, sftp):
    half = tree_browse.ARCHIVE_LIMIT_BYTES // 2 + 1
    sftp.sizes[f"{ROOT}/daily/wbm_2000.nc"] = half
    sftp.sizes[f"{ROOT}/monthly/runoff/wbm_2000.nc"] = half
    r = post(api, "", ["daily/", "monthly/"])
    assert r.status_code == 413 and sftp.opened == []


def test_a_folder_too_big_to_total_is_413_too(api, sftp, monkeypatch):
    monkeypatch.setattr(run_files, "SCAN_MAX_FILES", 3)
    r = post(api, "", ["daily/", "monthly/"])
    assert r.status_code == 413 and sftp.opened == [] and tree_archive._active == 0


def test_more_archives_than_the_limit_are_429_and_ask_nothing_of_anvil(api, sftp, monkeypatch):
    monkeypatch.setattr(tree_archive, "_active", tree_archive.MAX_ARCHIVES)
    r = post(api, "daily/", ["wbm_2000.nc"])
    assert r.status_code == 429 and detail(r)["code"] == "archive_busy"
    assert sftp.sessions == 0 and tree_archive._active == tree_archive.MAX_ARCHIVES


def test_the_places_are_shared_with_the_published_archives_and_given_back(api, sftp):
    held = [tree_archive.acquire() for _ in range(tree_archive.MAX_ARCHIVES)]     # three published downloads
    assert post(api, "daily/", ["wbm_2000.nc"]).status_code == 429
    held[0].release()
    assert post(api, "daily/", ["wbm_2000.nc"]).status_code == 200
    assert tree_archive._active == tree_archive.MAX_ARCHIVES - 1
    for slot in held[1:]:
        slot.release()
    assert tree_archive._active == 0


def test_every_refusal_gives_its_place_back(api, sftp):
    post(api, "", ["nope.nc"])                 # 404
    post(api, "../", ["x"])                    # 422
    sftp.unreachable = OSError("no route")
    post(api, "", ["daily/"])                  # 503
    assert tree_archive._active == 0


# ---- failures ----------------------------------------------------------------------------------


@pytest.mark.parametrize("error", [OSError("reset"), asyncssh.ConnectionLost("gone"), asyncssh.DisconnectError(2, "bye")])
def test_anvil_not_answering_is_503_for_each_route(api, sftp, error):
    sftp.unreachable = error
    for r in (api.get(LIST, headers=OWNER_HEADERS), api.get(FOLDER, headers=OWNER_HEADERS), post(api, "", ["daily/"])):
        assert r.status_code == 503 and detail(r)["code"] == "anvil_unreachable"
        assert "could not be reached" in detail(r)["message"]
    assert tree_archive._active == 0


def test_a_gateway_without_ssh_set_up_is_503_not_configured(api, sftp):
    sftp.unreachable = slurm.AnvilNotConfigured("no key")
    r = api.get(LIST, headers=OWNER_HEADERS)
    assert r.status_code == 503 and detail(r)["code"] == "anvil_not_configured"


def test_a_read_that_breaks_midway_ends_the_response_with_an_error_not_a_short_zip(api, sftp, caplog):
    broken = f"{ROOT}/daily/wbm_2001.nc"
    sftp.break_after[broken] = 10
    with raises_stream_error(tree_archive.ArchiveError, match="wbm_2001.nc"), caplog.at_level("WARNING"):
        post(api, "", ["daily/"])
    assert "connection lost" in caplog.text and tree_archive._active == 0


def test_a_big_file_that_breaks_midway_does_the_same_when_it_is_streamed_in_pieces(api, sftp, monkeypatch):
    monkeypatch.setattr(tree_archive, "_PREFETCH_OBJECT_BYTES", 10)    # nothing is read ahead
    sftp.break_after[f"{ROOT}/daily/wbm_2001.nc"] = 50
    with raises_stream_error(tree_archive.ArchiveError, match="wbm_2001.nc"):
        post(api, "", ["daily/"])
    assert tree_archive._active == 0


def test_a_file_that_vanishes_between_the_listing_and_the_read_ends_the_response_with_an_error(api, sftp):
    sftp.gone.add(f"{ROOT}/daily/wbm_2002.nc")                  # purged meanwhile
    with raises_stream_error(tree_archive.ArchiveError, match="wbm_2002.nc"):
        post(api, "", ["daily/"])
    assert tree_archive._active == 0


def test_a_file_that_is_not_the_listed_size_ends_the_response_with_an_error(api, sftp, monkeypatch):
    sftp.sizes[f"{ROOT}/daily/wbm_2000.nc"] = 7                 # it has shrunk since it was listed... or grown
    with raises_stream_error(tree_archive.ArchiveError):
        post(api, "", ["daily/"])
    sftp.sizes.clear()
    sftp.grow.add(f"{ROOT}/daily/wbm_2000.nc")
    with raises_stream_error(tree_archive.ArchiveError, match="grew"):
        post(api, "", ["daily/"])
    assert tree_archive._active == 0


def test_a_failed_download_leaves_nothing_behind(api, sftp):
    before = (dict(sftp.files), set(sftp.dirs), dict(sftp.links))
    sftp.break_after[f"{ROOT}/daily/wbm_2000.nc"] = 3
    with raises_stream_error(tree_archive.ArchiveError):
        post(api, "", ["daily/"])
    post(api, "", ["nope/"])
    assert (sftp.files, sftp.dirs, sftp.links) == before and tree_archive._active == 0


def test_a_client_that_leaves_gives_the_place_back_and_closes_the_channel(sftp):
    async def run():
        archive = await run_files.open_archive(SIM, "", ["daily/", "monthly/"])
        assert tree_archive._active == 1
        stream = archive.stream()
        await anext(stream)
        await stream.aclose()                                       # what the server does when the browser goes
        assert tree_archive._active == 0
        strays = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        assert strays == []

    asyncio.run(run())


def test_the_same_writer_serves_both_sources(sftp):
    """What `test_tree_archive` checks of the writer holds here because it is the same code: the
    length follows from the listed sizes and names, and the archive is a valid one."""
    async def run():
        archive = await run_files.open_archive(SIM, "", ["daily/"])
        body = b"".join([piece async for piece in archive.stream()])
        return archive, body

    archive, body = asyncio.run(run())
    assert archive.length == len(body) and opened(body).testzip() is None
    assert archive.length == tree_archive.archive_length([(n, len(d)) for n, d in
                                                          ((f, FILES[f]) for f in sorted(DAILY))])


def test_the_zip_is_what_the_writer_makes_of_the_same_files_read_one_by_one(api, sftp):
    """Byte for byte the archive `tree_archive` writes when each file is read on its own and
    ahead (the source the SFTP reads were), and as long as `length` said before it began."""
    async def run():
        archive = await run_files.open_archive(SIM, "", ["daily/", "monthly/", "wbm_test.MT.csv"])
        got = b"".join([piece async for piece in archive.stream()])
        entries = archive._entries

        async def one_by_one(obj):
            yield FILES[obj.key[len(ROOT) + 1:]]

        @asynccontextmanager
        async def connect():
            yield one_by_one

        slot = tree_archive.acquire()
        expected = b"".join([piece async for piece in tree_archive.Archive("x.zip", entries, slot, connect).stream()])
        return archive, got, expected

    archive, got, expected = asyncio.run(run())
    assert got == expected and len(got) == archive.length and opened(got).testzip() is None
    assert sftp.streams == [[(obj.key, obj.size) for _, obj in archive._entries]]   # one process, in the archive's order
    assert [size for _, size in sftp.streams[0]] == [len(FILES[k[len(ROOT) + 1:]]) for k, _ in sftp.streams[0]]


def test_the_archive_reads_in_order_with_no_read_ahead(sftp):
    async def run():
        archive = await run_files.open_archive(SIM, "", ["daily/"])
        return archive

    archive = asyncio.run(run())
    assert archive._sequential is True
    archive.release()


def test_the_published_trees_download_still_reads_over_http():
    assert tree_archive.Archive("x.zip", [], tree_archive.acquire())._connect is None
    assert tree_archive.Archive("x.zip", [], tree_archive.acquire())._sequential is False
    tree_archive._active = 0


def test_a_stream_that_cannot_be_opened_ends_the_response_with_an_archive_error(api, sftp, monkeypatch):
    @asynccontextmanager
    async def refused(entries):
        raise OSError("no route")
        yield

    monkeypatch.setattr(anvil_files, "stream_files", refused)
    with raises_stream_error(tree_archive.ArchiveError, match="no route"):
        post(api, "", ["daily/"])
    assert tree_archive._active == 0


def test_a_login_node_that_cannot_run_the_script_is_a_503_before_any_byte_and_gives_the_place_back(
    api, sftp, caplog
):
    sftp.python_error = anvil_files.RemoteUnavailable("python3 not found at /usr/bin/python3 on the login node; set ANVIL_REMOTE_PYTHON")
    r = post(api, "", ["daily/"])
    assert r.status_code == 503 and detail(r)["code"] == "anvil_unreachable"
    assert "/usr/bin/python3" not in r.text and "ANVIL_REMOTE_PYTHON" not in r.text
    assert "cannot prepare this ZIP" in detail(r)["message"]
    assert "python3 not found at /usr/bin/python3" in caplog.text     # the detail is in the log
    assert sftp.preflights == 1 and sftp.streams == [] and sftp.opened == []
    assert tree_archive._active == 0


def test_the_failed_check_is_asked_again_for_the_next_archive(api, sftp):
    sftp.python_error = anvil_files.RemoteUnavailable("too old")
    assert post(api, "", ["daily/"]).status_code == 503
    sftp.python_error = None
    assert post(api, "", ["daily/"]).status_code == 200
    assert sftp.preflights == 2


@pytest.mark.parametrize(
    "error, code",
    [
        (OSError("reset"), "anvil_unreachable"),
        (asyncssh.ConnectionLost("gone"), "anvil_unreachable"),
        (slurm.AnvilNotConfigured("no key"), "anvil_not_configured"),
    ],
)
def test_a_connection_failure_in_the_check_is_a_503_too(api, sftp, error, code):
    sftp.python_error = error
    r = post(api, "", ["daily/"])
    assert r.status_code == 503 and detail(r)["code"] == code
    assert sftp.streams == [] and tree_archive._active == 0


def test_the_check_runs_after_the_listing_so_a_refused_selection_never_reaches_it(api, sftp):
    assert post(api, "", ["nope.nc"]).status_code == 404
    assert sftp.preflights == 0


def test_the_limit_is_the_published_trees_limit():
    assert tree_browse.ARCHIVE_LIMIT_BYTES == 10 * 1024**3


# ---- one file as it is ------------------------------------------------------------------------

FILE = "/api/v1/jobs/job-1/files/download"


def test_one_file_comes_down_as_it_is_with_its_size(api, sftp):
    r = api.get(FILE, params={"path": "daily/wbm_2001.nc"}, headers=OWNER_HEADERS)
    assert r.status_code == 200 and r.content == DAILY["daily/wbm_2001.nc"]
    assert r.headers["content-disposition"] == 'attachment; filename="wbm_2001.nc"'
    assert int(r.headers["content-length"]) == len(r.content)
    assert tree_archive._active == 0 and sftp.stream_open == 0


def test_a_missing_file_a_folder_and_a_bad_path_are_refused(api, sftp):
    for path in ("daily/nope.nc", "daily", "nope/wbm_2000.nc"):
        r = api.get(FILE, params={"path": path}, headers=OWNER_HEADERS)
        assert r.status_code == 404, path
    assert api.get(FILE, params={"path": "../x"}, headers=OWNER_HEADERS).status_code in (400, 422)
    assert api.get(FILE, params={"path": "daily/"}, headers=OWNER_HEADERS).status_code in (400, 422)
    assert tree_archive._active == 0 and sftp.opened == []


def test_another_users_run_has_no_file_to_download(api):
    r = api.get("/api/v1/jobs/nope/files/download", params={"path": "wbm_test.MT.csv"}, headers=token_for("other"))
    assert r.status_code == 404
