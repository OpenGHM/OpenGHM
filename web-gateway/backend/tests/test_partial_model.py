"""app.models.partial — the optional-everywhere model builder.

Salvaged from the abandoned ``2026-09-20-snapshot-drafts`` mission
(``tests/test_draft_model.py``, T1) and retargeted: these tests exercised
``PartialSnapshotMetadata`` (a partial view of the *whole* generated
snapshot), which no longer exists as a production type now that a
simulation only needs a partial ``about`` (``app.models.job.PartialAbout``).
The mechanism being pinned — nested/list partials, ``constr`` metadata
surviving, enums still validating, ``extra="forbid"`` — is exactly the same,
so it is tested here directly against the full generated
``OpenGHMSnapshotMetadata``, which exercises it more thoroughly than
``PartialAbout`` alone would.

Pure Pydantic, no Mongo, no FastAPI TestClient — same style as
test_repository.py.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.generated.snapshot import OpenGHMSnapshotMetadata
from app.models.partial import _partial_model

PartialSnapshot = _partial_model(
    OpenGHMSnapshotMetadata, exclude=frozenset({"id", "runtime"})
)


# ---- what a partial model accepts -----------------------------------------


def test_completely_empty_partial_is_valid():
    draft = PartialSnapshot()
    assert draft.about is None
    assert draft.simulation is None
    assert draft.slug is None


def test_excluded_fields_are_not_fields_at_all():
    """`exclude` drops a field entirely rather than making it optional."""
    assert "id" not in PartialSnapshot.model_fields
    assert "runtime" not in PartialSnapshot.model_fields
    with pytest.raises(ValidationError):
        # extra="forbid" — even supplying them is rejected, not silently dropped
        PartialSnapshot(id="a" * 64)


def test_one_top_level_section_filled_in_at_a_time():
    draft = PartialSnapshot(slug="my-draft")
    assert draft.slug == "my-draft"
    assert draft.about is None


def test_partial_nested_object_only_some_fields_set():
    """`about` is a required, fully-populated block on the real model; here,
    only `name` is filled in."""
    draft = PartialSnapshot.model_validate({"about": {"name": "My run"}})
    assert draft.about.name == "My run"
    assert draft.about.description is None
    assert draft.about.creator is None


def test_partial_list_item_only_some_fields_set():
    """A list that's normally `min_length=1` of fully-populated items (here,
    `simulation.inputVariables`) can hold a partially-filled entry."""
    draft = PartialSnapshot.model_validate(
        {"simulation": {"inputVariables": [{}]}}
    )
    assert draft.simulation.inputVariables == [draft.simulation.inputVariables[0]]
    assert draft.simulation.inputVariables[0].role is None
    assert draft.simulation.inputVariables[0].dataset is None


def test_present_field_still_has_to_be_the_right_shape():
    """Structural validation is not skipped just because the model is
    partial — a value that's present has to be well-formed."""
    with pytest.raises(ValidationError) as excinfo:
        PartialSnapshot.model_validate({"about": {"name": ""}})  # min_length=1
    assert "about" in str(excinfo.value) and "name" in str(excinfo.value)


def test_enum_field_still_rejects_an_unknown_value():
    with pytest.raises(ValidationError) as excinfo:
        PartialSnapshot.model_validate(
            {"simulation": {"inputVariables": [{"role": "not-a-real-role"}]}}
        )
    assert "role" in str(excinfo.value)


def test_unknown_field_is_rejected_not_silently_dropped():
    with pytest.raises(ValidationError):
        PartialSnapshot.model_validate({"nonexistent_field": 1})


def test_fully_populated_partial_matching_a_real_snapshot_shape_is_valid():
    """A partial model can also hold everything the real one would, minus
    the excluded fields — it becomes incomplete only when it wants to."""
    import json
    from pathlib import Path

    examples = (
        Path(__file__).resolve().parents[3]
        / "schemas"
        / "snapshot-spec"
        / "examples"
        / "wbm_storage_v2.0.0.json"
    )
    data = json.loads(examples.read_text())
    data = {k: v for k, v in data.items() if k not in ("id", "runtime")}
    draft = PartialSnapshot.model_validate(data)
    assert draft.slug == data["slug"]
    assert draft.about.name == data["about"]["name"]


# ---- the pydantic-v2 subtlety this helper exists for -----------------------


def test_constr_min_length_survives_into_the_partial_field():
    """The whole reason `_partial_model` reattaches `info.metadata`: without
    it, `about.name`'s `constr(min_length=1)` would be lost when the field is
    made optional, and an empty string would silently pass."""
    with pytest.raises(ValidationError):
        PartialSnapshot.model_validate({"about": {"name": ""}})
