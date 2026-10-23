"""Model parameters through the API (mission 2026-10-21-wizard-model-parameters):
GET /repository/datasets/{id}/model-parameters, the validation of `parameters.custom_params`
on PATCH /jobs/{id} and on submit (spec criterion 2), and the changes file a submit writes
for them (criterion 3).

The snapshots are the real catalogue documents of the Wyoming snapshot (WBM 22.1.1) and the
v2 tutorial (23.9.0); their inits are the fixtures, served in place of the S3 read
(`run_start._fetch_init`), as in tests/test_post_processing.py. The routes and the real auth
dependencies run against the in-memory Mongo (tests/conftest.py); the slurm service is faked.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import repository as repository_router
from app.models.repository import build_envelope
from app.services import run_start

from route_helpers import changes_in, make_job, make_user, token_for

FIXTURES = Path(__file__).parent / "fixtures"
EXAMPLES = Path(__file__).parents[3] / "schemas" / "snapshot-spec" / "examples"
OWNER = "owner"
HEADERS = token_for(OWNER)
JOB = "/api/v1/jobs/job-1"
SUBMIT = f"{JOB}/submit"

INITS = {
    "wyoming": (EXAMPLES / "wbm_storage_v1.0.0_Wyoming.json", FIXTURES / "wbm_init" / "Wyoming_tracking.init"),
    "v2": (EXAMPLES / "wbm_storage_v2.0.0.json", FIXTURES / "post_processing" / "fc66a2cd_wbm_test.init"),
}


def envelope(name: str) -> dict:
    return build_envelope(json.loads(INITS[name][0].read_text()))


@pytest.fixture
def snapshots(db, monkeypatch) -> dict[str, str]:
    """Both snapshots in the catalogue, their inits served by snapshot id; name -> id."""
    ids, texts = {}, {}
    for name, (_doc, init) in INITS.items():
        env = envelope(name)
        db.datasets.docs[env["_id"]] = env
        ids[name] = env["_id"]
        texts[env["_id"]] = init.read_text()

    reads: list[str] = []

    async def fetch(url: str) -> str:
        reads.append(url)
        for snapshot_id, text in texts.items():
            if f"/snapshots/{snapshot_id}/" in url:
                return text
        raise OSError("unknown snapshot")

    monkeypatch.setattr(run_start, "_fetch_init", fetch)
    monkeypatch.setattr(repository_router, "get_db", lambda: db)
    ids["reads"] = reads  # type: ignore[assignment]
    return ids


@pytest.fixture
def api(db, snapshots) -> TestClient:
    app = FastAPI()
    app.include_router(repository_router.router, prefix="/api/v1")
    return TestClient(app)


def walk(nodes):
    for n in nodes:
        yield n
        yield from walk(n.get("children", []))


def fields(body: dict) -> dict[str, dict]:
    return {n["path"]: n for n in walk(body["groups"]) if "path" in n}


# ---- GET /repository/datasets/{id}/model-parameters -------------------------------------


def test_the_wyoming_tree_is_resolved_for_22_1_1_with_the_inits_values(api, snapshots):
    response = api.get(f"/api/v1/repository/datasets/{snapshots['wyoming']}/model-parameters")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["code_version"] == "22.1.1"
    f = fields(body)
    assert f["wbmParam.RhRt2"]["default"] == 0.56
    assert not any(p in f for p in ("Spinup.Save_Vars", "PET.Scale", "Aquifers"))
    assert f["Spinup.Loops"]["current"] == "2"
    assert f["Irrigation.ReturnCoeff"]["current"] == "0.5"
    assert f["wbmParam.alpha"] | {"current": None, "default": 5, "editable": True} == f["wbmParam.alpha"]
    modules = {n["path"]: n for n in walk(body["groups"]) if n["kind"] == "module"}
    assert modules["Glaciers"]["state"] == "on" and modules["Glaciers"]["switch_off"] is True
    assert modules["DIN"]["state"] == "off"


def test_the_v2_tree_is_resolved_for_23_9_0(api, snapshots):
    body = api.get(f"/api/v1/repository/datasets/{snapshots['v2']}/model-parameters").json()
    assert body["code_version"] == "23.9.0"
    f = fields(body)
    assert f["wbmParam.RhRt2"]["default"] == 0.2
    assert all(p in f for p in ("Spinup.Save_Vars", "PET.Scale", "Aquifers"))
    assert f["Spinup.Loops"]["current"] == "1"
    modules = {n["path"]: n for n in walk(body["groups"]) if n["kind"] == "module"}
    assert modules["openWaterEvap"]["state"] == "on"
    assert modules["Glaciers"]["state"] == "off" and modules["Glaciers"]["switch_off"] is False


def test_the_response_is_the_contract_and_serialises(api, snapshots):
    body = api.get(f"/api/v1/repository/datasets/{snapshots['wyoming']}/model-parameters").json()
    assert set(body) == {"code_version", "groups"}
    first = body["groups"][0]
    assert first["kind"] == "group" and set(first) == {"kind", "key", "label", "doc", "tier", "children"}


def test_it_is_open_like_the_other_dataset_reads(api, snapshots):
    assert api.get(f"/api/v1/repository/datasets/{snapshots['v2']}/model-parameters").status_code == 200


def test_it_shares_one_read_of_the_init_with_the_run_rules(api, snapshots):
    import asyncio

    snapshot = json.loads(INITS["wyoming"][0].read_text())
    assert asyncio.run(run_start.read_init_rules(snapshot, snapshots["wyoming"])) is not None
    api.get(f"/api/v1/repository/datasets/{snapshots['wyoming']}/model-parameters")
    api.get(f"/api/v1/repository/datasets/{snapshots['wyoming']}/model-parameters")
    assert len(snapshots["reads"]) == 1  # type: ignore[arg-type]


def test_an_unknown_dataset_is_a_404(api):
    assert api.get("/api/v1/repository/datasets/nope/model-parameters").status_code == 404


def test_an_init_that_cannot_be_read_is_a_503_init_unavailable(api, snapshots, monkeypatch):
    async def broken(url: str) -> str:
        raise OSError("connection refused")

    monkeypatch.setattr(run_start, "_fetch_init", broken)
    response = api.get(f"/api/v1/repository/datasets/{snapshots['wyoming']}/model-parameters")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "init_unavailable"


def test_an_init_that_cannot_be_parsed_is_a_503_init_unavailable(api, snapshots, monkeypatch):
    async def garbage(url: str) -> str:
        return "this is not { an init"

    monkeypatch.setattr(run_start, "_fetch_init", garbage)
    response = api.get(f"/api/v1/repository/datasets/{snapshots['wyoming']}/model-parameters")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "init_unavailable"


def test_a_snapshot_with_no_init_named_is_a_503_init_unavailable(api, db, snapshots):
    del db.datasets.docs[snapshots["v2"]]["document"]["simulation"]["init"]
    response = api.get(f"/api/v1/repository/datasets/{snapshots['v2']}/model-parameters")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "init_unavailable"


@pytest.mark.parametrize("uses", [None, {"modelCode": {"name": "wbm", "version": "9.9.9"}}])
def test_a_snapshot_with_no_known_wbm_version_is_a_503_model_code_version_missing(api, db, snapshots, uses):
    document = db.datasets.docs[snapshots["v2"]]["document"]
    document.pop("uses")
    if uses:
        document["uses"] = uses
    response = api.get(f"/api/v1/repository/datasets/{snapshots['v2']}/model-parameters")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "model_code_version_missing"


# ---- PATCH /jobs/{id} --------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def owner(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)


@pytest.fixture
def draft(db, snapshots):
    """A draft of the Wyoming snapshot, with the snapshot's own period and variables."""
    snapshot = db.datasets.docs[snapshots["wyoming"]]["document"]
    doc = make_job("job-1", OWNER, "DRAFT")
    doc["dataset_id"] = snapshots["wyoming"]
    doc["parameters"] = {
        "temporal_range_start": snapshot["simulation"]["temporalCoverage"]["start"],
        "temporal_range_end": snapshot["simulation"]["temporalCoverage"]["end"],
        "variables": [v["name"] for v in snapshot["simulation"]["outputVariables"]],
    }
    db.jobs.docs["job-1"] = doc
    return doc


def patch(client, custom, db=None, **parameters):
    stored = db.jobs.docs["job-1"]["parameters"] if db else {}
    return client.patch(
        JOB, headers=HEADERS, json={"parameters": {**stored, **parameters, "custom_params": custom}}
    )


def stored_custom(db):
    return db.jobs.docs["job-1"]["parameters"].get("custom_params")


def test_valid_custom_params_are_saved(client, db, draft):
    custom = {"wbmParam.alpha": "3.5", "Reservoirs": "", "Spinup.Loops": "1", "Irrigation.Order": "0"}
    response = patch(client, custom, db)
    assert response.status_code == 200, response.text
    assert response.json()["parameters"]["custom_params"] == custom
    assert stored_custom(db) == custom


def test_an_entry_equal_to_the_snapshots_value_is_dropped_on_save(client, db, draft):
    response = patch(client, {"wbmParam.alpha": "3.5", "Spinup.Loops": "2", "Irrigation.ReturnCoeff": "0.50"}, db)
    assert response.status_code == 200, response.text
    assert response.json()["parameters"]["custom_params"] == {"wbmParam.alpha": "3.5"}
    assert patch(client, {"Spinup.Loops": "2"}, db).json()["parameters"]["custom_params"] == {}


@pytest.mark.parametrize(
    "path, value, message",
    [
        ("nope.key", "1", "not a model parameter"),  # an unknown path
        ("Spinup.Save_Vars", "1", "WBM 22.1.1 does not read"),  # outside the version
        ("Aquifers", "", "WBM 22.1.1 does not read"),
        ("MT_Code_Name.Run_Start", "2000-01-01", "own field in the draft"),  # a draft field
        ("Output_vars", "runoff", "own field in the draft"),
        ("Projection", "epsg:4326", "gateway sets"),  # locked
        ("DIN.BFI", "1", "does not use"),  # inert
        ("wbmParam.alpha", "abc", "Use a number"),  # a non-number in a number field
        ("Spinup.Loops", "1.5", "whole number"),
        ("wbmParam.Infiltration", "Richards", "Choose one of: FrAMES, HBV."),  # outside options
        ("Irrigation.ReturnCoeff", "1.5", "Must be between 0 and 1."),  # outside range
        ("Spinup.Loops", "-1", "Must be at least 0."),
        ("Comment", "café", "ASCII"),  # non-ASCII
        ("wbmParam.alpha", "", "only switches a module off"),
        ("DIN", "", "already off"),
    ],
)
def test_an_invalid_entry_is_a_422_with_its_message_and_nothing_is_stored(client, db, draft, path, value, message):
    before = copy.deepcopy(db.jobs.docs["job-1"])
    response = patch(client, {path: value}, db)
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_custom_params"
    assert list(detail["errors"]) == [path]
    assert message in detail["errors"][path]
    assert path in detail["message"] and detail["errors"][path] in detail["message"]
    assert db.jobs.docs["job-1"] == before


def test_every_bad_key_has_a_message(client, db, draft):
    response = patch(client, {"wbmParam.alpha": "x", "nope": "1", "Spinup.Loops": "1"}, db)
    assert set(response.json()["detail"]["errors"]) == {"wbmParam.alpha", "nope"}


def test_the_other_parameters_are_still_saved_with_no_custom_params(client, db, draft):
    response = client.patch(
        JOB,
        headers=HEADERS,
        json={"parameters": {**db.jobs.docs["job-1"]["parameters"], "temporal_range_end": "2005-12-31"}},
    )
    assert response.status_code == 200 and response.json()["parameters"]["custom_params"] is None
    assert patch(client, None, db).status_code == 200
    assert patch(client, {}, db).status_code == 200


def test_an_unreadable_init_is_a_503_and_nothing_is_stored(client, db, draft, monkeypatch):
    async def broken(url: str) -> str:
        raise OSError("connection refused")

    monkeypatch.setattr(run_start, "_fetch_init", broken)
    run_start.reset()
    response = patch(client, {"wbmParam.alpha": "3"}, db)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "init_unavailable"
    assert stored_custom(db) is None
    # with nothing to check there is nothing to read
    assert patch(client, {}, db).status_code == 200


def test_a_snapshot_with_no_wbm_version_is_a_422(client, db, draft, snapshots):
    del db.datasets.docs[snapshots["wyoming"]]["document"]["uses"]
    response = patch(client, {"wbmParam.alpha": "3"}, db)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "model_code_version_missing"


# ---- submit ----------------------------------------------------------------------------------------


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


def store_custom(db, custom):
    db.jobs.docs["job-1"]["parameters"]["custom_params"] = custom


def test_a_draft_with_custom_params_is_submitted_and_the_changes_file_has_them_typed(client, db, draft, sent):
    custom = {
        "wbmParam.alpha": "3.5",  # number
        "Spinup.Loops": "1",  # int
        "wbmParam.NC4": "0",  # bool01
        "Irrigation.Order": "0",  # enum: text
        "wbmParam.Infiltration": "HBV",
        "Spinup.Start": "2000-02-01",  # date
        "Reservoirs": "",  # a module switched off
        "Irrigation.IrrSearchDist": "120",  # the init spells it SearchDist
    }
    assert patch(client, custom, db).status_code == 200
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 202, response.text
    script = sent[0][2]
    assert changes_in(script) == {
        "code_version": "22.1.1",
        "set": {
            "wbmParam.alpha": 3.5,
            "Spinup.Loops": 1,
            "wbmParam.NC4": 0,
            "Irrigation.Order": "0",
            "wbmParam.Infiltration": "HBV",
            "Spinup.Start": "2000-02-01",
            "Reservoirs": "",
            "Irrigation.SearchDist": 120.0,
        },
    }
    assert db.jobs.docs["job-1"]["status"] == "SUBMITTED"


def test_the_changes_file_holds_the_drafts_own_fields_beside_the_custom_params(client, db, draft, sent):
    assert patch(
        client,
        {"wbmParam.alpha": "7"},
        db,
        temporal_range_start="2001-01-01",
        temporal_range_end="2005-12-31",
        variables=["runoff"],
    ).status_code == 200
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    assert changes_in(sent[0][2])["set"] == {
        "MT_Code_Name.Run_Start": "2001-01-01",
        "MT_Code_Name.Run_End": "2005-12-31",
        "Output_vars": "runoff",
        "wbmParam.alpha": 7.0,
    }


def test_a_draft_with_only_unchanged_custom_params_runs_the_snapshot_as_published(client, db, draft, sent):
    store_custom(db, {"Spinup.Loops": "2", "Irrigation.ReturnCoeff": "0.5"})  # written straight to the store
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202
    assert changes_in(sent[0][2]) is None


def test_a_stored_invalid_custom_param_is_a_422_that_is_kept_on_the_draft(client, db, draft, sent):
    store_custom(db, {"wbmParam.alpha": "abc", "Projection": "x"})
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_custom_params"
    assert set(detail["errors"]) == {"wbmParam.alpha", "Projection"}
    assert sent == []
    stored = db.jobs.docs["job-1"]
    assert stored["status"] == "DRAFT"
    assert stored["last_submit_error"]["code"] == "invalid_custom_params"


def test_an_unreadable_init_refuses_the_submit_with_a_503(client, db, draft, sent, monkeypatch):
    store_custom(db, {"wbmParam.alpha": "3"})

    async def broken(url: str) -> str:
        raise OSError("connection refused")

    monkeypatch.setattr(run_start, "_fetch_init", broken)
    run_start.reset()
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "init_unavailable"
    assert sent == [] and db.jobs.docs["job-1"]["status"] == "DRAFT"


def test_custom_params_are_no_longer_an_unsupported_field_but_the_others_still_are(client, db, draft, sent):
    store_custom(db, {"wbmParam.alpha": "3"})
    db.jobs.docs["job-1"]["parameters"]["spatial_domain"] = {"north": 1, "south": 0, "east": 1, "west": 0}
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "unsupported_fields"
    assert detail["fields"] == ["parameters.spatial_domain"]


# ---- a constant number for a dataset field ---------------------------------------------------------


def test_the_model_parameters_endpoint_marks_a_dataset_that_takes_a_number(api, snapshots):
    response = api.get(f"/api/v1/repository/datasets/{snapshots['wyoming']}/model-parameters")
    assert response.status_code == 200
    found: dict = {}

    def walk(nodes):
        for n in nodes:
            if n["kind"] == "field":
                found[n["path"]] = n
            walk(n.get("children") or [])

    walk(response.json()["groups"])
    assert found["wbmParam.RhRt2"]["type"] == "dataset"
    assert found["wbmParam.RhRt2"]["edit_as"] == "number" and found["wbmParam.RhRt2"]["editable"] is True
    assert found["rootingDepth"]["current"].startswith("/wbm/data_init/")
    assert found["Network"]["edit_as"] is None and found["Network"]["editable"] is False


def test_a_constant_for_a_dataset_is_saved_and_submitted_as_a_number(client, db, draft, sent):
    assert patch(client, {"wbmParam.RhRt2": "0.3", "rootingDepth": "1.5"}, db).status_code == 200
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202, db.jobs.docs["job-1"].get("last_submit_error")
    assert changes_in(sent[0][2])["set"] == {"wbmParam.RhRt2": 0.3, "rootingDepth": 1.5}


def test_a_path_for_a_dataset_field_is_a_422_saying_a_constant_is_all_the_wizard_offers(client, db, draft):
    response = patch(client, {"wbmParam.RhRt2": "/wbm/data_init/x.init"}, db)
    assert response.status_code == 422
    assert "constant number is the only value the wizard offers" in response.json()["detail"]["errors"]["wbmParam.RhRt2"]


# ---- a module is not switched off while its outputs are listed ------------------------------------


def test_switching_glaciers_off_with_the_stored_outputs_is_refused_with_both_reasons(client, db, draft):
    variables = draft["parameters"]["variables"]
    assert "glMelt" in variables and any(v.endswith("_pg") for v in variables)
    before = copy.deepcopy(db.jobs.docs["job-1"])
    response = patch(client, {"Glaciers": ""}, db)
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_custom_params"
    assert list(detail["errors"]) == ["Glaciers"]
    message = detail["errors"]["Glaciers"]
    assert "remove glMelt first" in message
    assert "Primary-source glacier tracking needs glacier melt" in message
    assert db.jobs.docs["job-1"] == before


def test_the_variables_sent_with_the_patch_win_over_the_stored_ones(client, db, draft):
    kept = [v for v in draft["parameters"]["variables"] if v != "glMelt" and not v.endswith("_pg")]
    response = patch(client, {"Glaciers": ""}, db, variables=kept)
    assert response.status_code == 200, response.text
    assert response.json()["parameters"]["custom_params"] == {"Glaciers": ""}
    # and the other way round: sent variables that need it refuse it
    response = patch(client, {"Glaciers": ""}, db, variables=["discharge", "glMelt"])
    assert response.status_code == 422
    assert "remove glMelt first" in response.json()["detail"]["errors"]["Glaciers"]


def test_switching_a_module_off_with_no_unlocked_output_listed_is_accepted(client, db, draft):
    assert patch(client, {"Reservoirs": ""}, db).status_code == 200


def test_a_stored_draft_that_switches_glaciers_off_with_its_outputs_is_refused_on_submit(client, db, draft, sent):
    store_custom(db, {"Glaciers": ""})
    response = client.post(SUBMIT, headers=HEADERS)
    assert response.status_code == 422
    assert "remove glMelt first" in response.json()["detail"]["errors"]["Glaciers"]
    assert sent == [] and db.jobs.docs["job-1"]["status"] == "DRAFT"
