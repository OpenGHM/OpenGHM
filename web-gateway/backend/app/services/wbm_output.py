"""A run's WBM output, read on Anvil by the pinned toolkit (ADR 0033).

The gateway holds no NetCDF reader and no copy of the output's layout: each call runs one
`openghm output ...` command on Anvil (`<ANVIL_OPENGHM_HOME>/bin/openghm output <inventory|subset> ...
--config <ANVIL_OPENGHM_HOME>/gateway.toml --json`, the paths a job uses) and passes its JSON on. The
shapes are the toolkit's (its README documents them; rule 4), so they are not restated here.

A **source** is either a draft's run, its work directory on scratch (`ANVIL_OUTPUT_BASE/<sim_id>`, ADR
0023), or a published snapshot, whose output the toolkit reads from the bucket (anonymous HTTPS from
Anvil). Who may read which is the routes' business (`app.api.v1.wbm_output`).

How the toolkit's answer maps to the response:

* 0: the JSON object it printed;
* 2 (a request the toolkit refuses: a missing year, a box with no cell, a call over its limits): 422
  `output_request_refused` with its message;
* 3 (no output at the source: not written yet, purged, never published): 404 `output_missing`;
* any other exit, or an answer that is not a JSON object: 502 `output_failed`;
* the gateway has no way to reach Anvil: 503 `anvil_not_configured`; Anvil did not answer: 503
  `anvil_unreachable`; more reads at once than a login node should be asked for: 503 `output_busy`.

**A download** (`prepare_download`, `stream_download`): the toolkit writes the `nc` subset to a file of
its own per request under `output_download_dir()` on Anvil (`<uuid>.nc`); the backend streams it back
over SFTP (`slurm.stream_remote_file`) and deletes it when the stream ends, whichever way it ends. A
file that is never streamed (a client that left before the first byte, a gateway that restarted) is
deleted by the sweep that runs, at most every ten minutes, before a download: anything there older than
a day.
"""

from __future__ import annotations

import asyncio
import json
import logging
import posixpath
import re
import shlex
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Literal

import anyio
from slurmly.exceptions import SlurmlyError

from app.core.config import settings
from app.services import job_script, slurm

logger = logging.getLogger(__name__)

#: How long one toolkit call may run on Anvil. The toolkit refuses a call that would read more than
#: about 30 s of data (its `limits.MAX_CELLS_READ`); these allow for opening files over HTTPS, a slow
#: login node and the SSH round trip. An inventory opens a handful of headers.
INVENTORY_TIMEOUT_SECONDS = 120
SUBSET_TIMEOUT_SECONDS = 180
#: How many toolkit reads run at once, and how long a request waits for a place before it is
#: answered 503 `output_busy`. The routes for a published snapshot are open to anyone, and each call
#: is a process on the shared login node.
MAX_CONCURRENT_READS = 3
BUSY_WAIT_SECONDS = 15
#: A download file older than this is deleted by the sweep; the sweep runs at most this often.
DOWNLOAD_MAX_AGE_MINUTES = 24 * 60
SWEEP_INTERVAL_SECONDS = 600
SWEEP_TIMEOUT_SECONDS = 60
#: Bytes per SFTP read of a download.
DOWNLOAD_CHUNK_BYTES = 1024 * 1024

_STDERR_TAIL_CHARS = 400
_NOT_CONFIGURED = "This gateway is not set up to run anything on Anvil yet."
_UNREACHABLE = "Anvil could not be reached. Try again in a few minutes."
_BUSY = "Anvil is busy reading other output. Try again in a minute."
_FILENAME_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


class WbmOutputError(Exception):
    """A refusal the route answers as `{"code", "message"}` with `http_status`."""

    def __init__(self, http_status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.http_status = http_status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class OutputSource:
    """Where the output is read: `kind` `run` (`ref` is the work directory on scratch) or `snapshot`
    (`ref` is the published snapshot's id)."""

    kind: Literal["run", "snapshot"]
    ref: str

    def toolkit_args(self) -> list[str]:
        return [self.ref] if self.kind == "run" else ["--snapshot", self.ref]

    @property
    def label(self) -> str:
        """A short name for a downloaded file: the simulation id, or the snapshot id's first 12 characters."""
        return posixpath.basename(self.ref) if self.kind == "run" else self.ref[:12]


def run_source(doc: dict) -> OutputSource:
    """The source of a job's run: `ANVIL_OUTPUT_BASE/<sim_id>`, as `submit_simulation` records it.
    A job that never ran has no `sim_id` (404 `output_missing`); one whose scratch directory Anvil
    purged (`files: purged`, ADR 0026) is 410 `output_purged`."""
    sim_id = doc.get("sim_id")
    if not job_script.is_valid_id(sim_id):
        raise WbmOutputError(404, "output_missing", "This snapshot draft has not run, so it has no output.")
    if doc.get("files") == "purged":
        raise WbmOutputError(
            410, "output_purged",
            "Anvil deletes a simulation's files 30 days after it ran, and this one's output is gone.",
        )
    return OutputSource("run", posixpath.join(settings.ANVIL_OUTPUT_BASE, sim_id))


def snapshot_source(snapshot_id: str) -> OutputSource:
    if not job_script.is_valid_id(snapshot_id):
        raise WbmOutputError(404, "output_missing", "No such snapshot.")
    return OutputSource("snapshot", snapshot_id)


def output_download_dir() -> str:
    """Where `nc` subsets are written on Anvil: `ANVIL_OUTPUT_DOWNLOAD_DIR`, else
    `<ANVIL_REMOTE_BASE_DIR>/output-downloads`. Absolute, or the gateway is not set up (503)."""
    path = settings.ANVIL_OUTPUT_DOWNLOAD_DIR or posixpath.join(slurm._resolve_remote_base_dir(), "output-downloads")
    if not path.startswith("/") or "{" in path:
        logger.error("the output download directory %r is not an absolute path", path)
        raise WbmOutputError(503, "anvil_not_configured", _NOT_CONFIGURED)
    return posixpath.normpath(path)


def _toolkit_command(*args: str) -> str:
    """`<home>/bin/openghm output <args> --config <home>/gateway.toml --json`, every word quoted."""
    if not slurm.toolkit_configured():
        raise WbmOutputError(503, "anvil_not_configured", _NOT_CONFIGURED)
    try:
        openghm, config = job_script.toolkit_paths(settings.ANVIL_OPENGHM_HOME)
    except job_script.SubmitInputError as exc:
        logger.error("ANVIL_OPENGHM_HOME is not usable: %s", exc)
        raise WbmOutputError(503, "anvil_not_configured", _NOT_CONFIGURED) from exc
    return " ".join(shlex.quote(word) for word in [openghm, "output", *args, "--config", config, "--json"])


_slots: dict[int, asyncio.Semaphore] = {}


@asynccontextmanager
async def _slot():
    """One of `MAX_CONCURRENT_READS` places for a toolkit read; 503 `output_busy` when none is free
    within `BUSY_WAIT_SECONDS`. One semaphore per event loop (a semaphore belongs to the loop that
    first waits on it)."""
    key = id(asyncio.get_running_loop())
    if key not in _slots:
        _slots[key] = asyncio.Semaphore(MAX_CONCURRENT_READS)
    sem = _slots[key]
    try:
        await asyncio.wait_for(sem.acquire(), BUSY_WAIT_SECONDS)
    except asyncio.TimeoutError as exc:
        raise WbmOutputError(503, "output_busy", _BUSY) from exc
    try:
        yield
    finally:
        sem.release()


def _message_of(stderr: str) -> str:
    """The toolkit's own message: its last `openghm: ...` line, else the tail of stderr."""
    lines = [ln.strip() for ln in (stderr or "").strip().splitlines() if ln.strip()]
    for line in reversed(lines):
        if line.startswith("openghm: "):
            return line[len("openghm: "):]
    return (stderr or "").strip()[-_STDERR_TAIL_CHARS:]


async def _run_json(command: str, *, operation: str, timeout: float) -> dict:
    """The JSON object the command printed (see the module docstring for what each failure is)."""
    async with _slot():
        try:
            result = await slurm.run_remote(command, operation=operation, retry_safe=True, timeout=timeout)
        except slurm.AnvilNotConfigured as exc:
            raise WbmOutputError(503, "anvil_not_configured", _NOT_CONFIGURED) from exc
        except (SlurmlyError, OSError, asyncio.TimeoutError) as exc:
            logger.warning("%s: Anvil unreachable: %s", operation, exc)
            raise WbmOutputError(503, "anvil_unreachable", _UNREACHABLE) from exc
    if result.exit_status == 2:
        raise WbmOutputError(422, "output_request_refused", _message_of(result.stderr) or "The request was refused.")
    if result.exit_status == 3:
        raise WbmOutputError(404, "output_missing", _message_of(result.stderr) or "There is no output here.")
    if result.exit_status != 0:
        tail = _message_of(result.stderr)
        logger.warning("%s exited %s: %s", operation, result.exit_status, tail)
        raise WbmOutputError(502, "output_failed", tail or f"The toolkit exited with status {result.exit_status}.")
    try:
        data = json.loads(result.stdout)
    except ValueError as exc:
        logger.warning("%s printed no JSON: %.200r", operation, result.stdout)
        raise WbmOutputError(502, "output_failed", "The toolkit's answer was not JSON.") from exc
    if not isinstance(data, dict):
        raise WbmOutputError(502, "output_failed", "The toolkit's answer was not a JSON object.")
    return data


def _opt(flag: str, value) -> list[str]:
    return [] if value is None or value is False else [flag] if value is True else [flag, str(value)]


async def inventory(source: OutputSource) -> dict:
    """`openghm output inventory` of the source."""
    command = _toolkit_command("inventory", *source.toolkit_args())
    return await _run_json(command, operation="output_inventory", timeout=INVENTORY_TIMEOUT_SECONDS)


async def map_image(
    source: OutputSource, *, variable: str, resolution: str, start: str, bbox: str | None,
    width: int | None, height: int | None,
) -> dict:
    """`openghm output subset --format png` without `--out`: the answer carries the PNG as `base64`
    beside the legend, range, units and box it was drawn for."""
    command = _toolkit_command(
        "subset", *source.toolkit_args(), "--var", variable, "--resolution", resolution, "--format", "png",
        "--start", start, *_opt("--bbox", bbox), *_opt("--width", width), *_opt("--height", height),
    )
    return await _run_json(command, operation="output_map", timeout=SUBSET_TIMEOUT_SECONDS)


async def series(
    source: OutputSource, *, variable: str, resolution: str, point: str, start: str | None,
    end: str | None, display: bool,
) -> dict:
    """`openghm output subset --format json`: the values of the cell nearest `point` over the period."""
    command = _toolkit_command(
        "subset", *source.toolkit_args(), "--var", variable, "--resolution", resolution, "--format", "json",
        "--point", point, *_opt("--start", start), *_opt("--end", end), *_opt("--display", display),
    )
    return await _run_json(command, operation="output_series", timeout=SUBSET_TIMEOUT_SECONDS)


@dataclass(frozen=True)
class Download:
    """A subset written on Anvil and waiting to be streamed: its path there, its size (the toolkit
    reports it, and the stream is checked against it) and the filename to offer."""

    path: str
    size: int
    filename: str


_last_sweep = 0.0


async def _sweep_old_downloads(directory: str) -> None:
    """Delete what a download left behind a day ago. Best effort: a failure is logged, not raised,
    and it runs at most every `SWEEP_INTERVAL_SECONDS`."""
    global _last_sweep
    now = time.monotonic()
    if _last_sweep and now - _last_sweep < SWEEP_INTERVAL_SECONDS:
        return
    _last_sweep = now
    command = (
        f"find {shlex.quote(directory)} -maxdepth 1 -type f \\( -name '*.nc' -o -name '*.nc.part' \\) "
        f"-mmin +{DOWNLOAD_MAX_AGE_MINUTES} -delete"
    )
    try:
        await slurm.run_remote(command, operation="output_download_sweep", retry_safe=True, timeout=SWEEP_TIMEOUT_SECONDS)
    except Exception as exc:  # noqa: BLE001 - housekeeping must not fail a download
        logger.warning("sweeping %s failed: %s", directory, exc)


async def _remove(path: str) -> None:
    """Delete a download file and its `.part`, shielded from a cancelled request and never raising."""
    with anyio.CancelScope(shield=True):
        for name in (path, path + ".part"):
            try:
                await slurm.remove_remote_file(name)
            except Exception as exc:  # noqa: BLE001
                logger.warning("could not remove %s: %s", name, exc)


def _filename(source: OutputSource, answer: dict) -> str:
    period = answer.get("period") or {}
    parts = [source.label, answer.get("variable"), answer.get("resolution"), period.get("first"), period.get("last")]
    name = "_".join(str(p) for p in parts if p)
    return _FILENAME_UNSAFE.sub("_", name).strip("_") + ".nc"


async def prepare_download(
    source: OutputSource, *, variable: str, resolution: str, start: str | None, end: str | None, bbox: str | None,
) -> Download:
    """Have the toolkit write the subset to a file of its own on Anvil. Whatever fails, nothing is left
    there: a refusal wrote nothing, and any other failure removes the path it was to write."""
    directory = output_download_dir()
    path = posixpath.join(directory, f"{uuid.uuid4().hex}.nc")
    command = _toolkit_command(
        "subset", *source.toolkit_args(), "--var", variable, "--resolution", resolution, "--format", "nc",
        *_opt("--start", start), *_opt("--end", end), *_opt("--bbox", bbox), "--out", path,
    )
    await _sweep_old_downloads(directory)
    try:
        answer = await _run_json(command, operation="output_subset", timeout=SUBSET_TIMEOUT_SECONDS)
        size = answer["bytes"]
        if not isinstance(size, int) or answer.get("path") != path:
            raise KeyError("bytes")
    except WbmOutputError as exc:
        if exc.code in ("output_failed", "anvil_unreachable"):   # the command may have started writing
            await _remove(path)
        raise
    except KeyError as exc:
        await _remove(path)
        raise WbmOutputError(502, "output_failed", "The toolkit's answer was not what this gateway expects.") from exc
    return Download(path=path, size=size, filename=_filename(source, answer))


async def stream_download(download: Download) -> AsyncIterator[bytes]:
    """The file's bytes, then the file deleted: when the stream ends, fails, or is cancelled. A file
    that is not `download.size` bytes long raises at the end (the response's Content-Length promised
    that many)."""
    sent = 0
    try:
        async for chunk in slurm.stream_remote_file(download.path, chunk_size=DOWNLOAD_CHUNK_BYTES):
            sent += len(chunk)
            yield chunk
        if sent != download.size:
            raise RuntimeError(f"{download.path} was {sent} bytes, not the {download.size} the toolkit wrote")
    finally:
        await _remove(download.path)
