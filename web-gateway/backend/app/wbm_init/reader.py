"""A reader of WBM's init, for the values the wizard shows as current.

A WBM init is a Perl hash literal that WBM's `read_init` `eval`s. This reads the dialect
the published inits use and returns it as nested dicts of strings, keys in file order:

* `key => value` entries; a key is a bareword or a quoted string;
* a value is a single- or double-quoted string, a bareword or number (kept as its text), or a
  nested `{ ... }` block;
* `#` comments, which run to the end of the line, and doubled or trailing commas;
* `key => ,` and a value left out before `}`, which `read_init` repairs to `''`, are `''`;
* a key written twice has the value of its last entry, as in Perl.

It reads only. The toolkit's editor (`openghm.wbm_init`) writes, and the backend must not
import it: this is a second, smaller reader of the same grammar, tested against it on the
published inits (tests/test_wbm_init_reader.py). Raises `InitSyntaxError` for anything else,
for example an array value.
"""

from __future__ import annotations

import re
from typing import Union

#: A parsed init value: a string, or a nested block.
Value = Union[str, dict]


class InitSyntaxError(ValueError):
    """The text is not a hash this reader understands."""


_SKIP = re.compile(r"(?:\s+|#[^\n]*)*")
_BARE = re.compile(r"[^\s{}\[\],=#'\";]+")
_DOUBLE_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "0": "\0", "\\": "\\", '"': '"'}


class _Reader:
    def __init__(self, text: str):
        self.t = text
        self.i = 0

    def fail(self, message: str, at: int | None = None) -> InitSyntaxError:
        at = self.i if at is None else at
        line = self.t.count("\n", 0, at) + 1
        return InitSyntaxError(f"cannot read the init: {message} (line {line})")

    def skip(self) -> str:
        """Pass whitespace and comments; the next character, or '' at the end."""
        self.i = _SKIP.match(self.t, self.i).end()
        return self.t[self.i] if self.i < len(self.t) else ""

    def root(self) -> dict:
        if self.skip() != "{":
            raise self.fail("an init must begin with '{'")
        block = self.block()
        if self.skip() == ";":
            self.i += 1
            self.skip()
        if self.i < len(self.t):
            raise self.fail("unexpected text after the closing '}'")
        return block

    def block(self) -> dict:
        start = self.i
        self.i += 1
        out: dict[str, Value] = {}
        while True:
            c = self.skip()
            while c == ",":
                self.i += 1
                c = self.skip()
            if c == "}":
                self.i += 1
                return out
            if c == "":
                raise self.fail("the '{' is never closed", start)
            key = self.string(c) if c in "'\"" else self.bare("a key")
            if self.skip() != "=" or not self.t.startswith("=>", self.i):
                raise self.fail(f"expected '=>' after the key {key!r}")
            self.i += 2
            c = self.skip()
            if c in (",", "}", ""):
                out[key] = ""  # `key => ,`: WBM reads it as `key => ''`
            elif c == "{":
                out[key] = self.block()
            elif c in "'\"":
                out[key] = self.string(c)
            elif c == "[":
                raise self.fail("an array value is not supported")
            else:
                out[key] = self.bare("a value")

    def bare(self, what: str) -> str:
        m = _BARE.match(self.t, self.i)
        if m is None:
            raise self.fail(f"expected {what}, found {self.t[self.i]!r}")
        self.i = m.end()
        return m.group(0)

    def string(self, quote: str) -> str:
        """The quoted string at `self.i`, escapes undone as Perl does for that quote."""
        t, n, start = self.t, len(self.t), self.i
        i, out = start + 1, []
        while i < n:
            c = t[i]
            if c == "\\" and i + 1 < n:
                nxt = t[i + 1]
                if quote == "'":
                    out.append(nxt if nxt in ("\\", "'") else c + nxt)
                else:
                    out.append(_DOUBLE_ESCAPES.get(nxt, nxt))
                i += 2
            elif c == quote:
                self.i = i + 1
                return "".join(out)
            else:
                out.append(c)
                i += 1
        raise self.fail("a string is never closed", start)


def read(text: str) -> dict:
    """The init as nested dicts of strings."""
    return _Reader(text).root()


def lookup(values: dict, path: str) -> Value | None:
    """The value at an init key path (`wbmParam.alpha`): a string or a block, or None when a
    key on the way is missing or is not a block."""
    node: Value | None = values
    for name in path.split("."):
        if not isinstance(node, dict) or name not in node:
            return None
        node = node[name]
    return node
