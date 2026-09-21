"""Build an optional-everywhere Pydantic model from a generated one.

Salvaged from the abandoned ``2026-09-20-snapshot-drafts`` mission's
``app/models/draft.py`` (see that mission's ``plan.md`` *Salvage* table) and
generalised: it is no longer tied to snapshots or drafts, only to the one
real problem it solves — a spec-shaped block (``about``, in this mission)
needs an editable, partially-filled form before a simulation is submitted,
and hand-restating the generated model's fields would violate rule 4 (one
source of truth).

``_partial_model`` walks a generated model's field tree and rebuilds it with
every field optional (default ``None``), recursing into nested object models
(including inside lists) so the same optionality applies at every level.
Enums, constrained scalars (``constr``/``conint``/...) and ``RootModel``
wrappers are left alone: there is nothing inside a scalar to make partial,
and if a field carrying one of those is present it still has to be the right
*kind* of value.

It handles a real pydantic v2 subtlety: `constr(min_length=1)` constraints
live in ``FieldInfo.metadata``, not in ``.annotation`` (pydantic unwraps
``Annotated`` on the way in), and are silently lost unless reattached via
``Annotated[...]``. Without that, a partial field would accept an empty
string where the generated model requires a non-empty one.
"""

from __future__ import annotations

import types
import typing

from pydantic import BaseModel, ConfigDict, Field, RootModel, create_model

_partial_cache: dict[type[BaseModel], type[BaseModel]] = {}


def _partial_type(annotation: typing.Any) -> typing.Any:
    """Rewrite one field's annotation so any nested object model inside it
    is replaced by its own partial version. Leaves everything else (enums,
    constrained scalars, RootModel wrappers, bare types) untouched — the
    caller is responsible for making the field itself optional."""
    origin = typing.get_origin(annotation)

    if origin is types.UnionType or origin is typing.Union:
        args = [a for a in typing.get_args(annotation) if a is not type(None)]
        parts = tuple(_partial_type(a) for a in args)
        return parts[0] if len(parts) == 1 else typing.Union[parts]

    if origin in (list, typing.List):  # noqa: UP006 — comparing to the origin, not annotating with it
        (item,) = typing.get_args(annotation)
        return list[_partial_type(item)]

    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        if issubclass(annotation, RootModel):
            return annotation  # a scalar wrapper (Keyword, ActiveProcess, SlurmTime, ...) — nothing to partial
        return _partial_model(annotation)

    return annotation


def _partial_model(
    model: type[BaseModel], *, exclude: frozenset[str] = frozenset()
) -> type[BaseModel]:
    """Build (and cache) a variant of ``model`` where every field not in
    ``exclude`` is optional, recursively. ``exclude`` only applies at this
    call's own level — nested models are always made fully partial."""
    cache_key = model if not exclude else None  # excludes are only used at the top call
    if cache_key is not None and cache_key in _partial_cache:
        return _partial_cache[cache_key]

    fields: dict[str, typing.Any] = {}
    for name, info in model.model_fields.items():
        if name in exclude:
            continue
        core = _partial_type(info.annotation)
        # `constr(...)`/`conint(...)`/etc. constraints live in FieldInfo.metadata,
        # not in `.annotation` itself (pydantic v2 unwraps Annotated on the way
        # in) — reattach them, or a partial field would silently lose e.g.
        # `min_length=1` and accept an empty string.
        if info.metadata:
            core = typing.Annotated[(core, *info.metadata)]
        new_type = core | None
        fields[name] = (new_type, Field(default=None, alias=info.alias))

    partial_model = create_model(
        f"Partial{model.__name__}",
        __config__=ConfigDict(extra="forbid", populate_by_name=True),
        **fields,
    )
    if cache_key is not None:
        _partial_cache[cache_key] = partial_model
    return partial_model
