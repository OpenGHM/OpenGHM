"""The datasets a draft can choose from: the entries of its model input, and whether a WBM
version can read each.

A dataset field that accepts a data `.init` is given one from the draft's model input
(`metadata.json` `datasets[]`, docs/architecture/model-parameters.md section 6). A `Candidate`
is one entry, keyed by the container path of its init as a run init writes it
(`/wbm/data_init/glaciers/x.init`), since `Code_Name` is not unique within a model input.
`reason` is why the snapshot's WBM version cannot read it, or None. This module is data and the
rules about one candidate; reading the model input is `app.services.model_parameters`, and
which modules can be switched on is `app.wbm_init.tree`.

Which datasets a field is offered is decided by unit alone, because the tree says nothing else about
what data fits a field: a field whose tree node has a `unit` is offered the datasets of that unit
(`Choices.for_unit`), and a field with no unit is offered none.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Candidate:
    #: The init as a run init writes it: `/wbm/data_init/glaciers/x.init`.
    path: str
    #: The descriptor's `Code_Name` (empty when the file has none).
    code: str
    #: The model input's name for it (`metadata.json`), else its `Code_Name`.
    name: str
    #: `Time_Series` of the descriptor: `monthly`, `yearly_clim`...
    time_series: str
    #: `Units` of the descriptor, else the metadata's unit.
    unit: str
    #: Why this dataset cannot be used, or None: its file is not a descriptor, the snapshot's WBM
    #: version cannot read it, or it has no dates (a climatology) and the model input lacks its data.
    reason: str | None = None
    #: What a copy repairs (the file's `Code_Name` is not its file name, or it holds a non-ASCII byte,
    #: which WBM 23.9.0 refuses, ADR 0039), or None. A candidate with a `repair` is usable only as a
    #: copy: the draft chooses it together with a fork that has no values to set.
    repair: str | None = None
    #: A dated dataset: the files of its own first date that the model input lacks. A run reads the
    #: files of its own dates, so this stops only a field that WBM opens the first file of, to read the
    #: grid (`reads_first_file` of the tree): `field_reason`.
    first_missing: tuple[str, ...] = ()


@dataclass(frozen=True)
class Choices:
    """The datasets of a model input, in the order its `metadata.json` lists them."""

    candidates: tuple[Candidate, ...] = ()

    def paths(self) -> frozenset[str]:
        return frozenset(c.path for c in self.candidates)

    def get(self, path: str) -> Candidate | None:
        return next((c for c in self.candidates if c.path == path), None)

    def for_unit(self, unit: str | None) -> list[Candidate]:
        """The datasets a field of the tree's `unit` is offered: those in that unit, in the model
        input's order. A field with no unit is offered none."""
        return [c for c in self.candidates if unit_matches(unit, c)]


def missing_data(missing: tuple[str, ...] | list[str]) -> str:
    """The sentence for data files the model input lacks."""
    noun = "file is" if len(missing) == 1 else "files are"
    return f"Its data {noun} not in the model input: {', '.join(missing)}."


def field_reason(
    candidate: Candidate, unit_contains: str | None, reads_first_file: bool = False
) -> str | None:
    """Why `candidate` cannot be the value of a field whose tree says its Units must contain
    `unit_contains` and, when `reads_first_file`, that WBM opens the dataset's first file at the start: the
    file's own reason first, then those rules. None when it can."""
    if candidate.reason:
        return candidate.reason
    if unit_contains and unit_contains.lower() not in candidate.unit.lower():
        return (
            f"Its Units ({candidate.unit or 'none'}) must contain '{unit_contains}': "
            "WBM stops at the start otherwise."
        )
    if reads_first_file and candidate.first_missing:
        return (
            "WBM opens the first data file when it starts, to read the grid, and it is not in the "
            f"model input: {', '.join(candidate.first_missing)}."
        )
    return None


def _unit_key(text: str) -> str:
    """A unit written so that the spellings of one unit agree: `m3/sec` is `m3/s`, and a volume
    per pixel is a volume."""
    return text.strip().lower().replace(" ", "").replace("/sec", "/s").replace("/pixel", "")


def unit_matches(field_unit: str | None, candidate: Candidate) -> bool:
    """Whether the dataset's unit is the field's, spellings of one unit agreeing (`_unit_key`). It decides
    what a field is offered: a dataset in another unit is not listed, and a field with no unit
    (`field_unit` empty) matches nothing, since the tree does not say which data fits it."""
    return bool(field_unit) and _unit_key(field_unit or "") == _unit_key(candidate.unit)
