"""The checks before a submit, through the API (mission 2026-10-23-run-cross-rules):
POST /repository/datasets/{id}/checks, which the wizard asks with the parameters on screen, and the
422 `cross_rules_failed` a submit gives for the errors among them.

The rules themselves are tested in tests/test_wbm_cross_rules.py. Here: the Wyoming snapshot
(WBM 22.1.1) and the v2 tutorial (23.9.0), their inits served in place of the S3 read, their
model inputs the recorded ones (`tests/s3_fake.py`), the routes and the real auth dependencies
against the in-memory Mongo; the slurm service is faked.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import repository as repository_router
from app.models.repository import build_envelope
from app.services import run_start

from route_helpers import make_job, make_user, token_for
from s3_fake import FakeBucket

FIXTURES = Path(__file__).parent / "fixtures"
EXAMPLES = Path(__file__).parents[3] / "schemas" / "snapshot-spec" / "examples"
OWNER = "owner"
HEADERS = token_for(OWNER)
JOB = "/api/v1/jobs/job-1"
SUBMIT = f"{JOB}/submit"

SNAPSHOTS = {
    "wyoming": (EXAMPLES / "wbm_storage_v1.0.0_Wyoming.json", FIXTURES / "wbm_init" / "Wyoming_tracking.init", "ff0ba2e5"),
    "v2": (EXAMPLES / "wbm_storage_v2.0.0.json", FIXTURES / "post_processing" / "fc66a2cd_wbm_test.init", "52585562"),
}


@pytest.fixture(autouse=True)
def owner(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)


@pytest.fixture
def bucket(monkeypatch) -> FakeBucket:
    fake = FakeBucket().install(monkeypatch)
    for _, _, folder in SNAPSHOTS.values():
        fake.add_model_input(folder)
    return fake


@pytest.fixture
def snapshots(db, bucket, monkeypatch) -> dict[str, str]:
    ids, texts = {}, {}
    for name, (doc, init, _) in SNAPSHOTS.items():
        env = build_envelope(json.loads(doc.read_text()))
        db.datasets.docs[env["_id"]] = env
        ids[name] = env["_id"]
        texts[env["_id"]] = init.read_text()

    async def fetch(url: str) -> str:
        for snapshot_id, text in texts.items():
            if f"/snapshots/{snapshot_id}/" in url:
                return text
        raise OSError("unknown snapshot")

    monkeypatch.setattr(run_start, "_fetch_init", fetch)
    return ids


@pytest.fixture
def sent(monkeypatch) -> list:
    from app.services import slurm

    calls: list = []
    real = slurm.submit_job

    async def recording(job, snapshot, body, post_processing=False):
        calls.append((job, snapshot, body))
        return await real(job, snapshot, body, post_processing)

    monkeypatch.setattr(slurm, "submit_job", recording)
    return calls


def make_draft(db, snapshots, name: str, **parameters) -> dict:
    snapshot = db.datasets.docs[snapshots[name]]["document"]
    doc = make_job("job-1", OWNER, "DRAFT")
    doc["dataset_id"] = snapshots[name]
    doc["parameters"] = {
        "temporal_range_start": snapshot["simulation"]["temporalCoverage"]["start"],
        "temporal_range_end": snapshot["simulation"]["temporalCoverage"]["end"],
        "variables": [v["name"] for v in snapshot["simulation"]["outputVariables"]],
        **parameters,
    }
    db.jobs.docs["job-1"] = doc
    return doc


@pytest.fixture(params=["wyoming", "v2"])
def draft(request, db, snapshots):
    return make_draft(db, snapshots, request.param)


# ---- POST /repository/datasets/{id}/checks -----------------------------------------------------


@pytest.fixture
def api(db, snapshots, monkeypatch) -> TestClient:
    monkeypatch.setattr(repository_router, "get_db", lambda: db)
    app = FastAPI()
    app.include_router(repository_router.router, prefix="/api/v1")
    return TestClient(app)


def ask(api, db, snapshots, name: str, headers=HEADERS, **parameters):
    """The checks of the draft of `name` the person has on screen: its snapshot's own period and
    variables, with `parameters` changed."""
    parameters = {**make_draft(db, snapshots, name)["parameters"], **parameters}
    return api.post(
        f"/api/v1/repository/datasets/{snapshots[name]}/checks", json={"parameters": parameters}, headers=headers
    )


@pytest.mark.parametrize("name", ["wyoming", "v2"])
def test_a_draft_at_its_snapshots_defaults_has_nothing_to_say(api, db, snapshots, name):
    response = ask(api, db, snapshots, name)
    assert response.status_code == 200, response.text
    assert response.json() == {"errors": [], "warnings": [], "files_checked": True}


def test_a_v2_draft_running_past_the_files_has_the_error_and_where_to_mend_it(api, db, snapshots):
    body = ask(api, db, snapshots, "v2", temporal_range_end="2002-06-30").json()
    assert body["warnings"] == [] and body["files_checked"] is True
    (error,) = body["errors"]
    assert error["rule"] == "dataset_file_coverage" and error["level"] == "error"
    assert "The dataset merra2_prectotcorr_d read by MT_Precip.Primary has no file for 2002-01-01" in error["message"]
    assert "MT_Code_Name.Run_End" in error["paths"]


def test_warnings_and_errors_are_told_apart(api, db, snapshots):
    body = ask(api, db, snapshots, "v2", variables=["runoff", "dischMsk", "runoff_irr"]).json()
    assert [(e["rule"], e["level"]) for e in body["errors"]] == [("msk_outputs_runoff_mask_pairing", "error")]
    assert [(w["rule"], w["level"]) for w in body["warnings"]] == [("irr_outputs_without_irrigation", "warn")]
    assert body["warnings"][0]["paths"] == ["Output_vars", "Irrigation"]


def test_the_checks_are_of_the_parameters_sent_with_their_custom_parameters(api, db, snapshots):
    body = ask(api, db, snapshots, "v2", custom_params={"Spinup.Start": "1999-01-01"}).json()
    (error,) = body["errors"]
    assert "has no data for 1999-01-01" in error["message"] and "Spinup.Start" in error["paths"]
    # nothing was saved: the stored draft is as it was
    assert db.jobs.docs["job-1"]["parameters"].get("custom_params") is None


def test_files_that_cannot_be_read_are_said_and_are_not_an_error(api, db, snapshots, bucket):
    bucket.fail = OSError("down")
    body = ask(api, db, snapshots, "v2").json()
    assert body["files_checked"] is False and body["errors"] == []
    assert [w["rule"] for w in body["warnings"]] == ["dataset_file_coverage"]
    assert "could not be checked right now" in body["warnings"][0]["message"]


def test_the_other_rules_still_run_when_the_files_cannot_be_read(api, db, snapshots, bucket):
    bucket.fail = OSError("down")
    body = ask(api, db, snapshots, "v2", variables=["runoff", "DIN_Load"]).json()
    assert [e["rule"] for e in body["errors"]] == ["din_outputs_din_block"]
    assert not body["files_checked"]


def test_a_signed_in_user_may_ask_and_nobody_else(api, db, snapshots):
    assert ask(api, db, snapshots, "v2", headers=token_for("someone-else")).status_code == 200
    assert ask(api, db, snapshots, "v2", headers={}).status_code in (401, 403)


def test_a_body_that_is_not_the_parameters_is_a_422(api, db, snapshots):
    url = f"/api/v1/repository/datasets/{snapshots['v2']}/checks"
    assert api.post(url, json={"parameters": {"temporal_range_start": "2000-01-01"}}, headers=HEADERS).status_code == 422
    assert api.post(url, json={"parameters": {}, "extra": 1}, headers=HEADERS).status_code == 422


def test_an_unknown_snapshot_is_a_404(api, db, snapshots):
    response = api.post(
        "/api/v1/repository/datasets/nope/checks",
        json={"parameters": make_draft(db, snapshots, "v2")["parameters"]},
        headers=HEADERS,
    )
    assert response.status_code == 404


def test_an_init_that_cannot_be_read_is_a_503(api, db, snapshots, monkeypatch):
    async def broken(url: str) -> str:
        raise OSError("connection refused")

    monkeypatch.setattr(run_start, "_fetch_init", broken)
    run_start.reset()
    response = ask(api, db, snapshots, "v2")
    assert response.status_code == 503 and response.json()["detail"]["code"] == "init_unavailable"


def test_a_snapshot_with_no_known_wbm_version_is_a_503(api, db, snapshots):
    db.datasets.docs[snapshots["v2"]]["document"].pop("uses")
    response = ask(api, db, snapshots, "v2")
    assert response.status_code == 503 and response.json()["detail"]["code"] == "model_code_version_missing"


# ---- POST /jobs/{id}/submit --------------------------------------------------------------------


def test_a_draft_at_its_defaults_is_submitted_as_before(client, draft, sent):
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    assert len(sent) == 1


def test_wyoming_at_2000_2009_submits(client, db, snapshots, sent):
    make_draft(db, snapshots, "wyoming", temporal_range_start="2000-01-01", temporal_range_end="2009-12-31")
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202


def test_a_run_past_the_files_is_refused_with_one_entry_per_failed_error_rule(client, db, snapshots, sent):
    make_draft(db, snapshots, "v2", temporal_range_end="2002-06-30", variables=["runoff", "dischMsk", "DIN_Load", "runoff_irr"])
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "cross_rules_failed"
    errors = detail["errors"]
    assert [e["rule"] for e in errors] == [
        "dataset_file_coverage", "msk_outputs_runoff_mask_pairing", "din_outputs_din_block",
    ]  # in the tree's order; the irrigation warning refuses nothing and is not here
    assert all(set(e) == {"rule", "level", "message", "paths"} and e["level"] == "error" for e in errors)
    assert errors[0]["message"] in detail["message"] and "MT_Code_Name.Run_End" in errors[0]["paths"]
    assert detail["message"].startswith("This draft would stop when it runs, so it was not sent: ")
    assert sent == []


def test_a_refused_submit_leaves_the_draft_a_draft_and_keeps_why(client, db, snapshots, sent):
    make_draft(db, snapshots, "v2", custom_params={"Spinup.Start": "1999-01-01"})
    assert client.post(SUBMIT, headers=HEADERS).status_code == 422
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "DRAFT" and stored.get("sim_id") is None
    assert stored["last_submit_error"]["code"] == "cross_rules_failed"
    assert "no data for 1999-01-01" in stored["last_submit_error"]["message"]


def test_a_warning_does_not_refuse_a_submit(client, api, db, snapshots, sent):
    parameters = make_draft(db, snapshots, "v2", variables=["runoff", "runoff_irr"])["parameters"]
    asked = api.post(
        f"/api/v1/repository/datasets/{snapshots['v2']}/checks", json={"parameters": parameters}, headers=HEADERS
    ).json()
    assert asked["errors"] == [] and [w["rule"] for w in asked["warnings"]] == ["irr_outputs_without_irrigation"]
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202


def test_files_that_cannot_be_read_do_not_refuse_a_submit(client, db, snapshots, bucket, sent):
    make_draft(db, snapshots, "v2", temporal_range_end="2002-06-30")
    bucket.fail = OSError("down")
    # the one-step test would pass too: the answer is "unknown", and the person can still run it
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202


def test_the_checks_come_after_the_earlier_refusals(client, db, snapshots, sent):
    # a start the model cannot take is `run_start_not_aligned`, said before the cross rules
    make_draft(db, snapshots, "v2", temporal_range_start="2000-03-01", temporal_range_end="2002-06-30")
    assert client.post(SUBMIT, headers=HEADERS).json()["detail"]["code"] == "run_start_not_aligned"


def test_a_snapshot_whose_init_cannot_be_read_is_not_refused_for_the_rules(client, db, snapshots, sent, monkeypatch):
    make_draft(db, snapshots, "v2", temporal_range_end="2002-06-30")

    async def broken(url: str) -> str:
        raise OSError("connection refused")

    monkeypatch.setattr(run_start, "_fetch_init", broken)
    run_start.reset()
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
