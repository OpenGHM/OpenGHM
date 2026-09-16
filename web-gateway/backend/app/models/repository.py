from __future__ import annotations

from enum import Enum
from typing import Annotated, Union

from pydantic import BaseModel, Field


class DatasetType(str, Enum):
    snapshot = "snapshot"
    raw_data = "raw_data"


class CreatorModel(BaseModel):
    name: str
    email: str | None = None


class RelatedLinkModel(BaseModel):
    type: str | None = None
    roleName: str
    url: str
    doi: str | None = None
    description: str


class SpatialCoverageModel(BaseModel):
    box: str
    northlimit: float
    southlimit: float
    eastlimit: float
    westlimit: float
    units: str
    projection: str
    riverNetworkSource: str | None = None
    majorRivers: list[str] | None = None


class VariableMeasuredModel(BaseModel):
    name: str
    unitText: str
    standardName: str | None = None


class AdminMetadataModel(BaseModel):
    generatedAt: str
    lastUpdated: str
    metadataStandard: str
    metadataVersion: str
    conformsTo: list[str] = []
    applicationContext: str


class BaseDatasetResponse(BaseModel):
    id: str
    slug: str | None = None
    datasetType: DatasetType
    title: str
    description: str
    creators: list[CreatorModel] = []
    license: str
    licenseUrl: str | None = None
    keywords: list[str] = []
    tag: str
    relatedLinks: list[RelatedLinkModel] = []
    yearPublished: int | None = None
    spatialResolution: str
    spatialResolutionDegrees: float | None = None
    spatialCoverage: SpatialCoverageModel | None = None
    temporalCoverage: str
    temporalResolution: str | None = None
    datasetVersion: str | None = None
    format: str = "NetCDF"
    fileSize: str = "N/A"
    lastUpdated: str
    adminMetadata: AdminMetadataModel | None = None


class SnapshotDatasetResponse(BaseDatasetResponse):
    datasetType: DatasetType = DatasetType.snapshot
    softwareVersion: str
    isBasedOn: str | None = None
    spinupPeriod: str | None = None
    processesOn: list[str] = []
    activeProcesses: list[str] = []
    variablesMeasured: list[VariableMeasuredModel] = []
    recommendedComputeSetting: list[str] | None = None


class RawDatasetResponse(BaseDatasetResponse):
    datasetType: DatasetType = DatasetType.raw_data


# Discriminated union for FastAPI response
DatasetResponse = Annotated[
    Union[SnapshotDatasetResponse, RawDatasetResponse],
    Field(discriminator="datasetType"),
]


class RepositoryListResponse(BaseModel):
    items: list[SnapshotDatasetResponse | RawDatasetResponse]
    totalCount: int
    totalPages: int
    page: int
