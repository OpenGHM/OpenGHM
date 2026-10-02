from __future__ import annotations

from math import ceil
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from app.core.authz import require_permission
from app.core.config import settings
from app.core.database import get_db
from app.core.roles import Permission
from app.models.generated.model_input import OpenGHMModelInputMetadata
from app.models.generated.snapshot import OpenGHMSnapshotMetadata
from app.models.repository import (
    DatasetDetailResponse,
    DatasetResponse,
    CatalogueResponse,
    MineResponse,
    ModelInputCatalogueItem,
    ModelInputLinks,
    ModelInputListResponse,
    ModelInputResponse,
    OwnedModelInputItem,
    OwnedSnapshotItem,
    RepositoryListResponse,
    SnapshotCatalogueItem,
    SnapshotLinks,
    build_envelope,
    model_input_links,
    snapshot_links,
)
from app.models.user import TokenPayload
from app.services import run_start
from app.services.catalogue import CatalogueQuery, build_catalogue, newest_registered_first

router = APIRouter(prefix="/repository", tags=["repository"])


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
    wbm: list[str] | None = Query(default=None, description="WBM container version (snapshots only)"),
    year_start: int | None = Query(default=None),
    year_end: int | None = Query(default=None),
    spatial_res_min: float | None = Query(default=None, description="Min spatial resolution in degrees"),
    spatial_res_max: float | None = Query(default=None, description="Max spatial resolution in degrees"),
    sort: str = Query(default="relevance", pattern="^(relevance|newest|title-az|title-za|coverage-start)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> CatalogueResponse:
    """Snapshots and model inputs in one list, with facet counts
    (gateway.md, Data Repository). The facet parameters repeat
    (``?tag=a&tag=b``), they are not comma lists."""
    query = CatalogueQuery(
        q=q, year_start=year_start, year_end=year_end,
        spatial_res_min=spatial_res_min, spatial_res_max=spatial_res_max,
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
    return detail


@router.get("/datasets/{dataset_id}/links")
async def get_dataset_links(dataset_id: str) -> SnapshotLinks:
    """Download links for a published snapshot: plain strings, no S3 call
    (gateway.md §5). A separate route rather than a field on
    ``DatasetResponse`` because they depend on the deployment's S3 settings,
    not only on the document, and the list route would otherwise carry them
    on every item. Open, like ``get_dataset``."""
    db = get_db()
    doc = await db["datasets"].find_one({"_id": dataset_id})
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    return snapshot_links(doc["document"], base_url=settings.S3_PUBLIC_BASE_URL, bucket=settings.S3_BUCKET)


@router.post("/datasets", status_code=201)
async def create_dataset(metadata: OpenGHMSnapshotMetadata) -> DatasetResponse:
    """Add a snapshot to the catalogue (this collection had no writer at all
    before this endpoint). The body is exactly one
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
