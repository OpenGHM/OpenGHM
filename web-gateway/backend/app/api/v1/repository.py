from __future__ import annotations

from math import ceil

from fastapi import APIRouter, HTTPException, Query

from app.core.database import get_db
from app.models.repository import (
    DatasetType,
    RawDatasetResponse,
    RepositoryListResponse,
    SnapshotDatasetResponse,
)

router = APIRouter(prefix="/repository", tags=["repository"])


def _extract_year(temporal_coverage: str) -> tuple[int | None, int | None]:
    """Extract start/end year from 'YYYY-MM-DD/YYYY-MM-DD' format."""
    try:
        parts = temporal_coverage.split("/")
        start = int(parts[0][:4]) if parts else None
        end = int(parts[1][:4]) if len(parts) > 1 else start
        return start, end
    except (ValueError, IndexError):
        return None, None


def _doc_to_dataset(doc: dict) -> SnapshotDatasetResponse | RawDatasetResponse:
    doc["id"] = doc.pop("_id")
    if doc.get("datasetType") == DatasetType.snapshot:
        return SnapshotDatasetResponse(**doc)
    return RawDatasetResponse(**doc)


async def _load_all_datasets() -> list[SnapshotDatasetResponse | RawDatasetResponse]:
    db = get_db()
    cursor = db["datasets"].find({})
    docs = await cursor.to_list(length=None)
    return [_doc_to_dataset(doc) for doc in docs]


@router.get("/datasets", response_model=RepositoryListResponse)
async def list_datasets(
    q: str | None = Query(default=None, description="Full-text search (title, description, keywords)"),
    dataset_type: DatasetType | None = Query(default=None, alias="type"),
    year_start: int | None = Query(default=None),
    year_end: int | None = Query(default=None),
    spatial_res_min: float | None = Query(default=None, description="Min spatial resolution in degrees (finest)"),
    spatial_res_max: float | None = Query(default=None, description="Max spatial resolution in degrees (coarsest)"),
    temporal_resolutions: list[str] = Query(default=[], description="Filter by temporal resolution (hourly, daily, monthly, annual)"),
    sort: str = Query(default="relevance", pattern="^(relevance|newest|title-az|title-za)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=5, ge=1, le=100),
) -> RepositoryListResponse:
    datasets = await _load_all_datasets()

    # --- Filter: dataset type ---
    if dataset_type is not None:
        datasets = [d for d in datasets if d.datasetType == dataset_type]

    # --- Filter: text search ---
    if q:
        q_lower = q.lower()
        datasets = [
            d for d in datasets
            if q_lower in d.title.lower()
            or q_lower in d.description.lower()
            or any(q_lower in kw.lower() for kw in d.keywords)
        ]

    # --- Filter: temporal range ---
    if year_start is not None or year_end is not None:
        filtered = []
        for d in datasets:
            ds, de = _extract_year(d.temporalCoverage)
            if ds is None:
                filtered.append(d)
                continue
            if year_start is not None and de is not None and de < year_start:
                continue
            if year_end is not None and ds is not None and ds > year_end:
                continue
            filtered.append(d)
        datasets = filtered

    # --- Filter: spatial resolution (degrees) ---
    if spatial_res_min is not None or spatial_res_max is not None:
        filtered = []
        for d in datasets:
            deg = d.spatialResolutionDegrees
            if deg is None:
                filtered.append(d)
                continue
            if spatial_res_min is not None and deg < spatial_res_min:
                continue
            if spatial_res_max is not None and deg > spatial_res_max:
                continue
            filtered.append(d)
        datasets = filtered

    # --- Filter: temporal resolution ---
    if temporal_resolutions:
        tr_lower = [t.lower() for t in temporal_resolutions]
        datasets = [
            d for d in datasets
            if d.temporalResolution is not None and d.temporalResolution.lower() in tr_lower
        ]

    # --- Sort ---
    if sort == "newest":
        datasets.sort(key=lambda d: d.lastUpdated, reverse=True)
    elif sort == "title-az":
        datasets.sort(key=lambda d: d.title.lower())
    elif sort == "title-za":
        datasets.sort(key=lambda d: d.title.lower(), reverse=True)

    # --- Paginate ---
    total_count = len(datasets)
    total_pages = max(1, ceil(total_count / page_size))
    start = (page - 1) * page_size
    items = datasets[start : start + page_size]

    return RepositoryListResponse(
        items=items,
        totalCount=total_count,
        totalPages=total_pages,
        page=page,
    )


@router.get("/datasets/{dataset_id}")
async def get_dataset(dataset_id: str) -> SnapshotDatasetResponse | RawDatasetResponse:
    db = get_db()
    doc = await db["datasets"].find_one({"_id": dataset_id})
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
    return _doc_to_dataset(doc)
