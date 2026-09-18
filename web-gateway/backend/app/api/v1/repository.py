from __future__ import annotations

from math import ceil

from fastapi import APIRouter, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from app.core.database import get_db
from app.models.generated.snapshot import OpenGHMSnapshotMetadata
from app.models.repository import DatasetResponse, RepositoryListResponse

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


@router.get("/datasets/{dataset_id}")
async def get_dataset(dataset_id: str) -> DatasetResponse:
    db = get_db()
    doc = await db["datasets"].find_one({"_id": dataset_id})
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    return DatasetResponse.from_metadata_json(doc)


@router.post("/datasets", status_code=201)
async def create_dataset(metadata: OpenGHMSnapshotMetadata) -> DatasetResponse:
    """Add a snapshot to the catalogue (open item 13 — this collection had no
    writer at all before this endpoint). The body is exactly one
    ``metadata.json`` document; Mongo's own ``_id`` mirrors the spec's ``id``.
    """
    db = get_db()
    doc = metadata.model_dump(by_alias=True, mode="json")
    doc["_id"] = doc["id"]
    try:
        await db["datasets"].insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail=f"Dataset '{metadata.id}' already exists")
    return DatasetResponse.from_metadata_json(doc)
