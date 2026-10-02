"""app.api.v1.jobs — the simulation draft lifecycle added by mission
2026-09-20-simulations: ownership isolation, the edit-past-draft refusal,
and deriving from a snapshot without touching it.

Mirrors test_repository.py's approach, and salvages the abandoned
2026-09-20-snapshot-drafts mission's `_mongo_calls` AST helper
(tests/test_drafts.py), retargeted at `app.api.v1.jobs`: `_job_scope_query`,
`_is_owner`, `_can_access_job`, `_is_editable` and
`_derive_simulation_parameters` are pure — a dict standing in for a Mongo
document, a `TokenPayload` standing in for the authenticated caller — so
they are tested directly with no Mongo, no FastAPI TestClient, and no
fixtures. The route-level harness that mission did not build now exists (see
tests/conftest.py and tests/test_job_access.py). Live end-to-end verification (real Mongo, real HTTP, two real
accounts) is run separately with `curl` against the local dev stack per
plan.md.
"""

from __future__ import annotations

import ast
import inspect
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.api.v1 import jobs as jobs_router
from app.api.v1.jobs import (
    _can_access_job,
    _derive_simulation_parameters,
    _duplicate_document,
    _is_editable,
    _is_owner,
    _job_scope_query,
    _new_draft_document,
    _resolve_model_input,
)
from app.core.roles import Permission, Role
from app.models.job import JobParameters
from app.models.user import TokenPayload

EXAMPLES_DIR = __import__("pathlib").Path(__file__).resolve().parents[3] / "schemas" / "snapshot-spec" / "examples"


def _user(sub: str, role: Role = Role.USER, email: str = "u@example.org") -> TokenPayload:
    return TokenPayload(sub=sub, email=email, role=role, name=sub)


ALICE = _user("alice")
BOB = _user("bob")
STAFF = _user("staff", role=Role.STAFF)


def _job(owner: str, status: str = "DRAFT") -> dict:
    return {"_id": "job-1", "user_id": owner, "status": status}


# ---- _job_scope_query -------------------------------------------------


def test_scope_query_defaults_to_own_jobs():
    assert _job_scope_query(ALICE, None) == {"user_id": "alice"}


def test_scope_query_own_id_is_a_noop():
    assert _job_scope_query(ALICE, "alice") == {"user_id": "alice"}


def test_scope_query_another_users_id_requires_view_any():
    """The 'can neither list ... by id' half of the acceptance criterion: a
    second, unprivileged user's own id filter is fine, but asking for
    *another* user's is refused."""
    with pytest.raises(HTTPException) as excinfo:
        _job_scope_query(BOB, "alice")
    assert excinfo.value.status_code == 403


def test_scope_query_another_users_id_permitted_for_staff():
    assert _job_scope_query(STAFF, "alice") == {"user_id": "alice"}


def test_scope_query_wildcard_requires_view_any():
    with pytest.raises(HTTPException):
        _job_scope_query(BOB, "*")


# ---- _can_access_job / _is_owner (the "by direct id" half of isolation) --


def test_owner_can_access_their_own_job():
    assert _can_access_job(_job("alice"), ALICE, Permission.JOB_VIEW_ANY) is True


def test_second_user_cannot_access_by_id():
    """The core isolation guarantee: a second, unprivileged user cannot
    fetch another user's simulation by its id."""
    assert _can_access_job(_job("alice"), BOB, Permission.JOB_VIEW_ANY) is False


def test_second_user_with_the_escalated_permission_can_access():
    assert _can_access_job(_job("alice"), STAFF, Permission.JOB_VIEW_ANY) is True


def test_is_owner_true_only_for_the_owner():
    assert _is_owner(_job("alice"), ALICE) is True
    assert _is_owner(_job("alice"), BOB) is False


def test_view_any_does_not_imply_edit_ownership():
    """JOB_VIEW_ANY lets staff *see* another user's simulation (an
    operator's dashboard), but app.core.roles deliberately grants no
    JOB_EDIT_ANY / JOB_DELETE_ANY — mutating someone else's private,
    unpublished work is out of scope. The edit/delete routes check
    `_is_owner`, not `_can_access_job`, so this has to stay false even for
    a privileged caller."""
    assert _is_owner(_job("alice"), STAFF) is False


# ---- _is_editable: a simulation past draft refuses edits ------------------


def test_draft_is_editable():
    assert _is_editable(_job("alice", status="DRAFT")) is True


@pytest.mark.parametrize(
    "status", ["PENDING", "SUBMITTED", "RUNNING", "COMPLETING", "COMPLETED", "FAILED", "CANCELLED"]
)
def test_anything_past_draft_is_not_editable(status):
    assert _is_editable(_job("alice", status=status)) is False


# ---- _mongo_calls: datasets is only ever read, never written -------------


def _mongo_calls(db_name: str, source: str) -> tuple[dict[str, set[str]], list[str]]:
    """Map each Mongo collection `source` reaches through `db_name` to the
    set of method names called on it. AST-based rather than a substring
    check, so `db["datasets"]` (not just the literal text `db.datasets`) is
    caught. A `db[...]` subscript whose key isn't a string literal cannot be
    resolved to a collection name by looking at this one call site, so it is
    *not* silently skipped: it goes into the second return value instead,
    for the caller to treat as a failure.

    Salvaged from the abandoned 2026-09-20-snapshot-drafts mission's
    tests/test_drafts.py, retargeted from `app.api.v1.drafts` (deleted) at
    `app.api.v1.jobs`.
    """

    def collection_name(node: ast.AST) -> str | None:
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == db_name
        ):
            return node.attr
        if (
            isinstance(node, ast.Subscript)
            and isinstance(node.value, ast.Name)
            and node.value.id == db_name
            and isinstance(node.slice, ast.Constant)
            and isinstance(node.slice.value, str)
        ):
            return node.slice.value
        return None

    def is_unresolved_db_subscript(node: ast.AST) -> bool:
        return (
            isinstance(node, ast.Subscript)
            and isinstance(node.value, ast.Name)
            and node.value.id == db_name
            and not (
                isinstance(node.slice, ast.Constant)
                and isinstance(node.slice.value, str)
            )
        )

    calls: dict[str, set[str]] = {}
    unanalyzable: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if is_unresolved_db_subscript(node):
            unanalyzable.append(ast.unparse(node))
            continue
        name = collection_name(node)
        if name is not None:
            calls.setdefault(name, set())
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            coll = collection_name(node.func.value)
            if coll is not None:
                calls.setdefault(coll, set()).add(node.func.attr)
    return calls, unanalyzable


_WRITE_VERBS = {
    "insert_one",
    "insert_many",
    "update_one",
    "update_many",
    "delete_one",
    "delete_many",
    "replace_one",
    "find_one_and_update",
    "find_one_and_delete",
    "find_one_and_replace",
    "bulk_write",
}


def test_mongo_calls_flags_an_indirected_subscript_instead_of_ignoring_it():
    calls, unanalyzable = _mongo_calls(
        "db", 'coll = "datasets"\ndb[coll].insert_one({"x": 1})'
    )
    assert calls == {}
    assert unanalyzable != []


def test_mongo_calls_resolves_a_direct_subscript_write():
    calls, unanalyzable = _mongo_calls("db", 'db["datasets"].insert_one({"x": 1})')
    assert calls == {"datasets": {"insert_one"}}
    assert unanalyzable == []


def test_jobs_module_never_writes_datasets():
    """`datasets` is the catalogue (published snapshots, rule 1). Deriving a
    simulation legitimately reads it (`POST /jobs/derive/{dataset_id}` —
    that's the whole point), but nothing in this module writes to it.
    Checked via an AST walk of the real calls made on `db`; anything the
    walk cannot attribute to a collection fails this test rather than
    passing it by omission."""
    source = inspect.getsource(jobs_router)
    calls, unanalyzable = _mongo_calls("db", source)

    assert unanalyzable == []
    assert "jobs" in calls
    assert "datasets" in calls
    assert calls["datasets"] & _WRITE_VERBS == set()
    assert calls["datasets"] == {"find_one"}  # sanity: derive really does read it


# ---- deriving a simulation from a catalogue entry (T4) --------------------


def _dataset_doc(name: str) -> dict:
    """A `datasets` Mongo document, exactly as `db.datasets.find_one` would
    return it — the real catalogue examples, with Mongo's own `_id` layered
    on the way `POST /repository/datasets` actually stores them."""
    import json

    data = json.loads((EXAMPLES_DIR / name).read_text())
    return {**data, "_id": data["id"]}


def test_derive_parameters_from_a_real_catalogue_example():
    doc = _dataset_doc("wbm_storage_v2.0.0.json")
    params = _derive_simulation_parameters(doc)
    assert isinstance(params, JobParameters)
    assert params.temporal_range_start == str(doc["simulation"]["temporalCoverage"]["start"])
    assert params.temporal_range_end == str(doc["simulation"]["temporalCoverage"]["end"])
    assert params.variables == [v["name"] for v in doc["simulation"]["outputVariables"]]


def test_derive_does_not_modify_the_source_document():
    """The source snapshot is read, never written — re-reading it afterwards
    (here: comparing against an independently-loaded copy) shows deriving
    left it untouched, without needing a real Mongo round trip."""
    import copy

    doc = _dataset_doc("wbm_storage_v2.0.0.json")
    before = copy.deepcopy(doc)

    _derive_simulation_parameters(doc)

    assert doc == before


# ---- a user can create more than one draft (regression) ------------------
#
# `db.jobs`'s `sim_id` index is `unique=True, sparse=True`. Sparse only
# excludes a document where the field is *missing* — not one where it is
# `""` or `None` — so defaulting every draft's `sim_id` to `""` made the
# *second* draft ever created collide with the first and 500. Caught in
# review of this commit; reproduced live against the running stack (see the
# curl transcript in the report) before this test was written.


def _draft_doc(job_id: str, user: TokenPayload = ALICE) -> dict:
    return _new_draft_document(
        job_id=job_id,
        dataset_id="dataset-1",
        dataset_title="Dataset One",
        parameters=JobParameters(
            temporal_range_start="2001-01-01",
            temporal_range_end="2001-12-31",
            variables=["runoff"],
        ),
        slug=None,
        user=user,
        now=datetime.now(timezone.utc),
    )


def test_a_fresh_draft_omits_sim_id_entirely():
    """Not `""`, not `None` — genuinely absent, which is what the sparse
    index needs to skip it."""
    assert "sim_id" not in _draft_doc("job-1")


def test_two_drafts_for_the_same_user_do_not_share_a_sim_id_value():
    """The exact regression: a second draft for the same user must not
    collide with the first on the unique sparse `sim_id` index. Both must
    omit the field, since any shared present value — including two `""`s —
    would violate uniqueness once inserted."""
    first = _draft_doc("job-1")
    second = _draft_doc("job-2")
    assert "sim_id" not in first
    assert "sim_id" not in second


def test_draft_document_carries_updated_at():
    """`JobResponse.updated_at` (added alongside this fix) reads this field
    — the Workspace table's "Updated" column needs it to reflect a PATCH,
    not just fall back to created_at."""
    doc = _draft_doc("job-1")
    assert doc["updated_at"] == doc["created_at"]


# ---- deriving through the route: the answer and the audit event -----------


def test_derive_answers_201_with_the_new_draft_and_audits_it(client, db):
    from route_helpers import make_user, token_for

    db.users.docs["alice"] = make_user("alice")
    response = client.post("/api/v1/jobs/derive/ds-1", json={}, headers=token_for("alice"))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "DRAFT" and body["sim_id"] == ""
    assert body["user_id"] == "alice"
    assert body["dataset_id"] == "ds-1" and body["dataset_title"] == "Dataset one"
    assert body["parameters"] == {
        "temporal_range_start": "2000-01-01",
        "temporal_range_end": "2000-12-31",
        "spatial_domain": None,
        "variables": ["runoff", "discharge"],
        "custom_params": None,
    }
    assert body["slurm_config"] == {"cores": None, "walltime": None}
    assert body["about"] is None and body["model_input_id"] is None
    assert body["updated_at"] == body["created_at"]

    assert "sim_id" not in db.jobs.docs[body["id"]]
    (event,) = [e for e in db.audit_events.docs.values() if e["action"] == "simulation_derived"]
    assert event["category"] == "job" and event["actor_id"] == "alice"
    assert event["target_id"] == body["id"]
    assert event["detail"] == {"dataset_id": "ds-1"}


# ---- _duplicate_document: an allowlist, not a copy of the source -----------

#: Every field a run, a verdict, a cancel or a submit adds to a job, plus one
#: no code knows about yet. None of them may reach a copy.
_RUN_FIELDS = {
    "sim_id": "sim-20260930-0a1b2c",
    "status": "COMPLETED",
    "status_reason": "r",
    "slurm_job_id": "1",
    "slurm_job_name": "sim-x",
    "internal_job_id": "slurmly-1",
    "remote_job_dir": "/d",
    "remote_script_path": "/d/run.sh",
    "stdout_path": "/d/o",
    "stderr_path": "/d/e",
    "slurmly_submitted_at": "2026-09-30T00:00:00Z",
    "submitted_at": "t",
    "toolkit": {"home": "/h", "commit": "c"},
    "work_dir": "/w",
    "last_submit_error": {"code": "c", "message": "m", "at": "t"},
    "output_s3_key": "k",
    "slurm_state": "COMPLETED",
    "slurm_exit_code": "0:0",
    "slurm_start": "t",
    "slurm_end": "t",
    "failure": {"cause": "wbm_error", "message": "m"},
    "outcome": {"ok": True},
    "cancel_requested_at": "t",
    "cancel_requested_by": "u",
    "cancel_requested_by_email": "u@example.org",
    "missing_since": "t",
    "files": "present",
    "files_checked_at": "t",
    "wbm_log_path": "p",
    "orphan_sim_ids": ["sim-20260930-ffffff"],
    "started_at": "t",
    "completed_at": "t",
    "a_field_added_later": "x",
}


def _source_with_a_run() -> dict:
    return {
        "_id": "source",
        "user_id": "bob",
        "user_email": "bob@example.org",
        "dataset_id": "dataset-1",
        "dataset_title": "Stale title",
        "slug": "slug",
        "about": {"name": "Basin", "keywords": ["k"]},
        "model_input_id": "mi-1",
        "parameters": {
            "temporal_range_start": "2001-01-01",
            "temporal_range_end": "2001-12-31",
            "variables": ["runoff"],
        },
        "slurm_config": {"cores": 4, "walltime": "01:00:00"},
        "created_at": "old",
        "updated_at": "old",
        **_RUN_FIELDS,
    }


def test_duplicate_document_has_exactly_the_keys_of_a_fresh_draft():
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    copy_ = _duplicate_document(
        _source_with_a_run(), job_id="new", user=ALICE, now=now, dataset_title="Fresh title"
    )
    assert set(copy_) == set(_draft_doc("x"))
    assert copy_["_id"] == "new" and copy_["status"] == "DRAFT"
    assert (copy_["user_id"], copy_["user_email"]) == ("alice", "u@example.org")
    assert copy_["created_at"] == copy_["updated_at"] == now
    assert copy_["dataset_title"] == "Fresh title"
    assert "sim_id" not in copy_
    for field in _RUN_FIELDS:
        assert copy_.get(field) in (None, "", [], "DRAFT"), field
    # What a copy does take.
    assert copy_["dataset_id"] == "dataset-1" and copy_["slug"] == "slug"
    assert copy_["about"] == {"name": "Basin (copy)", "keywords": ["k"]}
    assert copy_["model_input_id"] == "mi-1"
    assert copy_["parameters"]["variables"] == ["runoff"]
    assert copy_["slurm_config"] == {"cores": 4, "walltime": "01:00:00"}


def test_duplicate_document_does_not_share_or_change_the_sources_about():
    source = _source_with_a_run()
    copy_ = _duplicate_document(
        source, job_id="new", user=ALICE, now=datetime.now(timezone.utc), dataset_title="t"
    )
    assert source["about"] == {"name": "Basin", "keywords": ["k"]}
    copy_["about"]["keywords"].append("x")
    assert source["about"]["keywords"] == ["k"]


# ---- _resolve_model_input: the three states (T1) --------------------------
#
# Real catalogue examples, not invented fixtures: `wbm_storage_v2.0.0`'s
# `uses.modelInput.id` really does resolve to the shipped
# `wbm_ancillary_data_v2.0.0` model input, and the two `wbm_storage_v1.0.0_*`
# examples really do cite `ff0ba2e5…`, a v1-era input this repository ships
# no example for — both true today in the dev database (mission prompt.md),
# not a scenario made up for the test.

V2_DATASET = _dataset_doc("wbm_storage_v2.0.0.json")
V1_DATASET = _dataset_doc("wbm_storage_v1.0.0_Global.json")

V2_MODEL_INPUT_ID = V2_DATASET["uses"]["modelInput"]["id"]
V1_MODEL_INPUT_ID = V1_DATASET["uses"]["modelInput"]["id"]

#: Stands in for "what's actually in the `model_inputs` catalogue" — the
#: shipped `wbm_ancillary_data_v2.0.0` example, and nothing else, exactly as
#: `_resolve_effective_model_input` would compute it from a real `db.model_inputs`
#: lookup for this dataset. `_resolve_model_input` itself is pure and takes
#: this as a plain `set`, so no Mongo is needed to exercise all three states.
CATALOGUE_WITH_V2_ONLY = {V2_MODEL_INPUT_ID}


def _draft(dataset_id: str = "wbm_storage_v2.0.0", model_input_id: str | None = None, status: str = "DRAFT") -> dict:
    return {"_id": "job-1", "dataset_id": dataset_id, "status": status, "model_input_id": model_input_id}


def test_resolve_inherited_when_the_base_snapshots_input_is_in_the_catalogue():
    """`wbm_storage_v2.0.0`, no override — the base snapshot's input really
    is published, so this is an ordinary inheritance."""
    effective_id, state = _resolve_model_input(_draft(), V2_DATASET, CATALOGUE_WITH_V2_ONLY)
    assert state == "inherited"
    assert effective_id == V2_MODEL_INPUT_ID


def test_resolve_inherited_missing_when_the_base_snapshots_input_has_no_catalogue_entry():
    """A `wbm_storage_v1.0.0` example, no override — its cited input
    (`ff0ba2e5…`) is not in the catalogue. This is the *ordinary* case in
    the dev database today (two of three shipped snapshot examples), not an
    edge case, and it must say so rather than silently resolving to nothing
    or crashing on a missing id."""
    effective_id, state = _resolve_model_input(_draft(), V1_DATASET, CATALOGUE_WITH_V2_ONLY)
    assert state == "inherited-missing"
    assert effective_id == V1_MODEL_INPUT_ID


def test_resolve_inherited_missing_when_there_is_no_base_snapshot_at_all():
    """Defensive: a dataset lookup that came back empty degrades to the
    same honest "missing" state rather than raising."""
    effective_id, state = _resolve_model_input(_draft(), None, CATALOGUE_WITH_V2_ONLY)
    assert state == "inherited-missing"
    assert effective_id is None


def test_resolve_chosen_when_an_override_is_set():
    """An override always wins over the base snapshot's own citation, and
    is reported as "chosen" — distinct from either inherited state — even
    against a base snapshot whose own input is missing from the catalogue."""
    effective_id, state = _resolve_model_input(
        _draft(model_input_id=V2_MODEL_INPUT_ID), V1_DATASET, CATALOGUE_WITH_V2_ONLY
    )
    assert state == "chosen"
    assert effective_id == V2_MODEL_INPUT_ID


def test_resolve_clearing_an_override_returns_to_inherited():
    """The override field, once cleared back to `None`, is exactly the
    no-override case again — no separate "was cleared" state to track."""
    still_set = _resolve_model_input(_draft(model_input_id=V2_MODEL_INPUT_ID), V2_DATASET, CATALOGUE_WITH_V2_ONLY)
    cleared = _resolve_model_input(_draft(model_input_id=None), V2_DATASET, CATALOGUE_WITH_V2_ONLY)
    assert still_set == (V2_MODEL_INPUT_ID, "chosen")
    assert cleared == (V2_MODEL_INPUT_ID, "inherited")


# ---- a submitted simulation refuses a model-input change ------------------


def test_submitted_simulation_is_not_editable_even_just_for_the_model_input():
    """No new rule (tasks.md T3): setting or clearing `model_input_id` is
    just another field on `SimulationUpdateRequest`, guarded by the same
    `_is_editable` every other draft field already goes through."""
    submitted = _draft(status="SUBMITTED")
    assert _is_editable(submitted) is False
