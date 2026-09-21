"""app.models.repository / app.api.v1.repository — the catalogue's shape and
its filter/sort logic.

No Mongo, no FastAPI TestClient: `DatasetResponse.from_metadata_json` and the
filter/sort/paginate functions in `app.api.v1.repository` are pure, so they
are tested directly against the three real spec examples. There is no
backend test suite to plug into yet (CONTRIBUTING.md says so) — this is the
first of it, scoped to what this mission actually rewrote.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.api.v1.repository import filter_datasets, paginate, sort_datasets
from app.models.generated.snapshot import OpenGHMSnapshotMetadata
from app.models.repository import DatasetResponse, license_url, resolution_to_degrees

EXAMPLES_DIR = Path(__file__).resolve().parents[3] / "schemas" / "snapshot-spec" / "examples"


def _load(name: str) -> DatasetResponse:
    data = json.loads((EXAMPLES_DIR / name).read_text())
    return DatasetResponse.from_metadata_json(data)


GLOBAL = "wbm_storage_v1.0.0_Global.json"
WYOMING = "wbm_storage_v1.0.0_Wyoming.json"
V2 = "wbm_storage_v2.0.0.json"


@pytest.fixture
def all_datasets() -> list[DatasetResponse]:
    return [_load(GLOBAL), _load(WYOMING), _load(V2)]


# ---- DatasetResponse.from_metadata_json ---------------------------------------


def test_loads_all_three_examples(all_datasets):
    assert len(all_datasets) == 3


def test_response_carries_spec_field_names_only():
    """The whole point of ADR 0017 + this mission: no legacy field survives."""
    d = _load(V2)
    dumped = d.model_dump(by_alias=True, mode="json")
    for legacy in ("title", "creators", "tag", "variablesMeasured", "adminMetadata",
                   "spatialResolution", "temporalResolution", "datasetType",
                   "fileSize", "format", "spinupPeriod", "isBasedOn", "processesOn",
                   "datasetVersion", "lastUpdated"):
        assert legacy not in dumped, f"legacy field {legacy!r} leaked into the response"
    for spec_field in ("id", "slug", "about", "simulation", "uses", "runtime"):
        assert spec_field in dumped


def test_derived_fields_are_present_and_correct():
    d = _load(V2)
    # v2.0.0's resolution is 5 arc-minute -> 5/60 degree
    assert d.spatialResolutionDegrees == pytest.approx(5 / 60)
    assert d.licenseUrl == "https://spdx.org/licenses/GPL-3.0-only.html"
    assert d.generatedAt == d.runtime.generatedAt


def test_resolution_to_degrees_all_units():
    from app.models.generated.snapshot import Resolution, Unit

    assert resolution_to_degrees(Resolution(value=5, unit=Unit.arc_minute)) == pytest.approx(5 / 60)
    assert resolution_to_degrees(Resolution(value=30, unit=Unit.arc_second)) == pytest.approx(30 / 3600)
    assert resolution_to_degrees(Resolution(value=0.5, unit=Unit.degree)) == pytest.approx(0.5)


def test_license_url_known_and_fallback():
    assert license_url("MIT") == "https://spdx.org/licenses/MIT.html"
    assert license_url("GPL-3.0-only") == "https://spdx.org/licenses/GPL-3.0-only.html"
    assert license_url("Apache-2.0") == "https://spdx.org/licenses/Apache-2.0"


def test_mongo_id_is_stripped_not_required():
    data = json.loads((EXAMPLES_DIR / V2).read_text())
    with_mongo_id = {**data, "_id": data["id"]}
    d = DatasetResponse.from_metadata_json(with_mongo_id)
    assert d.id == data["id"]


# ---- filter_datasets ------------------------------------------------------------


def test_filter_by_search_matches_name(all_datasets):
    # Global's about.name mentions "Global_tracking"
    result = filter_datasets(all_datasets, q="global_tracking")
    assert {d.slug for d in result} == {"wbm_storage_v1.0.0_global"}


def test_filter_by_search_matches_keyword(all_datasets):
    result = filter_datasets(all_datasets, q="hydrology")
    assert len(result) == 3  # all three examples carry "hydrology" as a keyword


def test_filter_by_search_no_match(all_datasets):
    assert filter_datasets(all_datasets, q="no-such-term-anywhere") == []


def test_filter_by_year_range_excludes_out_of_range(all_datasets):
    # Global and Wyoming: 2000-01-01..2009-12-31. v2.0.0: 2001-01-01..2001-12-31.
    result = filter_datasets(all_datasets, year_start=2005, year_end=2005)
    assert {d.slug for d in result} == {"wbm_storage_v1.0.0_global", "wbm_storage_v1.0.0_wyoming"}


def test_filter_by_year_range_all_before_excluded(all_datasets):
    result = filter_datasets(all_datasets, year_start=2020)
    assert result == []


def test_filter_by_spatial_resolution_range(all_datasets):
    # all three examples are 5 arc-minute -> ~0.0833 degrees
    assert len(filter_datasets(all_datasets, spatial_res_min=0.08, spatial_res_max=0.09)) == 3
    assert filter_datasets(all_datasets, spatial_res_max=0.01) == []


def test_filters_compose(all_datasets):
    result = filter_datasets(all_datasets, q="wyoming", year_start=2000, year_end=2009)
    assert {d.slug for d in result} == {"wbm_storage_v1.0.0_wyoming"}


# ---- sort_datasets ---------------------------------------------------------------


def test_sort_title_az_and_za(all_datasets):
    az = [d.slug for d in sort_datasets(all_datasets, "title-az")]
    za = [d.slug for d in sort_datasets(all_datasets, "title-za")]
    assert az == list(reversed(za))
    assert az == sorted(az)


def test_sort_newest(all_datasets):
    result = sort_datasets(all_datasets, "newest")
    dates = [d.generatedAt for d in result]
    assert dates == sorted(dates, reverse=True)


def test_sort_relevance_leaves_order_unchanged(all_datasets):
    assert sort_datasets(all_datasets, "relevance") == all_datasets


def test_sort_does_not_mutate_input(all_datasets):
    original_order = list(all_datasets)
    sort_datasets(all_datasets, "title-az")
    assert all_datasets == original_order


# ---- paginate ---------------------------------------------------------------------


def test_paginate_first_page(all_datasets):
    page = paginate(all_datasets, page=1, page_size=2)
    assert len(page.items) == 2
    assert page.totalCount == 3
    assert page.totalPages == 2
    assert page.page == 1


def test_paginate_last_partial_page(all_datasets):
    page = paginate(all_datasets, page=2, page_size=2)
    assert len(page.items) == 1


def test_paginate_empty_list():
    page = paginate([], page=1, page_size=5)
    assert page.items == []
    assert page.totalCount == 0
    assert page.totalPages == 1  # max(1, ...) — never zero pages for an empty list


# ---- create_dataset's write-path transform: stored doc == source file ----
#
# Regression for a real bug, caught in review: `metadata.model_dump(by_alias=True,
# mode="json")` without `exclude_none=True` writes an explicit `null` for
# every optional field the source document simply omits. An absent field
# and a `null` are not the same thing in JSON Schema — the spec types these
# as `string`/`array` with no `null` allowed — so the previously-stored
# shape failed the spec's own validation on the way back out
# (`about.creator[].orcid`, `about.relatedLink`, ...), directly contradicting
# gateway.md's "the spec's own shape, verbatim". Checked here by exact
# equality to the source file rather than importing `openghm.spec.
# validate_document` — the toolkit must not become a backend dependency —
# but the source file is itself spec-valid (packages/openghm/tests/test_spec.py),
# so exact equality to it stands in for validating the stored document.


def _stored_dataset_document(name: str) -> tuple[dict, dict]:
    """Mirrors `create_dataset`'s actual transform exactly, so this test
    fails the moment that route's `model_dump` call regresses."""
    data = json.loads((EXAMPLES_DIR / name).read_text())
    metadata = OpenGHMSnapshotMetadata.model_validate(data)
    stored = metadata.model_dump(by_alias=True, mode="json", exclude_none=True)
    stored["_id"] = stored["id"]
    return stored, data


def test_stored_dataset_document_matches_the_source_file_exactly():
    stored, data = _stored_dataset_document(V2)
    round_tripped = {k: v for k, v in stored.items() if k != "_id"}
    assert round_tripped == data


def test_stored_dataset_document_round_trips_through_the_response_model():
    """The other half of the acceptance criterion: read back (via
    `DatasetResponse.from_metadata_json`, what `GET .../datasets/{id}` uses)
    is equal to the source file once the response model's own always-present
    `null`s for genuinely absent fields are excluded — those are a response
    *shape* decision (every field always present), not a storage one."""
    stored, data = _stored_dataset_document(V2)
    d = DatasetResponse.from_metadata_json(stored)
    dumped = d.model_dump(by_alias=True, mode="json", exclude={"spatialResolutionDegrees", "licenseUrl", "generatedAt"}, exclude_none=True)
    assert dumped == data
