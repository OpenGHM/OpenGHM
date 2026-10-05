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
either, with one exception: ``GET /repository/mine`` reads ``owner_user_id``
to find what a user published and returns ``visibility`` and ``registered_at``
beside each item (``docs/architecture/gateway.md`` §4).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from .generated.model_input import OpenGHMModelInputMetadata
from .generated.model_input import Resolution as ModelInputResolution
from .generated.snapshot import OpenGHMSnapshotMetadata, Resolution
from .job import JobParameters


#: Who may find an artifact in the catalogue. Separate from freezing: a
#: published snapshot is immutable whichever it is. Nothing sets ``private``
#: yet, and no read route filters on it.
Visibility = Literal["public", "private"]


def build_envelope(
    document: dict[str, Any],
    *,
    owner_user_id: str | None = None,
    visibility: Visibility = "public",
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


def resolution_to_degrees(resolution: Resolution | ModelInputResolution) -> float:
    """``simulation.resolution`` (or a model input's ``networks[].resolution``,
    the same shape with its own generated class) as a single comparable number,
    for the resolution range filter. Computed, never stored."""
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


class DatasetDetailResponse(DatasetResponse):
    """One snapshot, from ``GET /repository/datasets/{id}``: a
    :class:`DatasetResponse` plus what the wizard and the draft editor need
    about running it, which takes a read of the snapshot's init over S3 and so
    is not computed for every row of the list.
    """

    #: Where a run of this snapshot may start (``app.services.run_start``):
    #: ``"year"`` January 1, ``"month"`` the first of a month, ``"none"`` the
    #: init was read and sets no rule, ``null`` the init could not be read, so
    #: nothing is known and nothing is blocked.
    runStartAlignment: Literal["year", "month", "none"] | None = None
    #: The year the init's multi-year aggregation starts in, which the run
    #: must reach (``run_start.check_run_dates``); ``null`` when the init sets
    #: none or could not be read, and then nothing is blocked.
    aggregationStartYear: int | None = None


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


# ---- the mixed catalogue (GET /repository/catalogue) ----------------------
#
# One list for both kinds. An item is the existing response of its kind plus
# a ``kind`` discriminator, so every field the two list routes return is
# unchanged. ``kind`` has a default so the ``from_metadata_json`` inherited
# from the base response builds the right class without being overridden.


class SnapshotCatalogueItem(DatasetResponse):
    kind: Literal["snapshot"] = "snapshot"


class ModelInputCatalogueItem(ModelInputResponse):
    kind: Literal["model-input"] = "model-input"


CatalogueItem = Annotated[
    SnapshotCatalogueItem | ModelInputCatalogueItem, Field(discriminator="kind")
]


# ---- what the caller owns (GET /repository/mine) --------------------------
#
# The catalogue item of each kind plus the two envelope fields a Workspace row
# needs. They are the gateway's record of this registration (see the module
# docstring), so they are camelCase beside the spec's own fields, not inside
# any of them. Both are always present: an envelope with an ``owner_user_id``
# is one ``build_envelope()`` wrote.


class _OwnedFields(BaseModel):
    #: the envelope's ``visibility``.
    visibility: Visibility
    #: the envelope's ``registered_at``: when this gateway learned of the artifact.
    registeredAt: AwareDatetime


def _owned_payload(item: BaseModel, envelope: dict) -> dict:
    return {
        **item.model_dump(by_alias=True, mode="json"),
        "visibility": envelope["visibility"],
        "registeredAt": envelope["registered_at"],
    }


class OwnedSnapshotItem(SnapshotCatalogueItem, _OwnedFields):
    @classmethod
    def from_envelope(cls, envelope: dict) -> "OwnedSnapshotItem":
        return cls.model_validate(_owned_payload(SnapshotCatalogueItem.from_metadata_json(envelope), envelope))


class OwnedModelInputItem(ModelInputCatalogueItem, _OwnedFields):
    @classmethod
    def from_envelope(cls, envelope: dict) -> "OwnedModelInputItem":
        return cls.model_validate(_owned_payload(ModelInputCatalogueItem.from_metadata_json(envelope), envelope))


OwnedItem = Annotated[OwnedSnapshotItem | OwnedModelInputItem, Field(discriminator="kind")]


class MineResponse(BaseModel):
    """``GET /repository/mine``: what the caller published, both kinds in one
    list, each with its ``visibility`` and ``registeredAt``. No paging and no
    facets — a user publishes a handful of things."""

    model_config = ConfigDict(extra="forbid")

    items: list[OwnedItem]


class FacetOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: what the client sends back as the facet's query parameter.
    value: str
    #: what to show; equal to ``value`` unless the facet says otherwise.
    label: str
    count: int


class YearBounds(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: int
    max: int


class CatalogueFacets(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: list[FacetOption]
    tag: list[FacetOption]
    keyword: list[FacetOption]
    creator: list[FacetOption]
    license: list[FacetOption]
    output: list[FacetOption]
    forcing: list[FacetOption]
    process: list[FacetOption]
    wbm: list[FacetOption]
    #: over the whole unfiltered catalogue; ``null`` when it is empty.
    yearBounds: YearBounds | None


class CatalogueResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[CatalogueItem]
    totalCount: int
    totalPages: int
    page: int
    facets: CatalogueFacets


# ---- download links ------------------------------------------------------
#
# Links, not bytes (gateway.md §5): plain strings built from the public base
# URL and the bucket, with no S3 client, no HEAD and no presigning. The key
# layout is `docs/reference/s3-layout.md`; a snapshot or model input is a
# tree of many files, so a "download link" is its prefix plus the two
# top-level files that identify and verify it. Not part of the snapshot spec
# — these are the gateway's own response shapes, hand-written.


def s3_url(base_url: str, bucket: str, key: str) -> str:
    """``{base_url}/{bucket}/{key}``, tolerating a trailing slash on the base."""
    return f"{base_url.rstrip('/')}/{bucket}/{key}"


class SnapshotLinks(BaseModel):
    """Where to fetch a published snapshot, computed from its ``metadata.json``
    and the S3 settings, never stored."""

    model_config = ConfigDict(extra="forbid")

    id: str
    #: ``snapshots/<id>/`` — the whole tree.
    treeUrl: str
    metadataUrl: str
    sha256sumsUrl: str
    #: ``openghm snapshot fetch <id>`` (packages/openghm/README.md).
    fetchCommand: str
    #: ``uses.container.https``, verbatim.
    containerUrl: str
    #: ``uses.modelInput.id`` and its ``model-inputs/<id>/`` prefix.
    modelInputId: str
    modelInputTreeUrl: str


class ModelInputLinks(BaseModel):
    """The same, for a published model input (``model-inputs/<id>/``)."""

    model_config = ConfigDict(extra="forbid")

    id: str
    treeUrl: str
    metadataUrl: str
    sha256sumsUrl: str


def snapshot_links(document: dict[str, Any], *, base_url: str, bucket: str) -> SnapshotLinks:
    """Pure: ``document`` is a snapshot's ``metadata.json`` (an envelope's
    ``document``); read as the stored dict so ``uses.container.https`` comes
    out exactly as published."""
    snapshot_id = document["id"]
    model_input_id = document["uses"]["modelInput"]["id"]
    tree = s3_url(base_url, bucket, f"snapshots/{snapshot_id}/")
    return SnapshotLinks(
        id=snapshot_id,
        treeUrl=tree,
        metadataUrl=f"{tree}metadata.json",
        sha256sumsUrl=f"{tree}SHA256SUMS",
        fetchCommand=f"openghm snapshot fetch {snapshot_id}",
        containerUrl=document["uses"]["container"]["https"],
        modelInputId=model_input_id,
        modelInputTreeUrl=s3_url(base_url, bucket, f"model-inputs/{model_input_id}/"),
    )


def model_input_links(document: dict[str, Any], *, base_url: str, bucket: str) -> ModelInputLinks:
    """Pure: ``document`` is a model input's ``metadata.json``."""
    model_input_id = document["id"]
    tree = s3_url(base_url, bucket, f"model-inputs/{model_input_id}/")
    return ModelInputLinks(
        id=model_input_id,
        treeUrl=tree,
        metadataUrl=f"{tree}metadata.json",
        sha256sumsUrl=f"{tree}SHA256SUMS",
    )


# ---- published answer (mission 2026-10-05-a-published-draft-is-not-run) ----


class PublishedAnswerRequest(BaseModel):
    """What a draft asks of its snapshot, as the editor holds it: an unsaved
    draft has no job id, so the parameters travel in the body."""

    model_config = ConfigDict(extra="forbid", protected_namespaces=())

    parameters: JobParameters
    model_input_id: str | None = None


class PublishedAnswerReason(BaseModel):
    """Why a draft is not answered by the snapshot: a code the page switches
    on and a sentence for the person."""

    code: Literal[
        "model_input_override",
        "spatial_domain",
        "custom_params",
        "period_before_published_start",
        "period_after_published_end",
        "variables_not_published",
        "published_output_missing",
    ]
    message: str


class PublishedFile(BaseModel):
    """One published file that answers the draft. ``variable`` is null for a
    daily file, which holds every published variable."""

    group: Literal["daily", "monthly", "yearly"]
    variable: str | None
    year: int
    key: str
    url: str
    size: int


class PublishedPeriod(BaseModel):
    start: str
    end: str


class PublishedAnswerResponse(BaseModel):
    """``reasons`` is empty when ``answered`` and ``files`` is empty when not.
    ``period`` is the snapshot's published period (the run the files come
    from), not the asked one; ``run_id`` is the run's folder under
    ``wbm_output/`` (null when none was found)."""

    answered: bool
    reasons: list[PublishedAnswerReason]
    period: PublishedPeriod | None
    run_id: str | None
    files: list[PublishedFile]
