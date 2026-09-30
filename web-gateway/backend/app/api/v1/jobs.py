"""Jobs API — drafts, submit, list, status, cancel, logs."""

import asyncio
import logging
import math
import posixpath
import random
import string
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from slurmly.exceptions import (
    InvalidJobSpec,
    SbatchError,
    SbatchParseError,
    SlurmlyError,
)

from app.core.audit import AuditCategory, log_event
from app.core.authz import can, require_active_user, require_permission, require_submitter
from app.core.config import settings
from app.core.database import get_db
from app.core.roles import Permission
from app.models.job import (
    ACTIVE_STATUSES,
    CANCELLABLE_STATUSES,
    TERMINAL_STATUSES,
    JobListResponse,
    JobLogsResponse,
    JobDB,
    JobParameters,
    JobResponse,
    JobStatsResponse,
    JobStatusResponse,
    ModelInputState,
    SimulationDeriveRequest,
    SimulationUpdateRequest,
    SlurmConfig,
    verdict_fields,
)
from app.models.user import TokenPayload
from app.services import job_script, slurm

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["jobs"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _generate_sim_id(now: datetime) -> str:
    date_part = now.strftime("%Y%m%d")
    rand_part = "".join(random.choices(string.hexdigits[:16].lower(), k=6))
    return f"sim-{date_part}-{rand_part}"


def _resolve_model_input(
    job_doc: dict, dataset_doc: dict | None, catalogue_ids: set[str]
) -> tuple[str | None, ModelInputState]:
    """Which model input `job_doc` effectively uses, and which of the three
    states (`app.models.job.ModelInputState`) produced that answer (T1).
    Pure — a plain dict standing in for `db.jobs`, another for `db.datasets`,
    a plain `set` standing in for a `model_inputs` existence check — so the
    states are tested directly with no Mongo (tests/test_jobs_drafts.py).
    Written first and kept pure deliberately: the frontend's three-state
    display (next commit) depends on these being distinguished here, not
    reconstructed from a single id in the UI (plan.md).

    - `job_doc["model_input_id"]` set -> "chosen", that id, regardless of
      whether it happens to also be in the catalogue (this mission does not
      validate an override against it — the picker that supplies one,
      next commit, only ever offers catalogue entries).
    - unset, and the base snapshot's `uses.modelInput.id` is in
      `catalogue_ids` -> "inherited", that id.
    - unset, and that id is not in `catalogue_ids` (or there is no base
      snapshot to read it from at all) -> "inherited-missing" — the
      ordinary case in the dev database today, not an edge case.
    """
    override = job_doc.get("model_input_id")
    if override:
        return override, "chosen"

    inherited_id = ((dataset_doc or {}).get("uses") or {}).get("modelInput", {}).get("id")
    if inherited_id is not None and inherited_id in catalogue_ids:
        return inherited_id, "inherited"
    return inherited_id, "inherited-missing"


async def _resolve_effective_model_input(doc: dict) -> tuple[str | None, ModelInputState]:
    """`_resolve_model_input`'s Mongo-fetching half — kept separate so the
    decision itself stays pure and testable. Only called for a single
    simulation (derive/get/patch), never per-row from `list_jobs`
    (plan.md's second risk: N resolves on the list page)."""
    db = get_db()
    # `datasets`/`model_inputs` documents are envelopes since mission
    # 2026-09-23-catalogue-envelope ({_id, document, owner_user_id,
    # visibility, registered_at}) — unwrap to the spec document right after
    # the fetch, so everything below keeps working on the shape it always has
    # (app.models.repository.build_envelope / .from_metadata_json).
    dataset_envelope = await db.datasets.find_one({"_id": doc["dataset_id"]})
    dataset_doc = (dataset_envelope or {}).get("document")

    catalogue_ids: set[str] = set()
    if not doc.get("model_input_id"):
        inherited_id = ((dataset_doc or {}).get("uses") or {}).get("modelInput", {}).get("id")
        if inherited_id is not None:
            exists = await db.model_inputs.find_one({"_id": inherited_id})
            if exists is not None:
                catalogue_ids = {inherited_id}

    return _resolve_model_input(doc, dataset_doc, catalogue_ids)


def _doc_to_response(
    doc: dict,
    *,
    effective: tuple[str | None, ModelInputState] | None = None,
) -> JobResponse:
    effective_id, effective_state = effective if effective is not None else (None, None)
    return JobResponse(
        id=doc["_id"],
        sim_id=doc.get("sim_id", ""),
        user_id=doc["user_id"],
        dataset_id=doc["dataset_id"],
        dataset_title=doc["dataset_title"],
        slug=doc.get("slug"),
        about=doc.get("about"),
        model_input_id=doc.get("model_input_id"),
        effective_model_input_id=effective_id,
        effective_model_input_state=effective_state,
        slurm_job_id=doc.get("slurm_job_id"),
        slurm_job_name=doc.get("slurm_job_name", ""),
        status=doc["status"],
        status_reason=doc.get("status_reason"),
        parameters=doc["parameters"],
        slurm_config=doc["slurm_config"],
        created_at=doc["created_at"],
        submitted_at=doc.get("submitted_at"),
        started_at=doc.get("started_at"),
        completed_at=doc.get("completed_at"),
        updated_at=doc.get("updated_at"),
        output_s3_key=doc.get("output_s3_key"),
        toolkit=doc.get("toolkit"),
        work_dir=doc.get("work_dir"),
        remote_job_dir=doc.get("remote_job_dir"),
        last_submit_error=doc.get("last_submit_error"),
        **verdict_fields(doc),
    )


def _status_response(doc: dict) -> JobStatusResponse:
    """What the polling endpoint and the cancel route answer with."""
    return JobStatusResponse(
        job_id=doc["_id"],
        sim_id=doc.get("sim_id"),
        status=doc["status"],
        slurm_job_id=doc.get("slurm_job_id"),
        submitted_at=doc.get("submitted_at"),
        started_at=doc.get("started_at"),
        completed_at=doc.get("completed_at"),
        status_reason=doc.get("status_reason"),
        work_dir=doc.get("work_dir"),
        **verdict_fields(doc),
    )


def _is_owner(doc: dict, user: TokenPayload) -> bool:
    """Pure ownership check against an already-fetched document."""
    return doc["user_id"] == user.sub


def _can_access_job(
    doc: dict, user: TokenPayload, escalated: Permission | None
) -> bool:
    """Whether `user` may act on `doc`: its owner, or a holder of
    `escalated` (None: the owner alone). Pure — a dict standing in for a Mongo document, a
    TokenPayload standing in for the authenticated caller — so the second-
    user isolation guarantee (spec.md's acceptance criteria) is testable
    without Mongo or a request (tests/test_jobs_drafts.py)."""
    return _is_owner(doc, user) or (escalated is not None and can(user, escalated))


async def _get_job_for(
    job_id: str, user: TokenPayload, escalated: Permission | None
) -> dict:
    """Fetch a job the caller may act on: its owner, or a holder of `escalated`.

    The one door every by-id job route goes through. A job that exists but
    that the caller may not act on is a 404, identical to a missing one
    (ADR 0024): a 403 would confirm to a stranger that the id exists.

    The permission passed in matches the verb being performed (JOB_VIEW_ANY
    for read paths, JOB_CANCEL_ANY for cancel) rather than a single "is this
    an admin" check, so viewing and cancelling can be granted independently.
    Pass None for a verb with no "any" permission (edit, delete): the owner
    alone may perform it.
    """
    db = get_db()
    doc = await db.jobs.find_one({"_id": job_id})
    if doc is None or not _can_access_job(doc, user, escalated):
        raise HTTPException(status_code=404, detail="Job not found")
    return doc


def _is_editable(doc: dict) -> bool:
    """A simulation may only be created, edited or deleted through the
    draft routes while it is still a draft (spec.md: "becomes read-only the
    moment it is submitted"). Pure — no Mongo, no request — so the refusal
    rule is testable directly (tests/test_jobs_drafts.py)."""
    return doc["status"] == "DRAFT"


def _new_draft_document(
    *,
    job_id: str,
    dataset_id: str,
    dataset_title: str,
    parameters: JobParameters,
    slug: str | None,
    user: TokenPayload,
    now: datetime,
    model_input_id: str | None = None,
) -> dict:
    """Build a fresh draft's Mongo document. Pure — no Mongo, no request —
    so the property that matters is directly testable: `sim_id` is a real
    simulation id only once a draft is actually submitted (`submit_job`
    mints one via `_generate_sim_id`), so a draft has to omit the field
    entirely rather than default it to `""`. `db.jobs`'s `sim_id` index is
    `unique=True, sparse=True` — sparse only excludes documents where the
    field is *missing*, not merely falsy or null, so `sim_id: ""` (or even
    `sim_id: None`) on every draft would collide with the first draft ever
    created and 500 on the second (found in review of this commit)."""
    return {
        "_id": job_id,
        "user_id": user.sub,
        "user_email": user.email,
        "dataset_id": dataset_id,
        "dataset_title": dataset_title,
        "slug": slug,
        "about": None,
        "model_input_id": model_input_id,
        "slurm_job_id": None,
        "slurm_job_name": "",
        "status": "DRAFT",
        "status_reason": None,
        "parameters": parameters.model_dump(),
        "slurm_config": SlurmConfig().model_dump(),
        "internal_job_id": None,
        "remote_job_dir": None,
        "remote_script_path": None,
        "stdout_path": None,
        "stderr_path": None,
        "slurmly_submitted_at": None,
        "output_s3_key": None,
        "created_at": now,
        "submitted_at": None,
        "started_at": None,
        "completed_at": None,
        "updated_at": now,
    }


def _derive_simulation_parameters(dataset_doc: dict) -> JobParameters:
    """Build a new simulation's parameters from a published catalogue entry
    (T4): the temporal coverage and output variables it was run with become
    the starting point a user overrides, rather than a blank form. Pure —
    takes a plain dict, returns a new model, touches no Mongo — the source
    document is read here and nowhere written back to. Submit compares the
    draft against the same derivation (`job_script.run_overrides`)."""
    return job_script.snapshot_defaults(dataset_doc)


def _job_scope_query(user: TokenPayload, user_id: str | None) -> dict:
    """Build the Mongo user-scope filter for a job list/stats query.

    Defaults to the caller's own jobs even for staff/admin — an operator's
    dashboard doesn't silently turn into a site-wide firehose. Passing
    user_id="*" (or another user's id) requires JOB_VIEW_ANY.
    """
    if user_id is None or user_id == user.sub:
        return {"user_id": user.sub}
    if not can(user, Permission.JOB_VIEW_ANY):
        raise HTTPException(
            status_code=403, detail="Requires permission: job:view:any"
        )
    return {} if user_id == "*" else {"user_id": user_id}


# ---------------------------------------------------------------------------
# POST /jobs/derive/{dataset_id}  —  New simulation from a snapshot
# ---------------------------------------------------------------------------
#
# A simulation's only creation path in this mission (spec.md, "Out of
# scope": starting one from scratch needs a model-input catalogue the
# gateway does not have yet). It is created as a draft — no Slurm
# submission happens here — inheriting its dataset, title and parameters
# from the published catalogue entry named in the path. `datasets` is only
# ever read by this route, never written to: the source snapshot is
# untouched by deriving from it.


@router.post(
    "/derive/{dataset_id}",
    response_model=JobResponse,
    status_code=status.HTTP_201_CREATED,
)
async def derive_simulation(
    dataset_id: str,
    body: SimulationDeriveRequest = SimulationDeriveRequest(),
    user: TokenPayload = Depends(require_active_user),
):
    db = get_db()
    # Envelope shape (mission 2026-09-23-catalogue-envelope) — unwrap to the
    # spec document.
    dataset_envelope = await db.datasets.find_one({"_id": dataset_id})
    if dataset_envelope is None:
        raise HTTPException(
            status_code=404, detail=f"Dataset '{dataset_id}' not found"
        )
    dataset_doc = dataset_envelope["document"]

    dataset_title = dataset_doc.get("about", {}).get("name", dataset_id)
    parameters = _derive_simulation_parameters(dataset_doc)

    now = datetime.now(timezone.utc)
    job_id = str(uuid.uuid4())
    doc = _new_draft_document(
        job_id=job_id,
        dataset_id=dataset_id,
        dataset_title=dataset_title,
        parameters=parameters,
        slug=body.slug,
        user=user,
        now=now,
        model_input_id=body.model_input_id,
    )
    await db.jobs.insert_one(doc)

    await log_event(
        "simulation_derived",
        actor_id=user.sub,
        actor_email=user.email,
        target_id=job_id,
        category=AuditCategory.JOB,
        detail={"dataset_id": dataset_id},
    )

    effective = await _resolve_effective_model_input(doc)
    return _doc_to_response(doc, effective=effective)


# ---------------------------------------------------------------------------
# PATCH /jobs/{job_id}  —  Edit while draft
# ---------------------------------------------------------------------------


@router.patch("/{job_id}", response_model=JobResponse)
async def update_simulation(
    job_id: str,
    body: SimulationUpdateRequest,
    user: TokenPayload = Depends(require_permission(Permission.JOB_EDIT_OWN)),
):
    db = get_db()
    # No "any" edit permission: mutating someone else's private, unpublished
    # simulation is out of scope (see app.core.roles), so the owner alone
    # passes — and everyone else, JOB_VIEW_ANY holders included, gets the
    # same 404 as for a missing id.
    doc = await _get_job_for(job_id, user, None)
    if not _is_editable(doc):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot edit a simulation in state {doc['status']}",
        )

    changes = body.model_dump(exclude_unset=True, mode="json")
    if not changes:
        effective = await _resolve_effective_model_input(doc)
        return _doc_to_response(doc, effective=effective)

    if "slurm_config" in changes:
        # Only the fields the client sent change; `null` goes back to the
        # snapshot's recommended compute.
        sent = changes["slurm_config"]
        stored = doc.get("slurm_config") or {}
        changes["slurm_config"] = SlurmConfig(
            **({} if sent is None else {**stored, **sent})
        ).model_dump()

    changes["updated_at"] = datetime.now(timezone.utc)
    await db.jobs.update_one({"_id": job_id}, {"$set": changes})
    updated = await db.jobs.find_one({"_id": job_id})
    effective = await _resolve_effective_model_input(updated)
    return _doc_to_response(updated, effective=effective)


# ---------------------------------------------------------------------------
# POST /jobs/{job_id}/submit  —  Run a draft on Anvil
# ---------------------------------------------------------------------------
#
# The one way a simulation reaches SLURM (ADR 0025): the owner's DRAFT becomes
# a slurmly batch job whose body fetches the snapshot and runs `openghm sim
# run`. The draft is claimed first with a conditional update, so two submits
# cannot both pass; if Anvil then refuses or cannot be reached, it is handed
# back as a DRAFT with `last_submit_error`, never left in a state SLURM does
# not know about.


def _error(http_status: int, code: str, message: str, **extra) -> HTTPException:
    """An HTTPException whose `detail` is `{"code", "message", **extra}`, the
    same shape `app.core.authz` refuses with."""
    return HTTPException(
        status_code=http_status, detail={"code": code, "message": message, **extra}
    )


_ANVIL_NOT_CONFIGURED = (
    "This gateway is not set up to run simulations on Anvil yet. "
    "Ask an administrator. Your draft is unchanged."
)
_ANVIL_UNREACHABLE = (
    "Anvil could not be reached, so nothing was submitted. "
    "Your draft is unchanged. Try again in a few minutes."
)


def _sbatch_refusal_message(exc: Exception) -> str:
    detail = ""
    if isinstance(exc, SbatchError):
        detail = (exc.stderr or exc.stdout or "").strip()
    detail = (detail or str(exc)).strip()[:500]
    return f"SLURM refused the job: {detail} Your draft is unchanged."


@router.post(
    "/{job_id}/submit",
    response_model=JobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_simulation(
    job_id: str,
    user: TokenPayload = Depends(require_submitter),
):
    db = get_db()
    # Owner only, like edit and delete: no "any" permission submits someone
    # else's draft, and everyone else gets the 404 a missing id gets.
    doc = await _get_job_for(job_id, user, None)
    if not _is_editable(doc):
        raise _error(
            status.HTTP_409_CONFLICT,
            "not_a_draft",
            f"Only a draft can be submitted; this simulation is {doc['status']}.",
        )
    if not slurm.toolkit_configured():
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "anvil_not_configured",
            _ANVIL_NOT_CONFIGURED,
        )

    envelope = await db.datasets.find_one({"_id": doc["dataset_id"]})
    if envelope is None:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "snapshot_not_found",
            "The snapshot this simulation is based on is no longer in the repository.",
        )
    snapshot = envelope["document"]
    job = JobDB(**doc)

    fields = job_script.unsupported_fields(job.parameters, job.model_input_id, snapshot)
    if fields:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "unsupported_fields",
            "These settings cannot run yet, because the toolkit has no option for "
            f"them: {', '.join(fields)}. Reset them to the snapshot's own values "
            "and submit again.",
            fields=fields,
        )

    now = datetime.now(timezone.utc)
    sim_id = _generate_sim_id(now)
    home = settings.ANVIL_OPENGHM_HOME.rstrip("/")
    work_dir = posixpath.join(settings.ANVIL_OUTPUT_BASE, sim_id)
    try:
        overrides = job_script.run_overrides(job.parameters, snapshot)
        body = job_script.render_job_body(
            snapshot_id=job.dataset_id,
            sim_id=sim_id,
            openghm_home=home,
            cache_dir=settings.ANVIL_CACHE_DIR,
            fetch_lock=settings.ANVIL_FETCH_LOCK,
            work_dir=work_dir,
            run_start=overrides.run_start,
            run_end=overrides.run_end,
            output_vars=overrides.output_vars,
        )
        toolkit = {"home": home, "commit": job_script.toolkit_commit(home)}
        slurm.resolve_compute(job.slurm_config, snapshot)
    except job_script.SubmitInputError as exc:
        raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_parameters", str(exc))

    # The claim. `updated_at` is part of the filter so that a PATCH landing
    # between the read above and here is not submitted half-rendered.
    claimed = await db.jobs.update_one(
        {"_id": job_id, "status": "DRAFT", "updated_at": doc["updated_at"]},
        {
            "$set": {
                "status": "SUBMITTED",
                "sim_id": sim_id,
                "slurm_job_name": sim_id,
                "toolkit": toolkit,
                "work_dir": work_dir,
                "status_reason": None,
                "updated_at": now,
            },
            "$unset": {"last_submit_error": ""},
        },
    )
    if claimed.matched_count == 0:
        raise _error(
            status.HTTP_409_CONFLICT,
            "not_a_draft",
            "This simulation was changed or already submitted. Reload it and try again.",
        )
    job = JobDB(**(await db.jobs.find_one({"_id": job_id})))

    try:
        submitted = await slurm.submit_job(job, snapshot, body)
    except Exception as exc:
        maybe_sent = False
        if isinstance(exc, slurm.AnvilNotConfigured):
            http_status, code, message = (
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "anvil_not_configured",
                _ANVIL_NOT_CONFIGURED,
            )
        elif isinstance(exc, (SbatchError, InvalidJobSpec)):
            http_status, code, message = (
                status.HTTP_502_BAD_GATEWAY,
                "sbatch_rejected",
                _sbatch_refusal_message(exc),
            )
            if isinstance(exc, SbatchError):
                # slurmly made its job directory before sbatch said no, and
                # keeps no record of it: nothing else will ever remove it.
                await slurm.remove_failed_submit_dirs(sim_id)
        elif isinstance(exc, job_script.SubmitInputError):
            http_status, code, message = (
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "invalid_parameters",
                str(exc),
            )
        elif isinstance(exc, (SlurmlyError, OSError, asyncio.TimeoutError)):
            # Includes SbatchParseError: sbatch ran but its answer was lost,
            # so a job may exist that this gateway never learned the id of.
            http_status, code, message = (
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "anvil_unreachable",
                _ANVIL_UNREACHABLE,
            )
            maybe_sent = True
        else:
            await _return_to_draft(job_id, "internal_error", "The submit failed unexpectedly.")
            raise
        logger.error("Job %s submit failed (%s): %s", job_id, code, exc)
        # The user is told nothing was submitted, so a job that was must go.
        # If scancel cannot run either, the sim_id stays on the draft and the
        # sweep retries it (ADR 0026).
        orphan = sim_id if maybe_sent and not await _scancel_attempt(sim_id) else None
        await _return_to_draft(job_id, code, message, orphan_sim_id=orphan)
        raise _error(http_status, code, message)

    done = datetime.now(timezone.utc)
    recorded = await db.jobs.update_one(
        {"_id": job_id, "status": "SUBMITTED"},
        {
            "$set": {
                "slurm_job_id": submitted.slurm_job_id,
                "internal_job_id": submitted.internal_job_id,
                "remote_job_dir": submitted.remote_job_dir,
                "remote_script_path": submitted.remote_script_path,
                "stdout_path": submitted.stdout_path,
                "stderr_path": submitted.stderr_path,
                "slurmly_submitted_at": submitted.submitted_at,
                "submitted_at": done,
                "updated_at": done,
            }
        },
    )
    if recorded.matched_count == 0:
        # Cancelled in the moments between the claim and SLURM's answer: the
        # job exists on Anvil but the user already said no to it.
        logger.warning("Job %s left SUBMITTED during submit; cancelling %s", job_id, submitted.slurm_job_id)
        try:
            await slurm.cancel_job(submitted.slurm_job_id)
        except Exception as exc:
            logger.error("scancel of orphaned %s failed: %s", submitted.slurm_job_id, exc)
            # Keep the name so the sweep retries it by name.
            await db.jobs.update_one({"_id": job_id}, {"$addToSet": {"orphan_sim_ids": sim_id}})
        # Keep where its files are, so a delete can remove them.
        await db.jobs.update_one(
            {"_id": job_id, "status": "CANCELLED"},
            {
                "$set": {
                    "slurm_job_id": submitted.slurm_job_id,
                    "internal_job_id": submitted.internal_job_id,
                    "remote_job_dir": submitted.remote_job_dir,
                    "remote_script_path": submitted.remote_script_path,
                    "stdout_path": submitted.stdout_path,
                    "stderr_path": submitted.stderr_path,
                    "slurmly_submitted_at": submitted.submitted_at,
                }
            },
        )

    await log_event(
        "job_submitted",
        actor_id=user.sub,
        actor_email=user.email,
        target_id=job_id,
        category=AuditCategory.JOB,
        detail={
            "sim_id": sim_id,
            "dataset_id": job.dataset_id,
            "slurm_job_id": submitted.slurm_job_id,
            "status": "SUBMITTED",
        },
    )

    updated = await db.jobs.find_one({"_id": job_id})
    effective = await _resolve_effective_model_input(updated)
    return _doc_to_response(updated, effective=effective)


async def _scancel_attempt(sim_id: str) -> bool:
    """`scancel --name=<sim_id>` for a submit whose answer was lost. Whether
    it ran; a failure is logged and never changes the answer to the user."""
    try:
        return await slurm.scancel_by_name(sim_id)
    except Exception as exc:
        logger.error("scancel --name=%s failed: %s", sim_id, exc)
        return False


async def _return_to_draft(
    job_id: str, code: str, message: str, *, orphan_sim_id: str | None = None
) -> None:
    """Undo the claim of a submit that never reached SLURM: back to DRAFT, the
    submit-time fields removed (a draft carries no `sim_id`, see
    `_new_draft_document`), and the reason kept for the UI. `orphan_sim_id` is
    a `sim_id` whose job may exist after all, kept for the sweep to cancel."""
    now = datetime.now(timezone.utc)
    update: dict = {
        "$set": {
            "status": "DRAFT",
            "slurm_job_name": "",
            "last_submit_error": {"code": code, "message": message, "at": now},
            "updated_at": now,
        },
        "$unset": {"sim_id": "", "toolkit": "", "work_dir": ""},
    }
    if orphan_sim_id:
        update["$addToSet"] = {"orphan_sim_ids": orphan_sim_id}
    await get_db().jobs.update_one({"_id": job_id, "status": "SUBMITTED"}, update)


# ---------------------------------------------------------------------------
# DELETE /jobs/{job_id}  —  Delete a draft or a finished simulation
# ---------------------------------------------------------------------------
#
# A draft has nothing on Anvil. A finished simulation leaves two directories
# there (ADR 0026), and its owner's delete removes both before the document:
# a document that outlived its files could no longer say where they were.


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_simulation(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_DELETE_OWN)),
):
    db = get_db()
    doc = await _get_job_for(job_id, user, None)
    removed: list[str] = []
    if doc["status"] in TERMINAL_STATUSES:
        removed = await _remove_files_of(doc)
    elif not _is_editable(doc):
        raise _error(
            status.HTTP_409_CONFLICT,
            "job_active",
            "Cancel the simulation before deleting it.",
        )
    await db.jobs.delete_one({"_id": job_id, "status": doc["status"]})
    await log_event(
        "job_deleted",
        actor_id=user.sub,
        actor_email=user.email,
        target_id=job_id,
        category=AuditCategory.JOB,
        detail={"sim_id": doc.get("sim_id"), "status": doc["status"], "removed": removed},
    )


async def _remove_files_of(doc: dict) -> list[str]:
    """Remove a finished job's directories on Anvil, or say why they were not.
    Whatever goes wrong, the document stays."""
    if doc.get("files") == "purged" or not (doc.get("remote_job_dir") or doc.get("work_dir")):
        return []  # nothing recorded, or Anvil already removed it
    try:
        return await slurm.remove_job_files(doc)
    except slurm.RefusedPath as exc:
        logger.error("Job %s: refused to remove %s", doc["_id"], exc)
        raise _error(
            status.HTTP_409_CONFLICT,
            "refused_path",
            "This simulation's files are not where the gateway expects them, so it "
            "removed nothing. Ask an administrator.",
        )
    except slurm.CleanupFailed as exc:
        logger.error("Job %s: could not remove its files: %s", doc["_id"], exc)
        raise _error(
            status.HTTP_502_BAD_GATEWAY,
            "cleanup_failed",
            "Anvil could not remove this simulation's files, so it was not deleted. "
            "Try again.",
        )
    except (slurm.AnvilNotConfigured, SlurmlyError, OSError, asyncio.TimeoutError) as exc:
        logger.error("Job %s: Anvil unreachable while deleting: %s", doc["_id"], exc)
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "anvil_unreachable",
            "Anvil could not be reached, so nothing was deleted. Try again in a few minutes.",
        )


# ---------------------------------------------------------------------------
# GET /jobs  —  List user's jobs
# ---------------------------------------------------------------------------


@router.get("", response_model=JobListResponse)
async def list_jobs(
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    user_id: str | None = Query(
        None, description='Owner filter; "*" = all users (requires job:view:any)'
    ),
):
    db = get_db()
    query: dict = _job_scope_query(user, user_id)
    if status_filter:
        upper = status_filter.upper()
        if upper == "ACTIVE":
            query["status"] = {"$in": ACTIVE_STATUSES}
        else:
            query["status"] = upper

    total_count = await db.jobs.count_documents(query)
    total_pages = max(1, math.ceil(total_count / page_size))
    skip = (page - 1) * page_size

    cursor = db.jobs.find(query).sort("created_at", -1).skip(skip).limit(page_size)
    items = [_doc_to_response(doc) async for doc in cursor]

    return JobListResponse(
        items=items,
        total_count=total_count,
        page=page,
        total_pages=total_pages,
    )


# ---------------------------------------------------------------------------
# GET /jobs/stats  —  Aggregate counts (must be before /{job_id})
# ---------------------------------------------------------------------------


@router.get("/stats", response_model=JobStatsResponse)
async def get_job_stats(
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
    user_id: str | None = Query(
        None, description='Owner filter; "*" = all users (requires job:view:any)'
    ),
):
    db = get_db()
    pipeline = [
        {"$match": _job_scope_query(user, user_id)},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    results = await db.jobs.aggregate(pipeline).to_list(None)
    counts: dict[str, int] = {r["_id"]: r["count"] for r in results}
    total = sum(counts.values())
    running = sum(counts.get(s, 0) for s in ACTIVE_STATUSES)
    return JobStatsResponse(
        total=total,
        running=running,
        completed=counts.get("COMPLETED", 0),
        failed=counts.get("FAILED", 0),
    )


# ---------------------------------------------------------------------------
# GET /jobs/{job_id}  —  Detail
# ---------------------------------------------------------------------------


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
):
    doc = await _get_job_for(job_id, user, Permission.JOB_VIEW_ANY)
    effective = await _resolve_effective_model_input(doc)
    return _doc_to_response(doc, effective=effective)


# ---------------------------------------------------------------------------
# GET /jobs/{job_id}/status  —  Polling endpoint
# ---------------------------------------------------------------------------


@router.get("/{job_id}/status", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
):
    doc = await _get_job_for(job_id, user, Permission.JOB_VIEW_ANY)

    # Refresh from Slurm if not terminal
    if doc["status"] not in TERMINAL_STATUSES:
        try:
            doc = await slurm.update_job_status(job_id)
        except Exception as exc:
            logger.warning("Status poll failed for %s: %s", job_id, exc)
            # Return stale data

    return _status_response(doc)


# ---------------------------------------------------------------------------
# POST /jobs/{job_id}/cancel
# ---------------------------------------------------------------------------


@router.post("/{job_id}/cancel", response_model=JobStatusResponse)
async def cancel_job(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_CANCEL_OWN)),
):
    """Cancel takes two steps (ADR 0026). A job SLURM has an id for records
    the request and runs `scancel`; its status changes only when the sweep
    sees SLURM report CANCELLED, so SLURM's own end is what is stored. A job
    still inside its submit has no id to cancel: it is CANCELLED at once, and
    the submit route cancels what SLURM answers."""
    db = get_db()
    doc = await _get_job_for(job_id, user, Permission.JOB_CANCEL_ANY)
    now = datetime.now(timezone.utc)

    if doc["status"] not in CANCELLABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot cancel job in state {doc['status']}",
        )

    immediate = False
    if not doc.get("slurm_job_id"):
        # `slurm_job_id: None` is in the filter: the submit may record its id
        # between the read above and this write, and then there is a job to
        # scancel after all.
        immediate = (
            await db.jobs.update_one(
                {"_id": job_id, "status": doc["status"], "slurm_job_id": None},
                {
                    "$set": {
                        "status": "CANCELLED",
                        "status_reason": _CANCELLED_BY_USER,
                        "failure": {
                            "cause": "cancelled_by_user",
                            "phase": None,
                            "message": _CANCELLED_BY_USER,
                            "excerpt": None,
                        },
                        **_cancel_request(user, now),
                        "completed_at": now,
                        "updated_at": now,
                    }
                },
            )
        ).matched_count == 1
        if not immediate:
            doc = await db.jobs.find_one({"_id": job_id})
            if doc is None or doc["status"] not in CANCELLABLE_STATUSES or not doc.get("slurm_job_id"):
                raise _job_changed()

    if not immediate:
        # Keep the first request's time and requester if one is pending; a
        # second click only asks scancel again (safe to repeat).
        fresh = doc.get("cancel_requested_at") is None
        if fresh:
            recorded = await db.jobs.update_one(
                {"_id": job_id, "status": doc["status"]},
                {"$set": {**_cancel_request(user, now), "updated_at": now}},
            )
            if recorded.matched_count == 0:
                raise _job_changed()
        try:
            await slurm.cancel_job(doc["slurm_job_id"])
        except Exception as exc:
            logger.error("scancel failed for %s: %s", job_id, exc)
            if fresh:
                await db.jobs.update_one(
                    {"_id": job_id},
                    {"$unset": {key: "" for key in _CANCEL_REQUEST_FIELDS}},
                )
            raise _error(
                status.HTTP_502_BAD_GATEWAY,
                "cancel_failed",
                "Anvil could not be asked to cancel the job, so it is still running. Try again.",
            )

    await log_event(
        "job_cancelled",
        actor_id=user.sub,
        actor_email=user.email,
        target_id=job_id,
        category=AuditCategory.JOB,
        detail={
            "from": doc["status"],
            # Distinguishes an operator cancelling someone else's runaway job
            # (JOB_CANCEL_ANY) from a user cancelling their own.
            "owner_id": doc["user_id"],
            "on_behalf_of_other": doc["user_id"] != user.sub,
            # Requested: SLURM has yet to confirm. Immediate: it never had it.
            "requested": not immediate,
        },
    )

    return _status_response(await db.jobs.find_one({"_id": job_id}))


_CANCELLED_BY_USER = "You cancelled this simulation."
_CANCEL_REQUEST_FIELDS = ("cancel_requested_at", "cancel_requested_by", "cancel_requested_by_email")


def _cancel_request(user: TokenPayload, now: datetime) -> dict:
    return {
        "cancel_requested_at": now,
        "cancel_requested_by": user.sub,
        "cancel_requested_by_email": user.email,
    }


def _job_changed() -> HTTPException:
    return _error(
        status.HTTP_409_CONFLICT,
        "job_changed",
        "This simulation changed while it was being cancelled. Reload it and try again.",
    )


# ---------------------------------------------------------------------------
# GET /jobs/{job_id}/logs
# ---------------------------------------------------------------------------


@router.get("/{job_id}/logs", response_model=JobLogsResponse)
async def get_job_logs(
    job_id: str,
    user: TokenPayload = Depends(require_permission(Permission.JOB_VIEW_OWN)),
):
    await _get_job_for(job_id, user, Permission.JOB_VIEW_ANY)

    try:
        stdout, stderr, truncated = await slurm.get_job_logs(job_id)
    except Exception as exc:
        logger.error("Log retrieval failed for %s: %s", job_id, exc)
        raise HTTPException(status_code=502, detail=str(exc))

    return JobLogsResponse(
        job_id=job_id,
        stdout=stdout,
        stderr=stderr,
        truncated=truncated,
    )
