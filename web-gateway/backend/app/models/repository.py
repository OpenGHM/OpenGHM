"""The catalogue's dataset shape.

``OpenGHMSnapshotMetadata`` (``app/models/generated/snapshot.py``) is
generated from ``schemas/snapshot-spec/metadata/1.0.0.json`` and is the
document as stored — but not the whole Mongo document. Since mission
2026-09-23-catalogue-envelope, a `datasets`/`model_inputs` Mongo document is
an **envelope**:

    { _id, document: {…the spec document, verbatim, no _id inside it…},
      owner_user_id, visibility, registered_at }

``document`` is the spec's own shape, unmodified; ``_id`` mirrors
``document["id"]`` (Mongo's own requirement); ``owner_user_id``,
``visibility`` and ``registered_at`` are the gateway's record of how the
artifact came to be in *this* catalogue, not properties of the artifact
itself — see ``spec.md`` in that mission for why they can't live inside
``document`` (both specs set ``additionalProperties: false`` at the root).
``build_envelope()`` is the one place that assembles this shape; both write
paths (``app/api/v1/repository.py``) and the round-trip tests
(``tests/test_repository.py``, ``tests/test_model_inputs.py``) call it rather
than each re-building it by hand.

``DatasetResponse`` is what the API actually returns: every field of the
spec document, plus the handful of values the catalogue UI needs that are
genuinely computable from it and are never stored — see
``docs/reference/metadata-format.md#the-gateways-catalogue`` for why each one
is here and not in the spec. The envelope's own fields
(``owner_user_id``/``visibility``/``registered_at``) are not in this response
either — nothing reads them yet (spec.md, out of scope: no behaviour change).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import AwareDatetime, BaseModel, ConfigDict

from .generated.model_input import OpenGHMModelInputMetadata
from .generated.snapshot import OpenGHMSnapshotMetadata, Resolution


def build_envelope(
    document: dict[str, Any],
    *,
    owner_user_id: str | None = None,
    visibility: str = "public",
    registered_at: datetime | None = None,
) -> dict[str, Any]:
    """Wrap a spec document (already ``model_dump(by_alias=True,
    mode="json", exclude_none=True)``'d) as a catalogue Mongo record.

    ``_id`` mirrors ``document["id"]``, same as the pre-envelope shape did —
    Mongo's unique index on ``_id`` is still what turns a repeat registration
    into a ``409`` (rule 1). ``registered_at`` defaults to now, in UTC; it is
    deliberately not the same value as ``document``'s own
    ``runtime.generatedAt``/``about.datePublished`` — one is when the science
    happened, this is when this gateway learned about it
    (spec.md, open question 3).
    """
    return {
        "_id": document["id"],
        "document": document,
        "owner_user_id": owner_user_id,
        "visibility": visibility,
        "registered_at": (registered_at or datetime.now(timezone.utc)),
    }

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
    def from_metadata_json(cls, envelope: dict) -> "DatasetResponse":
        """Build from a ``datasets`` Mongo envelope
        (``{_id, document, owner_user_id, visibility, registered_at}`` —
        see the module docstring). Only ``envelope["document"]`` — the spec's
        own shape — feeds the response; the envelope's own fields are not
        exposed here (spec.md, out of scope: no behaviour change yet)."""
        doc = envelope["document"]
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
    def from_metadata_json(cls, envelope: dict) -> "ModelInputResponse":
        """Build from a ``model_inputs`` Mongo envelope
        (``{_id, document, owner_user_id, visibility, registered_at}`` —
        see the module docstring). Only ``envelope["document"]`` — the spec's
        own shape — feeds the response; the envelope's own fields are not
        exposed here (spec.md, out of scope: no behaviour change yet)."""
        doc = envelope["document"]
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
