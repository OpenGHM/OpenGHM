"""Reading a simulation's WBM output: an inventory, a map, a pixel's series, a NetCDF subset (ADR 0033).

The same four routes, for two sources:

* `/jobs/{job_id}/output...`: the run of a snapshot draft, on Anvil scratch. Its owner, and holders of
  `JOB_VIEW_ANY` (staff and admins, as for the job's logs); anyone else gets the 404 a missing job gets
  (ADR 0024). A draft that never ran is 404 `output_missing`; one whose scratch Anvil purged is 410
  `output_purged`.
* `/repository/datasets/{dataset_id}/output...`: a published snapshot, open to anyone like the other
  repository read routes; 404 for an id the catalogue does not hold.

`.../output` is the inventory (JSON); `.../output/map` a north-up PNG of one time step (`image/png`, or with
`encoding=json` the toolkit's answer, whose `base64` is the PNG, beside the legend, range, units and box it
was drawn for); `.../output/series` a pixel's values over a period (JSON); `.../output/subset` one variable
over a period and box as a NetCDF-4 file (`application/x-netcdf`, an attachment). The JSON bodies are the
toolkit's answers as it prints them (documented in its README; this gateway does not restate them); the
query parameters are the toolkit's options, passed through after a syntax check, and what they mean
(dates, limits, what a map or a series is) is decided there. A request the toolkit refuses is 422
`output_request_refused` with its message; the other errors are `app.services.wbm_output`'s.
"""

from __future__ import annotations

import base64
import binascii
from typing import Awaitable, Callable, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

from app.api.v1.jobs import _get_job_for
from app.core.authz import require_permission
from app.core.database import get_db
from app.core.roles import Permission
from app.models.user import TokenPayload
from app.services import wbm_output
from app.services.wbm_output import OutputSource, WbmOutputError

router = APIRouter(tags=["output"])

_NUM = r"-?\d+(?:\.\d+)?"
VARIABLE = {"pattern": r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$", "max_length": 64}
DATE = {"pattern": r"^\d{4}(?:-\d{2}(?:-\d{2})?)?$", "description": "YYYY, YYYY-MM or YYYY-MM-DD"}
BBOX = {"pattern": rf"^{_NUM}(?:,{_NUM}){{3}}$", "description": "W,S,E,N in degrees"}
POINT = {"pattern": rf"^{_NUM},{_NUM}$", "description": "LON,LAT in degrees"}
Resolution = Literal["daily", "monthly", "yearly"]
IMAGE_SIDE = 4096

#: A published snapshot's output does not change; a run's may, while it runs.
_PUBLIC_CACHE = "public, max-age=3600"
_PRIVATE_CACHE = "private, no-cache"


def _http(exc: WbmOutputError) -> HTTPException:
    """`detail` is `{"code", "message"}`, the shape jobs.py and app.core.authz refuse with."""
    return HTTPException(status_code=exc.http_status, detail={"code": exc.code, "message": exc.message})


async def _job_source(
    job_id: str, user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN))
) -> OutputSource:
    doc = await _get_job_for(job_id, user, Permission.JOB_VIEW_ANY)
    try:
        return wbm_output.run_source(doc)
    except WbmOutputError as exc:
        raise _http(exc)


async def _snapshot_source(dataset_id: str) -> OutputSource:
    if await get_db()["datasets"].find_one({"_id": dataset_id}) is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    try:
        return wbm_output.snapshot_source(dataset_id)
    except WbmOutputError as exc:
        raise _http(exc)


async def _call(awaitable: Awaitable):
    try:
        return await awaitable
    except WbmOutputError as exc:
        raise _http(exc)


def _register(prefix: str, source_dep: Callable, cache: str) -> None:
    """The four routes under `prefix` (which holds the path parameter `source_dep` reads)."""

    @router.get(f"{prefix}/output")
    async def get_output(source: OutputSource = Depends(source_dep)) -> dict:
        """What the output holds: files and years that exist, each variable with its units and display
        settings, the grid (`openghm output inventory`)."""
        return await _call(wbm_output.inventory(source))

    @router.get(f"{prefix}/output/map")
    async def get_output_map(
        variable: str = Query(..., **VARIABLE),
        resolution: Resolution = Query(...),
        start: str = Query(..., **DATE),
        bbox: str | None = Query(None, **BBOX),
        width: int | None = Query(None, ge=1, le=IMAGE_SIDE),
        height: int | None = Query(None, ge=1, le=IMAGE_SIDE),
        encoding: Literal["png", "json"] = Query("png", description="json: the toolkit's answer, the PNG as base64"),
        source: OutputSource = Depends(source_dep),
    ):
        """A north-up map of one time step over the box (default: the whole grid), coloured by the
        variable's legend, transparent where there is no data."""
        answer = await _call(wbm_output.map_image(
            source, variable=variable, resolution=resolution, start=start, bbox=bbox, width=width, height=height))
        if encoding == "json":
            return answer
        try:
            png = base64.b64decode(answer["base64"], validate=True)
        except (KeyError, TypeError, binascii.Error):
            raise _http(WbmOutputError(502, "output_failed", "The toolkit's answer was not what this gateway expects."))
        return Response(content=png, media_type="image/png", headers={"Cache-Control": cache})

    @router.get(f"{prefix}/output/series")
    async def get_output_series(
        variable: str = Query(..., **VARIABLE),
        resolution: Resolution = Query(...),
        point: str = Query(..., **POINT),
        start: str | None = Query(None, **DATE),
        end: str | None = Query(None, **DATE),
        display: bool = Query(False, description="values as the run's MT shows them (stored x scale + offset)"),
        source: OutputSource = Depends(source_dep),
    ) -> dict:
        """The values of the cell nearest `point` over the period, one per time step."""
        return await _call(wbm_output.series(
            source, variable=variable, resolution=resolution, point=point, start=start, end=end, display=display))

    @router.get(f"{prefix}/output/subset")
    async def get_output_subset(
        variable: str = Query(..., **VARIABLE),
        resolution: Resolution = Query(...),
        start: str | None = Query(None, **DATE),
        end: str | None = Query(None, **DATE),
        bbox: str | None = Query(None, **BBOX),
        source: OutputSource = Depends(source_dep),
    ):
        """One variable over the period and box as a NetCDF-4 file, streamed from Anvil and deleted there
        afterwards. A call over the toolkit's limits is 422."""
        download = await _call(wbm_output.prepare_download(
            source, variable=variable, resolution=resolution, start=start, end=end, bbox=bbox))
        return StreamingResponse(
            wbm_output.stream_download(download),
            media_type="application/x-netcdf",
            headers={
                "Content-Disposition": f'attachment; filename="{download.filename}"',
                "Content-Length": str(download.size),
                "Cache-Control": "private, no-store",
            },
        )


_register("/jobs/{job_id}", _job_source, _PRIVATE_CACHE)
_register("/repository/datasets/{dataset_id}", _snapshot_source, _PUBLIC_CACHE)
