# The gateway — architecture

**Status: built.** This describes what runs today, in `web-gateway/`. Where it
and the code disagree, the code is right and this file is a defect. The shape
we are building *toward* is
[artifact-versioning.md](artifact-versioning.md); nothing on this page is a
plan.

Authentication is large enough to have its own page:
[authentication.md](authentication.md). Registration values — CILogon,
reCAPTCHA, email — are in
`ops/docs/reference/external-services.md` (private).

---

## 1. Two halves, one product

| | |
|---|---|
| `web-gateway/frontend/` | Next.js 16 (App Router), React 19 |
| `web-gateway/backend/` | FastAPI, Python 3.11+, async throughout |

They deploy together, from one commit, into one namespace
([repository-layout.md](repository-layout.md)). There is no third service.

## 2. The request path

```
browser  ──▶  Next.js server  ──▶  FastAPI  ──▶  MongoDB
                    │                  │
                    │                  └──▶  Anvil (SSH) ──▶ SLURM
                    └──▶  CILogon / Google reCAPTCHA
```

**The browser never calls FastAPI.** It is enforced by deployment, not
convention: FastAPI has no Ingress. The Ingress routes `/` to the frontend
Service and nothing else, and `BACKEND_URL` is `http://openghm-backend:8100` —
a ClusterIP name that does not resolve outside the namespace. A fetch moved
from the server into a client component does not merely change where it runs;
it has nowhere to go.

Authenticated pages fetch on the server through
`web-gateway/frontend/lib/api-client.ts`, which attaches the backend JWT from
the NextAuth session.

Five pages cannot do that, because they run before there is a session:
`register`, `verify-email`, `forgot-password`, `reset-password` and
`confirm-link`. They post to **`/api/public-auth/<action>`**, a Route Handler
on the frontend's own origin that forwards to the backend with the server-side
`BACKEND_URL`. Its allowlist is those five actions and nothing else — it must
never become a general proxy into an API whose other routes expect an
`Authorization` header the browser does not have.

That handler exists to keep a `NEXT_PUBLIC_` variable out of the request path.
Next.js inlines those at `next build`, and this project promotes **one built
image** from dev to prod (the `promote-frontend` recipe in the private ops
repository), so a build-time URL can be
correct in at most one environment. It had been correct in neither: the five
pages used `NEXT_PUBLIC_BACKEND_URL`, which was set nowhere, so the deployed
bundle carried its `http://localhost:8100` default and registration, password
reset and email verification reached nothing at all.

The same rule governs the reCAPTCHA site key. It is public, but it is
`RECAPTCHA_SITE_KEY` rather than `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`:
`web-gateway/frontend/app/auth/register/page.tsx` is a `force-dynamic` server
component that reads it per request and hands it to the client form.
**A `NEXT_PUBLIC_` variable in this codebase is a bug** — there is no
build-arg plumbing for one, and adding it would tie an image to an
environment.

`proxy.ts` at the frontend root is the NextAuth middleware — Next.js 16 renamed
`middleware.ts` to `proxy.ts`. It redirects unauthenticated requests for
`/dashboard`, `/simulations` and `/admin` to the sign-in page. It is a
redirect, not the authorization check; that happens in FastAPI
([authentication.md](authentication.md)).

## 3. The stack, as built

Read this table as an inventory, not as an intent. Several things a reader
expects are deliberately absent, and §6 says which.

| Layer | What is actually there |
|---|---|
| Frontend | Next.js 16.1.6, React 19.2.3, App Router |
| UI | Tailwind CSS 4, shadcn/ui on radix-ui, `sonner` toasts, `next-themes` |
| Client state | Zustand |
| Maps and charts | Leaflet + react-leaflet for bounding boxes. **No chart library** — `web-gateway/frontend/components/charts/` holds two hand-written components that render on the server with zero client JS |
| Frontend auth | NextAuth v5 (Auth.js) |
| Frontend → backend | axios, server-side only |
| Backend | FastAPI 0.115, uvicorn, pydantic 2 / pydantic-settings |
| Database driver | motor (async pymongo) |
| Tokens | `python-jose` for JWTs, `bcrypt` for passwords |
| Email | `resend` — password reset and verification only |
| HPC | `slurmly`, pinned to a git commit; not on PyPI |

## 4. Where state lives

One MongoDB database, `openghm`. Six collections, and every index on them is
created at startup in `web-gateway/backend/main.py` — that file is the
schema, in the sense
that nothing else declares one.

| Collection | Holds |
|---|---|
| `users` | accounts; `email` is unique |
| `jobs` | one document per **simulation** — draft or submitted, including the SLURM ids once it runs |
| `refresh_tokens` | one document per signed-in device, TTL-reaped |
| `pending_sso_signups` | half-finished SSO sign-ups, 30-minute TTL |
| `audit_events` | append-only, `auth` and `job` categories |
| `datasets` | the browsable catalogue |

Each `datasets` document is a snapshot's `metadata.json`
([ADR 0017](../decisions/0017-the-spec-is-the-source-of-truth.md)) — the
spec's own shape, verbatim, plus the `_id` Mongo requires (mirroring the
spec's own `id`). `POST /api/v1/repository/datasets` is the write path;
Mongo's unique `_id` rejects a repeat of the same snapshot with `409` rather
than silently overwriting it, which would break rule 1. Before this, nothing
populated the collection at all: a seed function reset it to three hard-coded
documents on every startup, carrying real researchers' names and emails as
demo data — not appropriate for a public instance — and was the collection's
*only* writer, so removing it rather than scrubbing it left nothing behind
until this write path replaced it.

A `jobs` document is a **simulation**: mutable while its `status` is `DRAFT`,
read-only from the moment it is submitted (mission `2026-09-20-simulations`,
private). `POST /api/v1/jobs/derive/{dataset_id}` creates a draft pre-filled
from a published snapshot's parameters — the only creation path, since
starting one from nothing would need a model-input catalogue the gateway
does not have yet. `PATCH`/`DELETE /api/v1/jobs/{id}` refuse with `409` once
the status has moved past `DRAFT`, so a finished run's own record cannot be
rewritten under it. A simulation and a snapshot are deliberately not the same
document: the spec's `runtime.execution` requires `startedAt`, `finishedAt`
and `slurmJobId`, none of which a draft can honestly carry, and a
finished simulation is not itself in `datasets` until someone publishes it —
a step that does not exist yet ([open items
9](../reference/open-items.md) and [10](../reference/open-items.md), **Next**
list *job output reaches S3*).

MongoDB runs as a StatefulSet with a PersistentVolumeClaim
(`ops/k8s/<env>/mongo.yml`). That is the one place cluster state exists, and
it predates the rule against it in [`../../AGENTS.md`](../../AGENTS.md) — which
governs what the *snapshot* pipeline deploys, not the gateway's database.

## 5. The two paths that leave the cluster

### Data — links, not bytes

The backend holds no S3 credentials and makes no S3 API calls. It concatenates
`S3_PUBLIC_BASE_URL`, a bucket and a key into a public HTTPS string and returns
that; the browser downloads from Anvil S3 directly, bypassing the API. The
config file states this in a comment, and there is no S3 client in
`requirements.txt` to contradict it.

`S3_BUCKET_DATA` and `S3_BUCKET_OUTPUTS` are set to `openghm-data` and
`openghm-outputs` in both environments. Neither exists — both return 404 from
the endpoint, where `openghm` returns 200. The real bucket is `openghm` with
prefixes ([`../reference/s3-layout.md`](../reference/s3-layout.md)). Nothing
has broken yet only because no route builds a link from either value.

### Jobs — SSH, and no queue

`POST /jobs` inserts the job document and then **awaits the SLURM submission in
the request**. There is no worker and no broker.
`web-gateway/backend/app/services/slurm.py` holds one lazily-created
`slurmly.SlurmSSHClient` behind an asyncio lock and does
`sbatch` / `squeue` / `sacct` / `scancel` / SFTP-log-tail over that one SSH
connection, as `x-openghm`, with the key from `ANVIL_SSH_KEY_CONTENT`
(`ops/docs/reference/secrets.md`, private).

Status is pulled, never pushed. A background asyncio task started in the
lifespan handler sweeps every non-terminal job every
`JOB_BACKGROUND_SYNC_INTERVAL` seconds (60), and the status route runs the same
`update_job_status()` on demand. The frontend polls; there are no server-sent
events.

The batch script's body is one `apptainer run` line built from
`ANVIL_CONTAINER_IMAGE`, with job parameters passed as `OPENGHM_*` environment
variables. **`ANVIL_CONTAINER_IMAGE` is unset in both `ops/k8s/dev/` and
`ops/k8s/prod/`**, so every deployed job runs the fallback the code emits
instead: a single `echo`. Jobs submit, queue, run and complete correctly — they
just do not compute anything.

Such a job now says so. `is_placeholder_run()` is checked at submission and
writes `status_reason` onto the job document, which the job page already
renders, and the backend logs a warning once per pod at startup. A COMPLETED
job that computed nothing is no longer indistinguishable from one that did.

Setting the variable is **not** the remaining step, and doing it alone would
turn silent no-ops into failures: the deployed SIFs' runscript is `/bin/bash`,
so they take a command rather than those flags, and a real run binds a staged
snapshot and executes `wbm.pl` against an init file
(`ops/docs/reference/anvil-environment.md`, private).
Nothing in the job model names a snapshot or an init —
[open item 9](../reference/open-items.md).

Nothing uploads output. The job script writes to Anvil, and the step that
copies results to S3 is not written; it is on the
Next list in `ops/missions/README.md` (private).

## 6. What is absent, and not by oversight

Each row below was described as present in the v1.1 gateway overview that this
document replaces, or is what a reader of a typical FastAPI project would
assume. None of them is here:

| Expected | Reality |
|---|---|
| Celery workers | none. Submission is inline, status is polled (§5) |
| A Redis broker | `deploy/local/` starts one and `REDIS_URL` has a default, but **no code reads it**, and there is no Redis in either cluster manifest. It is a leftover |
| An S3 client in the backend | none, deliberately (§5) |
| MinIO | removed; see `ops/docs/reference/anvil-environment.md` (private) |
| MongoDB Atlas | self-hosted, in-cluster |
| Deck.gl / Plotly | not installed; Leaflet and two SVG components (§3) |
| A `/catalog/search` endpoint | the routes are `/repository/datasets` |

## 7. Audit log

`web-gateway/backend/app/core/audit.py` appends to `audit_events`; admins and
staff read it at `GET /admin/audit-log`. Every event carries a category,
because the two streams
have nothing in common: `auth` is low-volume and security-relevant (sign-in
success and failure, registration, password reset, role and status changes, SSO
account creation and linking), `job` is operational (submission, cancellation,
SLURM transitions).

Job-status events are written **only at genuine transitions**. `update_job_status()`
runs on every background tick and every status-page load, so the audit call
lives inside its `new_status != current` branch. A poll that finds nothing
changed never reaches it. That placement is the only thing keeping the log from
filling with polling noise — preserve it if that function is ever restructured.
