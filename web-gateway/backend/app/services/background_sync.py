"""Background task: periodically bring every job to its verdict (ADR 0026)."""

import asyncio
import logging

from app.core.config import settings
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
