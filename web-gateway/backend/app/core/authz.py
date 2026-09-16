"""Authorization dependencies and helpers, built on top of app.core.roles.

`security.py` answers "who is this?" (authentication). This module answers
"is that identity allowed to do X?" (authorization), by checking permissions
rather than comparing role strings directly — see app.core.roles for why.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.core.roles import ROLE_PERMISSIONS, Permission, has_permission
from app.core.security import get_current_user
from app.models.user import TokenPayload

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
