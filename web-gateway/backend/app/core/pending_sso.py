"""Pending SSO signups — for identity providers that don't release an email.

ORCID in particular often withholds email depending on the user's own
privacy settings, but users.email is the account's unique key, so
POST /auth/sso-login can't create a real account when it's missing. Instead
it stashes what it does have here and hands the frontend a one-time
completion token; the user fills in the gap at /auth/complete-profile and
POST /auth/complete-sso-signup finishes account creation.

Same opaque-token-hash pattern as password reset / email verification
(app.api.v1.auth's _generate_opaque_token) — only the hash is stored, the
raw token exists only in the URL the user's browser holds.
"""

from datetime import datetime, timedelta, timezone

from app.core.database import get_db

COLLECTION = "pending_sso_signups"
EXPIRE = timedelta(minutes=30)


async def create_pending(
    token_hash: str,
    external_id: str,
    provider: str,
    name: str | None,
    organization: str | None,
) -> None:
    now = datetime.now(timezone.utc)
    await get_db()[COLLECTION].insert_one(
        {
            "_id": token_hash,
            "external_id": external_id,
            "provider": provider,
            "name": name,
            "organization": organization,
            "created_at": now,
            "expires_at": now + EXPIRE,
        }
    )


async def find_pending(token_hash: str) -> dict | None:
    """Returns None for unknown *and* expired tokens — same reasoning as
    app.core.sessions.find_session_by_token: callers can't tell the two
    apart, which is fine, neither should succeed."""
    doc = await get_db()[COLLECTION].find_one({"_id": token_hash})
    if doc is None:
        return None
    if doc["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        return None
    return doc


async def delete_pending(token_hash: str) -> None:
    """Single-use: called once the real account has been created."""
    await get_db()[COLLECTION].delete_one({"_id": token_hash})
