"""The pure half of publishing a snapshot draft (ADR 0031, mission
2026-10-07-the-gateway-publishes-a-draft): the document composed from a base
snapshot, a draft and what its owner wrote; the verdict on a publish job; and
the rule for which drafts may be published. No Mongo, no SSH.

The base is the shipped v2 example, the document the dev catalogue's first
snapshot holds.
"""

from __future__ import annotations

import copy
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.models.generated.snapshot import OpenGHMSnapshotMetadata
from app.services import publish

BASE = json.loads(
    (Path(__file__).resolve().parents[3] / "schemas" / "snapshot-spec" / "examples" / "wbm_storage_v2.0.0.json").read_text()
)
BASE_ID = BASE["id"]
NEW_ID = "ab" * 32
NOW = datetime(2026, 10, 7, 15, 30, 45, 123456, tzinfo=timezone.utc)
SITE = "https://openghm.org"

ABOUT = {
    "name": "WBM v2 tutorial, wetter: [CONUS] [2000]",
    "description": "The tutorial simulation, run again for one year.",
    "creator": [{"name": "Dev User", "email": "user@openghm.dev", "orcid": "0000-0002-1825-0097"}],
    "license": "GPL-3.0-only",
    "keywords": ["Water Balance Model", "tutorial"],
    "tags": ["tutorial"],
}


def job(**changes) -> dict:
    doc = {
        "_id": "job-1",
        "user_id": "dev-user-001",
        "dataset_id": BASE_ID,
        "status": "COMPLETED",
        "parameters": {
            "temporal_range_start": "2000-01-01",
            "temporal_range_end": "2000-12-31",
            "variables": ["discharge", "runoff"],
        },
        "slurm_config": {},
        "slurm_job_id": "21094200",
        "slurm_start": datetime(2026, 10, 5, 16, 15, 28, tzinfo=timezone.utc),
        "slurm_end": datetime(2026, 10, 5, 16, 28, 15, tzinfo=timezone.utc),
    }
    doc.update(changes)
    return doc


def compose(about=None, base=None, **changes) -> dict:
    args = dict(
        base=copy.deepcopy(BASE) if base is None else base,
        job=job(),
        about=copy.deepcopy(ABOUT) if about is None else about,
        snapshot_id=NEW_ID,
        now=NOW,
        site_url=SITE,
        cores=1,
    )
    args.update(changes)
    return publish.compose_metadata(**args)


# ---- the document ------------------------------------------------------------


def test_the_composed_document_is_a_valid_snapshot_under_the_new_id():
    doc = compose()
    OpenGHMSnapshotMetadata.model_validate(doc)
    assert doc["id"] == NEW_ID
    assert doc["$schema"] == BASE["$schema"]


def test_the_base_document_is_not_changed():
    base = copy.deepcopy(BASE)
    compose(base=base)
    assert base == BASE


def test_the_slug_comes_from_the_name():
    assert compose()["slug"] == "wbm-v2-tutorial-wetter-conus-2000"


@pytest.mark.parametrize(
    "name, slug",
    [
        ("WBM v2.0.0 simulation as tutorial: [CONUS] [2000-2001]", "wbm-v2.0.0-simulation-as-tutorial-conus-2000-2001"),
        ("  Already_slug-ok  ", "already_slug-ok"),
        ("Crème brûlée", "creme-brulee"),
        ("---a---b---", "a-b"),
        ("日本語", "snapshot-abababab"),  # nothing survives: a label made of the id
        ("!!!", "snapshot-abababab"),
        ("x" * 300, "x" * 100),
    ],
)
def test_the_slug_matches_the_specs_pattern(name, slug):
    assert publish.slugify(name, NEW_ID) == slug
    assert re.match(r"^[a-z0-9][a-z0-9_.-]*$", slug)


def test_about_is_what_the_person_wrote_plus_what_the_gateway_sets():
    about = compose()["about"]
    assert about["name"] == ABOUT["name"]
    assert about["description"] == ABOUT["description"]
    assert about["creator"] == ABOUT["creator"]
    assert about["license"] == "GPL-3.0-only"
    assert about["keywords"] == ABOUT["keywords"]
    assert about["tags"] == ["tutorial"]
    assert about["datePublished"] == "2026-10-07"
    assert about["url"] == f"https://openghm.org/snapshots/{NEW_ID}"
    assert about["isBasedOn"] == [{"kind": "snapshot", "id": BASE_ID}]
    assert "relatedLink" not in about  # none was given, and none is inherited from the base


def test_a_related_link_is_kept():
    link = {"relation": "isDescribedBy", "url": "https://example.org/paper", "doi": "10.5194/gmd-15-7287-2022"}
    assert compose({**ABOUT, "relatedLink": [link]})["about"]["relatedLink"][0]["doi"] == "10.5194/gmd-15-7287-2022"


def test_the_url_is_built_from_the_site_and_the_id_not_the_slug():
    doc = compose(site_url="https://gateway.example.org/")
    assert doc["about"]["url"] == f"https://gateway.example.org/snapshots/{NEW_ID}"
    assert doc["slug"] not in doc["about"]["url"]


def test_the_date_published_is_today_in_utc():
    late = datetime(2026, 10, 7, 23, 30, tzinfo=timezone(timedelta(hours=-5)))  # already the 8th in UTC
    assert compose(now=late)["about"]["datePublished"] == "2026-10-08"


def test_the_fields_the_gateway_sets_are_not_taken_from_the_person():
    doc = compose({**ABOUT, "datePublished": "1999-01-01", "url": "https://evil.example/x", "isBasedOn": []})
    assert doc["about"]["datePublished"] == "2026-10-07"
    assert doc["about"]["url"] == f"https://openghm.org/snapshots/{NEW_ID}"
    assert doc["about"]["isBasedOn"] == [{"kind": "snapshot", "id": BASE_ID}]


def test_the_period_and_the_output_variables_are_the_drafts():
    doc = compose()
    assert doc["simulation"]["temporalCoverage"] == {"start": "2000-01-01", "end": "2000-12-31"}
    # the base's own entry of each variable asked for, in the draft's order
    by_name = {v["name"]: v for v in BASE["simulation"]["outputVariables"]}
    assert doc["simulation"]["outputVariables"] == [by_name["discharge"], by_name["runoff"]]


def test_everything_else_of_the_simulation_and_the_uses_are_the_bases():
    doc = compose()
    for key in ("init", "spatialCoverage", "resolution", "inputVariables", "activeProcesses", "recommendedCompute"):
        assert doc["simulation"][key] == BASE["simulation"][key]
    assert doc["uses"] == BASE["uses"]


def test_a_variable_the_base_does_not_describe_is_an_error_naming_it():
    changed = job(parameters={**job()["parameters"], "variables": ["runoff", "pet"]})
    with pytest.raises(publish.ComposeError) as exc:
        publish.compose_metadata(
            base=copy.deepcopy(BASE), job=changed, about=ABOUT, snapshot_id=NEW_ID, now=NOW, site_url=SITE, cores=1
        )
    assert exc.value.errors[0]["field"] == "simulation.outputVariables"
    assert "pet" in exc.value.errors[0]["message"]


def test_no_variable_at_all_fails_the_spec():
    changed = job(parameters={**job()["parameters"], "variables": []})
    with pytest.raises(publish.ComposeError) as exc:
        publish.compose_metadata(
            base=copy.deepcopy(BASE), job=changed, about=ABOUT, snapshot_id=NEW_ID, now=NOW, site_url=SITE, cores=1
        )
    assert [e["field"] for e in exc.value.errors] == ["simulation.outputVariables"]


# ---- runtime -----------------------------------------------------------------


def test_the_runtime_is_the_jobs_own():
    runtime = compose(cores=26)["runtime"]
    assert runtime["generatedAt"] == "2026-10-07T15:30:45Z"
    assert runtime["execution"] == {
        "cluster": "anvil",
        "cores": 26,
        "elapsedWalltime": "12:47",
        "startedAt": "2026-10-05T16:15:28Z",
        "finishedAt": "2026-10-05T16:28:15Z",
        "slurmJobId": "21094200",
    }


def test_an_elapsed_time_over_an_hour_is_written_in_slurms_form():
    long = job(slurm_end=datetime(2026, 10, 7, 4, 15, 29, tzinfo=timezone.utc))
    execution = publish.compose_metadata(
        base=copy.deepcopy(BASE), job=long, about=ABOUT, snapshot_id=NEW_ID, now=NOW, site_url=SITE, cores=1
    )["runtime"]["execution"]
    assert execution["elapsedWalltime"] == "36:00:01"


def test_what_the_job_does_not_record_is_unknown_not_invented():
    bare = job(slurm_start=None, slurm_end=None, slurm_job_id=None)
    doc = publish.compose_metadata(
        base=copy.deepcopy(BASE), job=bare, about=ABOUT, snapshot_id=NEW_ID, now=NOW, site_url=SITE, cores=None
    )
    OpenGHMSnapshotMetadata.model_validate(doc)
    assert doc["runtime"]["execution"] == {
        "cluster": "anvil",
        "cores": "unknown",
        "elapsedWalltime": "unknown",
        "startedAt": "unknown",
        "finishedAt": "unknown",
        "slurmJobId": "unknown",
    }


def test_slurms_no_time_is_not_a_time():
    never = job(slurm_start=datetime(2106, 2, 7, 6, 28, 14, tzinfo=timezone.utc), started_at=None, completed_at=None)
    execution = publish.compose_metadata(
        base=copy.deepcopy(BASE), job=never, about=ABOUT, snapshot_id=NEW_ID, now=NOW, site_url=SITE, cores=1
    )["runtime"]["execution"]
    assert execution["startedAt"] == execution["elapsedWalltime"] == "unknown"


# ---- an invalid about --------------------------------------------------------


def test_an_invalid_about_names_each_field_under_about():
    bad = {**ABOUT, "name": "", "creator": [], "tags": ["not-a-tag"]}
    with pytest.raises(publish.ComposeError) as exc:
        compose(bad)
    fields = {e["field"] for e in exc.value.errors}
    assert fields == {"about.name", "about.creator", "about.tags.0"}
    assert all(e["message"] for e in exc.value.errors)


def test_a_missing_field_is_named():
    without = {k: v for k, v in ABOUT.items() if k != "license"}
    with pytest.raises(publish.ComposeError) as exc:
        compose(without)
    assert exc.value.errors == [{"field": "about.license", "message": "Field required"}]


def test_a_field_the_form_has_no_business_sending_is_refused():
    with pytest.raises(publish.ComposeError) as exc:
        compose({**ABOUT, "slug": "mine"})
    assert exc.value.errors[0]["field"] == "about.slug"


def test_a_bad_email_orcid_or_link_is_a_field_error():
    with pytest.raises(publish.ComposeError) as exc:
        compose(
            {
                **ABOUT,
                "creator": [{"name": "A", "email": "nope", "orcid": "123"}],
                "relatedLink": [{"relation": "x", "url": "not a url"}],
            }
        )
    assert {e["field"] for e in exc.value.errors} == {
        "about.creator.0.email",
        "about.creator.0.orcid",
        "about.relatedLink.0.url",
    }


def test_the_same_inputs_give_the_same_bytes():
    assert publish.metadata_text(compose()) == publish.metadata_text(compose())
    assert publish.metadata_text(compose()).endswith("}\n")


def test_minted_ids_are_256_random_bits_of_lowercase_hex():
    a, b = publish.mint_snapshot_id(), publish.mint_snapshot_id()
    assert a != b
    for value in (a, b):
        assert len(value) == 64 and value == value.lower() and int(value, 16) >= 0


# ---- which drafts may be published -------------------------------------------


@pytest.mark.parametrize(
    "changes, reason",
    [
        ({}, None),
        ({"publish": {"state": "failed"}}, None),
        ({"status": "DRAFT"}, "not_completed"),
        ({"status": "RUNNING"}, "not_completed"),
        ({"status": "SUBMITTED"}, "not_completed"),
        ({"status": "FAILED"}, "run_failed"),
        ({"status": "CANCELLED"}, "run_failed"),
        ({"failure": {"cause": "wbm_error"}}, "run_failed"),
        ({"status": "DRAFT", "last_submit_error": {"code": "answered_by_published"}}, "answered_by_published"),
        ({"publish": {"state": "publishing"}}, "publishing"),
        ({"publish": {"state": "published"}}, "already_published"),
        # a rerun that completed has no mark: it ran, and it is publishable
        ({"last_submit_error": None}, None),
        ({"last_submit_error": {"code": "anvil_unreachable"}}, None),
    ],
)
def test_publish_refusal(changes, reason):
    assert publish.publish_refusal(job(**changes)) == reason


# ---- the verdict -------------------------------------------------------------


def record(code, **extra) -> dict:
    return {"schema": 1, "snapshot_id": NEW_ID, "exit_code": code, "signal": None, "stderr_tail": ["x"], **extra}


@pytest.mark.parametrize(
    "code, cause, retry",
    [
        (2, "publish_bad_input", "edit"),
        (3, "publish_output_incomplete", "none"),
        (4, "publish_conflict", "none"),
        (5, "publish_setup", "none"),
        (6, "publish_upload_failed", "same"),
        (7, "publish_verify_failed", "same"),
    ],
)
def test_each_exit_code_of_the_toolkit_has_its_cause_and_retry(code, cause, retry):
    state = "FAILED"  # the script exits with the toolkit's code, so SLURM says FAILED
    verdict = publish.classify_publish(slurm_state=state, outcome=record(code), snapshot_id=NEW_ID)
    assert verdict.state == "failed"
    assert (verdict.failure.cause, verdict.failure.retry, verdict.failure.exit_code) == (cause, retry, code)
    assert verdict.failure.message.endswith(".")
    assert "x" not in verdict.failure.message.split()  # the stderr tail never reaches a message


def test_exit_zero_is_published():
    verdict = publish.classify_publish(slurm_state="COMPLETED", outcome=record(0), snapshot_id=NEW_ID)
    assert verdict == publish.PublishVerdict("published")


@pytest.mark.parametrize(
    "state, outcome",
    [
        ("COMPLETED", None),  # no outcome file
        ("FAILED", None),
        (None, None),  # SLURM has forgotten the job
        ("TIMEOUT", record(None, signal="TERM")),
        ("TIMEOUT", record(0)),  # killed: whatever the record says
        ("CANCELLED by 1234", record(None, signal="TERM")),
        ("CANCELLED", None),
        ("NODE_FAIL", None),
        ("OUT_OF_MEMORY", None),
        ("COMPLETED", record(1)),  # a code the toolkit never uses
        ("FAILED", record(137)),
        ("COMPLETED", record(None)),
        ("COMPLETED", record(0, signal="TERM")),  # interrupted
        ("COMPLETED", record(0, snapshot_id="cd" * 32)),  # another snapshot's record
        ("COMPLETED", {"exit_code": "0"}),  # a record of the wrong shape
        ("COMPLETED", {"exit_code": True}),
        ("COMPLETED", ["not", "a", "record"]),
        ("SOMETHING_ELSE", record(0)),
    ],
)
def test_everything_else_is_a_job_that_failed_and_may_be_tried_again(state, outcome):
    verdict = publish.classify_publish(slurm_state=state, outcome=outcome, snapshot_id=NEW_ID)
    assert verdict.state == "failed"
    assert (verdict.failure.cause, verdict.failure.retry) == ("publish_job_failed", "same")


def test_a_timeout_and_a_cancel_say_so():
    timeout = publish.classify_publish(slurm_state="TIMEOUT", outcome=None, snapshot_id=NEW_ID).failure.message
    cancel = publish.classify_publish(slurm_state="CANCELLED by 5", outcome=None, snapshot_id=NEW_ID).failure.message
    assert "time limit" in timeout
    assert "cancelled" in cancel
    assert len({timeout, cancel, publish.MESSAGE["publish_job_failed"]}) == 3


def test_every_cause_has_a_sentence():
    from typing import get_args

    from app.models.job import PublishFailureCause

    assert set(get_args(PublishFailureCause)) - {"sbatch_rejected"} <= set(publish.MESSAGE)
    assert all(m.endswith(".") for m in publish.MESSAGE.values())


def test_a_message_says_what_happened_and_leaves_what_to_do_to_the_retry_line():
    # The card puts the message between a headline and the frontend's retry line,
    # so a message that tells the owner to try again or to ask someone says it twice.
    for message in [*publish.MESSAGE.values(), publish._TIMED_OUT, publish._CANCELLED]:
        assert not re.search(r"try again|tell an administrator|ask an administrator|an administrator has to", message, re.I)
