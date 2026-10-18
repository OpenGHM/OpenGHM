"""Authorization dependencies and helpers, built on top of app.core.roles.

`security.py` answers "who is this?" (authentication). This module answers
"is that identity allowed to do X?" (authorization), by checking permissions
rather than comparing role strings directly — see app.core.roles for why.
"""

import logging
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.core.config import settings
from app.core.database import get_db
from app.core.roles import ROLE_PERMISSIONS, Permission, Role, has_permission, parse_role
from app.core.security import get_current_user, is_mock_identity
from app.models.job import ACTIVE_STATUSES
from app.models.user import TokenPayload

logger = logging.getLogger(__name__)

CurrentUser = Annotated[TokenPayload, Depends(get_current_user)]


def can(user: TokenPayload, permission: Permission) -> bool:
    """Predicate form — for owner-OR-privileged branches inside handlers."""
    return has_permission(user.role, permission)


def require_permission(*required: Permission):
    """Route-level gate. All listed permissions must be held (AND).

    Depends on get_current_user itself, so FastAPI resolves/caches it once
    per request — a route depending on both this gate and the current user
    doesn't decode the JWT twice.
    """

    async def _dependency(user: CurrentUser) -> TokenPayload:
        granted = ROLE_PERMISSIONS[user.role]
        missing = [p for p in required if p not in granted]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires permission: {', '.join(missing)}",
            )
        return user

    return _dependency


# ---------------------------------------------------------------------------
# Who may run a simulation (ADR 0024)
# ---------------------------------------------------------------------------
#
# `require_permission` above trusts the role in the JWT, which is fine for
# reads. Spending the shared SLURM allocation is not: a token outlives an
# administrator's decision by up to JWT_EXPIRE_MINUTES. The two dependencies
# below read the user's *document* at call time instead, and are used only by
# the routes that create or submit a job — never by the polled GETs.


def _refuse(code: str, message: str, http_status: int = status.HTTP_403_FORBIDDEN, **extra):
    """An HTTPException whose `detail` is `{"code": ..., "message": ..., **extra}`.

    `code` is stable and meant for a client to branch on; `message` is
    user-actionable English for a person. Codes used here:

    403: `mock_identity`, `account_not_found`, `account_inactive`,
         `email_not_verified`, `not_permitted_to_run`, `permission_required`
    429: `active_job_limit` (extra: `active`, `limit`)
    """
    return HTTPException(
        status_code=http_status,
        detail={"code": code, "message": message, **extra},
    )


async def _load_account(user: TokenPayload) -> tuple[dict, Role]:
    """The caller's current user document and its role, or a refusal.

    Shared by both gates below, so a deleted account and a deactivated one
    are refused the same way by each. A mock identity is not refused here by
    id, but it has no user document unless someone creates one (the local
    seed uses ids of its own, see deploy/local/mongo/init-mongo.js), so it
    gets `account_not_found` like any caller without one. Only
    `require_submitter` refuses it by id.
    """
    doc = await get_db().users.find_one({"_id": user.sub})
    if doc is None:
        raise _refuse(
            "account_not_found",
            "Your account could not be found. Sign out and sign in again.",
        )
    if not doc.get("is_active", True):
        raise _refuse(
            "account_inactive",
            "Your account has been deactivated. Contact an administrator.",
        )
    try:
        role = parse_role(doc.get("role"))
    except ValueError:
        logger.warning("User %s has an unparseable role %r", user.sub, doc.get("role"))
        raise _refuse(
            "permission_required",
            "Your account has no valid role. Contact an administrator.",
        )
    return doc, role


async def require_active_user(user: CurrentUser) -> TokenPayload:
    """Gate for creating a draft: the user's document exists and is active.

    No email or run-permission check (ADR 0024: a user who may not run can
    still prepare drafts), and no mock-identity check by id: a mock identity
    has no user document unless someone creates one, so it is refused like
    any caller without one, `account_not_found`. `job:submit` stays the
    role-level gate, evaluated on the role in the *database*, so a guest is
    still refused. Returns the caller with the database role. Refusals are
    403 with `detail = {"code", "message"}` (see `_refuse`).
    """
    _, role = await _load_account(user)
    if not has_permission(role, Permission.JOB_SUBMIT):
        raise _refuse(
            "permission_required",
            f"Requires permission: {Permission.JOB_SUBMIT}",
        )
    return user.model_copy(update={"role": role})


async def require_submitter(user: CurrentUser) -> TokenPayload:
    """Gate for submitting a job: everything ADR 0024 asks, read from the
    database at call time, never from token claims.

    Refused with 403 and `detail = {"code", "message"}` when the caller is a
    mock identity (`mock_identity`, by id, whatever ENVIRONMENT is, and even
    if a user document exists for it), has no user
    document (`account_not_found`), is deactivated (`account_inactive`), has
    not verified their email (`email_not_verified`), or is not permitted to
    run (`not_permitted_to_run`: a guest, or a `user` without
    `can_run_simulations: true`). admin and staff are permitted implicitly.

    Then 429 with `code: "active_job_limit"` (and `active`, `limit`) when a
    non-admin, non-staff caller already has JOB_MAX_ACTIVE_PER_USER jobs
    PENDING, SUBMITTED, RUNNING or COMPLETING. The count-then-insert is not
    atomic, so two simultaneous submits can overshoot the limit by one; it
    bounds spend, it is not a quota ledger.

    Returns the caller with the database role.
    """
    if is_mock_identity(user.sub):
        raise _refuse(
            "mock_identity",
            "Development mock accounts cannot run simulations. "
            "Sign in with a real account.",
        )
    doc, role = await _load_account(user)
    if not doc.get("email_verified", False):
        raise _refuse(
            "email_not_verified",
            "Verify your email address before running a simulation. "
            "Check your inbox for the verification link.",
        )
    exempt = role in (Role.ADMIN, Role.STAFF)
    if not (exempt or (role == Role.USER and doc.get("can_run_simulations", False))):
        raise _refuse(
            "not_permitted_to_run",
            "You are not permitted to run simulations. "
            "Ask an administrator for permission to run simulations.",
        )
    if not exempt:
        limit = settings.JOB_MAX_ACTIVE_PER_USER
        active = await get_db().jobs.count_documents(
            {"user_id": user.sub, "status": {"$in": ACTIVE_STATUSES}}
        )
        if active >= limit:
            raise _refuse(
                "active_job_limit",
                f"You already have {active} active simulations (the limit is {limit}). "
                "Wait for one to finish or cancel one, then try again.",
                status.HTTP_429_TOO_MANY_REQUESTS,
                active=active,
                limit=limit,
            )
    return user.model_copy(update={"role": role})
