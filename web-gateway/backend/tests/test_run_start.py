"""Where a run of a snapshot may start (app/services/run_start.py): the rule read
from the init's `File_Size`, the answer GET /repository/datasets/{id} gives, and
the 422s a PATCH and a submit give for a start WBM cannot run.

The init text below is the real `wbm_init/wbm_test.init` of the published v2.0.0
snapshot (fc66a2cd…), cut to its first block. `V1_SHAPED_INIT` is not a copy of
a v1 init: it only has the property of the catalogue's two v1 inits that matters
here, no `File_Size` and no `Time_Series` key. Nothing here reaches S3: the read
is replaced, as in tests/conftest.py.

An init with neither key is `year` because WBM's default is `'year'`
(WBM.pm line 495). That is read from the model code, not from a finished v1 run.
"""

from __future__ import annotations

import asyncio

import pytest

from app.api.v1 import repository as repository_router
from app.services import run_start

from route_helpers import make_job, make_user, token_for

WBM_TEST_INIT = """{
ID		=> 'wbm_test',
Project		=> 'WBM_test',
MT_Code_Name	=>  {
          File_Size	=> 'year',
          MT_ID		=> 'WMB_test_runoff',
          Output_dir	=> 'wbm/wbm_output/WBM_test',
          Run_End	=> '2001-12-31'
        },
}
"""


# Shaped like the v1 snapshots' inits: neither File_Size nor Time_Series.
V1_SHAPED_INIT = """{
ID		=> 'Global_tracking',
MT_Code_Name	=>  {
          MT_ID		=> 'Global_tracking',
          Output_dir	=> 'wbm/wbm_output/Global_tracking',
          Run_Start	=> '2001-01-01',
          Run_End	=> '2001-12-31'
        },
}
"""


def init_with(file_size_line: str) -> str:
    return "{\nMT_Code_Name => {\n" + file_size_line + "\n Run_End => '2001-12-31'\n},\n}\n"


# ---- the rule, from an init ---------------------------------------------------


@pytest.mark.parametrize(
    "text, expected",
    [
        (WBM_TEST_INIT, "year"),
        (init_with("File_Size => 'month',"), "month"),
        (init_with('File_Size=>"year",'), "year"),
        # 'day': every day starts a file, so there is no rule to keep.
        (init_with("File_Size => 'day',"), "none"),
        # No File_Size and no Time_Series: WBM's default is 'year', as in the toolkit.
        (V1_SHAPED_INIT, "year"),
        (init_with("MT_ID => 'x',"), "year"),
        ("", "year"),
        # No File_Size beside a Time_Series key: unverified, left alone, as in the toolkit.
        (init_with("Time_Series => 'daily',"), "none"),
        (init_with("Time_Series => 'daily{24}',"), "none"),
        (init_with("Time_Series => 'monthly',"), "none"),
        # A value the toolkit does not know, or cannot read: no rule, as in the toolkit.
        (init_with("File_Size => 'decade',"), "none"),
        (init_with("File_Size => $size,"), "none"),
    ],
)
def test_the_rule_is_read_from_file_size(text, expected):
    assert run_start.alignment_from_init(text) == expected


def test_the_gateway_and_the_toolkit_agree_on_which_starts_are_refused():
    """The toolkit's own check (`openghm.sim`, a dev-only import here) is the
    last line; the gateway's must say the same for every init and start."""
    from openghm.errors import OpenghmError
    from openghm.sim import _check_run_start_alignment

    inits = [
        WBM_TEST_INIT,
        V1_SHAPED_INIT,
        init_with("File_Size => 'month',"),
        init_with("File_Size => 'day',"),
        init_with("File_Size => 'decade',"),
        init_with("File_Size => $size,"),
        init_with("MT_ID => 'x',"),
        init_with("Time_Series => 'daily',"),
        init_with("Time_Series => 'daily{24}',"),
        "",
    ]
    starts = ["2000-01-01", "2000-03-01", "2000-03-02", "2000-12-31", "2001-01-01", "not a date"]
    for text in inits:
        rule = run_start.alignment_from_init(text)
        for start in starts:
            try:
                _check_run_start_alignment(text, start)
                toolkit_refuses = False
            except OpenghmError:
                toolkit_refuses = True
            assert (run_start.check_run_start(rule, start) is not None) == toolkit_refuses, (rule, start)


# ---- a start against the rule -------------------------------------------------


def test_a_year_rule_wants_january_first():
    assert run_start.check_run_start("year", "2000-01-01") is None
    assert run_start.check_run_start("year", "2001-01-01") is None
    for bad in ("2000-03-01", "2000-02-01", "2000-01-02", "2000-12-31"):
        violation = run_start.check_run_start("year", bad)
        assert violation is not None, bad
        assert violation.message.startswith(
            "This snapshot's model writes one file per year, so a simulation must start on January 1."
        )


def test_a_month_rule_wants_the_first_of_a_month():
    assert run_start.check_run_start("month", "2000-03-01") is None
    violation = run_start.check_run_start("month", "2000-03-02")
    assert violation is not None
    assert "one file per month" in violation.message
    assert violation.suggested_start == "2000-03-01"


@pytest.mark.parametrize("alignment", ["none", None])
def test_no_rule_and_no_answer_refuse_nothing(alignment):
    assert run_start.check_run_start(alignment, "2000-03-17") is None


def test_a_start_that_is_not_a_date_is_left_to_the_date_check():
    assert run_start.check_run_start("year", "March 1st") is None
    assert run_start.check_run_start("year", "2000-02-30") is None


def test_the_snapshots_own_start_is_not_rechecked_like_the_toolkit():
    # The toolkit checks a changed MT_Code_Name.Run_Start only; the published start is the published simulation's.
    assert run_start.check_run_start("year", "2000-03-01", snapshot_start="2000-03-01") is None


def test_the_suggestion_is_the_nearest_allowed_start_inside_the_coverage():
    assert run_start.nearest_valid_start("year", "2000-03-01") == "2000-01-01"
    assert run_start.nearest_valid_start("year", "2000-09-01") == "2001-01-01"
    assert run_start.nearest_valid_start("year", "2000-12-31") == "2001-01-01"
    assert run_start.nearest_valid_start("month", "2000-12-20") == "2001-01-01"
    assert run_start.nearest_valid_start("month", "2000-03-10") == "2000-03-01"
    # Past the end of the coverage, only the earlier one remains.
    assert run_start.nearest_valid_start("year", "2000-09-01", "2000-01-01", "2000-12-31") == "2000-01-01"
    assert run_start.nearest_valid_start("year", "2000-03-01", "2000-02-01", "2000-12-31") is None
    assert run_start.nearest_valid_start("none", "2000-03-01") is None
    violation = run_start.check_run_start("year", "2000-09-01")
    assert violation.suggested_start == "2001-01-01"
    assert violation.message.endswith("Start on 2001-01-01 instead.")


# ---- reading the init, once per snapshot --------------------------------------


@pytest.fixture
def reads(monkeypatch) -> list[str]:
    urls: list[str] = []

    async def fetch(url: str) -> str:
        urls.append(url)
        return WBM_TEST_INIT

    monkeypatch.setattr(run_start, "_fetch_init", fetch)
    return urls


SNAPSHOT = {"simulation": {"init": "wbm_test.init"}}


def test_the_init_is_read_from_the_public_url_and_kept_by_snapshot_id(reads):
    assert asyncio.run(run_start.run_start_alignment(SNAPSHOT, "snap-1")) == "year"
    assert asyncio.run(run_start.run_start_alignment(SNAPSHOT, "snap-1")) == "year"
    assert reads == [
        "https://s3.anvil.rcac.purdue.edu/openghm/snapshots/snap-1/wbm_init/wbm_test.init"
    ]
    # Another snapshot is another key.
    asyncio.run(run_start.run_start_alignment(SNAPSHOT, "snap-2"))
    assert len(reads) == 2


def test_a_snapshot_that_names_no_init_has_no_answer(reads):
    assert asyncio.run(run_start.run_start_alignment({"simulation": {}}, "snap-1")) is None
    assert reads == []


def test_an_unreadable_init_answers_none_and_is_not_retried_at_once(monkeypatch):
    calls: list[str] = []

    async def broken(url: str) -> str:
        calls.append(url)
        raise OSError("connection refused")

    monkeypatch.setattr(run_start, "_fetch_init", broken)
    assert asyncio.run(run_start.run_start_alignment(SNAPSHOT, "snap-1")) is None
    assert asyncio.run(run_start.run_start_alignment(SNAPSHOT, "snap-1")) is None
    assert len(calls) == 1

    # After the pause it tries again, and a good answer is kept.
    monkeypatch.setattr(run_start, "_RETRY_AFTER", 0.0)
    assert asyncio.run(run_start.run_start_alignment(SNAPSHOT, "snap-1")) is None
    assert len(calls) == 2

    async def fixed(url: str) -> str:
        return WBM_TEST_INIT

    monkeypatch.setattr(run_start, "_fetch_init", fixed)
    assert asyncio.run(run_start.run_start_alignment(SNAPSHOT, "snap-1")) == "year"


# ---- GET /repository/datasets/{id} ----------------------------------------------


def _dataset_envelope() -> dict:
    import json
    from pathlib import Path

    from app.models.repository import build_envelope

    doc = json.loads(
        (Path(__file__).parents[3] / "schemas/snapshot-spec/examples/wbm_storage_v2.0.0.json").read_text()
    )
    return build_envelope(doc)


def test_the_snapshot_response_carries_the_rule(db, monkeypatch, reads):
    envelope = _dataset_envelope()
    db.datasets.docs[envelope["_id"]] = envelope
    monkeypatch.setattr(repository_router, "get_db", lambda: db)
    answer = asyncio.run(repository_router.get_dataset(envelope["_id"]))
    assert answer.runStartAlignment == "year"
    assert answer.model_dump(by_alias=True, mode="json")["runStartAlignment"] == "year"
    assert reads == [
        f"https://s3.anvil.rcac.purdue.edu/openghm/snapshots/{envelope['_id']}"
        f"/wbm_init/{envelope['document']['simulation']['init']}"
    ]


def test_the_snapshot_response_says_null_when_the_init_cannot_be_read(db, monkeypatch):
    envelope = _dataset_envelope()
    db.datasets.docs[envelope["_id"]] = envelope
    monkeypatch.setattr(repository_router, "get_db", lambda: db)
    answer = asyncio.run(repository_router.get_dataset(envelope["_id"]))
    assert answer.runStartAlignment is None


# ---- PATCH and submit -----------------------------------------------------------

OWNER = "owner"
HEADERS = token_for(OWNER)


@pytest.fixture
def draft(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    db.datasets.docs["ds-1"]["document"]["simulation"]["init"] = "wbm_test.init"
    return db.jobs.docs["job-1"]


def _params(start: str, end: str = "2000-12-31") -> dict:
    return {"temporal_range_start": start, "temporal_range_end": end, "variables": ["runoff"]}


def test_a_patch_with_a_start_the_rule_forbids_is_a_422_and_changes_nothing(client, db, draft, reads):
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params("2000-03-01")}, headers=HEADERS)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["code"] == "run_start_not_aligned"
    assert detail["message"].startswith(
        "This snapshot's model writes one file per year, so a simulation must start on January 1."
    )
    assert detail["suggested_start"] == "2000-01-01"
    assert db.jobs.docs["job-1"]["parameters"]["temporal_range_start"] == "2000-01-01"


def test_a_patch_with_an_allowed_start_is_saved(client, db, draft, reads):
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params("2001-01-01", "2001-12-31")}, headers=HEADERS)
    assert r.status_code == 200
    assert db.jobs.docs["job-1"]["parameters"]["temporal_range_start"] == "2001-01-01"


def test_a_patch_that_does_not_touch_the_parameters_reads_no_init(client, db, draft, reads):
    r = client.patch("/api/v1/jobs/job-1", json={"slug": "renamed"}, headers=HEADERS)
    assert r.status_code == 200
    assert reads == []


def test_an_unchanged_start_the_rule_forbids_does_not_block_another_edit(client, db, draft, reads):
    """A draft saved before the rule, or one the snapshot itself started off
    wrong, keeps its start; only a start that changes is checked."""
    db.jobs.docs["job-1"]["parameters"]["temporal_range_start"] = "2000-03-01"
    r = client.patch(
        "/api/v1/jobs/job-1",
        json={"parameters": _params("2000-03-01", "2000-10-31")},
        headers=HEADERS,
    )
    assert r.status_code == 200
    assert db.jobs.docs["job-1"]["parameters"]["temporal_range_end"] == "2000-10-31"
    assert reads == []  # not even the init was read
    # Changing it to another forbidden start is still refused, and a submit
    # still checks whatever is stored.
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params("2000-04-01")}, headers=HEADERS)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "run_start_not_aligned"
    r = client.post("/api/v1/jobs/job-1/submit", headers=HEADERS)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "run_start_not_aligned"


def test_a_patch_is_checked_when_the_draft_has_no_stored_parameters(client, db, draft, reads):
    del db.jobs.docs["job-1"]["parameters"]
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params("2000-03-01")}, headers=HEADERS)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "run_start_not_aligned"


def test_an_unreadable_rule_blocks_nothing_on_a_patch(client, db, draft):
    # conftest's no-network read: the rule is unknown, the save goes through.
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params("2000-03-01")}, headers=HEADERS)
    assert r.status_code == 200
    assert db.jobs.docs["job-1"]["parameters"]["temporal_range_start"] == "2000-03-01"


def test_a_snapshot_with_no_file_size_is_held_to_the_year_rule(client, db, draft, monkeypatch):
    async def fetch(url: str) -> str:
        return V1_SHAPED_INIT

    monkeypatch.setattr(run_start, "_fetch_init", fetch)
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params("2000-03-01")}, headers=HEADERS)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "run_start_not_aligned"
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params("2001-01-01", "2001-12-31")}, headers=HEADERS)
    assert r.status_code == 200


def test_a_snapshot_with_a_time_series_and_no_file_size_blocks_nothing(client, db, draft, monkeypatch):
    async def fetch(url: str) -> str:
        return init_with("Time_Series => 'daily',")

    monkeypatch.setattr(run_start, "_fetch_init", fetch)
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params("2000-03-01")}, headers=HEADERS)
    assert r.status_code == 200


def test_a_submit_of_a_draft_with_a_forbidden_start_is_a_422_before_anything_is_sent(client, db, draft, reads):
    db.jobs.docs["job-1"]["parameters"]["temporal_range_start"] = "2000-03-01"
    r = client.post("/api/v1/jobs/job-1/submit", headers=HEADERS)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "run_start_not_aligned"
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"


def test_a_submit_of_a_draft_starting_where_the_rule_allows_is_accepted(client, db, draft, reads):
    db.jobs.docs["job-1"]["parameters"]["temporal_range_start"] = "2000-01-01"
    r = client.post("/api/v1/jobs/job-1/submit", headers=HEADERS)
    assert r.status_code == 202


def test_an_unreadable_rule_blocks_nothing_on_a_submit(client, db, draft):
    db.jobs.docs["job-1"]["parameters"]["temporal_range_start"] = "2000-03-01"
    r = client.post("/api/v1/jobs/job-1/submit", headers=HEADERS)
    assert r.status_code == 202
