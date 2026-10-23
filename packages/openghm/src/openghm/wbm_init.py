"""Reading and editing a WBM init, and the changes file that edits one (ADR 0038).

A WBM init is a Perl hash literal that ``WBM.pm`` ``read_init`` ``eval``s::

    {
    ID       => 'wbm_test',
    MT_Code_Name => { Run_Start => '2000-01-01', Run_End => '2001-12-31' },   # a comment
    Output_vars => 'runoff
                    discharge',
    Var_Scale => ,
    }

This module has three parts.

1. **A reader** (:func:`parse`, :func:`to_python`) for the dialect the published inits use:
   ``key => value`` entries; a value is a single- or double-quoted string, a number, a
   bareword or a nested block; ``#`` comments; doubled and trailing commas; ``=> ,``, which
   ``read_init`` repairs (``s/=>\\s*,/=> '',/g``) and the reader takes as ``''``. Every key
   and value keeps its character span in the source.
2. **An editor** (:class:`InitEditor`) that works on those spans. It replaces a value, adds an
   entry at the end of its block, or removes an entry, and leaves every other byte of the text
   as it was. A value is written by fixed rules: a string as a single-quoted literal with ``\\``
   and ``'`` escaped; an integer or float the way Python writes it, which always has a leading
   digit (``0.5``, never ``.5``); an object as a block, one entry per line.
3. **The changes file** (:class:`Changes`, :func:`load_changes`, :func:`check_changes`,
   :func:`apply_changes`): ``code_version``, ``forks`` (copies of data ``.init`` files, ADR 0039),
   ``set`` (key path to value) and ``unset`` (key paths). The checks are the minimal ones of
   ADR 0038: they refuse what would make the file unusable, and nothing about whether a value
   suits the model.

A key path is names joined by dots, one per nested block (``MT_Code_Name.Run_End``).
"""

from __future__ import annotations

import json
import math
import os
import posixpath
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Tuple, Union

from .errors import OpenghmError


class InitSyntaxError(OpenghmError):
    """The init text is not a hash this reader understands."""


# ── the reader ─────────────────────────────────────────────────────────────────


@dataclass
class Scalar:
    """A value that is not a block. ``start``/``end`` is its span in the source.

    ``form`` is ``single`` or ``double`` (a quoted string), ``bare`` (a number or bareword),
    or ``empty`` (``=> ,``, an empty span just before the comma). ``value`` is the text it
    stands for: a string with its escapes undone, a bare value as written, ``''`` when empty.
    """

    start: int
    end: int
    form: str
    value: str


@dataclass
class Entry:
    """One ``key => value`` of a block. ``comma`` is the index of the comma that follows the
    value (``None`` for a last entry that has none)."""

    key: str
    key_start: int
    key_end: int
    value: Union["Block", Scalar]
    comma: Optional[int] = None


@dataclass
class Block:
    """A ``{ ... }`` hash. ``start`` is the index of its ``{``, ``end`` the index after its ``}``."""

    start: int
    end: int
    entries: List[Entry] = field(default_factory=list)

    def last(self, key: str) -> Optional[Entry]:
        """The entry perl keeps for ``key``: the last one written."""
        for e in reversed(self.entries):
            if e.key == key:
                return e
        return None


_BARE_RE = re.compile(r"[^\s{}\[\],=#'\";]+")


class _Parser:
    def __init__(self, text: str):
        self.t = text
        self.i = 0
        self.n = len(text)

    def fail(self, message: str, at: Optional[int] = None) -> "InitSyntaxError":
        at = self.i if at is None else at
        line = self.t.count("\n", 0, at) + 1
        col = at - (self.t.rfind("\n", 0, at) + 1) + 1
        return InitSyntaxError(f"cannot read the init: {message} (line {line}, column {col})")

    def skip(self) -> None:
        t, n = self.t, self.n
        while self.i < n:
            c = t[self.i]
            if c.isspace():
                self.i += 1
            elif c == "#":
                j = t.find("\n", self.i)
                self.i = n if j == -1 else j
            else:
                break

    def peek(self) -> str:
        return self.t[self.i] if self.i < self.n else ""

    def parse_root(self) -> Block:
        self.skip()
        if self.peek() != "{":
            raise self.fail("an init must begin with '{'")
        block = self.parse_block()
        self.skip()
        if self.peek() == ";":
            self.i += 1
            self.skip()
        if self.i < self.n:
            raise self.fail("unexpected text after the closing '}'")
        return block

    def parse_block(self) -> Block:
        start = self.i
        self.i += 1
        block = Block(start=start, end=start)
        while True:
            self.skip()
            while self.peek() == ",":
                self.i += 1
                self.skip()
            c = self.peek()
            if c == "}":
                self.i += 1
                block.end = self.i
                return block
            if c == "":
                raise self.fail("the '{' is never closed", at=start)
            block.entries.append(self.parse_entry())

    def parse_entry(self) -> Entry:
        key_start = self.i
        c = self.peek()
        if c in ("'", '"'):
            key, form = self.read_string(c)
        else:
            m = _BARE_RE.match(self.t, self.i)
            if m is None:
                raise self.fail(f"expected a key, found {c!r}")
            key = m.group(0)
            self.i = m.end()
        key_end = self.i
        self.skip()
        if not self.t.startswith("=>", self.i):
            raise self.fail(f"expected '=>' after the key {key!r}")
        self.i += 2
        self.skip()
        c = self.peek()
        if c in (",", "}", ""):
            # `key => ,` (WBM reads it as `key => ''`) or a value left out before the `}`
            value: Union[Block, Scalar] = Scalar(self.i, self.i, "empty", "")
        elif c == "{":
            value = self.parse_block()
        elif c in ("'", '"'):
            begin = self.i
            text, form = self.read_string(c)
            value = Scalar(begin, self.i, form, text)
        elif c == "[":
            raise self.fail("an array value is not supported")
        else:
            m = _BARE_RE.match(self.t, self.i)
            if m is None:
                raise self.fail(f"unexpected {c!r} where a value should be")
            value = Scalar(m.start(), m.end(), "bare", m.group(0))
            self.i = m.end()
        entry = Entry(key=key, key_start=key_start, key_end=key_end, value=value)
        self.skip()
        if self.peek() == ",":
            entry.comma = self.i
            self.i += 1
        return entry

    def read_string(self, quote: str) -> Tuple[str, str]:
        """The string at ``self.i`` (its opening quote), with ``self.i`` left after the closing one."""
        t, n = self.t, self.n
        start = self.i
        i = start + 1
        out: List[str] = []
        while i < n:
            c = t[i]
            if c == "\\" and i + 1 < n:
                nxt = t[i + 1]
                if quote == "'":
                    out.append(nxt if nxt in ("\\", "'") else c + nxt)
                else:
                    out.append(_DOUBLE_ESCAPES.get(nxt, nxt))
                i += 2
                continue
            if c == quote:
                self.i = i + 1
                return "".join(out), ("single" if quote == "'" else "double")
            out.append(c)
            i += 1
        raise self.fail("a string is never closed", at=start)


_DOUBLE_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "0": "\0", "\\": "\\", '"': '"'}


def parse(text: str) -> Block:
    """The init's top-level hash as a tree of :class:`Block`, :class:`Entry` and :class:`Scalar`,
    each with its span in ``text``. Raises :class:`InitSyntaxError` on anything it cannot read."""
    return _Parser(text).parse_root()


def to_python(text: str) -> dict:
    """The init as nested dicts of strings, keys in file order. A key written twice has the value
    of its last entry, as in perl."""
    return _plain(parse(text))


def _plain(block: Block) -> dict:
    out: Dict[str, Any] = {}
    for e in block.entries:
        out[e.key] = _plain(e.value) if isinstance(e.value, Block) else e.value.value
    return out


def lookup(text: str, path: str) -> Union[Block, Scalar, None]:
    """The value at key ``path`` of the init ``text``, or ``None`` when a key on the way is missing
    or is not a block."""
    node: Union[Block, Scalar, None] = parse(text)
    for key in split_path(path):
        if not isinstance(node, Block):
            return None
        entry = node.last(key)
        if entry is None:
            return None
        node = entry.value
    return node


def read_scalar(text: str, path: str) -> Optional[str]:
    """The string value at ``path``, or ``None`` when there is none or it is a block."""
    node = lookup(text, path)
    return node.value if isinstance(node, Scalar) else None


# ── key paths and values ───────────────────────────────────────────────────────

_PATH_RE = re.compile(r"^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$", re.ASCII)
_KEY_RE = re.compile(r"^[A-Za-z_]\w*$", re.ASCII)


def split_path(path: str) -> List[str]:
    """The names of a key path. Raises :class:`OpenghmError` naming the path when it is malformed."""
    if not isinstance(path, str) or not _PATH_RE.match(path):
        raise OpenghmError(
            f"{path!r} is not an init key path: names made of letters, digits and '_', "
            "not starting with a digit, joined by '.' (for example MT_Code_Name.Run_End)"
        )
    return path.split(".")


class _Raw(str):
    """Text written into the init as it is (a literal copied from the source)."""


def format_value(value: Any, indent: str = "", unit: str = "  ", *, label: str = "value") -> str:
    """``value`` as init text, by the writer rules of ADR 0038.

    * ``str``: a single-quoted literal, ``\\`` and ``'`` escaped;
    * ``int``, ``float``: written as Python writes them (a leading digit, ``0.5``);
    * ``dict``: a block, one entry per line, each indented by ``unit`` more than ``indent``;
    * a ``bool``, ``None``, a list or any other type is an error, naming ``label``.
    """
    if isinstance(value, _Raw):
        return str(value)
    if isinstance(value, bool):
        raise OpenghmError(f"{label}: a boolean is not allowed (write 0 or 1)")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise OpenghmError(f"{label}: {value!r} is not a number WBM can read")
        return repr(value)
    if isinstance(value, str):
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"
    if isinstance(value, dict):
        if not value:
            return "{}"
        inner = indent + unit
        lines = []
        for k, v in value.items():
            if not isinstance(k, str) or not _KEY_RE.match(k):
                raise OpenghmError(f"{label}: {k!r} is not a valid init key")
            lines.append(f"{inner}{k} => {format_value(v, inner, unit, label=f'{label}.{k}')},\n")
        return "{\n" + "".join(lines) + indent + "}"
    if value is None:
        raise OpenghmError(f"{label}: null is not allowed (use unset to remove a key)")
    raise OpenghmError(f"{label}: a {type(value).__name__} is not allowed (use a string, a number or an object)")


# ── the editor ─────────────────────────────────────────────────────────────────

_SPINUP_FLAT = re.compile(r"^spinup_", re.IGNORECASE)
#: The flat key's name after ``spinup_`` (lower case) → its name in the ``Spinup`` block.
_SPINUP_NAMES = {"start": "Start", "end": "End", "loops": "Loops", "state_id": "State_ID"}


def _line_indent(text: str, index: int) -> str:
    """The leading whitespace of the line that holds ``index``."""
    start = text.rfind("\n", 0, index) + 1
    return re.match(r"[ \t]*", text[start:]).group(0)


def _unit(indent: str) -> str:
    return "\t" if "\t" in indent else "  "


class InitEditor:
    """Edits an init's text in place. ``text`` is the result so far.

    Every method re-reads ``text``, edits the spans it finds and leaves the rest as it was.
    With ``convert_spinup`` (the default), the first :meth:`set` or :meth:`unset` first turns
    flat ``Spinup_*`` keys into a ``Spinup`` block (see :meth:`convert_flat_spinup`).
    """

    def __init__(self, text: str, *, convert_spinup: bool = True):
        self.text = text
        self._convert = convert_spinup

    # -- helpers ---------------------------------------------------------------

    @property
    def _nl(self) -> str:
        return "\r\n" if "\r\n" in self.text else "\n"

    def _fit(self, s: str) -> str:
        """``s`` with this text's line ending."""
        return s if self._nl == "\n" else s.replace("\n", self._nl)

    def _prepare(self) -> None:
        if self._convert:
            self._convert = False
            self.convert_flat_spinup()

    # -- set -------------------------------------------------------------------

    def set(self, path: str, value: Any) -> None:
        """Set the value at key ``path``: replace it, or add it (and any block on the way) at the
        end of the block that holds it.

        A scalar on the way is an error unless it is empty (``''``, ``""`` or ``=> ,``), when the
        block replaces it: a non-empty string needs the whole block written as an object, and
        one that holds a ``/`` is a block file, which is not edited.
        """
        keys = split_path(path)
        format_value(value, label=f"set {path!r}")           # refuse a bad value before editing
        self._prepare()
        block = parse(self.text)
        for depth, key in enumerate(keys[:-1]):
            entry = block.last(key)
            rest = keys[depth + 1:]
            nested: Any = value
            for k in reversed(rest):
                nested = {k: nested}
            if entry is None:
                self._insert(block, key, nested)
                return
            node = entry.value
            if isinstance(node, Block):
                block = node
                continue
            if node.value == "":
                self._replace(node, nested, _line_indent(self.text, entry.key_start))
                return
            here = ".".join(keys[:depth + 1])
            if "/" in node.value:
                raise OpenghmError(
                    f"cannot set {path!r}: {here!r} is a block file ({node.value!r}), and block files "
                    "cannot be edited"
                )
            raise OpenghmError(
                f"cannot set {path!r}: {here!r} is the string {node.value!r}, not a block; "
                f"to change it write the whole block as an object (set {here!r} to an object)"
            )
        entry = block.last(keys[-1])
        if entry is None:
            self._insert(block, keys[-1], value)
        else:
            self._replace(entry.value, value, _line_indent(self.text, entry.key_start))

    def _replace(self, node: Union[Block, Scalar], value: Any, indent: str) -> None:
        start, end = (node.start, node.end)
        new = self._fit(format_value(value, indent, _unit(indent)))
        self.text = self.text[:start] + new + self.text[end:]

    def _insert(self, block: Block, key: str, value: Any) -> None:
        """Add ``key => value,`` at the end of ``block``, in the layout of the entry before it."""
        text = self.text
        if not block.entries:
            self._insert_first(block, key, value)
            return
        last = block.entries[-1]
        entry_end = last.value.end
        after = entry_end if last.comma is None else last.comma + 1
        indent = _line_indent(text, last.key_start)
        unit = _unit(indent)
        literal = f"{key} => {format_value(value, indent, unit, label=key)}"
        eol = text.find("\n", after)
        eol = len(text) if eol == -1 else eol
        tail_end = eol - 1 if eol > after and text[eol - 1] == "\r" else eol
        tail = text[after:tail_end]
        close = block.end - 1
        own_line = close >= eol and (tail.strip() == "" or tail.lstrip().startswith("#"))
        if own_line:
            comma = "," if last.comma is None else ""
            self.text = (
                text[:entry_end] + comma + text[entry_end:tail_end]
                + self._nl + self._fit(indent + literal) + "," + text[tail_end:]
            )
        elif last.comma is None:
            self.text = text[:entry_end] + self._fit(", " + literal) + text[entry_end:]
        else:
            self.text = text[:after] + self._fit(" " + literal + ",") + text[after:]

    def _insert_first(self, block: Block, key: str, value: Any) -> None:
        text = self.text
        own = _line_indent(text, block.start)
        child = own + _unit(own)
        literal = f"{key} => {format_value(value, child, _unit(child), label=key)},"
        inside = text[block.start + 1:block.end - 1]
        if inside.strip() == "":
            self.text = (
                text[:block.start + 1] + self._nl + self._fit(child + literal) + self._nl + own
                + text[block.end - 1:]
            )
        else:                                   # only comments inside: keep them
            self.text = text[:block.start + 1] + self._nl + self._fit(child + literal) + text[block.start + 1:]

    # -- unset -----------------------------------------------------------------

    def unset(self, path: str) -> None:
        """Remove the entry at key ``path`` (every one written, if it is there twice) and the comma
        that separated it. A key that is not there is left alone."""
        keys = split_path(path)
        self._prepare()
        while True:
            found = self._find(keys)
            if found is None:
                return
            self._remove(*found)

    def _find(self, keys: List[str]) -> Optional[Tuple[Block, int]]:
        block = parse(self.text)
        for key in keys[:-1]:
            entry = block.last(key)
            if entry is None or not isinstance(entry.value, Block):
                return None
            block = entry.value
        for i in range(len(block.entries) - 1, -1, -1):
            if block.entries[i].key == keys[-1]:
                return block, i
        return None

    def _remove(self, block: Block, index: int) -> None:
        text = self.text
        entry = block.entries[index]
        start = entry.key_start
        end = entry.value.end if entry.comma is None else entry.comma + 1
        line_start = text.rfind("\n", 0, start) + 1
        eol = text.find("\n", end)
        has_eol = eol != -1
        eol = len(text) if not has_eol else eol
        tail = text[end:eol].rstrip("\r")
        alone = text[line_start:start].strip() == "" and (tail.strip() == "" or tail.lstrip().startswith("#"))
        if alone:
            lo, hi = line_start, eol + 1 if has_eol else eol
        else:
            lo, hi = start, re.compile(r"[ \t]*").match(text, end).end()
        out = text[:lo] + text[hi:]
        if entry.comma is None and index > 0 and block.entries[index - 1].comma is not None:
            # it was the last entry, written without a comma: the one before it loses its comma too
            c = block.entries[index - 1].comma
            out = out[:c] + out[c + 1:]
        self.text = out

    # -- flat spinup keys ------------------------------------------------------

    def convert_flat_spinup(self) -> None:
        """Turn the flat top-level ``Spinup_Start``, ``Spinup_End``, ``Spinup_Loops`` and
        ``spinup_state_ID`` (any case of ``spinup_…``) into one ``Spinup => { Start, End, Loops,
        State_ID }`` block, in the place of the first flat key, with the values as written.
        Both WBM versions stop on the flat keys ("Obsolete spinup parameters input"). A ``Spinup``
        block the init already has takes the ones it lacks. Nothing changes without flat keys."""
        root = parse(self.text)
        flat = [e for e in root.entries if _SPINUP_FLAT.match(e.key)]
        if not flat:
            return
        text = self.text
        values: Dict[str, str] = {}
        for e in flat:
            name = _SPINUP_NAMES.get(e.key[len("spinup_"):].lower(), e.key[len("spinup_"):])
            v = e.value
            raw = text[v.start:v.end] if isinstance(v, Block) or v.form != "empty" else ""
            values[name] = raw if raw.strip() else "''"
        existing = root.last("Spinup")
        first = flat[0]
        if existing is None:
            ind = _line_indent(text, first.key_start)
            inner = ind + _unit(ind)
            body = "".join(f"{inner}{k} => {v},\n" for k, v in values.items())
            new = self._fit(f"Spinup => {{\n{body}{ind}}}")
            self.text = text[:first.key_start] + new + text[first.value.end:]
            flat_keys = [e.key for e in flat[1:]]
        else:
            node = existing.value
            if isinstance(node, Block):
                present = {e.key for e in node.entries}
                for name, raw in values.items():
                    if name not in present:
                        self._insert(parse(self.text).last("Spinup").value, name, _Raw(raw))
            elif node.value == "":
                ind = _line_indent(text, existing.key_start)
                self._replace(node, {k: _Raw(v) for k, v in values.items()}, ind)
            else:
                raise OpenghmError(
                    f"cannot turn {first.key!r} into a Spinup block: the init already has "
                    f"Spinup => {node.value!r}"
                )
            flat_keys = [e.key for e in flat]
        for key in flat_keys:
            while True:
                block = parse(self.text)
                idx = [i for i, e in enumerate(block.entries) if e.key == key]
                if not idx:
                    break
                self._remove(block, idx[-1])


# ── the changes file ───────────────────────────────────────────────────────────


@dataclass
class Fork:
    """A copy of a data ``.init`` the run reads, with some keys set (ADR 0039).

    ``source`` (``from`` in the file) is a container path under ``/wbm/data/`` or
    ``/wbm/data_init/``; ``to`` is the copy's, under ``/wbm/wbm_init/``; ``set`` maps top-level
    descriptor keys to a string or a number. The run init is pointed at ``to`` by an ordinary
    ``set`` of the changes file, not by the fork.
    """

    source: str
    to: str
    set: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        """The fork's JSON: ``from``, ``to``, and ``set`` only when it has something in it."""
        out: Dict[str, Any] = {"from": self.source, "to": self.to}
        if self.set:
            out["set"] = self.set
        return out


@dataclass
class Changes:
    """A changes file: edits to a snapshot's init, for the WBM ``code_version`` it was written for."""

    code_version: str
    #: Key path → value (a string, a number, or an object written as a block).
    set: Dict[str, Any] = field(default_factory=dict)
    #: Key paths to remove.
    unset: List[str] = field(default_factory=list)
    #: Copies of data ``.init`` files, made before ``set`` and ``unset`` are applied.
    forks: List[Fork] = field(default_factory=list)

    def to_dict(self) -> dict:
        """The file's JSON: ``forks``, ``set`` and ``unset`` only when they have something in them."""
        out: Dict[str, Any] = {"code_version": self.code_version}
        if self.forks:
            out["forks"] = [f.to_dict() for f in self.forks]
        if self.set:
            out["set"] = self.set
        if self.unset:
            out["unset"] = list(self.unset)
        return out


_CHANGES_FIELDS = ("code_version", "forks", "set", "unset")
_FORK_FIELDS = ("from", "to", "set")


def load_changes(source: Union[str, "os.PathLike[str]", dict]) -> Changes:
    """A :class:`Changes` from a JSON file (a path) or an already-read dict.

    Shape: ``{"code_version": "23.9.0", "forks": [{"from": "/wbm/data_init/x.init", "to":
    "/wbm/wbm_init/datasets/x__1.init", "set": {"Var_Scale": 1.1}}], "set": {"Key.Path": value, ...},
    "unset": ["Key.Path"]}``; ``code_version`` is required, ``forks``, ``set`` and ``unset`` are
    optional. Any other top-level field is an error. Whether the paths and values are fit to write is :func:`check_changes`.
    """
    label = "changes"
    if isinstance(source, dict):
        data: Any = source
    else:
        label = f"changes file {os.fspath(source)}"
        try:
            with open(source, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError) as e:
            raise OpenghmError(f"cannot read the {label}: {e}")
    if not isinstance(data, dict):
        raise OpenghmError(f"the {label} must be a JSON object with code_version, set and unset")
    unknown = sorted(k for k in data if k not in _CHANGES_FIELDS)
    if unknown:
        raise OpenghmError(
            f"the {label} has unknown field(s) {', '.join(repr(k) for k in unknown)}; "
            f"the fields are {', '.join(_CHANGES_FIELDS)}"
        )
    version = data.get("code_version")
    if not isinstance(version, str) or not version.strip():
        raise OpenghmError(f"the {label} needs code_version, the snapshot's WBM version (a string such as \"23.9.0\")")
    sets = data.get("set", {})
    if not isinstance(sets, dict):
        raise OpenghmError(f"the {label}: set must be an object of key path to value")
    unsets = data.get("unset", [])
    if not isinstance(unsets, list) or not all(isinstance(p, str) for p in unsets):
        raise OpenghmError(f"the {label}: unset must be a list of key paths")
    return Changes(code_version=version, set=dict(sets), unset=list(unsets), forks=_load_forks(data.get("forks", []), label))


def _load_forks(raw: Any, label: str) -> List[Fork]:
    if not isinstance(raw, list) or not all(isinstance(f, dict) for f in raw):
        raise OpenghmError(f"the {label}: forks must be a list of objects with from, to and set")
    forks = []
    for i, item in enumerate(raw):
        unknown = sorted(k for k in item if k not in _FORK_FIELDS)
        if unknown:
            raise OpenghmError(
                f"the {label}: forks[{i}] has unknown field(s) {', '.join(repr(k) for k in unknown)}; "
                f"the fields are {', '.join(_FORK_FIELDS)}"
            )
        for name in ("from", "to"):
            if not isinstance(item.get(name), str) or not item[name]:
                raise OpenghmError(f"the {label}: forks[{i}] needs {name}, a container path (a string)")
        sets = item.get("set", {})
        if not isinstance(sets, dict):
            raise OpenghmError(f"the {label}: forks[{i}].set must be an object of descriptor key to value")
        forks.append(Fork(source=item["from"], to=item["to"], set=dict(sets)))
    return forks


#: Top-level keys both WBM versions stop on when they merely exist (``WBM.pm`` lines 281-282, 22.1.1: 258-259).
_FATAL_TOP = ("FreeWaterEvap", "MT_relHumidity")
_LEGACY_VERSION = "22.1.1"


def _nodes(path: str, value: Any) -> Iterator[Tuple[str, Any]]:
    """``(key path, value)`` of a ``set`` entry and, for an object value, of every key under it."""
    yield path, value
    if isinstance(value, dict):
        for k, v in value.items():
            yield from _nodes(f"{path}.{k}", v)


def _check_text(where: str, text: str) -> None:
    for ch in text:
        if ord(ch) > 127:
            raise OpenghmError(
                f"{where}: {text!r} has a non-ASCII character ({ch!r}); WBM can stop on a non-ASCII "
                "byte in an init, so keys and values must be ASCII"
            )


def check_changes(changes: Changes, code_version_of_snapshot: str) -> None:
    """Refuse a changes file that cannot be used, naming the key. Raises :class:`OpenghmError`
    for:

    * a ``code_version`` that is not ``code_version_of_snapshot`` (``uses.modelCode.version``);
    * a key path that is malformed, or a non-ASCII character in a key or a string value;
    * a value that is not a string, a number or an object;
    * a fork that :func:`check_forks` refuses;
    * keys fatal for WBM, on both versions: a top-level ``FreeWaterEvap``, ``MT_relHumidity`` or
      ``spinup_*`` (any case); on 22.1.1 only: ``Spinup.Save_Vars``, ``PET`` as an object or any
      ``PET.<child>``, and a ``Time_Series`` value with a ``[`` in it.

    ``unset`` paths are only checked for syntax and ASCII: removing a key is never fatal.
    """
    if changes.code_version != code_version_of_snapshot:
        raise OpenghmError(
            f"the changes file's code_version {changes.code_version!r} is not this snapshot's "
            f"WBM version {code_version_of_snapshot!r} (uses.modelCode.version)"
        )
    check_forks(changes.forks)
    legacy = code_version_of_snapshot == _LEGACY_VERSION
    for path in changes.unset:
        _check_text("unset", path)
        split_path(path)
    for path, value in changes.set.items():
        for node_path, node in _nodes(path, value):          # ASCII first, so a non-ASCII key says so
            _check_text(f"set {node_path!r}", node_path)
            if isinstance(node, str):
                _check_text(f"set {node_path!r}", node)
        split_path(path)
        format_value(value, label=f"set {path!r}")           # a bool, null, a list or a bad object key
        first = path.split(".")[0]
        if first in _FATAL_TOP:
            raise OpenghmError(f"set {path!r}: WBM stops on {first} ({_FATAL_WHY[first]})")
        if _SPINUP_FLAT.match(first):
            raise OpenghmError(
                f"set {path!r}: WBM stops on a flat {first} key (\"Obsolete spinup parameters "
                "input\"); set it under Spinup, for example Spinup.Start"
            )
        for node_path, node in _nodes(path, value):
            if not legacy:
                continue
            parts = node_path.split(".")
            if node_path == "Spinup.Save_Vars":
                raise OpenghmError(
                    f"set {node_path!r}: WBM {_LEGACY_VERSION} stops on Spinup.Save_Vars, even when it is 0"
                )
            if (node_path == "PET" and isinstance(node, dict)) or node_path.startswith("PET."):
                raise OpenghmError(
                    f"set {node_path!r}: WBM {_LEGACY_VERSION} does not take PET as a block "
                    "(PET is a single value there)"
                )
            if parts[-1] == "Time_Series" and isinstance(node, str) and "[" in node:
                raise OpenghmError(
                    f"set {node_path!r}: WBM {_LEGACY_VERSION} stops on a Time_Series with '[' "
                    f"in it ({node!r})"
                )


_FATAL_WHY = {
    "FreeWaterEvap": "a removed key: WBM stops when the init has it, even as ''",
    "MT_relHumidity": "a removed key: WBM stops when the init has it, even as ''",
}


# ── forks ──────────────────────────────────────────────────────────────────────

#: Where a fork's original may be (the model input's root and its ``data_init/``) and where its
#: copy goes (the run's own ``wbm_init/``): the container paths ``sim`` binds.
FORK_FROM_ROOTS = ("/wbm/data/", "/wbm/data_init/")
FORK_TO_ROOT = "/wbm/wbm_init/"
_FORK_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.init$", re.ASCII)

#: What NFKD leaves non-ASCII, and its ASCII spelling (ADR 0039). Anything else is refused.
_ASCII_TABLE = {
    **{c: "-" for c in "\u2010\u2011\u2012\u2013\u2014\u2015\u2212"},
    **{c: "'" for c in "\u2018\u2019\u201a\u201b"},
    **{c: '"' for c in "\u201c\u201d\u201e"},
    "\u2026": "...", "\u00b0": "deg", "\u00b5": "u", "\u03bc": "u", "\u00d7": "x", "\u00b1": "+/-",
    "\u00df": "ss", "\u00e6": "ae", "\u00c6": "AE", "\u0153": "oe", "\u0152": "OE",
    "\u00f8": "o", "\u00d8": "O", "\u0111": "d", "\u0110": "D", "\u0142": "l", "\u0141": "L",
}


def to_ascii(text: str, label: str = "the text") -> str:
    """``text`` as ASCII: NFKD with the combining marks dropped (``o`` for ``\u00f6``), then
    :data:`_ASCII_TABLE` for what does not decompose. Raises :class:`OpenghmError` naming the
    character and its line when one has no spelling: it is never replaced by ``?``."""
    if text.isascii():
        return text
    out: List[str] = []
    for ch in text:
        spelled = ch if ord(ch) < 128 else _spell(ch)
        if spelled is None:
            line = text.count("\n", 0, text.index(ch)) + 1
            raise OpenghmError(
                f"{label}: {ch!r} (U+{ord(ch):04X}, line {line}) has no ASCII spelling; "
                "the toolkit does not guess one"
            )
        out.append(spelled)
    return "".join(out)


def _spell(ch: str) -> Optional[str]:
    """The ASCII spelling of one non-ASCII character, or ``None``. A combining mark has none to
    write (``""``): it is dropped with the decomposition of the letter it sat on."""
    if ch in _ASCII_TABLE:
        return _ASCII_TABLE[ch]
    out: List[str] = []
    for c in unicodedata.normalize("NFKD", ch):
        if unicodedata.combining(c):
            continue
        if ord(c) < 128:
            out.append(c)
        elif c in _ASCII_TABLE:
            out.append(_ASCII_TABLE[c])
        else:
            return None
    return "".join(out)


def _fork_path(label: str, path: str, roots: Tuple[str, ...]) -> None:
    if not path.startswith(roots) or path != posixpath.normpath(path) or ".." in path.split("/"):
        raise OpenghmError(
            f"{label} {path!r} is not a normalised container path under {' or '.join(roots)} "
            "(no '..', no '//', no trailing '/')"
        )
    if not path.endswith(".init"):
        raise OpenghmError(f"{label} {path!r} is not an .init file")


def check_forks(forks: List[Fork]) -> None:
    """Refuse a fork that cannot be made, naming it. Raises :class:`OpenghmError` for:

    * ``from`` that is not an ``.init`` under ``/wbm/data/`` or ``/wbm/data_init/``, or ``to`` that
      is not one under ``/wbm/wbm_init/`` (normalised, no ``..``), or a ``to`` basename that is not
      letters, digits, ``.``, ``_`` and ``-``;
    * a ``set`` key that is not a plain top-level name, ``Code_Name`` (the toolkit sets it), or a
      value that is not a string or a number, or a string that is not ASCII;
    * two forks with the same ``to``.

    That the original exists, is a descriptor and that ``to`` is free are checked where the
    model input and the snapshot are known (``sim``).
    """
    seen = set()
    for i, fork in enumerate(forks):
        where = f"forks[{i}]"
        _fork_path(f"{where}: from", fork.source, FORK_FROM_ROOTS)
        _fork_path(f"{where}: to", fork.to, (FORK_TO_ROOT,))
        if not _FORK_NAME_RE.match(posixpath.basename(fork.to)):
            raise OpenghmError(
                f"{where}: to {fork.to!r} must end in a file name of letters, digits, '.', '_' and '-' "
                "ending in .init (it becomes the copy's Code_Name)"
            )
        if fork.to in seen:
            raise OpenghmError(f"{where}: to {fork.to!r} is the copy of another fork too")
        seen.add(fork.to)
        for key, value in fork.set.items():
            label = f"{where}: set {key!r}"
            if not isinstance(key, str) or not _KEY_RE.match(key):
                raise OpenghmError(f"{label}: not a descriptor key (a plain name; keys are top level)")
            if key == "Code_Name":
                raise OpenghmError(f"{label}: Code_Name is the copy's file name, which the toolkit sets")
            if isinstance(value, (dict, list)):
                raise OpenghmError(f"{label}: a descriptor value is a string or a number, not a {type(value).__name__}")
            format_value(value, label=label)                 # a bool, null or a number WBM cannot read
            if isinstance(value, str):
                _check_text(label, value)


def fork_source_path(model_input_dir: str, source: str) -> str:
    """The host path of ``source`` (a container path of ``/wbm/data/`` or ``/wbm/data_init/``) in
    the model input at ``model_input_dir``: ``/wbm/data/`` is its root and ``/wbm/data_init/`` its
    ``data_init/``, so ``/wbm/data/data_init/x`` and ``/wbm/data_init/x`` are one file."""
    if source.startswith("/wbm/data_init/"):
        return os.path.join(model_input_dir, "data_init", *source[len("/wbm/data_init/"):].split("/"))
    return os.path.join(model_input_dir, *source[len("/wbm/data/"):].split("/"))


def fork_text(original: str, fork: Fork) -> str:
    """The text of ``fork``'s copy: ``original`` as ASCII, ``fork.set`` written by the editor's
    rules, and ``Code_Name`` the copy's file name without ``.init`` (what WBM 23.9.0 requires of a
    data ``.init``). Raises :class:`OpenghmError` when ``original`` is not an init or has no
    ``Code_Name``: a block file is not a dataset descriptor and is not forked."""
    text = to_ascii(original, f"the original {fork.source}")
    try:
        entry = parse(text).last("Code_Name")
    except InitSyntaxError as e:
        raise OpenghmError(f"the original {fork.source}: {e}")
    if entry is None or not isinstance(entry.value, Scalar):
        raise OpenghmError(f"the original {fork.source} has no Code_Name, so it is not a dataset descriptor")
    ed = InitEditor(text, convert_spinup=False)
    for key, value in fork.set.items():
        ed.set(key, value)
    ed.set("Code_Name", posixpath.basename(fork.to)[:-len(".init")])
    return ed.text


def apply_changes(text: str, changes: Changes) -> str:
    """The init ``text`` with ``changes`` applied: flat ``Spinup_*`` keys converted first, then every
    ``unset`` path removed, then every ``set`` path written, in the order they are listed. Does not
    check the changes (:func:`check_changes` does). Without any change, ``text`` itself."""
    if not changes.set and not changes.unset:
        return text
    ed = InitEditor(text)
    ed.convert_flat_spinup()
    for path in changes.unset:
        ed.unset(path)
    for path, value in changes.set.items():
        ed.set(path, value)
    return ed.text


def touches(changes: Optional[Changes], path: str) -> bool:
    """Whether ``changes`` set or unset ``path``, a block that holds it, or a key under it."""
    if changes is None:
        return False
    for p in [*changes.set, *changes.unset]:
        if p == path or path.startswith(p + ".") or p.startswith(path + "."):
            return True
    return False
