# ADR 0008 — `_Inline` is excluded from the code tree hash

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-04 |
| **Affects** | axis 5, `metadata.json` |

## Context

`model/_Inline` holds prebuilt Perl C extensions (`.so`). They load only
against the Perl ABI they were compiled for, which is why the v1 and v2
containers are pinned to ubuntu 20.04.

That makes the code tree partly environment-specific: hashing it would mix
"what the source is" with "what it was compiled against".

## Decision

Exclude `_Inline` from the tree hash. The hash identifies source; the container
digest already covers the ABI.

`_Inline` still ships, and still appears in `SHA256SUMS` — recompiling it
inside a read-only bind mount is not possible, so the objects must be present.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Include `_Inline` | The hash would change whenever the objects were rebuilt, silently coupling the code axis to a container revision. |
| Ship without `_Inline` and compile at run time | The snapshot is mounted read-only; there is nowhere to write the result. |

## Consequences

Two snapshots with identical source match even if compiled on different days.
The trade is that the code hash alone does not tell you the objects will load —
that is the container's `supportsCode` declaration's job.
