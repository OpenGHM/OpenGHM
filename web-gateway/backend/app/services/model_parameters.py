"""A snapshot's model parameters: the tree resolved for its WBM version, and its init's values.

The one place both the endpoint (`GET /repository/datasets/{id}/model-parameters`) and the
draft routes (PATCH and submit validate `custom_params`) get them from, so they cannot read
a snapshot differently. The init is the text `run_start.read_init_text` keeps (a public S3
read, cached by snapshot id); `app.wbm_init` does the rest and touches no network.

The datasets of the snapshot's model input, which a module switched on is given its files from
(`choices`), are read separately: only a draft that touches a module the snapshot has off needs
them, so `load` does not wait for them. `read_choices` reads the model input's `datasets[]` and
each data init once (`app.wbm_init.model_input` keeps what it read), and says which the
snapshot's WBM version cannot read.
"""

from __future__ import annotations

import dataclasses
import logging
from dataclasses import dataclass

from app.services import job_script, run_start
from app.wbm_init import choices as choices_mod
from app.wbm_init import model_input, reader, tree

logger = logging.getLogger(__name__)


class Unavailable(Exception):
    """The parameters of a snapshot cannot be given. `code` is the API's reason code and
    `message` is meant for the person who asked."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Loaded:
    resolved: tree.Resolved
    #: The init as nested dicts of strings (`reader.read`).
    values: dict
    #: The datasets of the model input, once `with_choices` has read them; None when it has not,
    #: or when the model input could not be read (`choices_read` tells which).
    choices: choices_mod.Choices | None = None
    choices_read: bool = False

    @property
    def code_version(self) -> str:
        return self.resolved.version


def code_version_missing() -> Unavailable:
    return Unavailable(
        "model_code_version_missing",
        "This snapshot does not say which WBM version it runs (uses.modelCode.version), so "
        "its model parameters cannot be shown or changed.",
    )


async def load(snapshot: dict, snapshot_id: str) -> Loaded:
    """Raises `Unavailable`: `model_code_version_missing` for a snapshot with no WBM version
    or one the tree does not know, `init_unavailable` for an init that cannot be read."""
    version = job_script.model_code_version(snapshot)
    if version is None or version not in tree.code_versions():
        raise code_version_missing()
    text = await run_start.read_init_text(snapshot, snapshot_id)
    if text is None:
        raise Unavailable(
            "init_unavailable",
            "The snapshot's WBM init could not be read right now, so its model parameters "
            "cannot be shown or checked. Try again in a few minutes.",
        )
    try:
        values = reader.read(text)
    except reader.InitSyntaxError as exc:
        raise Unavailable("init_unavailable", f"The snapshot's WBM init could not be read: {exc}")
    return Loaded(tree.resolve(version), values)


def _unreadable_by(version: str, init: model_input.InitFile) -> tuple[str | None, str | None]:
    """`(reason, repair)` for the data init under WBM `version`. `reason` is why it cannot be used at
    all: it is no descriptor (no `Code_Name`). `repair` is what a copy of it fixes, when that is all that
    is wrong: on 23.9.0 a `Code_Name` that differs from its file name, or a non-ASCII byte, which WBM
    refuses (docs/reference/wbm-init.md section 8) and a fork rewrites (ADR 0039)."""
    if not init.get("Code_Name"):
        return "It has no Code_Name, so it is not a dataset.", None
    faults = []
    if version == "23.9.0":
        if init.get("Code_Name") != init.name:
            faults.append(f"its Code_Name ({init.get('Code_Name')}) differs from its file name")
        if not init.is_ascii:
            faults.append("it holds a character that is not ASCII")
    if faults:
        text = " and ".join(faults)
        return None, f"{text[0].upper()}{text[1:]}, which WBM 23.9.0 refuses. A copy made for the run repairs it."
    return None, None


async def read_choices(snapshot: dict, snapshot_id: str, version: str) -> choices_mod.Choices | None:
    """The datasets of the snapshot's model input, each with whether `version` can read it, or
    None when the model input could not be read. A snapshot that names no model input has none."""
    source = model_input.source_of(snapshot_id, snapshot)
    if source.model_input_id is None:
        return choices_mod.Choices()

    async def one(entry: dict) -> choices_mod.Candidate | None:
        relative = entry.get("init")
        if not isinstance(relative, str) or not relative:
            return None
        location = model_input.Location("model-inputs", source.model_input_id, relative)
        path = model_input.container_path(location)
        if path is None:
            return None
        code, unit = str(entry.get("code") or ""), str(entry.get("unit") or "")
        name = str(entry.get("name") or code or relative.rsplit("/", 1)[-1]).strip()
        series = str(entry.get("timeSeries") or "")
        repair = None
        try:
            init = await model_input.read_init(location)
        except model_input.NotFound:
            reason = "Its init file is not in the model input."
        except model_input.BadInit as exc:
            reason = f"Its init file cannot be read ({exc})."
        else:
            reason, repair = _unreadable_by(version, init)
            code = init.get("Code_Name") or code
            series = init.get("Time_Series") or series
            unit = init.get("Units") or unit
        return choices_mod.Candidate(path, code, name, series, unit, reason, repair)

    try:
        entries = await model_input.datasets(source.model_input_id)
        found = await model_input.gather(one(e) for e in entries)
    except model_input.ModelInputError as exc:
        logger.warning("Could not read the datasets of the model input of %s: %s", snapshot_id, exc)
        return None
    return choices_mod.Choices(tuple(c for c in found if c is not None))


async def with_choices(snapshot: dict, snapshot_id: str, loaded: Loaded) -> Loaded:
    """`loaded` with the datasets of its model input read (once: a `Loaded` that has them is
    returned as it is)."""
    if loaded.choices_read:
        return loaded
    found = await read_choices(snapshot, snapshot_id, loaded.code_version)
    return dataclasses.replace(loaded, choices=found, choices_read=True)
