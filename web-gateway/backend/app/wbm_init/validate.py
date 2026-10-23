"""Checking a draft's `custom_params` against the resolved parameter tree.

`custom_params` maps an init key path to a value written as text. `validate` answers one
message per path it refuses, in words for the person who typed it; an empty answer is a
draft the changes file can carry. `drop_unchanged` removes what equals the snapshot's own
value, and `typed_changes` is what a submit merges into the changes file (ADR 0038): numbers
as numbers, a module switched off as `''`, everything else as text.

A module the snapshot has off is switched on by the same save that sets what it requires: its
fields (a block module, `Glaciers`) or its own key (a module that is itself a dataset,
`openWaterEvap`), the datasets chosen from the draft's model input (`choices`).

All three are pure: they take the tree (`tree.resolve(version)`), the snapshot's init values
(`reader.read`) and, to switch a module on, the datasets of the model input; they touch nothing else.
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Mapping, Sequence, Union

from app.wbm_init import tree
from app.wbm_init.choices import Choices, field_reason, unit_matches

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
    choices: Choices | None = None,
) -> dict[str, str]:
    """`{path: message}` for every entry the tree refuses; empty when all are fine.
    `variables` is the draft's output variable list: a module cannot be switched off while
    it holds an output the module unlocks. `choices` are the datasets of the draft's model
    input, which a module the snapshot has off is switched on with (None when they could not
    be read: nothing is then accepted for such a module). A module switched on is also refused
    when it does not set everything it requires; that message is at the module's path."""
    off_in_save = frozenset(
        p
        for p, v in custom_params.items()
        if v == "" and (n := resolved.fields.get(p)) is not None and n.kind == "module"
    )
    decisions = tree.switch_on_decisions(resolved, values, choices)
    errors: dict[str, str] = {}
    for path, value in custom_params.items():
        message = _check(path, value, resolved, values, off_in_save, decisions, choices)
        if message is None and path in off_in_save:
            message = _outputs_need(resolved.fields[path], variables)
        if message:
            errors[path] = message
    for path, message in _unmet(custom_params, resolved, decisions).items():
        errors.setdefault(path, message)
    return errors


def _unmet(
    custom_params: Mapping[str, str], resolved: tree.Resolved, decisions: dict[str, tree.SwitchOn]
) -> dict[str, str]:
    """A message at the path of each module the save switches on that does not set everything it
    requires (the `module_on_has_value` rule of the tree, said on save): a module is switched on
    by any of its fields, or by its own key, and is then on."""
    needs = tree.module_requirements(resolved.version)
    out: dict[str, str] = {}
    for module in tree.offered(decisions):
        touched = any(
            (node := resolved.fields.get(p)) is not None
            and (module in node.modules or (p == module and node.kind == "module" and value != ""))
            for p, value in custom_params.items()
        )
        if not touched:
            continue
        missing = [
            f"{resolved.fields[p].label} ({p})"
            for p in needs.get(module, ())
            if p in resolved.fields and custom_params.get(p, "") == ""
        ]
        if missing:
            out[module] = (
                f"{resolved.fields[module].label} is being switched on but does not set "
                + ", ".join(missing) + "."
            )
    return out


def _check(
    path: str,
    value: object,
    resolved: tree.Resolved,
    values: dict,
    off_in_save: frozenset,
    decisions: dict[str, tree.SwitchOn],
    choices: Choices | None,
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
            if value == "":
                return "This module is already off."
            refusal = _cannot_switch_on(decisions.get(path))
            if refusal:
                return refusal
            if node.type != "dataset":
                return "Switch this module on by setting its parameters: it has no value of its own."
            return _check_dataset(node, value, choices)
        if value != "":
            return "A module can only be switched off here: leave the value empty."
        return None

    pickable = node.type == "dataset" and "init" in node.accepts
    off = [m for m in node.modules if tree.module_state(m, values) == "off"]
    if not node.editable and not (pickable and off):
        return "This parameter cannot be changed here."
    for module in off:
        refusal = _cannot_switch_on(decisions.get(module), "Its module is off in this snapshot")
        if refusal:
            return refusal
    if off and pickable:
        return _check_dataset(node, value, choices)
    for module in node.modules:
        if module in off_in_save:
            return "Its module is being switched off."
    if tree.block_is_file(path, values):
        return "The block that holds it is set from a file in the snapshot, which cannot be edited."
    return _check_value(node, value, values)


def _cannot_switch_on(decision: tree.SwitchOn | None, lead: str = "This module is off in this snapshot") -> str | None:
    """The refusal for a module the snapshot has off and the wizard cannot switch on, with the
    reason the tree gives; None when it can."""
    if decision is not None and decision.offered:
        return None
    return f"{lead} and cannot be switched on here." + (f" {decision.reason}" if decision and decision.reason else "")


def _check_dataset(node: tree.Node, value: str, choices: Choices | None) -> str | None:
    """A dataset given to a module the save switches on: a constant number where the field takes one,
    else a data `.init` of the model input in the field's unit that WBM can read and the field's own
    rule allows. A field the tree gives no unit has no datasets to choose from."""
    if value == "":
        return "Choose a dataset, or leave this one unset."
    takes_number = "number" in node.accepts
    if takes_number and _NUMBER_RE.match(value):
        return _check_number(node, value)
    if node.fit != "unit":
        return "The tree does not say which dataset fits this field, so none can be chosen" + (
            ": enter a number." if takes_number else "."
        )
    if choices is None:
        return (
            "The model input could not be read right now, so this dataset cannot be checked. "
            "Try again in a few minutes."
        )
    candidate = choices.get(value)
    if candidate is None:
        return "This is not a dataset of the snapshot's model input."
    if not unit_matches(node.unit, candidate):
        return f"{candidate.name} is in {candidate.unit or 'no unit'}, and this field takes {node.unit}."
    reason = field_reason(candidate, node.unit_contains)
    return f"{candidate.name} cannot be used here. {reason}" if reason else None


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
        if node.kind == "module":
            if node.type == "dataset" and "number" in node.accepts and _NUMBER_RE.match(value):
                typed = float(value)  # a module that is a dataset, given a constant
        if node.kind == "field":
            if node.type in ("int", "bool01"):
                typed = int(value)
            elif node.type == "number" or (node.edit_as == "number" and _NUMBER_RE.match(value)):
                typed = float(value)  # a dataset field given a path stays text
        out[tree.write_path(node, values) if node.kind == "field" else path] = typed
    return out
