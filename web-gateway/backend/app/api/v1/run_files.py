"""A run's output on Anvil scratch: browse it and download what is checked as one ZIP (ADR 0040).

`GET /jobs/{job_id}/files?path=&cursor=` lists one folder of the run's output directory,
`GET /jobs/{job_id}/files/folder?path=` totals one at any depth and says whether a ZIP of it
is allowed, and `POST /jobs/{job_id}/files/archive` streams the entries named in the viewed
folder as a stored ZIP of at most 500 MB, read over SFTP (`app.services.run_files`, which uses
`tree_archive`'s writer: the same limit, the same three-at-once limit as the published tree).

Who: the run's owner and holders of `JOB_VIEW_ANY`, as for its logs and its output (ADR 0024,
0033); anyone else gets the 404 a missing job gets. Which run: one that has stopped, with its
files on scratch. A draft that never ran is 404 `output_missing`, one still queued or running is
409 `run_not_finished`, one whose scratch Anvil purged is 410 `output_purged`. Other errors are
`{"code", "message"}`: 422 `invalid_path` or `invalid_selection`, 404 `path_not_found`, 413
`selection_too_large` (with `bytes` and `limit_bytes`) and 429 `archive_busy` before anything is
sent, 503 `anvil_unreachable` or `anvil_not_configured`.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from app.api.v1.jobs import _get_job_for
from app.api.v1.repository import archive_request
from app.core.authz import require_permission
from app.core.roles import Permission
from app.models.job import TERMINAL_STATUSES
from app.models.run_files import RunFolderSummary, RunListing
from app.models.user import TokenPayload
from app.services import run_files, tree_archive, tree_browse, wbm_output
from app.services.wbm_output import WbmOutputError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["run-files"])


def _error(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


async def _run(job_id: str, user: TokenPayload) -> str:
    """The id of the run's simulation, for a job the caller may read whose run has stopped
    and whose files are on scratch. Raises the errors above."""
    doc = await _get_job_for(job_id, user, Permission.JOB_VIEW_ANY)
    try:
        wbm_output.run_source(doc)  # 404 output_missing, 410 output_purged
    except WbmOutputError as exc:
        raise _error(exc.http_status, exc.code, exc.message) from exc
    if doc.get("status") not in TERMINAL_STATUSES:
        raise _error(
            409,
            "run_not_finished",
            "This simulation is still running. Its files can be downloaded when it has finished.",
        )
    return doc["sim_id"]


def _failure(exc: Exception, path: str) -> HTTPException:
    """The answer for what a listing, a total or an archive can fail with besides its own
    refusals."""
    if isinstance(exc, tree_browse.InvalidPath):
        return _error(422, "invalid_path", str(exc))
    if isinstance(exc, run_files.OutputMissing):
        return _error(
            404, "output_missing", "This simulation's output is not on Anvil (it is not there yet, or it was deleted)."
        )
    if isinstance(exc, run_files.PathNotFound):
        return _error(404, "path_not_found", f"There is nothing at '{path}' in this simulation's output.")
    if isinstance(exc, run_files.AnvilUnavailable):
        return _error(503, exc.code, exc.message)
    raise exc


_FAILURES = (
    tree_browse.InvalidPath,
    run_files.OutputMissing,
    run_files.PathNotFound,
    run_files.AnvilUnavailable,
)


@router.get("/jobs/{job_id}/files", response_model=RunListing)
async def get_run_files(
    job_id: str,
    path: str = Query(default="", description="Folder, relative to the run's output directory"),
    cursor: str | None = Query(default=None, description="``nextCursor`` of the previous page"),
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
) -> RunListing:
    """One page of one folder of the run's output, listed over SFTP."""
    sim_id = await _run(job_id, user)
    try:
        return await run_files.list_folder(sim_id, tree_browse.validate_path(path), cursor)
    except _FAILURES as exc:
        raise _failure(exc, path) from exc


@router.get("/jobs/{job_id}/files/folder", response_model=RunFolderSummary)
async def get_run_folder_summary(
    job_id: str,
    path: str = Query(default="", description="Folder, relative to the run's output directory"),
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
) -> RunFolderSummary:
    """What a folder of the run's output holds at any depth, and whether it is small
    enough for ``.../files/archive``."""
    sim_id = await _run(job_id, user)
    try:
        return await run_files.folder_summary(sim_id, tree_browse.validate_path(path))
    except _FAILURES as exc:
        raise _failure(exc, path) from exc


@router.post("/jobs/{job_id}/files/archive")
async def post_run_archive(
    job_id: str,
    request: Request,
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
) -> StreamingResponse:
    """Entries of a folder of the run's output as one ZIP, stored and streamed over SFTP. A
    POST, so that a browser form can carry up to 1000 names; the body is a form or JSON (see
    ``repository.archive_request``)."""
    sim_id = await _run(job_id, user)
    path, names = await archive_request(request)
    try:
        folder = tree_browse.validate_path(path)
        names = tree_browse.validate_names(names)
        archive = await run_files.open_archive(sim_id, folder, names)
    except tree_browse.InvalidSelection as exc:
        raise _error(422, "invalid_selection", str(exc)) from exc
    except tree_archive.SelectionTooLarge as exc:
        raise _error(
            413,
            "selection_too_large",
            "This selection is too large to download as a ZIP. Select less.",
            bytes=exc.size,
            limit_bytes=tree_browse.ARCHIVE_LIMIT_BYTES,
        ) from exc
    except tree_archive.ArchiveBusy as exc:
        raise _error(
            429, "archive_busy", "Other downloads are being prepared. Try again in a minute."
        ) from exc
    except _FAILURES as exc:
        raise _failure(exc, str(exc) if isinstance(exc, run_files.PathNotFound) else path) from exc
    headers = {
        "Content-Disposition": tree_archive.content_disposition(archive.filename),
        "Cache-Control": "private, no-store",
    }
    if archive.length is not None:
        headers["Content-Length"] = str(archive.length)
    return StreamingResponse(
        archive.stream(),
        media_type="application/zip",
        headers=headers,
        background=BackgroundTask(archive.release),
    )
