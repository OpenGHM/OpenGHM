"""The WBM code manifest (`wbm-code/manifest.json`, ADR 0032) and what the gateway does with
it: the strict parse, the 60 s cache, failing open, `code_state`, `GET /api/v1/wbm-code`,
`codeState` on the repository's snapshots, and the three enforcement points (a new draft from
a snapshot, a submit, and the copies that are not refused).

Offline: the fetch (`wbm_code._fetch`) is replaced, as tests/conftest.py does for every test.
"""

from __future__ import annotations

import asyncio
import copy
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from route_helpers import FakeDB, make_job, make_user, token_for

from app.api.v1 import repository as repository_router
from app.api.v1 import wbm_code as wbm_code_router
from app.core.config import settings
from app.services import wbm_code
from app.services.wbm_code import ManifestInvalid, code_state, parse_manifest

H22 = "a" * 64
H23 = "b" * 64
#: the snapshot conftest's `db` fixture holds as `ds-1`: WBM 23.9.0, hash 0...0.
H_DS1 = "0" * 64


def manifest_json(**versions) -> dict:
    """A manifest of 22.1.1 (hash H22) and 23.9.0 (hash H23), statuses given as
    `v22=`/`v23=`; a status may be a dict of more fields (`{"status": "withdrawn", "reason": ...}`)."""
    status = {"22.1.1": versions.get("v22", "current"), "23.9.0": versions.get("v23", "current")}
    hashes = {"22.1.1": H22, "23.9.0": H23}
    entries = {}
    for version, value in status.items():
        extra = value if isinstance(value, dict) else {"status": value}
        entries[version] = {"treeHash": hashes[version], "published": "2026-10-07", **extra}
    return {
        "manifestVersion": 1,
        "code": {"wbm": {"aliases": {"latest": "23.9.0"}, "versions": entries}},
    }


def ds1_manifest(status="current", tree_hash=H_DS1, **extra) -> dict:
    """A manifest whose 23.9.0 is `status` with `tree_hash` (the conftest `ds-1` snapshot's code)."""
    m = manifest_json()
    m["code"]["wbm"]["versions"]["23.9.0"].update(status=status, treeHash=tree_hash, **extra)
    return m


# ---- the parse ----------------------------------------------------------------


def test_a_manifest_parses_into_versions_current_and_latest():
    m = parse_manifest(manifest_json(v22="legacy", v23="current"))
    assert list(m.versions) == ["22.1.1", "23.9.0"]
    v = m.versions["22.1.1"]
    assert (v.version, v.tree_hash, v.status, v.published, v.reason) == ("22.1.1", H22, "legacy", "2026-10-07", None)
    assert m.current == ["23.9.0"]
    assert m.latest == "23.9.0"


def test_several_versions_can_be_current_and_a_withdrawn_one_carries_its_reason():
    m = parse_manifest(manifest_json(v22="current", v23={"status": "withdrawn", "reason": "wrong runoff"}))
    assert m.current == ["22.1.1"]
    assert m.versions["23.9.0"].reason == "wrong runoff"


def test_no_aliases_means_no_latest_and_keys_it_does_not_know_are_left_alone():
    data = manifest_json()
    del data["code"]["wbm"]["aliases"]
    data["generatedBy"] = "toolkit"
    data["code"]["other"] = {"anything": 1}
    data["code"]["wbm"]["versions"]["22.1.1"]["note"] = "x"
    assert parse_manifest(data).latest is None


def _broken(mutate) -> dict:
    data = manifest_json()
    mutate(data)
    return data


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(manifestVersion=2),
        lambda d: d.update(manifestVersion=True),
        lambda d: d.update(manifestVersion="1"),
        lambda d: d.pop("manifestVersion"),
        lambda d: d.pop("code"),
        lambda d: d["code"].pop("wbm"),
        lambda d: d["code"].update(wbm=[]),
        lambda d: d["code"]["wbm"].pop("versions"),
        lambda d: d["code"]["wbm"].update(versions=[]),
        lambda d: d["code"]["wbm"]["versions"].update({"22.1.1": "current"}),
        lambda d: d["code"]["wbm"]["versions"]["22.1.1"].update(status="deprecated"),
        lambda d: d["code"]["wbm"]["versions"]["22.1.1"].update(status="CURRENT"),
        lambda d: d["code"]["wbm"]["versions"]["22.1.1"].pop("status"),
        lambda d: d["code"]["wbm"]["versions"]["22.1.1"].update(treeHash="abc"),
        lambda d: d["code"]["wbm"]["versions"]["22.1.1"].update(treeHash="A" * 64),
        lambda d: d["code"]["wbm"]["versions"]["22.1.1"].pop("treeHash"),
        lambda d: d["code"]["wbm"]["versions"]["22.1.1"].update(published="yesterday"),
        lambda d: d["code"]["wbm"]["versions"]["22.1.1"].pop("published"),
        lambda d: d["code"]["wbm"]["versions"]["22.1.1"].update(reason=5),
        lambda d: d["code"]["wbm"]["aliases"].update(latest="99.0.0"),
        lambda d: d["code"]["wbm"]["aliases"].update(latest=7),
        lambda d: d["code"]["wbm"].update(aliases=[]),
    ],
)
def test_a_manifest_of_the_wrong_shape_or_with_an_unknown_status_is_refused(mutate):
    with pytest.raises(ManifestInvalid):
        parse_manifest(_broken(mutate))


@pytest.mark.parametrize("data", [None, [], "x", 1])
def test_a_manifest_that_is_not_an_object_is_refused(data):
    with pytest.raises(ManifestInvalid):
        parse_manifest(data)


# ---- code_state -----------------------------------------------------------------


def _code(version="23.9.0", tree_hash=H23, name="wbm") -> dict:
    return {"name": name, "version": version, "treeHash": tree_hash}


@pytest.fixture
def listed():
    return parse_manifest(manifest_json(v22="legacy", v23="current"))


def test_code_state_is_the_listed_status_when_version_and_hash_match(listed):
    assert code_state(_code("23.9.0", H23), listed) == "current"
    assert code_state(_code("22.1.1", H22), listed) == "legacy"
    withdrawn = parse_manifest(manifest_json(v22={"status": "withdrawn", "reason": "bad"}))
    assert code_state(_code("22.1.1", H22), withdrawn) == "withdrawn"


def test_code_state_is_unlisted_for_a_version_the_manifest_does_not_list(listed):
    assert code_state(_code("24.1.0", H23), listed) == "unlisted"
    assert code_state(_code("23.9.0-r2", H23), listed) == "unlisted"


def test_code_state_is_mismatch_when_the_hash_is_not_the_listed_one(listed):
    assert code_state(_code("23.9.0", H22), listed) == "mismatch"


def test_a_mismatch_outranks_the_status():
    withdrawn = parse_manifest(manifest_json(v23={"status": "withdrawn", "reason": "bad"}))
    assert code_state(_code("23.9.0", H22), withdrawn) == "mismatch"


def test_code_state_is_unknown_without_a_manifest_or_without_code(listed):
    assert code_state(_code(), None) == "unknown"
    assert code_state(None, listed) == "unknown"
    assert code_state({}, listed) == "unknown"
    assert code_state(None, None) == "unknown"


def test_code_state_reads_the_generated_model_too(listed):
    from app.models.generated.snapshot import ModelCode

    assert code_state(ModelCode(name="wbm", version="22.1.1", treeHash=H22), listed) == "legacy"


# ---- reading it: cache, failure, fail open -----------------------------------------


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(wbm_code, "_now", lambda: now[0])
    return now


def _get():
    return asyncio.run(wbm_code.get_manifest())


def test_the_manifest_is_fetched_from_the_public_bucket_url(monkeypatch):
    seen = []

    async def fetch(url):
        seen.append(url)
        return manifest_json()

    monkeypatch.setattr(wbm_code, "_fetch", fetch)
    monkeypatch.setattr(settings, "S3_PUBLIC_BASE_URL", "https://s3.example.test/")
    monkeypatch.setattr(settings, "S3_BUCKET", "openghm")
    assert _get() is not None
    assert seen == ["https://s3.example.test/openghm/wbm-code/manifest.json"]


def test_a_read_is_kept_for_60_seconds_and_then_read_again(serve_manifest, clock):
    serve_manifest(manifest_json())
    first = _get()
    clock[0] += 59.9
    assert _get() is first
    assert serve_manifest.calls == 1
    clock[0] += 0.2
    assert _get() is not first
    assert serve_manifest.calls == 2


def test_a_change_in_the_bucket_shows_after_the_cache_expires(serve_manifest, clock):
    serve_manifest(manifest_json(v23="current"))
    assert _get().current == ["22.1.1", "23.9.0"]
    serve_manifest(manifest_json(v22="legacy", v23="current"))  # also forgets the cache
    assert _get().current == ["23.9.0"]


@pytest.mark.parametrize(
    "answer",
    [
        OSError("connection refused"),
        ValueError("not json"),
        manifest_json(v22="deprecated"),
        {"manifestVersion": 1},
        [],
    ],
    ids=["network", "json", "unknown-status", "shape", "not-an-object"],
)
def test_an_unreadable_manifest_is_none_and_is_logged(serve_manifest, clock, caplog, answer):
    serve_manifest(answer)
    with caplog.at_level("WARNING"):
        assert _get() is None
    assert "WBM code manifest" in caplog.text


def test_an_unreadable_manifest_is_not_retried_for_15_seconds(serve_manifest, clock):
    serve_manifest(OSError("down"))
    assert _get() is None and _get() is None
    assert serve_manifest.calls == 1
    clock[0] += 15.1
    assert _get() is None
    assert serve_manifest.calls == 2


def test_it_is_read_again_once_it_is_readable(monkeypatch, serve_manifest, clock):
    serve_manifest(OSError("down"))
    assert _get() is None
    serve_manifest(manifest_json())
    assert _get() is not None


def test_every_state_is_unknown_when_the_manifest_is_unreadable(serve_manifest):
    serve_manifest(OSError("down"))
    state, manifest = asyncio.run(wbm_code.state_of({"uses": {"modelCode": _code("22.1.1", H22)}}))
    assert (state, manifest) == ("unknown", None)


# ---- GET /api/v1/wbm-code --------------------------------------------------------------


@pytest.fixture
def code_http() -> TestClient:
    app = FastAPI()
    app.include_router(wbm_code_router.router, prefix="/api/v1")
    return TestClient(app)


def test_the_endpoint_lists_versions_current_latest_and_is_public(code_http, serve_manifest):
    serve_manifest(manifest_json(v22="legacy", v23="current"))
    response = code_http.get("/api/v1/wbm-code")  # no token
    assert response.status_code == 200
    assert response.json() == {
        "versions": [
            {"version": "22.1.1", "treeHash": H22, "status": "legacy", "published": "2026-10-07"},
            {"version": "23.9.0", "treeHash": H23, "status": "current", "published": "2026-10-07"},
        ],
        "current": ["23.9.0"],
        "latest": "23.9.0",
        "readable": True,
    }


def test_the_endpoint_gives_a_withdrawn_versions_reason(code_http, serve_manifest):
    serve_manifest(manifest_json(v22={"status": "withdrawn", "reason": "wrong runoff"}))
    versions = code_http.get("/api/v1/wbm-code").json()["versions"]
    assert versions[0]["status"] == "withdrawn" and versions[0]["reason"] == "wrong runoff"
    assert "reason" not in versions[1]


def test_the_endpoint_says_not_readable_and_gives_empty_lists(code_http, serve_manifest):
    serve_manifest(OSError("down"))
    response = code_http.get("/api/v1/wbm-code")
    assert response.status_code == 200
    assert response.json() == {"versions": [], "current": [], "latest": None, "readable": False}


def test_latest_is_null_when_the_manifest_names_none(code_http, serve_manifest):
    data = manifest_json()
    del data["code"]["wbm"]["aliases"]
    serve_manifest(data)
    body = code_http.get("/api/v1/wbm-code").json()
    assert body["latest"] is None and body["readable"] is True


# ---- codeState on the repository's snapshots ---------------------------------------------

SCHEMAS = Path(__file__).resolve().parents[3] / "schemas"
SNAPSHOT = json.loads((SCHEMAS / "snapshot-spec/examples/wbm_storage_v2.0.0.json").read_text())


@pytest.fixture
def repo(monkeypatch) -> TestClient:
    from app.models.repository import build_envelope

    fake = FakeDB()
    monkeypatch.setattr(repository_router, "get_db", lambda: fake)
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "ALLOW_MOCK_AUTH", False)
    doc = copy.deepcopy(SNAPSHOT)
    fake.datasets.docs[doc["id"]] = build_envelope(doc, owner_user_id="me")
    app = FastAPI()
    app.include_router(repository_router.router, prefix="/api/v1")
    client = TestClient(app)
    client.snapshot_id = doc["id"]
    client.model_code = doc["uses"]["modelCode"]
    return client


def _manifest_for(code: dict, status: str, tree_hash: str | None = None) -> dict:
    data = manifest_json()
    data["code"]["wbm"]["versions"] = {
        code["version"]: {"treeHash": tree_hash or code["treeHash"], "status": status, "published": "2026-10-07"}
    }
    data["code"]["wbm"]["aliases"] = {}
    return data


def test_the_catalogue_the_detail_and_the_list_carry_code_state(repo, serve_manifest):
    serve_manifest(_manifest_for(repo.model_code, "legacy"))
    catalogue = repo.get("/api/v1/repository/catalogue").json()
    assert [i["codeState"] for i in catalogue["items"] if i["kind"] == "snapshot"] == ["legacy"]
    assert repo.get(f"/api/v1/repository/datasets/{repo.snapshot_id}").json()["codeState"] == "legacy"
    assert repo.get("/api/v1/repository/datasets").json()["items"][0]["codeState"] == "legacy"
    mine = repo.get("/api/v1/repository/mine", headers=token_for("me")).json()
    assert mine["items"][0]["codeState"] == "legacy"


@pytest.mark.parametrize(
    "status, tree_hash, expected",
    [("current", None, "current"), ("withdrawn", None, "withdrawn"), ("legacy", "f" * 64, "mismatch")],
)
def test_code_state_on_a_snapshot_follows_the_manifest(repo, serve_manifest, status, tree_hash, expected):
    serve_manifest(_manifest_for(repo.model_code, status, tree_hash))
    item = repo.get(f"/api/v1/repository/datasets/{repo.snapshot_id}").json()
    assert item["codeState"] == expected
    # the pin itself is untouched, and `codeState` sits beside it
    assert item["uses"]["modelCode"] == repo.model_code


def test_code_state_is_unlisted_for_a_version_the_manifest_lacks(repo, serve_manifest):
    serve_manifest(_manifest_for({**repo.model_code, "version": "99.0.0"}, "current"))
    assert repo.get(f"/api/v1/repository/datasets/{repo.snapshot_id}").json()["codeState"] == "unlisted"


def test_code_state_is_unknown_when_the_manifest_is_unreadable(repo):
    assert repo.get(f"/api/v1/repository/datasets/{repo.snapshot_id}").json()["codeState"] == "unknown"
    items = repo.get("/api/v1/repository/catalogue").json()["items"]
    assert all(i["codeState"] == "unknown" for i in items if i["kind"] == "snapshot")


def test_the_wbm_filter_still_selects_by_version(repo, serve_manifest):
    serve_manifest(_manifest_for(repo.model_code, "current"))
    version = repo.model_code["version"]
    hit = repo.get("/api/v1/repository/catalogue", params={"wbm": version}).json()
    miss = repo.get("/api/v1/repository/catalogue", params={"wbm": "0.0.0"}).json()
    assert hit["totalCount"] == 1 and miss["totalCount"] == 0


# ---- enforcement: a new draft from a snapshot ----------------------------------------------

OWNER = "owner"
HEADERS = token_for(OWNER)
DERIVE = "/api/v1/jobs/derive/ds-1"


@pytest.fixture
def owner(db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)


def _refusal(response) -> dict:
    assert response.status_code == 422, response.text
    return response.json()["detail"]


@pytest.mark.parametrize("call", ["preview", "derive"])
def test_a_new_draft_from_a_legacy_snapshot_is_refused(client, db, owner, serve_manifest, call):
    serve_manifest(ds1_manifest("legacy"))
    response = client.get(DERIVE, headers=HEADERS) if call == "preview" else client.post(DERIVE, json={}, headers=HEADERS)
    detail = _refusal(response)
    assert detail["code"] == "wbm_code_not_current"
    assert detail["state"] == "legacy" and detail["version"] == "23.9.0"
    assert "23.9.0" in detail["message"] and "legacy" in detail["message"]
    assert not db.jobs.docs  # nothing was stored


def test_a_refusal_names_the_current_versions_to_start_from(client, db, owner, serve_manifest):
    data = ds1_manifest("legacy")
    data["code"]["wbm"]["versions"]["22.1.1"]["status"] = "current"
    serve_manifest(data)
    detail = _refusal(client.post(DERIVE, json={}, headers=HEADERS))
    assert detail["current"] == ["22.1.1"]
    assert "22.1.1" in detail["message"]


def test_a_new_draft_from_withdrawn_unlisted_or_mismatched_code_is_refused_too(client, db, owner, serve_manifest):
    serve_manifest(ds1_manifest("withdrawn", reason="wrong runoff"))
    detail = _refusal(client.get(DERIVE, headers=HEADERS))
    assert (detail["code"], detail["state"]) == ("wbm_code_not_current", "withdrawn")
    assert "wrong runoff" in detail["message"]

    serve_manifest(ds1_manifest("current", tree_hash=H22))
    detail = _refusal(client.get(DERIVE, headers=HEADERS))
    assert (detail["code"], detail["state"]) == ("wbm_code_not_current", "mismatch")

    data = ds1_manifest()
    data["code"]["wbm"]["versions"].pop("23.9.0")
    data["code"]["wbm"]["aliases"] = {}
    serve_manifest(data)
    detail = _refusal(client.get(DERIVE, headers=HEADERS))
    assert (detail["code"], detail["state"]) == ("wbm_code_not_current", "unlisted")


def test_a_new_draft_from_current_code_is_allowed(client, db, owner, serve_manifest):
    serve_manifest(ds1_manifest("current"))
    assert client.get(DERIVE, headers=HEADERS).status_code == 200
    assert client.post(DERIVE, json={}, headers=HEADERS).status_code == 201


def test_a_new_draft_is_allowed_when_the_manifest_is_unreadable(client, db, owner, serve_manifest):
    serve_manifest(OSError("down"))
    assert client.get(DERIVE, headers=HEADERS).status_code == 200
    assert client.post(DERIVE, json={}, headers=HEADERS).status_code == 201


def test_a_new_draft_is_allowed_for_a_snapshot_that_names_no_code(client, db, owner, serve_manifest):
    serve_manifest(ds1_manifest("legacy"))
    del db.datasets.docs["ds-1"]["document"]["uses"]["modelCode"]
    assert client.get(DERIVE, headers=HEADERS).status_code == 200


# ---- enforcement: a submit ------------------------------------------------------------------

SUBMIT = "/api/v1/jobs/job-1/submit"


@pytest.fixture
def draft(db, owner):
    db.jobs.docs["job-1"] = make_job("job-1", OWNER, "DRAFT")
    return db.jobs.docs["job-1"]


def test_a_submit_on_withdrawn_code_is_refused_with_the_reason(client, db, draft, serve_manifest):
    serve_manifest(ds1_manifest("withdrawn", reason="wrong runoff"))
    detail = _refusal(client.post(SUBMIT, headers=HEADERS))
    assert detail["code"] == "wbm_code_withdrawn"
    assert detail["reason"] == "wrong runoff" and detail["version"] == "23.9.0"
    assert "wrong runoff" in detail["message"]
    assert db.jobs.docs["job-1"]["status"] == "DRAFT"
    assert db.jobs.docs["job-1"]["last_submit_error"]["code"] == "wbm_code_withdrawn"


def test_a_submit_on_withdrawn_code_without_a_reason_still_says_so(client, db, draft, serve_manifest):
    serve_manifest(ds1_manifest("withdrawn"))
    detail = _refusal(client.post(SUBMIT, headers=HEADERS))
    assert detail["code"] == "wbm_code_withdrawn" and detail["reason"] is None


def test_a_submit_on_mismatched_code_is_refused(client, db, draft, serve_manifest):
    serve_manifest(ds1_manifest("current", tree_hash=H22))
    detail = _refusal(client.post(SUBMIT, headers=HEADERS))
    assert detail["code"] == "wbm_code_mismatch" and detail["version"] == "23.9.0"


@pytest.mark.parametrize("status", ["current", "legacy"])
def test_a_submit_on_current_or_legacy_code_is_accepted(client, db, draft, serve_manifest, status):
    serve_manifest(ds1_manifest(status))
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202


def test_a_submit_is_accepted_when_the_manifest_is_unreadable(client, db, draft, serve_manifest):
    serve_manifest(OSError("down"))
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202


def test_a_submit_on_unlisted_code_is_accepted(client, db, draft, serve_manifest):
    data = ds1_manifest()
    data["code"]["wbm"]["versions"].pop("23.9.0")
    data["code"]["wbm"]["aliases"] = {}
    serve_manifest(data)
    assert client.post(SUBMIT, headers=HEADERS).status_code == 202


# ---- enforcement: the copies that carry their base ------------------------------------------


def test_a_duplicate_of_a_draft_on_legacy_code_is_allowed(client, db, draft, serve_manifest):
    serve_manifest(ds1_manifest("legacy"))
    response = client.post("/api/v1/jobs/job-1/duplicate", headers=HEADERS)
    assert response.status_code == 201, response.text
    assert response.json()["dataset_id"] == "ds-1"
