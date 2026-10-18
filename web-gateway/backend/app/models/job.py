"""Pydantic models for HPC job submission, status tracking, and API contracts.

A *snapshot draft* (mission 2026-09-20-simulations) is this same document, one
shape with a status rather than a second collection: a "DRAFT" status
precedes the existing SLURM lifecycle, and the routes in
`app/api/v1/jobs.py` — not a separate model — enforce which fields may
change once a draft has moved past it (spec.md's "Two entities, not
three").
"""

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator

from app.core.config import settings
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

#: A snapshot draft's `about` block, editable one field at a time while it is a
#: draft — derived from the generated `OpenGHMCitationBlock` (rule 4) rather
#: than hand-restated, the way the abandoned snapshot-drafts mission's
#: `PartialSnapshotMetadata` was for the whole document. Only `about` needs
#: this here: `JobParameters` below is already the gateway's own model, not
#: a spec block, so it has no generated counterpart to derive from.
PartialAbout = _partial_model(OpenGHMCitationBlock)

#: The fields of `about` a person writes when they publish a snapshot draft
#: (ADR 0031): derived from the generated `OpenGHMCitationBlock` (rule 4), minus
#: the three the gateway sets itself (`datePublished`, `url`, `isBasedOn`).
#: `extra="forbid"`: a field the form has no business sending is an error, not
#: silently dropped (the three the gateway sets are dropped by the route first).
GATEWAY_SET_ABOUT_FIELDS = ("datePublished", "url", "isBasedOn")
PublishAbout = create_model(
    "PublishAbout",
    __config__=ConfigDict(extra="forbid"),
    **{
        name: (field.annotation, field)
        for name, field in OpenGHMCitationBlock.model_fields.items()
        if name not in GATEWAY_SET_ABOUT_FIELDS
    },
)

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
    "gateway_setup",
    "run_refused",
    "wbm_error",
    "post_processing_failed",
    "wbm_silent_failure",
    "run_state_incomplete",
    "run_incomplete",
    "timeout",
    "out_of_memory",
    "node_failure",
    "continuation_failed",
    "cancelled_by_user",
    "cancelled_by_system",
    "lost",
    "outcome_missing",
]

#: Where a publish (ADR 0031) is. `failed` is not final: `PublishFailure.retry` says
#: whether the owner can try again. Mirrored by the frontend's lib/jobs/types.ts (rule 4).
PublishState = Literal["publishing", "published", "failed"]

#: What a failed publish allows: `same` publishes again under the stored
#: metadata, `edit` composes it again from a new `about` (nothing was written
#: for the old one), `none` has no retry for the owner: an administrator looks.
PublishRetry = Literal["same", "edit", "none"]

#: Why a publish failed (`app.services.publish`, the only place one is named).
#: The first eight are the sweep's verdict on the job: the toolkit's exit codes
#: 2 to 7, then no usable record, then a submit that was lost. The last four are
#: the submit's own refusals, spelled as the 5xx the route answered with.
PublishFailureCause = Literal[
    "publish_bad_input",
    "publish_output_incomplete",
    "publish_conflict",
    "publish_setup",
    "publish_upload_failed",
    "publish_verify_failed",
    "publish_job_failed",
    "publish_submit_interrupted",
    "anvil_not_configured",
    "anvil_unreachable",
    "sbatch_rejected",
    "internal_error",
]

#: `purged`: Anvil's 30-day scratch purge removed the work directory (ADR 0026).
FilesState = Literal["present", "purged"]

#: The three states `app.api.v1.jobs._resolve_model_input` (T1) can produce
#: for "which model input does this snapshot draft use" — distinguished at the
#: source rather than reconstructed in the UI (mission 2026-09-21, plan.md):
#:   - "chosen": the snapshot draft carries its own `model_input_id` override.
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
    """User-configured run parameters."""

    temporal_range_start: str = Field(..., description="ISO date, e.g. 2000-01-01")
    temporal_range_end: str = Field(..., description="ISO date, e.g. 2010-12-31")
    spatial_domain: SpatialDomain | None = None
    variables: list[str] = Field(default_factory=list, description="Output variables")
    custom_params: dict[str, str] | None = None
    #: What to ask of WBM's post-processing: `"standard"` daily, monthly and yearly
    #: output only, `"climatology"` also the climatologies; `None` is the snapshot's
    #: own (the init is left as published). A draft stored before this field has none.
    post_processing: Literal["standard", "climatology"] | None = None


_POST_PROCESSING_CHOICES = ("standard", "climatology")


def read_stored_parameters(raw: Any) -> Any:
    """A stored draft's `parameters` as `JobParameters` should read them: a
    `post_processing` that is not one of the two choices (a hand-edited document,
    a value a later version retired) is read as unset, the snapshot's own, rather
    than failing every read of the draft. A request is not read through this: it is
    held to the two literals. Anything that is not a dict passes through."""
    if isinstance(raw, dict) and raw.get("post_processing") not in (None, *_POST_PROCESSING_CHOICES):
        return {**raw, "post_processing": None}
    return raw


class SlurmConfig(BaseModel):
    """What a draft asks SLURM for. Both unset means the snapshot's own
    `simulation.recommendedCompute` (`app.services.slurm.resolve_compute`).
    The account and partition are the gateway's (settings), not the user's."""

    cores: int | None = None
    walltime: str | None = None


#: Bounds for `SlurmConfigUpdate`, and the cap on the walltime a submit asks
#: for by itself (`job_script.with_headroom`): 128 cores and 96 hours per job
#: on the `shared` partition. Checked on Anvil on 2026-10-02 with `scontrol show
#: partition shared` (QoS=part-shared), `sacctmgr show qos` (part-shared
#: MaxWall=4-00:00:00) and `sinfo` (128 CPUs per node); the gateway's account
#: `ees260008` may use only the `cpu` QOS. Longer QOSes exist on the cluster
#: (`wholenode-long` 10 days, `longwalltime` 30 days) but are not granted to
#: this account. The same day a request for 167:15:00 was refused by SLURM
#: with `QOSMaxWallDurationPerJobLimit`. SLURM stays the authority: a request
#: it refuses comes back as `sbatch_rejected` with its own message
#: (`sbatch_refusal.explain`).
MAX_CORES = 128
MAX_WALLTIME_SECONDS = 96 * 3600
#: The same limit as SLURM writes it, for messages.
MAX_WALLTIME = f"{MAX_WALLTIME_SECONDS // 3600}:00:00"

_WALLTIME_RE = re.compile(r"^(\d{1,3}):([0-5]\d):([0-5]\d)$")


class SlurmConfigUpdate(BaseModel):
    """PATCH body's `slurm_config`: the two values a user may change. A field
    left out keeps its stored value."""

    cores: int | None = Field(default=None, ge=1, le=MAX_CORES)
    walltime: str | None = Field(
        default=None, description=f"HH:MM:SS, at most {MAX_WALLTIME}", examples=["02:00:00"]
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
            raise ValueError(f"walltime must be more than zero and at most {MAX_WALLTIME}")
        return v


class ToolkitRef(BaseModel):
    """The toolkit install a submitted job runs: its directory and the
    commit it is pinned to (ADR 0025; rule 2)."""

    home: str
    commit: str


class SubmitScript(BaseModel):
    """What the first submit of a simulation sent to SLURM, kept so a continuation
    submits the same script (ADR 0037): the rendered job body and the cores and
    walltime the spec asked for. A job stored before continuations has none, and
    is never continued."""

    body: str
    cores: int
    walltime: str


class PreviousJob(BaseModel):
    """A job that ran a simulation and was continued by the next one: slurmly's
    ids and paths (for its logs, and for a delete to remove its directory) and
    what SLURM said about it. `state_saved_at` is when the complete run state
    the next job resumed from was saved."""

    number: int
    slurm_job_id: str
    internal_job_id: str | None = None
    remote_job_dir: str | None = None
    remote_script_path: str | None = None
    stdout_path: str | None = None
    stderr_path: str | None = None
    slurm_start: datetime | None = None
    slurm_end: datetime | None = None
    slurm_state: str | None = None
    slurm_exit_code: str | None = None
    state_saved_at: datetime | None = None
    # When the gateway moved it here (it saw it over). A job SLURM was asked
    # about from a squeue row has no `slurm_end`; the sweep fills it from sacct
    # (`slurm.backfill_slurm_end`) within a window from this time, counting its
    # tries on the entry.
    recorded_at: datetime | None = None
    slurm_end_tries: int | None = None
    slurm_end_tried_at: datetime | None = None


class PreviousJobSummary(BaseModel):
    """A `PreviousJob` as the API shows it: no paths."""

    number: int
    slurm_job_id: str
    slurm_state: str | None = None
    slurm_start: datetime | None = None
    slurm_end: datetime | None = None
    state_saved_at: datetime | None = None


class Continuation(BaseModel):
    """The next job of a simulation, between the moment the gateway decided to
    continue it and the moment SLURM accepted it (ADR 0037): `number` is the
    job to come, `tries` the submits whose answer was lost. Cleared once the job
    has a SLURM id."""

    number: int
    requested_at: datetime
    tries: int = 0


class SubmitError(BaseModel):
    """Why the last submit of a draft did not reach SLURM. The draft stays a
    DRAFT; this is what the UI shows next to it, and every later refusal of a
    submit replaces it, so it is never the reason of an earlier try. `code` is
    the code of that refusal: `anvil_unreachable`, `sbatch_rejected`,
    `anvil_not_configured`, `internal_error`, `submit_interrupted` (a submit
    the gateway lost track of; the sweep returned the draft), or one of the
    4xx codes a submit answers with before it is claimed
    (`answered_by_published`, `unsupported_fields`,
    `run_start_not_aligned`, `run_dates_outside_aggregation`,
    `invalid_parameters`, `active_job_limit`, ...)."""

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
    #: A finer reason within the cause, for the causes that have one: `timeout`
    #: carries `no_new_state` (the job saved no state to continue from) or
    #: `job_limit` (the simulation used all the jobs it may) when it was judged
    #: for a continuation (ADR 0037); null otherwise.
    detail: str | None = None


class PublishFailure(BaseModel):
    """Why a publish ended `failed`: the cause, a sentence its owner can act on,
    what they can do about it, and the toolkit's exit code when there was one."""

    cause: PublishFailureCause
    message: str
    retry: PublishRetry
    exit_code: int | None = None


class PublishRecord(BaseModel):
    """A snapshot draft's publish (ADR 0031), stored on the job as `publish` and
    returned as it is. `snapshot_id` is minted once, before the first submit,
    and never changes; `metadata` is the composed `metadata.json`, stored at the
    first submit (and replaced only by a retry that says `edit`). Null on the
    job until the first publish."""

    state: PublishState
    snapshot_id: str
    metadata: dict[str, Any]
    attempts: int
    slurm_job_id: str | None = None
    remote_job_dir: str | None = None
    submitted_at: datetime | None = None
    finished_at: datetime | None = None
    failure: PublishFailure | None = None
    submitted_by: str


# --- MongoDB document ---


class JobDB(BaseModel):
    """Shape of a document stored in the MongoDB jobs collection."""

    id: str = Field(alias="_id")
    # Only a submitted snapshot draft has a real one (`_generate_sim_id`, minted
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
    # "Two entities, not three") — present from the moment a snapshot draft is
    # created, editable only while it stays one.
    slug: str | None = None
    about: PartialAbout | None = None

    # Which published model input this snapshot draft runs against, overriding
    # the one its base snapshot (`dataset_id`) cites. Absent/None means
    # "inherit from the base snapshot" — every snapshot draft created before
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

    _read_parameters = field_validator("parameters", mode="before")(read_stored_parameters)

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
    # The WBM log's path on Anvil, stored the first time the logs route finds it
    # from the init files (ADR 0027); once the job has ended `outcome` names it.
    wbm_log_path: str | None = None
    # The publish of a completed draft as a snapshot (ADR 0031); None until one starts.
    publish: PublishRecord | None = None
    # On a draft: a `sim_id` whose submit may have reached SLURM without the
    # gateway learning of it, and whose `scancel --name` has not yet worked.
    orphan_sim_ids: list[str] = Field(default_factory=list)

    # A run longer than one job (ADR 0037). `submit_script` is what the first
    # submit sent; `previous_jobs` the jobs SLURM stopped at their time limit
    # that a later job continued, oldest first (the fields above describe the
    # job running now, or the last one); `continuation` is set while the next
    # job is being submitted.
    submit_script: SubmitScript | None = None
    previous_jobs: list[PreviousJob] = Field(default_factory=list)
    continuation: Continuation | None = None

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
    snapshot draft is inherited from the snapshot named in the path, so the
    only thing left to say up front is what to call it. Out of scope:
    starting a snapshot draft from scratch (spec.md) — there is no route that
    takes a bare `dataset_id` here."""

    model_config = {"protected_namespaces": ()}

    slug: str | None = None
    #: Optional model-input override, set at creation time instead of only
    #: by a later PATCH. Absent means inherit from the base snapshot, same
    #: as everywhere else this field appears.
    model_input_id: str | None = None


class SimulationUpdateRequest(BaseModel):
    """PATCH /jobs/{job_id} body. Every field is optional and only the ones
    supplied are changed — an auto-save posting what changed, not a full
    replacement. Refused once the snapshot draft has moved past `DRAFT`
    (app/api/v1/jobs.py)."""

    model_config = {"protected_namespaces": ()}

    slug: str | None = None
    #: Merged into the stored block key by key: a key sent replaces that key, a
    #: key sent as `null` removes it, a key left out stays. `null` for the whole
    #: block clears it.
    about: PartialAbout | None = None
    #: Replaces the stored parameters whole; it cannot be `null`.
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

    @field_validator("parameters")
    @classmethod
    def _v_parameters(cls, v: JobParameters | None) -> JobParameters | None:
        # Runs only when the key is sent, so omitting it is still allowed.
        if v is None:
            raise ValueError("parameters cannot be null; leave it out to keep it as it is")
        return v


class PublishRequest(BaseModel):
    """POST /jobs/{job_id}/publish body: the `about` a person writes
    (`PublishAbout`). It is checked by the route against `PublishAbout`, not
    here, so a bad one answers 422 `invalid_about` with a list of field errors
    rather than FastAPI's own shape, and so a body with no `about`, or one that
    is not an object, answers it too. Needed whenever the metadata is composed:
    the first attempt, and a retry whose failure says `retry: "edit"`."""

    about: Any = None


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


#: SLURM reports a time it does not have (a job cancelled while queued never
#: started) as NO_VAL, 4294967294 seconds, which is 2106-02-07T06:28:14Z.
SLURM_NO_VAL = 4294967294
_LATEST_REAL_YEAR = 2100


def real_time(value: datetime | None) -> datetime | None:
    """`value`, or None when it is SLURM's NO_VAL (or the epoch, or anything
    past the year 2100) that an earlier gateway stored as a time. Applied when a
    job is read, so such a job shows no start instead of "waited 695470 h"."""
    if value is None:
        return None
    if value.year >= _LATEST_REAL_YEAR or value.year < 1971:
        return None
    return value


def verdict_fields(doc: dict) -> dict:
    """The `JobVerdictFields` of a job document, for a response to be built
    with. `output` is read from the stored outcome record."""
    output = None
    outcome = doc.get("outcome")
    recorded = outcome.get("output") if isinstance(outcome, dict) else None
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
        "slurm_start": real_time(doc.get("slurm_start")),
        "slurm_end": real_time(doc.get("slurm_end")),
        "failure": doc.get("failure"),
        "cancel_requested_at": doc.get("cancel_requested_at"),
        "cancel_requested_by_email": doc.get("cancel_requested_by_email"),
        "files": doc.get("files"),
        "output": output,
    }


class JobRunFields(BaseModel):
    """What ADR 0037 adds to a job, on both `JobResponse` and `JobStatusResponse`:
    the earlier jobs of a simulation that ran as several, which job this one is
    and how many it may use, and the next job while it is being submitted."""

    previous_jobs: list[PreviousJobSummary] = Field(default_factory=list)
    #: 1-based: the job running now, or the one that ran last. Null on a draft.
    job_number: int | None = None
    #: The most jobs this simulation may use: the setting for a draft and for a
    #: job that stored its script, 1 for one that did not (it is never continued).
    max_jobs: int = 1
    continuation: Continuation | None = None


def run_fields(doc: dict) -> dict:
    """The `JobRunFields` of a job document, for a response to be built with."""
    earlier = [
        PreviousJobSummary(**entry) for entry in doc.get("previous_jobs") or [] if isinstance(entry, dict)
    ]
    draft = doc.get("status") == "DRAFT"
    continuable = draft or doc.get("submit_script") is not None
    return {
        "previous_jobs": earlier,
        "job_number": None if draft else len(earlier) + 1,
        "max_jobs": settings.JOB_MAX_JOBS_PER_SIMULATION if continuable else 1,
        "continuation": doc.get("continuation"),
    }


class JobResponse(JobVerdictFields, JobRunFields):
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
    #: The model input this snapshot draft actually uses, resolved by
    #: `app.api.v1.jobs._resolve_model_input` (T1) — and which of the three
    #: states produced it. Only resolved on single-draft routes
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
    _read_parameters = field_validator("parameters", mode="before")(read_stored_parameters)
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
    #: Its publish as a snapshot (ADR 0031), once one has started.
    publish: PublishRecord | None = None


class JobListResponse(BaseModel):
    """Paginated job list."""

    items: list[JobResponse]
    total_count: int
    page: int
    total_pages: int


class JobProgress(BaseModel):
    """How far WBM has got, from the last progress line of its log (ADR 0027)."""

    phase: Literal["spinup", "run"]
    # Spin-up only: which loop of how many.
    loop: int | None = None
    loops: int | None = None
    #: The simulated date WBM has reached.
    date: str
    run_start: str | None = None
    run_end: str | None = None
    #: Run phase only; a spin-up's period is not known to the gateway.
    fraction: float | None = None
    #: The log line this was read from (at most 200 characters).
    line: str
    read_at: datetime


class JobLive(BaseModel):
    """What SLURM said about a job at `checked_at`. Not stored in Mongo."""

    checked_at: datetime
    queue_reason: str | None = None
    estimated_start: datetime | None = None
    time_limit_seconds: int | None = None
    progress: JobProgress | None = None


class JobStatusResponse(JobVerdictFields, JobRunFields):
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
    live: JobLive | None = None
    #: The publish record, so the polling hook sees it end after the run has.
    publish: PublishRecord | None = None


class JobStatsResponse(BaseModel):
    """Aggregate counts: the snapshot draft list's tabs (one per bucket) and the
    admin dashboard cards (`total`, `running`, `completed`, `failed`).

    `running` is every active status (`ACTIVE_STATUSES`), not just RUNNING."""

    total: int
    running: int
    completed: int
    failed: int
    draft: int
    cancelled: int


LogStream = Literal["stdout", "stderr", "wbm"]


class JobLogResponse(BaseModel):
    """One chunk of one log, read by byte offset (ADR 0027): `data` is the text
    of the bytes `[offset, next_offset)`, and `next_offset` is where the next
    read starts."""

    job_id: str
    stream: LogStream
    #: False: the file is not there (yet, or purged, or the job has no directory).
    exists: bool
    data: str = ""
    offset: int = 0
    next_offset: int = 0
    size: int = 0
    eof: bool = True


class SubmitRequest(BaseModel):
    """POST /jobs/{job_id}/submit body, optional. `rerun` says the person asked
    for a simulation of a draft its snapshot already answers (the published output
    covers it), to check the snapshot reproduces itself. Without it such a
    draft is refused (`answered_by_published`, app.services.published_answer)."""

    rerun: bool = False
