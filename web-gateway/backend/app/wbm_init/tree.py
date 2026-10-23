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
            )
            fields[path] = node
            out.append(node)
        return out

    groups = build(doc["tree"], None, False, False, False, ())
    return Resolved(version, tuple(groups), fields, refused)


# ---------------------------------------------------------------------------
# Values read from an init
# ---------------------------------------------------------------------------


def _filled(value: Any) -> bool:
    """Whether an init value is something: not missing, '', '0' or an empty block."""
    return value not in (None, "", "0", {})


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


def editable_now(resolved: Resolved, node: Node, values: dict, pending_off: frozenset = frozenset()) -> bool:
    """Whether a custom parameter may set `node`: the tree allows it, every module it is inside is
    on (and not being switched off in the same save, `pending_off`), and no block above it is
    a file reference."""
    if not node.editable:
        return False
    if node.kind == "module":
        return module_state(node.path, values) == "on"
    return (
        all(module_state(m, values) == "on" and m not in pending_off for m in node.modules)
        and not block_is_file(node.path, values)
    )


# ---------------------------------------------------------------------------
# The contract's JSON
# ---------------------------------------------------------------------------


def render(resolved: Resolved, values: dict) -> list[dict]:
    """The resolved nodes as the `groups` of GET .../model-parameters."""

    def default_of(node: Node):
        if node.default_from:
            ref = resolved.fields.get(node.default_from)
            if ref is not None:
                text = current_text(ref, values)
                return text if text is not None else default_of(ref)
        return node.default

    def one(node: Node) -> dict:
        if node.kind == "group":
            return {
                "kind": "group", "key": node.key, "label": node.label, "doc": node.doc,
                "tier": node.tier, "children": [one(c) for c in node.children],
            }
        if node.kind == "module":
            state = module_state(node.path, values)
            return {
                "kind": "module", "key": node.key, "name": node.label, "doc": node.doc,
                "tier": node.tier, "path": node.path, "state": state,
                "switch_off": node.editable and state == "on",
                "children": [one(c) for c in node.children],
            }
        options = available_options(node, values)
        return {
            "kind": "field", "key": node.key, "label": node.label, "doc": node.doc,
            "tier": node.tier, "path": node.path, "type": node.type,
            "editable": editable_now(resolved, node, values),
            "edit_as": node.edit_as,
            "current": current_text(node, values),
            "default": default_of(node),
            "unit": node.unit,
            "options": [{"value": v, "label": label} for v, label in options] if options else None,
            "min": node.min, "max": node.max,
            "calibration": list(node.calibration) if node.calibration else None,
            "show_if": node.show_if,
        }

    return [one(g) for g in resolved.groups]
