"""The multi-year aggregation window (app/services/run_start.py `check_run_dates`):
what the init asks of a run's dates, GET /repository/datasets/{id}, and the
422 a submit gives for dates WBM would stop on.

The init text is the real `wbm_init/wbm_test.init` of the published v2.0.0
snapshot (fc66a2cd...), cut to the blocks the rule reads. Anvil job 21016198
ran it from 2000-01-01 to 2000-12-31 and WBM stopped at start-up with
"Aggregation multi-year start is outside of the run dates...". Nothing here
reaches S3: the read is replaced, as in tests/conftest.py.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.api.v1 import repository as repository_router
from app.services import run_start

from route_helpers import make_job, make_user, token_for

AGGREGATED_INIT = """{
ID		=> 'wbm_test',
MT_Code_Name	=>  {
          File_Size	=> 'year',
          MT_ID		=> 'WMB_test_runoff',
          Output_dir	=> 'wbm/wbm_output/WBM_test',
          Run_End	=> '2001-12-31'
        },
Spinup => {
State_ID	=> '',
Loops	=> 1,
Start	=> '2000-01-01',
End	=> '2000-12-31',
       },
PostProcessing	=>  {
          Forks		=> 4,
          Polygon_Aggregation	=> ,
          Run		=> 0,
          TA_multi_year_start	=> 2001,
          TA_multi_year_timestep	=> 2,
          Temporal_Aggregation	=> 1
        },
WaterRights	=> ''
}
"""

SNAP = {"snapshot_start": "2000-01-01", "snapshot_end": "2001-12-31"}


def with_post_processing(lines: str) -> str:
    return AGGREGATED_INIT.replace(
        "          TA_multi_year_start\t=> 2001,\n          TA_multi_year_timestep\t=> 2,\n", lines + "\n"
    )


# ---- the window, from an init -------------------------------------------------


@pytest.mark.parametrize(
    "text, expected",
    [
        (AGGREGATED_INIT, 2001),
        (with_post_processing("TA_multi_year_start => '2001', TA_multi_year_timestep => '2',"), 2001),
        (with_post_processing('TA_multi_year_start=>"1990",TA_multi_year_timestep=>5,'), 1990),
        # Perl false: empty or 0. The tutorial init of the v2 image sets both to ''.
        (with_post_processing("TA_multi_year_start => '', TA_multi_year_timestep => '',"), None),
        (with_post_processing("TA_multi_year_start => 2001, TA_multi_year_timestep => '',"), None),
        (with_post_processing("TA_multi_year_start => '', TA_multi_year_timestep => 2,"), None),
        (with_post_processing("TA_multi_year_start => 0, TA_multi_year_timestep => 2,"), None),
        # Not a plain year: not understood, not blocked.
        (with_post_processing("TA_multi_year_start => $year, TA_multi_year_timestep => 2,"), None),
        (with_post_processing("Temporal_Aggregation => 1,"), None),
        ("", None),
    ],
)
def test_the_window_is_read_from_the_post_processing_keys(text, expected):
    assert run_start.aggregation_start_year_from_init(text) == expected


def test_rules_carry_both_the_alignment_and_the_window():
    rules = run_start.rules_from_init(AGGREGATED_INIT)
    assert (rules.alignment, rules.aggregation_start_year) == ("year", 2001)


# ---- dates against the window -------------------------------------------------


def test_the_run_that_failed_on_anvil_is_refused_on_its_end():
    violation = run_start.check_run_dates(2001, "2000-01-01", "2000-12-31", **SNAP)
    assert violation is not None
    assert violation.fields == ("end",)
    assert violation.earliest_end == "2001-12-31"
    assert violation.message == (
        "This snapshot's model also aggregates its results over multi-year periods "
        "that begin in 2001, so a run must end on 2001-12-31."
    )


def test_a_start_after_the_window_year_is_refused_and_names_the_range():
    violation = run_start.check_run_dates(2001, "2002-01-01", "2002-12-31", **SNAP)
    assert violation is not None
    assert violation.fields == ("start",)
    assert violation.latest_start == "2001-12-31"
    assert "a run can start no later than 2001-12-31 (allowed: 2000-01-01 to 2001-12-31)." in violation.message


def test_both_dates_can_break_it_and_the_message_says_both():
    violation = run_start.check_run_dates(2001, "2002-01-01", "2000-06-30")
    assert violation.fields == ("start", "end")
    assert "no later than 2001-12-31." in violation.message
    assert violation.message.endswith("a run must end on or after 2001-12-31.")


@pytest.mark.parametrize(
    "start, end",
    [
        ("2000-01-01", "2001-12-31"),
        ("2001-01-01", "2001-12-31"),
        ("2001-12-31", "2001-12-31"),
        ("2000-01-01", "2002-06-30"),
        # December 30: the 360-day calendar's last day; the init cannot say, so WBM decides.
        ("2000-01-01", "2001-12-30"),
    ],
)
def test_dates_that_reach_the_window_year_pass(start, end):
    assert run_start.check_run_dates(2001, start, end, **SNAP) is None


def test_the_snapshots_own_dates_pass_like_in_the_toolkit():
    # The published run is not rechecked: only an override is.
    assert run_start.check_run_dates(2001, "2000-01-01", "2000-12-31",
                                     snapshot_start="2000-01-01", snapshot_end="2000-12-31") is None
    # A changed end is held to it even when the start is the snapshot's own.
    assert run_start.check_run_dates(2001, "2000-01-01", "2000-12-31", snapshot_start="2000-01-01") is not None


def test_no_window_refuses_nothing():
    assert run_start.check_run_dates(None, "2090-01-01", "1990-01-01") is None


def test_a_value_that_is_not_a_date_is_left_to_the_date_check():
    assert run_start.check_run_dates(2001, "soon", "later") is None
    assert run_start.check_run_dates(2001, "", "") is None


def test_the_range_is_left_out_where_the_coverage_cannot_hold_it():
    # A window year past the snapshot's end: no end inside the coverage satisfies it.
    sentences = run_start.aggregation_messages(2005, snapshot_start="2000-01-01", snapshot_end="2001-12-31")
    assert sentences["end"].endswith("a run must end on or after 2005-12-31.")
    assert "allowed" in sentences["start"]


def test_a_one_date_range_is_said_as_a_date_not_as_x_to_x():
    # The coverage ends on the window's last day: the only end is that day.
    sentences = run_start.aggregation_messages(2001, snapshot_start="2000-01-01", snapshot_end="2001-12-31")
    assert sentences["end"].endswith("a run must end on 2001-12-31.")
    assert "to 2001-12-31 to" not in sentences["end"]
    # A wider coverage keeps the range.
    wide = run_start.aggregation_messages(2001, snapshot_start="2000-01-01", snapshot_end="2004-12-31")
    assert wide["end"].endswith("a run must end on or after 2001-12-31 (allowed: 2001-12-31 to 2004-12-31).")
    # The start's range is one date only when the coverage begins on the window's last day.
    one = run_start.aggregation_messages(2001, snapshot_start="2001-12-31", snapshot_end="2004-12-31")
    assert one["start"].endswith("a run must start on 2001-12-31.")


def test_the_gateway_and_the_toolkit_agree_on_which_dates_are_refused():
    """The toolkit's own check (`openghm.sim`, a dev-only import here) is the
    last line. The gateway holds a date to the window only when it differs from
    the snapshot's, which is what the toolkit does with its overrides."""
    from openghm.errors import OpenghmError
    from openghm.sim import SubmitOptions, build_persim_init

    rule = run_start.aggregation_start_year_from_init(AGGREGATED_INIT)
    starts = ["2000-01-01", "2001-01-01", "2001-12-31", "2002-01-01"]
    ends = ["2000-12-31", "2001-06-30", "2001-12-30", "2001-12-31", "2002-06-30"]
    for start in starts:
        for end in ends:
            if start > end:
                continue
            opts = SubmitOptions(snapshot_dir="x", simulation_id="s", run_start=start, run_end=end)
            try:
                build_persim_init(AGGREGATED_INIT, "s", opts)
                toolkit_refuses = False
            except OpenghmError as exc:
                # File_Size 'year' also refuses a start off Jan 1, which is another rule.
                assert "aggregates over multi-year" in str(exc) or "first day of a file" in str(exc)
                toolkit_refuses = "aggregates over multi-year" in str(exc)
            gateway_refuses = run_start.check_run_dates(rule, start, end) is not None
            assert gateway_refuses == toolkit_refuses, (start, end)


# ---- reading the init, GET /repository/datasets/{id} --------------------------


@pytest.fixture
def reads(monkeypatch) -> list[str]:
    urls: list[str] = []

    async def fetch(url: str) -> str:
        urls.append(url)
        return AGGREGATED_INIT

    monkeypatch.setattr(run_start, "_fetch_init", fetch)
    return urls


def test_the_rules_come_from_one_read_of_the_init(reads):
    snapshot = {"simulation": {"init": "wbm_test.init"}}
    rules = asyncio.run(run_start.read_init_rules(snapshot, "snap-1"))
    assert rules.aggregation_start_year == 2001
    assert asyncio.run(run_start.run_start_alignment(snapshot, "snap-1")) == "year"
    assert len(reads) == 1


def test_an_unreadable_init_has_no_rules():
    assert asyncio.run(run_start.read_init_rules({"simulation": {"init": "x.init"}}, "snap-1")) is None
    assert asyncio.run(run_start.read_init_rules({"simulation": {}}, "snap-1")) is None


def _dataset_envelope() -> dict:
    from app.models.repository import build_envelope

    doc = json.loads(
        (Path(__file__).parents[3] / "schemas/snapshot-spec/examples/wbm_storage_v2.0.0.json").read_text()
    )
    return build_envelope(doc)


def test_the_snapshot_response_carries_the_window(db, monkeypatch, reads):
    envelope = _dataset_envelope()
    db.datasets.docs[envelope["_id"]] = envelope
    monkeypatch.setattr(repository_router, "get_db", lambda: db)
    answer = asyncio.run(repository_router.get_dataset(envelope["_id"]))
    assert answer.aggregationStartYear == 2001
    assert answer.model_dump(by_alias=True, mode="json")["aggregationStartYear"] == 2001


def test_the_snapshot_response_says_null_when_the_init_cannot_be_read(db, monkeypatch):
    envelope = _dataset_envelope()
    db.datasets.docs[envelope["_id"]] = envelope
    monkeypatch.setattr(repository_router, "get_db", lambda: db)
    answer = asyncio.run(repository_router.get_dataset(envelope["_id"]))
    assert answer.aggregationStartYear is None
    assert answer.runStartAlignment is None


# ---- PATCH and submit -----------------------------------------------------------

OWNER = "owner"
HEADERS = token_for(OWNER)


@pytest.fixture
def draft(db):
    """The CONUS snapshot's shape: 2000-01-01 .. 2001-12-31, aggregating from 2001."""
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    simulation = db.datasets.docs["ds-1"]["document"]["simulation"]
    simulation["init"] = "wbm_test.init"
    simulation["temporalCoverage"] = {"start": "2000-01-01", "end": "2001-12-31"}
    return db.jobs.docs["job-1"]


def _dates(start: str, end: str) -> dict:
    return {"temporal_range_start": start, "temporal_range_end": end, "variables": ["runoff"]}


def test_the_shortened_run_that_failed_on_anvil_is_a_422_before_anything_is_sent(client, db, draft, reads):
    db.jobs.docs["job-1"]["parameters"].update(_dates("2000-01-01", "2000-12-31"))
    r = client.post("/api/v1/jobs/job-1/submit", headers=HEADERS)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["code"] == "run_dates_outside_aggregation"
    assert detail["fields"] == ["end"]
    assert detail["aggregation_start_year"] == 2001
    assert detail["earliest_end"] == "2001-12-31"
    assert detail["message"].endswith("so a run must end on 2001-12-31.")
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"
    assert db.jobs.docs["job-1"].get("sim_id") is None


def test_the_published_period_is_accepted(client, db, draft, reads):
    db.jobs.docs["job-1"]["parameters"].update(_dates("2000-01-01", "2001-12-31"))
    assert client.post("/api/v1/jobs/job-1/submit", headers=HEADERS).status_code == 202


def test_a_shorter_start_that_keeps_the_window_year_is_accepted(client, db, draft, reads):
    db.jobs.docs["job-1"]["parameters"].update(_dates("2001-01-01", "2001-12-31"))
    assert client.post("/api/v1/jobs/job-1/submit", headers=HEADERS).status_code == 202


def test_a_patch_saves_dates_the_window_would_refuse(client, db, draft, reads):
    """An edit only saves; the wizard says it on the field and a submit refuses."""
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _dates("2000-01-01", "2000-06-30")}, headers=HEADERS)
    assert r.status_code == 200
    assert db.jobs.docs["job-1"]["parameters"]["temporal_range_end"] == "2000-06-30"


def test_an_unreadable_window_blocks_nothing_on_a_submit(client, db, draft):
    db.jobs.docs["job-1"]["parameters"].update(_dates("2000-01-01", "2000-12-31"))
    assert client.post("/api/v1/jobs/job-1/submit", headers=HEADERS).status_code == 202


def test_an_init_with_no_window_blocks_nothing_on_a_submit(client, db, draft, monkeypatch):
    async def fetch(url: str) -> str:
        return with_post_processing("TA_multi_year_start => '', TA_multi_year_timestep => '',")

    monkeypatch.setattr(run_start, "_fetch_init", fetch)
    db.jobs.docs["job-1"]["parameters"].update(_dates("2000-01-01", "2000-12-31"))
    assert client.post("/api/v1/jobs/job-1/submit", headers=HEADERS).status_code == 202
