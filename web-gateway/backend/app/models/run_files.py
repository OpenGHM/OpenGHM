"""Answers of the routes that list a run's output on Anvil scratch and total it for a ZIP
(ADR 0040). The shapes follow `TreeListing` and `FolderSummary` of a published tree, minus what
a run's file does not have: a public URL and a preview."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.models.repository import TreeFolder


class RunFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    #: relative to the run's output directory.
    path: str
    size: int
    #: UTC, ``2026-10-07T12:04:06Z``.
    lastModified: str


class RunListing(BaseModel):
    """One page of one folder, each list sorted by name."""

    model_config = ConfigDict(extra="forbid")

    id: str
    path: str
    folders: list[TreeFolder]
    files: list[RunFile]
    #: pass back as ``cursor`` for the next page; ``null`` on the last.
    nextCursor: str | None


class RunFolderSummary(BaseModel):
    """What a folder of a run's output holds at any depth, and whether it is small enough
    for one ZIP. When ``complete`` is false the walk was cut off (too many files), the counts
    are what it had reached, and ``fits`` is false."""

    model_config = ConfigDict(extra="forbid")

    #: the folder, ``""`` for the output directory itself, else ending with ``/``.
    path: str
    files: int
    bytes: int
    limit_bytes: int
    fits: bool
    complete: bool
