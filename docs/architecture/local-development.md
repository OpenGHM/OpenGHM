# Local development

**Status: built.** Everything below is how development works today.

Which parts run on a laptop, which run once in the cluster, and why the split
falls where it does.

## Three tiers

| Tier | Components | On a laptop | Why |
|---|---|---|---|
| **Shared, remote only** | Anvil S3, zot, the schema host | never | Large and nearly static. All three are **anonymous-read**, so a laptop needs no credentials to use them. |
| **Local dependencies** | MongoDB | `deploy/local/` compose, port 27418 | Small, and a developer mutates their data — isolation matters more than sharing. |
| **Started, unused** | Redis | `deploy/local/` compose | Nothing reads `REDIS_URL`, and neither cluster runs one. A leftover — [gateway.md](gateway.md#6-what-is-absent-and-not-by-oversight). |
| **Source** | frontend, backend, `openghm` | the frontend on the host (`npm run dev`, port 3100); the backend in the compose stack with its source bind-mounted and `uvicorn --reload` (port 8100); `openghm` installed from `packages/openghm` | Changes constantly. |

The gateway already works this way. `web-gateway/backend/app/core/config.py` says it: the
backend never talks to S3 directly, jobs upload from Anvil compute nodes with
their own credentials, and datasets are served as plain public HTTPS links. The
backend only builds link strings.

## Running it

| Recipe | Does |
|---|---|
| `just install dev` | Copies `web-gateway/backend/.env.example` to `.env` and `web-gateway/frontend/.env.local.example` to `.env.local` where they are absent, and runs `npm install`. Both env files are gitignored. |
| `just run dev` | Builds the backend image on the first run, starts MongoDB, Redis and the backend, waits for `GET /health`, then runs the frontend on the host. The backend installs `requirements.txt` when its container starts, so `just rebuild` is only for a changed Dockerfile. |
| `just down`, `just down-volumes`, `just ps`, `just logs`, `just logs-all`, `just rebuild` | Compose helpers; `down-volumes` deletes the data volumes. |
| `just db-reset` | Wipes the MongoDB volume and restarts it, so the seed runs again. |
| `just migrate-roles`, `migrate-sessions`, `migrate-seed-users`, `migrate-catalogue-envelope` | One-off, idempotent scripts from `deploy/local/mongo/` for a volume that predates a change. |
| `just codegen`, `just schema-docs-gen` | Regenerate the backend models, frontend types and schema docs ([repository-layout.md](repository-layout.md#generated-files)). |

The example env files set `ENVIRONMENT=development` and `ALLOW_MOCK_AUTH=true`, so
the local backend honours `X-Mock-Role` ([authentication.md](authentication.md#2-three-ways-to-become-a-request-identity));
the frontend sends it only under `next dev` and only when a session carries no
backend token. The sign-in page's "Dev quick login" buttons exist only under `next dev`
(see the seed, below). With no `RESEND_API_KEY` the backend logs each email's body
instead of sending it. With no `RECAPTCHA_SECRET_KEY` registration skips the captcha,
with no `CILOGON_CLIENT_ID` and `CILOGON_CLIENT_SECRET` the sign-in page has no CILogon
button, and with no `INTERNAL_SERVICE_SECRET` the sign-in throttle has no per-IP counter.
Running the test suites is in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## The property that falls out

**A laptop is read-only against everything shared.** Pulling an image, fetching
a schema, reading a dataset — all anonymous. Publishing a snapshot, pushing an
image, publishing a schema are CI and operator actions.

That is not just convenience. It matches the constitution's *published means
immutable*: a laptop should not be able to write to a published prefix at all.

## What `deploy/local/` deliberately omits

The compose stack brings up MongoDB, Redis and the backend. It does **not** bring up
an S3 implementation or a registry. Opening the file and not finding them is the
signal that those are remote — see
`ops/docs/reference/environments.md` (private) for the full
matrix of which endpoint each environment uses.

## The one gap

Developing the *publish* paths needs somewhere writable — uploading a test
snapshot, updating a manifest, publishing a schema version. Reading is solved;
writing is not decided. The options are under
the Next list in `ops/missions/README.md` (private). The one writable route that
exists is the real one: a snapshot draft's publish job
([gateway.md](gateway.md#publishing-a-second-job-under-an-id-minted-first)) runs on
Anvil as the gateway's account with the credentials file `ANVIL_S3CFG` names there,
so a publish submitted from the local stack writes to the shared bucket.

## Two things about the compose stack that nothing warns you about

Both cost a day during the repository restructure, and neither announces
itself.

**Compose takes the project name from the directory holding the file.** The
compose file lives in `deploy/local/`, so without an explicit name the project
would be `local` — and every volume with it, `openghm_mongo_data` becoming
`local_mongo_data`. Nothing errors: the stack comes up on fresh volumes, the
dev database looks wiped, and `down -v` can no longer reach the volume holding
the data. A project literally named `local` also collides with any other
repository laid out this way. The top-level `name: openghm` in the file is what
prevents all of that; do not remove it, and do not rely on the directory.

**A bind-mount source that does not exist is created as an empty directory.**
The mongo seed is mounted from `deploy/local/mongo/init-mongo.js`. Point that
at nothing and Docker makes a directory there, mongo boots, passes its
healthcheck, and never runs the seed — and `just db-reset` then reports success
against an empty database. Check for seeded collections, not for a running
container:

```bash
docker compose -f deploy/local/docker-compose.yml exec -T mongodb \
  mongosh "mongodb://root:rootpassword@localhost:27017/openghm?authSource=admin" \
  --quiet --eval 'db.getCollectionNames()'      # must not be []
```

Seeding only happens on an empty volume, so verifying it means a throwaway
project (`-p something-else`) rather than wiping your own database. The seed creates
`users` and `jobs`; the backend creates its
other collections and every other index at startup
([gateway.md §4](gateway.md#4-where-state-lives)).

**The seed holds two accounts**, the sign-in page's "Dev quick login" buttons:
`admin@openghm.dev` and `user@openghm.dev`, ids `dev-admin-001` and
`dev-user-001`. Both are email-verified, and the user has
`can_run_simulations`, so the quick-login User can run simulations. Their
ids are deliberately not the mock-auth identities' (`mock-*-001`), which the
backend never lets submit. A volume seeded before the ids changed keeps the old
ones until `just migrate-seed-users` is run once against it; it moves the
accounts, their jobs and their catalogue items, and signs them out.

**Submitting to Anvil from the local stack.** A submit is a real SLURM job on
Anvil as `x-openghm`, so it needs the gateway's SSH key and the toolkit path
(`ANVIL_OPENGHM_HOME`). When `~/.ssh/openghm_anvil_ed25519` exists on your
machine, `just` adds `deploy/local/docker-compose.anvil.yml` to every compose
call: it sets the non-secret values the dev cluster uses and mounts that key
read-only where `web-gateway/backend/.env` says to find it (`ANVIL_SSH_*`
still come from `.env`). Without the key nothing changes, and a submit answers
`503 anvil_not_configured`. Calling `docker compose -f
deploy/local/docker-compose.yml` by hand leaves the file out and recreates the
backend without it: every log read then fails with "Anvil could not be reached".
A simulation is charged to the shared allocation and writes under the same scratch
directories as the dev cluster, so keep local test runs short.

## Why `just -n` over every recipe, and not a grep

Twelve recipes call `docker compose`, all through the `compose` variable at the
top of the justfile, which holds the compose file's path and adds the Anvil
overlay when the key exists. **Six of them name no path at all** — `down`,
`down-volumes`, `rebuild`, `ps`, `logs`, `logs-all`. When the compose file moved,
all six broke while containing nothing a grep for the old path could match. The
same shape appears wherever a recipe's correctness depends on the working
directory or a variable rather than on a string it contains.

So after any move, render every recipe and read the result:

```bash
just --list --unsorted | awk 'NR>1{print $1}' | while read -r r; do just -n "$r"; done
```
