# ADR 0006 — The snapshot spec is a JSON Schema plus a separate path list

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-04 |
| **Affects** | `schemas/snapshot-spec/` |

## Context

One semver version of the snapshot spec has to describe two different things:
the **fields** of `metadata.json`, and the **folder layout** a snapshot must
have on disk.

JSON Schema validates documents. It has nothing to say about whether
`wbm_init/` exists as a directory.

## Decision

Two files per version, checked two different ways, under one semver:

| File | What it is | Checked by |
|---|---|---|
| `metadata/<version>.json` | JSON Schema for `metadata.json`'s fields | `check-jsonschema`, against the document |
| `layout/<version>.json` | a plain path list — required and optional entries | an existence check against the folder |

Each kind gets its own subfolder (`metadata/`, `layout/`, `docs/`) so the top
level of `snapshot-spec/` never mixes what a version *is* with what it is *for*.

`$id` inside each schema is the resolvable published URL, never a relative
path — the hostname is a permanent identifier and outlives any decision about
where the bytes sit.

## Alternatives considered

| Option | Why it lost |
|---|---|
| One JSON Schema describing both | JSON Schema cannot express a directory tree. Encoding paths as a schema property would make it a data file wearing a schema's clothes. |
| Layout as convention in code | The parent directories would be code-side knowledge, which is exactly the coupling this is meant to remove. |
| A schema registry service (Apicurio) | A published version is an immutable file at a URL; git already gives history, review and rollback. Revisit only if compatibility rules need server enforcement. |

## Consequences

Two files to bump per version, and a consumer must check both to call a
snapshot valid. In exchange, the layout contract is machine-readable, so tools
resolve `wbm_init/` and `data/` from the declared spec version rather than from
string literals.
