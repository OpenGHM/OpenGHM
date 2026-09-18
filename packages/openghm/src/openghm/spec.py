"""Validate a document or a folder against a published OpenGHM spec version.

Two specs exist under ``schemas/`` — ``snapshot-spec`` and ``model-input-spec``
(ADR 0015) — each with a ``metadata/<version>.json`` (checked against
``metadata.json``, JSON Schema) and a ``layout/<version>.json`` (checked against
the folder itself, a plain path list). ADR 0006 is why they are two files and
two kinds of check; this module is what actually runs both.

``schemas/`` is bundled into this package as a symlinked directory
(``src/openghm/schemas`` -> the repository's top-level ``schemas/``), so
validation here needs no network and no repository checkout — the wheel
carries its own copy. A schema's ``$ref`` to a shared definition under
``schemas/common/`` is resolved from that same bundled tree, keyed by each
schema's own ``$id`` (ADR 0018); nothing is ever fetched over HTTPS.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import jsonschema
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from .errors import OpenghmError

#: The two published specs, by the directory name under schemas/.
SPECS = ("snapshot-spec", "model-input-spec")


def schemas_root() -> Path:
    """The ``schemas/`` tree this install validates against."""
    return Path(__file__).parent / "schemas"


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text())


def _spec_dir(spec: str) -> Path:
    if spec not in SPECS:
        raise OpenghmError(f"unknown spec {spec!r} (expected one of {', '.join(SPECS)})")
    d = schemas_root() / spec
    if not d.is_dir():
        raise OpenghmError(f"spec {spec!r} not found under {schemas_root()} — a broken install")
    return d


def current_version(spec: str) -> str:
    """The version ``index.json`` names current, for callers that don't pin one."""
    index = _read_json(_spec_dir(spec) / "index.json")
    return index["current"]


def _registry() -> Registry:
    """Every schema under ``schemas/`` (both specs, plus ``common/``), keyed by
    its own ``$id``. Built fresh per call — these are small files read from
    disk, not worth caching against a process that runs once and exits."""
    resources = []
    for f in schemas_root().rglob("*.json"):
        if f.name == "index.json":
            continue
        doc = _read_json(f)
        if "$id" not in doc:
            continue
        resources.append(Resource.from_contents(doc, default_specification=DRAFT202012))
    return Registry().with_resources((r.contents["$id"], r) for r in resources)


@dataclass
class DocumentResult:
    """The outcome of checking one document against ``metadata/<version>.json``."""

    ok: bool
    #: One line per failure: "<dotted.path.to.field>: <message>", sorted by path.
    #: The path is "$" for an error with no field to point at (e.g. the
    #: document is not an object at all).
    errors: list = field(default_factory=list)


@dataclass
class LayoutResult:
    """The outcome of checking one folder against ``layout/<version>.json``."""

    ok: bool
    missing_required: list = field(default_factory=list)


@dataclass
class ValidationResult:
    """Both halves of one spec version's check, kept separate on purpose
    (ADR 0006): a folder can have a perfectly valid ``metadata.json`` and a
    missing required directory, and collapsing that into one pass/fail message
    would lose which half actually failed."""

    spec: str
    version: str
    document: DocumentResult
    #: None when only the document was checked (no folder given).
    layout: Optional[LayoutResult]

    @property
    def ok(self) -> bool:
        return self.document.ok and (self.layout is None or self.layout.ok)


def _duplicate_key_errors(data: dict, *, path: list, key: str) -> list:
    """JSON Schema cannot say "unique by this field" for an array of objects —
    only ``uniqueItems`` (whole-item equality). ``role`` in a snapshot's
    ``inputVariables`` and ``code`` in a model input's ``datasets`` are each
    documented in their own schema as enforced by "the generator and the
    validator" rather than the schema itself; this is that enforcement."""
    node = data
    for p in path:
        if not isinstance(node, dict) or p not in node:
            return []
        node = node[p]
    if not isinstance(node, list):
        return []
    seen: dict = {}
    errors = []
    dotted = ".".join(path)
    for i, item in enumerate(node):
        if not isinstance(item, dict) or key not in item:
            continue
        value = item[key]
        if value in seen:
            errors.append(f"{dotted}[{i}].{key}: duplicate {key} {value!r} (first seen at [{seen[value]}])")
        else:
            seen[value] = i
    return errors


#: Per-spec uniqueness rules the schema documents but cannot itself enforce.
_UNIQUENESS_RULES = {
    "snapshot-spec": [(["simulation", "inputVariables"], "role")],
    "model-input-spec": [(["datasets"], "code")],
}


def validate_document(data: dict, *, spec: str, version: Optional[str] = None) -> DocumentResult:
    """Check ``data`` against ``schemas/<spec>/metadata/<version>.json``.

    Resolves every ``$ref`` — including into ``schemas/common/`` — from the
    bundled tree; no network access is attempted. Also enforces the
    uniqueness rules each schema documents but cannot express itself (see
    ``_duplicate_key_errors``).
    """
    version = version or current_version(spec)
    schema_path = _spec_dir(spec) / "metadata" / f"{version}.json"
    if not schema_path.is_file():
        raise OpenghmError(f"unknown {spec} version {version!r} (no {schema_path.name} under metadata/)")
    schema = _read_json(schema_path)
    # format_checker is not on by default in jsonschema — without it, "format":
    # "date" accepts a syntactically-string-shaped non-date like "1980-01-00"
    # silently. Found the hard way: two records in the model-input example
    # carried exactly that (a day-00 placeholder distinct from the year-0000
    # one already excluded), and nothing here caught it until a second,
    # stricter generator (Pydantic) choked on it.
    validator = jsonschema.Draft202012Validator(
        schema, registry=_registry(), format_checker=jsonschema.Draft202012Validator.FORMAT_CHECKER
    )
    found = sorted(validator.iter_errors(data), key=lambda e: [str(p) for p in e.absolute_path])
    errors = [
        f"{'.'.join(str(p) for p in e.absolute_path) or '$'}: {e.message}" for e in found
    ]
    if not errors:
        # Only meaningful once the document already matches the schema shape —
        # a schema failure on the same array would make these errors noise.
        for path, key in _UNIQUENESS_RULES.get(spec, []):
            errors.extend(_duplicate_key_errors(data, path=path, key=key))
    return DocumentResult(ok=not errors, errors=errors)


def validate_layout(folder: Path, *, spec: str, version: Optional[str] = None) -> LayoutResult:
    """Check that ``folder`` has every path ``schemas/<spec>/layout/<version>.json``
    marks required. Optional paths are not checked — their absence is never a
    failure."""
    version = version or current_version(spec)
    layout_path = _spec_dir(spec) / "layout" / f"{version}.json"
    if not layout_path.is_file():
        raise OpenghmError(f"unknown {spec} version {version!r} (no {layout_path.name} under layout/)")
    layout = _read_json(layout_path)
    missing = [p for p in layout["required"] if not (folder / p).exists()]
    return LayoutResult(ok=not missing, missing_required=missing)


def validate_folder(folder: Path, *, spec: str, version: Optional[str] = None) -> ValidationResult:
    """The full check a publish or a CI gate actually wants: ``metadata.json``
    against the schema, and the folder against the layout, reported separately.

    A missing ``metadata.json`` is a document failure (there is nothing to
    validate), not an exception — the same way an invalid one is.
    """
    version = version or current_version(spec)
    meta_path = folder / "metadata.json"
    if not meta_path.is_file():
        document = DocumentResult(ok=False, errors=[f"$: {meta_path} not found"])
    else:
        try:
            data = _read_json(meta_path)
        except json.JSONDecodeError as e:
            document = DocumentResult(ok=False, errors=[f"$: {meta_path} is not valid JSON ({e})"])
        else:
            document = validate_document(data, spec=spec, version=version)
    layout = validate_layout(folder, spec=spec, version=version)
    return ValidationResult(spec=spec, version=version, document=document, layout=layout)
