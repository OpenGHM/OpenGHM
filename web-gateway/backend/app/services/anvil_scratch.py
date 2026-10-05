"""Anvil's scratch usage and the spool cache, through the pinned toolkit.

Both admin views run one `openghm spool ...` command on Anvil
(`<ANVIL_OPENGHM_HOME>/bin/openghm ... --config <ANVIL_OPENGHM_HOME>/gateway.toml`,
the same paths a job uses) and read its JSON. The gateway holds no copy of the
cache's layout or of what `myquota` prints: the toolkit's `spool status` and
`spool prune --all` are the one place those are read (rule 4).
"""

from __future__ import annotations

import asyncio
import json
import logging
import shlex
from datetime import datetime, timezone

from pydantic import ValidationError
from slurmly.exceptions import SlurmlyError

from app.core.config import settings
from app.models.admin import (
    ScratchStatusResponse,
    SpoolCacheClearResponse,
    SpoolDeletedUnit,
)
from app.services import job_script, slurm

logger = logging.getLogger(__name__)

#: `myquota` is given 60 s by the toolkit; the walk over the index files is cheap.
STATUS_TIMEOUT_SECONDS = 120
#: Deleting is file by file on GPFS: a full cache is tens of thousands of files.
CLEAR_TIMEOUT_SECONDS = 900

_STDERR_TAIL_CHARS = 400
_NOT_CONFIGURED = "This gateway is not set up to run anything on Anvil yet."
_UNREACHABLE = "Anvil could not be reached. Try again in a few minutes."


class AnvilScratchError(Exception):
    """A refusal the route answers as `{"code", "message"}` with `http_status`:
    503 `anvil_not_configured`, 503 `anvil_unreachable`, or 502 with the
    operation's own code (`spool_status_failed`, `spool_clear_failed`)."""

    def __init__(self, http_status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.http_status = http_status
        self.code = code
        self.message = message


def _toolkit_command(*args: str) -> str:
    """`<home>/bin/openghm <args> --config <home>/gateway.toml`, every word quoted."""
    if not slurm.toolkit_configured():
        raise AnvilScratchError(503, "anvil_not_configured", _NOT_CONFIGURED)
    try:
        openghm, config = job_script.toolkit_paths(settings.ANVIL_OPENGHM_HOME)
    except job_script.SubmitInputError as exc:
        logger.error("ANVIL_OPENGHM_HOME is not usable: %s", exc)
        raise AnvilScratchError(503, "anvil_not_configured", _NOT_CONFIGURED) from exc
    return " ".join(shlex.quote(word) for word in [openghm, *args, "--config", config, "--json"])


async def _run_json(command: str, *, operation: str, failed_code: str, timeout: float) -> dict:
    """The JSON object a toolkit command printed. A transport failure is 503, a
    non-zero exit or output that is not an object is 502 `failed_code`."""
    try:
        result = await slurm.run_remote(
            command, operation=operation, retry_safe=True, timeout=timeout
        )
    except slurm.AnvilNotConfigured as exc:
        raise AnvilScratchError(503, "anvil_not_configured", _NOT_CONFIGURED) from exc
    except (SlurmlyError, OSError, asyncio.TimeoutError) as exc:
        logger.warning("%s: Anvil unreachable: %s", operation, exc)
        raise AnvilScratchError(503, "anvil_unreachable", _UNREACHABLE) from exc
    if result.exit_status != 0:
        tail = (result.stderr or "").strip()[-_STDERR_TAIL_CHARS:]
        logger.warning("%s exited %s: %s", operation, result.exit_status, tail)
        raise AnvilScratchError(
            502, failed_code, tail or f"The toolkit exited with status {result.exit_status}."
        )
    try:
        data = json.loads(result.stdout)
    except ValueError as exc:
        logger.warning("%s printed no JSON: %.200r", operation, result.stdout)
        raise AnvilScratchError(502, failed_code, "The toolkit's answer was not JSON.") from exc
    if not isinstance(data, dict):
        raise AnvilScratchError(502, failed_code, "The toolkit's answer was not a JSON object.")
    return data


async def scratch_status() -> ScratchStatusResponse:
    """`openghm spool status --json` on Anvil, as the response model."""
    command = _toolkit_command("spool", "status")
    data = await _run_json(
        command, operation="spool_status", failed_code="spool_status_failed",
        timeout=STATUS_TIMEOUT_SECONDS,
    )
    try:
        return ScratchStatusResponse(**data, checked_at=datetime.now(timezone.utc))
    except (ValidationError, TypeError) as exc:
        logger.warning("spool status has an unexpected shape: %s", exc)
        raise AnvilScratchError(
            502, "spool_status_failed", "The toolkit's answer was not what this gateway expects."
        ) from exc


async def clear_spool_cache(*, dry_run: bool) -> SpoolCacheClearResponse:
    """`openghm spool prune --all --json` (with `--dry-run` when asked) on
    Anvil: every unit no running simulation holds is deleted. Run twice it does
    the same thing, so a dropped connection may re-send it."""
    command = _toolkit_command("spool", "prune", "--all", *(["--dry-run"] if dry_run else []))
    data = await _run_json(
        command, operation="spool_clear", failed_code="spool_clear_failed",
        timeout=CLEAR_TIMEOUT_SECONDS,
    )
    try:
        deleted = [
            SpoolDeletedUnit(
                variant_dir=d["variant_dir"], unit=d["unit"], files=d["files"], bytes=d["bytes"]
            )
            for d in data["deleted"]
        ]
        return SpoolCacheClearResponse(
            dry_run=dry_run,
            deleted_units=len(deleted),
            deleted_files=data["deleted_files"],
            deleted_bytes=data["deleted_bytes"],
            skipped_leased=data["skipped_leased"],
            deleted=deleted,
        )
    except (ValidationError, KeyError, TypeError) as exc:
        logger.warning("spool prune has an unexpected shape: %s", exc)
        raise AnvilScratchError(
            502, "spool_clear_failed", "The toolkit's answer was not what this gateway expects."
        ) from exc
