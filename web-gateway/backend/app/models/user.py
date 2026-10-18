from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, EmailStr, Field
from pydantic_core import PydanticCustomError
from datetime import datetime

from app.core.roles import RoleField

# An address as a request carries it. EmailStr lowercases only the domain, but
# users.email is the account's unique key and looked up by equality, so
# `Ada@Purdue.edu` and `ada@purdue.edu` would be two accounts. Every request
# model that takes an address uses this, so what is stored and what is looked
# up are both lowercase.
LowercaseEmail = Annotated[EmailStr, AfterValidator(str.lower)]

# The one rule for a password someone chooses: registration, a reset link and
# a change all take theirs through `NewPassword`. The frontend checks the same
# length for a quicker answer, but this is the check that holds. It is a
# custom error so the 422 reads "must be at least 8 characters" for the field
# the form names, not pydantic's "Value error, ..." wrapping.
MIN_PASSWORD_LENGTH = 8


def _long_enough(value: str) -> str:
    if len(value) < MIN_PASSWORD_LENGTH:
        raise PydanticCustomError(
            "password_too_short",
            "must be at least {min_length} characters",
            {"min_length": MIN_PASSWORD_LENGTH},
        )
    return value


NewPassword = Annotated[str, AfterValidator(_long_enough)]


class TokenPayload(BaseModel):
    """Decoded payload passed between Next.js and FastAPI."""

    sub: str
    email: EmailStr
    role: RoleField
    name: str
    # Session id (app.core.sessions) — lets POST /auth/logout revoke just
    # the calling device. Optional because tokens minted before multi-device
    # sessions existed, and the dev X-Mock-Role path, carry no session.
    sid: str | None = None


class UserDB(BaseModel):
    """Shape of a document stored in the MongoDB users collection."""

    id: str = Field(alias="_id")
    email: EmailStr
    name: str
    role: RoleField
    organization: str | None = None
    password_hash: str | None = None
    # NOTE: refresh tokens moved to their own collection (app.core.sessions)
    # to support one session per device. Legacy docs may still carry
    # refresh_token_hash / refresh_token_expires_at; those fields are
    # migrated by deploy/local/mongo/migrate_sessions.js and ignored here.
    email_verified: bool = False
    verify_token_hash: str | None = None
    verify_token_expires_at: datetime | None = None
    verify_token_sent_at: datetime | None = None
    reset_token_hash: str | None = None
    reset_token_expires_at: datetime | None = None
    is_active: bool = True
    # Whether a `role: user` may run a simulation (ADR 0024). Only an
    # administrator sets it. admin and staff are permitted implicitly, so it
    # matters for role `user` alone. Legacy documents carry no such key: absent
    # means False.
    can_run_simulations: bool = False
    sso_provider: str | None = None
    sso_external_id: str | None = None
    # The address CILogon gave on the identity's last sign-in. It may differ
    # from `email` (a work address connected to a personal account), so it is
    # kept apart to show which identity is connected.
    sso_email: str | None = None
    # Set when a self-typed email (register, or ORCID's complete-sso-signup)
    # collides with an *existing* account under a different auth method.
    # Since that email isn't verified at the point of collision, the new
    # credential is staged here instead of applied immediately, and only
    # takes effect once the owner clicks the confirm-link email — see
    # POST /auth/confirm-link. `pending_link` holds either
    # {"type": "password", "password_hash": ...} or
    # {"type": "sso", "sso_provider": ..., "sso_external_id": ...}.
    pending_link: dict | None = None
    link_token_hash: str | None = None
    link_token_expires_at: datetime | None = None
    link_token_sent_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}


class UserResponse(BaseModel):
    """Shape returned to callers of /users/me and /users (admin list)."""

    id: str
    email: EmailStr
    name: str
    role: RoleField
    organization: str | None = None
    email_verified: bool = False
    is_active: bool = True
    can_run_simulations: bool = False
    created_at: datetime | None = None


class UserProfileResponse(UserResponse):
    """GET /users/me: the account plus how it signs in. Never the provider's
    own id for the identity (`sso_external_id`) or the password hash, only
    whether a password exists."""

    sso_provider: str | None = None
    sso_email: str | None = None
    has_password: bool = False


# --- Auth request/response models ---


class LoginRequest(BaseModel):
    email: LowercaseEmail
    password: str


class RegisterRequest(BaseModel):
    email: LowercaseEmail
    password: NewPassword
    name: str
    organization: str | None = None
    # Verified server-side against Google's siteverify API before the
    # account is created. See app.services.recaptcha — an empty
    # RECAPTCHA_SECRET_KEY (local dev default) skips verification entirely,
    # so this stays optional rather than required.
    recaptcha_token: str | None = None


class SsoLoginRequest(BaseModel):
    """POST /auth/sso-login — see app.core.config.INTERNAL_SERVICE_SECRET
    for the trust model. `external_id` is the OIDC provider's stable
    subject claim (`sub`), used as the lookup key instead of email since
    email addresses can be reassigned/changed at the identity provider.

    `email` and `name` are optional because not every provider releases
    them — ORCID in particular often withholds email depending on the
    user's own ORCID privacy settings. When email is missing, the endpoint
    can't create an account outright (email is the unique key) and instead
    returns a completion token — see SsoLoginResponse.
    """

    email: LowercaseEmail | None = None
    name: str | None = None
    external_id: str
    provider: str
    # Organization as asserted by the identity provider (e.g. CILogon's
    # idp_name, "Purdue University Main Campus") — trusted at face value
    # since it comes from the IdP, not typed in by the user.
    organization: str | None = None
    # Set when a signed-in user pressed "Connect CILogon" on their profile
    # (POST /auth/sso-connect-intent): the call is then not a sign-in but
    # attaches this identity to that user. The account's own email plays no
    # part, so the two may differ.
    connect_token: str | None = None


class CompleteSsoSignupRequest(BaseModel):
    completion_token: str
    email: LowercaseEmail
    name: str


class UserUpdateRequest(BaseModel):
    """PATCH /users/me — self-service profile edits only. No `role` field:

    role changes must go through admin user-management (USER_MANAGE), never
    through a user editing their own profile.
    """

    name: str | None = None
    organization: str | None = None


class UserListResponse(BaseModel):
    items: list[UserResponse]
    total_count: int
    page: int
    total_pages: int


class UserDetailResponse(UserProfileResponse):
    """GET /users/{user_id} — admin/staff drill-down on one account.

    Extends UserProfileResponse rather than exposing the raw document: the
    stored doc carries password_hash, reset_token_hash, verify_token_hash and
    sso_external_id, none of which may ever reach a response. Built
    field-by-field in the handler, never via UserDetailResponse(**doc).
    """

    updated_at: datetime | None = None
    active_session_count: int = 0
    job_counts: dict[str, int] = Field(default_factory=dict)
    last_login_at: datetime | None = None


class SessionRevokeResponse(BaseModel):
    revoked: int


class UserAdminUpdateRequest(BaseModel):
    """PATCH /users/{user_id} — admin-only (Permission.USER_MANAGE).

    Deliberately separate from UserUpdateRequest: this is the one place
    role, is_active and can_run_simulations can be changed, and it's never
    reachable from a user editing their own profile (see app/api/v1/users.py's self-role and
    last-admin guards for why that matters).

    `email_verified` only goes one way: an admin can vouch for an address
    (the user never got the mail, or it was lost to a filter), not take a
    verification away.
    """

    role: RoleField | None = None
    is_active: bool | None = None
    can_run_simulations: bool | None = None
    email_verified: Literal[True] | None = None


class AuditLogEntry(BaseModel):
    id: str
    action: str
    # Defaulted, not required: events written before the category field
    # existed (see app.core.audit) have no `category` key at all.
    category: str = "auth"
    actor_id: str
    actor_email: str | None = None
    target_id: str | None = None
    detail: dict | None = None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    items: list[AuditLogEntry]
    total_count: int
    page: int
    total_pages: int


class RefreshRequest(BaseModel):
    refresh_token: str


class SessionEntry(BaseModel):
    """One signed-in device (app.core.sessions)."""

    id: str
    created_at: datetime
    last_used_at: datetime
    user_agent: str | None = None
    # True for the session making the request, so a UI can label it
    # "this device" and avoid offering to sign itself out by surprise.
    current: bool = False


class SessionListResponse(BaseModel):
    items: list[SessionEntry]


class ForgotPasswordRequest(BaseModel):
    email: LowercaseEmail


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: NewPassword


class VerifyEmailRequest(BaseModel):
    token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: NewPassword


class ConfirmLinkRequest(BaseModel):
    token: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str
    expires_in: int
    user: UserResponse


class RegisteredResponse(BaseModel):
    """What POST /auth/register answers for a new account. It carries no
    tokens: the form sends the user to sign in, and that sign-in starts the
    device's session. Tokens minted here were never used, and each left a
    session row labelled with the Next.js server's user agent ("node")."""

    status: str = "registered"
    email: EmailStr


class LinkPendingResponse(BaseModel):
    """Returned instead of AuthResponse when a self-typed email (register,
    or ORCID's complete-sso-signup) matches an existing account under a
    different auth method. Deliberately carries no tokens — see
    app.api.v1.auth's pending-link mechanism for why."""

    status: str = "link_pending"
    email: EmailStr


class SsoLoginResponse(BaseModel):
    """Discriminated on `status`: "ok" carries the usual login tokens,
    "needs_completion" means the caller must collect the missing fields
    (see POST /auth/complete-sso-signup) before an account can exist, and
    "connected" answers a `connect_token`: the identity is now attached to the
    signed-in user, who needs no tokens (they already have a session)."""

    status: str
    auth: AuthResponse | None = None
    completion_token: str | None = None


class SsoConnectIntentResponse(BaseModel):
    connect_token: str
