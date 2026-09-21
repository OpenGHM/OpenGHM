"""The catalogue's dataset shape.

``OpenGHMSnapshotMetadata`` (``app/models/generated/snapshot.py``) is
generated from ``schemas/snapshot-spec/metadata/1.0.0.json`` and is the
document as stored: a `datasets` Mongo document is that shape, verbatim,
plus the `_id` Mongo itself requires (mirroring the spec's own ``id``).

``DatasetResponse`` is what the API actually returns: every field of the
spec document, plus the handful of values the catalogue UI needs that are
genuinely computable from it and are never stored — see
``docs/reference/metadata-format.md#the-gateways-catalogue`` for why each one
is here and not in the spec.
"""

from __future__ import annotations

from pydantic import AwareDatetime, BaseModel, ConfigDict

from .generated.model_input import OpenGHMModelInputMetadata
from .generated.snapshot import OpenGHMSnapshotMetadata, Resolution

#: WBM's own grid-resolution vocabulary (metadata-format.md#resolution),
#: not a general unit-conversion library — there are exactly three values,
#: fixed by the schema's own enum.
_DEGREES_PER_UNIT = {"arc-minute": 1 / 60, "arc-second": 1 / 3600, "degree": 1.0}


def resolution_to_degrees(resolution: Resolution) -> float:
    """``simulation.resolution`` as a single comparable number, for the
    resolution range filter. Computed, never stored."""
    return resolution.value * _DEGREES_PER_UNIT[resolution.unit.value]


def license_url(spdx_id: str) -> str:
    """A display link for ``about.license``'s bare SPDX identifier.

    A real mapping (SPDX ids to their canonical page) would need the SPDX
    license-list data as a dependency for one derived link; this covers the
    two licenses every snapshot and the toolkit itself actually use today
    (GPL-3.0-only, MIT) and falls back to SPDX's own site search rather than
    guessing a URL for an id it doesn't recognise.
    """
    known = {
        "MIT": "https://spdx.org/licenses/MIT.html",
        "GPL-3.0-only": "https://spdx.org/licenses/GPL-3.0-only.html",
        "GPL-3.0-or-later": "https://spdx.org/licenses/GPL-3.0-or-later.html",
    }
    return known.get(spdx_id, f"https://spdx.org/licenses/{spdx_id}")


class DatasetResponse(OpenGHMSnapshotMetadata):
    """A snapshot as the catalogue returns it."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    #: ``simulation.resolution`` converted to a single number of degrees.
    spatialResolutionDegrees: float
    #: derived from ``about.license`` — see :func:`license_url`.
    licenseUrl: str
    #: ``runtime.generatedAt``, exposed under the spec's own name at the top
    #: level too — this is the catalogue's default sort key.
    generatedAt: AwareDatetime

    @classmethod
    def from_metadata_json(cls, doc: dict) -> "DatasetResponse":
        """Build from a ``datasets`` Mongo document (or any dict matching
        ``metadata.json``'s shape) — a Mongo ``_id``, if present, is dropped
        first; the spec's own ``id`` field is what the response carries."""
        doc = {k: v for k, v in doc.items() if k != "_id"}
        meta = OpenGHMSnapshotMetadata.model_validate(doc)
        payload = meta.model_dump(by_alias=True, mode="json")
        payload["spatialResolutionDegrees"] = resolution_to_degrees(meta.simulation.resolution)
        payload["licenseUrl"] = license_url(meta.about.license)
        payload["generatedAt"] = meta.runtime.generatedAt
        return cls.model_validate(payload)


class RepositoryListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[DatasetResponse]
    totalCount: int
    totalPages: int
    page: int


class ModelInputResponse(OpenGHMModelInputMetadata):
    """A model input as the catalogue returns it (ADR 0015).

    Mirrors ``DatasetResponse``: every field of the spec document, plus the
    one value the catalogue UI needs that is genuinely computable from it —
    ``licenseUrl``, from the same ``about.license`` shared block a snapshot
    carries (ADR 0018). There is no ``spatialResolutionDegrees`` analogue:
    a model input's resolution, when it has one at all, lives per-entry
    under ``networks[]``, not as one top-level value to compare across the
    catalogue the way a snapshot's ``simulation.resolution`` is.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    #: derived from ``about.license`` — see :func:`license_url`.
    licenseUrl: str

    @classmethod
    def from_metadata_json(cls, doc: dict) -> "ModelInputResponse":
        """Build from a ``model_inputs`` Mongo document (or any dict matching
        ``metadata.json``'s shape) — a Mongo ``_id``, if present, is dropped
        first; the spec's own ``id`` field is what the response carries."""
        doc = {k: v for k, v in doc.items() if k != "_id"}
        meta = OpenGHMModelInputMetadata.model_validate(doc)
        payload = meta.model_dump(by_alias=True, mode="json")
        payload["licenseUrl"] = license_url(meta.about.license)
        return cls.model_validate(payload)


class ModelInputListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ModelInputResponse]
    totalCount: int
    totalPages: int
    page: int
