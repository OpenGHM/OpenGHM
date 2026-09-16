"""Background task: periodically sync non-terminal job statuses from Slurm."""

import asyncio
import logging

from app.core.config import settings
from app.core.database import get_db
from app.services import slurm

logger = logging.getLogger(__name__)

NON_TERMINAL_STATUSES = ["PENDING", "SUBMITTED", "RUNNING", "COMPLETING"]


async def _sync_once() -> None:
    db = get_db()
    cursor = db.jobs.find({"status": {"$in": NON_TERMINAL_STATUSES}}, {"_id": 1})
    job_ids: list[str] = [doc["_id"] async for doc in cursor]

    if not job_ids:
        return

    logger.debug("Background sync: checking %d non-terminal jobs", len(job_ids))

    for job_id in job_ids:
        try:
            await slurm.update_job_status(job_id)
        except Exception as exc:
            logger.warning("Background sync: failed for job %s: %s", job_id, exc)


async def run_background_sync() -> None:
    interval = settings.JOB_BACKGROUND_SYNC_INTERVAL
    logger.info("Background sync started (interval=%ds)", interval)
    while True:
        try:
            await _sync_once()
        except asyncio.CancelledError:
            logger.info("Background sync cancelled")
            break
        except Exception as exc:
            logger.error("Background sync iteration error: %s", exc)
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.info("Background sync cancelled during sleep")
            break
