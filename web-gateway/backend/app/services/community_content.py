"""What the Community page's content may contain (ADR 0034).

Everything an admin writes is checked here on the way in, so what is stored and
later rendered is already known to be safe: the frontend draws rich text with
its own React renderer and never sets raw HTML, but a stored `javascript:` link
would still run when clicked, so the link and image rules are enforced on the
server and not only in the editor.

Pure functions, no database and no request object. Each raises ValueError with
a sentence for the person writing; the pydantic models in
app.models.community turn that into a 422.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone

# ---- limits --------------------------------------------------------------

RICH_TEXT_MAX_BYTES = 512 * 1024
#: doc > blockquote > list > item > list > item > ... A real document is a
#: handful of levels deep; this bounds the recursion for a hostile one.
RICH_TEXT_MAX_DEPTH = 24
URL_MAX_LENGTH = 2048
SLUG_MAX_LENGTH = 80

#: Where an uploaded file is served, as stored in content (the Next.js route
#: that proxies GET /api/v1/community/files/{id}).
FILE_URL_PREFIX = "/api/community/files/"

_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_FILE_URL_RE = re.compile(r"^/api/community/files/[0-9a-f]{24}$")
#: Whitespace, control characters and backslash. A browser reads `/\evil.com`
#: as `//evil.com`, and strips tabs and newlines out of `java\tscript:`.
_FORBIDDEN_URL_CHARS = re.compile(r"[\s\x00-\x1f\x7f\\]")
_LANGUAGE_RE = re.compile(r"^[A-Za-z0-9_+#.-]{0,32}$")


# ---- slug, date, URL -----------------------------------------------------


def check_slug(value: str) -> str:
    if len(value) > SLUG_MAX_LENGTH or not _SLUG_RE.fullmatch(value):
        raise ValueError(
            f"Use lowercase letters, digits and single hyphens, at most {SLUG_MAX_LENGTH} "
            "characters (for example 'first-openghm-workshop')."
        )
    return value


def check_iso_date(value: str) -> str:
    """YYYY-MM-DD and a real calendar day."""
    if not _DATE_RE.fullmatch(value):
        raise ValueError("Use the form YYYY-MM-DD.")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ValueError("That is not a calendar date.") from None
    return value


def _check_url_text(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("An address is required.")
    if len(value) > URL_MAX_LENGTH:
        raise ValueError(f"An address is at most {URL_MAX_LENGTH} characters.")
    if _FORBIDDEN_URL_CHARS.search(value):
        raise ValueError("An address cannot contain spaces, control characters or backslashes.")
    return value


def _has_host(value: str) -> bool:
    rest = value.split("://", 1)[1]
    host = re.split(r"[/?#]", rest, maxsplit=1)[0].rsplit("@", 1)[-1]
    return bool(host) and not host.startswith(":")


def check_link_url(value: object) -> str:
    """A link a reader may follow: http(s)://, mailto:, or a path on this site
    that starts with `/` (never `//`, which is another host)."""
    value = _check_url_text(value)
    low = value.lower()
    if low.startswith(("http://", "https://")):
        if not _has_host(value):
            raise ValueError("The address has no host.")
        return value
    if low.startswith("mailto:") and len(value) > len("mailto:"):
        return value
    if value.startswith("/") and not value.startswith("//"):
        return value
    raise ValueError("Use an http(s):// or mailto: address, or a path that starts with a single '/'.")


def check_image_url(value: object) -> str:
    """An image: https://, or a file uploaded to the Community page."""
    value = _check_url_text(value)
    if value.lower().startswith("https://"):
        if not _has_host(value):
            raise ValueError("The address has no host.")
        return value
    if _FILE_URL_RE.fullmatch(value):
        return value
    raise ValueError(
        f"An image address is https:// or an uploaded file ({FILE_URL_PREFIX}<24 hex characters>)."
    )


# ---- workshop status -------------------------------------------------------


def utc_today() -> date:
    """Today's date in UTC; a test replaces it to pin the day."""
    return datetime.now(timezone.utc).date()


def workshop_status(start: str, end: str | None, today: date | None = None) -> str:
    """"past" once the last day (`end`, else `start`) is before today, else
    "upcoming": a workshop is upcoming through the whole of its last day."""
    today = today or utc_today()
    last = date.fromisoformat(end or start)
    return "past" if last < today else "upcoming"


# ---- rich text -------------------------------------------------------------

_INLINE = ("text", "hardBreak")
_BLOCKS = (
    "paragraph", "heading", "bulletList", "orderedList", "blockquote",
    "codeBlock", "horizontalRule", "image",
)
#: node type -> the node types it may contain. A node absent here is a leaf.
_CHILDREN: dict[str, tuple[str, ...]] = {
    "doc": _BLOCKS,
    "paragraph": _INLINE,
    "heading": _INLINE,
    "blockquote": _BLOCKS,
    "bulletList": ("listItem",),
    "orderedList": ("listItem",),
    "listItem": _BLOCKS,
    "codeBlock": ("text",),
}
_LEAVES = ("text", "hardBreak", "horizontalRule", "image")
_MARKS = ("bold", "italic", "underline", "strike", "code", "link")
_ORDERED_TYPES = (None, "1", "a", "A", "i", "I")


def _text_attr(attrs: dict, key: str, limit: int) -> str | None:
    value = attrs.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f"'{key}' must be text of at most {limit} characters.")
    return value


def _node_attrs(kind: str, attrs: object) -> dict | None:
    """The whitelisted attrs of a node, validated; anything else is dropped
    (the editor adds `class`, `target` and the like, none of which we render)."""
    if attrs is None:
        attrs = {}
    if not isinstance(attrs, dict):
        raise ValueError(f"'{kind}' attrs must be an object.")
    if kind == "heading":
        level = attrs.get("level")
        if isinstance(level, bool) or level not in (2, 3):
            raise ValueError("A heading is level 2 or 3.")
        return {"level": level}
    if kind == "orderedList":
        start = attrs.get("start", 1)
        if isinstance(start, bool) or not isinstance(start, int) or not 0 <= start <= 1_000_000:
            raise ValueError("A numbered list starts at a whole number from 0 to 1000000.")
        out: dict = {"start": start}
        if attrs.get("type") not in _ORDERED_TYPES:
            raise ValueError("Unknown numbered-list type.")
        if attrs.get("type") is not None:
            out["type"] = attrs["type"]
        return out
    if kind == "codeBlock":
        language = _text_attr(attrs, "language", 32)
        if language is not None and not _LANGUAGE_RE.fullmatch(language):
            raise ValueError("Unknown code language.")
        return {"language": language}
    if kind == "image":
        out = {"src": check_image_url(attrs.get("src"))}
        out["alt"] = _text_attr(attrs, "alt", 500)
        out["title"] = _text_attr(attrs, "title", 500)
        return out
    return None


def _marks(marks: object) -> list[dict] | None:
    if marks is None:
        return None
    if not isinstance(marks, list):
        raise ValueError("'marks' must be a list.")
    out = []
    for mark in marks:
        if not isinstance(mark, dict) or mark.get("type") not in _MARKS:
            kind = mark.get("type") if isinstance(mark, dict) else mark
            raise ValueError(f"Text mark {kind!r} is not allowed.")
        item: dict = {"type": mark["type"]}
        if mark["type"] == "link":
            attrs = mark.get("attrs")
            if not isinstance(attrs, dict):
                raise ValueError("A link needs an address.")
            item["attrs"] = {"href": check_link_url(attrs.get("href"))}
        out.append(item)
    return out or None


def _node(node: object, parent: str, depth: int) -> dict:
    if depth > RICH_TEXT_MAX_DEPTH:
        raise ValueError(f"The document is nested more than {RICH_TEXT_MAX_DEPTH} levels deep.")
    if not isinstance(node, dict):
        raise ValueError("Every node must be an object.")
    kind = node.get("type")
    if not isinstance(kind, str) or (kind not in _CHILDREN and kind not in _LEAVES):
        raise ValueError(f"Node type {kind!r} is not allowed.")
    if kind not in _CHILDREN[parent]:
        raise ValueError(f"A {kind!r} cannot go inside a {parent!r}.")

    out: dict = {"type": kind}
    attrs = _node_attrs(kind, node.get("attrs"))
    if attrs is not None:
        out["attrs"] = attrs

    if kind == "text":
        text = node.get("text")
        if not isinstance(text, str) or not text:
            raise ValueError("A text node needs some text.")
        out["text"] = text
        marks = _marks(node.get("marks"))
        if marks:
            if parent == "codeBlock":
                raise ValueError("Code blocks take no formatting.")
            out["marks"] = marks
        return out

    if node.get("marks"):
        raise ValueError(f"A {kind!r} cannot carry text marks.")
    children = node.get("content")
    if kind in _LEAVES:
        if children:
            raise ValueError(f"A {kind!r} has no content.")
        return out
    if children is not None:
        if not isinstance(children, list):
            raise ValueError("'content' must be a list.")
        out["content"] = [_node(child, kind, depth + 1) for child in children]
    return out


def validate_rich_text(doc: object) -> dict:
    """A Tiptap / ProseMirror document, rebuilt from its whitelisted parts.

    ValueError for an unknown node or mark type, a node where it cannot go, a
    link or image address that is not allowed, or a serialized size over
    RICH_TEXT_MAX_BYTES. Attributes the editor adds that we do not use are
    dropped rather than refused, so what is stored is a function of the
    whitelist and not of whatever the editor sent.
    """
    if not isinstance(doc, dict) or doc.get("type") != "doc":
        raise ValueError("A document is an object with type 'doc'.")
    try:
        size = len(json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode())
        if size > RICH_TEXT_MAX_BYTES:
            raise ValueError(
                f"The text is {size // 1024} KiB; the limit is {RICH_TEXT_MAX_BYTES // 1024} KiB."
            )
        return _doc(doc)
    except RecursionError:
        raise ValueError("The document is nested too deeply.") from None


def _doc(doc: dict) -> dict:
    children = doc.get("content")
    if children is not None and not isinstance(children, list):
        raise ValueError("'content' must be a list.")
    return {"type": "doc", "content": [_node(c, "doc", 1) for c in children or []]}
