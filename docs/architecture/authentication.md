# Authentication and authorization — architecture

**Status: built.** Every mechanism below exists in the code today. CILogon has
run against the real provider locally, for connect and sign-in; nothing has run
it on `dev` yet (§3). Registration values and setup steps are in
`ops/docs/reference/external-services.md` (private); this
page is the shape.

The gateway around it: [gateway.md](gateway.md).

---

## 1. Two questions, two modules

`web-gateway/backend/app/core/security.py` answers **who is this** — it decodes
the JWT and returns a `TokenPayload`.
`web-gateway/backend/app/core/authz.py` answers **is that identity allowed to
do this** — `require_permission(...)` as a route dependency, `can(...)` for
owner-or-privileged branches inside a handler.

They are separate because the second must never be answered by comparing role
strings. Roles are a closed set of four (`admin`, `staff`, `user`, `guest`) and
permissions are their own enum in `web-gateway/backend/app/core/roles.py`:

```
guest  repository:view
user   + job:submit, job:view:own, job:cancel:own
staff  + job:view:any, job:cancel:any, user:view:any
admin  + user:manage, repository:manage, system:view, system:manage, content:manage
```

`ROLE_PERMISSIONS` is the whole policy, in one file, as frozensets. "Who can
view any job" and "who can manage users" stay independent axes instead of an
org-chart rank baked into every call site. `repository:manage` is defined and
no endpoint uses it — the catalogue is seed data
([gateway.md §4](gateway.md#4-where-state-lives)). `content:manage` gates every
write to the Community page (`/admin/community`).

**Running a simulation needs more than a role**
([ADR 0024](../decisions/0024-who-may-run-a-simulation.md)). Every simulation spends
the one shared SLURM allocation, so the routes that create or submit a job do
not trust the token. They read the user's document at call time, through
`require_active_user` (a snapshot draft: derive and duplicate) and `require_submitter`
(a submit) in `authz.py`.

- **A submit needs:**
  - `is_active` and `email_verified`. The emailed link sets `email_verified`.
    An admin can also set it, but only to true, with "Mark verified" on the
    user's page, which calls `PATCH /users/{id}`. That spends the link and is
    audited as `user_admin_updated`;
  - role `admin` or `staff`, or role `user` with `can_run_simulations: true` (the "Can run simulations" switch
    on the user's page; the stored field keeps its name).
    Only an admin sets that flag, on `PATCH /users/{id}`, and the change is
    audited as `user_admin_updated`.
  - no more than `JOB_MAX_ACTIVE_PER_USER` active jobs. Admin and staff are
    exempt.
- **A mock identity** (`security.py`'s `MOCK_USERS`) never submits, in any
  environment, even if a user document carries its id. It has no document
  unless someone creates one, so it cannot create snapshot drafts either
  (`account_not_found`).
- **Refusals** carry `detail = {code, message}`:
  - 403: `mock_identity`, `account_not_found`, `account_inactive`,
    `email_not_verified`, `not_permitted_to_run`, `permission_required`;
  - 429: `active_job_limit`.
- **A job the caller may not see is a 404** on every by-id job route, the same
  as a missing one. Staff and admin see and cancel through `job:view:any` and
  `job:cancel:any`.

The frontend's `proxy.ts` also gates `/dashboard` and `/admin`, but that is a
redirect for the user's benefit. Nothing is authorized there. It keeps the query
in `callbackUrl`, and treats a session whose refresh failed (`session.error`) as
signed out. The one exception is a server action from a page that is already
open, which is let through so it can return "session expired" as data. A job
page then shows a sign-in banner instead of an error.

`/workspace` is not redirected. A signed-out visitor, or one whose session
ended, gets the Workspace page with a "Sign in to use the Workspace" (or "Your
session has ended") card in place of its content, whose Sign in button returns
to the same page and query. Each Workspace page decides this itself
(`workspaceSession()` in `web-gateway/frontend/lib/auth-guard.ts`). A job or
draft page shows the same card when the backend answers 401 to its first read.

## 2. Three ways to become a request identity

`get_current_user()` resolves in this order:

1. **`Authorization: Bearer <JWT>`** — HS256, signed with `SECRET_KEY`, decoded
   locally. Works in every environment. A payload that no longer parses (a role
   renamed since the token was minted, say) is a 401, not a 500.
2. **`X-Mock-Role: admin|staff|user|guest`** — password-free login, honoured
   **only** when `ENVIRONMENT=development` **and** `ALLOW_MOCK_AUTH=true`.
3. Otherwise 401.

The two flags are separate on purpose. `ENVIRONMENT=development` also selects
logging and debug behaviour, so a dev-flavoured deployment that is reachable
from the internet keeps it and sets `ALLOW_MOCK_AUTH=false`. That is exactly
what `ops/k8s/overlays/dev/` does. Production ignores `X-Mock-Role` regardless of any
flag.

**With mock auth on, a request carrying no header at all is authenticated as
`user`** — not rejected. That is what makes local development frictionless and
what makes `ALLOW_MOCK_AUTH=true` on a public host a full authentication
bypass, not a weakening of one. `ENVIRONMENT` defaults to `production` and
`ALLOW_MOCK_AUTH` to `false`, so a deployment that forgets both lands in the
strict mode.

## 3. Sign-in paths

### Email and password

bcrypt hashes; `POST /auth/register` behind reCAPTCHA when a key is configured;
verification email and password reset by emailed token.

**An email address is lowercased wherever it is taken or stored.** Every request
model that carries one uses `LowercaseEmail`
(`web-gateway/backend/app/models/user.py`), because `users.email` is the unique
key and is looked up by equality: `Ada@Purdue.edu` and `ada@purdue.edu` would
otherwise be two accounts. `main.py` lowercases the addresses stored before that
at every startup (`app/core/account_startup.py`). Two accounts that would collide
once lowercased are left exactly as they are, and a warning names both ids.

Sign-in goes through NextAuth's credentials provider, server-side. A refusal
reaches the sign-in page as one line for a wrong email or password alike; only
two reasons are named, as the `code` of the refusal: `deactivated` (the backend
says so only after the password was right) and `rate_limited` (a 429). The other
five — register, verify-email, forgot-password, reset-password, confirm-link —
run before a session exists and post to the frontend's own
`/api/public-auth/<action>` Route Handler, which forwards them
([gateway.md §2](gateway.md#2-the-request-path)).

An emailed link spends its token only when the person on the page presses
its button — the verify-email and confirm-link pages send nothing on load.
Mail providers open the links in a message before delivering it, and Purdue's
does: on `dev` a verification was spent 25 seconds after sending, minutes
before the mail reached the inbox. Spending on load would let that scanner
verify an address, or confirm a password someone else staged on the account
through `register`. Every email is built from one layout,
`web-gateway/backend/app/services/email_templates.py`, with an HTML and a
plain-text part.

### CILogon

CILogon, an OIDC broker in front of many identity providers (Purdue, ORCID,
Google), works the way "Sign in with Google" does on an ordinary site
([ADR 0035](../decisions/0035-cilogon-is-ordinary-sso.md)): an identity is
connected to one account, and a connected identity signs in to it. It has run
against the real provider locally, for sign-in and for connecting from the
profile. Nothing has run it on `dev`.

Two halves, both in the gateway:

- `web-gateway/frontend/lib/auth.ts`'s `cilogonProvider()` returns an OIDC
  provider, or `undefined` when `CILOGON_CLIENT_ID` or `CILOGON_CLIENT_SECRET` is
  empty, in which case NextAuth never lists it. `cilogonConfigured` exports that
  decision, made on the server, so the profile page offers "Connect CILogon" only
  where it can work. The sign-in page's button is gated on `getProviders()` at
  runtime, not on a build-time flag, so it appears by itself once the variables
  are set and the pod restarts. `CILOGON_CLIENT_ID` is `""` in
  `ops/k8s/base/frontend.yml`; registering a client is
  `ops/docs/reference/external-services.md` (private).
- `POST /auth/sso-login` accepts an identity NextAuth has already verified.

The trust model is the part worth understanding before touching it. **The
backend never talks to CILogon.** NextAuth performs the OIDC handshake and
verifies the `id_token` against CILogon's JWKS server-side; `POST /auth/sso-login`
then trusts NextAuth's assertion, authenticated by `INTERNAL_SERVICE_SECRET` —
one random string that must be byte-identical on frontend and backend. Without
it that endpoint would let anyone mint a session for any email by naming it,
which is why it is empty by default rather than having a guessable placeholder.

**An account holds at most one identity.** `sso_provider`, `sso_external_id`
(CILogon's `sub`, never sent to a browser) and `sso_email` are fields of the
`users` document, and a unique index on `sso_external_id`, partial over strings
(`app/core/account_startup.py`; `deploy/local/mongo/init-mongo.js` seeds the same
one), keeps an identity on one account. `sso_email` is the address CILogon gave
on the identity's last sign-in. It may differ from the account's `email`, and the
profile shows it so the owner can tell which identity is connected.

#### Signing in

`POST /auth/sso-login` decides in this order:

1. **The identity is connected to an account**: sign in to that account. The
   session's id, name and email are the account's, taken from the backend's
   answer in the `signIn` callback of `lib/auth.ts`; the CILogon profile never
   supplies them. `sso_email` is refreshed to what CILogon gave this time.
2. **The identity is unknown and CILogon gave an email that an account holds**
   (compared lowercase): connect the identity to that account and sign in,
   setting `email_verified`. CILogon's assertion of the address is trusted, as an
   ordinary site trusts Google's. Two accounts are refused: a deactivated one
   (401), and one already connected to a *different* identity (409; the person
   signs in with that one).
   If the account's address was **not verified**, connecting it also removes its
   password and revokes every one of its sessions before the new one is issued:
   someone else may have registered the owner's address and know that password.
   The owner can set one again through forgot-password. A verified account keeps
   its password and its other sessions. The audit event `sso_account_linked`
   records `via: "email"` and whether the password was removed.
3. **The identity is unknown and no account holds the address**: create an
   account (`role: user`, `email_verified: true`) with `sso_email` set.
4. **CILogon gave no email**: the flow below.

Whichever account results, CILogon's `idp_name` (e.g. "Purdue University Main
Campus", with the `org.cilogon.userinfo` scope) fills its **`organization`** only
while that is empty; it never overwrites one the user set through
`PATCH /users/me`.

A refused sign-in does not end on NextAuth's error page, which cannot say why.
`signIn` returns a redirect to `/auth/signin?sso=` `conflict` (409),
`deactivated` (401 whose detail says so) or `failed` (anything else, including
an unreachable backend), and the sign-in page words each. NextAuth's own
`?error=` reads as `failed`.

#### Connecting from the profile

Connecting is for an identity whose address differs from the account's (a work
address against a personal one), so the account is named by the request rather
than matched by email:

1. **Connect CILogon** on the profile calls `POST /auth/sso-connect-intent`
   (signed in; 409 if the account already has an identity). The backend stores a
   10-minute document of kind `connect` in `pending_sso_signups` and returns its
   token. The server action `connectCilogon` keeps it in the httpOnly,
   `SameSite=Lax` cookie `openghm_sso_connect`, as `${userId}:${token}`; Lax is
   what lets the cookie come back on CILogon's cross-site redirect.
2. The browser goes to CILogon with `prompt=login`, so a CILogon session someone
   else left open in this browser is not what gets connected.
3. The `signIn` callback reads the cookie and deletes it, whatever happens. It
   passes the token as `connect_token` only while `auth()` says the user the
   cookie names is still the one signed in; for anyone else, or nobody, the
   cookie is ignored and this is an ordinary sign-in.
4. With a `connect_token`, `POST /auth/sso-login` is not a sign-in. The intent is
   spent whatever follows. The identity is attached to the intent's account;
   the account's email never changes, `email_verified` is set only when CILogon's
   address equals the account's, and `organization` is filled only if empty. It
   answers `connected` with no tokens, and the callback returns to
   `/dashboard/profile?sso=connected`, leaving the existing session untouched.
   An identity another account holds is a 409, an account that meanwhile got an
   identity is a 409, a bad or expired token is a 400, a deactivated account is a
   401; the callback sends a 409 to `?sso=conflict` and any other failure to
   `?sso=failed`. The profile toasts the result once. `sso_account_linked` is
   audited with `via: "profile"`.

Nothing is merged: an identity already held by another account stays there, and
a person with two accounts is sorted out by an administrator.

#### Disconnecting, and a password for a CILogon-only account

`DELETE /users/me/sso` removes the three fields. It is refused (400) when no
identity is connected, and when the account has no password, since CILogon would
be its only way in. `sso_account_unlinked` is audited.

An account CILogon created has no password, so `POST /auth/forgot-password` mails
a link to any **active** account that has a password *or a verified email*. The
link carries `&set=1` when there is no password, and the email and
`/auth/reset-password` then say "Set a password" rather than "Reset". It still
answers 200 for every address. Setting a password revokes the account's sessions,
as a reset does.

`GET /users/me` and the admin's user detail expose `sso_provider`, `sso_email`
and `has_password`, never `sso_external_id` or the hash. The profile's "Sign-in
methods" lists the password and, where CILogon is configured, its state; the
admin card's "Sign-in method" row names CILogon and `sso_email`.

### CILogon when the provider withholds an email

Not every identity provider behind CILogon releases one; ORCID in particular
often does not, depending on the user's own privacy settings. `email` is the
unique key, so the account cannot be created:

1. `POST /auth/sso-login` stashes what it does have — external id, provider,
   name and organization if present — in `pending_sso_signups` (kind `signup`, a
   30-minute TTL) and returns `{status: "needs_completion", completion_token}`.
2. `signIn()` in `web-gateway/frontend/lib/auth.ts` sees that status and
   returns a redirect to `/auth/complete-profile?token=…` instead of finishing
   sign-in. Returning a URL from that callback is what NextAuth treats as a
   redirect.
3. That page collects the missing email and name and hands them to a second
   NextAuth provider, `sso-complete`, which calls
   `POST /auth/complete-sso-signup` server-side and signs the user in with the
   result. The account is created with `email_verified: false`, because this
   address was typed by the user rather than asserted by the identity provider,
   so it goes through the normal verification flow. If an account already holds
   that address, nothing is attached: the identity is staged on it and a
   confirmation email goes to the address (`POST /auth/confirm-link`), because a
   typed address proves nothing. `POST /auth/register` does the same for a
   password when the address belongs to an account with none.

No reCAPTCHA on that page: reaching it already required a successful sign-in
with a real identity provider, a higher bar than a captcha adds.

## 4. Sessions and tokens

| | |
|---|---|
| Access token | JWT, `JWT_EXPIRE_MINUTES` (60), carries `sub`, `email`, `name`, `role`, `sid` |
| Refresh token | opaque random string, `REFRESH_TOKEN_EXPIRE_DAYS` (30) |
| Stored | only the refresh token's SHA-256, in `refresh_tokens` |

**One document per sign-in.** Signing in on a second device does not
disturb the first — that is the whole reason the collection exists rather than
a field on the user. A row goes when its device signs out, when it is revoked,
or 30 days after its last refresh; a browser that drops its cookie without
signing out leaves its row until then, so one person's list can hold several
rows for the same machine. Registering starts no session: the form sends the
new user to sign in. The session id also rides in the access token's `sid`
claim, which is how `POST /auth/logout` revokes just the calling device without
the client ever sending its refresh token back.

**Refreshing rotates in place.** The presented token stops working immediately,
so a stolen refresh token is detectable: whoever refreshes second gets a 401.

Everything is revoked, on every device, when the account's control may have
changed hands — password reset, admin deactivation. `POST /auth/logout-all`
does the same on request, and `GET /auth/sessions` /
`DELETE /auth/sessions/{id}` let a user see and prune their own devices.

The same view over *another* user, `/users/{id}/sessions`, is gated on
`user:manage` — **admin only, not staff**, unlike the rest of the staff
read-surface. A session row's `user_agent` is device-fingerprinting data about
a named person, and the only reason to look at one is to decide whether to
revoke it, so reading and revoking share a gate instead of splitting read from
write.

A Mongo TTL index on `expires_at` reaps expired sessions. Every read path still
checks expiry itself rather than trusting it, because Mongo's reaper runs about
once a minute.

**Deploying this into an environment that predates it needs
`just migrate-sessions` (against a cluster, the `k8s-migrate-sessions` recipe
in the private ops repository)**, which carries
existing single-field refresh tokens into the collection. Skip it and everyone
signed in at deploy time is silently signed out. A fresh environment does not
need it — there is nothing to carry.
