"""A snapshot's model parameters: the tree resolved for its WBM version, and its init's values.

The one place both the endpoint (`GET /repository/datasets/{id}/model-parameters`) and the
draft routes (PATCH and submit validate `custom_params`) get them from, so they cannot read
a snapshot differently. The init is the text `run_start.read_init_text` keeps (a public S3
read, cached by snapshot id); `app.wbm_init` does the rest and touches no network.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services import job_script, run_start
from app.wbm_init import reader, tree


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
