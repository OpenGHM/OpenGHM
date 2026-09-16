"""Refresh-token sessions, one document per signed-in device.

Replaces the previous single `refresh_token_hash` field on the user
document, which allowed exactly one live session per account: signing in
on a second device rotated the first device's token out from under it, so
that device silently lost its session at its next refresh.

Each session is identified by an opaque id that also travels in the access
token's `sid` claim. That's what makes per-device logout possible without
the client ever having to hand a refresh token back: POST /auth/logout
reads `sid` from the (already validated) access token and revokes just
that session, leaving other devices signed in.
"""

import logging
import uuid
from datetime import datetime, timezone

from app.core.database import get_db
from app.core.security import generate_refresh_token, hash_token

logger = logging.getLogger(__name__)

COLLECTION = "refresh_tokens"


async def create_session(user_id: str, user_agent: str | None = None) -> tuple[str, str]:
    """Start a new session. Returns (session_id, raw_refresh_token)."""
    raw, token_hash, expires_at = generate_refresh_token()
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    await get_db()[COLLECTION].insert_one(
        {
            "_id": session_id,
            "user_id": user_id,
            "token_hash": token_hash,
            "expires_at": expires_at,
            "created_at": now,
            "last_used_at": now,
            "user_agent": user_agent,
        }
    )
    return session_id, raw


async def rotate_session(session_id: str) -> str:
    """Issue a fresh refresh token for an existing session, in place.

    Rotating rather than creating means a device keeps one session row for
    its whole lifetime, so "sign out this device" and the session list stay
    stable across refreshes. Returns the new raw refresh token.

    Deliberately does not touch `user_agent`: refreshes are made
    server-to-server by the Next.js runtime, not by the browser, so the
    User-Agent on a refresh request describes the web server rather than
    the device. Overwriting would replace the real device string captured
    at sign-in with something useless.
    """
    raw, token_hash, expires_at = generate_refresh_token()
    await get_db()[COLLECTION].update_one(
        {"_id": session_id},
        {
            "$set": {
                "token_hash": token_hash,
                "expires_at": expires_at,
                "last_used_at": datetime.now(timezone.utc),
            }
        },
    )
    return raw


async def find_session_by_token(raw_token: str) -> dict | None:
    """Look up a live session by its raw refresh token.

    Returns None for unknown *and* expired tokens — callers can't
    distinguish the two, which is intentional.
    """
    doc = await get_db()[COLLECTION].find_one({"token_hash": hash_token(raw_token)})
    if doc is None:
        return None

    expires_at = doc.get("expires_at")
    if expires_at is None or expires_at.replace(tzinfo=timezone.utc) < datetime.now(
        timezone.utc
    ):
        return None
    return doc


async def revoke_session(session_id: str) -> None:
    """Sign out one device."""
    await get_db()[COLLECTION].delete_one({"_id": session_id})


async def revoke_all_sessions(user_id: str, except_session_id: str | None = None) -> int:
    """Sign out every device for a user. Returns how many were revoked.

    Used for "sign out everywhere", and forced on password reset and
    account deactivation — both cases where any existing session may
    belong to someone who shouldn't have it anymore. `except_session_id`
    exists for POST /auth/change-password: unlike reset-password, the
    caller is already authenticated and just proved they know the new
    password, so their own device shouldn't be logged out too.
    """
    query: dict = {"user_id": user_id}
    if except_session_id is not None:
        query["_id"] = {"$ne": except_session_id}
    result = await get_db()[COLLECTION].delete_many(query)
    return result.deleted_count


async def list_sessions(user_id: str) -> list[dict]:
    """Live sessions for a user, most recently used first."""
    cursor = (
        get_db()[COLLECTION]
        .find({"user_id": user_id})
        .sort("last_used_at", -1)
    )
    return [doc async for doc in cursor]
