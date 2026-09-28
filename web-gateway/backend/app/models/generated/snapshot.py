# GENERATED -- do not edit by hand. Run 'just codegen' to regenerate.
# Source: schemas/snapshot-spec/metadata/1.0.0.json

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import (
    AnyUrl,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    PositiveFloat,
    RootModel,
    confloat,
    conint,
    constr,
)


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
    category: constr(min_length=1) = Field(
        ...,
        description='Open vocabulary, not an enum. A new value never needs a spec bump — see metadata-format.md#aboutcategory.',
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


class TemporalCoverage(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    start: date
    end: date


class Role(Enum):
    precipitation = 'precipitation'
    precipitationFraction = 'precipitationFraction'
    airTemperature = 'airTemperature'
    windU = 'windU'
    windV = 'windV'
    cloudFraction = 'cloudFraction'
    humidity = 'humidity'
    albedo = 'albedo'
    leafAreaIndex = 'leafAreaIndex'


class InputVariable(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    role: Role
    dataset: constr(min_length=1) = Field(
        ...,
        description="The MT record driving this role, named by its own Code_Name field — read from inside the .init the run's MT_* key points at, not assumed from that file's basename. The two agree for the climate forcing used today (merra2_prectotcorr_d.init declares Code_Name merra2_prectotcorr_d) but not in general: several records in the staged ancillary data declare a Code_Name that differs from their filename (see model-input-spec's datasets[].code).",
    )
    fullName: constr(min_length=1) | None = Field(
        None,
        description="The MT record's Name, e.g. 'MERRA2 Temperature at 2m, Daily'. Optional because it is copied out of a file that leaves the bundle under ADR 0015 — recording it here is what keeps this document readable without that file.",
    )
    unit: constr(min_length=1) | None = Field(
        None,
        description="The MT record's Units — what WBM reads the series as, after Var_Scale and Var_Offset. NOT Orig_Units, which is the unit of the file on disk before scaling (e.g. K, not C; kg/(m^2 s), not mm/day). Optional for the same reason as fullName.",
    )


class ActiveProcess(RootModel[constr(min_length=1)]):
    root: constr(min_length=1)


class OutputVariable(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    name: constr(min_length=1)
    fullName: constr(min_length=1) = Field(
        ..., description="The dictionary's Full_name."
    )
    unit: constr(min_length=1) = Field(
        ...,
        description="The dictionary's Org_units[0] — the native unit, not an aggregated one.",
    )


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


class Container(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    image: constr(min_length=1)
    version: constr(min_length=1)
    digest: constr(pattern=r'^sha256:[0-9a-f]{64}$')
    oras: constr(pattern=r'^oras://')
    https: AnyUrl


class ModelInput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: constr(pattern=r'^[0-9a-f]{64}$') = Field(
        ...,
        description='Minted at publish, same rule as the snapshot id (ADR 0014). Two snapshots built from the same input data share this value.',
    )
    mountAs: constr(min_length=1) = Field(
        ...,
        description='Selector, not a path: the data/ child this model input is materialised as. Resolves to <snapshot>/data/<mountAs>, mounted at /wbm/data.',
    )


class Uses(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    container: Container
    modelInput: ModelInput


class Cluster(Enum):
    """
    Every compute-node fact in this project assumes one cluster today. A second cluster is an additive MINOR bump.
    """

    anvil = 'anvil'


class SlurmTime(RootModel[constr(pattern=r'^([0-9]+-)?[0-9]{1,3}(:[0-9]{2}){0,2}$')]):
    root: constr(pattern=r'^([0-9]+-)?[0-9]{1,3}(:[0-9]{2}){0,2}$') = Field(
        ...,
        description='SLURM --time syntax, not an ISO 8601 duration: minutes, minutes:seconds, hours:minutes:seconds, days-hours[:minutes[:seconds]]. Hours are not capped at 24 (observed: 111:30:00).',
    )


class Unknown(RootModel[Literal['unknown']]):
    root: Literal['unknown'] = Field(
        ...,
        description="Recorded when a past run's own record (SLURM accounting, logs) could not be recovered at rewrite time. Allowed only in runtime.execution's observation fields (cores, elapsedWalltime, startedAt, finishedAt, slurmJobId), never in cluster or anywhere else.",
    )


class RecommendedCompute(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    cores: conint(ge=1)
    walltime: SlurmTime


class Simulation(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    init: constr(pattern=r'^[^/].*\.init$') = Field(
        ...,
        description='Path relative to wbm_init/, not a bare filename assumption — a snapshot can hold several .init files. Resolves to <snapshot>/wbm_init/<init>.',
    )
    spatialCoverage: OpenGHMSpatialCoverage
    resolution: Resolution
    temporalCoverage: TemporalCoverage
    inputVariables: list[InputVariable] = Field(
        ...,
        description='What the run is driven by: one entry per forcing time series the .init actually names — see metadata-format.md#forcing-roles. Variable length, not a fixed pair, but `role` is a closed vocabulary and a new role is an additive MINOR bump. `role` is unique within the array; JSON Schema cannot express that, so the generator and the validator enforce it.',
        min_length=1,
    )
    activeProcesses: list[ActiveProcess]
    outputVariables: list[OutputVariable] = Field(
        ...,
        description="What the run computes: one entry per name in the .init's Output_vars, resolved through the model's variable dictionary — see metadata-format.md.",
        min_length=1,
    )
    recommendedCompute: RecommendedCompute


class Execution(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    cluster: Cluster = Field(
        ...,
        description='Every compute-node fact in this project assumes one cluster today. A second cluster is an additive MINOR bump.',
    )
    cores: conint(ge=1) | Unknown
    elapsedWalltime: SlurmTime | Unknown
    startedAt: AwareDatetime | Unknown
    finishedAt: AwareDatetime | Unknown
    slurmJobId: constr(pattern=r'^[0-9]+$') | Unknown


class Runtime(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    generatedAt: AwareDatetime
    execution: Execution


class OpenGHMSnapshotMetadata(BaseModel):
    """
    metadata.json for one WBM snapshot. Fields are grouped by where their contents come from: about (a person, at publish), simulation (derived from the selected .init), uses (the publisher, at publish), runtime (the system). See docs/reference/metadata-format.md.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    field_schema: AnyUrl = Field(
        ...,
        alias='$schema',
        description="This document's own schema version URL, e.g. https://schemas.openghm.org/snapshot-spec/metadata/1.0.0.json.",
    )
    id: constr(pattern=r'^[0-9a-f]{64}$') = Field(
        ...,
        description="Minted at publish, 256 random bits as lowercase hex. Not derived from the snapshot's content (ADR 0014). The S3 key under snapshots/.",
    )
    slug: constr(pattern=r'^[a-z0-9][a-z0-9_.-]*$') = Field(
        ...,
        description='The human name at publish time. Not part of the S3 key; the catalog maps slug to id for browsing, and may remap it later without touching this file.',
    )
    about: OpenGHMCitationBlock
    simulation: Simulation
    uses: Uses
    runtime: Runtime
