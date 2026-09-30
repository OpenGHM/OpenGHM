import math
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core import sessions
from app.core.audit import log_event
from app.core.authz import require_permission
from app.core.database import get_db
from app.core.roles import Permission, Role
from app.core.security import get_current_user
from app.models.user import (
    SessionEntry,
    SessionListResponse,
    SessionRevokeResponse,
    TokenPayload,
    UserAdminUpdateRequest,
    UserDetailResponse,
    UserListResponse,
    UserResponse,
    UserUpdateRequest,
)

router = APIRouter(prefix="/users", tags=["users"])


def _to_user_response(doc: dict) -> UserResponse:
    return UserResponse(
        id=str(doc["_id"]),
        email=doc["email"],
        name=doc["name"],
        role=doc["role"],
        organization=doc.get("organization"),
        email_verified=doc.get("email_verified", False),
        is_active=doc.get("is_active", True),
        can_run_simulations=doc.get("can_run_simulations", False),
        created_at=doc.get("created_at"),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Return the authenticated user's profile from MongoDB."""
    db = get_db()
    doc = await db.users.find_one({"_id": current_user.sub})

    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {current_user.sub} not found in database",
        )

    return _to_user_response(doc)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdateRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Update the authenticated user's own profile.

    Deliberately narrow: only `name` and `organization` are settable here.
    `UserUpdateRequest` has no `role` field at all, so there is no way for a
    self-edit to escalate privilege — role and is_active changes go through
    PATCH /users/{user_id} below (Permission.USER_MANAGE), which explicitly
    refuses to target the caller's own account.
    """
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items()}

    if updates:
        updates["updated_at"] = datetime.now(timezone.utc)
        result = await db.users.update_one(
            {"_id": current_user.sub}, {"$set": updates}
        )
        if result.matched_count == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User {current_user.sub} not found in database",
            )

    doc = await db.users.find_one({"_id": current_user.sub})
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {current_user.sub} not found in database",
        )

    return _to_user_response(doc)


@router.get("", response_model=UserListResponse)
async def list_users(
    user: TokenPayload = Depends(require_permission(Permission.USER_VIEW_ANY)),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    role: Role | None = Query(None),
    q: str | None = Query(
        None, min_length=1, max_length=100,
        description="Case-insensitive substring match on email or name",
    ),
    is_active: bool | None = Query(None),
):
    """Admin/staff user directory. Read-only for staff — only USER_MANAGE
    (admin) can reach the PATCH endpoint below."""
    db = get_db()
    query: dict = {}
    if role is not None:
        query["role"] = role.value
    if q:
        # re.escape is mandatory — an unescaped regex metacharacter turns a
        # search term into either a wrong-result query or, with something
        # like ".*.*.*.*x", a ReDoS against the Mongo server.
        term = re.escape(q.strip())
        query["$or"] = [
            {"email": {"$regex": term, "$options": "i"}},
            {"name": {"$regex": term, "$options": "i"}},
        ]
    if is_active is not None:
        # Legacy docs may have no is_active key at all (defaults True) — use
        # the same {"$ne": False} convention as the last-admin count below
        # so "active users" doesn't silently exclude every such document.
        query["is_active"] = {"$ne": False} if is_active else False

    total_count = await db.users.count_documents(query)
    total_pages = max(1, math.ceil(total_count / page_size))
    skip = (page - 1) * page_size

    cursor = db.users.find(query).sort("created_at", -1).skip(skip).limit(page_size)
    items = [_to_user_response(doc) async for doc in cursor]

    return UserListResponse(
        items=items, total_count=total_count, page=page, total_pages=total_pages
    )


@router.get("/{user_id}", response_model=UserDetailResponse)
async def get_user_detail(
    user_id: str,
    _user: TokenPayload = Depends(require_permission(Permission.USER_VIEW_ANY)),
):
    """Admin/staff drill-down on one account. Same gate as the list above —
    staff already see every user's email and role there, so this adds no
    new class of data, just more of it about one person."""
    db = get_db()
    doc = await db.users.find_one({"_id": user_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    active_session_count = await db[sessions.COLLECTION].count_documents({"user_id": user_id})

    job_counts: dict[str, int] = {}
    async for row in db.jobs.aggregate(
        [
            {"$match": {"user_id": user_id}},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        ]
    ):
        job_counts[row["_id"]] = row["count"]

    last_login = await db.audit_events.find_one(
        {"actor_id": user_id, "action": "login_succeeded"},
        sort=[("created_at", -1)],
    )

    return UserDetailResponse(
        id=str(doc["_id"]),
        email=doc["email"],
        name=doc["name"],
        role=doc["role"],
        organization=doc.get("organization"),
        email_verified=doc.get("email_verified", False),
        is_active=doc.get("is_active", True),
        can_run_simulations=doc.get("can_run_simulations", False),
        created_at=doc.get("created_at"),
        updated_at=doc.get("updated_at"),
        sso_provider=doc.get("sso_provider"),
        active_session_count=active_session_count,
        job_counts=job_counts,
        last_login_at=last_login["created_at"] if last_login else None,
    )


@router.get("/{user_id}/sessions", response_model=SessionListResponse)
async def get_user_sessions(
    user_id: str,
    _current_user: TokenPayload = Depends(require_permission(Permission.USER_MANAGE)),
):
    """Admin-only (not staff): a session row's user_agent is device
    fingerprinting data about a specific person, and the only reason to look
    at it is to decide whether to revoke it — so viewing and revoking share
    the same gate rather than splitting read (staff) from write (admin)."""
    db = get_db()
    if await db.users.find_one({"_id": user_id}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    docs = await sessions.list_sessions(user_id)
    return SessionListResponse(
        items=[
            SessionEntry(
                id=str(d["_id"]),
                created_at=d["created_at"],
                last_used_at=d["last_used_at"],
                user_agent=d.get("user_agent"),
                # Never true here — this is always someone else's session
                # list, viewed by an admin, not the caller's own devices.
                current=False,
            )
            for d in docs
        ]
    )


@router.delete("/{user_id}/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user_session(
    user_id: str,
    session_id: str,
    current_user: TokenPayload = Depends(require_permission(Permission.USER_MANAGE)),
):
    if user_id == current_user.sub:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use POST /auth/logout-all to sign yourself out of every device.",
        )
    db = get_db()
    doc = await db[sessions.COLLECTION].find_one({"_id": session_id})
    if doc is None or doc["user_id"] != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    await sessions.revoke_session(session_id)
    await log_event(
        "user_session_revoked",
        actor_id=current_user.sub,
        actor_email=current_user.email,
        target_id=user_id,
        detail={"session_id": session_id},
    )


@router.delete("/{user_id}/sessions", response_model=SessionRevokeResponse)
async def revoke_all_user_sessions(
    user_id: str,
    current_user: TokenPayload = Depends(require_permission(Permission.USER_MANAGE)),
):
    if user_id == current_user.sub:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use POST /auth/logout-all to sign yourself out of every device.",
        )
    db = get_db()
    if await db.users.find_one({"_id": user_id}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    revoked = await sessions.revoke_all_sessions(user_id)
    await log_event(
        "user_sessions_revoked_all",
        actor_id=current_user.sub,
        actor_email=current_user.email,
        target_id=user_id,
        detail={"revoked_count": revoked},
    )
    return SessionRevokeResponse(revoked=revoked)


@router.patch("/{user_id}", response_model=UserResponse)
async def admin_update_user(
    user_id: str,
    body: UserAdminUpdateRequest,
    current_user: TokenPayload = Depends(require_permission(Permission.USER_MANAGE)),
):
    """Admin-only: change a user's role, active status or run permission.

    `can_run_simulations` (ADR 0024) is granted and revoked here and nowhere
    else; the change lands in the `user_admin_updated` audit event with the
    other fields. Two guards that exist independently of each other:

    1. Never targets the caller's own account, for any field. Role
       self-changes are an obvious self-escalation/self-demotion risk;
       self-deactivation is a subtler lockout risk (an admin disabling their
       own account with no other admin around to undo it) that isn't
       covered by "can't change my own role" alone, so it's blocked here
       too rather than only checking `role`.
    2. Refuses to remove the last active admin — whether by changing their
       role away from admin or setting is_active=False — so the system
       can never end up with zero admins able to fix that.
    """
    if user_id == current_user.sub:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role, active status or run permission.",
        )

    db = get_db()
    target = await db.users.find_one({"_id": user_id})
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return _to_user_response(target)

    target_is_admin = target["role"] == Role.ADMIN.value
    losing_admin_status = ("role" in updates and updates["role"] != Role.ADMIN) or (
        updates.get("is_active") is False
    )
    if target_is_admin and losing_admin_status:
        active_admin_count = await db.users.count_documents(
            {"role": Role.ADMIN.value, "is_active": {"$ne": False}}
        )
        if active_admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove the last active admin.",
            )

    updates["updated_at"] = datetime.now(timezone.utc)
    await db.users.update_one({"_id": user_id}, {"$set": updates})

    audit_detail = {k: str(v) for k, v in updates.items() if k != "updated_at"}

    # Deactivation has to take effect now, not whenever the target's access
    # token happens to expire — revoke every session so their next request
    # (or refresh) fails immediately.
    if updates.get("is_active") is False:
        audit_detail["sessions_revoked"] = str(
            await sessions.revoke_all_sessions(user_id)
        )

    await log_event(
        "user_admin_updated",
        actor_id=current_user.sub,
        actor_email=current_user.email,
        target_id=user_id,
        detail=audit_detail,
    )

    doc = await db.users.find_one({"_id": user_id})
    return _to_user_response(doc)
