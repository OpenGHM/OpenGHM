# Authentication and authorization — architecture

**Status: built.** Every mechanism below exists in the code today. The one
thing that does *not* work yet is CILogon, and §3 says exactly how far it got
and what is missing. Registration values and setup steps are in
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
admin  + user:manage, repository:manage, system:view, system:manage
```

`ROLE_PERMISSIONS` is the whole policy, in one file, as frozensets. "Who can
view any job" and "who can manage users" stay independent axes instead of an
org-chart rank baked into every call site. `repository:manage` is defined and
no endpoint uses it — the catalogue is seed data
([gateway.md §4](gateway.md#4-where-state-lives)).

**Running a simulation needs more than a role**
([ADR 0024](../decisions/0024-who-may-run-a-simulation.md)). Every simulation spends
the one shared SLURM allocation, so the routes that create or submit a job do
not trust the token. They read the user's document at call time, through
`require_active_user` (a snapshot draft: derive and duplicate) and `require_submitter`
(a submit) in `authz.py`.

- **A submit needs:**
  - `is_active` and `email_verified`;
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

The only path that works end to end. bcrypt hashes; `POST /auth/register`
behind reCAPTCHA when a key is configured; verification email and password
reset by emailed token.

Sign-in goes through NextAuth's credentials provider, server-side. The other
five — register, verify-email, forgot-password, reset-password, confirm-link —
run before a session exists and post to the frontend's own
`/api/public-auth/<action>` Route Handler, which forwards them
([gateway.md §2](gateway.md#2-the-request-path)).

### CILogon — scaffolded, never activated

Both halves of the code exist and neither has ever run against the real
provider:

- `web-gateway/frontend/lib/auth.ts`'s `cilogonProvider()` returns an OIDC
  provider — or `undefined` when `CILOGON_CLIENT_ID` is empty, in which case
  NextAuth simply never lists it.
- `POST /auth/sso-login` accepts an identity NextAuth has already verified.

**No CILogon client has been registered**, so `CILOGON_CLIENT_ID` is `""` in
`ops/k8s/base/frontend.yml` (so in both environments), and the sign-in page's CILogon
button stays hidden. The button is gated on `getProviders()` at runtime, not on
a build-time flag, so it appears by itself once the variables are set and the
pod restarts. Registering the client is
`ops/docs/reference/external-services.md` (private).

The trust model is the part worth understanding before touching it. **The
backend never talks to CILogon.** NextAuth performs the OIDC handshake and
verifies the `id_token` against CILogon's JWKS server-side; `POST /auth/sso-login`
then trusts NextAuth's assertion, authenticated by `INTERNAL_SERVICE_SECRET` —
one random string that must be byte-identical on frontend and backend. Without
it that endpoint would let anyone mint a session for any email by naming it,
which is why it is empty by default rather than having a guessable placeholder.

First CILogon sign-in creates a local account (`role: user`,
`email_verified: true`), unless a password account already holds that email, in
which case the SSO identity is linked to it. If the provider asserts `idp_name`
— it does with the `org.cilogon.userinfo` scope, e.g. "Purdue University Main
Campus" — it is stored as the account's **`organization`**. It never overwrites
one the user set themselves through `PATCH /users/me`.

### CILogon when the provider withholds an email

Not every identity provider behind CILogon releases one; ORCID in particular
often does not, depending on the user's own privacy settings. `email` is the
unique key, so the account cannot be created:

1. `POST /auth/sso-login` stashes what it does have — external id, provider,
   name and organization if present — in `pending_sso_signups` with a 30-minute
   TTL, and returns `{status: "needs_completion", completion_token}`.
2. `signIn()` in `web-gateway/frontend/lib/auth.ts` sees that status and
   returns a redirect to `/auth/complete-profile?token=…` instead of finishing
   sign-in. Returning a URL from that callback is what NextAuth treats as a
   redirect.
3. That page collects the missing email and name and hands them to a second
   NextAuth provider, `sso-complete`, which calls
   `POST /auth/complete-sso-signup` server-side and signs the user in with the
   result. The account is created with `email_verified: false`, because this
   address was typed by the user rather than asserted by the identity provider,
   so it goes through the normal verification flow.

No reCAPTCHA on that page: reaching it already required a successful sign-in
with a real identity provider, a higher bar than a captcha adds.

## 4. Sessions and tokens

| | |
|---|---|
| Access token | JWT, `JWT_EXPIRE_MINUTES` (60), carries `sub`, `email`, `name`, `role`, `sid` |
| Refresh token | opaque random string, `REFRESH_TOKEN_EXPIRE_DAYS` (30) |
| Stored | only the refresh token's SHA-256, in `refresh_tokens` |

**One document per signed-in device.** Signing in on a second device does not
disturb the first — that is the whole reason the collection exists rather than
a field on the user. The session id also rides in the access token's `sid`
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
