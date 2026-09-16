# ADR 0005 — Open namespaces are content-addressed; curated ones are name + version

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-04 |
| **Affects** | S3 layout, `metadata.json` |
| **Superseded in part by** | [0014](0014-identity-is-a-minted-id.md) — the open-namespace key; [0015](0015-model-input-is-a-published-artifact.md) — `raw-data/`'s side of the line |

## Context

Every artifact needs an S3 key. The first design keyed snapshots by
`<slug>/<serial>` and WBM code by its content hash. Both were backwards.

Snapshots are the one thing **any user** will be able to publish. Two people
will pick `global_test`, and a human-chosen key would let one publish silently
shadow another. WBM code, by contrast, is a small curated set we publish
ourselves, where `wbm-code/3ab7…/` tells a reader nothing and
`wbm-code/wbm/2.0.0/` tells them everything.

## Decision

The **namespace** decides the key, not the kind of artifact.

- **Open namespace → content hash.** `snapshots/<snapshotId>/`, where the id is
  `sha256sum SHA256SUMS` — the hash of the identity manifest, so it covers
  exactly the inputs. Cannot collide, verifies itself.
- **Curated namespace → name + version.** `raw-data/`, `wbm-code/`,
  `containers/`, `schemas/`. Collisions are a review problem, and a readable
  path is worth more. Integrity does not depend on the path: the hash is
  recorded in `metadata.json` either way.

Identifier and address are therefore different things. For curated prefixes the
address is a convenience and the pin is still the hash.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Content-address everything | `wbm-code/3ab7…/` and `containers/9f2c…/` are unbrowsable for sets small enough to curate by hand. |
| Name everything | Guarantees snapshot key collisions once publishing is open to users. |
| Slug + serial for snapshots, with a uniqueness check | Pushes collision handling into a service that has to be online and correct at publish time. A hash needs neither. |

## Consequences

Listing `snapshots/` returns hashes, so finding a snapshot by name becomes the
catalog's job — the slug lives in `metadata.json` and the application's index,
not in the path. Curated prefixes lose automatic deduplication: byte-identical
code published under two versions is stored twice, which a `TREEHASH` file
makes detectable but does not prevent.

The snapshot id covers inputs only, so the same inputs published at two
different output tiers resolve to the same key. Either the tier joins the key,
or adding output to an existing prefix is the one write immutability must
permit — unresolved.
