"""The parameter tree, resolved for a WBM code version, and rendered with an init's values.

`param_tree.yaml` is data (its header says what each attribute means; the design is
docs/architecture/model-parameters.md). `resolve(version)` turns it into `Node`s for one code
version, once, and is cached:

* a node whose `versions` leaves the version out is dropped, as is everything under it;
* a version-keyed `default`, `pattern` or option map takes the version's side;
* a node's tier is its own, else its parent's, else `basic` at the top of the tree and
  `module` inside a module (the rule the structure test of the tree uses). `module` is
  shown as `basic`: the wizard shows a module's fields while the module is on;
* what a custom parameter may not name is left out of the nodes and recorded in
  `Resolved.refused` with the reason: a `locked` tier, `write: never`, an `inert` key, a key owned
  by a `draft_field`, a key outside the version. Nodes that are not an init key (`ui_only`,
  command-line options, the derived modules) are left out altogether;
* a `dataset` field whose `accepts` lists `number` is editable as a constant number
  (`edit_as: "number"`): WBM reads a number for it as that value in every grid cell;
* groups left with no children are dropped.

`switch_on_decisions` says which modules the snapshot has off can be switched on by the wizard
(everything they require can be chosen from the draft's model input, `choices`), and `render`
serves the answer with the candidates of the dataset fields it opens.

`Resolved.fields` is the index from init key path to the field or module, which is what
validation reads. `render` gives the contract's JSON (docs/architecture/model-parameters.md):
the nodes with `current` and module `state` read from a snapshot's init values (`reader.read`).
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from app.wbm_init.choices import Candidate, Choices, field_reason
from app.wbm_init.reader import lookup

TREE_FILE = Path(__file__).with_name("param_tree.yaml")

#: The types a custom parameter may carry. Every other type is shown read-only.
SCALAR_TYPES = ("number", "int", "enum", "bool01", "string", "date")

#: The four driver datasets the `availability` section calls `drivers`.
_DRIVERS = ("MT_cloudFr", "MT_windU", "MT_windV", "MT_humidity")

#: `current` of a key that holds a block, which has no text.
BLOCK_TEXT = "{...}"

#: A block WBM also reads as a plain string that stands for one of its keys: `Routing => 'LRR'`
#: is `Routing => { method => 'LRR' }`. The string is shown as that key's current value; the
#: key is not editable while the init has the string form (`block_is_file`).
_PLAIN_STRING_FORM = {"Routing.method": "Routing"}


@dataclass(frozen=True)
class Node:
    kind: str  # group | module | field
    key: str
    label: str  # a module's name
    doc: str | None
    tier: str  # basic | advanced
    children: tuple["Node", ...] = ()
    #: The init key path of a field or module.
    path: str | None = None
    type: str | None = None
    #: A field: the tree lets the wizard edit it (a scalar type, `editable: true`). A
    #: module: it may be switched off (`editable: switch_off`).
    editable: bool = False
    default: Any = None
    #: The init key whose value is the default when this key is absent.
    default_from: str | None = None
    unit: str | None = None
    options: tuple[tuple[str, str], ...] | None = None
    #: option value -> the init keys the option needs present (`availability`).
    needs: tuple[tuple[str, tuple[str, ...]], ...] = ()
    min: float | None = None
    max: float | None = None
    calibration: tuple[float, float] | None = None
    show_if: str | None = None
    #: A string field's pattern for this version.
    pattern: str | None = None
    #: Other init keys WBM reads for the same setting; when the init has one, it wins.
    aliases: tuple[str, ...] = ()
    #: The init paths of the modules this node is inside, outermost first.
    modules: tuple[str, ...] = ()
    #: A `dataset` field that WBM also accepts as a constant number (`accepts` lists `number`):
    #: `"number"`, and the wizard edits it as a number. None for every other field.
    edit_as: str | None = None
    #: A module: the output variables that need it (`unlocks_outputs`), so it cannot be
    #: switched off while the draft still lists one.
    unlocks_outputs: tuple[str, ...] = ()
    #: The value kinds a dataset or file field (or a module whose own key is one) takes: `init`,
    #: `number`, `raster`, `file`.
    accepts: tuple[str, ...] = ()
    #: The tree marks the field `required: true`: a module that is on has it set.
    required: bool = False
    #: A dataset field: the text the chosen dataset's Units must contain, for this version.
    unit_contains: str | None = None
    #: What says which datasets of the model input fit this dataset field or module: `unit` (those
    #: in `unit`). None: the tree does not say, and no dataset is offered.
    fit: str | None = None
    #: A dataset field: WBM opens the dataset's first file at the start, to read its grid. True; or the
    #: init path of the module the run needs on for it to (`MT_airT.Primary` with `lapseDownscale`).
    reads_first_file: bool | str = False
    #: A module: the init paths of its dataset fields that this version needs on one grid.
    same_grid: tuple[str, ...] = ()


@dataclass(frozen=True)
class SwitchOn:
    """Whether the wizard can switch a module the snapshot has off on."""

    offered: bool
    #: Why not, as a sentence for the module's card.
    reason: str | None = None


@dataclass(frozen=True)
class Resolved:
    version: str
    groups: tuple[Node, ...]
    #: init key path -> the field or module that carries it.
    fields: dict[str, Node]
    #: init key path -> why a custom parameter may not name it: `version`, `draft_field`,
    #: `inert` or `locked`.
    refused: dict[str, str]


@functools.lru_cache(maxsize=1)
def _doc() -> dict:
    with TREE_FILE.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def code_versions() -> list[str]:
    return list(_doc()["code_versions"])


def _pick(value: Any, version: str) -> Any:
    """A version-keyed map's side for `version`; any other value as it is."""
    if isinstance(value, dict) and value and all(k in _doc()["code_versions"] for k in value):
        return value.get(version)
    return value


def _label(key: str) -> str:
    text = key.replace("_", " ")
    return text[:1].upper() + text[1:]


def _options(raw: Any, version: str) -> tuple[tuple[str, str], ...] | None:
    raw = _pick(raw, version)
    if raw is None:
        return None
    if isinstance(raw, dict):
        return tuple((str(v), str(label)) for v, label in raw.items())
    return tuple((str(v), str(v)) for v in raw)


def _needs(path: str, doc: dict) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """What each option of the field at `path` needs: the entries of the `availability`
    section written `<path> = <option>`."""
    out = []
    for entry in doc["availability"]["options"]:
        head, sep, option = entry["option"].partition(" = ")
        if sep and head == path:
            keys: list[str] = []
            for need in entry["needs"]:
                keys.extend(_DRIVERS if need == "drivers" else [need])
            out.append((option, tuple(keys)))
    return tuple(out)


def _paths(node: dict) -> list[str]:
    out = [node["wbm"]] if "wbm" in node else []
    for child in node.get("children") or []:
        out.extend(_paths(child))
    return out


def _bounds(raw: dict) -> tuple[float | None, float | None]:
    if isinstance(raw.get("range"), list):
        return raw["range"][0], raw["range"][1]
    return raw.get("min"), raw.get("max")


@functools.lru_cache(maxsize=None)
def resolve(version: str) -> Resolved:
    """The tree for one WBM code version. Raises `ValueError` for a version the tree does not know."""
    doc = _doc()
    if version not in doc["code_versions"]:
        raise ValueError(f"The parameter tree has no WBM version {version!r}.")
    fields: dict[str, Node] = {}
    refused: dict[str, str] = {}

    def build(raws, parent_tier, in_module, owned, inert, modules) -> list[Node]:
        out: list[Node] = []
        for raw in raws:
            own = raw.get("tier")
            tier = own or parent_tier or ("module" if in_module else "basic")
            is_owned = owned or "draft_field" in raw
            is_inert = inert or bool(raw.get("inert"))
            if "versions" in raw and version not in raw["versions"]:
                reason = "version"
            elif is_owned:
                reason = "draft_field"
            elif is_inert:
                reason = "inert"
            elif tier == "locked" or raw.get("write") == "never":
                reason = "locked"
            else:
                reason = None
            if reason:
                for path in _paths(raw):
                    refused.setdefault(path, reason)
                continue
            children_raw = raw.get("children") or []
            if raw.get("ui_only") and not children_raw:
                continue
            shown = "advanced" if tier == "advanced" else "basic"
            path = raw.get("wbm")
            is_module = path is not None and ("module" in raw or raw.get("editable") == "switch_off")
            if "module" in raw and path is None:
                continue  # derived from an output name: no init key to show or switch off
            if is_module or children_raw or "group" in raw:
                inner = modules + ((path,) if is_module else ())
                children = build(
                    children_raw, own or parent_tier, in_module or "module" in raw, is_owned,
                    is_inert, inner,
                )
                key = raw.get("group") or raw.get("module") or raw.get("key") or ""
                label = raw.get("name") or raw.get("label") or _label(key)
                if is_module:
                    node = Node(
                        "module", key, label, raw.get("doc"), shown, tuple(children), path,
                        raw.get("type"), editable=raw.get("editable") == "switch_off",
                        modules=modules, unlocks_outputs=tuple(raw.get("unlocks_outputs") or ()),
                        accepts=tuple(raw.get("accepts") or ()),
                        unit=raw.get("unit"), fit=raw.get("fit"),
                        same_grid=tuple(_pick(raw.get("same_grid"), version) or ()),
                    )
                    fields[path] = node
                elif children:
                    node = Node("group", key, label, raw.get("doc"), shown, tuple(children))
                else:
                    continue
                out.append(node)
                continue
            if path is None:
                continue  # a command-line option or other setting that is not an init key
            kind_type = raw.get("type") or "string"
            low, high = _bounds(raw)
            default = _pick(raw.get("default"), version)
            pattern = _pick(raw.get("pattern"), version)
            edit_as = (
                "number"
                if kind_type == "dataset" and raw.get("editable") is not False
                and "number" in (raw.get("accepts") or ())
                else None
            )
            node = Node(
                "field", raw["key"], raw.get("label") or _label(raw["key"]), raw.get("doc"), shown,
                path=path,
                type=kind_type,
                editable=(raw.get("editable") is True and kind_type in SCALAR_TYPES)
                or edit_as is not None,
                edit_as=edit_as,
                default=default if isinstance(default, (str, int, float)) else None,
                default_from=raw.get("default_from"),
                unit=raw.get("unit"),
                options=_options(raw.get("options"), version),
                needs=_needs(path, doc) if raw.get("options_available_if") else (),
                min=low,
                max=high,
                calibration=tuple((raw.get("calibration") or {}).get("range") or ()) or None,
                show_if=raw.get("show_if"),
                pattern=pattern if isinstance(pattern, str) else None,
                aliases=tuple(raw.get("aliases") or ()),
                modules=modules,
                accepts=tuple(raw.get("accepts") or ()),
                required=raw.get("required") is True,
                unit_contains=_pick(raw.get("unit_contains"), version),
                fit=raw.get("fit"),
                reads_first_file=_pick(raw.get("reads_first_file"), version) or False,
            )
            fields[path] = node
            out.append(node)
        return out

    groups = build(doc["tree"], None, False, False, False, ())
    return Resolved(version, tuple(groups), fields, refused)


def cross_rules(version: str) -> list[dict]:
    """The `cross_rules` of the tree that apply to a code version, in file order: each is
    `{id, level, rule, versions?}` as the file states it (`level` is error, warn or info)."""
    return [
        r for r in _doc()["cross_rules"] if "versions" not in r or version in r["versions"]
    ]


def module_requirements(version: str) -> dict[str, tuple[str, ...]]:
    """module init path -> the init paths of the children it always needs once it is on: a
    `required: true` leaf directly under the module or under a group of it that has no
    `show_if`. A group with a `show_if` holds one of several forms of the block (the polygon
    or the sub-pixel form of `Runoff_mask`, the aquifer types), so its requirements belong to
    the form and not to the module. A child outside the version is not counted."""
    out: dict[str, tuple[str, ...]] = {}

    def leaves(raws) -> list[str]:
        found: list[str] = []
        for raw in raws:
            if "versions" in raw and version not in raw["versions"]:
                continue
            if "children" in raw:
                if "show_if" not in raw:
                    found.extend(leaves(raw["children"]))
            elif raw.get("required") is True and raw.get("wbm"):
                found.append(raw["wbm"])
        return found

    def walk(raws) -> None:
        for raw in raws:
            if "versions" in raw and version not in raw["versions"]:
                continue
            if raw.get("wbm") and ("module" in raw or raw.get("editable") == "switch_off"):
                out[raw["wbm"]] = tuple(leaves(raw.get("children") or []))
            walk(raw.get("children") or [])

    walk(_doc()["tree"])
    return out


# ---------------------------------------------------------------------------
# Values read from an init
# ---------------------------------------------------------------------------


def _filled(value: Any) -> bool:
    """Whether an init value is something: not missing, '', '0' or an empty block."""
    return value not in (None, "", "0", {})


def filled(value: Any) -> bool:
    """Whether an init value is something: not missing, '', '0' or an empty block."""
    return _filled(value)


def module_state(path: str, values: dict) -> str:
    """`on` when the init holds the module's key with a value (the tree's `on_if: key_present`)."""
    return "on" if _filled(lookup(values, path)) else "off"


def current_text(node: Node, values: dict) -> str | None:
    """The init's value of a field as text; None when the key is absent. A key the init holds
    under an alias is read from the alias, which is the one WBM uses."""
    for path in (*node.aliases, node.path):
        value = lookup(values, path)
        if value is not None:
            return BLOCK_TEXT if isinstance(value, dict) else value
    plain = lookup(values, _PLAIN_STRING_FORM.get(node.path, ""))
    return plain if isinstance(plain, str) and plain != "" else None


def write_path(node: Node, values: dict) -> str:
    """The init key a change to `node` is written to: the alias the init uses, else its own path."""
    return next((a for a in node.aliases if lookup(values, a) is not None), node.path)


def available_options(node: Node, values: dict) -> tuple[tuple[str, str], ...] | None:
    """A field's options, less those the init's own datasets cannot support. The init is the
    proxy for the model input: an option that needs a dataset is offered when the init names
    it, and always when it is the option the init already has."""
    if node.options is None or not node.needs:
        return node.options
    need = dict(node.needs)
    current = current_text(node, values)
    return tuple(
        (value, label)
        for value, label in node.options
        if value == current or all(_filled(lookup(values, key)) for key in need.get(value, ()))
    )


def block_is_file(path: str, values: dict) -> bool:
    """Whether a block above `path` is a string in the init (`Reservoirs => '/wbm/...'`, a block
    file), so the keys inside it are not in the init to change. An empty string (`wbmParam =>
    ''`) is no block yet: a change to a key in it writes the block."""
    names = path.split(".")
    for i in range(1, len(names)):
        above = lookup(values, ".".join(names[:i]))
        if isinstance(above, str) and above != "":
            return True
    return False


def editable_now(
    resolved: Resolved,
    node: Node,
    values: dict,
    pending_off: frozenset = frozenset(),
    switchable: frozenset = frozenset(),
) -> bool:
    """Whether a custom parameter may set `node`: the tree allows it, every module it is inside is
    on (and not being switched off in the same save, `pending_off`) or is one the same save can
    switch on (`switchable`), and no block above it is a file reference."""
    if not node.editable:
        return False
    if node.kind == "module":
        return module_state(node.path, values) == "on"
    return (
        all(
            (module_state(m, values) == "on" or m in switchable) and m not in pending_off
            for m in node.modules
        )
        and not block_is_file(node.path, values)
    )


# ---------------------------------------------------------------------------
# Switching a module on
# ---------------------------------------------------------------------------

_UNREADABLE = "The model input could not be read right now, so its datasets cannot be offered."

#: What a required child can lack, from `_lacks`.
_NEEDS_DEFAULT, _NEEDS_DATASET, _NEEDS_FIT, _NEEDS_RASTER, _NEEDS_FILE, _NEEDS_PART = (
    "default", "dataset", "fit", "raster", "file", "part",
)


def offered_candidates(node: Node, choices: Choices | None) -> list[Candidate]:
    """The datasets of the model input that `node` (a dataset field, or a module whose own key
    is a dataset) is offered: where the tree states `fit: unit`, those in the node's `unit`; none
    otherwise, since the tree then does not say which dataset fits. Some may be disabled
    (`field_reason`)."""
    if choices is None or "init" not in node.accepts or node.fit != "unit":
        return []
    return choices.for_unit(node.unit)


def usable_candidates(node: Node, choices: Choices | None) -> list[Candidate]:
    """The offered datasets that `node`'s WBM version reads and its own rule allows."""
    return [c for c in offered_candidates(node, choices) if field_reason(c, node.unit_contains) is None]


def _lacks(node: Node, choices: Choices | None) -> str | None:
    """What `node` lacks to be given a value from the model input, or None when it can be. A
    scalar starts at WBM's default; a dataset is a constant where the field takes a number, else
    chosen from the model input's datasets in the field's unit (a field with no unit has none to
    choose from). `unreadable` when the model input is needed and could not be read."""
    if node.type in SCALAR_TYPES:
        return None if node.default is not None else _NEEDS_DEFAULT
    if node.type == "dataset":
        if "number" in node.accepts:
            return None
        if "init" not in node.accepts:
            return _NEEDS_RASTER
        if node.fit != "unit":
            return _NEEDS_FIT
        if choices is None:
            return "unreadable"
        return None if usable_candidates(node, choices) else _NEEDS_DATASET
    return _NEEDS_FILE if node.type == "file" else _NEEDS_PART


def _join(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _decide(node: Node, required: tuple[str, ...], resolved: Resolved, choices: Choices | None) -> SwitchOn:
    if node.same_grid:  # this version stops unless the datasets share a grid, and the gateway cannot read one
        labels = [resolved.fields[p].label for p in node.same_grid if p in resolved.fields]
        return SwitchOn(
            False,
            f"WBM {resolved.version} needs the datasets of {_join(labels)} on one grid, "
            "which the gateway cannot check yet.",
        )
    if node.type in ("dataset", "file", "flag"):  # the module's own key holds the value
        lacks = _lacks(node, choices)
        if lacks is None:
            return SwitchOn(True)
        if lacks == "unreadable":
            return SwitchOn(False, _UNREADABLE)
        if node.type == "flag":
            return SwitchOn(False, "It needs files beside the network file, which the wizard cannot add.")
        if node.type == "file":
            return SwitchOn(False, "It needs a file of its own, which cannot be chosen here yet.")
        if lacks == _NEEDS_FIT:
            return SwitchOn(False, f"The tree does not say which dataset fits {node.label} ({node.path}).")
        return SwitchOn(False, f"It needs a dataset in {node.unit}, which the model input does not have.")
    lacking: dict[str, list[str]] = {}
    for path in required:
        field = resolved.fields.get(path)
        lacks = _lacks(field, choices) if field is not None else None
        if lacks == "unreadable":
            return SwitchOn(False, _UNREADABLE)
        if lacks is not None:
            unit = f", in {field.unit}" if lacks == _NEEDS_DATASET else ""
            lacking.setdefault(lacks, []).append(f"{field.label} ({path}{unit})")
    if not lacking:
        return SwitchOn(True)
    parts = []
    sentences = []
    if _NEEDS_FILE in lacking:
        parts.append("a file, which cannot be chosen here yet: " + ", ".join(lacking[_NEEDS_FILE]))
    elif _NEEDS_PART in lacking:  # a column or list names a part of such a file
        parts.append("a part of a file, which cannot be chosen here yet: " + ", ".join(lacking[_NEEDS_PART]))
    if _NEEDS_DATASET in lacking:
        parts.append("a dataset the model input does not have: " + ", ".join(lacking[_NEEDS_DATASET]))
    if _NEEDS_RASTER in lacking:
        parts.append("a raster, which cannot be chosen here yet: " + ", ".join(lacking[_NEEDS_RASTER]))
    if _NEEDS_DEFAULT in lacking:
        parts.append("a value that WBM has no default for: " + ", ".join(lacking[_NEEDS_DEFAULT]))
    if parts:
        sentences.append("It needs " + "; ".join(parts) + ".")
    if _NEEDS_FIT in lacking:
        sentences.append("The tree does not say which dataset fits " + ", ".join(lacking[_NEEDS_FIT]) + ".")
    return SwitchOn(False, " ".join(sentences))


def switch_on_decisions(
    resolved: Resolved, values: dict, choices: Choices | None
) -> dict[str, SwitchOn]:
    """For each module the snapshot's init has off and the tree lets the wizard switch (an
    `editable: switch_off` module): whether it can be switched on. It can when everything it
    requires can be given (`module_requirements`): a scalar starts at WBM's default, a dataset
    that accepts a data `.init` is chosen from the model input (one in the field's unit must be
    there, when the tree gives it a unit), one that accepts a number takes WBM's default
    constant. A required file, column, list or raster, a flag that needs files
    beside the network, and a required value WBM has no default for cannot be given. `choices`
    is None when the model input could not be read, which a module that needs a dataset is
    then refused for. A `required_if` child is not judged: it holds only for a form the wizard
    does not offer."""
    needs = module_requirements(resolved.version)
    return {
        path: _decide(node, needs.get(path, ()), resolved, choices)
        for path, node in resolved.fields.items()
        if node.kind == "module" and node.editable and module_state(path, values) == "off"
    }


def offered(decisions: dict[str, SwitchOn]) -> frozenset[str]:
    """The init paths of the modules `decisions` offers."""
    return frozenset(path for path, d in decisions.items() if d.offered)


def needs_choices(custom_params: Any, resolved: Resolved, values: dict) -> bool:
    """Whether `custom_params` names something of a module the snapshot has off (the module's own
    key, or a field inside it), which only the draft's model input can say is allowed."""
    for path in custom_params:
        node = resolved.fields.get(path)
        if node is None:
            continue
        modules = (*node.modules, node.path) if node.kind == "module" else node.modules
        if any(module_state(m, values) == "off" for m in modules):
            return True
    return False


# ---------------------------------------------------------------------------
# The contract's JSON
# ---------------------------------------------------------------------------


def _candidates_json(node: Node, choices: Choices) -> list[dict] | None:
    """The datasets `node` is offered (those in its unit), or None when there are none."""
    found = offered_candidates(node, choices)
    return [
        {
            "value": c.path, "name": c.name, "code": c.code, "time_series": c.time_series,
            "unit": c.unit, "disabled": field_reason(c, node.unit_contains), "repair": c.repair,
        }
        for c in found
    ] or None


def render(resolved: Resolved, values: dict, choices: Choices | None = None) -> list[dict]:
    """The resolved nodes as the `groups` of GET .../model-parameters. `choices` are the datasets
    of the snapshot's model input (None when not read): a module the snapshot has off carries
    whether it can be switched on, and a dataset field of one that can carries its candidates."""

    decisions = switch_on_decisions(resolved, values, choices)
    can_switch = offered(decisions)

    def default_of(node: Node):
        if node.default_from:
            ref = resolved.fields.get(node.default_from)
            if ref is not None:
                text = current_text(ref, values)
                return text if text is not None else default_of(ref)
        return node.default

    def picks(node: Node) -> bool:
        """Whether the field or module is given its dataset from the model input: it takes a
        data `.init`, and it sits in a module the same save switches on."""
        if choices is None or "init" not in node.accepts:
            return False
        off = [m for m in (*node.modules, *([node.path] if node.kind == "module" else [])) if module_state(m, values) == "off"]
        return bool(off) and all(m in can_switch for m in off)

    def forkable(node: Node) -> bool:
        """Whether the draft can edit this node's dataset as its own copy (a fork, ADR 0039): it takes a
        data `.init`, its modules are on or switched on by the same save, and no block above it is a
        file. Whether it holds one now is for the value to say."""
        if node.type != "dataset" or "init" not in node.accepts:
            return False
        modules = (*node.modules, *([node.path] if node.kind == "module" else []))
        return (
            all(module_state(m, values) == "on" or m in can_switch for m in modules)
            and not block_is_file(node.path, values)
        )

    def one(node: Node) -> dict:
        if node.kind == "group":
            return {
                "kind": "group", "key": node.key, "label": node.label, "doc": node.doc,
                "tier": node.tier, "children": [one(c) for c in node.children],
            }
        if node.kind == "module":
            state = module_state(node.path, values)
            decision = decisions.get(node.path)
            return {
                "kind": "module", "key": node.key, "name": node.label, "doc": node.doc,
                "tier": node.tier, "path": node.path, "state": state,
                "switch_off": node.editable and state == "on",
                "switch_on": decision.offered if decision else False,
                "switch_on_reason": decision.reason if decision else None,
                "edit_as": "number" if node.type == "dataset" and "number" in node.accepts else None,
                "forkable": forkable(node),
                # a module whose own key is the dataset (`openWaterEvap`) is switched on by choosing one
                "candidates": _candidates_json(node, choices) if node.type == "dataset" and picks(node) else None,
                "children": [one(c) for c in node.children],
            }
        options = available_options(node, values)
        candidates = _candidates_json(node, choices) if node.type == "dataset" and picks(node) else None
        return {
            "kind": "field", "key": node.key, "label": node.label, "doc": node.doc,
            "tier": node.tier, "path": node.path, "type": node.type,
            "editable": candidates is not None
            or editable_now(resolved, node, values, switchable=can_switch),
            "edit_as": node.edit_as,
            "forkable": forkable(node),
            "required": node.required,
            "candidates": candidates,
            "current": current_text(node, values),
            "default": default_of(node),
            "unit": node.unit,
            "options": [{"value": v, "label": label} for v, label in options] if options else None,
            "min": node.min, "max": node.max,
            "calibration": list(node.calibration) if node.calibration else None,
            "show_if": node.show_if,
        }

    return [one(g) for g in resolved.groups]
