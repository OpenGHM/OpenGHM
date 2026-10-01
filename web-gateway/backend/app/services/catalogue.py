"""The mixed catalogue: snapshots and model inputs in one filtered, faceted,
sorted, paginated list (``GET /api/v1/repository/catalogue``).

Pure — no Mongo, no request object — like ``filter_datasets`` and
``sort_datasets`` in ``app.api.v1.repository``, so it tests against the real
spec examples (``tests/test_catalogue.py``). The semantics are written once, in
``docs/architecture/gateway.md`` (Data Repository); this file is the code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import ceil
from typing import Callable

from app.models.repository import (
    CatalogueFacets,
    CatalogueResponse,
    FacetOption,
    ModelInputCatalogueItem,
    SnapshotCatalogueItem,
    YearBounds,
    resolution_to_degrees,
)

Item = SnapshotCatalogueItem | ModelInputCatalogueItem
Option = tuple[str, str]  # (value, label)

KIND_LABELS: dict[str, str] = {"snapshot": "Model Snapshot", "model-input": "Model Input"}


@dataclass(frozen=True)
class CatalogueQuery:
    q: str | None = None
    year_start: int | None = None
    year_end: int | None = None
    spatial_res_min: float | None = None
    spatial_res_max: float | None = None
    #: facet name -> selected values (OR within a facet, AND across facets).
    #: A missing or empty entry means the facet is not filtering.
    selected: dict[str, tuple[str, ...]] = field(default_factory=dict)


# ---- per-item facts ------------------------------------------------------


def _kind(item: Item) -> str:
    return item.kind


def _temporal(item: Item):
    """The artifact's temporal coverage, or ``None`` (a climatological model
    input has none)."""
    if isinstance(item, SnapshotCatalogueItem):
        return item.simulation.temporalCoverage
    return item.coverage.temporalCoverage


def _resolutions_degrees(item: Item) -> list[float]:
    if isinstance(item, SnapshotCatalogueItem):
        return [item.spatialResolutionDegrees]
    return [
        resolution_to_degrees(n.resolution)
        for n in item.networks
        if n.resolution is not None
    ]


def _snapshot_only(extract: Callable[[SnapshotCatalogueItem], list[Option]]) -> Callable[[Item], list[Option]]:
    return lambda item: extract(item) if isinstance(item, SnapshotCatalogueItem) else []


#: facet name -> the (value, label) pairs an item offers for it. A kind that
#: has no such field offers none, so a selection in that facet excludes it.
FACETS: dict[str, Callable[[Item], list[Option]]] = {
    "type": lambda i: [(_kind(i), KIND_LABELS[_kind(i)])],
    "category": lambda i: [(i.about.category, i.about.category)],
    "keyword": lambda i: [(k.root, k.root) for k in i.about.keywords],
    "creator": lambda i: [(c.name, c.name) for c in i.about.creator],
    "license": lambda i: [(i.about.license, i.about.license)],
    "output": _snapshot_only(lambda i: [(v.name, v.fullName) for v in i.simulation.outputVariables]),
    "forcing": _snapshot_only(lambda i: [(v.role.value, v.role.value) for v in i.simulation.inputVariables]),
    "process": _snapshot_only(lambda i: [(p.root, p.root) for p in i.simulation.activeProcesses]),
    "wbm": _snapshot_only(lambda i: [(i.uses.container.version, i.uses.container.version)]),
}


# ---- matching ------------------------------------------------------------


def _text_fields(item: Item) -> tuple[str, str, list[str]]:
    return (
        item.about.name.lower(),
        item.about.description.lower(),
        [k.root.lower() for k in item.about.keywords],
    )


def _matches_q(item: Item, q_lower: str) -> bool:
    name, description, keywords = _text_fields(item)
    return q_lower in name or q_lower in description or any(q_lower in k for k in keywords)


def _matches_years(item: Item, year_start: int | None, year_end: int | None) -> bool:
    """Overlap with the temporal coverage, as ``filter_datasets``; an artifact
    with no coverage never matches an active year filter."""
    if year_start is None and year_end is None:
        return True
    coverage = _temporal(item)
    if coverage is None:
        return False
    if year_end is not None and coverage.start.year > year_end:
        return False
    if year_start is not None and coverage.end.year < year_start:
        return False
    return True


def _matches_resolution(item: Item, lo: float | None, hi: float | None) -> bool:
    """A snapshot has one resolution; a model input matches when any of its
    networks' resolutions is in range, and one with none never does."""
    if lo is None and hi is None:
        return True
    return any(
        (lo is None or r >= lo) and (hi is None or r <= hi) for r in _resolutions_degrees(item)
    )


def _matches_facet(item: Item, facet: str, selected: tuple[str, ...]) -> bool:
    if not selected:
        return True
    return any(value in selected for value, _ in FACETS[facet](item))


def _matches_base(item: Item, query: CatalogueQuery) -> bool:
    q = query.q.strip().lower() if query.q else ""
    return (
        (not q or _matches_q(item, q))
        and _matches_years(item, query.year_start, query.year_end)
        and _matches_resolution(item, query.spatial_res_min, query.spatial_res_max)
    )


def _matches_facets(item: Item, query: CatalogueQuery, *, skip: str | None = None) -> bool:
    return all(
        _matches_facet(item, facet, query.selected.get(facet, ()))
        for facet in FACETS
        if facet != skip
    )


def filter_catalogue(items: list[Item], query: CatalogueQuery) -> list[Item]:
    return [i for i in items if _matches_base(i, query) and _matches_facets(i, query)]


# ---- facets --------------------------------------------------------------


def _option_label_sort_key(option: FacetOption) -> tuple[int, str, str]:
    return (-option.count, option.label.casefold(), option.value)


def build_facets(items: list[Item], query: CatalogueQuery) -> CatalogueFacets:
    """Disjunctive counts: a group counts the items that match everything
    except that group's own selection, so ticking one option leaves its
    siblings' counts intact."""
    base = [i for i in items if _matches_base(i, query)]
    # Labels are fixed per value over the whole catalogue (first one by id wins),
    # so a selected value with no match still gets a real label.
    labels: dict[str, dict[str, str]] = {f: {} for f in FACETS}
    for item in sorted(items, key=lambda i: i.id):
        for facet, extract in FACETS.items():
            for value, label in extract(item):
                labels[facet].setdefault(value, label)

    groups: dict[str, list[FacetOption]] = {}
    for facet, extract in FACETS.items():
        counts: dict[str, int] = {}
        for item in base:
            if not _matches_facets(item, query, skip=facet):
                continue
            for value in {v for v, _ in extract(item)}:
                counts[value] = counts.get(value, 0) + 1
        for value in query.selected.get(facet, ()):
            counts.setdefault(value, 0)
        if facet == "type":
            groups[facet] = [
                FacetOption(value=k, label=lbl, count=counts.get(k, 0)) for k, lbl in KIND_LABELS.items()
            ]
            continue
        options = [FacetOption(value=v, label=labels[facet].get(v, v), count=n) for v, n in counts.items()]
        groups[facet] = sorted(options, key=_option_label_sort_key)

    return CatalogueFacets(**groups, yearBounds=year_bounds(items))


def year_bounds(items: list[Item]) -> YearBounds | None:
    coverages = [c for c in (_temporal(i) for i in items) if c is not None]
    if not coverages:
        return None
    return YearBounds(min=min(c.start.year for c in coverages), max=max(c.end.year for c in coverages))


# ---- sorting -------------------------------------------------------------


def relevance_score(item: Item, q: str | None) -> int:
    """name hit 3, keyword hit 2, description hit 1, summed over the fields hit."""
    if not q or not q.strip():
        return 0
    q_lower = q.strip().lower()
    name, description, keywords = _text_fields(item)
    return (
        (3 if q_lower in name else 0)
        + (2 if any(q_lower in k for k in keywords) else 0)
        + (1 if q_lower in description else 0)
    )


def sort_catalogue(items: list[Item], sort: str, q: str | None = None) -> list[Item]:
    """Pure, not in-place, and total: every order ends in the id."""
    out = sorted(items, key=lambda i: i.id)
    if sort == "title-az":
        out.sort(key=lambda i: i.about.name.casefold())
    elif sort == "title-za":
        out.sort(key=lambda i: i.about.name.casefold(), reverse=True)
        # reverse=True keeps equal elements in their (id-ascending) order.
    else:
        # newest, and relevance's tie-break: datePublished desc, name asc, id.
        out.sort(key=lambda i: i.about.name.casefold())
        out.sort(key=lambda i: i.about.datePublished, reverse=True)
        if sort == "relevance" and q and q.strip():
            out.sort(key=lambda i: relevance_score(i, q), reverse=True)
    return out


def paginate_catalogue(
    items: list[Item], facets: CatalogueFacets, *, page: int, page_size: int
) -> CatalogueResponse:
    total = len(items)
    start = (page - 1) * page_size
    return CatalogueResponse(
        items=items[start : start + page_size],
        totalCount=total,
        totalPages=max(1, ceil(total / page_size)),
        page=page,
        facets=facets,
    )


def build_catalogue(
    items: list[Item], query: CatalogueQuery, *, sort: str = "relevance", page: int = 1, page_size: int = 10
) -> CatalogueResponse:
    matched = sort_catalogue(filter_catalogue(items, query), sort, query.q)
    return paginate_catalogue(matched, build_facets(items, query), page=page, page_size=page_size)
