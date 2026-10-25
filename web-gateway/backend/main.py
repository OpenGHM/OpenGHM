import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import admin as admin_router
from app.api.v1 import auth as auth_router
from app.api.v1 import community as community_router
from app.api.v1 import home as home_router
from app.api.v1 import jobs as jobs_router
from app.api.v1 import repository as repository_router
from app.api.v1 import run_files as run_files_router
from app.api.v1 import users as users_router
from app.api.v1 import wbm_output as wbm_output_router
from app.core import account_startup, login_throttle, pending_sso, sessions
from app.core.config import settings
from app.core.database import close_db, get_client, get_db
from app.core.roles import Role
from app.services.background_sync import run_background_sync
from app.services.slurm import (
    close_slurm_client,
    get_slurm_client,
    toolkit_configured,
)

# Without this, the root logger defaults to WARNING and every logger.info()
# call in the app — including app.services.email's "no RESEND_API_KEY, here's
# the email that would have been sent" fallback and app.core.roles's legacy
# role-spelling notices — is silently dropped. Configured once here, at
# import time, before any other module's logger.info() calls can fire.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # GET /admin/system reads this to compute uptime.
    app.state.started_at = datetime.now(timezone.utc)

    # Startup: verify MongoDB connection
    client = get_client()
    await client.admin.command("ping")

    # Startup: ensure MongoDB indexes
    db = get_db()

    # One-time-per-deployment field rename (institution -> organization).
    # $rename is a no-op on documents that lack the source field, so this is
    # safe to run on every startup rather than needing a "ran once" flag.
    await db.users.update_many(
        {"institution": {"$exists": True}}, {"$rename": {"institution": "organization"}}
    )
    # Emails are lowercased on every request now, so the stored ones must be
    # too. Before the unique index below, so it is built over the rewritten
    # documents.
    await account_startup.lowercase_emails(db)
    await db[pending_sso.COLLECTION].update_many(
        {"institution": {"$exists": True}}, {"$rename": {"institution": "organization"}}
    )

    await db.jobs.create_index("sim_id", unique=True, sparse=True)
    await db.jobs.create_index("user_id")
    await db.jobs.create_index([("user_id", 1), ("status", 1)])

    # `datasets` and `model_inputs` (ADR 0015) need no index beyond the one
    # Mongo already gives every collection for free: `_id`, unique by
    # default, is what POST /api/v1/repository/{datasets,model-inputs}
    # relies on for the 409-on-duplicate-id behaviour (rule 1). Nothing
    # else queries either collection by anything but `_id` yet.

    # Startup: users.email must be unique — previously only enforced by the
    # seed scripts (which run once, on an empty data dir) and an app-level
    # find-then-insert check in POST /auth/register that's racy under
    # concurrent signups. A pre-existing deployment whose Mongo volume
    # predates this line won't have the index; if it also has duplicate
    # emails, index creation raises rather than silently no-opping, so this
    # is wrapped like the role-integrity check below instead of left to
    # crash startup.
    try:
        await db.users.create_index("email", unique=True)
    except Exception as exc:
        logger.error(
            "Could not create unique index on users.email (likely duplicate "
            "emails already in the collection) — registration's "
            "find-then-insert check is racy without it: %s",
            exc,
        )

    # One CILogon identity on one account. Wrapped like the email index: a
    # deployment that already holds the same identity on two accounts makes
    # the build raise, and that should be a log line, not a failed start.
    try:
        await account_startup.ensure_sso_identity_index(db)
    except Exception as exc:
        logger.error(
            "Could not create unique index on users.sso_external_id (likely one "
            "identity on two accounts) — the sign-in checks are racy without it: %s",
            exc,
        )

    # Refresh tokens live in their own collection now (app.core.sessions),
    # one document per signed-in device. The old users.refresh_token_hash
    # index is dead weight once that migration has run — drop it if a
    # pre-existing deployment still has it.
    try:
        await db.users.drop_index("refresh_token_hash_1")
        logger.info("Dropped obsolete users.refresh_token_hash index")
    except Exception:
        pass  # Already gone, or never existed on this deployment.

    # Looked up by equality on every POST /auth/refresh; unique so a hash
    # collision can't resolve one token to two sessions.
    await db[sessions.COLLECTION].create_index("token_hash", unique=True)
    await db[sessions.COLLECTION].create_index("user_id")
    # TTL index: Mongo reaps sessions once they pass expires_at, so expired
    # rows don't accumulate and a user's session list stays truthful without
    # any sweeper of our own. (Mongo's background task runs about once a
    # minute, so removal is prompt but not instantaneous — every read path
    # still checks expiry itself rather than trusting the index.)
    await db[sessions.COLLECTION].create_index("expires_at", expireAfterSeconds=0)

    # Same TTL pattern for abandoned SSO-profile-completion attempts (see
    # app.core.pending_sso) — a user who never finishes the "fill in your
    # missing email" step shouldn't leave a row behind forever.
    await db[pending_sso.COLLECTION].create_index("expires_at", expireAfterSeconds=0)

    # Failed password sign-ins (app.core.login_throttle): counted by
    # (kind, key) on every POST /auth/login, reaped by the same TTL pattern
    # once past the throttle window.
    await db[login_throttle.COLLECTION].create_index([("kind", 1), ("key", 1)])
    await db[login_throttle.COLLECTION].create_index("expires_at", expireAfterSeconds=0)

    # Startup: flag any user documents with a non-canonical role. A doc that
    # doesn't parse as one of the four current Role values will 500 the
    # first time it's read into a Pydantic model — surface it here as a log
    # line instead, so it's diagnosed at boot rather than as a mystery 500.
    # See deploy/local/mongo/migrate_roles.js for the fix.
    non_canonical = await db.users.count_documents(
        {"role": {"$nin": [r.value for r in Role]}}
    )
    if non_canonical:
        logger.error(
            "%d user document(s) have a non-canonical role — run the role "
            "migration (deploy/local/mongo/migrate_roles.js / just migrate-roles)",
            non_canonical,
        )

    # audit_events is append-only and always read newest-first (see
    # GET /admin/audit-log), optionally narrowed to one category.
    await db.audit_events.create_index([("created_at", -1)])
    await db.audit_events.create_index([("category", 1), ("created_at", -1)])
    # GET /users/{user_id} resolves last_login_at by newest login_succeeded
    # event for one actor — without this it's a full collection scan per
    # detail-page view. GET /admin/audit-log?actor_id= reads it the same way.
    await db.audit_events.create_index([("actor_id", 1), ("created_at", -1)])

    # Site-wide admin views (GET /admin/jobs, jobs-per-day time series) sort
    # and range-scan on created_at with no user_id prefix, so the existing
    # user_id-prefixed job indexes above don't help them.
    await db.jobs.create_index([("created_at", -1)])
    # Registrations-per-day time series.
    await db.users.create_index([("created_at", -1)])

    # The Community page's content (ADR 0034). A workshop and a tutorial are
    # found by slug on the public detail pages, and the slug must be unique;
    # tutorials are listed in their manual order; publications by year then title.
    await db.community_workshops.create_index("slug", unique=True)
    await db.community_tutorials.create_index("slug", unique=True)
    await db.community_tutorials.create_index("position")
    await db.community_publications.create_index([("year", -1), ("title", 1)])
    await db.community_news.create_index("slug", unique=True)
    await db.community_news.create_index([("date", -1), ("created_at", -1)])

    # Startup: warm slurmly client (non-fatal — first job submission will retry)
    try:
        await get_slurm_client()
    except Exception as exc:
        logger.warning("slurmly client init failed (jobs will not work): %s", exc)

    # Say once per pod that submits will be refused: a deployment without a
    # toolkit install looks healthy until somebody presses Submit.
    if not toolkit_configured():
        logger.warning(
            "ANVIL_OPENGHM_HOME is not set — job submissions will be refused "
            "(503 anvil_not_configured) until a toolkit install is named."
        )

    # Startup: launch background job status sync
    sync_task = asyncio.create_task(run_background_sync())
    app.state.background_sync_task = sync_task

    yield

    # Shutdown: cancel background sync
    if not sync_task.done():
        sync_task.cancel()
        try:
            await sync_task
        except asyncio.CancelledError:
            pass

    await close_slurm_client()
    await close_db()


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix=settings.API_V1_PREFIX)
app.include_router(users_router.router, prefix=settings.API_V1_PREFIX)
app.include_router(repository_router.router, prefix=settings.API_V1_PREFIX)
app.include_router(jobs_router.router, prefix=settings.API_V1_PREFIX)
app.include_router(admin_router.router, prefix=settings.API_V1_PREFIX)
app.include_router(wbm_output_router.router, prefix=settings.API_V1_PREFIX)
app.include_router(run_files_router.router, prefix=settings.API_V1_PREFIX)
app.include_router(community_router.router, prefix=settings.API_V1_PREFIX)
app.include_router(community_router.admin_router, prefix=settings.API_V1_PREFIX)
app.include_router(home_router.router, prefix=settings.API_V1_PREFIX)
app.include_router(home_router.admin_router, prefix=settings.API_V1_PREFIX)


@app.get("/health")
async def health():
    return {"status": "ok", "environment": settings.ENVIRONMENT}
