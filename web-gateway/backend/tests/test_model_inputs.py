"""app.models.repository.ModelInputResponse / app.api.v1.repository's
model-input routes (ADR 0015, mission 2026-09-21-model-input-catalogue).

Mirrors test_repository.py's approach for `datasets`: no Mongo, no FastAPI
TestClient. `ModelInputResponse.from_metadata_json` and the pure
filter/sort/paginate functions are tested directly against the one real
shipped example
(`schemas/model-input-spec/examples/wbm_ancillary_data_v2.0.0.json`). The
`create_model_input` write-path tests (below `_write_model_input_via_route`)
call the real route coroutine with `get_db` monkeypatched to a fake
collection — see test_repository.py's module docstring and that section's
block comment for why.

The AST collection guard (`_mongo_calls`, originally
`tests/test_jobs_drafts.py`'s) is retargeted here at
`app.api.v1.repository`: the whole module's Mongo access is checked so a
model-input route accidentally touching `datasets` or `jobs` fails the
suite rather than passing by omission.
"""

from __future__ import annotations

import ast
import asyncio
import copy
import inspect
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.api.v1 import repository as repository_router
from app.api.v1.repository import filter_model_inputs, paginate_model_inputs, sort_model_inputs
from app.models.generated.model_input import OpenGHMModelInputMetadata
from app.models.repository import ModelInputResponse, build_envelope, license_url

EXAMPLES_DIR = Path(__file__).resolve().parents[3] / "schemas" / "model-input-spec" / "examples"
EXAMPLE_NAME = "wbm_ancillary_data_v2.0.0.json"


def _example_dict() -> dict:
    return json.loads((EXAMPLES_DIR / EXAMPLE_NAME).read_text())


def _load() -> ModelInputResponse:
    return ModelInputResponse.from_metadata_json(build_envelope(_example_dict()))


# ---- a fake Mongo collection, for calling the real route function without
# a real database (mirrors test_repository.py's `_FakeCollection`/`_FakeDB`
# — see that file for why a route that stores something has to be called
# for real at least once).


class _FakeCollection:
    def __init__(self) -> None:
        self.inserted: dict | None = None

    async def insert_one(self, doc: dict) -> None:
        self.inserted = doc


class _FakeDB:
    def __init__(self) -> None:
        self._collections: dict[str, _FakeCollection] = {}

    def __getitem__(self, name: str) -> _FakeCollection:
        return self._collections.setdefault(name, _FakeCollection())


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


def test_envelopes_own_fields_are_ignored_by_the_response():
    """`owner_user_id`/`visibility`/`registered_at` (mission
    2026-09-23-catalogue-envelope) are the gateway's own bookkeeping, not
    part of the spec document — the response is built from `document` alone."""
    data = _example_dict()
    envelope = build_envelope(data, owner_user_id="someone", visibility="private")
    m = ModelInputResponse.from_metadata_json(envelope)
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
# Since mission 2026-09-23-catalogue-envelope, the stored Mongo record is an
# envelope ({_id, document, owner_user_id, visibility, registered_at}) built
# by `app.models.repository.build_envelope`. The three tests below call the
# real `create_model_input` coroutine — not a copy of its transform — with
# `get_db` monkeypatched to `_FakeDB` (above), so what's asserted on is
# exactly what the route itself handed to `insert_one`. See
# test_repository.py's equivalent block comment: an earlier version of this
# file called `build_envelope` directly instead of going through the route,
# which does not actually guard the route wrapping at all — confirmed
# empirically by substituting the pre-mission flat shape into both write
# paths and watching the old version of this suite stay green.


def _write_model_input_via_route(monkeypatch: pytest.MonkeyPatch) -> tuple[dict, dict]:
    """Calls the real `POST /repository/model-inputs` handler
    (`create_model_input`) as the coroutine FastAPI would run, capturing
    what it actually inserts."""
    fake_db = _FakeDB()
    monkeypatch.setattr(repository_router, "get_db", lambda: fake_db)
    data = _example_dict()
    metadata = OpenGHMModelInputMetadata.model_validate(data)
    asyncio.run(repository_router.create_model_input(metadata))
    envelope = fake_db["model_inputs"].inserted
    assert envelope is not None, "create_model_input did not call insert_one"
    return envelope, data


def test_stored_document_matches_the_source_file_exactly(monkeypatch):
    envelope, data = _write_model_input_via_route(monkeypatch)
    assert envelope["document"] == data
    assert envelope["_id"] == data["id"]


def test_read_back_through_the_response_model_matches_the_source_file(monkeypatch):
    """The acceptance criterion in spec.md: POST, then read back
    byte-identical to the file. `ModelInputResponse.from_metadata_json` is
    what `GET .../model-inputs/{id}` uses to build that response; its own
    always-present `null`s for genuinely absent fields (a response *shape*
    decision, not a storage one) are excluded the same way, plus the one
    field that is never in the source file at all: the derived `licenseUrl`."""
    envelope, data = _write_model_input_via_route(monkeypatch)
    m = ModelInputResponse.from_metadata_json(envelope)
    dumped = m.model_dump(by_alias=True, mode="json", exclude={"licenseUrl"}, exclude_none=True)
    assert dumped == data


def test_stored_document_validates_against_its_own_spec(monkeypatch):
    """The mission's one-sentence definition of done:
    `openghm.spec.validate_document` passes on what comes straight out of
    Mongo (`envelope["document"]`), with nothing deleted first. Goes through
    the real route (`_write_model_input_via_route`), not a hand-copied
    approximation of its transform — see the block comment above."""
    from openghm import spec as openghm_spec

    envelope, _ = _write_model_input_via_route(monkeypatch)
    result = openghm_spec.validate_document(envelope["document"], spec="model-input-spec")
    assert result.ok, result.errors


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
    envelope = build_envelope(_example_dict())
    before = copy.deepcopy(envelope)
    ModelInputResponse.from_metadata_json(envelope)
    assert envelope == before


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
