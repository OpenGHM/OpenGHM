# ADR 0017 — The snapshot spec is the source of truth; the gateway stores its shape

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-18 |
| **Affects** | [ADR 0014](0014-identity-is-a-minted-id.md), `architecture/gateway.md`, `reference/metadata-format.md`, `reference/open-items.md` |

## Context

Snapshot metadata exists in three shapes today, and the spec is the one nothing
uses.

| | Where | State |
|---|---|---|
| The spec | `schemas/snapshot-spec/metadata/1.0.0.json` | nothing reads or writes it |
| The gateway's model | `web-gateway/backend/app/models/repository.py`, `web-gateway/frontend/lib/repository/types.ts` | running |
| The staged files | one `metadata.json` beside each snapshot on Anvil | present |

The second and third are the same shape, because the gateway was built to read
the staged files. They are a blend: DCMI Box bounds, schema.org
`variableMeasured` with `unitText`, HydroShare `hsterms:` link types, an
`adminMetadata` block, `title`/`creators`/`tag` where the spec says
`name`/`creator`/`category`, and `spatialResolution` as the free string
`5 arc-minute` where the spec has a structured `{ value, unit }`.

Rule 4 says backend models and frontend types are hand-maintained against the
spec until a generator exists. That is not what is happening — they model a
different document, so there is nothing to keep in step.

Neither of the two running shapes is load-bearing. The gateway's repository
feature is not finished: the `datasets` collection has no writer at all, so the
catalogue is empty in any fresh deployment. The staged `metadata.json` files are
working files written by hand before this spec existed, not published artifacts
— no snapshot has been published under a minted id
([ADR 0014](0014-identity-is-a-minted-id.md)), so nothing downstream depends on
their shape either.

That makes this the cheapest moment this decision will ever have.

## Decision

`schemas/snapshot-spec/` is the source of truth for snapshot metadata. The
gateway **stores the spec's shape**: a `datasets` document is the snapshot's
`metadata.json`, and anything a view needs that the spec does not carry is
derived when it is rendered, not stored.

Two things follow directly.

The schema.org/Dataset JSON-LD island is a **projection computed at render
time**, which is what `reference/metadata-format.md` already says it is. It is
not a stored second copy, and the gateway's current model is not a licence to
keep one.

The staged files on Anvil are working files, not artifacts. Converting them is a
migration of convenience, not a compatibility obligation — nothing is owed to
their shape, and a snapshot is only published once it is written to the spec.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Gateway keeps its own shape; convert on ingest | The converter *is* the generator, so the work is the same — but it buys a permanent second shape that can drift from the spec, which is exactly what rule 4 exists to prevent. |
| Make the gateway's shape the spec | It is a blend of three vocabularies assembled for one UI, with no version rules and no `uses`/`runtime` blocks. Publishing rests on those. |
| Defer until the repository feature is finished | The cost only rises: today the collection has no writer and no snapshot is published, so there is nothing to migrate. Every dataset added before the decision is a row to convert after it. |

## Consequences

The gateway's models and types have to be rewritten to the spec's shape. That is
a mission, not a detail: the frontend reads `spatialCoverage.northlimit` already
(the bounds agree), but `title`, `creators`, `tag`, `variableMeasured`,
`spatialResolution` and `adminMetadata` do not survive as they are.

The `datasets` write path can now be specified, which unblocks the gap left when
the startup seed was deleted — the shape it writes is no longer an open
question.

Rule 4's "hand-maintained in the same commit" becomes real rather than
aspirational. It was unenforceable while the two sides modelled different
documents; once they model the same one, a spec change that skips the backend or
the frontend is a visible defect.

Derived values the UI wants — the schema.org `GeoShape.box` string, a formatted
resolution label — are computed, not persisted. Where that computation lives is
not decided here.

This does not settle whether the gateway reads `metadata.json` directly from S3
or keeps an indexed copy in MongoDB. Either is consistent with this decision, so
long as what is stored is the spec's shape and the published file remains the
original.
