"""openghm.spec — validating a document and a folder against a published spec.

Positive cases use the real examples under ``schemas/*/examples/`` (the same
files the schemas themselves are checked against in the repository); negative
cases mutate a copy of one rather than hand-writing a fixture, so a failure
always points at a real, plausible mistake.
"""

from __future__ import annotations

import copy
import json

import pytest

from openghm import spec
from openghm.errors import OpenghmError

SNAPSHOT_EXAMPLE = json.loads(
    (spec.schemas_root() / "snapshot-spec" / "examples" / "wbm_storage_v2.0.0.json").read_text()
)
MODEL_INPUT_EXAMPLE = json.loads(
    (spec.schemas_root() / "model-input-spec" / "examples" / "wbm_ancillary_data_v2.0.0.json").read_text()
)

SNAPSHOT_LAYOUT_DIRS = [
    "model", "utilities", "wbm_init", "data", "data_init", "gdal_test_files", "wbm_output",
]
MODEL_INPUT_LAYOUT_DIRS = ["data_init"]


def _make_snapshot_folder(tmp_path):
    for d in SNAPSHOT_LAYOUT_DIRS:
        (tmp_path / d).mkdir()
    (tmp_path / "metadata.json").write_text(json.dumps(SNAPSHOT_EXAMPLE))
    return tmp_path


def _make_model_input_folder(tmp_path):
    for d in MODEL_INPUT_LAYOUT_DIRS:
        (tmp_path / d).mkdir()
    (tmp_path / "metadata.json").write_text(json.dumps(MODEL_INPUT_EXAMPLE))
    return tmp_path


# ---- current_version ---------------------------------------------------------


def test_current_version():
    assert spec.current_version("snapshot-spec") == "1.0.0"
    assert spec.current_version("model-input-spec") == "1.0.0"


def test_unknown_spec_raises():
    with pytest.raises(OpenghmError, match="unknown spec"):
        spec.current_version("bogus-spec")


def test_unknown_version_raises():
    with pytest.raises(OpenghmError, match="unknown snapshot-spec version"):
        spec.validate_document(SNAPSHOT_EXAMPLE, spec="snapshot-spec", version="9.9.9")


# ---- validate_document — positive ---------------------------------------------


def test_snapshot_example_validates():
    result = spec.validate_document(SNAPSHOT_EXAMPLE, spec="snapshot-spec")
    assert result.ok, result.errors


def test_model_input_example_validates():
    result = spec.validate_document(MODEL_INPUT_EXAMPLE, spec="model-input-spec")
    assert result.ok, result.errors


def test_ref_into_common_is_actually_checked():
    """A document that satisfies everything except the shared `about` block
    (resolved via $ref into schemas/common/) must still fail — proof the ref
    is really being followed, not silently skipped."""
    bad = copy.deepcopy(SNAPSHOT_EXAMPLE)
    del bad["about"]["license"]
    result = spec.validate_document(bad, spec="snapshot-spec")
    assert not result.ok
    assert any("license" in e for e in result.errors)


def test_format_checking_is_actually_on():
    """jsonschema does not enable format checking by default — without an
    explicit format_checker, "format": "date" accepts a syntactically
    string-shaped non-date like "1980-01-00" silently. This is a regression
    test for exactly that: two records in the real model-input example
    carried it (a day-00 placeholder) until a stricter generator caught it."""
    bad = copy.deepcopy(SNAPSHOT_EXAMPLE)
    bad["simulation"]["temporalCoverage"]["start"] = "1980-01-00"
    result = spec.validate_document(bad, spec="snapshot-spec")
    assert not result.ok
    assert any("start" in e for e in result.errors)


# ---- validate_document — negative: schema shape -------------------------------


def test_missing_required_top_level_field():
    bad = copy.deepcopy(SNAPSHOT_EXAMPLE)
    del bad["slug"]
    result = spec.validate_document(bad, spec="snapshot-spec")
    assert not result.ok
    assert any("slug" in e for e in result.errors)


def test_wrong_projection_rejected():
    bad = copy.deepcopy(SNAPSHOT_EXAMPLE)
    bad["simulation"]["spatialCoverage"]["projection"] = "EPSG:3408"
    result = spec.validate_document(bad, spec="snapshot-spec")
    assert not result.ok
    assert any("projection" in e for e in result.errors)


# ---- validate_document — negative: uniqueness the schema can't express -------


def test_duplicate_input_variable_role_rejected():
    bad = copy.deepcopy(SNAPSHOT_EXAMPLE)
    bad["simulation"]["inputVariables"].append(dict(bad["simulation"]["inputVariables"][0]))
    result = spec.validate_document(bad, spec="snapshot-spec")
    assert not result.ok
    assert any("duplicate role" in e for e in result.errors)


def test_duplicate_dataset_code_rejected():
    bad = copy.deepcopy(MODEL_INPUT_EXAMPLE)
    bad["datasets"].append(dict(bad["datasets"][0]))
    result = spec.validate_document(bad, spec="model-input-spec")
    assert not result.ok
    assert any("duplicate code" in e for e in result.errors)


def test_unique_roles_do_not_false_positive():
    # the real example already has >1 inputVariables entries with distinct
    # roles — validating it must not trip the duplicate check.
    assert len(SNAPSHOT_EXAMPLE["simulation"]["inputVariables"]) > 1
    result = spec.validate_document(SNAPSHOT_EXAMPLE, spec="snapshot-spec")
    assert result.ok, result.errors


# ---- validate_layout -----------------------------------------------------------


def test_layout_passes_on_a_complete_folder(tmp_path):
    folder = _make_snapshot_folder(tmp_path)
    result = spec.validate_layout(folder, spec="snapshot-spec")
    assert result.ok
    assert result.missing_required == []


def test_layout_fails_on_a_missing_required_path(tmp_path):
    folder = _make_snapshot_folder(tmp_path)
    (folder / "data_init").rmdir()
    result = spec.validate_layout(folder, spec="snapshot-spec")
    assert not result.ok
    assert "data_init/" in result.missing_required


def test_layout_does_not_require_optional_paths(tmp_path):
    # SHA256SUMS is optional — no staged snapshot has one (snapshot-layout.md)
    folder = _make_snapshot_folder(tmp_path)
    result = spec.validate_layout(folder, spec="snapshot-spec")
    assert result.ok


# ---- validate_folder — the combined check --------------------------------------


def test_validate_folder_both_halves_pass(tmp_path):
    folder = _make_snapshot_folder(tmp_path)
    result = spec.validate_folder(folder, spec="snapshot-spec")
    assert result.ok
    assert result.document.ok and result.layout.ok


def test_validate_folder_reports_both_halves_independently(tmp_path):
    """A folder can fail one half and pass the other — the two must not be
    collapsed into a single message (ADR 0006: two files, two kinds of check)."""
    folder = _make_snapshot_folder(tmp_path)
    (folder / "wbm_init").rmdir()
    bad_meta = copy.deepcopy(SNAPSHOT_EXAMPLE)
    del bad_meta["about"]["license"]
    (folder / "metadata.json").write_text(json.dumps(bad_meta))

    result = spec.validate_folder(folder, spec="snapshot-spec")
    assert not result.ok
    assert not result.document.ok
    assert not result.layout.ok
    assert "wbm_init/" in result.layout.missing_required
    assert any("license" in e for e in result.document.errors)


def test_validate_folder_missing_metadata_json(tmp_path):
    folder = _make_snapshot_folder(tmp_path)
    (folder / "metadata.json").unlink()
    result = spec.validate_folder(folder, spec="snapshot-spec")
    assert not result.ok
    assert not result.document.ok
    assert any("not found" in e for e in result.document.errors)
    # metadata.json is itself in layout's required list, so both halves catch
    # this — consistent, not a conflict: each reports the same absence through
    # its own lens (the document check by path, the layout check by name).
    assert not result.layout.ok
    assert "metadata.json" in result.layout.missing_required


def test_validate_folder_invalid_json(tmp_path):
    folder = _make_snapshot_folder(tmp_path)
    (folder / "metadata.json").write_text("{not valid json")
    result = spec.validate_folder(folder, spec="snapshot-spec")
    assert not result.ok
    assert any("not valid JSON" in e for e in result.document.errors)


def test_model_input_folder_validates(tmp_path):
    folder = _make_model_input_folder(tmp_path)
    result = spec.validate_folder(folder, spec="model-input-spec")
    assert result.ok, (result.document.errors, result.layout.missing_required if result.layout else None)


# ---- "unknown" — runtime.execution's observation fields only -----------------


@pytest.mark.parametrize(
    "field", ["cores", "elapsedWalltime", "startedAt", "finishedAt", "slurmJobId"]
)
def test_unknown_validates_in_each_execution_observation_field(field):
    doc = copy.deepcopy(SNAPSHOT_EXAMPLE)
    doc["runtime"]["execution"][field] = "unknown"
    result = spec.validate_document(doc, spec="snapshot-spec")
    assert result.ok, result.errors


def test_unknown_rejected_in_execution_cluster():
    bad = copy.deepcopy(SNAPSHOT_EXAMPLE)
    bad["runtime"]["execution"]["cluster"] = "unknown"
    result = spec.validate_document(bad, spec="snapshot-spec")
    assert not result.ok
    assert any("cluster" in e for e in result.errors)


def test_unknown_rejected_in_simulation_temporal_coverage_start():
    bad = copy.deepcopy(SNAPSHOT_EXAMPLE)
    bad["simulation"]["temporalCoverage"]["start"] = "unknown"
    result = spec.validate_document(bad, spec="snapshot-spec")
    assert not result.ok
    assert any("start" in e for e in result.errors)


def test_unknown_rejected_in_uses_container_digest():
    bad = copy.deepcopy(SNAPSHOT_EXAMPLE)
    bad["uses"]["container"]["digest"] = "unknown"
    result = spec.validate_document(bad, spec="snapshot-spec")
    assert not result.ok
    assert any("digest" in e for e in result.errors)


@pytest.mark.parametrize(
    "path",
    [("runtime", "generatedAt"), ("about", "datePublished"), ("uses", "container", "https")],
)
def test_unknown_rejected_in_formatted_fields(path):
    # "date-time" and "uri" are only checked when rfc3339-validator and
    # rfc3986-validator are installed; this fails if they are not.
    bad = copy.deepcopy(SNAPSHOT_EXAMPLE)
    node = bad
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = "unknown"
    result = spec.validate_document(bad, spec="snapshot-spec")
    assert not result.ok
    assert any(path[-1] in e for e in result.errors)
