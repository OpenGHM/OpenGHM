"""Logs read by byte offset (ADR 0027, mission 4): the one shell command that
does the read, run here for real against files on disk (bash, so the command
must be as portable as it claims: these tests run on macOS, Anvil is GNU),
the chunking of a file that grows while it is read, and the two routes.

`slurm.run_remote` is replaced by a function that runs the command locally.
"""

from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.services import job_live, slurm

from route_helpers import make_sent_job, make_user, token_for

OWNER = "owner"
SIM = "sim-job-1"
WBM_LOG = "wbm_test.log"


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def real_reads(monkeypatch, db):
    """The real read, not conftest's stand-in."""
    monkeypatch.setattr(slurm, "read_log", REAL_READ_LOG)


REAL_READ_LOG = slurm.read_log


@pytest.fixture
def commands(monkeypatch) -> list[str]:
    """Every command `run_remote` was given, each run here in bash."""
    seen: list[str] = []

    async def run_remote(command: str, *, operation: str, retry_safe: bool = False):
        seen.append(command)
        proc = await asyncio.create_subprocess_exec(
            "bash", "-c", command,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, err = await proc.communicate()
        return SimpleNamespace(exit_status=proc.returncode, stdout=out.decode(), stderr=err.decode())

    monkeypatch.setattr(slurm, "run_remote", run_remote)
    return seen


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(job_live, "_clock", lambda: now[0])
    return now


@pytest.fixture
def anvil_dirs(tmp_path, monkeypatch):
    """Anvil's directories, under tmp_path."""
    base = tmp_path / "openghm"
    monkeypatch.setattr(settings, "ANVIL_REMOTE_BASE_DIR", str(base))
    monkeypatch.setattr(settings, "ANVIL_SSH_USERNAME", "x-openghm")
    monkeypatch.setattr(settings, "ANVIL_OUTPUT_BASE", str(tmp_path / "simulations"))
    return tmp_path


@pytest.fixture
def job(db, anvil_dirs):
    """A running job whose directories exist under tmp_path."""
    directory = anvil_dirs / "openghm" / "jobs" / "slurmly-1a2b3c4d"
    work = anvil_dirs / "simulations" / SIM
    (work / "wbm_output" / SIM).mkdir(parents=True)
    (work / "wbm_init").mkdir()
    directory.mkdir(parents=True)
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)
    db.jobs.docs["job-1"] = make_sent_job(
        "job-1", OWNER, "RUNNING",
        remote_job_dir=str(directory),
        stdout_path=str(directory / "stdout.log"),
        stderr_path=str(directory / "stderr.log"),
        work_dir=str(work),
        outcome={"wbm": {"log": f"wbm_output/{SIM}/{WBM_LOG}"}},
    )
    return db.jobs.docs["job-1"]


@pytest.fixture
def wbm_log(job):
    from pathlib import Path

    return Path(job["work_dir"]) / "wbm_output" / SIM / WBM_LOG


def read(doc, stream="wbm", offset=None, limit=262144):
    return run(slurm.read_log(doc, stream, offset, limit))


# ---- the command, against real files -----------------------------------------


def test_a_read_returns_the_bytes_from_the_offset(job, wbm_log, commands, clock):
    wbm_log.write_bytes(b"0123456789")
    got = read(job, offset=3, limit=4)
    assert got == {"exists": True, "data": "3456", "offset": 3, "next_offset": 7, "size": 10, "eof": False}
    clock[0] += 10
    got = read(job, offset=7, limit=100)
    assert got == {"exists": True, "data": "789", "offset": 7, "next_offset": 10, "size": 10, "eof": True}


def test_a_read_at_the_end_or_past_it_is_empty(job, wbm_log, commands, clock):
    wbm_log.write_bytes(b"0123456789")
    for at in (10, 50):
        clock[0] += 10
        got = read(job, offset=at)
        assert got["exists"] and got["data"] == "" and got["next_offset"] == at and got["eof"]


def test_an_empty_file_exists(job, wbm_log, commands):
    wbm_log.write_bytes(b"")
    assert read(job) == {"exists": True, "data": "", "offset": 0, "next_offset": 0, "size": 0, "eof": True}


def test_the_command_runs_under_plain_sh_too(tmp_path):
    import subprocess

    f = tmp_path / "a b'c.log"  # the path is quoted, whatever is in it
    f.write_bytes(b"hello world\n")
    command = slurm.build_log_read_command(str(f), 6, 100)
    out = subprocess.run(["sh", "-c", command], capture_output=True, text=True, check=True).stdout
    assert slurm.parse_log_read(out, offset=6, terminal=True)["data"] == "world\n"


def test_gnu_style_wrapped_base64_is_decoded(job):
    import base64

    raw = bytes(range(32, 127)) * 5
    wrapped = base64.encodebytes(raw).decode()  # 76 columns, like GNU base64
    got = slurm.parse_log_read(f"{len(raw)}\n0\n{wrapped}", offset=0, terminal=True)
    assert got["data"] == raw.decode() and got["next_offset"] == len(raw)


def test_a_file_that_is_missing_a_directory_or_a_link_is_not_there(job, wbm_log, commands):
    assert read(job)["exists"] is False  # the log has not been written
    assert read(job, "stdout")["exists"] is False
    wbm_log.mkdir()  # a directory is not a log
    assert read(job)["exists"] is False
    wbm_log.rmdir()
    secret = wbm_log.parent / "secret.txt"
    secret.write_text("not a log")
    wbm_log.symlink_to(secret)
    assert read(job) == {"exists": False, "data": "", "offset": 0, "next_offset": 0, "size": 0, "eof": True}


def test_a_missing_file_echoes_the_offset_asked_for(job, commands):
    got = read(job, offset=500)
    assert (got["exists"], got["offset"], got["next_offset"]) == (False, 500, 500)


# ---- a tail ------------------------------------------------------------------


def test_a_tail_of_a_small_file_is_all_of_it(job, wbm_log, commands):
    wbm_log.write_bytes(b"one\ntwo\n")
    assert read(job, limit=1000) == {
        "exists": True, "data": "one\ntwo\n", "offset": 0, "next_offset": 8, "size": 8, "eof": True,
    }


def test_a_tail_starts_at_a_line(job, wbm_log, commands):
    lines = [f"line {n:03d}\n" for n in range(100)]
    text = "".join(lines)
    wbm_log.write_text(text)
    got = read(job, limit=50)
    assert got["offset"] > len(text) - 50  # the cut inside a line was passed
    assert got["data"] == text[got["offset"]:]
    assert got["data"].startswith("line ")
    assert text[got["offset"] - 1] == "\n"
    assert got["next_offset"] == got["size"] == len(text) and got["eof"]


def test_a_tail_that_lands_on_a_line_start_still_moves_past_that_line(job, wbm_log, commands):
    """The rule is "after the next newline": with the cut exactly at a line
    start, the first newline in the window is that line's own end."""
    wbm_log.write_text("aaaa\nbbbb\ncccc\n")  # 15 bytes; limit 10 cuts at 5 = 'bbbb'
    got = read(job, limit=10)
    assert got["data"] == "cccc\n" and got["offset"] == 10


def test_a_tail_in_a_line_longer_than_the_window_starts_on_a_character(job, wbm_log, commands):
    wbm_log.write_bytes(("é" * 50).encode())  # 100 bytes, no newline
    got = read(job, limit=11)  # the cut at 89 is inside a character
    assert got["offset"] == 90 and got["data"] == "é" * 5
    assert "�" not in got["data"]


def test_a_tail_that_ends_mid_character_leaves_it_for_the_next_read(job, wbm_log, commands, clock):
    wbm_log.write_bytes(b"abc\n" + "é".encode()[:1])
    got = read(job, limit=100)
    assert got["data"] == "abc\n" and got["next_offset"] == 4 and got["size"] == 5 and not got["eof"]


# ---- a file that grows -------------------------------------------------------


def drain(doc, offset, clock, limit):
    """Read from `offset` until a read brings nothing new. Returns
    `(text, next offset, last chunk)`."""
    text = ""
    while True:
        clock[0] += 10
        got = read(doc, offset=offset, limit=limit)
        text += got["data"]
        if got["next_offset"] == offset or got["eof"] and not got["data"]:
            return text, got["next_offset"], got
        offset = got["next_offset"]


@pytest.mark.parametrize("limit", [4, 5, 7, 64, 1000])
def test_every_byte_of_a_growing_log_comes_exactly_once(job, wbm_log, commands, clock, db, limit):
    appends = [
        b"Spinup 1/1 (2000-01-01) first line\nFile wbm_2000.nc (2000-01-0",  # ends in a partial line
        b"",  # nothing new
        b"2) second\n",
        "caf".encode() + "é".encode()[:1],  # a character split across two appends
        "é".encode()[1:] + b"\n",
        b"",
        "日本語 \U0001F30A wave\n".encode()[:5],  # a 3-byte character cut after its lead byte...
        "日本語 \U0001F30A wave\n".encode()[5:],
        b"no newline at the end",
    ]
    wbm_log.write_bytes(b"")
    expected = b""
    text, offset = "", 0
    for piece in appends:
        with open(wbm_log, "ab") as f:
            f.write(piece)
        expected += piece
        more, offset, got = drain(job, offset, clock, limit)
        text += more
        assert expected.decode("utf-8", errors="replace").startswith(text)
        assert got["size"] == len(expected)

    # The job ends: nothing is held back any more.
    db.jobs.docs["job-1"]["status"] = "COMPLETED"
    done = db.jobs.docs["job-1"]
    more, offset, got = drain(done, offset, clock, limit)
    text += more
    assert text == expected.decode("utf-8")
    assert offset == len(expected) and got["eof"]


def test_a_dangling_lead_byte_is_replaced_only_once_the_job_has_ended(job, wbm_log, commands, clock, db):
    wbm_log.write_bytes(b"ok\n\xe6\x97")  # two of a 3-byte character's bytes, and no more
    running = read(job, offset=0)
    assert running["data"] == "ok\n" and running["next_offset"] == 3 and not running["eof"]
    clock[0] += 10
    db.jobs.docs["job-1"]["status"] = "FAILED"
    ended = read(db.jobs.docs["job-1"], offset=0)
    assert ended["data"] == "ok\n�" and ended["next_offset"] == 5 and ended["eof"]


def test_an_ended_job_does_not_split_a_character_at_a_chunk_boundary(job, wbm_log, commands, db):
    wbm_log.write_bytes("aé日".encode())  # 1 + 2 + 3 bytes
    db.jobs.docs["job-1"]["status"] = "COMPLETED"
    done = db.jobs.docs["job-1"]
    first = read(done, offset=0, limit=5)  # would cut 日 after two bytes
    assert first["data"] == "aé" and first["next_offset"] == 3 and not first["eof"]
    second = read(done, offset=3, limit=5)
    assert second["data"] == "日" and second["eof"]


# ---- sharing a read ----------------------------------------------------------


def test_identical_reads_inside_the_ttl_share_one_command(job, wbm_log, commands, clock):
    wbm_log.write_bytes(b"abc\n")
    reads = lambda: [c for c in commands if "base64" in c]  # noqa: E731
    read(job, offset=0)
    read(job, offset=0)
    assert len(reads()) == 1
    read(job, offset=1)  # another offset is another read
    read(job, offset=0, limit=10)
    assert len(reads()) == 3
    clock[0] += settings.JOB_LIVE_TTL_SECONDS + 1
    read(job, offset=0)
    assert len(reads()) == 4


def test_concurrent_identical_reads_share_one_command(job, wbm_log, commands, clock):
    wbm_log.write_bytes(b"abc\n")

    async def five():
        return await asyncio.gather(*(slurm.read_log(job, "wbm", 0, 100) for _ in range(5)))

    got = run(five())
    assert all(g["data"] == "abc\n" for g in got)
    assert len([c for c in commands if "base64" in c]) == 1


def test_a_failed_read_is_not_shared(job, wbm_log, monkeypatch, clock):
    wbm_log.write_bytes(b"abc\n")
    calls = []

    async def run_remote(command, **_kw):
        calls.append(command)
        return SimpleNamespace(exit_status=255, stdout="", stderr="ssh: connect failed")

    monkeypatch.setattr(slurm, "run_remote", run_remote)
    for _ in range(2):
        with pytest.raises(RuntimeError):
            read(job, offset=0)
    assert len(calls) == 2


# ---- which file --------------------------------------------------------------


def test_stdout_and_stderr_are_slurmlys_files(job, commands):
    from pathlib import Path

    Path(job["stdout_path"]).write_text("out\n")
    Path(job["stderr_path"]).write_text("err\n")
    assert read(job, "stdout", offset=0)["data"] == "out\n"
    assert read(job, "stderr", offset=0)["data"] == "err\n"


def test_the_wbm_log_is_found_from_the_init_that_names_this_simulation(job, wbm_log, commands, db):
    from pathlib import Path

    del db.jobs.docs["job-1"]["outcome"]
    init_dir = Path(job["work_dir"]) / "wbm_init"
    (init_dir / "other.init").write_text(
        "{\n  MT_Code_Name => {\n\tOutput_dir => '/wbm/wbm_output/sim-other/',\n\tID => 'not_this',\n  },\n}\n"
    )
    (init_dir / "mine.init").write_text(
        f"{{\n  MT_Code_Name => {{\n\tID  =>  'wbm_test',\n\tOutput_dir=>'/wbm/wbm_output/{SIM}/',\n  }},\n}}\n"
    )
    wbm_log.write_text("hello\n")
    assert read(db.jobs.docs["job-1"], offset=0)["data"] == "hello\n"
    # ... and stored, so the next read does not look again.
    assert db.jobs.docs["job-1"]["wbm_log_path"] == str(wbm_log)
    assert len([c for c in commands if "wbm_init" in c]) == 1
    read(db.jobs.docs["job-1"], offset=1)
    assert len([c for c in commands if "wbm_init" in c]) == 1


def test_an_output_dir_that_only_looks_like_this_simulation_is_not_it(job, wbm_log, commands, db):
    from pathlib import Path

    del db.jobs.docs["job-1"]["outcome"]
    init_dir = Path(job["work_dir"]) / "wbm_init"
    # `.` in the id is not a wildcard, a prefix is not the id, a longer path is not the directory.
    for name, out in (("a", SIM.replace("-", "+")), ("b", SIM + "-2"), ("c", SIM + "/daily")):
        (init_dir / f"{name}.init").write_text(f"Output_dir => '/wbm/wbm_output/{out}',\nID => 'x_{name}',\n")
    wbm_log.write_text("hello\n")
    got = read(db.jobs.docs["job-1"], offset=0)
    assert got["exists"] is False
    assert "wbm_log_path" not in db.jobs.docs["job-1"]


def test_no_init_yet_means_no_log_yet(job, commands, db):
    del db.jobs.docs["job-1"]["outcome"]
    assert read(db.jobs.docs["job-1"], offset=0)["exists"] is False


def test_an_id_that_is_not_an_id_is_not_followed(job, wbm_log, commands, db):
    from pathlib import Path

    del db.jobs.docs["job-1"]["outcome"]
    (Path(job["work_dir"]) / "wbm_init" / "mine.init").write_text(
        f"Output_dir => '/wbm/wbm_output/{SIM}/',\nID => '../../escape',\n"
    )
    assert read(db.jobs.docs["job-1"], offset=0)["exists"] is False


@pytest.mark.parametrize(
    "changes",
    [
        {"work_dir": "/somewhere/else/sim-job-1"},  # not ANVIL_OUTPUT_BASE/<sim_id>
        {"work_dir": None},
        {"sim_id": "../x"},
        {"sim_id": "sim job"},
        {"outcome": {"wbm": {"log": "../../etc/passwd"}}},
        {"outcome": {"wbm": {"log": "/etc/passwd"}}},
        {"outcome": {"wbm": {"log": f"wbm_output/{SIM}/../../x.log"}}},
        {"outcome": {"wbm": {"log": "wbm_output/other/x.log"}}},
        {"outcome": None, "wbm_log_path": "/etc/passwd"},
        {"stdout_path": "/etc/passwd", "outcome": None},
    ],
)
def test_a_path_that_is_not_the_jobs_own_reads_nothing(job, wbm_log, commands, db, changes):
    wbm_log.write_text("content\n")
    doc = {**job, **changes}
    got = read(doc, "stdout" if "stdout_path" in changes else "wbm", offset=0)
    assert got["exists"] is False and got["data"] == ""
    assert not [c for c in commands if "base64" in c]  # no file was read


# ---- the logs route ----------------------------------------------------------

LOGS = "/api/v1/jobs/job-1/logs"


def test_the_route_answers_with_the_chunk(client, job, wbm_log, commands):
    wbm_log.write_text("hello\nwörld\n")
    body = client.get(f"{LOGS}?stream=wbm&offset=0", headers=token_for(OWNER)).json()
    assert body == {
        "job_id": "job-1", "stream": "wbm", "exists": True, "data": "hello\nwörld\n",
        "offset": 0, "next_offset": 13, "size": 13, "eof": True,
    }


def test_the_route_tails_when_no_offset_is_given(client, job, wbm_log, commands):
    wbm_log.write_text("".join(f"line {n:04d}\n" for n in range(1000)))
    body = client.get(f"{LOGS}?stream=wbm&limit=100", headers=token_for(OWNER)).json()
    assert body["data"].endswith("line 0999\n") and body["data"].startswith("line ")
    assert body["offset"] > 0 and body["eof"] and body["next_offset"] == body["size"] == 10000


def test_the_route_says_when_there_is_no_file(client, job, commands):
    body = client.get(f"{LOGS}?stream=stderr", headers=token_for(OWNER)).json()
    assert body["exists"] is False and body["data"] == "" and body["eof"] is True


@pytest.mark.parametrize(
    "query",
    [
        "stream=wbm&limit=1048577",
        "stream=wbm&limit=0",
        "stream=wbm&limit=3",
        "stream=wbm&limit=-5",
        "stream=wbm&limit=lots",
        "stream=wbm&offset=-1",
        "stream=wbm&offset=x",
        "stream=nope",
        "",
    ],
)
def test_the_route_refuses_what_it_cannot_read(client, job, commands, query):
    assert client.get(f"{LOGS}?{query}", headers=token_for(OWNER)).status_code == 422
    assert commands == []


def test_the_largest_chunk_is_allowed(client, job, wbm_log, commands):
    wbm_log.write_text("x\n")
    assert client.get(f"{LOGS}?stream=wbm&limit=1048576", headers=token_for(OWNER)).status_code == 200


def test_an_unreachable_anvil_is_a_502(client, job, monkeypatch):
    async def run_remote(*_a, **_kw):
        raise ConnectionError("no route to host")

    monkeypatch.setattr(slurm, "run_remote", run_remote)
    response = client.get(f"{LOGS}?stream=stdout", headers=token_for(OWNER))
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "anvil_unreachable"


def test_another_users_log_is_a_404(client, job, wbm_log, commands, db):
    wbm_log.write_text("private\n")
    db.users.docs["other"] = make_user("other", can_run_simulations=True)
    for path in (f"{LOGS}?stream=wbm", f"{LOGS}/wbm/download"):
        response = client.get(path, headers=token_for("other"))
        assert response.status_code == 404 and "private" not in response.text
    assert client.get(f"{LOGS}?stream=wbm").status_code == 401


# ---- the download route ------------------------------------------------------

DOWNLOAD = "/api/v1/jobs/job-1/logs/wbm/download"


def test_the_download_streams_the_whole_file_in_pieces(client, job, wbm_log, commands, monkeypatch):
    from app.api.v1 import jobs as jobs_router

    monkeypatch.setattr(jobs_router, "_DOWNLOAD_CHUNK_BYTES", 1000)
    content = ("日本語 wörld line\n" * 400).encode() + b"\xff\xfe raw bytes stay\n"
    wbm_log.write_bytes(content)
    response = client.get(DOWNLOAD, headers=token_for(OWNER))
    assert response.status_code == 200
    assert response.content == content  # not decoded on the way: bytes, exactly
    assert response.headers["content-length"] == str(len(content))
    assert response.headers["content-type"] == "text/plain; charset=utf-8"
    assert response.headers["content-disposition"] == f'attachment; filename="{SIM}-wbm.log"'
    assert len([c for c in commands if "base64" in c]) == -(-len(content) // 1000)


def test_an_empty_log_downloads_as_an_empty_file(client, job, wbm_log, commands):
    wbm_log.write_bytes(b"")
    response = client.get(DOWNLOAD, headers=token_for(OWNER))
    assert response.status_code == 200 and response.content == b""


def test_the_download_names_the_stream(client, job, commands):
    from pathlib import Path

    Path(job["stderr_path"]).write_text("err\n")
    response = client.get("/api/v1/jobs/job-1/logs/stderr/download", headers=token_for(OWNER))
    assert response.text == "err\n"
    assert response.headers["content-disposition"] == f'attachment; filename="{SIM}-stderr.log"'


def test_a_log_above_the_limit_is_refused_with_where_it_is(client, job, wbm_log, commands, monkeypatch):
    monkeypatch.setattr(settings, "JOB_LOG_DOWNLOAD_MAX_BYTES", 100)
    wbm_log.write_bytes(b"x" * 101)
    response = client.get(DOWNLOAD, headers=token_for(OWNER))
    assert response.status_code == 413
    detail = response.json()["detail"]
    assert detail["code"] == "log_too_large"
    assert (detail["size"], detail["max"], detail["path"]) == (101, 100, str(wbm_log))
    assert str(wbm_log) in detail["message"] and "on Anvil" in detail["message"]
    wbm_log.write_bytes(b"x" * 100)  # exactly the limit still goes
    assert client.get(DOWNLOAD, headers=token_for(OWNER)).status_code == 200


def test_a_log_that_is_not_there_is_a_404(client, job, commands):
    response = client.get(DOWNLOAD, headers=token_for(OWNER))
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "log_missing"


def test_a_job_with_no_directories_has_no_log_to_download(client, db, job, commands):
    db.jobs.docs["job-1"].update(work_dir=None, remote_job_dir=None)
    for stream in ("wbm", "stdout"):
        response = client.get(f"/api/v1/jobs/job-1/logs/{stream}/download", headers=token_for(OWNER))
        assert response.status_code == 404
    assert commands == []


def test_an_unknown_stream_is_refused(client, job):
    assert client.get("/api/v1/jobs/job-1/logs/nope/download", headers=token_for(OWNER)).status_code == 422


def test_an_unreachable_anvil_cannot_be_downloaded_from(client, job, monkeypatch):
    async def run_remote(*_a, **_kw):
        raise ConnectionError("down")

    monkeypatch.setattr(slurm, "run_remote", run_remote)
    response = client.get(DOWNLOAD, headers=token_for(OWNER))
    assert response.status_code == 502 and response.json()["detail"]["code"] == "anvil_unreachable"


def test_a_log_that_grows_during_the_download_is_sent_as_it_was_when_it_began(
    client, job, wbm_log, commands, monkeypatch
):
    from app.api.v1 import jobs as jobs_router

    monkeypatch.setattr(jobs_router, "_DOWNLOAD_CHUNK_BYTES", 10)
    wbm_log.write_bytes(b"a" * 25)
    real = slurm.read_log_bytes
    grown = []

    async def read_log_bytes(path, offset, limit):
        if offset and not grown:  # after the first piece was read
            with open(path, "ab") as f:
                f.write(b"b" * 50)
            grown.append(1)
        return await real(path, offset, limit)

    monkeypatch.setattr(slurm, "read_log_bytes", read_log_bytes)
    response = client.get(DOWNLOAD, headers=token_for(OWNER))
    assert response.content == b"a" * 25 and response.headers["content-length"] == "25"
    assert os.path.getsize(wbm_log) == 75
