# GENERATED -- do not edit by hand. Run 'just codegen' to regenerate.
# Source: schemas/model-input-spec/metadata/1.0.0.json

from __future__ import annotations

from datetime import date
from enum import Enum

from pydantic import (
    AnyUrl,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    PositiveFloat,
    RootModel,
    confloat,
    constr,
)


class TemporalCoverage(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    start: date
    end: date


class Unit(Enum):
    arc_minute = 'arc-minute'
    arc_second = 'arc-second'
    degree = 'degree'


class Resolution(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    value: PositiveFloat
    unit: Unit


class TemporalCoverage1(BaseModel):
    """
    Omitted for a climatological record: the staged data marks 'no real date' with a 0000 placeholder year, which is not a valid date and is not carried here rather than being transcribed.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    start: date
    end: date


class Dataset(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    code: constr(min_length=1) = Field(
        ...,
        description="The record's own Code_Name field. Not assumed from its filename — several records in the staged ancillary data declare a Code_Name that differs from their file's basename.",
    )
    init: constr(pattern=r'^[^/].*\.init$') = Field(
        ...,
        description="Path relative to this input's root, e.g. data_init/climate/merra2_prectotcorr_d.init. Resolves to <model-input>/data_init/<...>.",
    )
    name: constr(min_length=1) | None = Field(
        None,
        description="The record's Name field. Optional: present on ordinary MT records, but not guaranteed on every shape this array may need to describe in future.",
    )
    unit: constr(min_length=1) | None = Field(
        None,
        description="The record's Units field, same rule as a snapshot's inputVariables[].unit — not Orig_Units. Optional and, deliberately, never an empty string: several staged records (crop coefficients, added-water fractions) declare Units as the empty string because the quantity is dimensionless, and an absent field says that more plainly than a quoted nothing.",
    )
    timeSeries: constr(min_length=1) | None = Field(
        None,
        description="The record's Time_Series field, e.g. daily, monthly, yearly, daily_clim, yearly_clim — a _clim suffix marks a climatology (a repeating annual cycle, not a dated series). Free text, not an enum: the staged data already uses more values than the snapshot spec's forcing-role table anticipated, and this array describes ancillary data in general, not only forcing.",
    )
    temporalCoverage: TemporalCoverage1 | None = Field(
        None,
        description="Omitted for a climatological record: the staged data marks 'no real date' with a 0000 placeholder year, which is not a valid date and is not carried here rather than being transcribed.",
    )
    project: constr(min_length=1) | None = Field(
        None,
        description="The record's Project field. Present on the climate forcing records (e.g. MERRA2); most other ancillary records in the staged data do not carry one.",
    )
    metadataLink: AnyUrl | None = Field(
        None, description="The record's MetadataLink field, when it has one."
    )
    citation: constr(min_length=1) | None = Field(
        None,
        description="The record's citation field, kept as the free string it already is rather than parsed into a structured reference — some carry a DOI inline as text, most carry none at all.",
    )


class Tag(Enum):
    publication = 'publication'
    tutorial = 'tutorial'
    test = 'test'
    ancillary_data = 'ancillary-data'
    climate_forcing = 'climate-forcing'
    river_network = 'river-network'


class CreatorItem(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    name: constr(min_length=1)
    email: EmailStr | None = None
    orcid: constr(pattern=r'^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$') | None = None


class Keyword(RootModel[constr(min_length=1)]):
    root: constr(min_length=1)


class RelatedLinkItem(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    relation: constr(min_length=1)
    roleName: str | None = None
    url: AnyUrl
    doi: constr(pattern=r'^10\.\d{4,9}/\S+$') | None = None
    description: str | None = None


class OpenGHMCitationBlock(BaseModel):
    """
    The 'who published this, and how to cite it' block, shared by every OpenGHM artifact spec (snapshot, model input) rather than defined once per spec (ADR 0018). Field names are schema.org/Dataset property names on purpose, so a JSON-LD island can be generated for Google Dataset Search at render time (see metadata-format.md#notes) — that projection is generated, never stored.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    name: constr(min_length=1)
    description: constr(min_length=1)
    datePublished: date
    tags: list[Tag] = Field(
        ...,
        description="What this artifact is for or contains, picked from a closed list so the catalogue's Tags filter stays usable. One or more. Adding a value to the list is an additive MINOR change — see metadata-format.md#abouttags.",
        min_length=1,
    )
    creator: list[CreatorItem] = Field(..., min_length=1)
    license: str = Field(
        ..., description='A bare SPDX identifier, e.g. GPL-3.0-only. Not a URL.'
    )
    keywords: list[Keyword] = Field(..., min_length=1)
    url: AnyUrl = Field(
        ...,
        description="The canonical gateway URL, built from the artifact's minted id — never from its slug, which can be renamed later (see metadata-format.md).",
    )
    relatedLink: list[RelatedLinkItem] | None = None


class Units(Enum):
    """
    The unit the four limits are expressed in. One value today, because WBM refuses to run a network that is not geographic — same reasoning as runtime.execution.cluster. A second unit is an additive MINOR bump.
    """

    Decimal_degrees = 'Decimal degrees'


class Projection(Enum):
    """
    The coordinate reference system of the grid this coverage describes. One value, because WBM dies on any other — see metadata-format.md#spatialcoverage. A source projection may be an EPSG code, a Proj4 string or WKT, so the generator recognises the CRS and emits this form, rather than transcribing the source's spelling. A second value is an additive MINOR bump, and would come with a native-CRS block rather than alone.
    """

    EPSG_4326 = 'EPSG:4326'


class OpenGHMSpatialCoverage(BaseModel):
    """
    A bounding box in DCMI Box element names, shared by every OpenGHM artifact spec (ADR 0018) — see metadata-format.md#spatialcoverage for why. The DCMI `box`, `name`, `uplimit`, `downlimit` and `zunits` elements are deliberately absent: `box` restates the four limits, and the rest describe a vertical extent WBM does not model.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    northlimit: confloat(ge=-90.0, le=90.0)
    southlimit: confloat(ge=-90.0, le=90.0)
    eastlimit: confloat(ge=-180.0, le=180.0)
    westlimit: confloat(ge=-180.0, le=180.0)
    units: Units = Field(
        ...,
        description='The unit the four limits are expressed in. One value today, because WBM refuses to run a network that is not geographic — same reasoning as runtime.execution.cluster. A second unit is an additive MINOR bump.',
    )
    projection: Projection = Field(
        ...,
        description="The coordinate reference system of the grid this coverage describes. One value, because WBM dies on any other — see metadata-format.md#spatialcoverage. A source projection may be an EPSG code, a Proj4 string or WKT, so the generator recognises the CRS and emits this form, rather than transcribing the source's spelling. A second value is an additive MINOR bump, and would come with a native-CRS block rather than alone.",
    )


class Coverage(BaseModel):
    """
    The extent of the input as a whole — the union of what its networks and datasets cover. temporalCoverage is optional because a model input can be a static/climatological reference (soil properties, crop coefficients) with no real calendar period at all; when every dataset the input carries is climatological, there is nothing true to put here.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    spatialCoverage: OpenGHMSpatialCoverage
    temporalCoverage: TemporalCoverage | None = None


class Network(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    file: constr(min_length=1) = Field(
        ...,
        description="Path relative to this input's root, e.g. network/hyd_5m_CONUS_mississippi_patched.asc.",
    )
    spatialCoverage: OpenGHMSpatialCoverage | None = None
    resolution: Resolution | None = None


class OpenGHMModelInputMetadata(BaseModel):
    """
    metadata.json for one published model input (ADR 0015) — the ancillary/reference data a WBM run reads besides its climate forcing and network. Grouped the same way the snapshot spec is: about (a person, at publish), coverage and datasets (derived from the input's own data_init/ records), networks (the river-network files it carries). See docs/reference/metadata-format.md.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    field_schema: AnyUrl = Field(
        ...,
        alias='$schema',
        description="This document's own schema version URL, e.g. https://schemas.openghm.org/model-input-spec/metadata/1.0.0.json.",
    )
    id: constr(pattern=r'^[0-9a-f]{64}$') = Field(
        ...,
        description="Minted at publish, same rule as a snapshot's id (ADR 0014): 256 random bits as lowercase hex, not derived from content. Two snapshots built from the same input data cite this same value in their uses.modelInput.id.",
    )
    slug: constr(pattern=r'^[a-z0-9][a-z0-9_.-]*$') = Field(
        ...,
        description="The human name at publish time. Not part of the S3 key; a catalog maps slug to id for browsing, same rule as a snapshot's slug.",
    )
    about: OpenGHMCitationBlock
    coverage: Coverage = Field(
        ...,
        description='The extent of the input as a whole — the union of what its networks and datasets cover. temporalCoverage is optional because a model input can be a static/climatological reference (soil properties, crop coefficients) with no real calendar period at all; when every dataset the input carries is climatological, there is nothing true to put here.',
    )
    networks: list[Network] | None = Field(
        None,
        description="River-network / grid-definition files this input carries under network/ — what a snapshot's simulation.spatialCoverage and resolution are actually computed from when its Network key points into a linked model input rather than a bundled copy.",
    )
    datasets: list[Dataset] = Field(
        ...,
        description='One entry per MT record under data_init/ — the reference/ancillary time series and static fields a WBM run reads besides climate forcing (crop calendars, glacier area, irrigation efficiency, soil capacity, ...). `code` is unique within the array; JSON Schema cannot express that, so the generator and the validator enforce it, the same limitation as inputVariables[].role in the snapshot spec. Not every file under data_init/ is an MT record in this shape — one observed in the staged ancillary data (a point-feature reference table with its own DOI and no Code_Name at all) does not fit here and is not modelled by 1.0.0; see open-items.md.',
        min_length=1,
    )
