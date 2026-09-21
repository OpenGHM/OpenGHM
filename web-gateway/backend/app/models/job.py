"""Pydantic models for HPC job submission, status tracking, and API contracts.

A *simulation* (mission 2026-09-20-simulations) is this same document, one
shape with a status rather than a second collection: a "DRAFT" status
precedes the existing SLURM lifecycle, and the routes in
`app/api/v1/jobs.py` — not a separate model — enforce which fields may
change once a draft has moved past it (spec.md's "Two entities, not
three").
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.generated.snapshot import OpenGHMCitationBlock
from app.models.partial import _partial_model

JobStatus = Literal[
    "DRAFT",
    "PENDING",
    "SUBMITTED",
    "RUNNING",
    "COMPLETING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
]

#: A simulation's `about` block, editable one field at a time while it is a
#: draft — derived from the generated `OpenGHMCitationBlock` (rule 4) rather
#: than hand-restated, the way the abandoned snapshot-drafts mission's
#: `PartialSnapshotMetadata` was for the whole document. Only `about` needs
#: this here: `JobParameters` below is already the gateway's own model, not
#: a spec block, so it has no generated counterpart to derive from.
PartialAbout = _partial_model(OpenGHMCitationBlock)

TERMINAL_STATUSES: set[str] = {"COMPLETED", "FAILED", "CANCELLED"}
CANCELLABLE_STATUSES: set[str] = {"PENDING", "SUBMITTED", "RUNNING", "COMPLETING"}


# --- Nested value objects ---


class SpatialDomain(BaseModel):
    """Optional bounding-box subset for the simulation."""

    north: float
    south: float
    east: float
    west: float


class JobParameters(BaseModel):
    """User-configured simulation parameters."""

    temporal_range_start: str = Field(..., description="ISO date, e.g. 2000-01-01")
    temporal_range_end: str = Field(..., description="ISO date, e.g. 2010-12-31")
    spatial_domain: SpatialDomain | None = None
    variables: list[str] = Field(default_factory=list, description="Output variables")
    custom_params: dict[str, str] | None = None


class SlurmConfig(BaseModel):
    """Slurm resource allocation overrides (all have server-side defaults)."""

    partition: str | None = None
    account: str | None = None
    walltime: str | None = None
    nodes: int | None = None
    ntasks: int | None = None
    memory: str | None = None


# --- MongoDB document ---


class JobDB(BaseModel):
    """Shape of a document stored in the MongoDB jobs collection."""

    id: str = Field(alias="_id")
    # Only a submitted simulation has a real one (`_generate_sim_id`, minted
    # by `submit_job`) — a draft document omits the field entirely rather
    # than defaulting it to `""`, because `db.jobs`'s `sim_id` index is
    # `unique=True, sparse=True`: sparse only excludes a *missing* field, so
    # any shared non-missing value (including `""`) collides across drafts.
    sim_id: str | None = None
    user_id: str
    user_email: str
    dataset_id: str
    dataset_title: str

    # Descriptive half a citable snapshot will eventually need (spec.md's
    # "Two entities, not three") — present from the moment a simulation is
    # created as a draft, editable only while it stays one.
    slug: str | None = None
    about: PartialAbout | None = None

    # Slurm identifiers (slurm_job_id stored as str — slurmly returns string ids)
    slurm_job_id: str | None = None
    slurm_job_name: str = ""

    # State
    status: JobStatus = "PENDING"
    status_reason: str | None = None

    # Parameters & config
    parameters: JobParameters
    slurm_config: SlurmConfig

    # Remote paths managed by slurmly's SubmittedJob — persisted so we can
    # reconstruct a SubmittedJob for tail_*/cleanup operations on later requests.
    internal_job_id: str | None = None
    remote_job_dir: str | None = None
    remote_script_path: str | None = None
    stdout_path: str | None = None
    stderr_path: str | None = None
    slurmly_submitted_at: str | None = None

    # S3 outputs
    output_s3_key: str | None = None

    # Timestamps
    created_at: datetime
    submitted_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime

    model_config = {"populate_by_name": True}


# --- API request / response models ---


class JobCreateRequest(BaseModel):
    """POST /jobs body."""

    dataset_id: str
    parameters: JobParameters
    slurm_config: SlurmConfig | None = None


class SimulationDeriveRequest(BaseModel):
    """POST /jobs/derive/{dataset_id} body — everything else about a new
    simulation is inherited from the snapshot named in the path, so the
    only thing left to say up front is what to call it. Out of scope:
    starting a simulation from scratch (spec.md) — there is no route that
    takes a bare `dataset_id` here."""

    slug: str | None = None


class SimulationUpdateRequest(BaseModel):
    """PATCH /jobs/{job_id} body. Every field is optional and only the ones
    supplied are changed — a "save" button posting the editor's current
    state, not a full replacement. Refused once the simulation has moved
    past `DRAFT` (app/api/v1/jobs.py)."""

    slug: str | None = None
    about: PartialAbout | None = None
    parameters: JobParameters | None = None


class JobSubmitResponse(BaseModel):
    """Returned after POST /jobs."""

    job_id: str
    status: JobStatus


class JobResponse(BaseModel):
    """Single job detail returned to the frontend."""

    id: str
    sim_id: str = ""
    user_id: str
    dataset_id: str
    dataset_title: str
    slug: str | None = None
    about: PartialAbout | None = None
    slurm_job_id: str | None = None
    slurm_job_name: str = ""
    status: JobStatus
    status_reason: str | None = None
    parameters: JobParameters
    slurm_config: SlurmConfig
    created_at: datetime
    submitted_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime | None = None
    output_s3_key: str | None = None


class JobListResponse(BaseModel):
    """Paginated job list."""

    items: list[JobResponse]
    total_count: int
    page: int
    total_pages: int


class JobStatusResponse(BaseModel):
    """Lightweight status for polling."""

    job_id: str
    sim_id: str | None = None
    status: JobStatus
    slurm_job_id: str | None = None
    submitted_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    status_reason: str | None = None


class JobStatsResponse(BaseModel):
    """Aggregate counts for the simulation listing hero."""

    total: int
    running: int
    completed: int
    failed: int


class JobLogsResponse(BaseModel):
    """Job stdout / stderr log contents."""

    job_id: str
    stdout: str = ""
    stderr: str = ""
    truncated: bool = False
