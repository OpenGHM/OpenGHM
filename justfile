# OpenGHM Gateway — developer task runner
# Install just: https://github.com/casey/just
#
# Usage:
#   just install dev      — first-time setup: copy .env files + install npm deps
#   just run dev          — start everything (infra + backend in Docker, frontend locally)
#   just down             — stop all Docker containers
#   just db-reset         — wipe MongoDB volume and re-run init seed (init-mongo.js)
#   just migrate-roles    — migrate legacy PascalCase user roles to lowercase, in place
#   just migrate-sessions — migrate single-session refresh tokens to per-device sessions
#   just logs             — tail backend logs
#   just logs-all         — tail logs for all services
#   just rebuild          — force-rebuild the backend image (no cache)
#   just ps               — show running containers
#   just build-all        — build frontend + backend images (linux/amd64)
#
# Deploying this instance — pushing images to the Anvil registry, applying
# manifests to the cluster — is not here. Those recipes live in the private
# `openghm-ops` repository, cloned into ./ops, and the import below picks them
# up when it is present. Without it `just k8s-apply` is simply not a recipe;
# that is expected, not a broken checkout.

import? 'ops/justfile'

# ── Configuration ────────────────────────────────────────────────────────────

# Also read by ops/justfile for registry paths and the prod namespace.
# It is defined ONCE, here: `just` rejects a second definition in an imported
# file with "Variable `namespace` has multiple definitions".
namespace := "openghm"
compose := "docker compose -f deploy/local/docker-compose.yml"

default:
    @just --list

# ─── Local Dev environment ──────────────────────────────────────────────────

# First-time setup (just install dev) or npm-only (just install)
install env="":
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "{{env}}" = "dev" ]; then
        echo "🔧  Setting up environment files..."
        if [ ! -f web-gateway/backend/.env ]; then
            cp web-gateway/backend/.env.example web-gateway/backend/.env
            echo "   ✅  web-gateway/backend/.env created from .env.example"
            echo "   ⚠️   Edit it and fill in ANVIL_SSH_* and other secrets."
        else
            echo "   ⏭️   web-gateway/backend/.env already exists, skipping."
        fi
        if [ ! -f web-gateway/frontend/.env.local ]; then
            cp web-gateway/frontend/.env.local.example web-gateway/frontend/.env.local
            echo "   ✅  web-gateway/frontend/.env.local created from .env.local.example"
        else
            echo "   ⏭️   web-gateway/frontend/.env.local already exists, skipping."
        fi
        echo ""
    fi
    echo "📦  Installing frontend dependencies..."
    (cd web-gateway/frontend && npm install)
    echo ""
    echo "✅  Done. Run 'just run dev' to start."

# Start the full dev environment.
# Docker: MongoDB, Redis, Backend (auto-installs new packages on start)
# Local:  Next.js frontend on http://localhost:3100
run env="dev":
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "{{env}}" != "dev" ]; then
        echo "❌  Only 'dev' environment is currently supported."
        exit 1
    fi

    # Ensure frontend dependencies are installed
    if [ ! -d "web-gateway/frontend/node_modules" ]; then
        echo "📦  node_modules not found — running npm install..."
        (cd web-gateway/frontend && npm install)
    fi

    echo "🐳  Starting infra + backend containers..."
    # Build backend image on first run only (no --build on subsequent runs).
    # requirements.txt changes are picked up automatically at container start via pip install.
    # Run 'just rebuild' only when the Dockerfile itself changes.
    # The name compose gives this image — `docker compose config --images`.
    # It used to read `openghm-gateway-backend`, which nothing ever builds, so
    # this branch was taken on every run and rebuilt the image every time.
    if [[ "$(docker images -q openghm-backend 2>/dev/null)" == "" ]]; then
        echo "   (First run: building backend image...)"
        {{compose}} build backend
    fi
    {{compose}} up -d --no-build

    echo ""
    echo "  MongoDB  → localhost:27418"
    echo "  Redis    → localhost:6479"
    echo "  Backend  → http://localhost:8100"
    echo ""
    echo "⏳  Waiting for backend to be ready..."
    for i in $(seq 1 30); do
        if curl -sf http://localhost:8100/health > /dev/null 2>&1; then
            echo "✅  Backend ready"
            break
        fi
        sleep 1
    done

    echo ""
    echo "🌐  Starting frontend → http://localhost:3100"
    echo "    (Ctrl-C stops the frontend; run 'just down' to stop Docker services)"
    echo ""
    cd web-gateway/frontend && npm run dev

# ─── Docker helpers ─────────────────────────────────────────────────────────

# Stop and remove all containers (keeps volumes)
down:
    {{compose}} down

# Stop containers AND delete all data volumes
down-volumes:
    {{compose}} down -v

# Reset the database: wipe volumes and restart MongoDB so init-mongo.js re-runs
# Use this after changing deploy/local/mongo/init-mongo.js or to get a clean slate
db-reset:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "⚠️   Stopping containers and wiping MongoDB volume..."
    {{compose}} down -v
    echo "🐳  Starting MongoDB (will re-run init-mongo.js)..."
    {{compose}} up -d mongodb
    echo "⏳  Waiting for MongoDB to be ready..."
    for i in $(seq 1 30); do
        if {{compose}} exec -T mongodb mongosh --quiet --eval "db.adminCommand('ping').ok" > /dev/null 2>&1; then
            echo "✅  MongoDB ready (seed data loaded)"
            break
        fi
        sleep 1
    done

# Migrate legacy PascalCase user roles (Admin/PowerUser/User/Guest) to the
# current lowercase set (admin/staff/user/guest) on the LOCAL docker mongo.
# Idempotent — safe to run against a DB that's already migrated.
migrate-roles:
    {{compose}} exec -T mongodb mongosh "mongodb://root:rootpassword@localhost:27017/admin?authSource=admin" --quiet < deploy/local/mongo/migrate_roles.js

# Migrate single-session refresh tokens (users.refresh_token_hash) into the
# per-device refresh_tokens collection. Run once when deploying multi-device
# sessions — without it, everyone signed in at that moment is logged out.
# Idempotent.
migrate-sessions:
    {{compose}} exec -T mongodb mongosh "mongodb://root:rootpassword@localhost:27017/admin?authSource=admin" --quiet < deploy/local/mongo/migrate_sessions.js

# Force-rebuild the backend image without cache
rebuild:
    {{compose}} build --no-cache backend
    {{compose}} up -d backend

# Show container status
ps:
    {{compose}} ps

# Tail backend logs
logs:
    {{compose}} logs -f backend

# Tail logs for all services
logs-all:
    {{compose}} logs -f

# ─── Docker Build ───────────────────────────────────────────────────────────

# Build the frontend Docker image
build-frontend:
    docker build --platform linux/amd64 -t {{namespace}}/frontend -f web-gateway/frontend/Dockerfile web-gateway/frontend/

# Build the backend Docker image (repo-root context for repository data)
build-backend:
    docker build --platform linux/amd64 -t {{namespace}}/backend -f web-gateway/backend/Dockerfile .

# Build both images
build-all: build-frontend build-backend
