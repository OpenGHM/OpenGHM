"""Jobs API — drafts, submit, list, status, cancel, logs."""

import asyncio
import contextlib
import copy
import logging
import math
import posixpath
import random
import string
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from slurmly.exceptions import (
    InvalidJobSpec,
    SbatchError,
    SbatchParseError,
    SlurmlyError,
)

from app.core.audit import AuditCategory, log_event
from app.core.authz import (
    CurrentUser,
    can,
    require_active_user,
    require_permission,
    require_submitter,
)
from app.core.config import settings
from app.core.database import get_db
from app.core.roles import Permission
from app.models.job import (
    ACTIVE_STATUSES,
    CANCELLABLE_STATUSES,
    MAX_WALLTIME_SECONDS,
    TERMINAL_STATUSES,
    JobListResponse,
    JobLogResponse,
    JobDB,
    JobParameters,
    JobResponse,
    JobStatsResponse,
    JobStatusResponse,
    LogStream,
    ModelInputState,
    PartialAbout,
    PublishRequest,
    SimulationDeriveRequest,
    SimulationUpdateRequest,
    SlurmConfig,
    SubmitRequest,
    real_time,
    verdict_fields,
)
from app.models.user import TokenPayload
from app.services import (
    job_live,
    job_script,
    publish,
    published_answer,
    run_start,
    sbatch_refusal,
    slurm,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["jobs"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _generate_sim_id(now: datetime) -> str:
    date_part = now.strftime("%Y%m%d")
    rand_part = "".join(random.choices(string.hexdigits[:16].lower(), k=6))
    return f"sim-{date_part}-{rand_part}"


def _resolve_model_input(
    job_doc: dict, dataset_doc: dict | None, catalogue_ids: set[str]
) -> tuple[str | None, ModelInputState]:
    """Which model input `job_doc` effectively uses, and which of the three
    states (`app.models.job.ModelInputState`) produced that answer (T1).
    Pure — a plain dict standing in for `db.jobs`, another for `db.datasets`,
    a plain `set` standing in for a `model_inputs` existence check — so the
    states are tested directly with no Mongo (tests/test_jobs_drafts.py).
    Written first and kept pure deliberately: the frontend's three-state
    display (next commit) depends on these being distinguished here, not
    reconstructed from a single id in the UI (plan.md).

    - `job_doc["model_input_id"]` set -> "chosen", that id, regardless of
      whether it happens to also be in the catalogue (this mission does not
      validate an override against it — the picker that supplies one,
      next commit, only ever offers catalogue entries).
    - unset, and the base snapshot's `uses.modelInput.id` is in
      `catalogue_ids` -> "inherited", that id.
    - unset, and that id is not in `catalogue_ids` (or there is no base
      snapshot to read it from at all) -> "inherited-missing" — the
      ordinary case in the dev database today, not an edge case.
    """
    override = job_doc.get("model_input_id")
    if override:
        return override, "chosen"

    inherited_id = ((dataset_doc or {}).get("uses") or {}).get("modelInput", {}).get("id")
    if inherited_id is not None and inherited_id in catalogue_ids:
        return inherited_id, "inherited"
    return inherited_id, "inherited-missing"


async def _resolve_effective_model_input(doc: dict) -> tuple[str | None, ModelInputState]:
    """`_resolve_model_input`'s Mongo-fetching half — kept separate so the
    decision itself stays pure and testable. Only called for a single
    snapshot draft (derive/get/patch), never per-row from `list_jobs`
    (plan.md's second risk: N resolves on the list page)."""
    db = get_db()
    # `datasets`/`model_inputs` documents are envelopes since mission
    # 2026-09-23-catalogue-envelope ({_id, document, owner_user_id,
    # visibility, registered_at}) — unwrap to the spec document right after
    # the fetch, so everything below keeps working on the shape it always has
    # (app.models.repository.build_envelope / .from_metadata_json).
    dataset_envelope = await db.datasets.find_one({"_id": doc["dataset_id"]})
    dataset_doc = (dataset_envelope or {}).get("document")

    catalogue_ids: set[str] = set()
    if not doc.get("model_input_id"):
        inherited_id = ((dataset_doc or {}).get("uses") or {}).get("modelInput", {}).get("id")
        if inherited_id is not None:
            exists = await db.model_inputs.find_one({"_id": inherited_id})
            if exists is not None:
                catalogue_ids = {inherited_id}

    return _resolve_model_input(doc, dataset_doc, catalogue_ids)


def _doc_to_response(
    doc: dict,
    *,
    effective: tuple[str | None, ModelInputState] | None = None,
) -> JobResponse:
    effective_id, effective_state = effective if effective is not None else (None, None)
    return JobResponse(
        id=doc["_id"],
        sim_id=doc.get("sim_id", ""),
        user_id=doc["user_id"],
        dataset_id=doc["dataset_id"],
        dataset_title=doc["dataset_title"],
        slug=doc.get("slug"),
        about=doc.get("about"),
        model_input_id=doc.get("model_input_id"),
        effective_model_input_id=effective_id,
        effective_model_input_state=effective_state,
        slurm_job_id=doc.get("slurm_job_id"),
        slurm_job_name=doc.get("slurm_job_name", ""),
        status=doc["status"],
        status_reason=doc.get("status_reason"),
        parameters=doc["parameters"],
        slurm_config=doc["slurm_config"],
        created_at=doc["created_at"],
        submitted_at=doc.get("submitted_at"),
        started_at=real_time(doc.get("started_at")),
        completed_at=real_time(doc.get("completed_at")),
        updated_at=doc.get("updated_at"),
        output_s3_key=doc.get("output_s3_key"),
        toolkit=doc.get("toolkit"),
        work_dir=doc.get("work_dir"),
        remote_job_dir=doc.get("remote_job_dir"),
        last_submit_error=doc.get("last_submit_error"),
        publish=doc.get("publish"),
        **verdict_fields(doc),
    )


def _status_response(doc: dict, live: dict | None = None) -> JobStatusResponse:
    """What the polling endpoint and the cancel route answer with. `live` is
    the SLURM-derived part, which only the polling endpoint gives."""
    return JobStatusResponse(
        job_id=doc["_id"],
        sim_id=doc.get("sim_id"),
        status=doc["status"],
        slurm_job_id=doc.get("slurm_job_id"),
        submitted_at=doc.get("submitted_at"),
        started_at=real_time(doc.get("started_at")),
        completed_at=real_time(doc.get("completed_at")),
        status_reason=doc.get("status_reason"),
        work_dir=doc.get("work_dir"),
        live=live,
        publish=doc.get("publish"),
        **verdict_fields(doc),
    )


def _is_owner(doc: dict, user: TokenPayload) -> bool:
    """Pure ownership check against an already-fetched document."""
    return doc["user_id"] == user.sub


def _can_access_job(
    doc: dict, user: TokenPayload, escalated: Permission | None
) -> bool:
    """Whether `user` may act on `doc`: its owner, or a holder of
    `escalated` (None: the owner alone). Pure — a dict standing in for a Mongo document, a
    TokenPayload standing in for the authenticated caller — so the second-
    user isolation guarantee (spec.md's acceptance criteria) is testable
    without Mongo or a request (tests/test_jobs_drafts.py)."""
    return _is_owner(doc, user) or (escalated is not None and can(user, escalated))


async def _get_job_for(
    job_id: str, user: TokenPayload, escalated: Permission | None
) -> dict:
    """Fetch a job the caller may act on: its owner, or a holder of `escalated`.

    The one door every by-id job route goes through. A job that exists but
    that the caller may not act on is a 404, identical to a missing one
    (ADR 0024): a 403 would confirm to a stranger that the id exists.

    The permission passed in matches the verb being performed (JOB_VIEW_ANY
    for read paths, JOB_CANCEL_ANY for cancel) rather than a single "is this
    an admin" check, so viewing and cancelling can be granted independently.
    Pass None for a verb with no "any" permission (edit, delete): the owner
    alone may perform it.
    """
    db = get_db()
    doc = await db.jobs.find_one({"_id": job_id})
    if doc is None or not _can_access_job(doc, user, escalated):
        raise HTTPException(status_code=404, detail="Job not found")
    return doc


def _is_editable(doc: dict) -> bool:
    """A snapshot draft may only be created, edited or deleted through the
    draft routes while it is still a draft (spec.md: "becomes read-only the
    moment it is submitted"). Pure — no Mongo, no request — so the refusal
    rule is testable directly (tests/test_jobs_drafts.py)."""
    return doc["status"] == "DRAFT"


def _new_draft_document(
    *,
    job_id: str,
    dataset_id: str,
    dataset_title: str,
    parameters: JobParameters,
    slug: str | None,
    user: TokenPayload,
    now: datetime,
    model_input_id: str | None = None,
    about: dict | None = None,
    slurm_config: SlurmConfig | None = None,
) -> dict:
    """Build a fresh draft's Mongo document. Pure — no Mongo, no request —
    so the property that matters is directly testable: `sim_id` is a real
    simulation id only once a draft is actually submitted (`submit_job`
    mints one via `_generate_sim_id`), so a draft has to omit the field
    entirely rather than default it to `""`. `db.jobs`'s `sim_id` index is
    `unique=True, sparse=True` — sparse only excludes documents where the
    field is *missing*, not merely falsy or null, so `sim_id: ""` (or even
    `sim_id: None`) on every draft would collide with the first draft ever
    created and 500 on the second (found in review of this commit)."""
    return {
        "_id": job_id,
        "user_id": user.sub,
        "user_email": user.email,
        "dataset_id": dataset_id,
        "dataset_title": dataset_title,
        "slug": slug,
        "about": about,
        "model_input_id": model_input_id,
        "slurm_job_id": None,
        "slurm_job_name": "",
        "status": "DRAFT",
        "status_reason": None,
        "parameters": parameters.model_dump(),
        "slurm_config": (slurm_config or SlurmConfig()).model_dump(),
        "internal_job_id": None,
        "remote_job_dir": None,
        "remote_script_path": None,
        "stdout_path": None,
        "stderr_path": None,
        "slurmly_submitted_at": None,
        "output_s3_key": None,
        "created_at": now,
        "submitted_at": None,
        "started_at": None,
        "completed_at": None,
        "updated_at": now,
    }


def _duplicate_document(
    source: dict,
    *,
    job_id: str,
    user: TokenPayload,
    now: datetime,
    dataset_title: str,
) -> dict:
    """A new draft that starts with `source`'s settings. Pure. It is built by
    `_new_draft_document` from an explicit list of what a copy takes (the
    snapshot, slug, about, model input, parameters, compute), never from the
    source's own document: every SLURM, verdict, cancel and files field, `sim_id`
    (the sparse unique index would refuse a second one) and `orphan_sim_ids` (the
    sweep runs scancel on them) belong to the simulation that was, and a field added to a
    job later is left out of a copy until someone decides it belongs in one.
    `dataset_title` is read from the snapshot again by the caller, not copied."""
    about = copy.deepcopy(source.get("about"))
    if about and about.get("name"):
        about["name"] = f"{about['name']} (copy)"
    return _new_draft_document(
        job_id=job_id,
        dataset_id=source["dataset_id"],
        dataset_title=dataset_title,
        parameters=JobParameters.model_validate(source["parameters"]),
        slug=source.get("slug"),
        user=user,
        now=now,
        # No model input: a copy inherits the snapshot's own, whatever the
        # source overrode (choosing another is hidden, user decision 2026-10-06).
        about=about,
        slurm_config=SlurmConfig(**(source.get("slurm_config") or {})),
    )


def _derive_simulation_parameters(dataset_doc: dict) -> JobParameters:
    """Build a new snapshot draft's parameters from a published catalogue entry
    (T4): the temporal coverage and output variables it was run with become
    the starting point a user overrides, rather than a blank form. Pure —
    takes a plain dict, returns a new model, touches no Mongo — the source
    document is read here and nowhere written back to. Submit compares the
    draft against the same derivation (`job_script.run_overrides`)."""
    return job_script.snapshot_defaults(dataset_doc)


def _job_scope_query(user: TokenPayload, user_id: str | None) -> dict:
    """Build the Mongo user-scope filter for a job list/stats query.

    Defaults to the caller's own jobs even for staff/admin — an operator's
    dashboard doesn't silently turn into a site-wide firehose. Passing
    user_id="*" (or another user's id) requires JOB_VIEW_ANY.
    """
    if user_id is None or user_id == user.sub:
        return {"user_id": user.sub}
    if not can(user, Permission.JOB_VIEW_ANY):
        raise HTTPException(
            status_code=403, detail="Requires permission: job:view:any"
        )
    return {} if user_id == "*" else {"user_id": user_id}


# ---------------------------------------------------------------------------
# POST /jobs/derive/{dataset_id}  —  New snapshot draft from a snapshot
# ---------------------------------------------------------------------------
#
# One of the two ways a snapshot draft is created (the other is the duplicate
# route below; spec.md, "Out of scope": starting one from scratch needs a
# model-input catalogue the gateway does not have yet). It is created as a
# draft — no Slurm submission happens here — inheriting its dataset, title and
# parameters from the published catalogue entry named in the path. `datasets`
# is only ever read by this route, never written to: the source snapshot is
# untouched by deriving from it.


async def _derived_draft(
    dataset_id: str,
    slug: str | None,
    model_input_id: str | None,
    user: TokenPayload,
    *,
    job_id: str,
) -> dict:
    """The draft document that deriving from `dataset_id` creates. Reads the
    snapshot, writes nothing: the POST route inserts the result, the GET route
    only shows it, and both build it here so a default cannot drift between
    the preview and what is stored."""
    db = get_db()
    # Envelope shape (mission 2026-09-23-catalogue-envelope) — unwrap to the
    # spec document.
    dataset_envelope = await db.datasets.find_one({"_id": dataset_id})
    if dataset_envelope is None:
        raise HTTPException(
            status_code=404, detail=f"Dataset '{dataset_id}' not found"
        )
    dataset_doc = dataset_envelope["document"]

    return _new_draft_document(
        job_id=job_id,
        dataset_id=dataset_id,
        dataset_title=dataset_doc.get("about", {}).get("name", dataset_id),
        parameters=_derive_simulation_parameters(dataset_doc),
        slug=slug,
        user=user,
        now=datetime.now(timezone.utc),
        model_input_id=model_input_id,
    )


@router.post(
    "/derive/{dataset_id}",
    response_model=JobResponse,
    status_code=status.HTTP_201_CREATED,
)
async def derive_simulation(
    dataset_id: str,
    body: SimulationDeriveRequest = SimulationDeriveRequest(),
    user: TokenPayload = Depends(require_active_user),
):
    # Choosing a model input other than the snapshot's own is hidden for now
    # (user decision 2026-10-06); the field stays so existing drafts still read.
    if body.model_input_id is not None:
        raise _model_input_choice_unavailable()
    db = get_db()
    job_id = str(uuid.uuid4())
    doc = await _derived_draft(
        dataset_id, body.slug, body.model_input_id, user, job_id=job_id
    )
    await db.jobs.insert_one(doc)

    await log_event(
        "simulation_derived",
        actor_id=user.sub,
        actor_email=user.email,
        target_id=job_id,
        category=AuditCategory.JOB,
        detail={"dataset_id": dataset_id},
    )

    effective = await _resolve_effective_model_input(doc)
    return _doc_to_response(doc, effective=effective)


# GET /jobs/derive/{dataset_id} previews what the POST above would store, for
# the new-snapshot-draft screen that shows a snapshot draft until the user saves it.
# Nothing is written and nothing is audited. `id` is "" (JobResponse.id is a
# plain str): there is no job to point at. Declared before `GET /{job_id}` so
# "derive" is never read as a job id (that route has one path segment, this one
# has two, so they cannot collide today; the test pins it).


@router.get("/derive/{dataset_id}", response_model=JobResponse)
async def preview_derived_simulation(
    dataset_id: str,
    user: TokenPayload = Depends(require_active_user),
):
    doc = await _derived_draft(dataset_id, None, None, user, job_id="")
    effective = await _resolve_effective_model_input(doc)
    return _doc_to_response(doc, effective=effective)


# ---------------------------------------------------------------------------
# POST /jobs/{job_id}/duplicate  —  New draft from a snapshot draft of one's own
# ---------------------------------------------------------------------------
#
# The second creation path: a new draft that starts from the settings of one of
# the caller's own snapshot drafts, whatever its status. Owner only, like edit and
# delete; the copy is the caller's, and the source is read, never written.


@router.post(
    "/{job_id}/duplicate",
    response_model=JobResponse,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_simulation(
    job_id: str,
    user: TokenPayload = Depends(require_active_user),
):
    db = get_db()
    source = await _get_job_for(job_id, user, None)
    envelope = await db.datasets.find_one({"_id": source["dataset_id"]})
    if envelope is None:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "snapshot_not_found",
            "The model snapshot this snapshot draft is based on is no longer in the "
            "repository, so it can't be copied.",
        )

    now = datetime.now(timezone.utc)
    new_id = str(uuid.uuid4())
    doc = _duplicate_document(
        source,
        job_id=new_id,
        user=user,
        now=now,
        dataset_title=envelope["document"].get("about", {}).get("name", source["dataset_id"]),
    )
    await db.jobs.insert_one(doc)

    await log_event(
        "simulation_duplicated",
        actor_id=user.sub,
        actor_email=user.email,
        target_id=new_id,
        category=AuditCategory.JOB,
        detail={"source_id": job_id, "dataset_id": source["dataset_id"]},
    )

    effective = await _resolve_effective_model_input(doc)
    return _doc_to_response(doc, effective=effective)


# ---------------------------------------------------------------------------
# PATCH /jobs/{job_id}  —  Edit while draft
# ---------------------------------------------------------------------------


@router.patch("/{job_id}", response_model=JobResponse)
async def update_simulation(
    job_id: str,
    body: SimulationUpdateRequest,
    user: TokenPayload = Depends(require_permission(Permission.JOB_EDIT_OWN)),
):
    db = get_db()
    # No "any" edit permission: mutating someone else's private, unpublished
    # snapshot draft is out of scope (see app.core.roles), so the owner alone
    # passes — and everyone else, JOB_VIEW_ANY holders included, gets the
    # same 404 as for a missing id.
    doc = await _get_job_for(job_id, user, None)
    if not _is_editable(doc):
        raise _not_a_draft(doc["status"])

    changes = body.model_dump(exclude_unset=True, mode="json")
    # Setting an override is hidden for now (user decision 2026-10-06); `null`
    # (revert to the snapshot's own) stays, so a draft that has one can lose it.
    if changes.get("model_input_id") is not None:
        raise _model_input_choice_unavailable()
    if not changes:
        effective = await _resolve_effective_model_input(doc)
        return _doc_to_response(doc, effective=effective)

    if "about" in changes and changes["about"] is not None:
        # Key by key: what the client sends replaces those keys and no others,
        # so a client that edits only `name` leaves `creator` and `keywords`
        # as they were. `PartialAbout` makes every key nullable, and the dump
        # below drops nulls, so a stored `about` never holds one; a null key in
        # the request therefore means "remove this key" and nothing else.
        # `about: null` (the whole block) is not merged and clears it.
        merged = {**(doc.get("about") or {}), **changes["about"]}
        merged = {key: value for key, value in merged.items() if value is not None}
        try:
            validated = PartialAbout.model_validate(merged)
        except ValidationError as exc:
            raise _error(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "invalid_about",
                f"The about block is not valid once merged: {exc.errors()[0]['msg']}",
            )
        changes["about"] = validated.model_dump(exclude_none=True, mode="json") or None

    if "parameters" in changes:
        # Only a start that changes is checked: a draft whose stored start the
        # rule now refuses (saved before the rule, or the snapshot's own) can
        # still have its end date or variables edited. Submit checks every start.
        start = changes["parameters"]["temporal_range_start"]
        stored_start = (doc.get("parameters") or {}).get("temporal_range_start")
        envelope = await db.datasets.find_one({"_id": doc["dataset_id"]})
        if envelope is not None and start != stored_start:
            await _refuse_unaligned_start(doc["dataset_id"], envelope["document"], start)

    if "slurm_config" in changes:
        # Only the fields the client sent change; `null` goes back to the
        # snapshot's recommended compute.
        sent = changes["slurm_config"]
        stored = doc.get("slurm_config") or {}
        changes["slurm_config"] = SlurmConfig(
            **({} if sent is None else {**stored, **sent})
        ).model_dump()

    changes["updated_at"] = datetime.now(timezone.utc)
    # The status is part of the filter: a submit or a delete between the read
    # above and here must not have an edit written under it.
    written = await db.jobs.update_one({"_id": job_id, "status": "DRAFT"}, {"$set": changes})
    updated = await db.jobs.find_one({"_id": job_id})
    if written.matched_count == 0:
        if updated is None:
            raise HTTPException(status_code=404, detail="Job not found")
        raise _not_a_draft(updated["status"])
    effective = await _resolve_effective_model_input(updated)
    return _doc_to_response(updated, effective=effective)


# ---------------------------------------------------------------------------
# POST /jobs/{job_id}/submit  —  Run a draft on Anvil
# ---------------------------------------------------------------------------
#
# The one way a snapshot draft reaches SLURM (ADR 0025): the owner's DRAFT becomes
# a slurmly batch job whose body fetches the snapshot and runs `openghm sim
# run`. The draft is claimed first with a conditional update, so two submits
# cannot both pass; if Anvil then refuses or cannot be reached, it is handed
# back as a DRAFT with `last_submit_error`, never left in a state SLURM does
# not know about.


def _error(http_status: int, code: str, message: str, **extra) -> HTTPException:
    """An HTTPException whose `detail` is `{"code", "message", **extra}`, the
    same shape `app.core.authz` refuses with."""
    return HTTPException(
        status_code=http_status, detail={"code": code, "message": message, **extra}
    )


def _model_input_choice_unavailable() -> HTTPException:
    return _error(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "model_input_choice_unavailable",
        "Choosing a model input other than the snapshot's own is not available yet.",
    )


def _not_a_draft(current: str) -> HTTPException:
    return _error(
        status.HTTP_409_CONFLICT,
        "not_a_draft",
        f"Only a snapshot draft that is still being edited can be changed; this one is {current}.",
    )


async def _refuse_unaligned_start(dataset_id: str, snapshot: dict, start: str) -> None:
    """422 when the snapshot's model cannot start a simulation on `start` (WBM writes a
    simulation's first step into band 1 of an output file, so a start must be the first
    day of one). Answered here, before the queue, instead of by the toolkit once
    the job runs; the toolkit's own check stays as the last line. A rule that
    cannot be read blocks nothing."""
    alignment = await run_start.run_start_alignment(snapshot, dataset_id)
    temporal = (snapshot.get("simulation") or {}).get("temporalCoverage") or {}
    violation = run_start.check_run_start(
        alignment,
        start,
        snapshot_start=temporal.get("start"),
        snapshot_end=temporal.get("end"),
    )
    if violation is not None:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "run_start_not_aligned",
            violation.message,
            suggested_start=violation.suggested_start,
        )


async def _refuse_dates_outside_aggregation(
    dataset_id: str, snapshot: dict, start: str, end: str
) -> None:
    """422 when the run dates contradict the snapshot's multi-year aggregation
    window, which WBM would only say once the job runs ("Aggregation multi-year
    start is outside of the run dates"). Only a submit refuses: an edit saves
    whatever the person is part-way through typing, and the wizard says it on
    the field. A window that cannot be read blocks nothing."""
    rules = await run_start.read_init_rules(snapshot, dataset_id)
    if rules is None:
        return
    temporal = (snapshot.get("simulation") or {}).get("temporalCoverage") or {}
    violation = run_start.check_run_dates(
        rules.aggregation_start_year,
        start,
        end,
        snapshot_start=temporal.get("start"),
        snapshot_end=temporal.get("end"),
    )
    if violation is not None:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "run_dates_outside_aggregation",
            violation.message,
            fields=list(violation.fields),
            aggregation_start_year=violation.aggregation_start_year,
            latest_start=violation.latest_start,
            earliest_end=violation.earliest_end,
        )


_ANVIL_NOT_CONFIGURED = (
    "This gateway is not set up to run simulations on Anvil yet. "
    "Ask an administrator. Your draft is unchanged."
)
_SUBMIT_UNEXPECTED = (
    "The submit failed unexpectedly, so anything it started on Anvil was cancelled. "
    "Your draft is unchanged. Try again, and if it keeps failing, tell an administrator."
)
_ANVIL_UNREACHABLE = (
    "Anvil could not be reached, so nothing was submitted. "
    "Your draft is unchanged. Try again in a few minutes."
)


def _sbatch_refusal_message(exc: Exception, unchanged: str = "Your draft is unchanged.") -> str:
    detail = also = ""
    if isinstance(exc, SbatchError):
        detail = (exc.stderr or exc.stdout or "").strip()
        also = f"{exc.stderr}\n{exc.stdout}"
    return f"{sbatch_refusal.sentence(sbatch_refusal.explain(detail or str(exc), also))} {unchanged}"


async def _record_refusal(job_id: str, user_id: str, exc: HTTPException) -> None:
    """Keep a submit's refusal as the draft's `last_submit_error`, replacing
    whatever an earlier try left there: the person who reopens the draft is told
    why the last submit did not go, never why an older one did not. A refusal
    that is not a `{code, message}` (a bare 404) says nothing to keep. Never
    raises: a failed write must not change the answer to the submit."""
    detail = exc.detail
    if not isinstance(detail, dict) or "code" not in detail or "message" not in detail:
        return
    try:
        await get_db().jobs.update_one(
            {"_id": job_id, "user_id": user_id, "status": "DRAFT"},
            {
                "$set": {
                    "last_submit_error": {
                        "code": detail["code"],
                        "message": detail["message"],
                        "at": datetime.now(timezone.utc),
                    }
                }
            },
        )
    except Exception as err:
        logger.warning("Could not record the refusal of the submit of %s: %s", job_id, err)


@contextlib.asynccontextmanager
async def _refusals_kept(job_id: str, user_id: str):
    """Whatever refuses inside is also written to the draft (`_record_refusal`)."""
    try:
        yield
    except HTTPException as exc:
        await _record_refusal(job_id, user_id, exc)
        raise


async def _submitter(job_id: str, user: CurrentUser) -> TokenPayload:
    """`require_submitter`, which also keeps its refusal (an account not
    allowed to run, the active-job limit) on the draft the submit was for."""
    try:
        return await require_submitter(user)
    except HTTPException as exc:
        await _record_refusal(job_id, user.sub, exc)
        raise


@router.post(
    "/{job_id}/submit",
    response_model=JobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_simulation(
    job_id: str,
    body: SubmitRequest | None = None,
    user: TokenPayload = Depends(_submitter),
):
    db = get_db()
    # Owner only, like edit and delete: no "any" permission submits someone
    # else's draft, and everyone else gets the 404 a missing id gets.
    doc = await _get_job_for(job_id, user, None)
    if not _is_editable(doc):
        raise _error(
            status.HTTP_409_CONFLICT,
            "not_a_draft",
            f"Only a snapshot draft that is still being edited can be submitted; this one is {doc['status']}.",
        )

    # Every refusal below is kept on the draft as `last_submit_error`, so a
    # reopened draft never shows the reason of an earlier try.
    async with _refusals_kept(job_id, user.sub):
        envelope = await db.datasets.find_one({"_id": doc["dataset_id"]})
        if envelope is None:
            raise _error(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "snapshot_not_found",
                "The snapshot this snapshot draft is based on is no longer in the repository.",
            )
        snapshot = envelope["document"]
        job = JobDB(**doc)
        rerun = body is not None and body.rerun

        # A draft the snapshot's published output already answers is not queued
        # (ADR 0029) unless the person asks for a rerun. Before the Anvil check, so
        # it answers the same with or without Anvil. A bucket that cannot be listed
        # blocks nothing, like the run-date checks below: the answer is unknown, and
        # an unchecked submit is a rerun the person can still make on purpose.
        if not rerun:
            try:
                answered = await published_answer.answer(
                    job.dataset_id, snapshot, job.parameters, job.model_input_id
                )
            except (published_answer.InvalidPeriod, published_answer.ListingUnavailable):
                answered = None  # the checks below say what is wrong with the dates
            if answered is not None and answered.answered:
                raise _error(
                    status.HTTP_409_CONFLICT,
                    "answered_by_published",
                    "This snapshot's published results already answer this snapshot draft, "
                    "so nothing was queued. Open the published files, or ask for a "
                    "rerun to check that the snapshot reproduces itself (it uses "
                    "allocation).",
                )

        if not slurm.toolkit_configured():
            raise _error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "anvil_not_configured",
                _ANVIL_NOT_CONFIGURED,
            )

        fields = job_script.unsupported_fields(job.parameters, job.model_input_id, snapshot)
        if fields:
            raise _error(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "unsupported_fields",
                "These settings cannot run yet, because the toolkit has no option for "
                f"them: {', '.join(fields)}. Reset them to the snapshot's own values "
                "and submit again.",
                fields=fields,
            )

        over = job_script.walltime_over_limit(job.slurm_config, snapshot)
        if over is not None:
            raise _error(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "walltime_over_limit",
                "This model snapshot's reference simulation took about "
                f"{job_script.describe_hours(over)}, and one job may use at most "
                f"{MAX_WALLTIME_SECONDS // 3600} h. Shorten the run period, or set a "
                "walltime yourself (a simulation that needs longer may be stopped when time "
                "runs out).",
                recommended_seconds=over,
                limit_seconds=MAX_WALLTIME_SECONDS,
            )

        await _refuse_unaligned_start(
            job.dataset_id, snapshot, job.parameters.temporal_range_start
        )
        await _refuse_dates_outside_aggregation(
            job.dataset_id,
            snapshot,
            job.parameters.temporal_range_start,
            job.parameters.temporal_range_end,
        )

        now = datetime.now(timezone.utc)
        sim_id = _generate_sim_id(now)
        home = settings.ANVIL_OPENGHM_HOME.rstrip("/")
        work_dir = posixpath.join(settings.ANVIL_OUTPUT_BASE, sim_id)
        try:
            overrides = job_script.run_overrides(job.parameters, snapshot)
            # What sbatch is asked for (`--time`), told to the toolkit too so the
            # spool lease lasts as long as the job can.
            _, walltime = slurm.resolve_compute(job.slurm_config, snapshot)
            body = job_script.render_job_body(
                snapshot_id=job.dataset_id,
                sim_id=sim_id,
                openghm_home=home,
                cache_dir=settings.ANVIL_CACHE_DIR,
                fetch_lock=settings.ANVIL_FETCH_LOCK,
                work_dir=work_dir,
                run_start=overrides.run_start,
                run_end=overrides.run_end,
                output_vars=overrides.output_vars,
                walltime=walltime,
            )
            toolkit = {"home": home, "commit": job_script.toolkit_commit(home)}
        except job_script.SubmitInputError as exc:
            raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_parameters", str(exc))

    # The claim. `updated_at` is part of the filter so that a PATCH landing
    # between the read above and here is not submitted half-rendered.
    claimed = await db.jobs.update_one(
        {"_id": job_id, "status": "DRAFT", "updated_at": doc["updated_at"]},
        {
            "$set": {
                "status": "SUBMITTED",
                "sim_id": sim_id,
                "slurm_job_name": sim_id,
                "toolkit": toolkit,
                "work_dir": work_dir,
                "status_reason": None,
                "updated_at": now,
            },
            "$unset": {"last_submit_error": ""},
        },
    )
    if claimed.matched_count == 0:
        raise _error(
            status.HTTP_409_CONFLICT,
            "not_a_draft",
            "This snapshot draft was changed or already submitted. Reload it and try again.",
        )
    job = JobDB(**(await db.jobs.find_one({"_id": job_id})))

    try:
        submitted = await slurm.submit_job(job, snapshot, body)
    except Exception as exc:
        maybe_sent = False
        if isinstance(exc, slurm.AnvilNotConfigured):
            http_status, code, message = (
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "anvil_not_configured",
                _ANVIL_NOT_CONFIGURED,
            )
        elif isinstance(exc, (SbatchError, InvalidJobSpec)):
            http_status, code, message = (
                status.HTTP_502_BAD_GATEWAY,
                "sbatch_rejected",
                _sbatch_refusal_message(exc),
            )
            if isinstance(exc, SbatchError):
                # slurmly made its job directory before sbatch said no, and
                # keeps no record of it: nothing else will ever remove it.
                await slurm.remove_failed_submit_dirs(sim_id)
        elif isinstance(exc, job_script.SubmitInputError):
            http_status, code, message = (
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "invalid_parameters",
                str(exc),
            )
        elif isinstance(exc, (SlurmlyError, OSError, asyncio.TimeoutError)):
            # Includes SbatchParseError: sbatch ran but its answer was lost,
            # so a job may exist that this gateway never learned the id of.
            http_status, code, message = (
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "anvil_unreachable",
                _ANVIL_UNREACHABLE,
            )
            maybe_sent = True
        else:
            # Anything else may have been raised after sbatch ran (parsing its
            # answer, building the record), so a job may exist: it is treated
            # like a lost answer, scancelled by name or kept for the sweep.
            logger.exception("Job %s submit failed unexpectedly", job_id)
            http_status, code, message = (
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "internal_error",
                _SUBMIT_UNEXPECTED,
            )
            maybe_sent = True
        logger.error("Job %s submit failed (%s): %s", job_id, code, exc)
        # The user is told nothing was submitted, so a job that was must go.
        # If scancel cannot run either, the sim_id stays on the draft and the
        # sweep retries it (ADR 0026).
        orphan = sim_id if maybe_sent and not await _scancel_attempt(sim_id) else None
        await _return_to_draft(job_id, code, message, orphan_sim_id=orphan)
        raise _error(http_status, code, message)

    done = datetime.now(timezone.utc)
    try:
        recorded = await db.jobs.update_one(
            {"_id": job_id, "status": "SUBMITTED"},
            {
                "$set": {
                    "slurm_job_id": submitted.slurm_job_id,
                    "internal_job_id": submitted.internal_job_id,
                    "remote_job_dir": submitted.remote_job_dir,
                    "remote_script_path": submitted.remote_script_path,
                    "stdout_path": submitted.stdout_path,
                    "stderr_path": submitted.stderr_path,
                    "slurmly_submitted_at": submitted.submitted_at,
                    "submitted_at": done,
                    "updated_at": done,
                }
            },
        )
    except Exception:
        # SLURM has the job and the gateway could not write its id. Nothing
        # tracks it, so it is cancelled now and the draft handed back; if the
        # database is down, the sweep does the same once it is up again
        # (`slurm.reconcile_interrupted_submits`).
        logger.exception("Job %s: sbatch took %s but its id was not recorded", job_id, submitted.slurm_job_id)
        await _abandon_submit(job_id, sim_id)
        raise
    if recorded.matched_count == 0:
        # Cancelled in the moments between the claim and SLURM's answer: the
        # job exists on Anvil but the user already said no to it.
        logger.warning("Job %s left SUBMITTED during submit; cancelling %s", job_id, submitted.slurm_job_id)
        try:
            await slurm.cancel_job(submitted.slurm_job_id)
        except Exception as exc:
            logger.error("scancel of orphaned %s failed: %s", submitted.slurm_job_id, exc)
            # Keep the name so the sweep retries it by name.
            await db.jobs.update_one({"_id": job_id}, {"$addToSet": {"orphan_sim_ids": sim_id}})
        # Keep where its files are, so a delete can remove them.
        await db.jobs.update_one(
            {"_id": job_id, "status": "CANCELLED"},
            {
                "$set": {
                    "slurm_job_id": submitted.slurm_job_id,
                    "internal_job_id": submitted.internal_job_id,
                    "remote_job_dir": submitted.remote_job_dir,
                    "remote_script_path": submitted.remote_script_path,
                    "stdout_path": submitted.stdout_path,
                    "stderr_path": submitted.stderr_path,
                    "slurmly_submitted_at": submitted.submitted_at,
                }
            },
        )

    await log_event(
        "job_submitted",
        actor_id=user.sub,
        actor_email=user.email,
        target_id=job_id,
        category=AuditCategory.JOB,
        detail={
            "sim_id": sim_id,
            "dataset_id": job.dataset_id,
            "slurm_job_id": submitted.slurm_job_id,
            "status": "SUBMITTED",
            **({"rerun": True} if rerun else {}),
        },
    )

    updated = await db.jobs.find_one({"_id": job_id})
    effective = await _resolve_effective_model_input(updated)
    return _doc_to_response(updated, effective=effective)


async def _scancel_attempt(sim_id: str) -> bool:
    """`scancel --name=<sim_id>` for a submit whose answer was lost. Whether
    it ran; a failure is logged and never changes the answer to the user."""
    try:
        return await slurm.scancel_by_name(sim_id)
    except Exception as exc:
        logger.error("scancel --name=%s failed: %s", sim_id, exc)
        return False


async def _return_to_draft(
    job_id: str, code: str, message: str, *, orphan_sim_id: str | None = None
) -> None:
    """`slurm.return_to_draft` for a submit the route is ending. The orphan is
    recorded even when a cancel has moved the job off SUBMITTED meanwhile."""
    await slurm.return_to_draft(job_id, code, message, orphan_sim_id=orphan_sim_id)


async def _abandon_submit(job_id: str, sim_id: str) -> None:
    """Best effort after the submit lost its footing: scancel the attempt by
    name, give the draft back (keeping the name when scancel could not run).
    Anything that fails here is logged; the sweep reconciles what is left."""
    try:
        orphan = None if await _scancel_attempt(sim_id) else sim_id
        await _return_to_draft(job_id, "submit_interrupted", slurm.SUBMIT_INTERRUPTED, orphan_sim_id=orphan)
    except Exception as exc:
        logger.error("Could not give back the draft %s of an interrupted submit: %s", job_id, exc)


# ---------------------------------------------------------------------------
# POST /jobs/{job_id}/publish  —  Publish a completed draft as a snapshot
# ---------------------------------------------------------------------------
#
# ADR 0031. The draft's owner (or an admin) of a draft whose simulation
# succeeded gives the snapshot's `about`; the gateway mints its id, composes and
# checks its `metadata.json` (`publish.compose_metadata`), claims the draft with
# one conditional update, writes the document to Anvil and sbatches a job that runs
# `openghm snapshot publish`. Nothing is awaited but the submit: the sweep
# (`slurm.sync_publishes`) reaches the verdict and registers the snapshot in the
# catalogue. Everything that refuses does so before the claim and changes nothing
# (409 `not_publishable`, 422 `invalid_about`, 503 `anvil_not_configured`); once
# claimed, a submit that fails ends the publish `failed` with `retry: "same"`, and
# the id it minted stays.

_PUBLISH_NOT_CONFIGURED = (
    "This gateway is not set up to run jobs on Anvil yet. Ask an administrator. "
    "Nothing was published."
)


def _not_publishable(reason: str) -> HTTPException:
    return _error(
        status.HTTP_409_CONFLICT, "not_publishable", publish.REFUSAL_MESSAGE[reason], reason=reason
    )


def _invalid_about(errors: list[dict[str, str]]) -> HTTPException:
    first = errors[0]
    return _error(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "invalid_about",
        f"This snapshot's description is not valid ({first['field']}: {first['message']}). "
        "Nothing was published.",
        errors=errors,
    )


def _publish_submit_failure(exc: Exception, job_id: str) -> tuple[int, publish.PublishFailure]:
    """The HTTP status and the stored failure for a submit of the publish job that
    raised, sorted as a run's submit sorts them: a refusal by SLURM is 502, a
    transport that failed is 503, anything else 500. Unlike a run's submit it
    cancels nothing, even when sbatch may have run: a second publish job under
    the same id is harmless, because the toolkit reads every key before it writes
    it (see `slurm.reconcile_interrupted_publishes`). It also removes no leftover
    job directory: the job's name is the same for every attempt, so a search for
    it would reach an earlier attempt's."""
    if isinstance(exc, slurm.AnvilNotConfigured):
        http_status, cause, message = status.HTTP_503_SERVICE_UNAVAILABLE, "anvil_not_configured", None
    elif isinstance(exc, (SbatchError, InvalidJobSpec)):
        http_status, cause = status.HTTP_502_BAD_GATEWAY, "sbatch_rejected"
        message = _sbatch_refusal_message(exc, "Nothing was uploaded.")
    elif isinstance(exc, (SlurmlyError, OSError, asyncio.TimeoutError)):
        http_status, cause, message = status.HTTP_503_SERVICE_UNAVAILABLE, "anvil_unreachable", None
    else:
        logger.exception("Job %s: publish submit failed unexpectedly", job_id)
        http_status, cause, message = status.HTTP_500_INTERNAL_SERVER_ERROR, "internal_error", None
    logger.error("Job %s: publish submit failed (%s): %s", job_id, cause, exc)
    return http_status, publish.failure(cause, "same", message)


@router.post(
    "/{job_id}/publish",
    response_model=JobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def publish_simulation(
    job_id: str,
    body: PublishRequest | None = None,
    user: TokenPayload = Depends(require_active_user),
):
    db = get_db()
    # The owner, or an admin (REPO_MANAGE: the permission that writes the
    # catalogue): everyone else gets the 404 a missing id gets.
    doc = await _get_job_for(job_id, user, Permission.REPO_MANAGE)
    reason = publish.publish_refusal(doc)
    if reason is not None:
        raise _not_publishable(reason)
    if not slurm.toolkit_configured():
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE, "anvil_not_configured", _PUBLISH_NOT_CONFIGURED
        )

    # A retry that says `same` publishes the stored document byte for byte: objects
    # of it may already be in the bucket. A first attempt, and a retry that says
    # `edit` (the toolkit refused the document before it wrote anything), compose
    # it again from the `about` in the body.
    record = doc.get("publish")
    reuse = record is not None and (record.get("failure") or {}).get("retry") != "edit"
    if reuse:
        snapshot_id, metadata = record["snapshot_id"], record["metadata"]
    else:
        snapshot_id = record["snapshot_id"] if record else publish.mint_snapshot_id()
        envelope = await db.datasets.find_one({"_id": doc["dataset_id"]})
        if envelope is None:
            raise _error(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "snapshot_not_found",
                "The snapshot this snapshot draft is based on is no longer in the repository, "
                "so what it was based on cannot be recorded. Nothing was published.",
            )
        about = body.about if body is not None else None
        if not isinstance(about, dict):
            raise _invalid_about(
                [{"field": "about", "message": "Field required" if about is None else "Input should be an object"}]
            )
        try:
            cores = slurm.resolve_compute(
                SlurmConfig(**(doc.get("slurm_config") or {})), envelope["document"]
            )[0]
        except job_script.SubmitInputError:
            cores = None
        try:
            metadata = publish.compose_metadata(
                base=envelope["document"],
                job=doc,
                about=about,
                snapshot_id=snapshot_id,
                now=datetime.now(timezone.utc),
                site_url=settings.PUBLIC_SITE_URL,
                cores=cores,
            )
        except publish.ComposeError as exc:
            raise _invalid_about(exc.errors)

    try:
        remote_dir, work_dir = slurm.removable_paths(doc)
    except slurm.RefusedPath as exc:
        logger.error("Job %s: refused to publish from %s", job_id, exc)
        raise _error(
            status.HTTP_409_CONFLICT,
            "refused_path",
            "This snapshot draft's files are not where the gateway expects them, so nothing "
            "was published. Ask an administrator.",
        )
    if doc.get("files") == "purged" or not remote_dir or not work_dir:
        raise _error(
            status.HTTP_409_CONFLICT,
            "run_files_missing",
            "This snapshot draft's simulation files are no longer on Anvil (it deletes them "
            "after 30 days), so there is nothing to publish.",
        )
    name = slurm.publish_job_name(snapshot_id)
    try:
        script = publish.render_publish_body(
            snapshot_id=snapshot_id,
            openghm_home=settings.ANVIL_OPENGHM_HOME,
            work_dir=work_dir,
            metadata_path=publish.metadata_path_of(remote_dir),
            s3cfg=settings.ANVIL_S3CFG,
        )
    except job_script.SubmitInputError as exc:
        logger.error("Job %s: the publish script cannot be rendered: %s", job_id, exc)
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE, "anvil_not_configured", _PUBLISH_NOT_CONFIGURED
        )

    # The claim: one conditional update, so a double click or a second tab cannot
    # publish twice. A first attempt claims a draft with no `publish`; a retry
    # claims the `failed` one it read, by its attempt number.
    now = datetime.now(timezone.utc)
    if record is None:
        claimed = await db.jobs.update_one(
            {"_id": job_id, "status": "COMPLETED", "publish": None},
            {
                "$set": {
                    "publish": {
                        "state": "publishing",
                        "snapshot_id": snapshot_id,
                        "metadata": metadata,
                        "attempts": 1,
                        "slurm_job_id": None,
                        "remote_job_dir": None,
                        "submitted_at": now,
                        "finished_at": None,
                        "failure": None,
                        "submitted_by": user.sub,
                    },
                    "updated_at": now,
                }
            },
        )
    else:
        claimed = await db.jobs.update_one(
            {
                "_id": job_id,
                "status": "COMPLETED",
                "publish.state": "failed",
                "publish.attempts": record["attempts"],
            },
            {
                "$set": {
                    "publish.state": "publishing",
                    "publish.metadata": metadata,
                    "publish.attempts": record["attempts"] + 1,
                    "publish.slurm_job_id": None,
                    "publish.remote_job_dir": None,
                    "publish.submitted_at": now,
                    "publish.finished_at": None,
                    "publish.failure": None,
                    "publish.submitted_by": user.sub,
                    "updated_at": now,
                }
            },
        )
    if claimed.matched_count == 0:
        fresh = await db.jobs.find_one({"_id": job_id})
        reason = publish.publish_refusal(fresh) if fresh else None
        if reason is not None:
            raise _not_publishable(reason)
        raise _error(
            status.HTTP_409_CONFLICT,
            "job_changed",
            "This snapshot draft changed while it was being published. Reload it and try again.",
        )
    claimed_doc = await db.jobs.find_one({"_id": job_id})

    try:
        submitted = await slurm.submit_publish(
            name,
            script,
            job_id=job_id,
            snapshot_id=snapshot_id,
            metadata_path=publish.metadata_path_of(remote_dir),
            metadata_text=publish.metadata_text(metadata),
        )
    except Exception as exc:
        http_status, failure = _publish_submit_failure(exc, job_id)
        await slurm.fail_publish(claimed_doc, failure, actor=user.sub, actor_email=user.email)
        raise _error(http_status, failure.cause, failure.message)

    try:
        await slurm.write_publish(
            claimed_doc,
            {
                "slurm_job_id": submitted.slurm_job_id,
                "remote_job_dir": submitted.remote_job_dir,
                "submitted_at": datetime.now(timezone.utc),
            },
        )
    except Exception:
        # SLURM has the job and the gateway could not write its id. The record stays
        # `publishing` with no SLURM id, and the sweep ends it as interrupted
        # (`slurm.reconcile_interrupted_publishes`). Nothing is scancelled: a retry
        # under the same id is harmless beside it.
        logger.exception(
            "Job %s: sbatch took %s for publish %s but its id was not recorded",
            job_id,
            submitted.slurm_job_id,
            snapshot_id,
        )
        raise

    await log_event(
        "job_publish_submitted",
        actor_id=user.sub,
        actor_email=user.email,
        target_id=job_id,
        category=AuditCategory.JOB,
        detail={
            "snapshot_id": snapshot_id,
            "attempt": claimed_doc["publish"]["attempts"],
            "slurm_job_id": submitted.slurm_job_id,
            "dataset_id": doc["dataset_id"],
            "metadata": "reused" if reuse else "composed",
        },
    )

    updated = await db.jobs.find_one({"_id": job_id})
    effective = await _resolve_effective_model_input(updated)
    return _doc_to_response(updated, effective=effective)


# ---------------------------------------------------------------------------
# DELETE /jobs/{job_id}  —  Delete a snapshot draft, edited or finished
# ---------------------------------------------------------------------------
#
# A draft has nothing on Anvil. A finished snapshot draft leaves two directories
# there (ADR 0026), and its owner's delete removes both before the document:
# a document that outlived its files could no longer say where they were.


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_simulation(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_DELETE_OWN)),
):
    db = get_db()
    doc = await _get_job_for(job_id, user, None)
    if (doc.get("publish") or {}).get("state") == "publishing":
        # Its job reads this draft's work directory and the sweep concludes it on
        # this document: neither may go. A published draft may be deleted: the
        # snapshot is its own artifact (ADR 0031).
        raise _error(
            status.HTTP_409_CONFLICT,
            "publish_in_progress",
            "This snapshot draft is being published as a snapshot. Wait until that has "
            "finished before deleting it.",
        )
    removed: list[str] = []
    if doc["status"] in TERMINAL_STATUSES:
        await _cancel_orphans_of(doc)
        removed = await _remove_files_of(doc)
    elif not _is_editable(doc):
        raise _error(
            status.HTTP_409_CONFLICT,
            "job_active",
            "Cancel the simulation before deleting this snapshot draft.",
        )
    else:
        await _cancel_orphans_of(doc)
    deleted = await db.jobs.delete_one(
        {"_id": job_id, "status": doc["status"], "publish.state": {"$ne": "publishing"}}
    )
    if deleted.deleted_count == 0:
        # A submit claimed the draft between the read and the delete, or
        # another request deleted it: nothing was deleted, so nothing is said to
        # have been.
        raise _error(
            status.HTTP_409_CONFLICT,
            "job_changed",
            "This snapshot draft changed while it was being deleted, so nothing was deleted. "
            "Reload it and try again.",
        )
    await log_event(
        "job_deleted",
        actor_id=user.sub,
        actor_email=user.email,
        target_id=job_id,
        category=AuditCategory.JOB,
        detail={"sim_id": doc.get("sim_id"), "status": doc["status"], "removed": removed},
    )


async def _cancel_orphans_of(doc: dict) -> None:
    """Before a job's document goes, cancel by name every submit of it that may
    have reached SLURM (`orphan_sim_ids`): the document is the only place those
    names are kept, so deleting it first would leave a job running that nothing
    knows of. If Anvil cannot be asked for any of them, nothing is deleted."""
    names = [n for n in doc.get("orphan_sim_ids") or [] if job_script.is_valid_id(n)]
    for sim_id in names:
        if not await _scancel_attempt(sim_id):
            raise _error(
                status.HTTP_409_CONFLICT,
                "orphan_cancel_failed",
                "An earlier submit of this snapshot draft may still be on Anvil, and Anvil could "
                "not be asked to cancel it, so nothing was deleted. Try again in a few minutes.",
            )
        await get_db().jobs.update_one({"_id": doc["_id"]}, {"$pull": {"orphan_sim_ids": sim_id}})


async def _remove_files_of(doc: dict) -> list[str]:
    """Remove a finished job's directories on Anvil, or say why they were not.
    Whatever goes wrong, the document stays."""
    if doc.get("files") == "purged" or not (doc.get("remote_job_dir") or doc.get("work_dir")):
        return []  # nothing recorded, or Anvil already removed it
    try:
        return await slurm.remove_job_files(doc)
    except slurm.RefusedPath as exc:
        logger.error("Job %s: refused to remove %s", doc["_id"], exc)
        raise _error(
            status.HTTP_409_CONFLICT,
            "refused_path",
            "This snapshot draft's files are not where the gateway expects them, so it "
            "removed nothing. Ask an administrator.",
        )
    except slurm.CleanupFailed as exc:
        logger.error("Job %s: could not remove its files: %s", doc["_id"], exc)
        raise _error(
            status.HTTP_502_BAD_GATEWAY,
            "cleanup_failed",
            "Anvil could not remove this snapshot draft's files, so it was not deleted. "
            "Try again.",
        )
    except (slurm.AnvilNotConfigured, SlurmlyError, OSError, asyncio.TimeoutError) as exc:
        logger.error("Job %s: Anvil unreachable while deleting: %s", doc["_id"], exc)
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "anvil_unreachable",
            "Anvil could not be reached, so nothing was deleted. Try again in a few minutes.",
        )


# ---------------------------------------------------------------------------
# GET /jobs  —  List user's jobs
# ---------------------------------------------------------------------------


@router.get("", response_model=JobListResponse)
async def list_jobs(
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    sort: Literal["updated", "created"] = Query(
        "updated",
        description="`updated`: last change first (`updated_at`, then `created_at`); "
        "`created`: newest first",
    ),
    user_id: str | None = Query(
        None, description='Owner filter; "*" = all users (requires job:view:any)'
    ),
):
    db = get_db()
    query: dict = _job_scope_query(user, user_id)
    if status_filter:
        upper = status_filter.upper()
        if upper == "ACTIVE":
            query["status"] = {"$in": ACTIVE_STATUSES}
        else:
            query["status"] = upper

    total_count = await db.jobs.count_documents(query)
    total_pages = max(1, math.ceil(total_count / page_size))
    skip = (page - 1) * page_size

    # `created_at` breaks ties (and orders a legacy document with no
    # `updated_at`), so a page boundary never reshuffles rows.
    order = (
        [("updated_at", -1), ("created_at", -1)]
        if sort == "updated"
        else [("created_at", -1)]
    )
    cursor = db.jobs.find(query).sort(order).skip(skip).limit(page_size)
    items = [_doc_to_response(doc) async for doc in cursor]

    return JobListResponse(
        items=items,
        total_count=total_count,
        page=page,
        total_pages=total_pages,
    )


# ---------------------------------------------------------------------------
# GET /jobs/stats  —  Aggregate counts (must be before /{job_id})
# ---------------------------------------------------------------------------


@router.get("/stats", response_model=JobStatsResponse)
async def get_job_stats(
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
    user_id: str | None = Query(
        None, description='Owner filter; "*" = all users (requires job:view:any)'
    ),
):
    db = get_db()
    pipeline = [
        {"$match": _job_scope_query(user, user_id)},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    results = await db.jobs.aggregate(pipeline).to_list(None)
    counts: dict[str, int] = {r["_id"]: r["count"] for r in results}
    total = sum(counts.values())
    running = sum(counts.get(s, 0) for s in ACTIVE_STATUSES)
    return JobStatsResponse(
        total=total,
        running=running,
        completed=counts.get("COMPLETED", 0),
        failed=counts.get("FAILED", 0),
        draft=counts.get("DRAFT", 0),
        cancelled=counts.get("CANCELLED", 0),
    )


# ---------------------------------------------------------------------------
# GET /jobs/{job_id}  —  Detail
# ---------------------------------------------------------------------------


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
):
    doc = await _get_job_for(job_id, user, Permission.JOB_VIEW_ANY)
    effective = await _resolve_effective_model_input(doc)
    return _doc_to_response(doc, effective=effective)


# ---------------------------------------------------------------------------
# GET /jobs/{job_id}/status  —  Polling endpoint
# ---------------------------------------------------------------------------


@router.get("/{job_id}/status", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
):
    doc = await _get_job_for(job_id, user, Permission.JOB_VIEW_ANY)

    # Refresh from Slurm if not terminal
    if doc["status"] not in TERMINAL_STATUSES:
        try:
            doc = await slurm.update_job_status(job_id)
        except Exception as exc:
            logger.warning("Status poll failed for %s: %s", job_id, exc)
            # Return stale data

    return _status_response(doc, live=await job_live.live_state(doc))


# ---------------------------------------------------------------------------
# POST /jobs/{job_id}/cancel
# ---------------------------------------------------------------------------


@router.post("/{job_id}/cancel", response_model=JobStatusResponse)
async def cancel_job(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_CANCEL_OWN)),
):
    """Cancel takes two steps (ADR 0026). A job SLURM has an id for records
    the request and runs `scancel`; its status changes only when the sweep
    sees SLURM report CANCELLED, so SLURM's own end is what is stored. A job
    still inside its submit has no id to cancel: it is CANCELLED at once, and
    the submit route cancels what SLURM answers."""
    db = get_db()
    doc = await _get_job_for(job_id, user, Permission.JOB_CANCEL_ANY)
    now = datetime.now(timezone.utc)

    if doc["status"] not in CANCELLABLE_STATUSES:
        raise _not_cancellable(doc["status"])

    immediate = False
    if not doc.get("slurm_job_id"):
        # `slurm_job_id: None` is in the filter: the submit may record its id
        # between the read above and this write, and then there is a job to
        # scancel after all. And one may exist already: sbatch may have run and
        # its answer not yet be recorded, so the name is kept, and the sweep
        # (`slurm.clear_orphans`, every few seconds while one is kept) scancels
        # it by name. The request itself makes no SSH call.
        update: dict = {
            "$set": {
                "status": "CANCELLED",
                "status_reason": _CANCELLED_FROM_OPENGHM,
                "failure": {
                    "cause": "cancelled_by_user",
                    "phase": None,
                    "message": _CANCELLED_FROM_OPENGHM,
                    "excerpt": None,
                },
                **_cancel_request(user, now),
                "completed_at": now,
                "updated_at": now,
            }
        }
        if job_script.is_valid_id(doc.get("sim_id")):
            update["$addToSet"] = {"orphan_sim_ids": doc["sim_id"]}
        immediate = (
            await db.jobs.update_one(
                {"_id": job_id, "status": doc["status"], "slurm_job_id": None}, update
            )
        ).matched_count == 1
        if not immediate:
            doc = await db.jobs.find_one({"_id": job_id})
            if doc is None or doc["status"] not in CANCELLABLE_STATUSES or not doc.get("slurm_job_id"):
                raise _job_changed()

    if not immediate:
        # Keep the first request's time and requester if one is pending; a
        # second click only asks scancel again (safe to repeat).
        fresh = doc.get("cancel_requested_at") is None
        if fresh:
            recorded = await db.jobs.update_one(
                {"_id": job_id, "status": doc["status"]},
                {"$set": {**_cancel_request(user, now), "updated_at": now}},
            )
            if recorded.matched_count == 0:
                raise _job_changed()
        try:
            await slurm.cancel_job(doc["slurm_job_id"])
        except Exception as exc:
            logger.error("scancel failed for %s: %s", job_id, exc)
            if fresh:
                await db.jobs.update_one(
                    {"_id": job_id},
                    {"$unset": {key: "" for key in _CANCEL_REQUEST_FIELDS}},
                )
            raise _error(
                status.HTTP_502_BAD_GATEWAY,
                "cancel_failed",
                "Anvil could not be asked to cancel the job, so it is still running. Try again.",
            )

    await log_event(
        "job_cancelled",
        actor_id=user.sub,
        actor_email=user.email,
        target_id=job_id,
        category=AuditCategory.JOB,
        detail={
            "from": doc["status"],
            # Distinguishes an operator cancelling someone else's runaway job
            # (JOB_CANCEL_ANY) from a user cancelling their own.
            "owner_id": doc["user_id"],
            "on_behalf_of_other": doc["user_id"] != user.sub,
            # Requested: SLURM has yet to confirm. Immediate: it never had it.
            "requested": not immediate,
        },
    )

    return _status_response(await db.jobs.find_one({"_id": job_id}))


#: Stored for a cancel that needed no SLURM job. It names nobody: the owner,
#: an administrator and any other viewer read the same document, and who asked
#: is `cancel_requested_by_email` (the page words it from the viewer's side,
#: `cancelledBy`).
_CANCELLED_FROM_OPENGHM = "This simulation was cancelled from OpenGHM before it was queued on Anvil."
_CANCEL_REQUEST_FIELDS = ("cancel_requested_at", "cancel_requested_by", "cancel_requested_by_email")


def _cancel_request(user: TokenPayload, now: datetime) -> dict:
    return {
        "cancel_requested_at": now,
        "cancel_requested_by": user.sub,
        "cancel_requested_by_email": user.email,
    }


def _not_cancellable(current: str) -> HTTPException:
    return _error(
        status.HTTP_409_CONFLICT,
        "not_cancellable",
        f"Only a queued or running simulation can be cancelled; this one is {current.lower()}.",
        current=current,
    )


def _job_changed() -> HTTPException:
    return _error(
        status.HTTP_409_CONFLICT,
        "job_changed",
        "This snapshot draft changed while its simulation was being cancelled. Reload it and try again.",
    )


# ---------------------------------------------------------------------------
# GET /jobs/{job_id}/logs  —  one chunk of one log, by byte offset (ADR 0027)
# ---------------------------------------------------------------------------

_ANVIL_LOG_UNREACHABLE = "Anvil could not be reached, so the log could not be read. Try again in a few minutes."
_DOWNLOAD_CHUNK_BYTES = 1024 * 1024


@router.get("/{job_id}/logs", response_model=JobLogResponse)
async def get_job_logs(
    job_id: str,
    stream: LogStream,
    offset: int | None = Query(None, ge=0, description="Byte to start at; omitted: the end of the file"),
    # At least 4: a chunk never ends inside a UTF-8 sequence (up to 3 bytes held back).
    limit: int = Query(settings.JOB_LOG_READ_DEFAULT_BYTES, ge=4, le=settings.JOB_LOG_READ_MAX_BYTES),
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
):
    doc = await _get_job_for(job_id, user, Permission.JOB_VIEW_ANY)
    try:
        chunk = await slurm.read_log(doc, stream, offset, limit)
    except Exception as exc:
        logger.warning("Log read failed for %s (%s): %s", job_id, stream, exc)
        raise _error(status.HTTP_502_BAD_GATEWAY, "anvil_unreachable", _ANVIL_LOG_UNREACHABLE)
    return JobLogResponse(job_id=job_id, stream=stream, **chunk)


@router.get("/{job_id}/logs/{stream}/download")
async def download_job_log(
    job_id: str,
    stream: LogStream,
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
):
    doc = await _get_job_for(job_id, user, Permission.JOB_VIEW_ANY)
    try:
        path = await slurm.log_path(doc, stream)
        first = await slurm.read_log_bytes(path, 0, _DOWNLOAD_CHUNK_BYTES) if path else None
    except Exception as exc:
        logger.warning("Log download failed for %s (%s): %s", job_id, stream, exc)
        raise _error(status.HTTP_502_BAD_GATEWAY, "anvil_unreachable", _ANVIL_LOG_UNREACHABLE)
    if first is None:
        raise _error(
            status.HTTP_404_NOT_FOUND, "log_missing", "This log is not on Anvil (yet, or it has been purged)."
        )
    size, data = first
    limit = settings.JOB_LOG_DOWNLOAD_MAX_BYTES
    if size > limit:
        raise _error(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "log_too_large",
            f"This log is {size / 1e6:.1f} MB, above the {limit / 1e6:.0f} MB download limit. "
            f"It is on Anvil at {path}.",
            size=size,
            max=limit,
            path=path,
        )

    async def body():
        # Exactly `size` bytes, as Content-Length says: a running job's log may
        # grow while it is sent, and the growth is left for the next download.
        sent = min(len(data), size)
        yield data[:sent]
        while sent < size:
            chunk = await slurm.read_log_bytes(path, sent, min(_DOWNLOAD_CHUNK_BYTES, size - sent))
            if chunk is None or not chunk[1]:
                raise RuntimeError(f"{path} shrank while it was being downloaded")
            yield chunk[1][: size - sent]
            sent += len(chunk[1])

    # The file's name comes from the job, not the request; an id is always a safe one.
    name = doc["sim_id"] if job_script.is_valid_id(doc.get("sim_id")) else job_id
    return StreamingResponse(
        body(),
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{name}-{stream}.log"',
            "Content-Length": str(size),
        },
    )
