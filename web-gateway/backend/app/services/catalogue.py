"""The mixed catalogue: snapshots and model inputs in one filtered, faceted,
sorted, paginated list (``GET /api/v1/repository/catalogue``).

Pure — no Mongo, no request object — like ``filter_datasets`` and
``sort_datasets`` in ``app.api.v1.repository``, so it tests against the real
spec examples (``tests/test_catalogue.py``). The semantics are written once, in
``docs/architecture/gateway.md`` (Data Repository); this file is the code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import ceil
from typing import Callable, TypeVar

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
T = TypeVar("T")
Option = tuple[str, str]  # (value, label)

KIND_LABELS: dict[str, str] = {"snapshot": "Model Snapshot", "model-input": "Model Input"}


@dataclass(frozen=True)
class BoundingBox:
    """A box in decimal degrees (EPSG:4326), in DCMI Box element order."""

    north: float
    south: float
    east: float
    west: float


class InvalidBoundingBox(ValueError):
    """The four box parameters do not describe a box; the message says why."""


def parse_box(
    north: float | None, south: float | None, east: float | None, west: float | None
) -> BoundingBox | None:
    """``None`` when no value is given (no box filter); a box when all four
    are; :class:`InvalidBoundingBox` for a partial box, a value outside its
    range or a south edge above the north. West > east is valid: the box
    crosses the antimeridian."""
    given = {"north": north, "south": south, "east": east, "west": west}
    if all(v is None for v in given.values()):
        return None
    missing = [k for k, v in given.items() if v is None]
    if missing:
        raise InvalidBoundingBox(
            f"A bounding box needs all of north, south, east and west; missing: {', '.join(missing)}."
        )
    for name, lo, hi in (("north", -90, 90), ("south", -90, 90), ("east", -180, 180), ("west", -180, 180)):
        value = given[name]
        if not (lo <= value <= hi):  # also false for NaN
            raise InvalidBoundingBox(f"{name} must be between {lo} and {hi} degrees, got {value}.")
    if south > north:
        raise InvalidBoundingBox(f"south ({south}) must not be above north ({north}).")
    return BoundingBox(north=north, south=south, east=east, west=west)


@dataclass(frozen=True)
class CatalogueQuery:
    q: str | None = None
    year_start: int | None = None
    year_end: int | None = None
    spatial_res_min: float | None = None
    spatial_res_max: float | None = None
    #: A query box, all four or none (``parse_box``); west > east crosses the
    #: antimeridian.
    box: BoundingBox | None = None
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


def _spatial(item: Item):
    """The artifact's spatial coverage box (a model input's is
    ``coverage.spatialCoverage``, the union over its networks and datasets)."""
    if isinstance(item, SnapshotCatalogueItem):
        return item.simulation.spatialCoverage
    return item.coverage.spatialCoverage


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
    "tag": lambda i: [(t.value, t.value) for t in i.about.tags],
    "keyword": lambda i: [(k.root, k.root) for k in i.about.keywords],
    "creator": lambda i: [(c.name, c.name) for c in i.about.creator],
    "license": lambda i: [(i.about.license, i.about.license)],
    "output": _snapshot_only(lambda i: [(v.name, v.fullName) for v in i.simulation.outputVariables]),
    "forcing": _snapshot_only(lambda i: [(v.role.value, v.role.value) for v in i.simulation.inputVariables]),
    "process": _snapshot_only(lambda i: [(p.root, p.root) for p in i.simulation.activeProcesses]),
    "wbm": _snapshot_only(lambda i: [(i.uses.modelCode.version, i.uses.modelCode.version)]),
}


# ---- matching ------------------------------------------------------------


def _text_fields(item: Item) -> tuple[str, str, list[str]]:
    """name, description, and the keyword-like terms (``about.keywords`` and
    ``about.tags``; a hit in either counts the same)."""
    return (
        item.about.name.lower(),
        item.about.description.lower(),
        [k.root.lower() for k in item.about.keywords] + [t.value.lower() for t in item.about.tags],
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


def _longitude_spans(west: float, east: float) -> list[tuple[float, float]]:
    """The longitudes a west/east pair covers; west > east crosses the
    antimeridian, so the span is [west, 180] and [-180, east]."""
    if west <= east:
        return [(west, east)]
    return [(west, 180.0), (-180.0, east)]


def _longitudes_overlap(a: tuple[float, float], b: tuple[float, float]) -> bool:
    spans_a, spans_b = _longitude_spans(*a), _longitude_spans(*b)
    if any(lo_a <= hi_b and lo_b <= hi_a for lo_a, hi_a in spans_a for lo_b, hi_b in spans_b):
        return True
    # 180 and -180 are the same meridian, so a span that ends at 180 touches one
    # that starts at -180.
    return _touches_antimeridian(spans_a, spans_b) or _touches_antimeridian(spans_b, spans_a)


def _touches_antimeridian(
    east_side: list[tuple[float, float]], west_side: list[tuple[float, float]]
) -> bool:
    return any(hi == 180.0 for _, hi in east_side) and any(lo == -180.0 for lo, _ in west_side)


def _matches_box(item: Item, box: BoundingBox | None) -> bool:
    """Overlap with the spatial coverage, edges touching included, like
    ``_matches_years``; an artifact with no coverage never matches an active
    box. West > east on either side crosses the antimeridian."""
    if box is None:
        return True
    coverage = _spatial(item)
    if coverage is None:
        return False
    if coverage.southlimit > box.north or coverage.northlimit < box.south:
        return False
    return _longitudes_overlap(
        (box.west, box.east), (coverage.westlimit, coverage.eastlimit)
    )


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
        and _matches_box(item, query.box)
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
    """name hit 3, keyword or tag hit 2, description hit 1, summed over the fields hit."""
    if not q or not q.strip():
        return 0
    q_lower = q.strip().lower()
    name, description, keywords = _text_fields(item)
    return (
        (3 if q_lower in name else 0)
        + (2 if any(q_lower in k for k in keywords) else 0)
        + (1 if q_lower in description else 0)
    )


def _coverage_start_key(item: Item) -> tuple[int, object]:
    """(0, start) for an item with a temporal coverage, (1, None) for one without,
    so the ones without sort last."""
    coverage = _temporal(item)
    return (1, 0) if coverage is None else (0, coverage.start)


def sort_catalogue(items: list[Item], sort: str, q: str | None = None) -> list[Item]:
    """Pure, not in-place, and total: every order ends in the id."""
    out = sorted(items, key=lambda i: i.id)
    if sort == "title-az":
        out.sort(key=lambda i: i.about.name.casefold())
    elif sort == "title-za":
        out.sort(key=lambda i: i.about.name.casefold(), reverse=True)
        # reverse=True keeps equal elements in their (id-ascending) order.
    elif sort == "coverage-start":
        # Earliest temporal coverage start first; no coverage last; then name, id.
        out.sort(key=lambda i: i.about.name.casefold())
        out.sort(key=_coverage_start_key)
    else:
        # newest, and relevance's tie-break: datePublished desc, name asc, id.
        out.sort(key=lambda i: i.about.name.casefold())
        out.sort(key=lambda i: i.about.datePublished, reverse=True)
        if sort == "relevance" and q and q.strip():
            out.sort(key=lambda i: relevance_score(i, q), reverse=True)
    return out


_NEVER = datetime.min.replace(tzinfo=timezone.utc)


def newest_registered_first(rows: list[tuple[T, dict]]) -> list[T]:
    """The first element of each ``(x, envelope)`` pair, by the envelope's
    ``registered_at`` descending, then ``_id``, so the order is total (a
    snapshot and a model input sharing an id keep the order they came in).
    Pure and not in-place; an envelope with no ``registered_at`` sorts last."""
    out = sorted(rows, key=lambda r: r[1]["_id"])
    out.sort(key=lambda r: r[1].get("registered_at") or _NEVER, reverse=True)
    # reverse=True keeps equal elements in their (id-ascending) order.
    return [x for x, _ in out]


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
