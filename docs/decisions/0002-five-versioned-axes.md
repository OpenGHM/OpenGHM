# ADR 0002 — Five artifacts are versioned independently, pinned from `metadata.json`

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-04 |
| **Affects** | `architecture/artifact-versioning.md`, `metadata.json` |
| **Superseded in part by** | [0014](0014-identity-is-a-minted-id.md) — axes 2 and 3's identifiers; [0015](0015-model-input-is-a-published-artifact.md) — axis 3 itself |

## Context

"Reproducing a WBM simulation" involves things that change at different rates
and for different reasons: the folder contract, the inputs, the datasets
mounted alongside them, the container the model runs in, and the model code
itself. Versioning them as one unit means every change to any of them
invalidates all of the others.

## Decision

Five axes, versioned independently, all pinned from one snapshot's
`metadata.json`:

1. **Snapshot spec** — the folder layout and metadata contract (semver)
2. **Snapshot instance** — one reproducible simulation (content hash)
3. **`raw_data` dataset** — inputs published outside any snapshot (name + serial)
4. **Container image** — the runtime (sha256 digest)
5. **WBM code** — `model/` + `utilities/` (sha256 tree hash)

Axes 2, 4 and 5 are *recorded*, not chosen: the hash falls out of the content.
Only 1 and 3 carry a number a person picks.

Published model output is deliberately **not** a sixth axis — see
[ADR 0009](0009-output-is-carried-not-reproducible.md).

## Alternatives considered

| Option | Why it lost |
|---|---|
| One version number for the whole snapshot | A container rebuild would force a new snapshot version, and vice versa. The axes genuinely move independently. |
| Version only the snapshot; treat the rest as environment | Makes runs unreproducible the moment the environment drifts, which is exactly what the container digest exists to prevent. |

## Consequences

Every snapshot carries a pin block naming all five. Resolving a snapshot means
resolving five identifiers, which is more machinery than a single version — but
each identifier is independently checkable, and a change on one axis does not
churn the others.
