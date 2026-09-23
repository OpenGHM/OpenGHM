"""Jobs API — submit, list, status, cancel, logs."""

import logging
import math
import random
import string
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.audit import AuditCategory, log_event
from app.core.authz import can, require_permission
from app.core.config import settings
from app.core.database import get_db
from app.core.roles import Permission
from app.models.job import (
    CANCELLABLE_STATUSES,
    TERMINAL_STATUSES,
    JobCreateRequest,
    JobListResponse,
    JobLogsResponse,
    JobParameters,
    JobResponse,
    JobStatsResponse,
    JobStatusResponse,
    JobSubmitResponse,
    ModelInputState,
    SimulationDeriveRequest,
    SimulationUpdateRequest,
    SlurmConfig,
)
from app.models.user import TokenPayload
from app.services import slurm

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
    simulation (derive/get/patch), never per-row from `list_jobs`
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
        started_at=doc.get("started_at"),
        completed_at=doc.get("completed_at"),
        updated_at=doc.get("updated_at"),
        output_s3_key=doc.get("output_s3_key"),
    )


def _is_owner(doc: dict, user: TokenPayload) -> bool:
    """Pure ownership check against an already-fetched document."""
    return doc["user_id"] == user.sub


def _can_access_job(doc: dict, user: TokenPayload, escalated: Permission) -> bool:
    """Whether `user` may act on `doc`: its owner, or a holder of
    `escalated`. Pure — a dict standing in for a Mongo document, a
    TokenPayload standing in for the authenticated caller — so the second-
    user isolation guarantee (spec.md's acceptance criteria) is testable
    without Mongo or a request (tests/test_jobs_drafts.py)."""
    return _is_owner(doc, user) or can(user, escalated)


async def _get_job_for(job_id: str, user: TokenPayload, escalated: Permission) -> dict:
    """Fetch a job the caller may act on: its owner, or a holder of `escalated`.

    The permission passed in matches the verb being performed (JOB_VIEW_ANY
    for read paths, JOB_CANCEL_ANY for cancel) rather than a single "is this
    an admin" check, so viewing and cancelling can be granted independently.
    """
    db = get_db()
    doc = await db.jobs.find_one({"_id": job_id})
    if doc is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if not _can_access_job(doc, user, escalated):
        raise HTTPException(status_code=403, detail="Not authorised")
    return doc


def _is_editable(doc: dict) -> bool:
    """A simulation may only be created, edited or deleted through the
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
        "about": None,
        "model_input_id": model_input_id,
        "slurm_job_id": None,
        "slurm_job_name": "",
        "status": "DRAFT",
        "status_reason": None,
        "parameters": parameters.model_dump(),
        "slurm_config": SlurmConfig().model_dump(),
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


def _derive_simulation_parameters(dataset_doc: dict) -> JobParameters:
    """Build a new simulation's parameters from a published catalogue entry
    (T4): the temporal coverage and output variables it was run with become
    the starting point a user overrides, rather than a blank form. Pure —
    takes a plain dict, returns a new model, touches no Mongo — the source
    document is read here and nowhere written back to."""
    simulation = dataset_doc.get("simulation", {})
    temporal = simulation.get("temporalCoverage", {})
    return JobParameters(
        temporal_range_start=str(temporal.get("start", "")),
        temporal_range_end=str(temporal.get("end", "")),
        variables=[v["name"] for v in simulation.get("outputVariables", [])],
    )


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
# POST /jobs  —  Submit
# ---------------------------------------------------------------------------


@router.post("", response_model=JobSubmitResponse, status_code=status.HTTP_201_CREATED)
async def submit_job(
    body: JobCreateRequest,
    user: TokenPayload = Depends(require_permission(Permission.JOB_SUBMIT)),
):
    db = get_db()

    # Resolve dataset title from the catalogue (best-effort — falls back to
    # the bare id if the dataset isn't there, rather than failing the submit).
    # `db.catalog` doesn't exist — datasets live in `db.datasets`
    # (app/api/v1/repository.py); `about.name` is the spec's name field, not
    # the legacy `title`. The stored record is an envelope
    # ({_id, document, owner_user_id, visibility, registered_at}, mission
    # 2026-09-23-catalogue-envelope) — unwrap to the spec document.
    dataset_title = body.dataset_id  # fallback
    dataset_envelope = await db.datasets.find_one({"_id": body.dataset_id})
    dataset_doc = (dataset_envelope or {}).get("document")
    if dataset_doc:
        dataset_title = dataset_doc.get("about", {}).get("name", body.dataset_id)

    # Build slurm config with server defaults
    slurm_cfg = SlurmConfig(
        partition=(body.slurm_config.partition if body.slurm_config else None)
        or settings.ANVIL_PARTITION,
        account=(body.slurm_config.account if body.slurm_config else None)
        or settings.ANVIL_ACCOUNT,
        walltime=(body.slurm_config.walltime if body.slurm_config else None)
        or settings.JOB_DEFAULT_WALLTIME,
        nodes=(body.slurm_config.nodes if body.slurm_config else None)
        or settings.JOB_DEFAULT_NODES,
        ntasks=(body.slurm_config.ntasks if body.slurm_config else None)
        or settings.JOB_DEFAULT_NTASKS,
        memory=body.slurm_config.memory if body.slurm_config else None,
    )

    now = datetime.now(timezone.utc)
    job_id = str(uuid.uuid4())
    sim_id = _generate_sim_id(now)

    doc = {
        "_id": job_id,
        "sim_id": sim_id,
        "user_id": user.sub,
        "user_email": user.email,
        "dataset_id": body.dataset_id,
        "dataset_title": dataset_title,
        "slurm_job_id": None,
        "slurm_job_name": sim_id,
        "status": "PENDING",
        "status_reason": None,
        "parameters": body.parameters.model_dump(),
        "slurm_config": slurm_cfg.model_dump(),
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
    await db.jobs.insert_one(doc)

    # Attempt Slurm submission
    try:
        await slurm.submit_job(job_id)
        final_status = "SUBMITTED"
    except Exception as exc:
        logger.error("Job %s submission failed: %s", job_id, exc)
        final_status = "FAILED"

    # Re-read to get final status (submit_job may have updated it)
    updated = await db.jobs.find_one({"_id": job_id})
    resolved_status = updated["status"] if updated else final_status

    await log_event(
        "job_submitted",
        actor_id=user.sub,
        actor_email=user.email,
        target_id=job_id,
        category=AuditCategory.JOB,
        detail={
            "sim_id": sim_id,
            "dataset_id": body.dataset_id,
            "status": resolved_status,
        },
    )

    return JobSubmitResponse(
        job_id=job_id,
        status=resolved_status,
    )


# ---------------------------------------------------------------------------
# POST /jobs/derive/{dataset_id}  —  New simulation from a snapshot
# ---------------------------------------------------------------------------
#
# A simulation's only creation path in this mission (spec.md, "Out of
# scope": starting one from scratch needs a model-input catalogue the
# gateway does not have yet). It is created as a draft — no Slurm
# submission happens here — inheriting its dataset, title and parameters
# from the published catalogue entry named in the path. `datasets` is only
# ever read by this route, never written to: the source snapshot is
# untouched by deriving from it.


@router.post(
    "/derive/{dataset_id}",
    response_model=JobResponse,
    status_code=status.HTTP_201_CREATED,
)
async def derive_simulation(
    dataset_id: str,
    body: SimulationDeriveRequest = SimulationDeriveRequest(),
    user: TokenPayload = Depends(require_permission(Permission.JOB_SUBMIT)),
):
    db = get_db()
    # Envelope shape (mission 2026-09-23-catalogue-envelope) — unwrap to the
    # spec document.
    dataset_envelope = await db.datasets.find_one({"_id": dataset_id})
    if dataset_envelope is None:
        raise HTTPException(
            status_code=404, detail=f"Dataset '{dataset_id}' not found"
        )
    dataset_doc = dataset_envelope["document"]

    dataset_title = dataset_doc.get("about", {}).get("name", dataset_id)
    parameters = _derive_simulation_parameters(dataset_doc)

    now = datetime.now(timezone.utc)
    job_id = str(uuid.uuid4())
    doc = _new_draft_document(
        job_id=job_id,
        dataset_id=dataset_id,
        dataset_title=dataset_title,
        parameters=parameters,
        slug=body.slug,
        user=user,
        now=now,
        model_input_id=body.model_input_id,
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
    doc = await db.jobs.find_one({"_id": job_id})
    if doc is None or not _is_owner(doc, user):
        # Not an "any" edit permission: mutating someone else's private,
        # unpublished simulation is out of scope (see app.core.roles). A
        # mismatch here is treated the same as a nonexistent simulation
        # rather than a 403, so existence isn't leaked to a caller who only
        # holds JOB_VIEW_ANY.
        raise HTTPException(status_code=404, detail="Job not found")
    if not _is_editable(doc):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot edit a simulation in state {doc['status']}",
        )

    changes = body.model_dump(exclude_unset=True, mode="json")
    if not changes:
        effective = await _resolve_effective_model_input(doc)
        return _doc_to_response(doc, effective=effective)

    changes["updated_at"] = datetime.now(timezone.utc)
    await db.jobs.update_one({"_id": job_id}, {"$set": changes})
    updated = await db.jobs.find_one({"_id": job_id})
    effective = await _resolve_effective_model_input(updated)
    return _doc_to_response(updated, effective=effective)


# ---------------------------------------------------------------------------
# DELETE /jobs/{job_id}  —  Delete while draft
# ---------------------------------------------------------------------------


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_simulation(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_DELETE_OWN)),
):
    db = get_db()
    doc = await db.jobs.find_one({"_id": job_id})
    if doc is None or not _is_owner(doc, user):
        raise HTTPException(status_code=404, detail="Job not found")
    if not _is_editable(doc):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete a simulation in state {doc['status']}",
        )
    await db.jobs.delete_one({"_id": job_id})


# ---------------------------------------------------------------------------
# GET /jobs  —  List user's jobs
# ---------------------------------------------------------------------------


@router.get("", response_model=JobListResponse)
async def list_jobs(
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    user_id: str | None = Query(
        None, description='Owner filter; "*" = all users (requires job:view:any)'
    ),
):
    db = get_db()
    query: dict = _job_scope_query(user, user_id)
    if status_filter:
        upper = status_filter.upper()
        if upper == "ACTIVE":
            query["status"] = {"$in": ["PENDING", "SUBMITTED", "RUNNING", "COMPLETING"]}
        else:
            query["status"] = upper

    total_count = await db.jobs.count_documents(query)
    total_pages = max(1, math.ceil(total_count / page_size))
    skip = (page - 1) * page_size

    cursor = db.jobs.find(query).sort("created_at", -1).skip(skip).limit(page_size)
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
    running = sum(counts.get(s, 0) for s in ["PENDING", "SUBMITTED", "RUNNING", "COMPLETING"])
    return JobStatsResponse(
        total=total,
        running=running,
        completed=counts.get("COMPLETED", 0),
        failed=counts.get("FAILED", 0),
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

    return JobStatusResponse(
        job_id=doc["_id"],
        sim_id=doc.get("sim_id"),
        status=doc["status"],
        slurm_job_id=doc.get("slurm_job_id"),
        submitted_at=doc.get("submitted_at"),
        started_at=doc.get("started_at"),
        completed_at=doc.get("completed_at"),
        status_reason=doc.get("status_reason"),
    )


# ---------------------------------------------------------------------------
# POST /jobs/{job_id}/cancel
# ---------------------------------------------------------------------------


@router.post("/{job_id}/cancel", response_model=JobStatusResponse)
async def cancel_job(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_CANCEL_OWN)),
):
    doc = await _get_job_for(job_id, user, Permission.JOB_CANCEL_ANY)

    if doc["status"] not in CANCELLABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot cancel job in state {doc['status']}",
        )

    slurm_job_id = doc.get("slurm_job_id")
    if slurm_job_id:
        try:
            await slurm.cancel_job(slurm_job_id)
        except Exception as exc:
            logger.error("scancel failed for %s: %s", job_id, exc)
            raise HTTPException(status_code=502, detail=str(exc))

    now = datetime.now(timezone.utc)
    db = get_db()
    await db.jobs.update_one(
        {"_id": job_id},
        {
            "$set": {
                "status": "CANCELLED",
                "status_reason": "Cancelled by user",
                "completed_at": now,
                "updated_at": now,
            }
        },
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
        },
    )

    updated = await db.jobs.find_one({"_id": job_id})
    return JobStatusResponse(
        job_id=updated["_id"],
        status=updated["status"],
        slurm_job_id=updated.get("slurm_job_id"),
        submitted_at=updated.get("submitted_at"),
        started_at=updated.get("started_at"),
        completed_at=updated.get("completed_at"),
        status_reason=updated.get("status_reason"),
    )


# ---------------------------------------------------------------------------
# GET /jobs/{job_id}/logs
# ---------------------------------------------------------------------------


@router.get("/{job_id}/logs", response_model=JobLogsResponse)
async def get_job_logs(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
):
    await _get_job_for(job_id, user, Permission.JOB_VIEW_ANY)

    try:
        stdout, stderr, truncated = await slurm.get_job_logs(job_id)
    except Exception as exc:
        logger.error("Log retrieval failed for %s: %s", job_id, exc)
        raise HTTPException(status_code=502, detail=str(exc))

    return JobLogsResponse(
        job_id=job_id,
        stdout=stdout,
        stderr=stderr,
        truncated=truncated,
    )
