"""Pending SSO documents — one-time tokens that carry a half-finished SSO step.

Two kinds share the collection, told apart by `kind`:

- "signup": for identity providers that don't release an email. ORCID in
  particular often withholds email depending on the user's own privacy
  settings, but users.email is the account's unique key, so
  POST /auth/sso-login can't create a real account when it's missing. Instead
  it stashes what it does have here and hands the frontend a one-time
  completion token; the user fills in the gap at /auth/complete-profile and
  POST /auth/complete-sso-signup finishes account creation. Documents written
  before `kind` existed are all of this kind.
- "connect": a signed-in user pressed "Connect CILogon" on their profile. The
  next CILogon sign-in from that browser attaches to this user instead of
  signing anyone in (POST /auth/sso-connect-intent, then /auth/sso-login).

Same opaque-token-hash pattern as password reset / email verification
(app.api.v1.auth's _generate_opaque_token) — only the hash is stored, the
raw token exists only in the URL the user's browser holds.
"""

from datetime import datetime, timedelta, timezone

from app.core.database import get_db

COLLECTION = "pending_sso_signups"
EXPIRE = timedelta(minutes=30)
# A connect intent is a button press followed straight by a CILogon round trip,
# so it can be much shorter-lived than a form the user fills in at leisure.
CONNECT_EXPIRE = timedelta(minutes=10)

SIGNUP = "signup"
CONNECT = "connect"


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
            "kind": SIGNUP,
            "external_id": external_id,
            "provider": provider,
            "name": name,
            "organization": organization,
            "created_at": now,
            "expires_at": now + EXPIRE,
        }
    )


async def create_connect(token_hash: str, user_id: str) -> None:
    now = datetime.now(timezone.utc)
    await get_db()[COLLECTION].insert_one(
        {
            "_id": token_hash,
            "kind": CONNECT,
            "user_id": user_id,
            "created_at": now,
            "expires_at": now + CONNECT_EXPIRE,
        }
    )


async def find_pending(token_hash: str, kind: str = SIGNUP) -> dict | None:
    """Returns None for unknown *and* expired tokens — same reasoning as
    app.core.sessions.find_session_by_token: callers can't tell the two
    apart, which is fine, neither should succeed.

    Also None for a token of another `kind`, so a connect token can never
    finish a signup or the reverse.
    """
    doc = await get_db()[COLLECTION].find_one({"_id": token_hash})
    if doc is None or doc.get("kind", SIGNUP) != kind:
        return None
    if doc["expires_at"] < datetime.now(timezone.utc):
        return None
    return doc


async def delete_pending(token_hash: str) -> None:
    """Single-use: called once the step the token carried has been applied."""
    await get_db()[COLLECTION].delete_one({"_id": token_hash})
