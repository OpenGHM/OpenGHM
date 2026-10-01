"""app.services.catalogue / GET /api/v1/repository/catalogue — the mixed
snapshot + model-input list with facets.

The logic is pure, so it is tested directly against the real shipped spec
examples (``schemas/*/examples``), plus two small variants built by deep-copying
an example and editing it (the shipped ones share a creator, a licence and a
category, which would leave most facets with one option). The route itself is
exercised once through a ``TestClient`` with ``_load_catalogue`` replaced, for
the query-parameter contract (repeated params, 422 on a bad ``type``).
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import repository as repository_router
from app.models.repository import ModelInputCatalogueItem, SnapshotCatalogueItem, build_envelope
from app.services.catalogue import CatalogueQuery, build_catalogue, relevance_score

SCHEMAS = Path(__file__).resolve().parents[3] / "schemas"


def _example(spec: str, name: str) -> dict:
    return json.loads((SCHEMAS / spec / "examples" / name).read_text())


def _snap(doc: dict) -> SnapshotCatalogueItem:
    return SnapshotCatalogueItem.from_metadata_json(build_envelope(doc))


def _mi(doc: dict) -> ModelInputCatalogueItem:
    return ModelInputCatalogueItem.from_metadata_json(build_envelope(doc))


GLOBAL_ID = _example("snapshot-spec", "wbm_storage_v1.0.0_Global.json")["id"]
WYOMING_ID = _example("snapshot-spec", "wbm_storage_v1.0.0_Wyoming.json")["id"]
V2_ID = _example("snapshot-spec", "wbm_storage_v2.0.0.json")["id"]
MI1_ID = _example("model-input-spec", "wbm_ancillary_data_v1.0.0.json")["id"]
MI2_ID = _example("model-input-spec", "wbm_ancillary_data_v2.0.0.json")["id"]
ZETA_ID = "a" * 64
SOIL_ID = "b" * 64


def _zeta_doc() -> dict:
    """A snapshot unlike the shipped three: other creator, category, licence,
    WBM version, period, resolution and only one output."""
    d = copy.deepcopy(_example("snapshot-spec", "wbm_storage_v2.0.0.json"))
    d["id"] = ZETA_ID
    d["slug"] = "zeta-flood-study"
    d["about"].update(
        name="Zeta flood study", category="research", license="MIT", datePublished="2025-01-01",
        description="Peak flows.", keywords=["flooding"],
    )
    d["about"]["creator"] = [{"name": "Alex Doe"}]
    d["uses"]["container"]["version"] = "3.0.0"
    d["simulation"]["temporalCoverage"] = {"start": "2010-01-01", "end": "2015-12-31"}
    d["simulation"]["resolution"] = {"value": 30, "unit": "arc-second"}
    d["simulation"]["outputVariables"] = [
        v for v in d["simulation"]["outputVariables"] if v["name"] == "discharge"
    ]
    d["simulation"]["inputVariables"] = d["simulation"]["inputVariables"][:1]  # precipitation only
    d["simulation"]["activeProcesses"] = ["Reservoirs"]
    return d


def _soil_doc() -> dict:
    """A climatological model input: no temporal coverage, one 30 arc-second
    network and one without a resolution."""
    d = copy.deepcopy(_example("model-input-spec", "wbm_ancillary_data_v2.0.0.json"))
    d["id"] = SOIL_ID
    d["slug"] = "soil-texture"
    d["about"].update(
        name="Soil texture", category="climate", license="MIT", datePublished="2024-06-01",
        description="Sand and clay fractions.", keywords=["soil"],
    )
    d["about"]["creator"] = [{"name": "Alex Doe"}]
    del d["coverage"]["temporalCoverage"]
    d["networks"] = [
        {"file": "network/a.asc", "resolution": {"value": 30, "unit": "arc-second"}},
        {"file": "network/b.asc"},
    ]
    return d


@pytest.fixture
def items():
    return [
        _snap(_example("snapshot-spec", "wbm_storage_v1.0.0_Global.json")),
        _snap(_example("snapshot-spec", "wbm_storage_v1.0.0_Wyoming.json")),
        _snap(_example("snapshot-spec", "wbm_storage_v2.0.0.json")),
        _snap(_zeta_doc()),
        _mi(_example("model-input-spec", "wbm_ancillary_data_v1.0.0.json")),
        _mi(_example("model-input-spec", "wbm_ancillary_data_v2.0.0.json")),
        _mi(_soil_doc()),
    ]


def _ids(resp) -> list[str]:
    return [i.id for i in resp.items]


def _run(items, *, sort="newest", page=1, page_size=100, **kw):
    selected = {k: tuple(kw.pop(k)) for k in list(kw) if k in
                ("type", "category", "keyword", "creator", "license", "output", "forcing", "process", "wbm")}
    return build_catalogue(items, CatalogueQuery(selected=selected, **kw), sort=sort, page=page, page_size=page_size)


def _facet(resp, name) -> dict[str, int]:
    return {o.value: o.count for o in getattr(resp.facets, name)}


# ---- kind ----------------------------------------------------------------


def test_kind_discriminator_and_unchanged_fields(items):
    resp = _run(items)
    assert resp.totalCount == 7
    kinds = {i.id: i.kind for i in resp.items}
    assert kinds[GLOBAL_ID] == "snapshot" and kinds[MI1_ID] == "model-input"
    dumped = resp.model_dump(by_alias=True, mode="json")
    snap = next(i for i in dumped["items"] if i["id"] == V2_ID)
    mi = next(i for i in dumped["items"] if i["id"] == MI2_ID)
    assert snap["kind"] == "snapshot" and "spatialResolutionDegrees" in snap and "generatedAt" in snap
    assert mi["kind"] == "model-input" and "licenseUrl" in mi and "spatialResolutionDegrees" not in mi


def test_type_filter(items):
    assert set(_ids(_run(items, type=["model-input"]))) == {MI1_ID, MI2_ID, SOIL_ID}
    assert len(_run(items, type=["snapshot"]).items) == 4
    assert len(_run(items, type=["snapshot", "model-input"]).items) == 7


# ---- facet filters -------------------------------------------------------


def test_category_creator_license_apply_to_both_kinds(items):
    assert set(_ids(_run(items, category=["climate"]))) == {SOIL_ID}
    assert set(_ids(_run(items, creator=["Alex Doe"]))) == {ZETA_ID, SOIL_ID}
    assert set(_ids(_run(items, license=["MIT"]))) == {ZETA_ID, SOIL_ID}
    assert set(_ids(_run(items, category=["ancillary-data"]))) == {MI1_ID, MI2_ID}


def test_keyword_facet_matches_exactly_on_both_kinds(items):
    assert set(_ids(_run(items, keyword=["hydrology"]))) == {GLOBAL_ID, WYOMING_ID, V2_ID, MI1_ID, MI2_ID}
    assert set(_ids(_run(items, keyword=["MIRCA2000"]))) == {MI1_ID, MI2_ID}
    assert set(_ids(_run(items, keyword=["WBM tutorial"]))) == {V2_ID}
    # exact, not substring and not case-folded (q is the substring search)
    assert _run(items, keyword=["hydro"]).items == []
    assert _run(items, keyword=["Hydrology"]).items == []
    # OR within the facet, AND with another facet
    assert set(_ids(_run(items, keyword=["flooding", "soil"]))) == {ZETA_ID, SOIL_ID}
    assert set(_ids(_run(items, keyword=["flooding", "soil"], type=["snapshot"]))) == {ZETA_ID}
    assert set(_ids(_run(items, keyword=["hydrology"], category=["ancillary-data"]))) == {MI1_ID, MI2_ID}


def test_keyword_facet_options_sort_and_disjunctive_counts(items):
    resp = _run(items)
    assert [(o.value, o.label, o.count) for o in resp.facets.keyword] == [
        ("hydrology", "hydrology", 5), ("Water Balance Model", "Water Balance Model", 5),
        ("ancillary data", "ancillary data", 2), ("MIRCA2000", "MIRCA2000", 2),
        ("RGI-6 glaciers", "RGI-6 glaciers", 2),
        ("flooding", "flooding", 1), ("Global_tracking", "Global_tracking", 1), ("soil", "soil", 1),
        ("WBM tutorial", "WBM tutorial", 1), ("Wyoming_tracking", "Wyoming_tracking", 1),
    ]
    # ticking one keyword leaves its siblings' counts intact ...
    resp = _run(items, keyword=["MIRCA2000"])
    assert _facet(resp, "keyword") == _facet(_run(items), "keyword")
    # ... and narrows every other group
    assert _facet(resp, "category") == {"ancillary-data": 2}
    assert _facet(resp, "type") == {"snapshot": 0, "model-input": 2}
    # another group's selection narrows the keyword group
    assert _facet(_run(items, type=["model-input"]), "keyword") == {
        "hydrology": 2, "Water Balance Model": 2, "ancillary data": 2, "MIRCA2000": 2,
        "RGI-6 glaciers": 2, "soil": 1,
    }
    # a selected keyword with no match is listed with count 0
    resp = _run(items, keyword=["nonesuch"])
    assert resp.items == [] and _facet(resp, "keyword")["nonesuch"] == 0


def test_snapshot_only_facets_exclude_model_inputs(items):
    for facet, value in (("output", "discharge"), ("forcing", "precipitation"),
                         ("process", "Reservoirs"), ("wbm", "2.0.0")):
        got = _run(items, **{facet: [value]})
        assert got.items, facet
        assert all(i.kind == "snapshot" for i in got.items), facet
    assert set(_ids(_run(items, wbm=["2.0.0"]))) == {V2_ID}
    assert set(_ids(_run(items, process=["Reservoirs"]))) == {GLOBAL_ID, WYOMING_ID, ZETA_ID}
    assert set(_ids(_run(items, forcing=["airTemperature"]))) == {GLOBAL_ID, WYOMING_ID, V2_ID}
    assert set(_ids(_run(items, output=["streamAge"]))) == {V2_ID}


def test_or_within_a_facet_and_across_facets(items):
    assert set(_ids(_run(items, wbm=["1.0.0", "2.0.0"]))) == {GLOBAL_ID, WYOMING_ID, V2_ID}
    both = _run(items, wbm=["1.0.0", "2.0.0"], creator=["Casey Nolan"])
    assert set(_ids(both)) == {V2_ID}
    assert _run(items, category=["climate"], license=["GPL-3.0-only"]).items == []


# ---- ranges --------------------------------------------------------------


def test_year_overlap_both_kinds_and_missing_coverage(items):
    # 2012 only overlaps zeta (2010-2015) and the 1980-2019 model inputs;
    # the climatological one has no coverage, so a year filter drops it.
    got = _run(items, year_start=2012, year_end=2012)
    assert set(_ids(got)) == {ZETA_ID, MI1_ID, MI2_ID}
    assert set(_ids(_run(items, year_end=2000))) == {GLOBAL_ID, WYOMING_ID, V2_ID, MI1_ID, MI2_ID}
    assert set(_ids(_run(items, year_start=2020))) == set()
    assert SOIL_ID in _ids(_run(items))


def test_spatial_resolution_snapshots_and_model_input_networks(items):
    deg30s = 30 / 3600
    # fine band: zeta (30 arc-sec) and soil's one resolved network
    assert set(_ids(_run(items, spatial_res_max=0.01))) == {ZETA_ID, SOIL_ID}
    assert deg30s < 0.01
    # coarse band: the 5 arc-minute (0.0833) ones. A model input matches by ANY network.
    coarse = _run(items, spatial_res_min=0.05, spatial_res_max=0.1)
    assert set(_ids(coarse)) == {GLOBAL_ID, WYOMING_ID, V2_ID, MI1_ID, MI2_ID}


def test_model_input_without_resolved_network_never_matches_resolution():
    d = _soil_doc()
    d["networks"] = [{"file": "network/b.asc"}]
    only = [_mi(d)]
    assert _run(only, spatial_res_min=0.0).items == []
    assert _run(only, spatial_res_max=10.0).items == []
    assert len(_run(only).items) == 1


# ---- q and relevance -----------------------------------------------------


def test_q_is_case_insensitive_over_name_description_keywords(items):
    assert set(_ids(_run(items, q="ZETA"))) == {ZETA_ID}
    assert set(_ids(_run(items, q="flooding"))) == {ZETA_ID}
    assert set(_ids(_run(items, q="clay fractions"))) == {SOIL_ID}
    assert SOIL_ID not in _ids(_run(items, q="wyoming"))


def test_relevance_score_weights():
    d = _zeta_doc()
    d["about"].update(name="Flood atlas", keywords=["flood"], description="About flood.")
    item = _snap(d)
    assert relevance_score(item, "flood") == 3 + 2 + 1
    assert relevance_score(item, "atlas") == 3
    assert relevance_score(item, "FLOOD") == 6
    assert relevance_score(item, None) == 0
    assert relevance_score(item, "absent") == 0


def test_relevance_orders_by_score_then_newest(items):
    # "soil" hits the name (3) and the keyword (2) of the soil input; the ancillary
    # inputs mention soil only in their description (1) or not at all.
    got = _run(items, q="soil", sort="relevance")
    assert got.items[0].id == SOIL_ID
    scores = [relevance_score(i, "soil") for i in got.items]
    assert scores == sorted(scores, reverse=True)
    # no q -> datePublished desc, then name asc, then id
    no_q = _ids(_run(items, sort="relevance"))
    assert no_q == _ids(_run(items, sort="newest"))


# ---- sorting -------------------------------------------------------------


def test_sort_newest(items):
    got = _ids(_run(items, sort="newest"))
    # 2026-09-23 x3 (name asc: Global, Wyoming, v2.0.0), 2025 zeta, 2024 soil, 2022 x2 (same name -> id)
    assert got[:3] == [GLOBAL_ID, WYOMING_ID, V2_ID]
    assert got[3:5] == [ZETA_ID, SOIL_ID]
    assert got[5:] == sorted([MI1_ID, MI2_ID])


def test_sort_title(items):
    az = [i.about.name for i in _run(items, sort="title-az").items]
    assert az == sorted(az, key=str.casefold)
    za = [i.about.name for i in _run(items, sort="title-za").items]
    assert za == sorted(za, key=str.casefold, reverse=True)
    # equal names (the two ancillary inputs) tie on id, ascending, in both directions
    tied_az = [i for i in _ids(_run(items, sort="title-az")) if i in (MI1_ID, MI2_ID)]
    tied_za = [i for i in _ids(_run(items, sort="title-za")) if i in (MI1_ID, MI2_ID)]
    assert tied_az == tied_za == sorted([MI1_ID, MI2_ID])


# ---- pagination ----------------------------------------------------------


def test_pagination(items):
    p1 = _run(items, page_size=3, page=1)
    p3 = _run(items, page_size=3, page=3)
    assert (p1.totalCount, p1.totalPages, len(p1.items)) == (7, 3, 3)
    assert len(p3.items) == 1
    assert _run(items, page_size=3, page=4).items == []
    assert _run(items, page_size=3, page=4).totalPages == 3


def test_empty_result_and_empty_catalogue(items):
    none = _run(items, q="no such thing")
    assert (none.items, none.totalCount, none.totalPages, none.page) == ([], 0, 1, 1)
    assert none.facets.yearBounds is not None  # whole catalogue, not the filtered set
    empty = _run([])
    assert empty.facets.yearBounds is None and empty.totalPages == 1
    assert [o.value for o in empty.facets.type] == ["snapshot", "model-input"]
    assert all(o.count == 0 for o in empty.facets.type)


# ---- facets --------------------------------------------------------------


def test_type_facet_is_fixed_and_labelled(items):
    resp = _run(items)
    assert [(o.value, o.label, o.count) for o in resp.facets.type] == [
        ("snapshot", "Model Snapshot", 4), ("model-input", "Model Input", 3),
    ]


def test_facet_sorting_and_labels(items):
    resp = _run(items)
    cat = resp.facets.category
    assert [(o.value, o.count) for o in cat] == [
        ("ancillary-data", 2), ("publication", 2), ("climate", 1), ("research", 1), ("tutorial", 1),
    ]
    out = {o.value: o.label for o in resp.facets.output}
    assert out["discharge"] == "Discharge"          # label is simulation.outputVariables[].fullName
    forcing = {o.value: o.label for o in resp.facets.forcing}
    assert forcing["airTemperature"] == "airTemperature"  # raw role; the frontend humanises it
    assert _facet(resp, "wbm") == {"1.0.0": 2, "2.0.0": 1, "3.0.0": 1}
    assert _facet(resp, "creator")["Alex Doe"] == 2


def test_facets_are_disjunctive_concrete_case(items):
    # Ticking wbm=1.0.0 keeps its siblings visible with their own counts ...
    resp = _run(items, wbm=["1.0.0"])
    assert _facet(resp, "wbm") == {"1.0.0": 2, "2.0.0": 1, "3.0.0": 1}
    # ... while every OTHER group is narrowed by it (model inputs fall away).
    assert _facet(resp, "category") == {"publication": 2}
    assert _facet(resp, "type") == {"snapshot": 2, "model-input": 0}
    assert _facet(resp, "creator") == {"Jordan Rivera": 2, "Sam Whitfield": 2}
    assert len(resp.items) == 2


def test_facet_counts_respect_q_and_ranges_but_not_own_group(items):
    resp = _run(items, category=["tutorial"], year_end=2001)
    # category group ignores its own selection: v2 (tutorial) plus the two publications and model inputs <= 2001
    assert _facet(resp, "category") == {"ancillary-data": 2, "publication": 2, "tutorial": 1}
    # the type group applies the category selection: only v2 is left
    assert _facet(resp, "type") == {"snapshot": 1, "model-input": 0}


def test_selected_value_with_no_match_is_listed_with_zero(items):
    resp = _run(items, wbm=["9.9.9"], category=["publication"])
    assert resp.items == []
    assert _facet(resp, "wbm")["9.9.9"] == 0
    wbm = next(o for o in resp.facets.wbm if o.value == "9.9.9")
    assert wbm.label == "9.9.9"
    # a selected option the catalogue does know keeps its real label
    resp = _run(items, output=["streamAge"], category=["research"])
    stream = next(o for o in resp.facets.output if o.value == "streamAge")
    assert stream.count == 0 and stream.label == "Stream Age (water residence time)"
    # and zero-count options that were not selected are not listed
    assert "streamAge" not in {o.value for o in _run(items, category=["research"]).facets.output}


def test_year_bounds_cover_the_whole_catalogue_not_the_filter(items):
    assert _run(items).facets.yearBounds.model_dump() == {"min": 1980, "max": 2019}
    assert _run(items, q="zeta").facets.yearBounds.model_dump() == {"min": 1980, "max": 2019}
    only_snap = [i for i in items if i.kind == "snapshot"]
    assert _run(only_snap).facets.yearBounds.model_dump() == {"min": 2000, "max": 2015}


# ---- the route -----------------------------------------------------------


@pytest.fixture
def http(items, monkeypatch):
    async def load():
        return items

    monkeypatch.setattr(repository_router, "_load_catalogue", load)
    app = FastAPI()
    app.include_router(repository_router.router, prefix="/api/v1")
    return TestClient(app)


def test_route_response_shape_and_defaults(http):
    r = http.get("/api/v1/repository/catalogue")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"items", "totalCount", "totalPages", "page", "facets"}
    assert set(body["facets"]) == {"type", "category", "keyword", "creator", "license", "output",
                                   "forcing", "process", "wbm", "yearBounds"}
    assert list(body["facets"])[:3] == ["type", "category", "keyword"]
    assert body["totalCount"] == 7 and len(body["items"]) == 7  # default page_size 10
    assert {i["kind"] for i in body["items"]} == {"snapshot", "model-input"}


def test_route_repeated_params_and_comma_values(http):
    r = http.get("/api/v1/repository/catalogue", params=[("wbm", "1.0.0"), ("wbm", "2.0.0"), ("sort", "title-az")])
    assert {i["id"] for i in r.json()["items"]} == {GLOBAL_ID, WYOMING_ID, V2_ID}
    r = http.get("/api/v1/repository/catalogue", params=[("type", "model-input"), ("type", "snapshot")])
    assert r.json()["totalCount"] == 7
    # a value containing a comma is one value, not a list
    r = http.get("/api/v1/repository/catalogue", params={"creator": "Doe, Alex"})
    assert r.json()["totalCount"] == 0
    # keyword repeats like the other facets
    r = http.get("/api/v1/repository/catalogue", params=[("keyword", "WBM tutorial"), ("keyword", "soil")])
    assert {i["id"] for i in r.json()["items"]} == {V2_ID, SOIL_ID}


def test_route_validation(http):
    assert http.get("/api/v1/repository/catalogue", params={"type": "dataset"}).status_code == 422
    assert http.get("/api/v1/repository/catalogue", params={"sort": "random"}).status_code == 422
    assert http.get("/api/v1/repository/catalogue", params={"page": 0}).status_code == 422
    assert http.get("/api/v1/repository/catalogue", params={"page_size": 101}).status_code == 422
    assert http.get("/api/v1/repository/catalogue", params={"page": 9}).json()["items"] == []
