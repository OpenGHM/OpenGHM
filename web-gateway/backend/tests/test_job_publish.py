"""POST /jobs/{id}/publish (ADR 0031, mission
2026-10-07-the-gateway-publishes-a-draft): who may publish, the claim, the id
minted once, the document composed or reused, the job submitted, and every
refusal changing nothing.

The route runs against the in-memory Mongo with the slurm transport faked
(tests/conftest.py `db`: `slurm.submit_publish` records what it was asked to
write and run). The base snapshot is the shipped v2 example.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import pytest
from slurmly.exceptions import SbatchError, SSHTransportError

from app.core.config import settings
from app.core.roles import Role
from app.models.generated.snapshot import OpenGHMSnapshotMetadata
from app.services import publish, slurm

from conftest import REMOTE_BASE
from route_helpers import NOW, OUTPUT_BASE, make_job, make_sent_job, make_user, token_for

BASE = json.loads(
    (Path(__file__).resolve().parents[3] / "schemas" / "snapshot-spec" / "examples" / "wbm_storage_v2.0.0.json").read_text()
)
BASE_ID = BASE["id"]
OWNER = "owner"
HEADERS = token_for(OWNER)
URL = "/api/v1/jobs/job-1/publish"
DIR = f"{REMOTE_BASE}/jobs/slurmly-1a2b3c4d"
WORK = f"{OUTPUT_BASE}/sim-job-1"
PUBLISH_DIR = f"{REMOTE_BASE}/jobs/slurmly-9f8e7d6c"

ABOUT = {
    "name": "WBM v2 tutorial rerun: [CONUS] [2000-2001]",
    "description": "The tutorial simulation, run again.",
    "creator": [{"name": "Dev User", "email": "user@openghm.dev"}],
    "license": "GPL-3.0-only",
    "keywords": ["Water Balance Model", "tutorial"],
    "tags": ["tutorial"],
}
EDITED = {**ABOUT, "name": "A better name", "description": "Described again."}


@pytest.fixture(autouse=True)
def setup(monkeypatch, db):
    db.users.docs[OWNER] = make_user(OWNER, can_run_simulations=True)
    db.users.docs["admin"] = make_user("admin", Role.ADMIN)
    db.users.docs["staff"] = make_user("staff", Role.STAFF)
    db.users.docs["stranger"] = make_user("stranger")
    db.datasets.docs[BASE_ID] = {"_id": BASE_ID, "document": copy.deepcopy(BASE), "owner_user_id": "dev", "visibility": "public"}
    for key, value in {
        "ANVIL_SSH_USERNAME": "x-openghm",
        "ANVIL_REMOTE_BASE_DIR": REMOTE_BASE,
        "ANVIL_OUTPUT_BASE": OUTPUT_BASE,
        "ANVIL_OPENGHM_HOME": "/home/x-openghm/apps/openghm/3b52b29",
        "ANVIL_S3CFG": "~/.s3cfg",
        "PUBLIC_SITE_URL": "https://openghm.org",
    }.items():
        monkeypatch.setattr(settings, key, value)


def completed(db, **extra) -> dict:
    """The dev user's completed draft: base snapshot `BASE_ID`, its SLURM record."""
    db.jobs.docs["job-1"] = make_sent_job(
        "job-1",
        OWNER,
        "COMPLETED",
        **{
            "dataset_id": BASE_ID,
            "files": "present",
            "slurm_job_id": "21094200",
            "slurm_start": NOW,
            "slurm_end": NOW.replace(minute=12, second=47),
            **extra,
        },
    )
    db.jobs.docs["job-1"]["parameters"] = {
        "temporal_range_start": "2000-01-01",
        "temporal_range_end": "2001-12-31",
        "variables": ["runoff", "discharge", "streamAge"],
    }
    return db.jobs.docs["job-1"]


def publish_it(client, about=ABOUT, headers=HEADERS, **body):
    payload = {"about": about, **body} if about is not None else body
    return client.post(URL, json=payload, headers=headers)


def events(db, action=None) -> list[dict]:
    found = list(db.audit_events.docs.values())
    return [e for e in found if action is None or e["action"] == action]


def untouched(db, client, before, response, *, status, code, **detail):
    """A refusal: its status and code, and nothing else changed anywhere."""
    assert response.status_code == status, response.text
    body = response.json()["detail"]
    assert body["code"] == code
    for key, value in detail.items():
        assert body[key] == value
    assert body["message"]
    assert db.jobs.docs["job-1"] == before
    assert db.publish_calls == []
    assert events(db) == []
    return body


# ---- the happy path ----------------------------------------------------------


def test_publishing_a_completed_draft_claims_it_and_submits_the_job(client, db):
    completed(db)
    r = publish_it(client)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "COMPLETED"  # a published draft is still a completed draft
    p = body["publish"]
    assert re.fullmatch(r"[0-9a-f]{64}", p["snapshot_id"])
    assert p["state"] == "publishing" and p["attempts"] == 1
    assert p["slurm_job_id"] == "67890" and p["remote_job_dir"] == PUBLISH_DIR
    assert p["failure"] is None and p["finished_at"] is None and p["submitted_at"]
    assert p["submitted_by"] == OWNER
    assert set(p) == {
        "state", "snapshot_id", "metadata", "attempts", "slurm_job_id", "remote_job_dir",
        "submitted_at", "finished_at", "failure", "submitted_by",
    }

    stored = db.jobs.docs["job-1"]["publish"]
    assert stored["snapshot_id"] == p["snapshot_id"] and stored["state"] == "publishing"
    assert stored["slurm_job_id"] == "67890" and stored["remote_job_dir"] == PUBLISH_DIR
    # the document is composed under the minted id, from the base, and valid
    meta = stored["metadata"]
    OpenGHMSnapshotMetadata.model_validate(meta)
    assert meta["id"] == p["snapshot_id"]
    assert meta["slug"] == "wbm-v2-tutorial-rerun-conus-2000-2001"
    assert meta["about"]["url"] == f"https://openghm.org/snapshots/{p['snapshot_id']}"
    assert meta["about"]["isBasedOn"] == [{"kind": "snapshot", "id": BASE_ID}]
    assert meta["simulation"]["temporalCoverage"] == {"start": "2000-01-01", "end": "2001-12-31"}
    assert meta["runtime"]["execution"]["slurmJobId"] == "21094200"
    assert meta["runtime"]["execution"]["cores"] == 1  # the base's recommended, the draft chose none
    assert body["publish"]["metadata"] == meta


def test_the_job_it_submits_writes_the_stored_document_and_runs_the_toolkit(client, db):
    completed(db)
    publish_it(client)
    (call,) = db.publish_calls
    stored = db.jobs.docs["job-1"]["publish"]
    sid = stored["snapshot_id"]
    assert call["name"] == f"publish-{sid[:12]}"
    assert call["job_id"] == "job-1" and call["snapshot_id"] == sid
    # the document goes next to the run's slurmly directory's other files, as stored
    assert call["metadata_path"] == f"{DIR}/publish-metadata.json"
    assert call["metadata_text"] == publish.metadata_text(stored["metadata"])
    assert json.loads(call["metadata_text"]) == stored["metadata"]
    assert (
        f'"$OPENGHM" snapshot publish {WORK} --metadata {DIR}/publish-metadata.json --id {sid} '
        "--s3cfg '~/.s3cfg' 2>\"$OG_STDERR\"" in call["body"].splitlines()
    )
    assert "OPENGHM=/home/x-openghm/apps/openghm/3b52b29/bin/openghm" in call["body"]


def test_the_s3cfg_and_site_are_the_settings(client, db, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_S3CFG", "/home/x-openghm/.s3cfg-other")
    monkeypatch.setattr(settings, "PUBLIC_SITE_URL", "https://gateway.example.org/")
    completed(db)
    publish_it(client)
    (call,) = db.publish_calls
    assert "--s3cfg /home/x-openghm/.s3cfg-other " in call["body"]
    meta = db.jobs.docs["job-1"]["publish"]["metadata"]
    assert meta["about"]["url"].startswith("https://gateway.example.org/snapshots/")


def test_the_job_asks_slurm_for_one_task_two_cores_and_the_publish_walltime(db, anvil, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_ACCOUNT", "ees260008")
    spec = slurm.build_publish_spec("publish-abcdefabcdef", "echo hi", job_id="job-1", snapshot_id="ab" * 32)
    assert (spec.name, spec.ntasks, spec.cpus_per_task, spec.time_limit) == ("publish-abcdefabcdef", 1, 2, "4:00:00")
    assert spec.partition == settings.ANVIL_PARTITION and spec.account == "ees260008"
    # and slurmly renders it, with the run's quiet module preamble
    script = anvil.client.render_only(spec).script
    assert "#SBATCH --job-name=publish-abcdefabcdef" in script
    assert "#SBATCH --ntasks=1" in script and "#SBATCH --cpus-per-task=2" in script
    assert "#SBATCH --time=4:00:00" in script
    assert "#SBATCH --account=ees260008" in script and f"#SBATCH --partition={settings.ANVIL_PARTITION}" in script
    assert script.rstrip().endswith("echo hi")


def test_the_walltime_is_the_setting(db, anvil, monkeypatch):
    monkeypatch.setattr(settings, "PUBLISH_WALLTIME", "12:00:00")
    spec = slurm.build_publish_spec("publish-abcdefabcdef", "echo", job_id="j", snapshot_id="ab" * 32)
    assert "#SBATCH --time=12:00:00" in anvil.client.render_only(spec).script


def test_a_submit_is_audited(client, db):
    completed(db)
    publish_it(client)
    (event,) = events(db)
    assert event["action"] == "job_publish_submitted"
    assert event["actor_id"] == OWNER and event["target_id"] == "job-1"
    assert event["category"] == "job"
    sid = db.jobs.docs["job-1"]["publish"]["snapshot_id"]
    assert event["detail"] == {
        "snapshot_id": sid, "attempt": 1, "slurm_job_id": "67890", "dataset_id": BASE_ID, "metadata": "composed",
    }


def test_the_publish_is_on_the_job_the_status_and_the_list(client, db):
    completed(db)
    publish_it(client)
    sid = db.jobs.docs["job-1"]["publish"]["snapshot_id"]
    assert client.get("/api/v1/jobs/job-1", headers=HEADERS).json()["publish"]["snapshot_id"] == sid
    status = client.get("/api/v1/jobs/job-1/status", headers=HEADERS).json()
    assert status["publish"]["state"] == "publishing" and status["status"] == "COMPLETED"
    (item,) = client.get("/api/v1/jobs", headers=HEADERS).json()["items"]
    assert item["publish"]["snapshot_id"] == sid


def test_a_job_that_was_never_published_has_a_null_publish(client, db):
    completed(db)
    assert client.get("/api/v1/jobs/job-1", headers=HEADERS).json()["publish"] is None
    assert client.get("/api/v1/jobs/job-1/status", headers=HEADERS).json()["publish"] is None


# ---- who ---------------------------------------------------------------------


def test_an_admin_may_publish_anyones_draft_and_the_owner_stays_the_owner(client, db):
    completed(db)
    r = publish_it(client, headers=token_for("admin", Role.ADMIN))
    assert r.status_code == 202, r.text
    assert db.jobs.docs["job-1"]["publish"]["submitted_by"] == "admin"
    assert events(db)[0]["actor_id"] == "admin"
    assert db.jobs.docs["job-1"]["user_id"] == OWNER


@pytest.mark.parametrize("who, role", [("stranger", Role.USER), ("staff", Role.STAFF)])
def test_nobody_else_may_and_cannot_tell_it_exists(client, db, who, role):
    before = copy.deepcopy(completed(db))
    r = publish_it(client, headers=token_for(who, role))
    assert r.status_code == 404
    assert db.jobs.docs["job-1"] == before and db.publish_calls == []


def test_signed_out_is_401_and_a_missing_job_404(client, db):
    completed(db)
    assert client.post(URL, json={"about": ABOUT}).status_code == 401
    assert client.post("/api/v1/jobs/nope/publish", json={"about": ABOUT}, headers=HEADERS).status_code == 404


# ---- 409 not_publishable: every reason, and nothing changes -------------------


@pytest.mark.parametrize(
    "reason, make",
    [
        ("not_completed", lambda db: make_job("job-1", OWNER, "DRAFT")),
        ("not_completed", lambda db: make_sent_job("job-1", OWNER, "RUNNING")),
        ("not_completed", lambda db: make_sent_job("job-1", OWNER, "SUBMITTED")),
        ("run_failed", lambda db: make_sent_job("job-1", OWNER, "FAILED")),
        ("run_failed", lambda db: make_sent_job("job-1", OWNER, "CANCELLED")),
        (
            "run_failed",
            lambda db: make_sent_job("job-1", OWNER, "COMPLETED", failure={"cause": "wbm_silent_failure", "message": "m"}),
        ),
        (
            "answered_by_published",
            lambda db: {**make_job("job-1", OWNER, "DRAFT"), "last_submit_error": {"code": "answered_by_published", "message": "m", "at": NOW}},
        ),
        ("publishing", lambda db: make_sent_job("job-1", OWNER, "COMPLETED", publish={"state": "publishing", "attempts": 1})),
        ("already_published", lambda db: make_sent_job("job-1", OWNER, "COMPLETED", publish={"state": "published", "attempts": 1})),
    ],
)
def test_a_draft_that_cannot_be_published_is_refused_and_unchanged(client, db, reason, make):
    db.jobs.docs["job-1"] = make(db)
    db.jobs.docs["job-1"].setdefault("dataset_id", BASE_ID)
    before = copy.deepcopy(db.jobs.docs["job-1"])
    r = publish_it(client)
    body = untouched(db, client, before, r, status=409, code="not_publishable", reason=reason)
    assert set(body) == {"code", "message", "reason"}
    assert body["message"] == publish.REFUSAL_MESSAGE[reason]


def test_the_refusal_comes_before_the_about_is_looked_at(client, db):
    db.jobs.docs["job-1"] = make_sent_job("job-1", OWNER, "RUNNING")
    r = client.post(URL, json={"about": {}}, headers=HEADERS)
    assert r.json()["detail"]["code"] == "not_publishable"


def test_a_second_publish_while_one_runs_is_refused_and_submits_nothing(client, db):
    completed(db)
    assert publish_it(client).status_code == 202
    again = publish_it(client, EDITED)
    assert again.status_code == 409
    assert again.json()["detail"]["reason"] == "publishing"
    assert len(db.publish_calls) == 1 and db.jobs.docs["job-1"]["publish"]["attempts"] == 1


def test_a_publish_that_claimed_the_draft_meanwhile_is_a_refusal_not_a_second_publish(client, db, monkeypatch):
    completed(db)
    compose = publish.compose_metadata

    def other_request_wins(**kw):
        doc = compose(**kw)
        db.jobs.docs["job-1"]["publish"] = {"state": "publishing", "snapshot_id": "cd" * 32, "attempts": 1}
        return doc

    monkeypatch.setattr(publish, "compose_metadata", other_request_wins)
    r = publish_it(client)
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "publishing"
    assert db.jobs.docs["job-1"]["publish"]["snapshot_id"] == "cd" * 32  # theirs, not overwritten
    assert db.publish_calls == []


def test_a_draft_that_stopped_being_publishable_meanwhile_names_why(client, db, monkeypatch):
    completed(db)
    compose = publish.compose_metadata

    def changed_meanwhile(**kw):
        doc = compose(**kw)
        db.jobs.docs["job-1"]["status"] = "RUNNING"  # a status a completed draft cannot reach: a stand-in
        return doc

    monkeypatch.setattr(publish, "compose_metadata", changed_meanwhile)
    r = publish_it(client)
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "not_completed"
    assert db.publish_calls == []


# ---- 422 invalid_about: nothing is stored and nothing is minted ---------------


@pytest.mark.parametrize(
    "about, fields",
    [
        ({**ABOUT, "name": ""}, {"about.name"}),
        ({**ABOUT, "creator": []}, {"about.creator"}),
        ({**ABOUT, "tags": ["nonsense"]}, {"about.tags.0"}),
        ({**ABOUT, "keywords": []}, {"about.keywords"}),
        ({k: v for k, v in ABOUT.items() if k not in ("license", "description")}, {"about.license", "about.description"}),
        ({**ABOUT, "creator": [{"name": "A", "email": "not-an-email"}]}, {"about.creator.0.email"}),
        ({**ABOUT, "relatedLink": [{"relation": "x", "url": "no"}]}, {"about.relatedLink.0.url"}),
        ({**ABOUT, "slug": "mine"}, {"about.slug"}),
    ],
)
def test_an_invalid_about_is_422_with_the_fields_and_nothing_stored(client, db, about, fields):
    before = copy.deepcopy(completed(db))
    r = publish_it(client, about)
    body = untouched(db, client, before, r, status=422, code="invalid_about")
    assert {e["field"] for e in body["errors"]} == fields
    assert all(e["message"] for e in body["errors"])
    assert "publish" not in db.jobs.docs["job-1"]


@pytest.mark.parametrize("payload", [{}, {"about": None}, {"about": "text"}, {"about": []}])
def test_no_about_or_one_that_is_not_an_object_is_invalid_about_too(client, db, payload):
    before = copy.deepcopy(completed(db))
    r = client.post(URL, json=payload, headers=HEADERS)
    body = untouched(db, client, before, r, status=422, code="invalid_about")
    assert body["errors"][0]["field"] == "about"


def test_no_body_at_all_is_invalid_about(client, db):
    before = copy.deepcopy(completed(db))
    untouched(db, client, before, client.post(URL, headers=HEADERS), status=422, code="invalid_about")


def test_the_gateway_set_fields_in_the_body_are_ignored_not_refused(client, db):
    completed(db)
    r = publish_it(client, {**ABOUT, "datePublished": "1999-01-01", "url": "https://evil.example", "isBasedOn": []})
    assert r.status_code == 202
    about = db.jobs.docs["job-1"]["publish"]["metadata"]["about"]
    assert about["url"].startswith("https://openghm.org/snapshots/") and about["datePublished"] != "1999-01-01"


def test_a_base_without_a_variable_the_draft_asks_for_is_422_and_stores_nothing(client, db):
    completed(db)
    db.jobs.docs["job-1"]["parameters"]["variables"] = ["runoff", "pet"]
    before = copy.deepcopy(db.jobs.docs["job-1"])
    body = untouched(db, client, before, publish_it(client), status=422, code="invalid_about")
    assert body["errors"][0]["field"] == "simulation.outputVariables"


def test_a_base_that_left_the_catalogue_is_422_snapshot_not_found(client, db):
    before = copy.deepcopy(completed(db))
    del db.datasets.docs[BASE_ID]
    untouched(db, client, before, publish_it(client), status=422, code="snapshot_not_found")


# ---- Anvil -------------------------------------------------------------------


def test_no_toolkit_is_503_anvil_not_configured_and_nothing_changes(client, db, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_OPENGHM_HOME", "")
    before = copy.deepcopy(completed(db))
    untouched(db, client, before, publish_it(client), status=503, code="anvil_not_configured")


def test_an_s3cfg_that_cannot_be_rendered_is_503_and_nothing_changes(client, db, monkeypatch):
    monkeypatch.setattr(settings, "ANVIL_S3CFG", "relative/.s3cfg")
    before = copy.deepcopy(completed(db))
    untouched(db, client, before, publish_it(client), status=503, code="anvil_not_configured")


def test_files_purged_are_409_run_files_missing_and_nothing_changes(client, db):
    completed(db, files="purged")
    before = copy.deepcopy(db.jobs.docs["job-1"])
    untouched(db, client, before, publish_it(client), status=409, code="run_files_missing")


def test_a_work_directory_that_is_not_the_jobs_own_is_refused(client, db):
    completed(db, work_dir="/anvil/scratch/x-openghm/simulations/someone-elses")
    before = copy.deepcopy(db.jobs.docs["job-1"])
    untouched(db, client, before, publish_it(client), status=409, code="refused_path")


def sbatch_says_no(*_a, **_k):
    raise SbatchError(command="sbatch", exit_status=1, stdout="", stderr="sbatch: error: Batch job submission failed: Invalid account")


@pytest.mark.parametrize(
    "error, http_status, cause",
    [
        (sbatch_says_no, 502, "sbatch_rejected"),
        (SSHTransportError("connection reset"), 503, "anvil_unreachable"),
        (slurm.AnvilNotConfigured("no key"), 503, "anvil_not_configured"),
        (RuntimeError("boom"), 500, "internal_error"),
    ],
)
def test_a_submit_that_fails_ends_the_publish_failed_and_keeps_its_id(client, db, monkeypatch, error, http_status, cause):
    completed(db)

    async def fails(*_a, **_k):
        if callable(error):
            error()
        raise error

    monkeypatch.setattr(slurm, "submit_publish", fails)
    r = publish_it(client)
    assert r.status_code == http_status, r.text
    detail = r.json()["detail"]
    assert detail["code"] == cause and detail["message"].endswith(".")

    stored = db.jobs.docs["job-1"]["publish"]
    assert stored["state"] == "failed" and stored["attempts"] == 1
    assert stored["failure"] == {"cause": cause, "message": detail["message"], "retry": "same", "exit_code": None}
    assert stored["finished_at"] is not None and stored["slurm_job_id"] is None
    assert re.fullmatch(r"[0-9a-f]{64}", stored["snapshot_id"])
    OpenGHMSnapshotMetadata.model_validate(stored["metadata"])  # kept, for the retry
    assert db.jobs.docs["job-1"]["status"] == "COMPLETED"

    # a job sbatch may have started is harmless beside a retry's: nothing is cancelled,
    # and nothing is searched for by a name every attempt shares
    assert db.cleanup_calls == [] and "orphan_sim_ids" not in db.jobs.docs["job-1"]
    (event,) = events(db)
    assert event["action"] == "job_publish_failed" and event["actor_id"] == OWNER
    assert event["detail"]["cause"] == cause and event["detail"]["retry"] == "same"


def test_an_sbatch_refusal_is_explained_in_slurms_words_and_says_nothing_was_uploaded(client, db, monkeypatch):
    completed(db)
    monkeypatch.setattr(slurm, "submit_publish", _raising(sbatch_says_no))
    detail = publish_it(client).json()["detail"]
    assert detail["message"].endswith("Nothing was uploaded.")
    assert "Your draft is unchanged" not in detail["message"]


def _raising(fn):
    async def inner(*a, **k):
        fn(*a, **k)

    return inner


def test_an_id_that_could_not_be_recorded_leaves_the_publish_to_the_sweep(client, db, monkeypatch):
    completed(db)

    async def cannot_write(doc, fields, **kw):
        raise RuntimeError("database went away")

    monkeypatch.setattr(slurm, "write_publish", cannot_write)
    with pytest.raises(RuntimeError):
        publish_it(client)
    stored = db.jobs.docs["job-1"]["publish"]
    assert stored["state"] == "publishing" and stored["slurm_job_id"] is None  # the sweep's to end


# ---- a retry -----------------------------------------------------------------


def failed(client, db, retry, **failure):
    """A draft whose first publish failed with `retry`, as the sweep leaves it."""
    completed(db)
    assert publish_it(client).status_code == 202
    stored = db.jobs.docs["job-1"]["publish"]
    stored.update(
        state="failed",
        finished_at=NOW,
        failure={"cause": "publish_upload_failed", "message": "m.", "retry": retry, "exit_code": 6, **failure},
    )
    del db.publish_calls[:]
    return copy.deepcopy(stored)


def test_a_same_retry_publishes_the_stored_document_byte_for_byte_under_the_same_id(client, db):
    first = failed(client, db, "same")
    r = client.post(URL, headers=HEADERS)  # no body is needed: nothing is composed
    assert r.status_code == 202, r.text
    stored = db.jobs.docs["job-1"]["publish"]
    assert stored["snapshot_id"] == first["snapshot_id"]
    assert stored["metadata"] == first["metadata"]
    assert stored["attempts"] == 2 and stored["state"] == "publishing"
    assert stored["failure"] is None and stored["finished_at"] is None
    assert stored["slurm_job_id"] == "67890" and stored["submitted_by"] == OWNER
    (call,) = db.publish_calls
    assert call["metadata_text"] == publish.metadata_text(first["metadata"])
    assert call["snapshot_id"] == first["snapshot_id"] and call["name"] == f"publish-{first['snapshot_id'][:12]}"
    assert f"--id {first['snapshot_id']} " in call["body"]
    assert events(db, "job_publish_submitted")[-1]["detail"]["metadata"] == "reused"
    assert events(db, "job_publish_submitted")[-1]["detail"]["attempt"] == 2


@pytest.mark.parametrize("retry", ["same", "none"])
def test_a_body_is_ignored_when_the_stored_document_is_reused(client, db, retry):
    first = failed(client, db, retry)
    r = publish_it(client, {**EDITED, "name": ""})  # would be invalid, and is never looked at
    assert r.status_code == 202, r.text
    assert db.jobs.docs["job-1"]["publish"]["metadata"] == first["metadata"]


def test_an_edit_retry_composes_the_document_again_under_the_same_id(client, db):
    first = failed(client, db, "edit", cause="publish_bad_input")
    r = publish_it(client, EDITED)
    assert r.status_code == 202, r.text
    stored = db.jobs.docs["job-1"]["publish"]
    assert stored["snapshot_id"] == first["snapshot_id"]  # never changes
    assert stored["metadata"]["id"] == first["snapshot_id"]
    assert stored["metadata"]["about"]["name"] == "A better name"
    assert stored["metadata"]["slug"] == "a-better-name"
    assert stored["metadata"] != first["metadata"] and stored["attempts"] == 2
    (call,) = db.publish_calls
    assert call["metadata_text"] == publish.metadata_text(stored["metadata"])
    assert events(db, "job_publish_submitted")[-1]["detail"]["metadata"] == "composed"


def test_an_edit_retry_needs_a_valid_about_and_changes_nothing_without_one(client, db):
    failed(client, db, "edit")
    before = copy.deepcopy(db.jobs.docs["job-1"])
    events_before = len(events(db))
    for payload in (None, {"about": {**ABOUT, "tags": []}}):
        r = client.post(URL, json=payload, headers=HEADERS) if payload else client.post(URL, headers=HEADERS)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_about"
    assert db.jobs.docs["job-1"] == before and db.publish_calls == []
    assert len(events(db)) == events_before


def test_a_retry_after_a_failed_submit_resumes_under_the_same_id(client, db, monkeypatch):
    completed(db)
    real = slurm.submit_publish

    async def lost(*_a, **_k):
        raise SSHTransportError("connection reset")

    monkeypatch.setattr(slurm, "submit_publish", lost)
    assert publish_it(client).status_code == 503
    first = copy.deepcopy(db.jobs.docs["job-1"]["publish"])
    monkeypatch.setattr(slurm, "submit_publish", real)
    assert client.post(URL, headers=HEADERS).status_code == 202
    again = db.jobs.docs["job-1"]["publish"]
    assert again["snapshot_id"] == first["snapshot_id"] and again["metadata"] == first["metadata"]
    assert again["attempts"] == 2 and again["state"] == "publishing"


def test_a_published_draft_cannot_be_published_again(client, db):
    failed(client, db, "same")
    db.jobs.docs["job-1"]["publish"]["state"] = "published"
    before = copy.deepcopy(db.jobs.docs["job-1"])
    r = publish_it(client)
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "already_published"
    assert db.jobs.docs["job-1"] == before


# ---- delete (B5) -------------------------------------------------------------


def test_deleting_a_draft_while_it_publishes_is_409_publish_in_progress(client, db, anvil):
    completed(db)
    assert publish_it(client).status_code == 202
    before = copy.deepcopy(db.jobs.docs["job-1"])
    r = client.delete("/api/v1/jobs/job-1", headers=HEADERS)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "publish_in_progress" and r.json()["detail"]["message"]
    assert db.jobs.docs["job-1"] == before
    assert anvil.commands == []  # nothing removed from Anvil
    assert events(db, "job_deleted") == []


@pytest.mark.parametrize("state", ["published", "failed"])
def test_a_published_or_failed_draft_may_be_deleted_with_its_scratch_files(client, db, anvil, state):
    completed(db)
    db.jobs.docs["job-1"]["publish"] = {"state": state, "snapshot_id": "ab" * 32, "attempts": 1}
    r = client.delete("/api/v1/jobs/job-1", headers=HEADERS)
    assert r.status_code == 204
    assert "job-1" not in db.jobs.docs
    assert anvil.commands == [f"[ -L {WORK} ] && exit 3; rm -rf -- {WORK}", f"rm -rf -- {DIR}"]


def test_a_publish_that_claims_the_draft_between_the_read_and_the_delete_stops_the_delete(client, db, anvil, monkeypatch):
    completed(db)
    from app.api.v1 import jobs as jobs_router

    remove = jobs_router._remove_files_of

    async def claimed_meanwhile(doc):
        removed = await remove(doc)
        db.jobs.docs["job-1"]["publish"] = {"state": "publishing", "snapshot_id": "ab" * 32, "attempts": 1}
        return removed

    monkeypatch.setattr(jobs_router, "_remove_files_of", claimed_meanwhile)
    r = client.delete("/api/v1/jobs/job-1", headers=HEADERS)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "job_changed"
    assert "job-1" in db.jobs.docs
