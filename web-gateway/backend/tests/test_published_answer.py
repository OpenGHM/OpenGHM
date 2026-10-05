"""Whether a draft is answered by its snapshot's published output (mission
2026-10-05-a-published-draft-is-not-run, ADR 0029): the rule and its reasons,
the file selection against a recorded listing of the v2 tutorial, pagination
and the cache (`app.services.published_answer`); the endpoint
(`POST /repository/datasets/{id}/published-answer`); and the refusal of a
submit (`POST /jobs/{id}/submit`, 409 `answered_by_published`).

No network: `published_answer._fetch_page` is replaced by a fake bucket that
answers `ListObjectsV2` pages (tests/conftest.py makes it fail by default).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import repository as repository_router
from app.core.config import settings
from app.models.job import JobParameters
from app.services import published_answer
from app.services.published_answer import ListingUnavailable

from route_helpers import FakeDB, make_job, make_user, token_for

V2 = Path(__file__).parents[3] / "schemas/snapshot-spec/examples/wbm_storage_v2.0.0.json"
V2_ID = "fc66a2cdeee9d456f83bc0b0a6f00cd447b0194c124a3bb4008a02990779ec89"
BASE = f"https://s3.anvil.rcac.purdue.edu/openghm/snapshots/{V2_ID}/wbm_output/WBM_test"

#: `wbm_output/` of the v2 tutorial as the public bucket listed it on
#: 2026-10-05: (key under `wbm_output/`, size).
V2_LISTING = [
    ("WBM_test/EarthAtlas_discharge.url", 326),
    ("WBM_test/EarthAtlas_runoff.url", 323),
    ("WBM_test/PostProcessing.pl", 5405),
    ("WBM_test/build_spool_batch.pl", 2311),
    ("WBM_test/cell_area/full_cell_area.nc", 37166),
    ("WBM_test/cell_area/sub_cell_area.nc", 68805),
    ("WBM_test/cell_area/upstream_area.asc", 2649016),
    ("WBM_test/daily/wbm_2000.nc", 696923827),
    ("WBM_test/daily/wbm_2001.nc", 695570163),
    ("WBM_test/init_files/datasets/merra2_evwater_dc.init", 413),
    ("WBM_test/init_files/datasets/merra2_prectotcorr_d.init", 459),
    ("WBM_test/init_files/datasets/merra2_t2m_d.init", 398),
    ("WBM_test/init_files/datasets/root_depth.init", 416),
    ("WBM_test/init_files/wbm_test.init", 1858),
    ("WBM_test/monthly/discharge/wbm_2000.nc", 17291755),
    ("WBM_test/monthly/discharge/wbm_2001.nc", 17313693),
    ("WBM_test/monthly/runoff/wbm_2000.nc", 17009008),
    ("WBM_test/monthly/runoff/wbm_2001.nc", 17027052),
    ("WBM_test/monthly/streamAge/wbm_2000.nc", 12226661),
    ("WBM_test/monthly/streamAge/wbm_2001.nc", 12111321),
    ("WBM_test/wbm_test.MT.csv", 6766),
    ("WBM_test/wbm_test.log", 114652),
    ("WBM_test/yearly/discharge/wbm_2000.nc", 1458317),
    ("WBM_test/yearly/discharge/wbm_2001.nc", 1463101),
    ("WBM_test/yearly/runoff/wbm_2000.nc", 1425102),
    ("WBM_test/yearly/runoff/wbm_2001.nc", 1429596),
    ("WBM_test/yearly/streamAge/wbm_2000.nc", 1120288),
    ("WBM_test/yearly/streamAge/wbm_2001.nc", 1151052),
]


class Bucket:
    """The public bucket: `ListObjectsV2` pages of `page_size` objects, the
    continuation token being the key the next page starts at (as the bucket's
    own tokens are). `calls` is every (prefix, token) asked."""

    def __init__(self, listings: dict[str, list[tuple[str, int]]], page_size: int = 1000):
        self.listings = listings
        self.page_size = page_size
        self.calls: list[tuple[str, str | None]] = []

    async def fetch_page(self, client, prefix: str, token: str | None) -> str:
        self.calls.append((prefix, token))
        keys = sorted(
            (f"{prefix}{name}", size)
            for snapshot_id, items in self.listings.items()
            if prefix == f"snapshots/{snapshot_id}/wbm_output/"
            for name, size in items
        )
        start = next((i for i, (k, _) in enumerate(keys) if k == token), 0) if token else 0
        page, rest = keys[start : start + self.page_size], keys[start + self.page_size :]
        contents = "".join(
            f"<Contents><Key>{k}</Key><LastModified>2026-09-28T18:00:17.851Z</LastModified>"
            f"<ETag>&quot;x&quot;</ETag><Size>{size}</Size><StorageClass>STANDARD</StorageClass></Contents>"
            for k, size in page
        )
        more = (
            f"<IsTruncated>true</IsTruncated><NextContinuationToken>{rest[0][0]}</NextContinuationToken>"
            if rest
            else "<IsTruncated>false</IsTruncated>"
        )
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
            f"<Name>openghm</Name><Prefix>{prefix}</Prefix>{more}{contents}</ListBucketResult>"
        )


@pytest.fixture
def bucket(monkeypatch) -> Bucket:
    fake = Bucket({V2_ID: V2_LISTING})
    monkeypatch.setattr(published_answer, "_fetch_page", fake.fetch_page)
    return fake


def v2_snapshot() -> dict:
    return json.loads(V2.read_text())


def params(**changes) -> JobParameters:
    """The v2 tutorial's own defaults, changed."""
    base = {
        "temporal_range_start": "2000-01-01",
        "temporal_range_end": "2001-12-31",
        "variables": ["runoff", "discharge", "streamAge"],
    }
    return JobParameters(**{**base, **changes})


def run(parameters: JobParameters, model_input_id: str | None = None, snapshot=None):
    return asyncio.run(
        published_answer.answer(V2_ID, snapshot or v2_snapshot(), parameters, model_input_id)
    )


def codes(answer) -> list[str]:
    return [r.code for r in answer.reasons]


# ---- answered ---------------------------------------------------------------


def test_the_defaults_are_answered_by_two_daily_six_monthly_and_six_yearly_files(bucket):
    answer = run(params())
    assert answer.answered and answer.reasons == []
    assert answer.run_id == "WBM_test"
    assert answer.period.start == "2000-01-01" and answer.period.end == "2001-12-31"
    groups = [f.group for f in answer.files]
    assert groups == ["daily"] * 2 + ["monthly"] * 6 + ["yearly"] * 6
    first = answer.files[0]
    assert first.model_dump() == {
        "group": "daily",
        "variable": None,
        "year": 2000,
        "key": f"snapshots/{V2_ID}/wbm_output/WBM_test/daily/wbm_2000.nc",
        "url": f"{BASE}/daily/wbm_2000.nc",
        "size": 696923827,
    }


def test_monthly_and_yearly_files_follow_the_asked_variables_then_years(bucket):
    answer = run(params(variables=["streamAge", "runoff"]))
    assert [(f.group, f.variable, f.year) for f in answer.files[2:]] == [
        ("monthly", "streamAge", 2000),
        ("monthly", "streamAge", 2001),
        ("monthly", "runoff", 2000),
        ("monthly", "runoff", 2001),
        ("yearly", "streamAge", 2000),
        ("yearly", "streamAge", 2001),
        ("yearly", "runoff", 2000),
        ("yearly", "runoff", 2001),
    ]
    assert next(f for f in answer.files if f.variable == "runoff" and f.group == "yearly").size == 1425102


def test_a_shorter_period_is_answered_by_the_files_of_its_years(bucket):
    answer = run(params(temporal_range_end="2000-06-30"))
    assert answer.answered
    assert {f.year for f in answer.files} == {2000}
    assert len(answer.files) == 1 + 3 + 3


def test_a_later_start_is_answered_and_still_reports_the_published_period(bucket):
    answer = run(params(temporal_range_start="2001-03-01"))
    assert answer.answered and {f.year for f in answer.files} == {2001}
    assert answer.period.start == "2000-01-01"  # the page says the years come from that run


def test_fewer_variables_are_answered(bucket):
    answer = run(params(variables=["runoff"]))
    assert answer.answered
    assert [(f.group, f.variable) for f in answer.files] == [
        ("daily", None), ("daily", None), ("monthly", "runoff"), ("monthly", "runoff"),
        ("yearly", "runoff"), ("yearly", "runoff"),
    ]


def test_no_variable_asks_for_every_published_one(bucket):
    answer = run(params(variables=[]))
    assert answer.answered and len(answer.files) == 14


def test_a_spatial_domain_equal_to_the_snapshots_is_still_answered(bucket):
    snapshot = v2_snapshot()
    c = snapshot["simulation"]["spatialCoverage"]
    domain = {"north": c["northlimit"], "south": c["southlimit"], "east": c["eastlimit"], "west": c["westlimit"]}
    assert run(params(spatial_domain=domain), snapshot=snapshot).answered


# ---- not answered: each reason on its own -----------------------------------


@pytest.mark.parametrize(
    "changes, model_input_id, code",
    [
        ({}, "some-model-input", "model_input_override"),
        (
            {"spatial_domain": {"north": 10.0, "south": 0.0, "east": 10.0, "west": 0.0}},
            None,
            "spatial_domain",
        ),
        ({"custom_params": {"a": "b"}}, None, "custom_params"),
        ({"temporal_range_start": "1999-12-31"}, None, "period_before_published_start"),
        ({"temporal_range_end": "2002-01-01"}, None, "period_after_published_end"),
        ({"variables": ["runoff", "snowpack"]}, None, "variables_not_published"),
    ],
)
def test_each_difference_gives_its_own_reason_and_no_files(bucket, changes, model_input_id, code):
    answer = run(params(**changes), model_input_id)
    assert not answer.answered
    assert codes(answer) == [code]
    assert answer.reasons[0].message
    assert answer.files == []
    assert answer.period.end == "2001-12-31"


def test_reasons_add_up(bucket):
    answer = run(
        params(temporal_range_start="1999-01-01", temporal_range_end="2003-01-01", variables=["nope"]),
        "some-model-input",
    )
    assert codes(answer) == [
        "model_input_override",
        "period_before_published_start",
        "period_after_published_end",
        "variables_not_published",
    ]


def test_a_draft_that_differs_never_touches_the_bucket(bucket):
    run(params(temporal_range_end="2002-01-01"))
    assert bucket.calls == []


@pytest.mark.parametrize(
    "changes",
    [
        {"temporal_range_start": "2001-02-30"},
        {"temporal_range_end": "next year"},
        {"temporal_range_start": "2001-12-31", "temporal_range_end": "2000-01-01"},
    ],
)
def test_a_period_that_is_not_two_dates_in_order_is_invalid(bucket, changes):
    with pytest.raises(published_answer.InvalidPeriod):
        run(params(**changes))


# ---- the output tree --------------------------------------------------------


def test_a_missing_daily_year_means_not_answered_with_no_files(monkeypatch):
    without_2001 = [(k, s) for k, s in V2_LISTING if k != "WBM_test/daily/wbm_2001.nc"]
    monkeypatch.setattr(published_answer, "_fetch_page", Bucket({V2_ID: without_2001}).fetch_page)
    answer = run(params())
    assert not answer.answered and codes(answer) == ["published_output_missing"]
    assert answer.files == [] and answer.run_id == "WBM_test"
    assert run(params(temporal_range_end="2000-12-31")).answered  # the year that is there


def test_an_output_with_no_daily_files_is_not_answered(monkeypatch):
    other = [("WBM_test/wbm_test.log", 1)]
    monkeypatch.setattr(published_answer, "_fetch_page", Bucket({V2_ID: other}).fetch_page)
    answer = run(params())
    assert codes(answer) == ["published_output_missing"] and answer.run_id is None


def test_an_empty_output_is_not_answered(monkeypatch):
    monkeypatch.setattr(published_answer, "_fetch_page", Bucket({V2_ID: []}).fetch_page)
    assert codes(run(params())) == ["published_output_missing"]


def test_a_variable_with_no_monthly_files_leaves_them_out(monkeypatch):
    listing = [(k, s) for k, s in V2_LISTING if "monthly/runoff" not in k]
    monkeypatch.setattr(published_answer, "_fetch_page", Bucket({V2_ID: listing}).fetch_page)
    answer = run(params())
    assert answer.answered
    assert [f.group for f in answer.files].count("monthly") == 4


def test_with_two_runs_the_one_named_like_the_init_wins(monkeypatch):
    listing = V2_LISTING + [(k.replace("WBM_test", "AAA_older"), s) for k, s in V2_LISTING]
    monkeypatch.setattr(published_answer, "_fetch_page", Bucket({V2_ID: listing}).fetch_page)
    assert run(params()).run_id == "WBM_test"  # init is wbm_test.init
    snapshot = v2_snapshot()
    snapshot["simulation"]["init"] = "other.init"
    assert run(params(), snapshot=snapshot).run_id == "AAA_older"  # else the first by name


def test_a_key_with_odd_characters_is_quoted_in_its_url(monkeypatch):
    listing = [(k.replace("WBM_test", "WBM test"), s) for k, s in V2_LISTING]
    monkeypatch.setattr(published_answer, "_fetch_page", Bucket({V2_ID: listing}).fetch_page)
    answer = run(params())
    assert answer.files[0].url.endswith("/WBM%20test/daily/wbm_2000.nc")
    assert " " in answer.files[0].key


def test_urls_follow_the_public_base_and_bucket(bucket, monkeypatch):
    monkeypatch.setattr(settings, "S3_PUBLIC_BASE_URL", "https://s3.example.org/")
    monkeypatch.setattr(settings, "S3_BUCKET", "other")
    assert run(params()).files[0].url == (
        f"https://s3.example.org/other/snapshots/{V2_ID}/wbm_output/WBM_test/daily/wbm_2000.nc"
    )


# ---- the listing ------------------------------------------------------------


def test_a_listing_is_followed_page_by_page(monkeypatch):
    bucket = Bucket({V2_ID: V2_LISTING}, page_size=10)
    monkeypatch.setattr(published_answer, "_fetch_page", bucket.fetch_page)
    listed = asyncio.run(published_answer.list_output(V2_ID))
    assert len(listed) == len(V2_LISTING)
    prefix = f"snapshots/{V2_ID}/wbm_output/"
    assert [t for _, t in bucket.calls][0] is None
    assert len(bucket.calls) == 3 and all(p == prefix for p, _ in bucket.calls)
    assert all(t is not None for _, t in bucket.calls[1:])
    assert run(params()).answered  # files from every page


def test_a_listing_is_kept_per_snapshot(bucket):
    run(params())
    run(params(variables=["runoff"]))
    assert len(bucket.calls) == 1
    asyncio.run(published_answer.list_output("other-snapshot"))
    assert len(bucket.calls) == 2


def test_a_failed_or_empty_listing_is_not_kept(monkeypatch):
    monkeypatch.setattr(published_answer, "_fetch_page", Bucket({V2_ID: []}).fetch_page)
    assert asyncio.run(published_answer.list_output(V2_ID)) == ()
    bucket = Bucket({V2_ID: V2_LISTING})
    monkeypatch.setattr(published_answer, "_fetch_page", bucket.fetch_page)
    assert run(params()).answered  # the empty one was asked again


def test_an_unreadable_bucket_raises_listing_unavailable():
    # conftest's default: the network is down.
    with pytest.raises(ListingUnavailable):
        run(params())


def test_a_listing_that_is_not_xml_raises_listing_unavailable(monkeypatch):
    async def junk(client, prefix, token):
        return "<html>nope"

    monkeypatch.setattr(published_answer, "_fetch_page", junk)
    with pytest.raises(ListingUnavailable):
        run(params())


# ---- the endpoint -----------------------------------------------------------

ME = "me"


@pytest.fixture
def mongo(monkeypatch) -> FakeDB:
    fake = FakeDB()
    monkeypatch.setattr(repository_router, "get_db", lambda: fake)
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "ALLOW_MOCK_AUTH", False)
    fake.datasets.docs[V2_ID] = {"_id": V2_ID, "document": v2_snapshot()}
    return fake


@pytest.fixture
def http(mongo) -> TestClient:
    app = FastAPI()
    app.include_router(repository_router.router, prefix="/api/v1")
    return TestClient(app)


def _ask(http, dataset_id=V2_ID, parameters=None, model_input_id=None, headers=None):
    body = {"parameters": parameters or params().model_dump(), "model_input_id": model_input_id}
    return http.post(
        f"/api/v1/repository/datasets/{dataset_id}/published-answer",
        json=body,
        headers=token_for(ME) if headers is None else headers,
    )


def test_the_endpoint_answers_with_the_planned_shape(http, mongo, bucket):
    response = _ask(http)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"answered", "reasons", "period", "run_id", "files"}
    assert body["answered"] is True and body["reasons"] == []
    assert body["period"] == {"start": "2000-01-01", "end": "2001-12-31"}
    assert body["run_id"] == "WBM_test"
    assert set(body["files"][0]) == {"group", "variable", "year", "key", "url", "size"}
    assert len(body["files"]) == 14


def test_the_endpoint_says_why_a_draft_is_not_answered(http, mongo, bucket):
    body = _ask(http, parameters=params(temporal_range_end="2003-12-31").model_dump()).json()
    assert body["answered"] is False and body["files"] == []
    assert [r["code"] for r in body["reasons"]] == ["period_after_published_end"]
    assert set(body["reasons"][0]) == {"code", "message"}


def test_the_endpoint_names_a_model_input(http, mongo, bucket):
    body = _ask(http, model_input_id="mi-1").json()
    assert [r["code"] for r in body["reasons"]] == ["model_input_override"]


def test_an_unknown_dataset_is_404(http, mongo, bucket):
    assert _ask(http, dataset_id="nope").status_code == 404


def test_a_bucket_that_cannot_be_listed_is_502(http, mongo):
    response = _ask(http)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "published_listing_unavailable"


def test_a_draft_that_differs_is_answered_even_when_the_bucket_is_down(http, mongo):
    response = _ask(http, parameters=params(variables=["nope"]).model_dump())
    assert response.status_code == 200 and response.json()["answered"] is False


def test_an_invalid_period_is_422(http, mongo, bucket):
    response = _ask(http, parameters=params(temporal_range_end="soon").model_dump())
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_parameters"


def test_the_endpoint_needs_a_session(http, mongo, bucket):
    assert _ask(http, headers={}).status_code in (401, 403)


# ---- submit -----------------------------------------------------------------

OWNER = "owner"
HEADERS = token_for(OWNER)
SUBMIT = "/api/v1/jobs/job-1/submit"
#: conftest's `ds-1`: 2000-01-01 to 2000-12-31, runoff and discharge.
DS1_LISTING = [
    ("Run/daily/wbm_2000.nc", 10),
    ("Run/monthly/runoff/wbm_2000.nc", 2),
    ("Run/yearly/runoff/wbm_2000.nc", 1),
]


@pytest.fixture
def draft(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    return db.jobs.docs["job-1"]


@pytest.fixture
def ds1(monkeypatch) -> Bucket:
    fake = Bucket({"ds-1": DS1_LISTING})
    monkeypatch.setattr(published_answer, "_fetch_page", fake.fetch_page)
    return fake


def test_an_answered_draft_is_refused_409_and_stays_a_draft(client, db, draft, ds1):
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "answered_by_published"
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"
    assert "sim_id" not in db.jobs.docs["job-1"]
    assert not [e for e in db.audit_events.docs.values() if e["action"] == "job_submitted"]


def test_the_refusal_comes_before_the_anvil_check(client, db, draft, ds1, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", "")
    assert client.post(SUBMIT, headers=HEADERS).status_code == 409


def test_an_empty_body_or_rerun_false_is_still_refused(client, db, draft, ds1):
    assert client.post(SUBMIT, json={}, headers=HEADERS).status_code == 409
    assert client.post(SUBMIT, json={"rerun": False}, headers=HEADERS).status_code == 409


def test_a_rerun_passes_to_the_existing_checks_and_is_audited_as_one(client, db, draft, ds1):
    response = client.post(SUBMIT, json={"rerun": True}, headers=HEADERS)
    assert response.status_code == 202
    assert db.jobs.docs["job-1"]["status"] == "SUBMITTED"
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "job_submitted"]
    assert event["detail"]["rerun"] is True
    assert ds1.calls == []  # a rerun asks nothing of the bucket


def test_a_rerun_still_meets_the_existing_checks(client, db, draft, ds1, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", "")
    response = client.post(SUBMIT, json={"rerun": True}, headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "anvil_not_configured"


def test_a_draft_that_is_not_answered_submits_without_a_rerun(client, db, draft, ds1):
    # The draft asks for the whole of 2000; the published run now ends sooner.
    db.datasets.docs["ds-1"]["document"]["simulation"]["temporalCoverage"]["end"] = "2000-06-30"
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 202
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "job_submitted"]
    assert "rerun" not in event["detail"]


def test_a_bucket_that_cannot_be_listed_blocks_nothing(client, db, draft):
    # conftest's default: the listing fails, the answer is unknown.
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202


def test_an_answered_draft_with_no_files_is_not_refused(client, db, draft, monkeypatch):
    monkeypatch.setattr(published_answer, "_fetch_page", Bucket({"ds-1": []}).fetch_page)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
