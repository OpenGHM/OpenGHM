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
    JobResponse,
    JobStatsResponse,
    JobStatusResponse,
    JobSubmitResponse,
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


def _doc_to_response(doc: dict) -> JobResponse:
    return JobResponse(
        id=doc["_id"],
        sim_id=doc.get("sim_id", ""),
        user_id=doc["user_id"],
        dataset_id=doc["dataset_id"],
        dataset_title=doc["dataset_title"],
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
        output_s3_key=doc.get("output_s3_key"),
    )


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
    if doc["user_id"] != user.sub and not can(user, escalated):
        raise HTTPException(status_code=403, detail="Not authorised")
    return doc


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

    # Resolve dataset title (best-effort — the repo endpoint loads from JSON files)
    dataset_title = body.dataset_id  # fallback
    # Try to look up from the catalog/temp data if available
    dataset_doc = await db.catalog.find_one({"_id": body.dataset_id})
    if dataset_doc:
        dataset_title = dataset_doc.get("title", body.dataset_id)

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
    return _doc_to_response(doc)


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
