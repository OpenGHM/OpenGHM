"""Pydantic models for HPC job submission, status tracking, and API contracts.

A *simulation* (mission 2026-09-20-simulations) is this same document, one
shape with a status rather than a second collection: a "DRAFT" status
precedes the existing SLURM lifecycle, and the routes in
`app/api/v1/jobs.py` — not a separate model — enforce which fields may
change once a draft has moved past it (spec.md's "Two entities, not
three").
"""

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

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
#: Statuses that count against `JOB_MAX_ACTIVE_PER_USER` and that the
#: `status=ACTIVE` list filter and the stats "running" count select.
ACTIVE_STATUSES: list[str] = ["PENDING", "SUBMITTED", "RUNNING", "COMPLETING"]
CANCELLABLE_STATUSES: set[str] = {"PENDING", "SUBMITTED", "RUNNING", "COMPLETING"}

#: Why a job ended the way it did (ADR 0026). Named in one place only,
#: `app.services.job_verdict.classify`. Mirrored by `FailureCause` in the
#: frontend's lib/jobs/types.ts (rule 4).
FailureCause = Literal[
    "fetch_failed",
    "run_refused",
    "wbm_error",
    "wbm_silent_failure",
    "timeout",
    "out_of_memory",
    "node_failure",
    "cancelled_by_user",
    "cancelled_by_system",
    "lost",
    "outcome_missing",
]

#: `purged`: Anvil's 30-day scratch purge removed the work directory (ADR 0026).
FilesState = Literal["present", "purged"]

#: The three states `app.api.v1.jobs._resolve_model_input` (T1) can produce
#: for "which model input does this simulation use" — distinguished at the
#: source rather than reconstructed in the UI (mission 2026-09-21, plan.md):
#:   - "chosen": the simulation carries its own `model_input_id` override.
#:   - "inherited": no override; the base snapshot's `uses.modelInput.id`
#:     resolves to a `model_inputs` catalogue entry.
#:   - "inherited-missing": no override; that id is not in the catalogue —
#:     the ordinary case today, not an edge case (two of the three shipped
#:     snapshot examples cite a v1-era input this repository ships no
#:     example for).
ModelInputState = Literal["inherited", "chosen", "inherited-missing"]


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
    """What a draft asks SLURM for. Both unset means the snapshot's own
    `simulation.recommendedCompute` (`app.services.slurm.resolve_compute`).
    The account and partition are the gateway's (settings), not the user's."""

    cores: int | None = None
    walltime: str | None = None


#: Bounds for `SlurmConfigUpdate`. Anvil's documented per-job limits for the
#: `shared` partition (https://rcac.purdue.edu/knowledge/anvil/run/partitions,
#: the page slurmly's `purdue_anvil` preset cites) are 128 cores (one node) and
#: 96 hours. Nothing in this repository records them, so they are unverified
#: here: SLURM is the authority, and a request it refuses comes back as
#: `sbatch_rejected` with its own message.
MAX_CORES = 128
MAX_WALLTIME_SECONDS = 96 * 3600

_WALLTIME_RE = re.compile(r"^(\d{1,3}):([0-5]\d):([0-5]\d)$")


class SlurmConfigUpdate(BaseModel):
    """PATCH body's `slurm_config`: the two values a user may change. A field
    left out keeps its stored value."""

    cores: int | None = Field(default=None, ge=1, le=MAX_CORES)
    walltime: str | None = Field(
        default=None, description="HH:MM:SS, at most 96:00:00", examples=["02:00:00"]
    )

    @field_validator("walltime")
    @classmethod
    def _v_walltime(cls, v: str | None) -> str | None:
        if v is None:
            return v
        m = _WALLTIME_RE.match(v)
        if m is None:
            raise ValueError("walltime must be HH:MM:SS, for example 02:00:00")
        seconds = int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3])
        if not 0 < seconds <= MAX_WALLTIME_SECONDS:
            raise ValueError("walltime must be more than zero and at most 96:00:00")
        return v


class ToolkitRef(BaseModel):
    """The toolkit install a submitted job runs: its directory and the
    commit it is pinned to (ADR 0025; rule 2)."""

    home: str
    commit: str


class SubmitError(BaseModel):
    """Why the last submit of a draft did not reach SLURM. The draft stays a
    DRAFT; this is what the UI shows next to it. `code` is one of
    `anvil_unreachable`, `sbatch_rejected`, `anvil_not_configured`."""

    code: str
    message: str
    at: datetime


class JobFailure(BaseModel):
    """The verdict on a job that did not complete, or was cancelled: the cause,
    the phase it happened in, a sentence its owner can act on, and the log
    excerpt that shows why. Stored on the job and returned as it is."""

    cause: FailureCause
    phase: str | None = None
    message: str
    excerpt: str | None = None


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

    # Which published model input this simulation runs against, overriding
    # the one its base snapshot (`dataset_id`) cites. Absent/None means
    # "inherit from the base snapshot" — every simulation created before
    # this mission is exactly that, so no migration and no behaviour change
    # for anything already stored. Resolving the *effective* id (and which
    # of the three states produced it) is `app.api.v1.jobs._resolve_model_input`
    # — this field is only ever the raw override, never the resolved value.
    model_input_id: str | None = None

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

    # Set at submit (ADR 0025): the toolkit install the job runs, and the
    # directory `sim run` writes under (<output_base>/<sim_id>, ADR 0023).
    toolkit: ToolkitRef | None = None
    work_dir: str | None = None
    # Set when a submit failed before SLURM accepted the job, cleared by the
    # next one. The draft it belongs to stayed a DRAFT.
    last_submit_error: SubmitError | None = None

    # S3 outputs
    output_s3_key: str | None = None

    # How the job ended (ADR 0026), written once, the first time the sweep sees
    # SLURM's terminal state. All optional: a job stored before this has none.
    # SLURM's own words and times, kept because sacct forgets a job after 14
    # days; `outcome` is the job's own record (`job_script`), as read.
    slurm_state: str | None = None
    slurm_exit_code: str | None = None
    slurm_start: datetime | None = None
    slurm_end: datetime | None = None
    failure: JobFailure | None = None
    outcome: dict | None = None
    # A cancel is two steps: the request is recorded, then SLURM confirms it.
    cancel_requested_at: datetime | None = None
    cancel_requested_by: str | None = None  # user id
    cancel_requested_by_email: str | None = None
    # When the sweep first found SLURM had no record of the job; cleared when
    # it is found again. A miss alone is never a verdict.
    missing_since: datetime | None = None
    # The work directory's fate, and when it was last looked for.
    files: FilesState | None = None
    files_checked_at: datetime | None = None
    # On a draft: a `sim_id` whose submit may have reached SLURM without the
    # gateway learning of it, and whose `scancel --name` has not yet worked.
    orphan_sim_ids: list[str] = Field(default_factory=list)

    # Timestamps
    created_at: datetime
    submitted_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime

    # protected_namespaces=() — pydantic reserves the "model_" prefix for
    # its own config namespace by default; `model_input_id` is a real field
    # name from the domain (not ours to rename to dodge the warning), so it
    # is opted out here and on every other model below that carries it.
    model_config = {"populate_by_name": True, "protected_namespaces": ()}


# --- API request / response models ---


class SimulationDeriveRequest(BaseModel):
    """POST /jobs/derive/{dataset_id} body — everything else about a new
    simulation is inherited from the snapshot named in the path, so the
    only thing left to say up front is what to call it. Out of scope:
    starting a simulation from scratch (spec.md) — there is no route that
    takes a bare `dataset_id` here."""

    model_config = {"protected_namespaces": ()}

    slug: str | None = None
    #: Optional model-input override, set at creation time instead of only
    #: by a later PATCH. Absent means inherit from the base snapshot, same
    #: as everywhere else this field appears.
    model_input_id: str | None = None


class SimulationUpdateRequest(BaseModel):
    """PATCH /jobs/{job_id} body. Every field is optional and only the ones
    supplied are changed — a "save" button posting the editor's current
    state, not a full replacement. Refused once the simulation has moved
    past `DRAFT` (app/api/v1/jobs.py)."""

    model_config = {"protected_namespaces": ()}

    slug: str | None = None
    about: PartialAbout | None = None
    parameters: JobParameters | None = None
    #: Cores and walltime to ask SLURM for. Only the fields sent change;
    #: `null` goes back to the snapshot's recommended compute.
    slurm_config: SlurmConfigUpdate | None = None
    #: Set to override the base snapshot's model input, or explicitly to
    #: `null` to clear an override and go back to inheriting — `exclude_unset`
    #: in `update_simulation` means only a field actually present in the
    #: PATCH body changes anything, so omitting this key leaves whatever
    #: was there untouched, same as every other field here.
    model_input_id: str | None = None


class OutputFile(BaseModel):
    path: str  # relative to the job's work directory
    bytes: int


class JobOutputSummary(BaseModel):
    """What a job wrote under its work directory, from its own outcome record.
    `files` can be cut short (`truncated`); `file_count` is the real total."""

    nc_count: int
    total_bytes: int
    file_count: int
    files: list[OutputFile] = Field(default_factory=list)
    truncated: bool = False


class JobVerdictFields(BaseModel):
    """What ADR 0026 adds to a job, on both `JobResponse` and
    `JobStatusResponse` (the polling hook reads /status). Null until it
    applies. The raw outcome record is never exposed, only `output`."""

    slurm_state: str | None = None
    slurm_exit_code: str | None = None
    slurm_start: datetime | None = None
    slurm_end: datetime | None = None
    failure: JobFailure | None = None
    cancel_requested_at: datetime | None = None
    cancel_requested_by_email: str | None = None
    files: FilesState | None = None
    output: JobOutputSummary | None = None


def verdict_fields(doc: dict) -> dict:
    """The `JobVerdictFields` of a job document, for a response to be built
    with. `output` is read from the stored outcome record."""
    output = None
    recorded = (doc.get("outcome") or {}).get("output")
    if isinstance(recorded, dict):
        try:
            output = JobOutputSummary(
                nc_count=recorded["nc_count"],
                total_bytes=recorded["total_bytes"],
                file_count=recorded.get("file_count", len(recorded.get("files") or [])),
                files=recorded.get("files") or [],
                truncated=bool(recorded.get("truncated", False)),
            )
        except (KeyError, TypeError, ValueError):
            output = None  # a record this gateway cannot read is shown as none
    return {
        "slurm_state": doc.get("slurm_state"),
        "slurm_exit_code": doc.get("slurm_exit_code"),
        "slurm_start": doc.get("slurm_start"),
        "slurm_end": doc.get("slurm_end"),
        "failure": doc.get("failure"),
        "cancel_requested_at": doc.get("cancel_requested_at"),
        "cancel_requested_by_email": doc.get("cancel_requested_by_email"),
        "files": doc.get("files"),
        "output": output,
    }


class JobResponse(JobVerdictFields):
    """Single job detail returned to the frontend."""

    model_config = {"protected_namespaces": ()}

    id: str
    sim_id: str = ""
    user_id: str
    dataset_id: str
    dataset_title: str
    slug: str | None = None
    about: PartialAbout | None = None
    #: The raw override, if any — never the resolved value. `None` here
    #: means "inherits from the base snapshot", regardless of what
    #: `effective_model_input_state` below says.
    model_input_id: str | None = None
    #: The model input this simulation actually uses, resolved by
    #: `app.api.v1.jobs._resolve_model_input` (T1) — and which of the three
    #: states produced it. Only resolved on single-simulation routes
    #: (derive, get, patch); `None` on the list route, which does not fan
    #: out a per-row resolve (plan.md's second risk).
    effective_model_input_id: str | None = None
    effective_model_input_state: ModelInputState | None = None
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
    #: Set once submitted (ADR 0025): the toolkit it runs, its work directory
    #: on scratch, and slurmly's directory holding the script and its logs.
    toolkit: ToolkitRef | None = None
    work_dir: str | None = None
    remote_job_dir: str | None = None
    #: Why the last submit of this draft did not reach SLURM, if it did not.
    last_submit_error: SubmitError | None = None


class JobListResponse(BaseModel):
    """Paginated job list."""

    items: list[JobResponse]
    total_count: int
    page: int
    total_pages: int


class JobStatusResponse(JobVerdictFields):
    """Lightweight status for polling."""

    job_id: str
    sim_id: str | None = None
    status: JobStatus
    slurm_job_id: str | None = None
    submitted_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    status_reason: str | None = None
    work_dir: str | None = None


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
