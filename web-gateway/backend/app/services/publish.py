"""Publishing a snapshot draft as a snapshot (ADR 0031), the parts that need no
Mongo and no SSH: the document, the job script and the verdict.

A completed draft is published by a SLURM job on Anvil that runs `openghm
snapshot publish`, under an id the gateway minted and stored first. What this
module holds, every one pure (dicts and strings in, a value out), so each is
tested directly:

- `compose_metadata`: the new snapshot's `metadata.json`, from the base
  snapshot's catalogue document, the draft, what its owner wrote in `about`, the
  id and the time. It is checked against the generated
  `OpenGHMSnapshotMetadata` before it is returned.
- `render_publish_body`: the job's bash body. Its EXIT trap writes
  `publish-outcome.json` into slurmly's job directory, the toolkit's exit code
  and the end of its stderr; its schema is `OUTCOME_PY`'s.
- `classify_publish`: the one place a publish's cause is named, from SLURM's
  state and that record (the toolkit's exit codes are in its README, "Publishing
  a run"). The sweep that reads them is `app.services.slurm.sync_publishes`.
- `publish_refusal`: why a draft cannot be published, if it cannot.
"""

from __future__ import annotations

import copy
import json
import posixpath
import re
import secrets
import shlex
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import ValidationError

from app.models.generated.snapshot import OpenGHMSnapshotMetadata
from app.models.job import (
    GATEWAY_SET_ABOUT_FIELDS,
    PublishAbout,
    PublishFailure,
    PublishFailureCause,
    PublishRetry,
    real_time,
)
from app.services import job_script
from app.services.job_verdict import slurm_state_head

#: The record the publish job leaves in slurmly's job directory, which the
#: sweep reads (`slurm.read_outcome`).
OUTCOME_NAME = "publish-outcome.json"
#: Where the job's `--metadata` file is written, in the run's slurmly directory.
METADATA_NAME = "publish-metadata.json"

_SNAPSHOT_ID_RE = re.compile(r"^[0-9a-f]{64}$")
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]*$")
# The longest slug made of a name. A slug is a label, not a key (ADR 0014).
_SLUG_MAX = 100


class ComposeError(ValueError):
    """What a person gave, or what the base snapshot holds, does not make a
    document the spec accepts. `errors` is `[{"field", "message"}, ...]`, the
    field a dotted path from the document's root (`about.creator.0.email`)."""

    def __init__(self, errors: list[dict[str, str]]):
        super().__init__("; ".join(f"{e['field']}: {e['message']}" for e in errors))
        self.errors = errors


def mint_snapshot_id() -> str:
    """256 random bits as lowercase hex (ADR 0014)."""
    return secrets.token_hex(32)


# ---------------------------------------------------------------------------
# Compose
# ---------------------------------------------------------------------------


def slugify(name: str, snapshot_id: str) -> str:
    """A slug (`^[a-z0-9][a-z0-9_.-]*$`) for `name`: ASCII letters and digits
    lower-cased, every other run of characters one `-`, no separator at either
    end. A name with nothing in it that survives gets `snapshot-<8 of the id>`.
    A slug is a human label and not a key (ADR 0014), so two snapshots may share
    one."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9_.-]+", "-", ascii_name.lower())
    slug = re.sub(r"-{2,}", "-", slug).strip("-_.")[:_SLUG_MAX].rstrip("-_.")
    return slug if _SLUG_RE.match(slug) else f"snapshot-{snapshot_id[:8]}"


def canonical_url(site_url: str, snapshot_id: str) -> str:
    """The snapshot's `about.url`, built from its id and never from its slug."""
    return f"{site_url.rstrip('/')}/snapshots/{snapshot_id}"


def _errors(exc: ValidationError, *, prefix: str = "") -> list[dict[str, str]]:
    return [
        {"field": prefix + ".".join(str(part) for part in err["loc"]), "message": err["msg"]}
        for err in exc.errors()
    ]


def validate_about(raw: dict[str, Any]) -> dict[str, Any]:
    """What a person wrote, checked against the spec's `about` fields they write
    (`PublishAbout`) and returned as JSON-ready data without the empty ones.
    The fields the gateway sets itself (`datePublished`, `url`, `isBasedOn`) are
    dropped from the input: what a person sent for them is never used. Raises
    `ComposeError` with the fields as `about.<path>`."""
    given = {k: v for k, v in raw.items() if k not in GATEWAY_SET_ABOUT_FIELDS}
    try:
        about = PublishAbout.model_validate(given)
    except ValidationError as exc:
        raise ComposeError(_errors(exc, prefix="about.")) from exc
    return about.model_dump(mode="json", exclude_none=True)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _execution(job: dict, cores: int | None) -> dict[str, Any]:
    """`runtime.execution` from the job's own SLURM record: what it asked for
    (`cores`) and what SLURM says it did (`startedAt`, `finishedAt`, the time
    between them, `slurmJobId`). A fact the job's record does not have is
    `unknown`, which the spec allows in exactly these fields."""
    started = real_time(job.get("slurm_start")) or real_time(job.get("started_at"))
    finished = real_time(job.get("slurm_end")) or real_time(job.get("completed_at"))
    elapsed = (
        job_script.format_slurm_time(max(0, int((finished - started).total_seconds())))
        if started and finished
        else "unknown"
    )
    slurm_id = str(job.get("slurm_job_id") or "")
    return {
        "cluster": "anvil",
        "cores": cores or "unknown",
        "elapsedWalltime": elapsed,
        "startedAt": _iso(started) if started else "unknown",
        "finishedAt": _iso(finished) if finished else "unknown",
        "slurmJobId": slurm_id if slurm_id.isdigit() else "unknown",
    }


def compose_metadata(
    *,
    base: dict,
    job: dict,
    about: dict[str, Any],
    snapshot_id: str,
    now: datetime,
    site_url: str,
    cores: int | None,
) -> dict:
    """The new snapshot's `metadata.json`, as a plain dict.

    - the base snapshot's catalogue document (`base`) with `id` the new one and
      `slug` made from `about.name`;
    - `about`: what the person wrote (`validate_about`), plus the three fields
      the gateway sets: `datePublished` (today, UTC), `url` (from the id) and
      `isBasedOn` (the base snapshot, by id);
    - `simulation`: the base's, except what the draft changed: the period
      (`temporalCoverage`) and `outputVariables`, each the base's own entry of a
      variable the draft asks for. `recommendedCompute` stays the base's;
    - `runtime`: generated now, its `execution` from the job (`_execution`).
      `cores` is what the job asked SLURM for (`slurm.resolve_compute`), or
      None when that cannot be told;
    - `uses`: the base's.

    Raises `ComposeError` for an `about` that fails the spec, a variable the base
    has no description of, or a result the generated `OpenGHMSnapshotMetadata`
    does not accept: nothing is stored on that, and no id is spent.
    """
    document = copy.deepcopy(base)
    validated = validate_about(about)

    simulation = document.get("simulation") or {}
    parameters = job.get("parameters") or {}
    described = {v.get("name"): v for v in simulation.get("outputVariables") or []}
    asked = list(dict.fromkeys(parameters.get("variables") or []))
    unknown = [name for name in asked if name not in described]
    if unknown:
        raise ComposeError(
            [
                {
                    "field": "simulation.outputVariables",
                    "message": f"The base snapshot has no description of {', '.join(unknown)}, "
                    "so it cannot be published as an output variable.",
                }
            ]
        )
    simulation["temporalCoverage"] = {
        "start": parameters.get("temporal_range_start"),
        "end": parameters.get("temporal_range_end"),
    }
    simulation["outputVariables"] = [copy.deepcopy(described[name]) for name in asked]

    document["id"] = snapshot_id
    document["slug"] = slugify(validated.get("name", ""), snapshot_id)
    document["about"] = {
        key: value
        for key, value in (
            ("name", validated.get("name")),
            ("description", validated.get("description")),
            ("datePublished", now.astimezone(timezone.utc).date().isoformat()),
            ("tags", validated.get("tags")),
            ("creator", validated.get("creator")),
            ("license", validated.get("license")),
            ("keywords", validated.get("keywords")),
            ("url", canonical_url(site_url, snapshot_id)),
            ("relatedLink", validated.get("relatedLink")),
            ("isBasedOn", [{"kind": "snapshot", "id": job["dataset_id"]}]),
        )
        if value is not None
    }
    document["simulation"] = simulation
    document["runtime"] = {"generatedAt": _iso(now), "execution": _execution(job, cores)}

    try:
        OpenGHMSnapshotMetadata.model_validate(document)
    except ValidationError as exc:
        raise ComposeError(_errors(exc)) from exc
    return document


def metadata_text(metadata: dict) -> str:
    """The bytes written to the job's `--metadata` file. The same dict always
    gives the same text, which is what a retry that reuses the stored document
    relies on."""
    return json.dumps(metadata, indent=2) + "\n"


# ---------------------------------------------------------------------------
# Whether a draft can be published
# ---------------------------------------------------------------------------

PublishRefusal = Literal[
    "not_completed",
    "run_failed",
    "answered_by_published",
    "publishing",
    "already_published",
]

#: The sentence for each reason a draft cannot be published, which the route
#: answers 409 `not_publishable` with.
REFUSAL_MESSAGE: dict[str, str] = {
    "not_completed": "Only a snapshot draft whose simulation has completed can be published as a snapshot.",
    "run_failed": "This snapshot draft's simulation did not succeed, so there is no output to publish.",
    "answered_by_published": (
        "The snapshot this draft is based on already holds this draft's results, so there is "
        "nothing new to publish."
    ),
    "publishing": "This snapshot draft is being published right now.",
    "already_published": "This snapshot draft has already been published as a snapshot.",
}


def publish_refusal(doc: dict) -> PublishRefusal | None:
    """Why `doc` (a job document) cannot be published, or None when it can.
    Publishable means: status `COMPLETED`, no `failure`, not a draft a published
    snapshot answered, and no `publish` or one that `failed`.

    A draft a published snapshot answers is never run (ADR 0029), so it stays a
    DRAFT, and the submit that refused it left `last_submit_error.code ==
    "answered_by_published"` on it: that is how it is marked, and it is checked
    first so such a draft says why and not only that it is a draft. A rerun that
    completed (`rerun: true`) carries no such mark: it ran, and it is publishable.
    """
    if (doc.get("last_submit_error") or {}).get("code") == "answered_by_published":
        return "answered_by_published"
    if doc.get("status") in ("FAILED", "CANCELLED") or doc.get("failure"):
        return "run_failed"
    if doc.get("status") != "COMPLETED":
        return "not_completed"
    state = (doc.get("publish") or {}).get("state")
    if state == "publishing":
        return "publishing"
    if state == "published":
        return "already_published"
    return None


# ---------------------------------------------------------------------------
# The job's body
# ---------------------------------------------------------------------------

#: The program the EXIT trap feeds to the toolkit venv's Python, as a quoted
#: heredoc (Python 3.9 on Anvil: stdlib only, no `X | Y` annotations). Its inputs
#: are environment variables the body exports (`OG_*`), never interpolated text.
#: The record it writes, which only the backend reads (`classify_publish`)::
#:
#:     {
#:       "schema": 1,
#:       "snapshot_id": "<64 hex>", "toolkit_commit": "...", "host": "...",
#:       "slurm_job_id": "... or null",
#:       "started_at": "ISO-8601 UTC", "ended_at": "ISO-8601 UTC",
#:       "signal": "TERM" | "INT" | "HUP" | null,
#:       "exit_code": 0..255 | null,      # `openghm snapshot publish`'s; null when it was interrupted
#:       "stderr_tail": ["last 40 lines of its stderr, each cut at 500", "..."]
#:     }
_OUTCOME_PY = r'''import json, os, socket, sys, tempfile
from collections import deque
from datetime import datetime, timezone

E = os.environ

tail = deque(maxlen=40)
try:
    with open(E["OG_STDERR"], errors="replace") as f:
        for line in f:
            tail.append(line.rstrip("\n")[:500])
except OSError:
    pass

rc = E.get("OG_RC", "")
record = {
    "schema": 1,
    "snapshot_id": E["OG_SNAPSHOT_ID"],
    "toolkit_commit": E["OG_COMMIT"],
    "host": socket.gethostname(),
    "slurm_job_id": E.get("SLURM_JOB_ID") or None,
    "started_at": E["OG_STARTED"],
    "ended_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "signal": E.get("OG_SIGNAL") or None,
    "exit_code": int(rc) if rc.isdigit() else None,
    "stderr_tail": list(tail),
}
dest = E.get("SLURM_SUBMIT_DIR") or os.getcwd()
fd, tmp = tempfile.mkstemp(dir=dest, prefix=".publish-outcome.", suffix=".tmp")
with os.fdopen(fd, "w") as f:
    json.dump(record, f)
    f.flush()
    os.fsync(f.fileno())
os.replace(tmp, os.path.join(dest, "publish-outcome.json"))
print("publish outcome: exit " + (rc or "none"))
'''

# The EXIT trap. `$?` is read first. The record holds the toolkit's own exit
# code (`OG_RC`, empty until it returns: a TERM, INT or HUP trap runs once the
# foreground command is gone and leaves it empty, so the record says the
# publish was interrupted, not that it exited 0). The script then ends with that
# code, so SLURM's own exit code reads the same as the record. A record that
# could not be written is not a success, whatever the toolkit said.
_FINISH = """\
finish() {
  local status=$?
  set +e
  trap - EXIT
  if [ -s "$OG_STDERR" ]; then cat "$OG_STDERR" >&2; fi
  "$PY" - <<'PYEOF'
""" + _OUTCOME_PY + """PYEOF
  local verdict=$?
  if [ "$verdict" -ne 0 ]; then
    echo "openghm: publish-outcome.json was not written" >&2
  fi
  local code=$status
  if [ -n "$OG_RC" ]; then code=$OG_RC; fi
  if [ "$code" -ne 0 ]; then exit "$code"; fi
  if [ "$verdict" -ne 0 ]; then exit 4; fi
  exit 0
}"""


def _check_s3cfg(value: str) -> str:
    """An s3cmd config path as the toolkit takes it: absolute, or `~/` (which
    the toolkit expands on Anvil, as the job's user)."""
    if (
        not isinstance(value, str)
        or not (value.startswith("/") or value.startswith("~/"))
        or "\x00" in value
        or "\n" in value
    ):
        raise job_script.SubmitInputError(f"ANVIL_S3CFG must be an absolute path or ~/... (got {value!r})")
    return value


def render_publish_body(
    *,
    snapshot_id: str,
    openghm_home: str,
    work_dir: str,
    metadata_path: str,
    s3cfg: str,
) -> str:
    """The publish job's bash body: `openghm snapshot publish <work_dir>
    --metadata <metadata_path> --id <snapshot_id> --s3cfg <s3cfg>`, then the EXIT
    trap's record (`OUTCOME_PY`). `work_dir` is the draft's run directory, the
    one `sim run` wrote. Raises `SubmitInputError` for an id or path that is not
    safe to render: every value is checked and `shlex.quote`d.

    The toolkit's stderr goes to a file in slurmly's job directory so the trap can
    read its end; the trap prints it to the job's stderr afterwards. The body
    does not stop at a failing command (`set +e`, slurmly's header sets `-e`): the
    trap records the toolkit's code in every case.
    """
    if not _SNAPSHOT_ID_RE.match(snapshot_id or ""):
        raise job_script.SubmitInputError(f"snapshot id {snapshot_id!r} is not 64 lowercase hex")
    home = job_script._check_abs_path("ANVIL_OPENGHM_HOME", openghm_home)
    openghm, _ = job_script.toolkit_paths(home)
    commit = job_script.toolkit_commit(home)
    work = job_script._check_abs_path("work directory", work_dir)
    metadata = job_script._check_abs_path("metadata file", metadata_path)
    for kind, path in (("work directory", work), ("metadata file", metadata)):
        if ".." in path.split("/"):
            raise job_script.SubmitInputError(f"The {kind} must not contain '..' (got {path!r})")
    cfg = _check_s3cfg(s3cfg)

    return "\n".join(
        [
            "set +e",
            f"OPENGHM={shlex.quote(openghm)}",
            f"PY={shlex.quote(home + '/venv/bin/python')}",
            f"export OG_SNAPSHOT_ID={snapshot_id} OG_COMMIT={commit}",
            "OG_STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
            "OG_RC= OG_SIGNAL=",
            'OG_STDERR="${SLURM_SUBMIT_DIR:-$PWD}/publish-stderr.log"',
            "export OG_STARTED OG_RC OG_SIGNAL OG_STDERR",
            _FINISH,
            "trap finish EXIT",
            "trap 'OG_SIGNAL=TERM; exit 143' TERM",
            "trap 'OG_SIGNAL=INT; exit 130' INT",
            "trap 'OG_SIGNAL=HUP; exit 129' HUP",
            ': > "$OG_STDERR"',
            f'echo "openghm $("$OPENGHM" --version) commit {commit}"',
            f'"$OPENGHM" snapshot publish {shlex.quote(work)} --metadata {shlex.quote(metadata)} '
            f'--id {snapshot_id} --s3cfg {shlex.quote(cfg)} 2>"$OG_STDERR"',
            "OG_RC=$?",
        ]
    )


def metadata_path_of(remote_job_dir: str) -> str:
    """Where the run's slurmly directory holds the publish's `--metadata` file."""
    return posixpath.join(remote_job_dir, METADATA_NAME)


# ---------------------------------------------------------------------------
# The verdict
# ---------------------------------------------------------------------------

# What each exit code of `openghm snapshot publish` means for the owner, from
# the toolkit's own table. `edit`: nothing was written for the document that was
# refused, so a new `about` may be composed (the toolkit checks before it
# writes). `none`: another try with the same bytes fails the same way until an
# administrator has changed something. `same`: a retry resumes where this one
# stopped (the toolkit reads each key before it writes it).
_BY_EXIT: dict[int, tuple[PublishFailureCause, PublishRetry]] = {
    2: ("publish_bad_input", "edit"),
    3: ("publish_output_incomplete", "none"),
    4: ("publish_conflict", "none"),
    5: ("publish_setup", "none"),
    6: ("publish_upload_failed", "same"),
    7: ("publish_verify_failed", "same"),
}

#: A sentence its owner can act on, per cause. The toolkit's stderr is logged
#: by the sweep and never put in one.
MESSAGE: dict[str, str] = {
    "publish_bad_input": (
        "Anvil's check refused this snapshot's description or this simulation's files, so "
        "nothing was published. Check the description and publish again; if it keeps "
        "failing, tell an administrator."
    ),
    "publish_output_incomplete": (
        "This simulation's output is incomplete or does not match what the snapshot draft "
        "asked for, so it cannot be published and nothing was uploaded. Tell an "
        "administrator this snapshot draft's ID."
    ),
    "publish_conflict": (
        "A file this snapshot would be stored as already exists with different contents, so "
        "the publish stopped without replacing anything. An administrator has to look at it."
    ),
    "publish_setup": (
        "Anvil is not set up to publish: the gateway's storage credentials or the s3cmd "
        "tool are missing. An administrator has to fix this before it can be tried again."
    ),
    "publish_upload_failed": (
        "An upload to the repository's storage failed part way. What was already uploaded "
        "is kept: try again and it continues where it stopped."
    ),
    "publish_verify_failed": (
        "The snapshot was uploaded, but the check afterwards found a file that is missing, "
        "not public or the wrong size. Try again: it checks the files and finishes the upload."
    ),
    "publish_job_failed": (
        "The publish job ended without reporting a result. Try again: it continues where it "
        "stopped."
    ),
    "publish_submit_interrupted": (
        "The publish was interrupted before the gateway learned what Anvil answered. Try "
        "again: if a job did start, it is harmless, and the new one continues where it stopped."
    ),
    "anvil_not_configured": (
        "This gateway is not set up to run jobs on Anvil yet. Ask an administrator. "
        "Nothing was published."
    ),
    "anvil_unreachable": "Anvil could not be reached, so nothing was published. Try again in a few minutes.",
    "internal_error": (
        "The publish failed unexpectedly. Try again, and if it keeps failing, tell an "
        "administrator."
    ),
}
_TIMED_OUT = (
    "The publish ran out of time before it finished. What was already uploaded is kept: try "
    "again and it continues where it stopped."
)
_CANCELLED = (
    "The publish job was cancelled on Anvil, not from OpenGHM. What was already uploaded is "
    "kept: try again and it continues where it stopped."
)

# SLURM states that mean the job did not exit by itself: whatever its record
# says is not the result of a publish that ran to its end.
_KILLED = {"CANCELLED", "TIMEOUT", "OUT_OF_MEMORY", "NODE_FAIL", "BOOT_FAIL", "PREEMPTED", "DEADLINE", "REVOKED"}
_EXITED = {"COMPLETED", "FAILED", "SPECIAL_EXIT", ""}


@dataclass(frozen=True)
class PublishVerdict:
    """`published`, or `failed` with its `PublishFailure`."""

    state: Literal["published", "failed"]
    failure: PublishFailure | None = None


def failure(cause: PublishFailureCause, retry: PublishRetry, message: str | None = None, **extra) -> PublishFailure:
    """A `PublishFailure` whose message is the cause's own, unless one is given."""
    return PublishFailure(cause=cause, message=message or MESSAGE[cause], retry=retry, **extra)


def exit_code_of(outcome: dict | None, snapshot_id: str) -> int | None:
    """The toolkit's exit code in the job's record, or None when there is no
    usable one: no record, a record of the wrong shape, one for another
    snapshot, an interrupted publish (`exit_code` null, a `signal`)."""
    if not isinstance(outcome, dict) or outcome.get("snapshot_id") != snapshot_id:
        return None
    code = outcome.get("exit_code")
    if isinstance(code, bool) or not isinstance(code, int) or outcome.get("signal"):
        return None
    return code


def classify_publish(*, slurm_state: str | None, outcome: dict | None, snapshot_id: str) -> PublishVerdict:
    """The one place a publish's cause is named. `slurm_state` is SLURM's raw
    state, or None for a job it has forgotten; `outcome` is `publish-outcome.json`
    as read, or None.

    SLURM's own kills come first (`TIMEOUT`, `CANCELLED`, `NODE_FAIL` and kin: the
    script did not end by itself), then the record's exit code: 0 is `published`,
    2 to 7 are the toolkit's own refusals (`_BY_EXIT`). No record, a record
    without a code and any other code are `publish_job_failed`, `retry: "same"`.
    Total: it never raises.
    """
    head = slurm_state_head(slurm_state)
    if head in _KILLED:
        message = _TIMED_OUT if head == "TIMEOUT" else _CANCELLED if head == "CANCELLED" else None
        return PublishVerdict("failed", failure("publish_job_failed", "same", message))
    code = exit_code_of(outcome, snapshot_id) if head in _EXITED else None
    if code == 0:
        return PublishVerdict("published")
    if code in _BY_EXIT:
        cause, retry = _BY_EXIT[code]
        return PublishVerdict("failed", failure(cause, retry, exit_code=code))
    return PublishVerdict("failed", failure("publish_job_failed", "same", exit_code=code))


def stderr_tail_of(outcome: dict | None) -> str:
    """The end of the toolkit's stderr in the job's record, for the log (never
    for a message)."""
    lines = outcome.get("stderr_tail") if isinstance(outcome, dict) else None
    return "\n".join(str(line) for line in lines) if isinstance(lines, list) else ""
