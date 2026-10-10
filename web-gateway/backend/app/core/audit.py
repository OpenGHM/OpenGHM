"""Audit logging for events an admin would want to review after the fact.

Four categories, kept separately queryable because they have very different
volumes and audiences:

- "auth": logins, registrations, password resets, role/status changes.
  Low volume, security-relevant.
- "job": job submission, cancellation, and Slurm status transitions.
  Higher volume (a few events per job), operational rather than security.
- "system": an admin changing shared infrastructure state (clearing the
  Anvil spool cache). Rare, written once per action.
- "content": an admin writing the Community page's content (workshops,
  tutorials, publications, settings, uploaded files). Rare, one event per write.

The job events are recorded only at genuine state *transitions* — never on
a status poll. app.services.slurm.update_job_status runs on every
background sync tick and every status-page load, so the log call lives
inside its `new_status != current` branch, which a no-op poll never
enters. Mixing the two categories in one unfiltered view would drown the
auth signal, hence AuditCategory and the `category` filter on
GET /admin/audit-log.
"""

import logging
import uuid
from datetime import datetime, timezone
from enum import StrEnum

from app.core.database import get_db

logger = logging.getLogger(__name__)

# Actor for events with no human behind them — the background Slurm sync
# transitioning a job, most notably.
SYSTEM_ACTOR = "system"


class AuditCategory(StrEnum):
    AUTH = "auth"
    JOB = "job"
    SYSTEM = "system"
    CONTENT = "content"


async def log_event(
    action: str,
    actor_id: str,
    actor_email: str | None = None,
    target_id: str | None = None,
    detail: dict | None = None,
    category: AuditCategory = AuditCategory.AUTH,
) -> None:
    """Record an audit event. Best-effort: a logging failure should never
    break the request that triggered it (e.g. a successful login shouldn't
    500 because the audit write failed)."""
    db = get_db()
    doc = {
        "_id": str(uuid.uuid4()),
        "action": action,
        "category": category.value,
        "actor_id": actor_id,
        "actor_email": actor_email,
        "target_id": target_id,
        "detail": detail,
        "created_at": datetime.now(timezone.utc),
    }
    try:
        await db.audit_events.insert_one(doc)
    except Exception:
        logger.exception("Failed to write audit event: %s", action)
