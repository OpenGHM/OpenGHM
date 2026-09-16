"""Role and permission model for OpenGHM.

Roles are a closed set of four tiers (`admin`, `staff`, `user`, `guest`).
Authorization decisions should never compare a bare role string — always go
through `has_permission()` / the `require_permission()` FastAPI dependency in
`app.core.authz`, keyed on `Permission`, not on which role someone happens to
hold. That keeps "who can view any job" and "who can manage users" as
independent axes instead of baking an org-chart rank into every call site.
"""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import Annotated, Any

from pydantic import BeforeValidator

logger = logging.getLogger(__name__)


class Role(StrEnum):
    ADMIN = "admin"
    STAFF = "staff"
    USER = "user"
    GUEST = "guest"


class Permission(StrEnum):
    # jobs
    JOB_SUBMIT = "job:submit"
    JOB_VIEW_OWN = "job:view:own"
    JOB_CANCEL_OWN = "job:cancel:own"
    JOB_VIEW_ANY = "job:view:any"
    JOB_CANCEL_ANY = "job:cancel:any"
    # users
    USER_VIEW_ANY = "user:view:any"
    USER_MANAGE = "user:manage"  # create / change role / deactivate
    # repository
    REPO_VIEW = "repository:view"
    REPO_MANAGE = "repository:manage"  # reserved — no endpoint yet
    # system
    SYSTEM_VIEW = "system:view"  # read-only infra/health/config surface


_GUEST: frozenset[Permission] = frozenset({Permission.REPO_VIEW})
_USER: frozenset[Permission] = _GUEST | {
    Permission.JOB_SUBMIT,
    Permission.JOB_VIEW_OWN,
    Permission.JOB_CANCEL_OWN,
}
_STAFF: frozenset[Permission] = _USER | {
    Permission.JOB_VIEW_ANY,
    Permission.JOB_CANCEL_ANY,
    Permission.USER_VIEW_ANY,
}
_ADMIN: frozenset[Permission] = _STAFF | {
    Permission.USER_MANAGE,
    Permission.REPO_MANAGE,
    Permission.SYSTEM_VIEW,
}

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.GUEST: frozenset(_GUEST),
    Role.USER: frozenset(_USER),
    Role.STAFF: frozenset(_STAFF),
    Role.ADMIN: frozenset(_ADMIN),
}

# Fail at import time if a role is ever added without a permission set.
assert set(ROLE_PERMISSIONS) == set(Role), "ROLE_PERMISSIONS must cover every Role"

# Legacy spellings still present in already-issued JWTs, cached NextAuth
# sessions, and unmigrated Mongo documents from the old PascalCase role set
# (`Admin`, `PowerUser`, `User`, `Guest`). Remove once `parse_role`'s
# "legacy role spelling accepted" log line has been silent for a full
# NextAuth session window (see devdocs/architecture/authentication.md).
_LEGACY_ALIASES: dict[str, Role] = {
    "poweruser": Role.STAFF,
    "power_user": Role.STAFF,
}


def parse_role(value: Any) -> Role:
    """Normalise any inbound role representation to a canonical Role.

    Accepts exact matches ("admin") case-insensitively ("Admin") and the
    legacy PascalCase spellings ("PowerUser" -> staff). Raises ValueError on
    anything else, which Pydantic turns into a ValidationError.
    """
    if isinstance(value, Role):
        return value
    if not isinstance(value, str):
        raise ValueError(f"role must be a string, got {type(value).__name__}")

    key = value.strip().lower()
    if key in _LEGACY_ALIASES:
        logger.info("legacy role spelling accepted: %r", value)
        return _LEGACY_ALIASES[key]
    try:
        role = Role(key)
    except ValueError:
        raise ValueError(f"unknown role {value!r}") from None
    if key != value:
        logger.info("legacy role spelling accepted: %r", value)
    return role


def has_permission(role: Role, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS[role]


# Annotated type used by every Pydantic model/field that carries a role, so
# inbound values (old JWTs, legacy Mongo docs, X-Mock-Role headers) are
# normalised on the way in rather than rejected outright.
RoleField = Annotated[Role, BeforeValidator(parse_role)]
