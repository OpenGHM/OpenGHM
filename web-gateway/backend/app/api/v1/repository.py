from __future__ import annotations

import asyncio
import dataclasses

from math import ceil
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError
from starlette.background import BackgroundTask

from app.core.authz import require_permission
from app.core.config import settings
from app.core.database import get_db
from app.core.roles import Permission
from app.models.generated.model_input import OpenGHMModelInputMetadata
from app.models.generated.snapshot import OpenGHMSnapshotMetadata
from app.models.job import DraftChecksRequest, DraftChecksResponse
from app.models.repository import (
    DatasetDetailResponse,
    DatasetResponse,
    FolderSummary,
    CatalogueResponse,
    MineResponse,
    ModelInputCatalogueItem,
    ModelInputLinks,
    ModelInputListResponse,
    ModelInputResponse,
    MultiYearAggregation,
    OwnedModelInputItem,
    OwnedSnapshotItem,
    PostProcessingSettings,
    PublishedAnswerRequest,
    PublishedAnswerResponse,
    RepositoryListResponse,
    SnapshotCatalogueItem,
    SnapshotLinks,
    TreeListing,
    TreePreview,
    build_envelope,
    model_input_links,
    snapshot_links,
)
from app.models.user import TokenPayload
from app.services import (
    job_script,
    model_parameters,
    published_answer,
    run_start,
    tree_archive,
    tree_browse,
)
from app.services.catalogue import (
    CatalogueQuery,
    InvalidBoundingBox,
    build_catalogue,
    newest_registered_first,
    parse_box,
)
from app.wbm_init import cross_rules
from app.wbm_init import tree as parameter_tree

router = APIRouter(prefix="/repository", tags=["repository"])


async def _browse_folder(
    kind: tree_browse.Kind, artifact_id: str, path: str, cursor: str | None
) -> TreeListing:
    """The folder at ``path`` of an artifact already known to the catalogue:
    422 ``invalid_path``, 404 ``path_not_found``, 503 ``listing_unavailable``."""
    try:
        folder = tree_browse.validate_path(path)
        return await tree_browse.list_folder(kind, artifact_id, folder, cursor)
    except tree_browse.InvalidPath as exc:
        raise HTTPException(
            status_code=422, detail={"code": "invalid_path", "message": str(exc)}
        ) from exc
    except tree_browse.PathNotFound as exc:
        raise HTTPException(
            status_code=404,
            detail={"code": "path_not_found", "message": f"Nothing is published at '{path}'."},
        ) from exc
    except tree_browse.ListingUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "listing_unavailable",
                "message": "The files could not be listed right now. Try again in a few minutes.",
            },
        ) from exc


async def _browse_preview(kind: tree_browse.Kind, artifact_id: str, path: str) -> TreePreview:
    """The first bytes of the file at ``path``: 422 ``invalid_path``, 404
    ``path_not_found``, 503 ``preview_unavailable``."""
    try:
        file = tree_browse.validate_path(path, file=True)
        return await tree_browse.preview(kind, artifact_id, file)
    except tree_browse.InvalidPath as exc:
        raise HTTPException(
            status_code=422, detail={"code": "invalid_path", "message": str(exc)}
        ) from exc
    except tree_browse.PathNotFound as exc:
        raise HTTPException(
            status_code=404,
            detail={"code": "path_not_found", "message": f"Nothing is published at '{path}'."},
        ) from exc
    except tree_browse.PreviewUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "preview_unavailable",
                "message": "The file could not be read right now. Try again in a few minutes.",
            },
        ) from exc


def _folder_failure(exc: Exception, path: str) -> HTTPException:
    """The answer for what a folder summary or archive can fail with besides its
    own refusals: 422 ``invalid_path``, 404 ``path_not_found``, 503
    ``listing_unavailable``."""
    if isinstance(exc, tree_browse.InvalidPath):
        return HTTPException(status_code=422, detail={"code": "invalid_path", "message": str(exc)})
    if isinstance(exc, tree_browse.PathNotFound):
        return HTTPException(
            status_code=404,
            detail={"code": "path_not_found", "message": f"Nothing is published at '{path}'."},
        )
    return HTTPException(
        status_code=503,
        detail={
            "code": "listing_unavailable",
            "message": "The files could not be listed right now. Try again in a few minutes.",
        },
    )


_FOLDER_FAILURES = (tree_browse.InvalidPath, tree_browse.PathNotFound, tree_browse.ListingUnavailable)


async def _browse_folder_summary(
    kind: tree_browse.Kind, artifact_id: str, path: str
) -> FolderSummary:
    """What the folder at ``path`` holds, and whether its ZIP is allowed."""
    try:
        folder = tree_browse.validate_path(path)
        return await tree_browse.folder_summary(kind, artifact_id, folder)
    except _FOLDER_FAILURES as exc:
        raise _folder_failure(exc, path) from exc


async def _archive_request(request: Request) -> tuple[str, list[str]]:
    """The folder and the entry names asked for, from a form (``folder`` and a
    ``names`` field for each entry: what a browser's form sends) or from JSON
    ``{"folder": ..., "names": [...]}``. 422 ``invalid_selection`` for a body of
    another shape."""
    refusal = HTTPException(
        status_code=422,
        detail={
            "code": "invalid_selection",
            "message": "Send a folder and the names of its entries to download.",
        },
    )
    try:
        if request.headers.get("content-type", "").startswith("application/json"):
            body = await request.json()
            folder, names = body.get("folder", ""), body.get("names")
        else:
            # A name is one field: the default of 1000 fields would refuse a full selection.
            form = await request.form(max_fields=tree_browse.MAX_SELECTED + 100)
            folder, names = form.get("folder", ""), form.getlist("names")
    except (ValueError, AttributeError) as exc:
        raise refusal from exc
    if not isinstance(folder, str) or not isinstance(names, list):
        raise refusal
    if not all(isinstance(name, str) for name in names):
        raise refusal
    return folder, names


async def _browse_archive(
    kind: tree_browse.Kind, artifact_id: str, request: Request
) -> StreamingResponse:
    """The entries asked for, of a folder, as a ZIP, streamed. Besides the
    summary's own answers (a missing folder or name is ``path_not_found``, a bad
    name ``invalid_path`` and a bad count ``invalid_selection``, all 422 or 404):
    413 ``selection_too_large`` (with ``bytes`` and ``limit_bytes``) and 429
    ``archive_busy``, both before anything is sent."""
    path, names = await _archive_request(request)
    try:
        folder = tree_browse.validate_path(path)
        names = tree_browse.validate_names(names)
        archive = await tree_archive.open_archive(kind, artifact_id, folder, names)
    except tree_browse.InvalidSelection as exc:
        raise HTTPException(
            status_code=422, detail={"code": "invalid_selection", "message": str(exc)}
        ) from exc
    except _FOLDER_FAILURES as exc:
        raise _folder_failure(exc, str(exc) if isinstance(exc, tree_browse.PathNotFound) else path) from exc
    except tree_archive.SelectionTooLarge as exc:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "selection_too_large",
                "message": "This selection is too large to download as a ZIP. "
                "Select less, or use an S3 tool.",
                "bytes": exc.size,
                "limit_bytes": tree_browse.ARCHIVE_LIMIT_BYTES,
            },
        ) from exc
    except tree_archive.ArchiveBusy as exc:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "archive_busy",
                "message": "Other downloads are being prepared. Try again in a minute.",
            },
        ) from exc
    headers = {
        "Content-Disposition": tree_archive.content_disposition(archive.filename),
        "Cache-Control": "no-store",
    }
    if archive.length is not None:
        headers["Content-Length"] = str(archive.length)
    return StreamingResponse(
        archive.stream(),
        media_type="application/zip",
        headers=headers,
        background=BackgroundTask(archive.release),
    )


async def _load_all_datasets() -> list[DatasetResponse]:
    db = get_db()
    cursor = db["datasets"].find({})
    docs = await cursor.to_list(length=None)
    return [DatasetResponse.from_metadata_json(doc) for doc in docs]


def filter_datasets(
    datasets: list[DatasetResponse],
    *,
    q: str | None = None,
    year_start: int | None = None,
    year_end: int | None = None,
    spatial_res_min: float | None = None,
    spatial_res_max: float | None = None,
) -> list[DatasetResponse]:
    """Pure — no Mongo, no request object — so it's testable directly against
    the three real spec examples (``tests/test_repository.py``)."""
    if q:
        q_lower = q.lower()
        datasets = [
            d for d in datasets
            if q_lower in d.about.name.lower()
            or q_lower in d.about.description.lower()
            or any(q_lower in kw.root.lower() for kw in d.about.keywords)
        ]

    # simulation.temporalCoverage is a real date pair, not the legacy
    # "YYYY-MM-DD/YYYY-MM-DD" string _extract_year used to parse.
    if year_start is not None or year_end is not None:
        datasets = [
            d for d in datasets
            if not (year_end is not None and d.simulation.temporalCoverage.start.year > year_end)
            and not (year_start is not None and d.simulation.temporalCoverage.end.year < year_start)
        ]

    if spatial_res_min is not None:
        datasets = [d for d in datasets if d.spatialResolutionDegrees >= spatial_res_min]
    if spatial_res_max is not None:
        datasets = [d for d in datasets if d.spatialResolutionDegrees <= spatial_res_max]

    return datasets


def sort_datasets(datasets: list[DatasetResponse], sort: str) -> list[DatasetResponse]:
    """Pure, and not in-place — callers (and tests) keep their own list."""
    datasets = list(datasets)
    if sort == "newest":
        datasets.sort(key=lambda d: d.generatedAt, reverse=True)
    elif sort == "title-az":
        datasets.sort(key=lambda d: d.about.name.lower())
    elif sort == "title-za":
        datasets.sort(key=lambda d: d.about.name.lower(), reverse=True)
    # "relevance": no ranking signal exists yet (no full-text index) — order stands.
    return datasets


def paginate(datasets: list[DatasetResponse], *, page: int, page_size: int) -> RepositoryListResponse:
    total_count = len(datasets)
    total_pages = max(1, ceil(total_count / page_size))
    start = (page - 1) * page_size
    items = datasets[start : start + page_size]
    return RepositoryListResponse(items=items, totalCount=total_count, totalPages=total_pages, page=page)


@router.get("/datasets", response_model=RepositoryListResponse)
async def list_datasets(
    q: str | None = Query(default=None, description="Full-text search (about.name, about.description, about.keywords)"),
    year_start: int | None = Query(default=None),
    year_end: int | None = Query(default=None),
    spatial_res_min: float | None = Query(default=None, description="Min spatial resolution in degrees (finest)"),
    spatial_res_max: float | None = Query(default=None, description="Max spatial resolution in degrees (coarsest)"),
    sort: str = Query(default="relevance", pattern="^(relevance|newest|title-az|title-za)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=5, ge=1, le=100),
) -> RepositoryListResponse:
    datasets = await _load_all_datasets()
    datasets = filter_datasets(
        datasets,
        q=q, year_start=year_start, year_end=year_end,
        spatial_res_min=spatial_res_min, spatial_res_max=spatial_res_max,
    )
    datasets = sort_datasets(datasets, sort)
    return paginate(datasets, page=page, page_size=page_size)


async def _load_catalogue() -> list[SnapshotCatalogueItem | ModelInputCatalogueItem]:
    db = get_db()
    datasets = await db["datasets"].find({}).to_list(length=None)
    model_inputs = await db["model_inputs"].find({}).to_list(length=None)
    return [SnapshotCatalogueItem.from_metadata_json(d) for d in datasets] + [
        ModelInputCatalogueItem.from_metadata_json(m) for m in model_inputs
    ]


@router.get("/catalogue", response_model=CatalogueResponse)
async def list_catalogue(
    q: str | None = Query(default=None, description="Substring over about.name, about.description, about.keywords, about.tags"),
    type: list[Literal["snapshot", "model-input"]] | None = Query(default=None),
    tag: list[str] | None = Query(default=None, description="An about.tags value; an item matches when it has any selected tag"),
    keyword: list[str] | None = Query(default=None, description="An about.keywords entry, exact match"),
    creator: list[str] | None = Query(default=None),
    license: list[str] | None = Query(default=None),
    output: list[str] | None = Query(default=None, description="Output variable name (snapshots only)"),
    forcing: list[str] | None = Query(default=None, description="Input variable role (snapshots only)"),
    process: list[str] | None = Query(default=None, description="Active process (snapshots only)"),
    wbm: list[str] | None = Query(default=None, description="WBM code version, uses.modelCode.version (snapshots only)"),
    year_start: int | None = Query(default=None),
    year_end: int | None = Query(default=None),
    spatial_res_min: float | None = Query(default=None, description="Min spatial resolution in degrees"),
    spatial_res_max: float | None = Query(default=None, description="Max spatial resolution in degrees"),
    north: float | None = Query(default=None, description="Box north edge, decimal degrees (EPSG:4326); the box filter needs all four of north, south, east, west"),
    south: float | None = Query(default=None, description="Box south edge, decimal degrees"),
    east: float | None = Query(default=None, description="Box east edge, decimal degrees"),
    west: float | None = Query(default=None, description="Box west edge, decimal degrees; west > east crosses the antimeridian"),
    sort: str = Query(default="relevance", pattern="^(relevance|newest|title-az|title-za|coverage-start)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> CatalogueResponse:
    """Snapshots and model inputs in one list, with facet counts
    (gateway.md, Data Repository). The facet parameters repeat
    (``?tag=a&tag=b``), they are not comma lists. ``north``/``south``/``east``/
    ``west`` select by overlap with the spatial coverage; a partial or invalid
    box is 422 ``invalid_bounding_box``."""
    try:
        box = parse_box(north, south, east, west)
    except InvalidBoundingBox as exc:
        raise HTTPException(
            status_code=422, detail={"code": "invalid_bounding_box", "message": str(exc)}
        ) from exc
    query = CatalogueQuery(
        q=q, year_start=year_start, year_end=year_end,
        spatial_res_min=spatial_res_min, spatial_res_max=spatial_res_max, box=box,
        selected={
            name: tuple(values)
            for name, values in {
                "type": type, "tag": tag, "keyword": keyword, "creator": creator,
                "license": license, "output": output, "forcing": forcing, "process": process, "wbm": wbm,
            }.items()
            if values
        },
    )
    return build_catalogue(await _load_catalogue(), query, sort=sort, page=page, page_size=page_size)


async def _load_owned(owner_user_id: str) -> list[OwnedSnapshotItem | OwnedModelInputItem]:
    """Every snapshot and model input whose envelope names this user as its
    owner, newest registration first (ids break ties) across both kinds."""
    db = get_db()
    query = {"owner_user_id": owner_user_id}
    datasets = await db["datasets"].find(query).to_list(length=None)
    model_inputs = await db["model_inputs"].find(query).to_list(length=None)
    return newest_registered_first(
        [(OwnedSnapshotItem.from_envelope(d), d) for d in datasets]
        + [(OwnedModelInputItem.from_envelope(m), m) for m in model_inputs]
    )


@router.get("/mine", response_model=MineResponse)
async def list_mine(
    user: TokenPayload = Depends(require_permission(Permission.REPO_VIEW)),
) -> MineResponse:
    """What the signed-in user published: the snapshots and model inputs whose
    envelope ``owner_user_id`` is theirs, in the catalogue's item shapes plus
    each envelope's ``visibility`` and ``registeredAt``. Needs a session,
    unlike the rest of the read routes. Nothing filters on ``visibility``."""
    return MineResponse(items=await _load_owned(user.sub))


@router.get("/datasets/{dataset_id}")
async def get_dataset(dataset_id: str) -> DatasetDetailResponse:
    db = get_db()
    doc = await db["datasets"].find_one({"_id": dataset_id})
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    detail = DatasetDetailResponse.from_metadata_json(doc)
    # Read once per snapshot (immutable by id) and kept; None if it cannot be read.
    rules = await run_start.read_init_rules(doc["document"], dataset_id)
    if rules is not None:
        detail.runStartAlignment = rules.alignment
        detail.aggregationStartYear = rules.aggregation_start_year
        detail.postProcessing = rules.post_processing
        pp_settings = rules.post_processing_settings
        if pp_settings is not None:
            detail.postProcessingSettings = PostProcessingSettings(
                run=pp_settings.run,
                temporalAggregation=pp_settings.temporal_aggregation,
                climatology=pp_settings.climatology,
                climatologyDefault=pp_settings.climatology_default,
                multiYear=(
                    MultiYearAggregation(start=pp_settings.multi_year[0], step=pp_settings.multi_year[1])
                    if pp_settings.multi_year
                    else None
                ),
                polygonAggregation=pp_settings.polygon_aggregation,
                forks=pp_settings.forks,
            )
        # All three: the gateway has climatology switched on, the init has a
        # post-processing run to turn on, and the snapshot says how long that takes
        # (what its walltime is sized by).
        detail.climatologyAvailable = (
            settings.CLIMATOLOGY_ENABLED
            and rules.post_processing != "none"
            and job_script.post_processing_walltime(doc["document"]) is not None
        )
    return detail


@router.get("/datasets/{dataset_id}/links")
async def get_dataset_links(dataset_id: str) -> SnapshotLinks:
    """Download links for a published snapshot: plain strings, plus the
    container's size and a summary of the output, read from the bucket
    (gateway.md §5). A separate
    route rather than a field on ``DatasetResponse`` because they depend on
    the deployment's S3 settings, not only on the document, and the list route
    would otherwise carry them on every item. Open, like ``get_dataset``."""
    db = get_db()
    doc = await db["datasets"].find_one({"_id": dataset_id})
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    links = snapshot_links(doc["document"], base_url=settings.S3_PUBLIC_BASE_URL, bucket=settings.S3_BUCKET)
    sizes, output = await asyncio.gather(
        tree_browse.sizes([links.containerUrl]), tree_browse.output_folders(dataset_id)
    )
    links.containerSize = sizes.get(links.containerUrl)
    links.output = output
    return links


@router.get("/datasets/{dataset_id}/model-parameters")
async def get_dataset_model_parameters(dataset_id: str) -> dict:
    """The WBM parameter tree resolved for the snapshot's code version, with each field's
    value read from the snapshot's init (docs/architecture/model-parameters.md). Open, like
    ``get_dataset``: it holds nothing the published init does not. 404 when the id is not a
    snapshot; 503 ``init_unavailable`` when the init cannot be read, and 503
    ``model_code_version_missing`` when the snapshot names no WBM version the tree knows. A module
    the snapshot has off says whether it can be switched on (``switch_on``, ``switch_on_reason``)
    and a dataset field of one that can carries its ``candidates``: the datasets of the
    snapshot's model input. A model input that cannot be read is no failure: such a module is
    then not offered, with that reason."""
    db = get_db()
    doc = await db["datasets"].find_one({"_id": dataset_id})
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    try:
        loaded = await model_parameters.load(doc["document"], dataset_id)
    except model_parameters.Unavailable as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code, "message": exc.message})
    loaded = await model_parameters.with_choices(doc["document"], dataset_id, loaded)
    return {
        "code_version": loaded.code_version,
        "groups": parameter_tree.render(loaded.resolved, loaded.values, loaded.choices),
    }


@router.post("/datasets/{dataset_id}/checks")
async def get_draft_checks(
    dataset_id: str,
    body: DraftChecksRequest,
    _user: TokenPayload = Depends(require_permission(Permission.REPO_VIEW)),
) -> DraftChecksResponse:
    """What a submit of a draft of this snapshot would refuse or warn about: the tree's cross
    rules (``cross_rules``) for the draft's parameters, dataset file coverage first. A POST
    because the draft on screen is not always the draft as saved, and a new draft has no id:
    the parameters are the body, as for ``published-answer``. Reads nothing a person could not
    read anonymously, so any signed-in user may ask. ``files_checked`` is false when the model
    input could not be read: that is a warning, not an error. 404 when the id is not a
    snapshot; 503 ``init_unavailable`` and ``model_code_version_missing`` as for
    ``model-parameters``."""
    doc = await get_db()["datasets"].find_one({"_id": dataset_id})
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    try:
        loaded = await model_parameters.load(doc["document"], dataset_id)
    except model_parameters.Unavailable as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code, "message": exc.message})
    checks = await cross_rules.check(dataset_id, doc["document"], loaded, body.parameters)
    return DraftChecksResponse(
        errors=[dataclasses.asdict(f) for f in checks.errors],
        warnings=[dataclasses.asdict(f) for f in checks.warnings],
        files_checked=checks.files_checked,
    )


@router.get("/datasets/{dataset_id}/files")
async def get_dataset_files(
    dataset_id: str,
    path: str = Query(default="", description="Folder, relative to the snapshot's root"),
    cursor: str | None = Query(default=None, description="``nextCursor`` of the previous page"),
) -> TreeListing:
    """One page of one folder of a published snapshot's tree, listed from the
    public bucket (``tree_browse``). Open, like ``get_dataset``."""
    db = get_db()
    if await db["datasets"].find_one({"_id": dataset_id}) is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    return await _browse_folder("snapshots", dataset_id, path, cursor)


@router.get("/datasets/{dataset_id}/files/preview")
async def get_dataset_file_preview(
    dataset_id: str,
    path: str = Query(description="File, relative to the snapshot's root"),
) -> TreePreview:
    """The first 256 KiB of one file of a published snapshot. Open."""
    db = get_db()
    if await db["datasets"].find_one({"_id": dataset_id}) is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    return await _browse_preview("snapshots", dataset_id, path)


@router.get("/datasets/{dataset_id}/files/folder")
async def get_dataset_folder_summary(
    dataset_id: str,
    path: str = Query(default="", description="Folder, relative to the snapshot's root"),
) -> FolderSummary:
    """What a folder of a published snapshot holds, at any depth, and whether
    it is small enough for ``.../files/archive``. Open."""
    db = get_db()
    if await db["datasets"].find_one({"_id": dataset_id}) is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    return await _browse_folder_summary("snapshots", dataset_id, path)


@router.post("/datasets/{dataset_id}/files/archive")
async def post_dataset_folder_archive(dataset_id: str, request: Request) -> StreamingResponse:
    """Entries of a folder of a published snapshot as one ZIP, stored and
    streamed from the public bucket (``tree_archive``). A POST, so that a browser
    form can carry up to 1000 names; the body is a form or JSON (see
    ``_archive_request``). Open."""
    db = get_db()
    if await db["datasets"].find_one({"_id": dataset_id}) is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    return await _browse_archive("snapshots", dataset_id, request)


@router.post("/datasets/{dataset_id}/published-answer")
async def get_published_answer(
    dataset_id: str,
    body: PublishedAnswerRequest,
    _user: TokenPayload = Depends(require_permission(Permission.REPO_VIEW)),
) -> PublishedAnswerResponse:
    """Whether a draft of this snapshot is already answered by its published
    output, and the public files that answer it (``published_answer``). A POST
    because an unsaved draft has no id: the draft's parameters are the body.
    Reads nothing a person could not read anonymously, so any signed-in user
    may ask. 422 ``invalid_parameters`` for a period that is not two real dates
    in order; 502 ``published_listing_unavailable`` when the bucket cannot be
    listed (a submit is not blocked by that, see ``jobs.submit_simulation``)."""
    db = get_db()
    doc = await db["datasets"].find_one({"_id": dataset_id})
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    try:
        return await published_answer.answer(
            dataset_id, doc["document"], body.parameters, body.model_input_id
        )
    except published_answer.InvalidPeriod as exc:
        raise HTTPException(
            status_code=422, detail={"code": "invalid_parameters", "message": str(exc)}
        )
    except published_answer.ListingUnavailable:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "published_listing_unavailable",
                "message": "The published files could not be listed right now. "
                "Try again in a few minutes.",
            },
        )


@router.post(
    "/datasets",
    status_code=201,
    dependencies=[Depends(require_permission(Permission.REPO_MANAGE))],
)
async def create_dataset(metadata: OpenGHMSnapshotMetadata) -> DatasetResponse:
    """Add a snapshot to the catalogue (this collection had no writer at all
    before this endpoint). Admin-only, like ``create_model_input``
    (``Permission.REPO_MANAGE``: 401 without a session, 403 for anyone else): it
    accepted any caller until 2026-10-07. A person's own snapshot reaches the
    catalogue another way, by the gateway, when the job that publishes it has
    proven the upload (ADR 0031, ``slurm.register_published``). The body is exactly one
    ``metadata.json`` document, stored under ``document`` in an envelope
    beside the gateway's own record of the registration
    (mission 2026-09-23-catalogue-envelope; see
    ``app.models.repository.build_envelope``). Mongo's own ``_id`` mirrors
    the spec's ``id``.

    ``exclude_none=True`` matters here, not just for tidiness: an absent
    optional field and a present ``null`` are different things in JSON
    Schema, and the spec types these fields (e.g. ``about.creator[].orcid``,
    ``about.relatedLink``) as ``string``/``array`` with no ``null`` allowed.
    Without it, a round-tripped document fails its own spec's validation —
    caught in review of the model-input route this was mirrored into.
    """
    db = get_db()
    doc = metadata.model_dump(by_alias=True, mode="json", exclude_none=True)
    envelope = build_envelope(doc)
    try:
        await db["datasets"].insert_one(envelope)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail=f"Dataset '{metadata.id}' already exists")
    return DatasetResponse.from_metadata_json(envelope)


# ---- model inputs (ADR 0015) --------------------------------------------
#
# Mirrors the `datasets` catalogue above: the document is the spec's shape
# plus `_id` (mirroring the spec's own `id`), a repeat of the same id is a
# 409 rather than an overwrite (rule 1), and the filter/sort/paginate steps
# are pure functions so they test without Mongo. Registration is admin-only
# (spec.md Decision 3) — the read routes stay open to anyone with
# Permission.REPO_VIEW, same as the dataset ones (no explicit gate below,
# same as `list_datasets` / `get_dataset`).


async def _load_all_model_inputs() -> list[ModelInputResponse]:
    db = get_db()
    cursor = db["model_inputs"].find({})
    docs = await cursor.to_list(length=None)
    return [ModelInputResponse.from_metadata_json(doc) for doc in docs]


def filter_model_inputs(
    model_inputs: list[ModelInputResponse],
    *,
    q: str | None = None,
) -> list[ModelInputResponse]:
    """Pure — no Mongo, no request object — so it's testable directly against
    the shipped example (``tests/test_model_inputs.py``)."""
    if q:
        q_lower = q.lower()
        model_inputs = [
            m for m in model_inputs
            if q_lower in m.about.name.lower()
            or q_lower in m.about.description.lower()
            or any(q_lower in kw.root.lower() for kw in m.about.keywords)
        ]
    return model_inputs


def sort_model_inputs(model_inputs: list[ModelInputResponse], sort: str) -> list[ModelInputResponse]:
    """Pure, and not in-place — callers (and tests) keep their own list."""
    model_inputs = list(model_inputs)
    if sort == "newest":
        model_inputs.sort(key=lambda m: m.about.datePublished, reverse=True)
    elif sort == "title-az":
        model_inputs.sort(key=lambda m: m.about.name.lower())
    elif sort == "title-za":
        model_inputs.sort(key=lambda m: m.about.name.lower(), reverse=True)
    # "relevance": no ranking signal exists yet (no full-text index) — order stands.
    return model_inputs


def paginate_model_inputs(
    model_inputs: list[ModelInputResponse], *, page: int, page_size: int
) -> ModelInputListResponse:
    total_count = len(model_inputs)
    total_pages = max(1, ceil(total_count / page_size))
    start = (page - 1) * page_size
    items = model_inputs[start : start + page_size]
    return ModelInputListResponse(items=items, totalCount=total_count, totalPages=total_pages, page=page)


@router.get("/model-inputs", response_model=ModelInputListResponse)
async def list_model_inputs(
    q: str | None = Query(default=None, description="Full-text search (about.name, about.description, about.keywords)"),
    sort: str = Query(default="relevance", pattern="^(relevance|newest|title-az|title-za)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=5, ge=1, le=100),
) -> ModelInputListResponse:
    model_inputs = await _load_all_model_inputs()
    model_inputs = filter_model_inputs(model_inputs, q=q)
    model_inputs = sort_model_inputs(model_inputs, sort)
    return paginate_model_inputs(model_inputs, page=page, page_size=page_size)


@router.get("/model-inputs/{model_input_id}")
async def get_model_input(model_input_id: str) -> ModelInputResponse:
    db = get_db()
    doc = await db["model_inputs"].find_one({"_id": model_input_id})
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Model input '{model_input_id}' not found")
    return ModelInputResponse.from_metadata_json(doc)


@router.get("/model-inputs/{model_input_id}/links")
async def get_model_input_links(model_input_id: str) -> ModelInputLinks:
    """The model-input sibling of ``get_dataset_links``. Open, like
    ``get_model_input``."""
    db = get_db()
    doc = await db["model_inputs"].find_one({"_id": model_input_id})
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Model input '{model_input_id}' not found")
    return model_input_links(doc["document"], base_url=settings.S3_PUBLIC_BASE_URL, bucket=settings.S3_BUCKET)


@router.get("/model-inputs/{model_input_id}/files")
async def get_model_input_files(
    model_input_id: str,
    path: str = Query(default="", description="Folder, relative to the model input's root"),
    cursor: str | None = Query(default=None, description="``nextCursor`` of the previous page"),
) -> TreeListing:
    """The model-input sibling of ``get_dataset_files``."""
    db = get_db()
    if await db["model_inputs"].find_one({"_id": model_input_id}) is None:
        raise HTTPException(status_code=404, detail=f"Model input '{model_input_id}' not found")
    return await _browse_folder("model-inputs", model_input_id, path, cursor)


@router.get("/model-inputs/{model_input_id}/files/preview")
async def get_model_input_file_preview(
    model_input_id: str,
    path: str = Query(description="File, relative to the model input's root"),
) -> TreePreview:
    """The model-input sibling of ``get_dataset_file_preview``."""
    db = get_db()
    if await db["model_inputs"].find_one({"_id": model_input_id}) is None:
        raise HTTPException(status_code=404, detail=f"Model input '{model_input_id}' not found")
    return await _browse_preview("model-inputs", model_input_id, path)


@router.get("/model-inputs/{model_input_id}/files/folder")
async def get_model_input_folder_summary(
    model_input_id: str,
    path: str = Query(default="", description="Folder, relative to the model input's root"),
) -> FolderSummary:
    """The model-input sibling of ``get_dataset_folder_summary``."""
    db = get_db()
    if await db["model_inputs"].find_one({"_id": model_input_id}) is None:
        raise HTTPException(status_code=404, detail=f"Model input '{model_input_id}' not found")
    return await _browse_folder_summary("model-inputs", model_input_id, path)


@router.post("/model-inputs/{model_input_id}/files/archive")
async def post_model_input_folder_archive(model_input_id: str, request: Request) -> StreamingResponse:
    """The model-input sibling of ``post_dataset_folder_archive``."""
    db = get_db()
    if await db["model_inputs"].find_one({"_id": model_input_id}) is None:
        raise HTTPException(status_code=404, detail=f"Model input '{model_input_id}' not found")
    return await _browse_archive("model-inputs", model_input_id, request)


@router.post(
    "/model-inputs",
    status_code=201,
    dependencies=[Depends(require_permission(Permission.REPO_MANAGE))],
)
async def create_model_input(metadata: OpenGHMModelInputMetadata) -> ModelInputResponse:
    """Register a published model input (ADR 0015, spec.md Decision 3 —
    admin-only, matching who actually uploads one to S3). The body is
    exactly one ``metadata.json`` document, stored under ``document`` in an
    envelope beside the gateway's own record of the registration
    (mission 2026-09-23-catalogue-envelope; see
    ``app.models.repository.build_envelope``). Mongo's own ``_id`` mirrors
    the spec's own ``id``, and a repeat is refused with ``409`` rather than
    overwriting it (rule 1).

    ``exclude_none=True`` — see ``create_dataset``'s docstring for why: an
    absent optional field and a stored ``null`` are not the same thing, and
    the spec permits only the former for fields like ``about.creator[].orcid``
    or ``datasets[].unit``.
    """
    db = get_db()
    doc = metadata.model_dump(by_alias=True, mode="json", exclude_none=True)
    envelope = build_envelope(doc)
    try:
        await db["model_inputs"].insert_one(envelope)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail=f"Model input '{metadata.id}' already exists")
    return ModelInputResponse.from_metadata_json(envelope)
