"""The output choice of a snapshot draft (mission 2026-10-08-climatology-can-be-asked-for):
what a snapshot's init asks of WBM's post-processing (`run_start.post_processing_from_init`),
`postProcessing` on GET /repository/datasets/{id}, `parameters.post_processing` on a draft,
the 422 `post_processing_unavailable` of a PATCH and a submit, the `--post-processing` flag,
and the published answer's `climatology_not_published`.

The init fixtures in tests/fixtures/post_processing/ are copies of the toolkit's
(packages/openghm/tests/fixtures/post_processing/): real inits of the v2 CONUS snapshot
`fc66a2cd…` and the v1 Global one, which the toolkit's own reader is tested on too. Nothing
here reaches S3: the init read and the bucket listing are replaced, as in tests/conftest.py.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.api.v1 import repository as repository_router
from app.core.config import Settings, settings
from app.models.job import JobDB, JobParameters, read_stored_parameters
from app.services import job_script, published_answer, run_start, slurm
from app.services.job_script import SubmitInputError, render_job_body

from route_helpers import make_job, make_user, token_for
from test_job_script import CACHE, HOME, LOCK, SIM_ID, SNAPSHOT_ID, WORK_DIR
from test_published_answer import V2_ID, V2_LISTING, Bucket

FIXTURES = Path(__file__).parent / "fixtures" / "post_processing"
V2 = Path(__file__).parents[3] / "schemas/snapshot-spec/examples/wbm_storage_v2.0.0.json"


@pytest.fixture(autouse=True)
def climatology_on(db, monkeypatch):
    """The choice is tested as it behaves when `CLIMATOLOGY_ENABLED` is on; the
    tests of the switch itself (`climatology_off`) turn it off again."""
    monkeypatch.setattr(settings, "CLIMATOLOGY_ENABLED", True)


@pytest.fixture
def climatology_off(db, monkeypatch):
    monkeypatch.setattr(settings, "CLIMATOLOGY_ENABLED", False)


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def with_block(block: str) -> str:
    return "{\nID => 'x',\nMT_Code_Name => {\n  Run_Start => '2000-01-01',\n  Run_End => '2001-12-31'\n},\n" + block + "\n}\n"


# ---- the reader ------------------------------------------------------------------


@pytest.mark.parametrize(
    "name, expected",
    [
        ("fc66a2cd_wbm_SHORT.init", "climatology"),
        ("fc66a2cd_wbm_SHORT_standard.init", "climatology"),
        ("fc66a2cd_wbm_test.init", "standard"),
        ("v1_Global_tracking.init", "standard"),
        ("v1_test.init", "standard"),             # Run is the block's first key
        ("init_files_wbm_test.init", "climatology"),  # WBM's own dump of the init
    ],
)
def test_the_real_inits_read_as_the_toolkit_reads_them(name, expected):
    assert run_start.post_processing_from_init(fixture(name)) == expected
    assert run_start.rules_from_init(fixture(name)).post_processing == expected


@pytest.mark.parametrize(
    "literal, expected",
    [
        ("0", "standard"), ("'0'", "standard"), ("''", "standard"), ('""', "standard"),
        ("0.0", "standard"), ("undef", "standard"), ("", "standard"),
        ("1", "climatology"), ("'1'", "climatology"), ("'yes'", "climatology"), ("2", "climatology"),
    ],
)
def test_perl_truth_decides_standard_or_climatology(literal, expected):
    text = with_block(f"PostProcessing => {{ Forks => 4, Run => {literal}, Temporal_Aggregation => 1 }},")
    assert run_start.post_processing_from_init(text) == expected


def test_a_quoted_key_and_an_either_order_block_are_read():
    assert run_start.post_processing_from_init(with_block("'PostProcessing' => { 'Run' => 1 },")) == "climatology"
    assert run_start.post_processing_from_init(with_block("PostProcessing => { Forks => 4,\n Run => 0\n },")) == "standard"


@pytest.mark.parametrize(
    "text",
    [
        "",
        "not an init at all {{{",
        with_block(""),                                             # no block
        with_block("PostProcessing => { Forks => 4 },"),            # no Run in it
        with_block("PostProcessing => { Run_Start => 1, Run_End => 1 },"),   # not Run
        with_block("PostProcessing => { Inner => { Run => 1 } },"),  # a nested Run is not its own
        with_block("# PostProcessing => { Run => 1 },"),            # commented out
        with_block("PostProcessing => { Forks => 4, # Run => 1\n },"),
        with_block("PostProcessing => { Forks => 'Run => 1' },"),   # inside a string
        "{\nPostProcessing => { Run => 1,\n",                      # braces do not balance
    ],
)
def test_no_block_or_no_run_of_its_own_is_none(text):
    assert run_start.post_processing_from_init(text) == "none"


def test_run_elsewhere_in_the_init_does_not_count():
    text = with_block("Other => { Run => 1 },\nPostProcessing => { Run => 0 },")
    assert run_start.post_processing_from_init(text) == "standard"


def test_the_v1_init_without_a_block_is_none():
    text = fixture("v1_test.init")
    stripped = text[: text.index("PostProcessing")] + "\n}\n"
    assert run_start.post_processing_from_init(stripped) == "none"


# ---- GET /repository/datasets/{id} --------------------------------------------------


def _envelope() -> dict:
    from app.models.repository import build_envelope

    return build_envelope(json.loads(V2.read_text()))


def _serve(monkeypatch, text: str) -> None:
    async def fetch(url: str) -> str:
        return text

    monkeypatch.setattr(run_start, "_fetch_init", fetch)


@pytest.mark.parametrize(
    "init, expected",
    [("fc66a2cd_wbm_test.init", "standard"), ("fc66a2cd_wbm_SHORT.init", "climatology")],
)
def test_the_snapshot_response_carries_the_snapshots_own_choice(db, monkeypatch, init, expected):
    _serve(monkeypatch, fixture(init))
    envelope = _envelope()
    db.datasets.docs[envelope["_id"]] = envelope
    monkeypatch.setattr(repository_router, "get_db", lambda: db)
    answer = asyncio.run(repository_router.get_dataset(envelope["_id"]))
    assert answer.postProcessing == expected
    assert answer.model_dump(by_alias=True, mode="json")["postProcessing"] == expected


def test_the_snapshot_response_says_none_for_an_init_without_a_block(db, monkeypatch):
    _serve(monkeypatch, with_block(""))
    envelope = _envelope()
    db.datasets.docs[envelope["_id"]] = envelope
    monkeypatch.setattr(repository_router, "get_db", lambda: db)
    assert asyncio.run(repository_router.get_dataset(envelope["_id"])).postProcessing == "none"


def test_the_snapshot_response_says_null_when_the_init_cannot_be_read(db, monkeypatch):
    envelope = _envelope()
    db.datasets.docs[envelope["_id"]] = envelope
    monkeypatch.setattr(repository_router, "get_db", lambda: db)
    answer = asyncio.run(repository_router.get_dataset(envelope["_id"]))
    assert answer.postProcessing is None
    assert answer.model_dump(by_alias=True, mode="json")["postProcessing"] is None


def test_the_snapshot_response_says_climatology_is_available_only_when_the_setting_is_on(db, monkeypatch):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    envelope = _envelope()
    db.datasets.docs[envelope["_id"]] = envelope
    monkeypatch.setattr(repository_router, "get_db", lambda: db)
    answer = asyncio.run(repository_router.get_dataset(envelope["_id"]))
    assert answer.climatologyAvailable is True
    assert answer.model_dump(by_alias=True, mode="json")["climatologyAvailable"] is True
    monkeypatch.setattr(settings, "CLIMATOLOGY_ENABLED", False)
    answer = asyncio.run(repository_router.get_dataset(envelope["_id"]))
    assert answer.climatologyAvailable is False
    assert answer.model_dump(by_alias=True, mode="json")["climatologyAvailable"] is False


def test_climatology_is_off_unless_the_setting_says_otherwise():
    assert Settings.model_fields["CLIMATOLOGY_ENABLED"].default is False


# ---- the parameter, stored and read ---------------------------------------------------


def test_a_draft_has_no_choice_until_it_is_set():
    assert JobParameters(temporal_range_start="2000-01-01", temporal_range_end="2000-12-31").post_processing is None


def test_a_request_is_held_to_the_two_literals():
    for bad in ("none", "both", "", 1):
        with pytest.raises(ValueError):
            JobParameters(temporal_range_start="2000-01-01", temporal_range_end="2000-12-31", post_processing=bad)


def test_a_stored_value_the_code_does_not_know_reads_as_unset():
    stored = {"temporal_range_start": "2000-01-01", "temporal_range_end": "2000-12-31", "post_processing": "none"}
    assert read_stored_parameters(stored)["post_processing"] is None
    assert read_stored_parameters({**stored, "post_processing": "climatology"})["post_processing"] == "climatology"
    old = {"temporal_range_start": "2000-01-01", "temporal_range_end": "2000-12-31"}
    assert read_stored_parameters(old) is old
    assert read_stored_parameters(None) is None
    doc = make_job("job-1", "owner", "DRAFT")
    doc["parameters"]["post_processing"] = 7
    assert JobDB(**doc).parameters.post_processing is None


# ---- PATCH and submit ---------------------------------------------------------------------

OWNER = "owner"
HEADERS = token_for(OWNER)


@pytest.fixture
def draft(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    db.datasets.docs["ds-1"]["document"]["simulation"]["init"] = "wbm_test.init"
    return db.jobs.docs["job-1"]


def _params(**extra) -> dict:
    return {"temporal_range_start": "2000-01-01", "temporal_range_end": "2000-12-31",
            "variables": ["runoff"], **extra}


@pytest.fixture
def sent(monkeypatch) -> list:
    calls: list = []
    real = slurm.submit_job

    async def recording(job, snapshot, body):
        calls.append(body)
        return await real(job, snapshot, body)

    monkeypatch.setattr(slurm, "submit_job", recording)
    return calls


def test_a_patch_stores_the_choice_and_null_returns_to_the_snapshots_own(client, db, draft, monkeypatch):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params(post_processing="climatology")}, headers=HEADERS)
    assert r.status_code == 200, r.text
    assert r.json()["parameters"]["post_processing"] == "climatology"
    assert db.jobs.docs["job-1"]["parameters"]["post_processing"] == "climatology"
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params(post_processing=None)}, headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["parameters"]["post_processing"] is None


def test_a_patch_with_another_value_is_a_422_from_validation(client, db, draft):
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params(post_processing="none")}, headers=HEADERS)
    assert r.status_code == 422
    assert "post_processing" not in db.jobs.docs["job-1"]["parameters"]


@pytest.mark.parametrize("value", ["standard", "climatology"])
def test_a_choice_for_a_snapshot_without_a_block_is_refused_on_patch(client, db, draft, monkeypatch, value):
    _serve(monkeypatch, with_block(""))
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params(post_processing=value)}, headers=HEADERS)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["code"] == "post_processing_unavailable"
    assert detail["message"]
    assert "post_processing" not in db.jobs.docs["job-1"]["parameters"]


def test_a_snapshot_without_a_block_is_still_edited_with_no_choice(client, db, draft, monkeypatch):
    _serve(monkeypatch, with_block(""))
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params()}, headers=HEADERS)
    assert r.status_code == 200


def test_an_unreadable_init_blocks_no_choice_on_patch(client, db, draft):
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params(post_processing="climatology")}, headers=HEADERS)
    assert r.status_code == 200


def test_a_choice_for_a_snapshot_without_a_block_is_refused_on_submit(client, db, draft, monkeypatch, sent):
    _serve(monkeypatch, with_block(""))
    db.jobs.docs["job-1"]["parameters"]["post_processing"] = "climatology"
    r = client.post("/api/v1/jobs/job-1/submit", headers=HEADERS)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "post_processing_unavailable"
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"
    assert db.jobs.docs["job-1"]["last_submit_error"]["code"] == "post_processing_unavailable"
    assert sent == []


def test_climatology_is_refused_on_patch_while_the_setting_is_off(client, db, draft, monkeypatch, climatology_off):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params(post_processing="climatology")}, headers=HEADERS)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["code"] == "climatology_unavailable"
    assert "not available yet" in detail["message"]
    assert "post_processing" not in db.jobs.docs["job-1"]["parameters"]


@pytest.mark.parametrize("value", [None, "standard"])
def test_standard_and_no_choice_are_unaffected_while_the_setting_is_off(client, db, draft, monkeypatch, climatology_off, value):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params(post_processing=value)}, headers=HEADERS)
    assert r.status_code == 200, r.text


def test_climatology_is_refused_on_submit_and_kept_while_the_setting_is_off(client, db, draft, monkeypatch, sent, climatology_off):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    db.jobs.docs["job-1"]["parameters"]["post_processing"] = "climatology"
    r = client.post("/api/v1/jobs/job-1/submit", headers=HEADERS)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "climatology_unavailable"
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"
    assert db.jobs.docs["job-1"]["last_submit_error"]["code"] == "climatology_unavailable"
    assert sent == []


@pytest.mark.parametrize("value", [None, "standard"])
def test_standard_and_no_choice_still_submit_while_the_setting_is_off(client, db, draft, monkeypatch, sent, climatology_off, value):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    db.jobs.docs["job-1"]["parameters"]["post_processing"] = value
    assert client.post("/api/v1/jobs/job-1/submit", headers=HEADERS).status_code == 202


def test_post_processing_unavailable_keeps_its_precedence_while_the_setting_is_off(client, db, draft, monkeypatch, climatology_off):
    _serve(monkeypatch, with_block(""))
    r = client.patch("/api/v1/jobs/job-1", json={"parameters": _params(post_processing="climatology")}, headers=HEADERS)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "post_processing_unavailable"


def test_climatology_over_a_standard_snapshot_passes_the_flag(client, db, draft, monkeypatch, sent):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    db.jobs.docs["job-1"]["parameters"]["post_processing"] = "climatology"
    r = client.post("/api/v1/jobs/job-1/submit", headers=HEADERS)
    assert r.status_code == 202, r.text
    assert "--post-processing climatology" in sent[0]


@pytest.mark.parametrize(
    "init, value",
    [
        ("fc66a2cd_wbm_test.init", None),
        ("fc66a2cd_wbm_test.init", "standard"),      # the snapshot's own
        ("fc66a2cd_wbm_SHORT.init", "climatology"),  # the snapshot's own
        ("fc66a2cd_wbm_SHORT.init", None),
    ],
)
def test_a_choice_equal_to_the_snapshots_own_passes_no_flag(client, db, draft, monkeypatch, sent, init, value):
    _serve(monkeypatch, fixture(init))
    db.jobs.docs["job-1"]["parameters"]["post_processing"] = value
    assert client.post("/api/v1/jobs/job-1/submit", headers=HEADERS).status_code == 202
    assert "--post-processing" not in sent[0]


def test_standard_over_a_climatology_snapshot_passes_the_flag(client, db, draft, monkeypatch, sent):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_SHORT.init"))
    db.jobs.docs["job-1"]["parameters"]["post_processing"] = "standard"
    assert client.post("/api/v1/jobs/job-1/submit", headers=HEADERS).status_code == 202
    assert "--post-processing standard" in sent[0]


def test_an_unreadable_init_passes_a_set_choice(client, db, draft, sent):
    db.jobs.docs["job-1"]["parameters"]["post_processing"] = "standard"
    assert client.post("/api/v1/jobs/job-1/submit", headers=HEADERS).status_code == 202
    assert "--post-processing standard" in sent[0]


def test_a_draft_stored_before_the_field_submits_as_before(client, db, draft, monkeypatch, sent):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    assert "post_processing" not in db.jobs.docs["job-1"]["parameters"]
    assert client.post("/api/v1/jobs/job-1/submit", headers=HEADERS).status_code == 202
    assert "--post-processing" not in sent[0]


def test_a_stored_unknown_value_does_not_break_reading_or_submitting(client, db, draft, monkeypatch, sent):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    db.jobs.docs["job-1"]["parameters"]["post_processing"] = "bogus"
    r = client.get("/api/v1/jobs/job-1", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["parameters"]["post_processing"] is None
    assert client.post("/api/v1/jobs/job-1/submit", headers=HEADERS).status_code == 202
    assert "--post-processing" not in sent[0]


# ---- run_overrides and the job body --------------------------------------------------------


@pytest.fixture(scope="module")
def v2() -> dict:
    return json.loads(V2.read_text())


def _defaults(v2, **changes) -> JobParameters:
    return job_script.snapshot_defaults(v2).model_copy(update=changes)


def test_overrides_carry_the_choice_only_when_it_differs_from_the_snapshots_own(v2):
    d = lambda value, own: job_script.run_overrides(_defaults(v2, post_processing=value), v2, own).post_processing  # noqa: E731
    assert d(None, "standard") is None
    assert d("standard", "standard") is None
    assert d("climatology", "climatology") is None
    assert d("climatology", "standard") == "climatology"
    assert d("standard", "climatology") == "standard"
    assert d("climatology", None) == "climatology"  # the init could not be read
    assert d(None, None) is None


def test_the_flag_goes_before_walltime_and_is_validated():
    kwargs = dict(snapshot_id=SNAPSHOT_ID, sim_id=SIM_ID, openghm_home=HOME, cache_dir=CACHE,
                  fetch_lock=LOCK, work_dir=WORK_DIR)
    body = render_job_body(**kwargs, post_processing="climatology", walltime="01:00:00")
    run = next(line for line in body.splitlines() if " sim run " in line and "snapshot" not in line.split()[0])
    assert run.endswith("--post-processing climatology --walltime 01:00:00 --spool cache")
    assert "--post-processing" not in render_job_body(**kwargs)
    for bad in ("none", "climatology; rm -rf /", "", "Standard"):
        with pytest.raises(SubmitInputError):
            render_job_body(**kwargs, post_processing=bad)


# ---- the published answer -----------------------------------------------------------------------


@pytest.fixture
def bucket(monkeypatch) -> Bucket:
    fake = Bucket({V2_ID: V2_LISTING})
    monkeypatch.setattr(published_answer, "_fetch_page", fake.fetch_page)
    return fake


def _ask(post_processing: str | None):
    params = JobParameters(temporal_range_start="2000-01-01", temporal_range_end="2001-12-31",
                           variables=["runoff", "discharge", "streamAge"], post_processing=post_processing)
    snapshot = json.loads(V2.read_text())
    return asyncio.run(published_answer.answer(V2_ID, snapshot, params, None))


def _codes(answer) -> list[str]:
    return [r.code for r in answer.reasons]


@pytest.mark.parametrize("value", [None, "standard"])
def test_the_snapshots_own_and_standard_are_answered_from_a_standard_snapshot(bucket, monkeypatch, value):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    answer = _ask(value)
    assert answer.answered and answer.reasons == []


def test_climatology_from_a_standard_snapshot_is_not_answered(bucket, monkeypatch):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    answer = _ask("climatology")
    assert not answer.answered
    assert _codes(answer) == ["climatology_not_published"]
    assert answer.reasons[0].message == (
        "The published simulation has no climatology; asking for it needs a new simulation."
    )
    assert answer.files == []
    assert bucket.calls == []  # a draft that differs needs no listing


def test_climatology_from_an_unreadable_init_is_not_answered(bucket):
    assert _codes(_ask("climatology")) == ["climatology_not_published"]


def test_climatology_from_a_snapshot_without_a_block_is_not_answered(bucket, monkeypatch):
    _serve(monkeypatch, with_block(""))
    assert _codes(_ask("climatology")) == ["climatology_not_published"]


@pytest.mark.parametrize("value", [None, "standard", "climatology"])
def test_a_climatology_snapshot_answers_every_choice(bucket, monkeypatch, value):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_SHORT.init"))
    assert _ask(value).answered


def test_the_reason_is_listed_beside_the_others(bucket, monkeypatch):
    _serve(monkeypatch, fixture("fc66a2cd_wbm_test.init"))
    params = JobParameters(temporal_range_start="2000-01-01", temporal_range_end="2001-12-31",
                           variables=["nope"], post_processing="climatology")
    answer = asyncio.run(published_answer.answer(V2_ID, json.loads(V2.read_text()), params, None))
    assert _codes(answer) == ["variables_not_published", "climatology_not_published"]
