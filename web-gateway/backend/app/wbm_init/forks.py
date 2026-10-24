"""A draft's dataset forks: a data `.init` edited as the run's own copy (ADR 0039).

A draft keeps, per fork, the field that reads the dataset, the original and the values to set
(`app.models.job.DatasetFork`); never the descriptor's text. A submit turns each into a `forks`
entry of the changes file (`{"from", "to", "set"}`) and points the field's key at the copy, which the
run's toolkit then makes in the run's own `wbm_init/`. This module is the gateway's side of it, all pure
except `check_originals`:

* `copy_path`      the copy's name, `<original basename>__<8 hex>.init` under `/wbm/wbm_init/datasets/`,
                   a hash of the original's path and the values set, so the same edit has the same name
                   and another value another (the spool cache hashes every `.init` a run init names, so a
                   file is never edited under an old name);
* `validate`       what a save and a submit refuse, one message per field path;
* `plan`           the `forks` list of the changes file and the init keys that point at the copies;
* `check_originals` that each original is in the model input and is a descriptor.

Only `Var_Scale`, `Var_Offset` and `Units` are editable: `Code_Name` and ASCII are fixed by the toolkit
on every fork, and the dates, `File_Path` and the rest are not the draft's to change.
"""

from __future__ import annotations

import hashlib
import json
import math
import posixpath
import re
from typing import Mapping, Sequence

from app.models.job import DatasetFork
from app.wbm_init import model_input, tree
from app.wbm_init.validate import MAX_LENGTH, _CONTROL_RE, _NUMBER_RE

#: The descriptor keys a draft may set on a copy.
EDITABLE_KEYS = ("Var_Scale", "Var_Offset", "Units")
_NUMBER_KEYS = ("Var_Scale", "Var_Offset")

#: Where a copy is written, a gateway convention that WBM does not read.
COPY_FOLDER = "/wbm/wbm_init/datasets/"
#: The roots a descriptor is read from: the model input, as `/wbm/data/` and as `/wbm/data_init/`.
_ORIGIN_ROOTS = ("/wbm/data/", "/wbm/data_init/")
#: A copy's file name, which the toolkit also requires of `to`.
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.init$")

SetValue = str | float


def typed_set(values: Mapping[str, str]) -> dict[str, SetValue]:
    """The values of a fork as the changes file carries them: `Var_Scale` and `Var_Offset` as numbers
    (the toolkit writes 1.1 or 1e-05), `Units` as text. `1.10` and `1.1` are the same number, so the
    same edit. Assumes the values passed `validate`."""
    return {
        key: float(value) if key in _NUMBER_KEYS else value
        for key, value in sorted(values.items())
    }


def copy_path(original: str, values: Mapping[str, str]) -> str:
    """The container path of the copy of `original` that sets `values`."""
    digest = hashlib.sha256(
        json.dumps({"original": original, "set": typed_set(values)}, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()[:8]
    stem = posixpath.basename(original).removesuffix(".init")
    return f"{COPY_FOLDER}{stem}__{digest}.init"


def _value_problem(key: str, value: object) -> str | None:
    if key not in EDITABLE_KEYS:
        return f"{key} cannot be edited here: a copy of a dataset sets only {', '.join(EDITABLE_KEYS)}."
    if not isinstance(value, str) or value.strip() == "":
        return f"{key} needs a value: leave it out to keep the original's."
    if not value.isascii():
        return f"{key}: use ASCII characters only, WBM cannot read anything else."
    if len(value) > MAX_LENGTH:
        return f"{key} is too long (at most {MAX_LENGTH} characters)."
    if key == "Units":
        return "Units must be a single line of text." if _CONTROL_RE.search(value) else None
    if not _NUMBER_RE.match(value):
        return f"{key} must be a number like 1.1 or 2e-3."
    number = float(value)
    if not math.isfinite(number):
        return f"{key} is too large."
    if key == "Var_Scale" and number == 0:
        return "WBM reads a Var_Scale of 0 as 1, so it cannot be used: use a small number."
    return None


def _effective(
    fork: DatasetFork, node: tree.Node, custom_params: Mapping[str, str], values: dict
) -> str | None:
    """The dataset the field reads in the draft without the fork: the draft's own choice, else the init's."""
    if fork.path in custom_params:
        return custom_params[fork.path]
    return tree.current_text(node, values)


def validate(
    forks: Sequence[DatasetFork],
    custom_params: Mapping[str, str],
    resolved: tree.Resolved,
    values: dict,
) -> dict[str, str]:
    """`{field path: message}` for every fork the draft cannot carry; empty when all are fine. A fork
    is for a field (or a module that is itself a dataset) that takes a data `.init`, whose modules are
    on in this draft, and that reads `original` directly: its value in the init, or the dataset the
    draft chooses for a module it switches on. A field that holds a constant number has no dataset to
    copy. `custom_params` is the draft's, as saved (what equals the snapshot's already dropped).
    Whether the original is in the model input is `check_originals`."""
    off_in_save = frozenset(
        p
        for p, v in custom_params.items()
        if v == "" and (n := resolved.fields.get(p)) is not None and n.kind == "module"
    )
    errors: dict[str, str] = {}
    seen: set[str] = set()
    for fork in forks:
        message = _check(fork, resolved, values, custom_params, off_in_save, fork.path in seen)
        seen.add(fork.path)
        if message:
            errors.setdefault(fork.path, message)
    return errors


def _check(
    fork: DatasetFork,
    resolved: tree.Resolved,
    values: dict,
    custom_params: Mapping[str, str],
    off_in_save: frozenset[str],
    repeated: bool,
) -> str | None:
    node = resolved.fields.get(fork.path)
    if node is None:
        return "This is not a field of this snapshot's model parameters."
    if repeated:
        return "A field has at most one copy of its dataset."
    if node.type != "dataset" or "init" not in node.accepts:
        return "This field does not read a data .init, so it has no dataset to copy."
    modules = (*node.modules, *([node.path] if node.kind == "module" else []))
    for module in modules:
        if module in off_in_save:
            return "Its module is being switched off."
        if tree.module_state(module, values) == "off" and fork.path not in custom_params:
            return "Its module is off in this snapshot: choose the dataset to switch it on first."
    if tree.block_is_file(node.path, values):
        return "The block that holds it is set from a file in the snapshot, which cannot be edited."
    effective = (_effective(fork, node, custom_params, values) or "").strip()
    if effective == "":
        return "This field has no dataset to copy."
    if _NUMBER_RE.match(effective):
        return "This field holds a constant number, so there is no dataset to copy."
    if not effective.startswith(_ORIGIN_ROOTS) or not effective.endswith(".init"):
        return "This field does not name a data .init that the run reads directly, so it cannot be copied."
    if fork.original != effective:
        return f"The original must be the dataset this field reads: {effective}."
    if posixpath.normpath(fork.original) != fork.original or not _NAME_RE.match(posixpath.basename(fork.original)):
        return "The original's file name is not one a copy can be made from."
    for key, value in fork.set.items():
        problem = _value_problem(key, value)
        if problem:
            return problem
    return None


def plan(
    forks: Sequence[DatasetFork] | None, resolved: tree.Resolved, values: dict
) -> tuple[list[dict], dict[str, str]]:
    """`(forks, repoint)` for a validated draft: the `forks` list of the changes file, one entry per
    distinct copy (two fields of one original and one edit share a copy), and the init key of each
    field (the alias the init uses, as `typed_changes` writes it) -> the copy's path. A fork does not
    repoint the run init by itself (ADR 0039): the key goes into the changes file's `set`."""
    entries: dict[str, dict] = {}
    repoint: dict[str, str] = {}
    for fork in forks or ():
        node = resolved.fields[fork.path]
        target = copy_path(fork.original, fork.set)
        entries.setdefault(target, {"from": fork.original, "to": target, "set": typed_set(fork.set)})
        repoint[tree.write_path(node, values) if node.kind == "field" else fork.path] = target
    return list(entries.values()), repoint


async def check_originals(
    source: model_input.Source, forks: Sequence[DatasetFork]
) -> dict[str, str]:
    """`{field path: message}` for each fork whose original is not a descriptor of the model input: not
    there, not an init, or with no `Code_Name`, which the toolkit also refuses. A model input that cannot
    be read refuses nothing: the toolkit checks again when the run stages the copy."""
    errors: dict[str, str] = {}
    for fork in forks:
        try:
            init = await model_input.read_container_init(source, fork.original)
        except model_input.NotFound:
            errors.setdefault(fork.path, f"{fork.original} is not in the model input.")
        except model_input.BadInit as exc:
            errors.setdefault(fork.path, f"{fork.original} cannot be read as a dataset ({exc}).")
        except model_input.Unavailable:
            return errors
        else:
            if not init.get("Code_Name"):
                errors.setdefault(fork.path, f"{fork.original} has no Code_Name, so it is not a dataset.")
    return errors
