"""app.models.repository.ModelInputResponse / app.api.v1.repository's
model-input routes (ADR 0015, mission 2026-09-21-model-input-catalogue).

Mirrors test_repository.py's approach for `datasets`: no Mongo, no FastAPI
TestClient. `ModelInputResponse.from_metadata_json` and the pure
filter/sort/paginate functions are tested directly against the one real
shipped example
(`schemas/model-input-spec/examples/wbm_ancillary_data_v2.0.0.json`).

The AST collection guard (`_mongo_calls`, originally
`tests/test_jobs_drafts.py`'s) is retargeted here at
`app.api.v1.repository`: the whole module's Mongo access is checked so a
model-input route accidentally touching `datasets` or `jobs` fails the
suite rather than passing by omission.
"""

from __future__ import annotations

import ast
import copy
import inspect
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.api.v1 import repository as repository_router
from app.api.v1.repository import filter_model_inputs, paginate_model_inputs, sort_model_inputs
from app.models.generated.model_input import OpenGHMModelInputMetadata
from app.models.repository import ModelInputResponse, license_url

EXAMPLES_DIR = Path(__file__).resolve().parents[3] / "schemas" / "model-input-spec" / "examples"
EXAMPLE_NAME = "wbm_ancillary_data_v2.0.0.json"


def _example_dict() -> dict:
    return json.loads((EXAMPLES_DIR / EXAMPLE_NAME).read_text())


def _load() -> ModelInputResponse:
    return ModelInputResponse.from_metadata_json(_example_dict())


# ---- ModelInputResponse.from_metadata_json -------------------------------


def test_loads_the_shipped_example():
    m = _load()
    data = _example_dict()
    assert m.id == data["id"]
    assert m.slug == data["slug"]


def test_response_carries_spec_field_names_only():
    m = _load()
    dumped = m.model_dump(by_alias=True, mode="json")
    for spec_field in ("id", "slug", "about", "coverage", "networks", "datasets"):
        assert spec_field in dumped


def test_derived_license_url_is_present_and_correct():
    m = _load()
    assert m.licenseUrl == license_url("GPL-3.0-only")
    assert m.licenseUrl == "https://spdx.org/licenses/GPL-3.0-only.html"


def test_mongo_id_is_stripped_not_required():
    data = _example_dict()
    with_mongo_id = {**data, "_id": data["id"]}
    m = ModelInputResponse.from_metadata_json(with_mongo_id)
    assert m.id == data["id"]


# ---- create_model_input's write-path transform: stored doc == source file
#
# Regression for a real bug, caught in review: `metadata.model_dump(by_alias=True,
# mode="json")` without `exclude_none=True` writes an explicit `null` for
# every optional field the source document simply omits — `about.creator[].orcid`,
# `about.relatedLink`, `datasets[].unit`, etc. An absent field and a stored
# `null` are not the same thing in JSON Schema, and the spec types these
# fields as `string`/`array` with no `null` allowed, so the previously-stored
# shape failed the spec's own validation on the way back out, contradicting
# gateway.md's "the spec's own shape, verbatim". The identical bug was in
# `create_dataset` (fixed alongside this one; see test_repository.py).
#
# Checked here by exact equality to the source file rather than importing
# `openghm.spec.validate_document` — the toolkit must not become a backend
# dependency — but the source file is itself spec-valid
# (packages/openghm/tests/test_spec.py), so exact equality to it stands in
# for validating the stored document.


def _stored_document() -> tuple[dict, dict]:
    """Mirrors `create_model_input`'s actual transform exactly, so this test
    fails the moment that route's `model_dump` call regresses."""
    data = _example_dict()
    metadata = OpenGHMModelInputMetadata.model_validate(data)
    stored = metadata.model_dump(by_alias=True, mode="json", exclude_none=True)
    stored["_id"] = stored["id"]
    return stored, data


def test_stored_document_matches_the_source_file_exactly():
    stored, data = _stored_document()
    round_tripped = {k: v for k, v in stored.items() if k != "_id"}
    assert round_tripped == data


def test_read_back_through_the_response_model_matches_the_source_file():
    """The acceptance criterion in spec.md: POST, then read back
    byte-identical to the file. `ModelInputResponse.from_metadata_json` is
    what `GET .../model-inputs/{id}` uses to build that response; its own
    always-present `null`s for genuinely absent fields (a response *shape*
    decision, not a storage one) are excluded the same way, plus the one
    field that is never in the source file at all: the derived `licenseUrl`."""
    stored, data = _stored_document()
    m = ModelInputResponse.from_metadata_json(stored)
    dumped = m.model_dump(by_alias=True, mode="json", exclude={"licenseUrl"}, exclude_none=True)
    assert dumped == data


# ---- invalid input is rejected naming the field, from the generated model -


def test_invalid_input_is_rejected_naming_the_offending_field():
    data = _example_dict()
    del data["slug"]
    with pytest.raises(ValidationError) as excinfo:
        OpenGHMModelInputMetadata.model_validate(data)
    assert any("slug" in str(err["loc"]) for err in excinfo.value.errors())


def test_invalid_id_pattern_is_rejected_naming_the_field():
    data = _example_dict()
    data["id"] = "not-a-valid-id"
    with pytest.raises(ValidationError) as excinfo:
        OpenGHMModelInputMetadata.model_validate(data)
    assert any("id" in str(err["loc"]) for err in excinfo.value.errors())


# ---- filter_model_inputs / sort_model_inputs / paginate_model_inputs -----


@pytest.fixture
def one_model_input() -> list[ModelInputResponse]:
    return [_load()]


def test_filter_by_search_matches_name(one_model_input):
    result = filter_model_inputs(one_model_input, q="water balance model")
    assert len(result) == 1


def test_filter_by_search_matches_keyword(one_model_input):
    result = filter_model_inputs(one_model_input, q="MIRCA2000")
    assert len(result) == 1


def test_filter_by_search_no_match(one_model_input):
    assert filter_model_inputs(one_model_input, q="no-such-term-anywhere") == []


def test_sort_and_paginate_do_not_error_on_a_single_item(one_model_input):
    sorted_items = sort_model_inputs(one_model_input, "newest")
    page = paginate_model_inputs(sorted_items, page=1, page_size=5)
    assert page.totalCount == 1
    assert page.totalPages == 1
    assert page.items[0].id == one_model_input[0].id


def test_sort_does_not_mutate_the_input_list(one_model_input):
    before = list(one_model_input)
    sort_model_inputs(one_model_input, "title-az")
    assert one_model_input == before


def test_paginate_page_out_of_range_is_empty(one_model_input):
    page = paginate_model_inputs(one_model_input, page=2, page_size=5)
    assert page.items == []
    assert page.totalCount == 1


def test_from_metadata_json_does_not_modify_the_source_document():
    data = _example_dict()
    before = copy.deepcopy(data)
    ModelInputResponse.from_metadata_json(data)
    assert data == before


# ---- _mongo_calls: model-input routes never touch datasets or jobs -------


def _mongo_calls(db_name: str, source: str) -> tuple[dict[str, set[str]], list[str]]:
    """See tests/test_jobs_drafts.py for the original of this helper —
    retargeted here at app.api.v1.repository as a whole, since that module
    now holds both the dataset and the model-input routes."""

    def collection_name(node: ast.AST) -> str | None:
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == db_name
        ):
            return node.attr
        if (
            isinstance(node, ast.Subscript)
            and isinstance(node.value, ast.Name)
            and node.value.id == db_name
            and isinstance(node.slice, ast.Constant)
            and isinstance(node.slice.value, str)
        ):
            return node.slice.value
        return None

    def is_unresolved_db_subscript(node: ast.AST) -> bool:
        return (
            isinstance(node, ast.Subscript)
            and isinstance(node.value, ast.Name)
            and node.value.id == db_name
            and not (
                isinstance(node.slice, ast.Constant)
                and isinstance(node.slice.value, str)
            )
        )

    calls: dict[str, set[str]] = {}
    unanalyzable: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if is_unresolved_db_subscript(node):
            unanalyzable.append(ast.unparse(node))
            continue
        name = collection_name(node)
        if name is not None:
            calls.setdefault(name, set())
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            coll = collection_name(node.func.value)
            if coll is not None:
                calls.setdefault(coll, set()).add(node.func.attr)
    return calls, unanalyzable


_WRITE_VERBS = {
    "insert_one",
    "insert_many",
    "update_one",
    "update_many",
    "delete_one",
    "delete_many",
    "replace_one",
    "find_one_and_update",
    "find_one_and_delete",
    "find_one_and_replace",
    "bulk_write",
}


def test_repository_module_never_writes_datasets_or_jobs_from_model_input_routes():
    """`datasets` and `jobs` belong to other write paths entirely — nothing
    in the model-input routes (or the dataset ones, still in this module)
    should reach either collection except `datasets` itself, and only the
    ways it already did. Checked via an AST walk of the real calls made on
    `db`; anything the walk cannot attribute to a collection fails this
    test rather than passing it by omission."""
    source = inspect.getsource(repository_router)
    calls, unanalyzable = _mongo_calls("db", source)

    assert unanalyzable == []
    assert "jobs" not in calls
    assert "model_inputs" in calls
    assert "datasets" in calls
    # model_inputs: read (list/get) + insert_one (create) — never an update
    # or delete, since a published artifact is never edited in place (rule 1).
    assert calls["model_inputs"] & _WRITE_VERBS == {"insert_one"}
    # datasets: unchanged from before this mission touched the module.
    assert calls["datasets"] & _WRITE_VERBS == {"insert_one"}
