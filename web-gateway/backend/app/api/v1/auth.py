import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.core import login_throttle, pending_sso, sessions
from app.core.audit import log_event
from app.core.config import settings
from app.core.database import get_db
from app.core.roles import Role
from app.core.security import (
    create_access_token,
    get_current_user,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.user import (
    AuthResponse,
    ChangePasswordRequest,
    CompleteSsoSignupRequest,
    ConfirmLinkRequest,
    ForgotPasswordRequest,
    LinkPendingResponse,
    LoginRequest,
    RefreshRequest,
    RegisteredResponse,
    RegisterRequest,
    ResetPasswordRequest,
    SessionEntry,
    SessionListResponse,
    SsoConnectIntentResponse,
    SsoLoginRequest,
    SsoLoginResponse,
    TokenPayload,
    UserResponse,
    VerifyEmailRequest,
)
from app.services.email import send_email
from app.services.email_templates import (
    link_confirmation_email,
    password_reset_email,
    verification_email,
)
from app.services.recaptcha import verify_recaptcha

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Reset links are short-lived (an inbox is a soft target); verification
# links are long-lived since there's no urgency and re-sending is friction.
RESET_TOKEN_EXPIRE = timedelta(hours=1)
VERIFY_TOKEN_EXPIRE = timedelta(hours=24)
VERIFY_RESEND_COOLDOWN = timedelta(minutes=1)


def _generate_opaque_token() -> tuple[str, str]:
    """Same shape as generate_refresh_token but without an expiry baked in —
    reset/verify tokens have their own, shorter, purpose-specific windows."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


async def _send_verification_email(db, user_id: str, email: str, name: str) -> None:
    raw_token, token_hash = _generate_opaque_token()
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"_id": user_id},
        {
            "$set": {
                "verify_token_hash": token_hash,
                "verify_token_expires_at": now + VERIFY_TOKEN_EXPIRE,
                "verify_token_sent_at": now,
            }
        },
    )
    link = f"{settings.FRONTEND_URL}/auth/verify-email?token={raw_token}"
    await send_email(email, verification_email(name, link))


async def _send_link_confirmation_email(
    db, user_id: str, email: str, name: str, pending_link: dict
) -> None:
    """Stages a credential (password or SSO identity) on an *existing*
    account without applying it yet, and emails a confirmation link.

    Used when a self-typed email (register, or ORCID's complete-sso-signup)
    collides with an account under a different auth method: unlike
    sso_login's email match (where CILogon itself vouches for the email),
    a self-typed email is unverified at the point of collision, so applying
    the new credential immediately would let anyone add a password to (and
    thus log into) an account merely by knowing its owner's email address.
    Applying it only happens in POST /auth/confirm-link, once the owner of
    that inbox clicks through.
    """
    raw_token, token_hash = _generate_opaque_token()
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"_id": user_id},
        {
            "$set": {
                "pending_link": pending_link,
                "link_token_hash": token_hash,
                "link_token_expires_at": now + VERIFY_TOKEN_EXPIRE,
                "link_token_sent_at": now,
            }
        },
    )
    link = f"{settings.FRONTEND_URL}/auth/confirm-link?token={raw_token}"
    method = "a password sign-in" if pending_link["type"] == "password" else "a CILogon sign-in"
    await send_email(email, link_confirmation_email(name, method, link))


async def _issue_tokens(
    db,
    user_id: str,
    email: str,
    role,
    name: str,
    session_id: str | None = None,
    user_agent: str | None = None,
) -> AuthResponse:
    """Mint an access+refresh pair for one device.

    Shared by login/refresh/sso/change-password so they stay in sync — a raw
    refresh token is only ever returned here, never stored. Pass
    `session_id` to rotate an existing device's session (the refresh path);
    omit it to start a new one (a fresh sign-in).
    """
    if session_id is None:
        session_id, raw_refresh = await sessions.create_session(user_id, user_agent)
    else:
        raw_refresh = await sessions.rotate_session(session_id)

    token_data = {
        "sub": user_id,
        "email": email,
        "role": role,
        "name": name,
        "sid": session_id,
    }
    access_token = create_access_token(token_data)

    doc = await db.users.find_one({"_id": user_id})
    return AuthResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        expires_in=settings.JWT_EXPIRE_MINUTES * 60,
        user=UserResponse(
            id=str(doc["_id"]),
            email=doc["email"],
            name=doc["name"],
            role=doc["role"],
            organization=doc.get("organization"),
            email_verified=doc.get("email_verified", False),
            is_active=doc.get("is_active", True),
            can_run_simulations=doc.get("can_run_simulations", False),
            created_at=doc.get("created_at"),
        ),
    )


@router.post("/login", response_model=AuthResponse)
async def login(
    body: LoginRequest,
    user_agent: str | None = Header(default=None, alias="User-Agent"),
    x_internal_auth: str | None = Header(default=None),
    x_client_ip: str | None = Header(default=None),
):
    db = get_db()
    ip = login_throttle.client_ip(x_internal_auth, x_client_ip)

    # Before the password is looked at, so a correct one does not get through
    # while the address or the IP is over its failures (app.core.login_throttle).
    # The reason is audited, never shown: the person is told only to wait.
    blocked = await login_throttle.blocked_by(db, body.email, ip)
    if blocked:
        await log_event(
            "login_throttled",
            actor_id="anonymous",
            detail={"attempted_email": body.email, "reason": f"too_many_failures_for_{blocked}"},
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many sign-in attempts. Try again in a few minutes.",
        )

    user = await db.users.find_one({"email": body.email})

    if not user or not user.get("password_hash"):
        await login_throttle.record_failure(db, body.email, ip)
        await log_event(
            "login_failed", actor_id="anonymous", detail={"attempted_email": body.email}
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not verify_password(body.password, user["password_hash"]):
        await login_throttle.record_failure(db, body.email, ip)
        await log_event(
            "login_failed",
            actor_id=str(user["_id"]),
            actor_email=user["email"],
            detail={"reason": "bad_password"},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    await login_throttle.clear_email(db, body.email)

    if not user.get("is_active", True):
        await log_event(
            "login_rejected_inactive", actor_id=str(user["_id"]), actor_email=user["email"]
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account has been deactivated. Contact an administrator.",
        )

    await log_event("login_succeeded", actor_id=str(user["_id"]), actor_email=user["email"])
    return await _issue_tokens(
        db,
        str(user["_id"]),
        user["email"],
        user["role"],
        user["name"],
        user_agent=user_agent,
    )


@router.post(
    "/register",
    response_model=RegisteredResponse | LinkPendingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(body: RegisterRequest):
    if not await verify_recaptcha(body.recaptcha_token):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="reCAPTCHA verification failed. Please try again.",
        )

    db = get_db()

    existing = await db.users.find_one({"email": body.email})
    if existing:
        if existing.get("password_hash"):
            # Genuine duplicate — an account with a password already exists.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists",
            )
        # An SSO-only account owns this email. The email typed into this
        # form is self-asserted, not verified by the SSO provider, so the
        # password can't be attached immediately — see
        # _send_link_confirmation_email for why.
        await _send_link_confirmation_email(
            db,
            existing["_id"],
            body.email,
            existing["name"],
            {"type": "password", "password_hash": hash_password(body.password)},
        )
        return LinkPendingResponse(email=body.email)

    now = datetime.now(timezone.utc)
    user_id = str(uuid.uuid4())
    doc = {
        "_id": user_id,
        "email": body.email,
        "name": body.name,
        "role": Role.USER,
        "organization": body.organization,
        "password_hash": hash_password(body.password),
        "email_verified": False,
        "verify_token_hash": None,
        "verify_token_expires_at": None,
        "verify_token_sent_at": None,
        "reset_token_hash": None,
        "reset_token_expires_at": None,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    }
    await db.users.insert_one(doc)
    await log_event("user_registered", actor_id=user_id, actor_email=body.email)

    # Best-effort — send_email() itself swallows provider errors so a flaky
    # email service never blocks account creation. Verification is
    # non-blocking anyway (see /auth/verify-email): an unverified account
    # can still log in and use the app.
    await _send_verification_email(db, user_id, body.email, body.name)

    return RegisteredResponse(email=body.email)


@router.post("/refresh", response_model=AuthResponse)
async def refresh(body: RefreshRequest):
    """Rotate one device's refresh token in place.

    The presented token stops working the moment a new one is issued, so a
    stolen token is detectable: whichever party refreshes second gets a
    401. Rotation is scoped to the one session — other devices signed in to
    the same account are untouched.
    """
    db = get_db()
    session = await sessions.find_session_by_token(body.refresh_token)

    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user = await db.users.find_one({"_id": session["user_id"]})
    if user is None:
        # User deleted out from under a live session.
        await sessions.revoke_session(session["_id"])
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    if not user.get("is_active", True):
        # Deactivated after this session started — revoke everything, not
        # just this device, so a second device can't keep renewing either.
        await sessions.revoke_all_sessions(str(user["_id"]))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account has been deactivated. Contact an administrator.",
        )

    return await _issue_tokens(
        db,
        str(user["_id"]),
        user["email"],
        user["role"],
        user["name"],
        session_id=session["_id"],
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(current_user: TokenPayload = Depends(get_current_user)):
    """Sign out just the calling device.

    The device is identified by the `sid` claim on the access token, so the
    client never has to send its refresh token back to revoke it. The
    access token itself stays valid until it expires (it's stateless) —
    this stops the session being silently renewed past that point.

    A token with no `sid` predates multi-device sessions; revoking
    everything for that user is the safe reading of "log me out".
    """
    if current_user.sid:
        await sessions.revoke_session(current_user.sid)
    else:
        await sessions.revoke_all_sessions(current_user.sub)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(current_user: TokenPayload = Depends(get_current_user)):
    """Sign out every device for the current user."""
    revoked = await sessions.revoke_all_sessions(current_user.sub)
    await log_event(
        "sessions_revoked_all",
        actor_id=current_user.sub,
        actor_email=current_user.email,
        detail={"revoked_count": revoked},
    )


@router.get("/sessions", response_model=SessionListResponse)
async def list_my_sessions(current_user: TokenPayload = Depends(get_current_user)):
    """The current user's signed-in devices."""
    docs = await sessions.list_sessions(current_user.sub)
    return SessionListResponse(
        items=[
            SessionEntry(
                id=str(d["_id"]),
                created_at=d["created_at"],
                last_used_at=d["last_used_at"],
                user_agent=d.get("user_agent"),
                current=str(d["_id"]) == current_user.sid,
            )
            for d in docs
        ]
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_my_session(
    session_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Sign out one of the current user's other devices."""
    db = get_db()
    doc = await db[sessions.COLLECTION].find_one({"_id": session_id})
    # 404 rather than 403 when it belongs to someone else: whether a given
    # session id exists isn't something one user should learn about another.
    if doc is None or doc["user_id"] != current_user.sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )
    await sessions.revoke_session(session_id)


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
async def forgot_password(body: ForgotPasswordRequest):
    """Always returns 200 regardless of whether the email is registered —
    a differing response would let an attacker enumerate accounts by email.

    Mails an active account that has a password, or whose address is verified:
    an account created by CILogon has no password, and this is how it gets one,
    so it can always sign in without its identity provider. An unverified
    account with no password has proved nothing about the address, so it gets
    nothing.
    """
    db = get_db()
    user = await db.users.find_one({"email": body.email})

    if (
        user
        and user.get("is_active", True)
        and (user.get("password_hash") or user.get("email_verified"))
    ):
        has_password = bool(user.get("password_hash"))
        raw_token, token_hash = _generate_opaque_token()
        now = datetime.now(timezone.utc)
        await db.users.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "reset_token_hash": token_hash,
                    "reset_token_expires_at": now + RESET_TOKEN_EXPIRE,
                }
            },
        )
        link = f"{settings.FRONTEND_URL}/auth/reset-password?token={raw_token}"
        if not has_password:
            # The reset page words itself as setting a password, not resetting one.
            link += "&set=1"
        await send_email(
            user["email"], password_reset_email(user["name"], link, has_password=has_password)
        )
        await log_event(
            "password_reset_requested",
            actor_id=str(user["_id"]),
            actor_email=user["email"],
            detail={"has_password": has_password},
        )

    return {"detail": "If an account exists for that email, a reset link has been sent."}


@router.post("/reset-password", status_code=status.HTTP_200_OK)
async def reset_password(body: ResetPasswordRequest):
    db = get_db()
    token_hash = hash_token(body.token)
    user = await db.users.find_one({"reset_token_hash": token_hash})

    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link")

    expires_at = user.get("reset_token_expires_at")
    if expires_at is None or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link")

    await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "password_hash": hash_password(body.new_password),
                "updated_at": datetime.now(timezone.utc),
                "reset_token_hash": None,
                "reset_token_expires_at": None,
            }
        },
    )
    # Every device, not just one — a password reset is usually prompted by a
    # suspected compromise, so anything already signed in (possibly the
    # attacker, possibly on a device the user no longer holds) has to
    # re-authenticate.
    revoked = await sessions.revoke_all_sessions(str(user["_id"]))
    await log_event(
        "password_reset_completed",
        actor_id=str(user["_id"]),
        actor_email=user["email"],
        detail={"sessions_revoked": revoked},
    )

    return {"detail": "Password has been reset. Please sign in again."}


@router.post("/verify-email", status_code=status.HTTP_200_OK)
async def verify_email(body: VerifyEmailRequest):
    db = get_db()
    token_hash = hash_token(body.token)
    user = await db.users.find_one({"verify_token_hash": token_hash})

    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification link")

    expires_at = user.get("verify_token_expires_at")
    if expires_at is None or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification link")

    await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {"email_verified": True, "updated_at": datetime.now(timezone.utc)},
            "$unset": {"verify_token_hash": "", "verify_token_expires_at": ""},
        },
    )

    return {"detail": "Email verified."}


@router.post("/confirm-link", status_code=status.HTTP_200_OK)
async def confirm_link(body: ConfirmLinkRequest):
    """Applies a credential staged by _send_link_confirmation_email.

    No tokens are issued here, deliberately: this endpoint is reachable by
    clicking a link from an email, including automated link-scanners some
    mail providers run — minting a live session on a GET-adjacent action
    would let a scanner log in as the account holder. The user signs in
    normally afterward, the same as after POST /auth/verify-email.
    """
    db = get_db()
    token_hash = hash_token(body.token)
    user = await db.users.find_one({"link_token_hash": token_hash})

    if not user or not user.get("pending_link"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired link")

    expires_at = user.get("link_token_expires_at")
    if expires_at is None or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired link")

    pending_link = user["pending_link"]
    updates: dict = {"email_verified": True, "updated_at": datetime.now(timezone.utc)}
    if pending_link["type"] == "password":
        updates["password_hash"] = pending_link["password_hash"]
    else:
        updates["sso_provider"] = pending_link["sso_provider"]
        updates["sso_external_id"] = pending_link["sso_external_id"]

    spent = {"pending_link": "", "link_token_hash": "", "link_token_expires_at": "", "link_token_sent_at": ""}
    try:
        await db.users.update_one({"_id": user["_id"]}, {"$set": updates, "$unset": spent})
    except DuplicateKeyError:
        # The staged identity was connected to another account (a sign-in with
        # it, or a connect from a profile) after this link was mailed; the
        # unique index on sso_external_id refuses it. The link is spent.
        await db.users.update_one({"_id": user["_id"]}, {"$unset": spent})
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=ALREADY_CONNECTED_ELSEWHERE
        ) from None
    await log_event(
        "account_linked",
        actor_id=str(user["_id"]),
        actor_email=user["email"],
        detail={"type": pending_link["type"]},
    )

    return {"detail": "Account linked. Please sign in."}


@router.post("/resend-verification", status_code=status.HTTP_200_OK)
async def resend_verification(current_user: TokenPayload = Depends(get_current_user)):
    db = get_db()
    user = await db.users.find_one({"_id": current_user.sub})
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.get("email_verified"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is already verified")

    last_sent = user.get("verify_token_sent_at")
    if last_sent is not None:
        elapsed = datetime.now(timezone.utc) - last_sent
        if elapsed < VERIFY_RESEND_COOLDOWN:
            wait = int((VERIFY_RESEND_COOLDOWN - elapsed).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {wait}s before requesting another verification email",
            )

    await _send_verification_email(db, user["_id"], user["email"], user["name"])
    return {"detail": "Verification email sent."}


@router.post("/change-password", response_model=AuthResponse)
async def change_password(
    body: ChangePasswordRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Self-service password change from an authenticated session.

    Distinct from POST /auth/reset-password (unauthenticated, token-based,
    revokes every session unconditionally): here the caller proves knowledge
    of the *current* password rather than an emailed token, so only every
    *other* device is signed out — the calling device gets fresh tokens
    instead, since logging a user out of the request where they just
    changed their own password would be surprising.
    """
    db = get_db()
    user = await db.users.find_one({"_id": current_user.sub})
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not user.get("password_hash"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account has no password set yet. Register with this email to add one.",
        )

    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect"
        )

    await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "password_hash": hash_password(body.new_password),
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    revoked = await sessions.revoke_all_sessions(
        user["_id"], except_session_id=current_user.sid
    )
    await log_event(
        "password_changed",
        actor_id=user["_id"],
        actor_email=user["email"],
        detail={"other_sessions_revoked": revoked},
    )

    return await _issue_tokens(
        db,
        user["_id"],
        user["email"],
        user["role"],
        user["name"],
        session_id=current_user.sid,
    )


DEACTIVATED = "This account has been deactivated. Contact an administrator."
ALREADY_CONNECTED_ELSEWHERE = (
    "This CILogon identity is already connected to another OpenGHM account."
)
BAD_CONNECT_REQUEST = "This connect request is invalid or has expired. Please try again."


def _deactivated() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=DEACTIVATED)


async def _link_account_by_email(db, existing: dict, body: SsoLoginRequest) -> dict:
    """A first CILogon sign-in whose email belongs to an account: connects the
    identity to it, as an ordinary site does for "Sign in with Google", and
    returns the updated account.

    CILogon has just asserted the address, so it is trusted. Two accounts are
    refused instead: a deactivated one, and one already connected to another
    identity (one identity per account; the person signs in with that one).

    An account whose address was never verified may have been registered by
    someone other than the address's owner, who knows its password. The owner
    has now proved the address, so the password is removed and every session
    ended before the new one is issued; the owner can set a password again
    through forgot-password.
    """
    if not existing.get("is_active", True):
        raise _deactivated()
    if existing.get("sso_external_id"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This email's OpenGHM account is connected to a different CILogon "
                "identity. Sign in with that one."
            ),
        )

    unverified = not existing.get("email_verified", False)
    password_removed = unverified and bool(existing.get("password_hash"))
    update: dict = {
        "$set": {
            "sso_provider": body.provider,
            "sso_external_id": body.external_id,
            "sso_email": body.email,
            "email_verified": True,
            "updated_at": datetime.now(timezone.utc),
        }
    }
    if unverified:
        update["$unset"] = {"password_hash": ""}
    try:
        await db.users.update_one({"_id": existing["_id"]}, update)
    except DuplicateKeyError:
        # The same identity connected to another account between the lookup and
        # this write; the unique index on sso_external_id has the last word.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=ALREADY_CONNECTED_ELSEWHERE
        ) from None
    if unverified:
        await sessions.revoke_all_sessions(str(existing["_id"]))

    await log_event(
        "sso_account_linked",
        actor_id=str(existing["_id"]),
        actor_email=existing["email"],
        detail={
            "provider": body.provider,
            "via": "email",
            "password_removed": password_removed,
        },
    )
    return await db.users.find_one({"_id": existing["_id"]})


async def _connect_sso_identity(db, body: SsoLoginRequest) -> SsoLoginResponse:
    """Connects the CILogon identity for the user who asked to connect it.

    The account is named by the connect intent, never by the identity's email:
    the user is already signed in, so there is nothing to match, and their
    CILogon address may differ from the account's (a work address against a
    personal one). The account's email is never changed. It counts as verified
    only when the two are the same address, the one case where CILogon vouches
    for the address the account carries.
    """
    token_hash = hash_token(body.connect_token)
    pending = await pending_sso.find_pending(token_hash, kind=pending_sso.CONNECT)
    if pending is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=BAD_CONNECT_REQUEST
        )
    # Spent whatever comes of it: after a refusal the user presses the button
    # again rather than reusing an intent they cannot act on.
    await pending_sso.delete_pending(token_hash)

    user = await db.users.find_one({"_id": pending["user_id"]})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=BAD_CONNECT_REQUEST
        )
    if not user.get("is_active", True):
        raise _deactivated()

    holder = await db.users.find_one({"sso_external_id": body.external_id})
    if holder is not None and holder["_id"] != user["_id"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=ALREADY_CONNECTED_ELSEWHERE
        )
    if user.get("sso_external_id"):
        # Connected from another tab since the intent was made.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account already has a CILogon identity connected.",
        )

    changes: dict = {
        "sso_provider": body.provider,
        "sso_external_id": body.external_id,
        "sso_email": body.email,
        "updated_at": datetime.now(timezone.utc),
    }
    if body.email is not None and body.email == user["email"]:
        changes["email_verified"] = True
    if body.organization and not user.get("organization"):
        changes["organization"] = body.organization
    try:
        await db.users.update_one({"_id": user["_id"]}, {"$set": changes})
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=ALREADY_CONNECTED_ELSEWHERE
        ) from None

    await log_event(
        "sso_account_linked",
        actor_id=str(user["_id"]),
        actor_email=user["email"],
        detail={"provider": body.provider, "via": "profile"},
    )
    return SsoLoginResponse(status="connected")


@router.post("/sso-connect-intent", response_model=SsoConnectIntentResponse)
async def sso_connect_intent(current_user: TokenPayload = Depends(get_current_user)):
    """The first half of connecting CILogon from the profile: records that
    this signed-in user is about to do it, and hands back the token the
    frontend carries through the CILogon round trip (an httpOnly cookie) to
    POST /auth/sso-login as `connect_token`.

    The token is what ties the CILogon sign-in to this user. Without it that
    sign-in is just a sign-in, and could never be told apart from a new
    visitor's. It lives ten minutes, since the round trip follows the button
    press at once.
    """
    db = get_db()
    user = await db.users.find_one({"_id": current_user.sub})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    if user.get("sso_external_id"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account already has a CILogon identity connected.",
        )

    raw_token, token_hash = _generate_opaque_token()
    await pending_sso.create_connect(token_hash, str(user["_id"]))
    return SsoConnectIntentResponse(connect_token=raw_token)


@router.post("/sso-login", response_model=SsoLoginResponse)
async def sso_login(
    body: SsoLoginRequest,
    x_internal_auth: str | None = Header(default=None, alias="X-Internal-Auth"),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
):
    """CILogon/OIDC handoff — see app.core.config.INTERNAL_SERVICE_SECRET.

    This is NOT a public endpoint despite living next to /login and
    /register: it trusts its caller completely (whatever email/name it's
    given, it will log that identity in), so it's only reachable with the
    shared secret NextAuth's server-side OIDC callback presents. NextAuth
    already verified the id_token against CILogon's JWKS before ever
    calling this — this backend has no OIDC/JWKS code of its own by design
    (see docs/architecture/authentication.md).

    A connected identity signs in to its account. An unknown one is connected
    to the account with the same email, or becomes a new account. With a
    `connect_token` the call is not a sign-in at all but a signed-in user
    connecting this identity from their profile (see _connect_sso_identity).

    Returns `{status: "needs_completion", completion_token}` instead of
    tokens when the provider didn't release an email — ORCID in particular
    often doesn't, depending on the user's own privacy settings. See
    POST /auth/complete-sso-signup for how that gets resolved.
    """
    if not settings.INTERNAL_SERVICE_SECRET or x_internal_auth != settings.INTERNAL_SERVICE_SECRET:
        # Same 401 either way (misconfigured-empty-secret vs wrong secret) —
        # distinguishing them in the response would tell an attacker which
        # case they're in.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal service credentials",
        )

    db = get_db()
    if body.connect_token is not None:
        return await _connect_sso_identity(db, body)

    now = datetime.now(timezone.utc)

    # Looked up by external_id first, regardless of whether email is
    # present this time around — a returning user who already completed
    # their profile once shouldn't be asked again just because this
    # provider call happens not to include email (some providers only
    # release it on first consent).
    user = await db.users.find_one({"sso_external_id": body.external_id})

    if user is None:
        if body.email is None:
            raw_token, token_hash = _generate_opaque_token()
            await pending_sso.create_pending(
                token_hash, body.external_id, body.provider, body.name, body.organization
            )
            return SsoLoginResponse(status="needs_completion", completion_token=raw_token)

        existing = await db.users.find_one({"email": body.email})
        if existing is not None:
            user = await _link_account_by_email(db, existing, body)
        else:
            user_id = str(uuid.uuid4())
            doc = {
                "_id": user_id,
                "email": body.email,
                "name": body.name or body.email,
                "role": Role.USER,
                "organization": body.organization,
                "password_hash": None,  # SSO-only account — no local password
                "email_verified": True,  # SSO identity providers verify email
                "verify_token_hash": None,
                "verify_token_expires_at": None,
                "verify_token_sent_at": None,
                "reset_token_hash": None,
                "reset_token_expires_at": None,
                "is_active": True,
                "sso_provider": body.provider,
                "sso_external_id": body.external_id,
                "sso_email": body.email,
                "created_at": now,
                "updated_at": now,
            }
            await db.users.insert_one(doc)
            user = doc
            await log_event(
                "sso_account_created",
                actor_id=user_id,
                actor_email=body.email,
                detail={"provider": body.provider},
            )

    # Backfill organization regardless of which branch above resolved
    # `user` — including the common case of a *returning* SSO user found
    # directly by external_id, which otherwise would never pick this up
    # even if the IdP has been asserting it on every login all along. Never
    # overwrites a value the user already has (whether set here earlier or
    # by hand via PATCH /users/me).
    backfill: dict = {}
    if body.organization and not user.get("organization"):
        backfill["organization"] = body.organization
    # The address CILogon gave this time, which is what the profile shows as
    # the connected identity's: the provider may have changed it since.
    if body.email and body.email != user.get("sso_email"):
        backfill["sso_email"] = body.email
    if backfill:
        await db.users.update_one({"_id": user["_id"]}, {"$set": backfill})
        user.update(backfill)

    if not user.get("is_active", True):
        raise _deactivated()

    await log_event(
        "login_succeeded",
        actor_id=str(user["_id"]),
        actor_email=user["email"],
        detail={"method": "sso", "provider": body.provider},
    )
    auth = await _issue_tokens(
        db,
        str(user["_id"]),
        user["email"],
        user["role"],
        user["name"],
        user_agent=user_agent,
    )
    return SsoLoginResponse(status="ok", auth=auth)


@router.post("/complete-sso-signup", response_model=AuthResponse | LinkPendingResponse)
async def complete_sso_signup(body: CompleteSsoSignupRequest):
    """Finishes account creation for an SSO identity whose provider didn't
    release an email (see the `needs_completion` branch of sso_login).

    No X-Internal-Auth check here: unlike sso-login, the caller only has
    power over the one identity named in the completion token, not an
    arbitrary email — and it can only reach that far by holding a token
    minted after a real sign-in with the provider.
    """
    db = get_db()
    pending = await pending_sso.find_pending(hash_token(body.completion_token))
    if pending is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This link is invalid or has expired. Please sign in again.",
        )

    if await db.users.find_one({"sso_external_id": pending["external_id"]}) is not None:
        # Completed by a concurrent request (e.g. a double-submit) — the
        # token is spent either way.
        await pending_sso.delete_pending(hash_token(body.completion_token))
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This sign-in has already been completed. Please sign in again.",
        )

    existing = await db.users.find_one({"email": body.email})
    if existing is not None:
        if existing.get("sso_provider") == pending["provider"]:
            # Already linked to this exact provider (a retry/double-submit
            # after a prior confirm-link) — nothing new to stage.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists. Sign in with it directly.",
            )
        # This email was typed in by the user, not asserted by ORCID (that's
        # the whole reason this completion flow exists), so it's just as
        # unverified as register()'s self-typed email — same staged-link
        # treatment, not an immediate merge. See
        # _send_link_confirmation_email.
        await pending_sso.delete_pending(hash_token(body.completion_token))
        await _send_link_confirmation_email(
            db,
            existing["_id"],
            body.email,
            existing["name"],
            {
                "type": "sso",
                "sso_provider": pending["provider"],
                "sso_external_id": pending["external_id"],
            },
        )
        return LinkPendingResponse(email=body.email)

    now = datetime.now(timezone.utc)
    user_id = str(uuid.uuid4())
    doc = {
        "_id": user_id,
        "email": body.email,
        "name": body.name,
        "role": Role.USER,
        "organization": pending.get("organization"),
        "password_hash": None,
        # Self-asserted here, not IdP-verified (that's the whole reason
        # this flow exists) — so unlike the direct sso_login path, this
        # email actually needs the usual verification email.
        "email_verified": False,
        "verify_token_hash": None,
        "verify_token_expires_at": None,
        "verify_token_sent_at": None,
        "reset_token_hash": None,
        "reset_token_expires_at": None,
        "is_active": True,
        "sso_provider": pending["provider"],
        "sso_external_id": pending["external_id"],
        "created_at": now,
        "updated_at": now,
    }
    await db.users.insert_one(doc)
    await pending_sso.delete_pending(hash_token(body.completion_token))

    await log_event(
        "sso_account_completed",
        actor_id=user_id,
        actor_email=body.email,
        detail={"provider": pending["provider"]},
    )
    await _send_verification_email(db, user_id, body.email, body.name)
    await log_event(
        "login_succeeded",
        actor_id=user_id,
        actor_email=body.email,
        detail={"method": "sso", "provider": pending["provider"]},
    )
    return await _issue_tokens(db, user_id, body.email, Role.USER, body.name)
