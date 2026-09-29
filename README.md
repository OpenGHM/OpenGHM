# OpenGHM

One repository: the **gateway** (data repository and user portal for
hydrologic datasets, model outputs, and climate forcing data), the `openghm`
**toolkit**, the WBM **container images**, and the snapshot **spec** that ties
them together.

Live at **https://dev.openghm.org**.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Backend | FastAPI (Python), Uvicorn |
| Auth | NextAuth v5 |
| Database | MongoDB 7 |
| Cache | Redis 7 |
| Object Storage | Anvil S3 (RCAC) — served as plain public HTTPS links, backend has no S3 credentials |
| Deployment | Kubernetes on Anvil Cloud (Purdue RCAC) |

## Project Structure

```
OpenGHM/
├── web-gateway/
│   ├── frontend/           # Next.js app (port 3100 locally)
│   └── backend/            # FastAPI app (port 8100)
├── packages/openghm/       # openghm library + CLI (pip-installable wheel)
├── images/                 # one directory per WBM container image, plus verification/
├── schemas/                # snapshot spec — one source, generated into backend/frontend/wheel
├── docs/                   # architecture, decisions, reference  ← start here
├── deploy/local/           # docker-compose.yml and the mongo seed
└── justfile                # task runner
```

## Where to start

Want to contribute? [`CONTRIBUTING.md`](CONTRIBUTING.md) has setup, how to
verify a change, and pull request conventions. Found a security issue? See
[`SECURITY.md`](SECURITY.md) instead of opening a public issue. Licensed under
[MIT](LICENSE).

One repository, not several, because a snapshot-spec change has to land
atomically across the schema, the generated backend model, the generated
frontend types and the wheel's bundled copy.

[`docs/`](docs/) is the knowledge base: **architecture** (what shape the
system has), **decisions** (why), and **reference** (current values — the
snapshot spec, the on-disk layout, `metadata.json`, the S3 layout). Start at
[`docs/README.md`](docs/README.md).

Every architecture document says `Status: built` or `Status: target` on its
first line — what runs today, or what we are building toward. If you want to
know how the gateway actually works right now, that is
[`docs/architecture/gateway.md`](docs/architecture/gateway.md).

The non-negotiable rules and the read order for an agent are in
[`AGENTS.md`](AGENTS.md); [`CLAUDE.md`](CLAUDE.md) imports it, because Claude
Code reads that name instead.

## Prerequisites

- [just](https://github.com/casey/just) — task runner (`brew install just`)
- [Docker](https://www.docker.com/) with Docker Compose
- Node.js 20+ and npm

## Local Development

### First Run

```bash
just install dev   # copies .env files, installs frontend dependencies
just run dev       # infra + backend in Docker, frontend locally
```

This starts:
- **MongoDB** → `localhost:27418`
- **Redis** → `localhost:6479`
- **Backend (FastAPI)** → `http://localhost:8100` (hot reload)
- **Frontend (Next.js)** → `http://localhost:3100` (hot reload)

Snapshots, model inputs and containers live on Anvil S3 and are served as plain public HTTPS links (see `S3_PUBLIC_BASE_URL` in `web-gateway/backend/.env.example`). The backend never calls the S3 API. A simulation's output stays on Anvil scratch until it is published as a snapshot ([ADR 0023](docs/decisions/0023-simulation-output-stays-on-scratch.md)).

Press `Ctrl-C` to stop the frontend. Run `just down` to stop Docker services.

MongoDB data lives in the `openghm_mongo_data` Docker volume, so it survives container restarts. `just down` keeps it; `just down-volumes` deletes it.

### Subsequent Runs

```bash
just run dev
```

The backend image is only rebuilt on first run. Run `just rebuild` if you change `requirements.txt` or `web-gateway/backend/Dockerfile`.

### Resetting Local Data

```bash
# Stop containers and wipe all local data
just down
just down-volumes
```

## `just` Commands Reference

| Command | Description |
|---|---|
| `just run dev` | Start full dev environment (infra + backend in Docker, frontend locally) |
| `just down` | Stop all Docker containers (keeps data volumes) |
| `just down-volumes` | Stop containers and delete all data volumes |
| `just rebuild` | Force-rebuild the backend image without cache |
| `just ps` | Show running container status |
| `just logs` | Tail backend logs |
| `just logs-all` | Tail logs for all services |
| `just build-all` | Build frontend + backend Docker images (`linux/amd64`) |

## Deploying

This repository is the product. How *our* instance is deployed — cluster
manifests, encrypted secrets, the Anvil environment, DNS and TLS — lives in a
separate private repository, `openghm-ops`, cloned into `ops/` and ignored by
this one ([ADR 0016](docs/decisions/0016-split-public-and-ops-repositories.md)).

Maintainers who have it see the deployment recipes merge into `just` automatically:

```bash
git clone <openghm-ops> ops
just --list          # k8s-apply, deploy-all, push-all, … now present
```

Without `ops/` those recipes simply do not exist. That is expected, not a
broken checkout — everything above this section works without it.

## Environment Variables

Key backend environment variables (see `web-gateway/backend/app/core/config.py`):

| Variable | Default | Description |
|---|---|---|
| `MONGODB_URL` | `mongodb://root:...@localhost:27418/...` | MongoDB connection string |
| `REDIS_URL` | `redis://localhost:6479/0` | Redis connection string |
| `S3_PUBLIC_BASE_URL` | `https://s3.anvil.rcac.purdue.edu` | Base URL for building public dataset/output links (no credentials — backend doesn't call the S3 API) |
| `CORS_ORIGINS` | `["http://localhost:3100"]` | Allowed CORS origins |

Key frontend environment variables (`.env.local`):

| Variable | Description |
|---|---|
| `BACKEND_URL` | FastAPI base URL (server-side only, default: `http://localhost:8100`) |
| `AUTH_SECRET` | NextAuth secret key |
