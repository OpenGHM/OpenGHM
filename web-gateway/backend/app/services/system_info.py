"""Read-only system status for GET /admin/system.

Every dependency check is wrapped in a timeout and never lets its exception
text reach the response — pymongo error strings routinely embed endpoint
URLs and credential-chain details. Full exceptions go to the server log;
the response gets a short, hand-written phrase instead.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone

from app.core.config import settings
from app.core.database import get_client
from app.models.admin import DependencyHealth, FeatureStatus, RuntimeSettingsSummary
from app.services import slurm

logger = logging.getLogger(__name__)

_CHECK_TIMEOUT = 2.0


async def _check_mongo() -> DependencyHealth:
    start = time.perf_counter()
    try:
        await asyncio.wait_for(get_client().admin.command("ping"), _CHECK_TIMEOUT)
        return DependencyHealth(
            name="mongodb", status="ok", latency_ms=round((time.perf_counter() - start) * 1000, 1)
        )
    except Exception as exc:
        logger.error("system_info: mongo check failed: %s", exc)
        return DependencyHealth(name="mongodb", status="error", detail="Could not reach MongoDB.")


async def _check_slurm() -> DependencyHealth:
    # Deliberately does not connect — see slurm.client_state()'s docstring.
    state = slurm.client_state()
    if state == "unconfigured":
        return DependencyHealth(name="slurm", status="unconfigured", detail="Anvil SSH credentials not set.")
    if state == "idle":
        return DependencyHealth(name="slurm", status="degraded", detail="Client not warm; next submission will connect.")
    return DependencyHealth(name="slurm", status="ok")


def _features() -> list[FeatureStatus]:
    return [
        FeatureStatus(
            name="cilogon",
            configured=bool(settings.INTERNAL_SERVICE_SECRET),
            note="Reports only that the SSO handoff secret is set — the CILogon "
            "client id/secret live in the frontend's NextAuth config, which this "
            "backend can't see.",
        ),
        FeatureStatus(name="resend", configured=bool(settings.RESEND_API_KEY)),
        FeatureStatus(name="recaptcha", configured=bool(settings.RECAPTCHA_SECRET_KEY)),
        FeatureStatus(
            name="mock_auth",
            configured=settings.ENVIRONMENT == "development" and settings.ALLOW_MOCK_AUTH,
            note="Password-free X-Mock-Role login bypass. Should read false in production.",
        ),
    ]


def _settings_summary() -> RuntimeSettingsSummary:
    return RuntimeSettingsSummary(
        jwt_expire_minutes=settings.JWT_EXPIRE_MINUTES,
        refresh_token_expire_days=settings.REFRESH_TOKEN_EXPIRE_DAYS,
        job_default_walltime=settings.JOB_DEFAULT_WALLTIME,
        job_default_nodes=settings.JOB_DEFAULT_NODES,
        job_default_ntasks=settings.JOB_DEFAULT_NTASKS,
        job_background_sync_interval=settings.JOB_BACKGROUND_SYNC_INTERVAL,
        anvil_host=settings.ANVIL_SSH_HOST,
        anvil_partition=settings.ANVIL_PARTITION,
        anvil_execution_profile=settings.ANVIL_EXECUTION_PROFILE,
        s3_bucket_data=settings.S3_BUCKET_DATA,
        s3_bucket_outputs=settings.S3_BUCKET_OUTPUTS,
        cors_origins=settings.CORS_ORIGINS,
    )


async def get_system_info(started_at: datetime) -> dict:
    dependencies = await asyncio.gather(
        _check_mongo(), _check_slurm(), return_exceptions=True
    )
    # gather(return_exceptions=True) still catches anything that slipped past
    # the per-check try/except above (e.g. a bug in the check itself) so one
    # broken check can't 500 the whole page.
    resolved = [
        d if isinstance(d, DependencyHealth) else DependencyHealth(name="unknown", status="error")
        for d in dependencies
    ]

    now = datetime.now(timezone.utc)
    return {
        "environment": settings.ENVIRONMENT,
        "project_name": settings.PROJECT_NAME,
        "version": settings.APP_VERSION,
        "server_time": now,
        "uptime_seconds": (now - started_at).total_seconds(),
        "dependencies": resolved,
        "features": _features(),
        "settings": _settings_summary(),
    }
