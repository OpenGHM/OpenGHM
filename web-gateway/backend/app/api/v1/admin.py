"""Admin-only cross-cutting views — audit log and site-wide metrics.

Kept separate from users.py (user CRUD) and jobs.py (job CRUD) since these
aren't really resources of their own; they're read surfaces over
app.core.audit's events collection and aggregate counts over jobs/users.
"""

import math
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.audit import AuditCategory
from app.core.authz import require_permission
from app.core.database import get_db
from app.core.roles import Permission
from app.models.admin import (
    StatusBreakdownResponse,
    StatusCount,
    SystemInfoResponse,
    TimeSeriesPoint,
    TimeSeriesResponse,
)
from app.models.user import AuditLogEntry, AuditLogListResponse, TokenPayload
from app.services.system_info import get_system_info

router = APIRouter(prefix="/admin", tags=["admin"])

# Every possible JobStatus value, seeded at zero in the breakdown response so
# a chart's legend/colors stay stable across reloads and empty windows.
_ALL_JOB_STATUSES = [
    "PENDING", "SUBMITTED", "RUNNING", "COMPLETING", "COMPLETED", "FAILED", "CANCELLED",
]


@router.get("/audit-log", response_model=AuditLogListResponse)
async def list_audit_log(
    _user: TokenPayload = Depends(require_permission(Permission.USER_VIEW_ANY)),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    category: AuditCategory | None = Query(
        None, description="Filter by event category; omit for all"
    ),
):
    db = get_db()
    query: dict = {}
    if category is not None:
        if category is AuditCategory.AUTH:
            # Events written before the category field existed are all auth
            # events (job auditing came later), so treat a missing field as
            # "auth" rather than hiding that history behind the filter.
            query["$or"] = [
                {"category": category.value},
                {"category": {"$exists": False}},
            ]
        else:
            query["category"] = category.value

    total_count = await db.audit_events.count_documents(query)
    total_pages = max(1, math.ceil(total_count / page_size))
    skip = (page - 1) * page_size

    cursor = (
        db.audit_events.find(query).sort("created_at", -1).skip(skip).limit(page_size)
    )
    items = [
        AuditLogEntry(
            id=str(doc["_id"]),
            action=doc["action"],
            category=doc.get("category", "auth"),
            actor_id=doc["actor_id"],
            actor_email=doc.get("actor_email"),
            target_id=doc.get("target_id"),
            detail=doc.get("detail"),
            created_at=doc["created_at"],
        )
        async for doc in cursor
    ]

    return AuditLogListResponse(
        items=items, total_count=total_count, page=page, total_pages=total_pages
    )


def _validate_tz(tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz)
    except (KeyError, ValueError):
        # ZoneInfoNotFoundError subclasses KeyError; ValueError covers junk
        # strings that never resolve to a lookup at all.
        raise HTTPException(status_code=400, detail=f"Unknown timezone: {tz}")


async def _time_series(
    collection: str,
    metric: str,
    days: int,
    granularity: Literal["day", "week"],
    tz: str,
) -> TimeSeriesResponse:
    tzinfo = _validate_tz(tz)
    db = get_db()

    step = timedelta(days=1 if granularity == "day" else 7)
    now_local = datetime.now(tzinfo)
    bucket_now = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    if granularity == "week":
        # $dateTrunc's default startOfWeek is Sunday; Python's weekday() is
        # Monday=0 — align to the same Sunday-start convention here so the
        # buckets computed below line up with what Mongo groups into.
        bucket_now -= timedelta(days=(bucket_now.weekday() + 1) % 7)

    buckets = math.ceil(days / step.days)
    start_local = bucket_now - step * (buckets - 1)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = (bucket_now + step).astimezone(timezone.utc)

    pipeline = [
        {"$match": {"created_at": {"$gte": start_utc}}},
        {
            "$group": {
                "_id": {"$dateTrunc": {"date": "$created_at", "unit": granularity, "timezone": tz}},
                "count": {"$sum": 1},
            }
        },
    ]
    raw = {row["_id"]: row["count"] async for row in db[collection].aggregate(pipeline)}
    # Motor's client isn't tz_aware, so datetimes it returns (including
    # $dateTrunc output) come back naive UTC — comparing them directly
    # against the tz-aware bucket keys below would never match, silently
    # returning an all-zero series. Normalize both sides to aware UTC.
    counts = {k.replace(tzinfo=timezone.utc): v for k, v in raw.items()}

    points = []
    for i in range(buckets):
        bucket_start_utc = (start_local + step * i).astimezone(timezone.utc)
        points.append(TimeSeriesPoint(bucket=bucket_start_utc, count=counts.get(bucket_start_utc, 0)))

    return TimeSeriesResponse(
        metric=metric,
        granularity=granularity,
        timezone=tz,
        start=start_utc,
        end=end_utc,
        total=sum(p.count for p in points),
        points=points,
    )


@router.get("/metrics/jobs", response_model=TimeSeriesResponse)
async def jobs_time_series(
    _user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_ANY)),
    days: int = Query(30, ge=1, le=365),
    granularity: Literal["day", "week"] = Query("day"),
    tz: str = Query("UTC", max_length=64, description="IANA zone for bucket boundaries"),
):
    """Jobs submitted per bucket, site-wide. Same permission as the
    site-wide job list/stats (`user_id=*` on GET /jobs) — an aggregate
    count carries nothing about any individual job or user."""
    return await _time_series("jobs", "jobs", days, granularity, tz)


@router.get("/metrics/registrations", response_model=TimeSeriesResponse)
async def registrations_time_series(
    _user: TokenPayload = Depends(require_permission(Permission.USER_VIEW_ANY)),
    days: int = Query(30, ge=1, le=365),
    granularity: Literal["day", "week"] = Query("day"),
    tz: str = Query("UTC", max_length=64, description="IANA zone for bucket boundaries"),
):
    """New accounts per bucket, site-wide."""
    return await _time_series("users", "registrations", days, granularity, tz)


@router.get("/metrics/job-status", response_model=StatusBreakdownResponse)
async def job_status_breakdown(
    _user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_ANY)),
    days: int | None = Query(None, ge=1, le=365, description="Omit for all-time"),
):
    """Current distribution of job statuses, site-wide. Doesn't change
    GET /jobs/stats — that endpoint's four-scalar contract is consumed by
    the simulation listing hero; this keeps the full per-status grouping
    that endpoint already computes internally and then discards."""
    db = get_db()
    since = None
    match_stage: dict = {}
    if days is not None:
        since = datetime.now(timezone.utc) - timedelta(days=days)
        match_stage = {"created_at": {"$gte": since}}

    pipeline = [
        *([{"$match": match_stage}] if match_stage else []),
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    counts = {row["_id"]: row["count"] async for row in db.jobs.aggregate(pipeline)}

    # Seed every known status at zero first, then overlay real counts —
    # keeps a chart's legend/colors stable across reloads. Any status found
    # in the data but not in _ALL_JOB_STATUSES (an unmapped Slurm state) is
    # appended rather than dropped, since that's exactly the kind of thing
    # an operator wants surfaced, not hidden.
    ordered = {status: counts.pop(status, 0) for status in _ALL_JOB_STATUSES}
    ordered.update(counts)

    items = [StatusCount(status=status, count=count) for status, count in ordered.items()]
    return StatusBreakdownResponse(items=items, total=sum(item.count for item in items), since=since)


@router.get("/system", response_model=SystemInfoResponse)
async def system_info(
    request: Request,
    _user: TokenPayload = Depends(require_permission(Permission.SYSTEM_VIEW)),
):
    """Admin-only (not staff — see Permission.SYSTEM_VIEW). Read-only: no
    config editing, no cache flush, no job re-queue. GET /health stays the
    unauthenticated k8s-probe endpoint; this is deliberately a separate,
    gated surface with more detail than a probe should ever expose."""
    return await get_system_info(request.app.state.started_at)
