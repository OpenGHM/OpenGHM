"""Checking a draft's `custom_params` against the resolved parameter tree.

`custom_params` maps an init key path to a value written as text. `validate` answers one
message per path it refuses, in words for the person who typed it; an empty answer is a
draft the changes file can carry. `drop_unchanged` removes what equals the snapshot's own
value, and `typed_changes` is what a submit merges into the changes file (ADR 0038): numbers
as numbers, a module switched off as `''`, everything else as text.

All three are pure: they take the tree (`tree.resolve(version)`) and the snapshot's init values
(`reader.read`), and touch nothing else.
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Mapping, Sequence, Union

from app.wbm_init import tree

ChangeValue = Union[str, int, float]

#: The longest value a custom parameter may carry, in characters: a path or a title fits.
MAX_LENGTH = 256

# WBM's own number form (`isNumber`): a digit before the point, so `.5` is not a number to it.
_NUMBER_RE = re.compile(r"^[-+]?[0-9]+(\.[0-9]*)?([eE][-+]?[0-9]+(\.[0-9]*)?)?$")
_INT_RE = re.compile(r"^[-+]?[0-9]+$")
_DATE_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")

_REFUSED = {
    "version": "WBM {version} does not read this parameter.",
    "draft_field": "This setting has its own field in the draft.",
    "inert": "WBM does not use this parameter, so it cannot be changed.",
    "locked": "The gateway sets this value, so it cannot be changed.",
}


def _fmt(x: float) -> str:
    return f"{x:g}"


def _same(node: tree.Node, value: str, current: str | None) -> bool:
    """Whether `value` is what the init already has: the same text, or for a number the same number."""
    if current is None:
        return False
    if value == current:
        return True
    if (node.type in ("number", "int", "bool01") or node.edit_as == "number") and _NUMBER_RE.match(value) and _NUMBER_RE.match(current):
        return float(value) == float(current)
    return False


def drop_unchanged(
    custom_params: Mapping[str, str], resolved: tree.Resolved, values: dict
) -> dict[str, str]:
    """`custom_params` without the entries that equal the snapshot's value, so a draft keeps only real changes."""
    kept = {}
    for path, value in custom_params.items():
        node = resolved.fields.get(path)
        if not (node and isinstance(value, str) and _same(node, value, tree.current_text(node, values))):
            kept[path] = value
    return kept


def validate(
    custom_params: Mapping[str, str],
    resolved: tree.Resolved,
    values: dict,
    variables: Sequence[str] = (),
) -> dict[str, str]:
    """`{path: message}` for every entry the tree refuses; empty when all are fine.
    `variables` is the draft's output variable list: a module cannot be switched off while
    it holds an output the module unlocks."""
    off_in_save = frozenset(
        p
        for p, v in custom_params.items()
        if v == "" and (n := resolved.fields.get(p)) is not None and n.kind == "module"
    )
    errors: dict[str, str] = {}
    for path, value in custom_params.items():
        message = _check(path, value, resolved, values, off_in_save)
        if message is None and path in off_in_save:
            message = _outputs_need(resolved.fields[path], variables)
        if message:
            errors[path] = message
    return errors


def _check(
    path: str, value: object, resolved: tree.Resolved, values: dict, off_in_save: frozenset
) -> str | None:
    node = resolved.fields.get(path)
    if node is None:
        reason = resolved.refused.get(path)
        if reason:
            return _REFUSED[reason].format(version=resolved.version)
        return "This is not a model parameter of this snapshot."
    if not isinstance(value, str):
        return "The value must be text."
    if not value.isascii():
        return "Use ASCII characters only: WBM cannot read anything else."
    if len(value) > MAX_LENGTH:
        return f"The value is too long (at most {MAX_LENGTH} characters)."

    if node.kind == "module":
        if not node.editable:
            return "This module cannot be switched off here."
        if tree.module_state(path, values) == "off":
            return "This module is already off."
        if value != "":
            return "A module can only be switched off here: leave the value empty."
        return None

    if not node.editable:
        return "This parameter cannot be changed here."
    for module in node.modules:
        if tree.module_state(module, values) == "off":
            return "Its module is off in this snapshot, and switching a module on is not available."
        if module in off_in_save:
            return "Its module is being switched off."
    if tree.block_is_file(path, values):
        return "The block that holds it is set from a file in the snapshot, which cannot be edited."
    return _check_value(node, value, values)


#: The glacier module and the suffix of the primary-source output that tracks its water.
_GLACIER_MODULE = "Glaciers"
_GLACIER_TRACKING_SUFFIX = "_pg"


def _outputs_need(node: tree.Node, variables: Sequence[str]) -> str | None:
    """Why switching `node` off is refused while `variables` is the draft's output list: an
    output it unlocks is still listed, or (Glaciers) a `_pg` output still tracks its water."""
    reasons = []
    needed = [v for v in variables if v in node.unlocks_outputs]
    if needed:
        reasons.append(
            "These output variables need this module: remove " + ", ".join(needed) + " first."
        )
    if node.path == _GLACIER_MODULE:
        tracked = [v for v in variables if v.endswith(_GLACIER_TRACKING_SUFFIX)]
        if tracked:
            reasons.append(
                "Primary-source glacier tracking needs glacier melt: remove "
                + ", ".join(tracked)
                + " first."
            )
    return " ".join(reasons) or None


def _check_value(node: tree.Node, value: str, values: dict) -> str | None:
    if node.edit_as == "number":
        # A dataset field the wizard edits as a constant number, and nothing else.
        if not _NUMBER_RE.match(value):
            return (
                "A constant number is the only value the wizard offers for this field: "
                "use a number like 0.5 or 2e-3."
            )
        return _check_number(node, value)
    if node.type == "enum":
        options = tree.available_options(node, values) or ()
        allowed = [v for v, _ in options]
        if value not in allowed:
            return "Choose one of: " + ", ".join(repr(v) if v == "" else v for v in allowed) + "."
        return None
    if value == "":
        return "A value is needed: an empty value only switches a module off."
    if node.type == "bool01":
        return None if value in ("0", "1") else "Use 0 or 1."
    if node.type == "date":
        if not _DATE_RE.match(value):
            return "Use a date like 2000-01-31."
        try:
            date.fromisoformat(value)
        except ValueError:
            return "This is not a real date."
        return None
    if node.type in ("number", "int"):
        if not (_INT_RE if node.type == "int" else _NUMBER_RE).match(value):
            return "Use a whole number." if node.type == "int" else "Use a number like 0.5 or 2e-3."
        return _check_number(node, value)
    # string
    if _CONTROL_RE.search(value):
        return "Use a single line of text."
    if node.pattern and not re.fullmatch(node.pattern, value):
        return "This is not a form WBM reads for this parameter."
    return None


def _check_number(node: tree.Node, value: str) -> str | None:
    number = float(value)
    if not math.isfinite(number):
        return "The number is too large."
    low, high = node.min, node.max
    if low is not None and high is not None and not low <= number <= high:
        return f"Must be between {_fmt(low)} and {_fmt(high)}."
    if low is not None and number < low:
        return f"Must be at least {_fmt(low)}."
    if high is not None and number > high:
        return f"Must be at most {_fmt(high)}."
    return None


def typed_changes(
    custom_params: Mapping[str, str], resolved: tree.Resolved, values: dict
) -> dict[str, ChangeValue]:
    """The entries of a validated `custom_params` as the changes file's `set` takes them: int, number and
    bool01 as numbers, the rest as text (a module switched off as `''`). A setting the init holds
    under an alias is written to the alias, the key WBM reads."""
    out: dict[str, ChangeValue] = {}
    for path, value in custom_params.items():
        node = resolved.fields[path]
        typed: ChangeValue = value
        if node.kind == "field":
            if node.type in ("int", "bool01"):
                typed = int(value)
            elif node.type == "number" or node.edit_as == "number":
                typed = float(value)
        out[tree.write_path(node, values) if node.kind == "field" else path] = typed
    return out
