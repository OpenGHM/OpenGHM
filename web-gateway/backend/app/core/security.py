import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Header, HTTPException, status
from jose import JWTError, jwt
from pydantic import ValidationError

from app.core.config import settings
from app.core.roles import Role, parse_role
from app.models.user import TokenPayload

logger = logging.getLogger(__name__)

MOCK_USERS: dict[Role, dict] = {
    Role.ADMIN: {
        "sub": "mock-admin-001",
        "email": "admin@openghm.dev",
        "role": Role.ADMIN,
        "name": "James Carter",
    },
    Role.STAFF: {
        "sub": "mock-staff-001",
        "email": "staff@openghm.dev",
        "role": Role.STAFF,
        "name": "Priya Raman",
    },
    Role.USER: {
        "sub": "mock-user-001",
        "email": "user@openghm.dev",
        "role": Role.USER,
        "name": "Mia Johnson",
    },
    Role.GUEST: {
        "sub": "mock-guest-001",
        "email": "guest@openghm.dev",
        "role": Role.GUEST,
        "name": "Guest Visitor",
    },
}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def hash_token(raw: str) -> str:
    """SHA-256 of an opaque high-entropy token (refresh/reset/verify tokens).

    Unlike passwords these are already random 256+ bit values, not
    low-entropy secrets a human chose — a fast hash is fine here (no need
    for bcrypt's deliberate slowness) and lets lookup use an indexed
    equality match (`db.users.find_one({"...hash": hash_token(raw)})`)
    instead of a per-document bcrypt check.
    """
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_refresh_token() -> tuple[str, str, datetime]:
    """Returns (raw_token, token_hash, expires_at).

    The raw token is returned to the client once and never stored; only its
    hash lives in Mongo, so a DB read alone can't be used to impersonate a
    session.
    """
    raw = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    return raw, hash_token(raw), expires_at


async def get_current_user(
    authorization: str | None = Header(default=None),
    x_mock_role: str | None = Header(default=None, alias="X-Mock-Role"),
) -> TokenPayload:
    """
    Auth dependency — three-tier resolution:

    1. Bearer JWT present → validate and use (dev + prod)
    2. Dev mode + mock auth enabled + X-Mock-Role header → mock user (local testing)
    3. Else → 401
    """
    # JWT takes priority in both environments
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        try:
            payload = jwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM],
            )
            return TokenPayload(**payload)
        except (JWTError, ValidationError) as exc:
            # ValidationError covers an unparseable/unknown role claim
            # (e.g. a token minted before a role rename) — the token is
            # untrusted input either way, so this is a 401, not a 500.
            logger.warning("Token rejected: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # Dev-only fallback: mock role header. Gated on ENVIRONMENT AND its own
    # flag so mock auth can be disabled independently — e.g. a dev/staging
    # deployment that's reachable from the internet but must not expose a
    # password-free login. See ALLOW_MOCK_AUTH in app.core.config.
    if settings.ENVIRONMENT == "development" and settings.ALLOW_MOCK_AUTH:
        if x_mock_role is None:
            return TokenPayload(**MOCK_USERS[Role.USER])
        try:
            role = parse_role(x_mock_role)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Unknown X-Mock-Role {x_mock_role!r}; expected one of "
                    f"{', '.join(r.value for r in Role)}"
                ),
            )
        return TokenPayload(**MOCK_USERS[role])

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing or invalid Authorization header",
        headers={"WWW-Authenticate": "Bearer"},
    )
