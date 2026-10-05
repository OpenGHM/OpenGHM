# Local development

**Status: built.** Everything below is how development works today.

Which parts run on a laptop, which run once in the cluster, and why the split
falls where it does.

## Three tiers

| Tier | Components | On a laptop | Why |
|---|---|---|---|
| **Shared, remote only** | Anvil S3, zot, the schema host | never | Large and nearly static. All three are **anonymous-read**, so a laptop needs no credentials to use them. |
| **Local dependencies** | MongoDB | `deploy/local/` compose | Small, and a developer mutates their data — isolation matters more than sharing. |
| **Started, unused** | Redis | `deploy/local/` compose | Nothing reads `REDIS_URL`, and neither cluster runs one. A leftover — [gateway.md](gateway.md#6-what-is-absent-and-not-by-oversight). |
| **Source** | frontend, backend, `openghm` | run directly, hot reload | Changes constantly. |

The gateway already works this way. `backend/app/core/config.py` says it: the
backend never talks to S3 directly, jobs upload from Anvil compute nodes with
their own credentials, and datasets are served as plain public HTTPS links. The
backend only builds link strings.

## The property that falls out

**A laptop is read-only against everything shared.** Pulling an image, fetching
a schema, reading a dataset — all anonymous. Publishing a snapshot, pushing an
image, publishing a schema are CI and operator actions.

That is not just convenience. It matches the constitution's *published means
immutable*: a laptop should not be able to write to a published prefix at all.

## What `deploy/local/` deliberately omits

The compose stack brings up MongoDB and Redis. It does **not** bring up an S3
implementation or a registry. Opening the file and not finding them is the
signal that those are remote — see
`ops/docs/reference/environments.md` (private) for the full
matrix of which endpoint each environment uses.

## The one gap

Developing the *publish* paths needs somewhere writable — uploading a test
snapshot, updating a manifest, publishing a schema version. Reading is solved;
writing is not decided. The options are under
the Next list in `ops/missions/README.md` (private).

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
project (`-p something-else`) rather than wiping your own database.

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

Ten recipes call `docker compose`, and **six of them name no path at all** —
`down`, `down-volumes`, `rebuild`, `ps`, `logs`, `logs-all`. When the compose
file moved, all six broke while containing nothing a grep for the old path
could match. The same shape appears wherever a recipe's correctness depends on
the working directory rather than on a string it contains.

So after any move, render every recipe and read the result:

```bash
just --list --unsorted | awk 'NR>1{print $1}' | while read -r r; do just -n "$r"; done
```
