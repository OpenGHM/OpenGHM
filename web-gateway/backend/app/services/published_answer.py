"""Whether a draft is already answered by its snapshot's published output, and
which published files answer it (mission 2026-10-05-a-published-draft-is-not-run,
ADR 0029, docs/architecture/simulation-reuse.md section 3).

A draft is answered when it asks for nothing the snapshot did not run: the
snapshot's own model input, spatial domain and parameters
(`job_script.unsupported_fields`), a period inside
`simulation.temporalCoverage`, variables among `simulation.outputVariables`, and no
climatology unless the snapshot's init asked for one (`climatology_not_published`;
a draft asking for `"standard"` is answered by a climatology snapshot, whose daily,
monthly and yearly files are a subset of what it published).
Otherwise it comes back with one reason for each way it differs, so the Review
step can say which change makes a run necessary. A draft that names no variable
asks for every published one.

The files come from the public bucket, as the backend has no S3 credentials
(gateway.md section 5): an anonymous `ListObjectsV2` of
`<S3_PUBLIC_BASE_URL>/<S3_BUCKET>?list-type=2&prefix=snapshots/<id>/wbm_output/`,
followed page by page. Published output is immutable by snapshot id, so a
listing is kept for the life of the process, except one with no object in it
(nothing is known yet). Output published again in development is not seen
until the process restarts.

The layout read is `<run>/daily/wbm_<year>.nc` for each year, and
`<run>/{monthly,yearly}/<variable>/wbm_<year>.nc` for each variable and year
(docs/reference/snapshot-layout.md). `<run>` is the one folder under
`wbm_output/` that holds daily files; its name is the run's, not the init's
(`WBM_test` for `wbm_test.init`). With more than one, the one named like the
init wins, else the first by name. Every asked year must have its daily file; a
monthly or yearly file a variable lacks is left out. A draft whose output does
not look like that is not answered (`published_output_missing`) rather than
answered with nothing to open.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date
from posixpath import basename, splitext
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.models.job import JobParameters
from app.models.repository import (
    PublishedAnswerReason,
    PublishedAnswerResponse,
    PublishedFile,
    PublishedPeriod,
    s3_url,
)
from app.services import job_script, run_start

logger = logging.getLogger(__name__)

_LIST_TIMEOUT = 10.0
_YEAR_FILE_RE = re.compile(r"^wbm_(\d{4})\.nc$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# `job_script.unsupported_fields` names fields; the page switches on codes.
_UNSUPPORTED_REASONS = {
    "model_input_id": (
        "model_input_override",
        "A different model input than the snapshot's own needs a new simulation.",
    ),
    "parameters.spatial_domain": (
        "spatial_domain",
        "A spatial domain other than the snapshot's own needs a new simulation.",
    ),
    "parameters.custom_params": (
        "custom_params",
        "Custom parameters change the model, so they need a new simulation.",
    ),
}


class ListingUnavailable(Exception):
    """The public bucket could not be listed: network, HTTP status or XML."""


class InvalidPeriod(ValueError):
    """The draft's period is not two real dates in order."""


@dataclass(frozen=True)
class ListedObject:
    key: str
    size: int


#: snapshot id -> its `wbm_output/` objects. Only non-empty, successful reads.
_listings: dict[str, tuple[ListedObject, ...]] = {}


def reset() -> None:
    """Forget what was listed (tests)."""
    _listings.clear()


def output_prefix(snapshot_id: str) -> str:
    return f"snapshots/{snapshot_id}/wbm_output/"


def _parse_page(xml: str) -> tuple[list[ListedObject], str | None]:
    """One `ListObjectsV2` page: its objects, and the token of the next page
    when it was truncated."""
    root = ET.fromstring(xml)
    objects = [
        ListedObject(
            key=item.findtext("{*}Key") or "", size=int(item.findtext("{*}Size") or 0)
        )
        for item in root.iterfind("{*}Contents")
    ]
    if root.findtext("{*}IsTruncated") == "true":
        token = root.findtext("{*}NextContinuationToken")
        if not token:
            raise ValueError("truncated listing without a continuation token")
        return objects, token
    return objects, None


async def _fetch_page(
    client: httpx.AsyncClient, prefix: str, token: str | None
) -> str:
    params = {"list-type": "2", "prefix": prefix}
    if token:
        params["continuation-token"] = token
    url = f"{settings.S3_PUBLIC_BASE_URL.rstrip('/')}/{settings.S3_BUCKET}"
    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.text


async def list_output(snapshot_id: str) -> tuple[ListedObject, ...]:
    """Every object under the snapshot's `wbm_output/`. Raises
    `ListingUnavailable` when the bucket cannot be read."""
    if snapshot_id in _listings:
        return _listings[snapshot_id]
    prefix = output_prefix(snapshot_id)
    objects: list[ListedObject] = []
    try:
        async with httpx.AsyncClient(
            timeout=_LIST_TIMEOUT, follow_redirects=True
        ) as client:
            token = None
            while True:
                page, token = _parse_page(await _fetch_page(client, prefix, token))
                objects.extend(page)
                if token is None:
                    break
    except Exception as exc:  # network, HTTP status, XML: all mean "could not list"
        logger.warning("Could not list %s: %s", prefix, exc)
        raise ListingUnavailable(str(exc)) from exc
    if objects:
        _listings[snapshot_id] = tuple(objects)
    return tuple(objects)


def _parse_date(kind: str, value: str) -> date:
    try:
        if not isinstance(value, str) or not _DATE_RE.match(value):
            raise ValueError(value)
        return date.fromisoformat(value)
    except ValueError:
        raise InvalidPeriod(f"The {kind} {value!r} is not a date like 2000-01-31.")


def _reasons(
    parameters: JobParameters,
    model_input_id: str | None,
    snapshot: dict,
    own_post_processing: str | None = None,
) -> list[PublishedAnswerReason]:
    """Every way the draft differs from the snapshot, without any network.
    `own_post_processing` is what the snapshot's init asks of post-processing
    (`run_start.InitRules.post_processing`), or None when it could not be read."""
    reasons = [
        PublishedAnswerReason(code=code, message=message)
        for code, message in (
            _UNSUPPORTED_REASONS[field]
            for field in job_script.unsupported_fields(
                parameters, model_input_id, snapshot
            )
        )
    ]
    simulation = snapshot.get("simulation") or {}
    coverage = simulation.get("temporalCoverage") or {}
    start = _parse_date("period start", parameters.temporal_range_start)
    end = _parse_date("period end", parameters.temporal_range_end)
    if start > end:
        raise InvalidPeriod("The period start must not be after the period end.")
    published_start = coverage.get("start")
    published_end = coverage.get("end")
    if published_start and start < date.fromisoformat(published_start):
        reasons.append(
            PublishedAnswerReason(
                code="period_before_published_start",
                message=f"The published simulation starts on {published_start}; "
                "an earlier start needs a new simulation.",
            )
        )
    if published_end and end > date.fromisoformat(published_end):
        reasons.append(
            PublishedAnswerReason(
                code="period_after_published_end",
                message=f"The published simulation ends on {published_end}; "
                "a later end needs a new simulation.",
            )
        )
    published = [v["name"] for v in simulation.get("outputVariables") or []]
    missing = [v for v in parameters.variables if v not in published]
    if missing:
        reasons.append(
            PublishedAnswerReason(
                code="variables_not_published",
                message=f"The published simulation does not hold {', '.join(missing)}; "
                "a variable it does not hold needs a new simulation.",
            )
        )
    if parameters.post_processing == "climatology" and own_post_processing != "climatology":
        reasons.append(
            PublishedAnswerReason(
                code="climatology_not_published",
                message="The published simulation has no climatology; "
                "asking for it needs a new simulation.",
            )
        )
    return reasons


def _pick_run(objects: tuple[ListedObject, ...], prefix: str, init: str | None) -> str | None:
    """The run folder under `wbm_output/` that holds daily files (see the
    module docstring for how a tie is broken)."""
    runs = sorted(
        {
            parts[0]
            for o in objects
            if o.key.startswith(prefix)
            and len(parts := o.key[len(prefix):].split("/")) == 3
            and parts[1] == "daily"
            and _YEAR_FILE_RE.match(parts[2])
        }
    )
    if len(runs) > 1 and init:
        stem = splitext(basename(init))[0].lower()
        named = [r for r in runs if r.lower() == stem]
        if named:
            return named[0]
    return runs[0] if runs else None


def _select(
    objects: tuple[ListedObject, ...],
    snapshot_id: str,
    init: str | None,
    years: list[int],
    variables: list[str],
) -> tuple[str | None, list[PublishedFile]]:
    """The run and the files that answer `years` and `variables`; no files when
    an asked year has no daily file."""
    prefix = output_prefix(snapshot_id)
    run = _pick_run(objects, prefix, init)
    if run is None:
        return None, []
    sizes = {o.key: o.size for o in objects}
    base = f"{prefix}{run}/"

    def file(group: str, variable: str | None, year: int) -> PublishedFile | None:
        folder = group if variable is None else f"{group}/{variable}"
        key = f"{base}{folder}/wbm_{year}.nc"
        if key not in sizes:
            return None
        return PublishedFile(
            group=group,
            variable=variable,
            year=year,
            key=key,
            url=s3_url(settings.S3_PUBLIC_BASE_URL, settings.S3_BUCKET, quote(key)),
            size=sizes[key],
        )

    daily = [file("daily", None, y) for y in years]
    if not all(daily):
        return run, []
    files: list[PublishedFile] = list(filter(None, daily))
    for group in ("monthly", "yearly"):
        for variable in variables:
            files += filter(None, (file(group, variable, y) for y in years))
    return run, files


async def answer(
    snapshot_id: str,
    snapshot: dict,
    parameters: JobParameters,
    model_input_id: str | None,
) -> PublishedAnswerResponse:
    """`snapshot` is the catalogue document. Raises `InvalidPeriod` for a
    period that is not two real dates in order, and `ListingUnavailable` when
    the draft differs from nothing and the bucket cannot be listed (a draft
    that differs needs no listing)."""
    simulation = snapshot.get("simulation") or {}
    coverage = simulation.get("temporalCoverage") or {}
    period = (
        PublishedPeriod(start=coverage["start"], end=coverage["end"])
        if coverage.get("start") and coverage.get("end")
        else None
    )
    # Read only when the draft asks for climatology: a published simulation's output
    # holds daily, monthly and yearly files, which answer "standard" and the snapshot's
    # own. An init that cannot be read counts as one without climatology: answering a
    # draft that asks for it from output that may have none would be the wrong error.
    own = None
    if parameters.post_processing == "climatology":
        rules = await run_start.read_init_rules(snapshot, snapshot_id)
        own = rules.post_processing if rules else None
    reasons = _reasons(parameters, model_input_id, snapshot, own)
    run = None
    files: list[PublishedFile] = []
    if not reasons:
        years = list(
            range(
                date.fromisoformat(parameters.temporal_range_start).year,
                date.fromisoformat(parameters.temporal_range_end).year + 1,
            )
        )
        variables = parameters.variables or [
            v["name"] for v in simulation.get("outputVariables") or []
        ]
        run, files = _select(
            await list_output(snapshot_id),
            snapshot_id,
            simulation.get("init"),
            years,
            variables,
        )
        if not files:
            reasons.append(
                PublishedAnswerReason(
                    code="published_output_missing",
                    message="The published output has no file for every year asked, "
                    "so it cannot answer this draft.",
                )
            )
    return PublishedAnswerResponse(
        answered=not reasons,
        reasons=reasons,
        period=period,
        run_id=run,
        files=files,
    )
