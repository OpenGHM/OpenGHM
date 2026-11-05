"""``GET /api/v1/wbm-code``: the WBM code versions and their status
(``app.services.wbm_code``)."""

from __future__ import annotations

from typing import Literal

from typing import Any

from pydantic import BaseModel, ConfigDict, model_serializer


class WbmCodeVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    #: sha256 tree hash (ADR 0032): the identity; ``version`` is a name.
    treeHash: str
    #: ``current``: a new snapshot draft may start from a snapshot on it;
    #: ``legacy``: existing snapshots keep working, no new draft starts from
    #: them; ``withdrawn``: known bad, nothing is submitted on it.
    status: Literal["current", "legacy", "withdrawn"]
    #: ISO date the version was published.
    published: str
    #: Why it was withdrawn; absent unless the manifest gives one.
    reason: str | None = None

    @model_serializer(mode="wrap")
    def _leave_out_a_missing_reason(self, handler) -> dict[str, Any]:
        data = handler(self)
        if data.get("reason") is None:
            data.pop("reason", None)
        return data


class WbmCodeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: In the manifest's order; empty when the manifest is unreadable.
    versions: list[WbmCodeVersion]
    #: The versions with status ``current``.
    current: list[str]
    #: The manifest's ``latest`` alias; null when it has none or is unreadable.
    latest: str | None
    #: False when the manifest could not be fetched or parsed: nothing is
    #: refused because of it, and every snapshot's ``codeState`` is ``unknown``.
    readable: bool
