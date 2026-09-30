"""Background task: periodically bring every job to its verdict (ADR 0026),
every `JOB_BACKGROUND_SYNC_ACTIVE_INTERVAL` seconds while a job is active and
every `JOB_BACKGROUND_SYNC_INTERVAL` when none is (ADR 0027)."""

import asyncio
import logging

from app.core.config import settings
from app.core.database import get_db
from app.models.job import ACTIVE_STATUSES
from app.services import slurm

logger = logging.getLogger(__name__)


async def _sync_once() -> None:
    # Each step is its own try: a cluster that cannot be reached for the
    # sweep must not also keep the orphan and purge checks from being tried.
    for name, step in (
        ("jobs", slurm.sync_active_jobs),
        ("orphans", slurm.clear_orphans),
        ("purged files", slurm.detect_purged_files),
    ):
        try:
            await step()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Background sync: %s failed: %s", name, exc)


async def _next_interval() -> int:
    """The active interval while a job has a SLURM id and no verdict, or an
    orphaned submit is still being cancelled; otherwise the idle one."""
    try:
        db = get_db()
        active = await db.jobs.find_one(
            {"status": {"$in": ACTIVE_STATUSES}, "slurm_job_id": {"$ne": None}}
        ) or await db.jobs.find_one({"orphan_sim_ids": {"$exists": True, "$ne": []}})
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("Background sync: could not tell whether a job is active: %s", exc)
        active = None
    if active is not None:
        return settings.JOB_BACKGROUND_SYNC_ACTIVE_INTERVAL
    return settings.JOB_BACKGROUND_SYNC_INTERVAL


async def run_background_sync() -> None:
    logger.info(
        "Background sync started (interval=%ds, %ds while a job is active)",
        settings.JOB_BACKGROUND_SYNC_INTERVAL,
        settings.JOB_BACKGROUND_SYNC_ACTIVE_INTERVAL,
    )
    while True:
        try:
            await _sync_once()
        except asyncio.CancelledError:
            logger.info("Background sync cancelled")
            break
        except Exception as exc:
            logger.error("Background sync iteration error: %s", exc)
        try:
            await asyncio.sleep(await _next_interval())
        except asyncio.CancelledError:
            logger.info("Background sync cancelled during sleep")
            break
