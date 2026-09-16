# ADR 0014 — A published artifact's id is minted, not derived from its content

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-15 |
| **Affects** | [ADR 0002](0002-five-versioned-axes.md), [ADR 0005](0005-namespace-decides-the-key.md), `architecture/artifact-versioning.md`, `reference/snapshot-layout.md`, `reference/s3-layout.md`, `metadata.json` |

## Context

[ADR 0005](0005-namespace-decides-the-key.md) keyed open namespaces by content:
the snapshot id was `sha256sum SHA256SUMS`, chosen because a content hash cannot
collide and verifies itself. Two problems surfaced once the rest of the design
caught up with it.

**The definition is circular.** `SHA256SUMS` excludes only `spool/`,
`wbm_output/` and itself ([snapshot-layout.md](../reference/snapshot-layout.md#generate-sha256sums)),
so `metadata.json` is inside the manifest. But `metadata.json` has to carry the
id, and the id is the hash of a manifest that covers `metadata.json`. There is
no order in which both statements hold. Excluding `metadata.json` from the
manifest resolves the circle only by leaving every pin in it unprotected, which
gives up the property the content hash existed to provide.

**Version tracking needs lineage the key cannot carry.** We intend to track
successive versions of a snapshot. Under content addressing, one changed byte
produces an unrelated id, so "this supersedes that" has to be stated in metadata
and the catalog no matter what the key is. The key was not earning the
complexity it cost.

## Decision

The id of a published artifact is a **minted identifier**: 256 bits of
randomness, lowercase hex, assigned once at publish time and never reused. It is
unique. It is not derived from the bytes.

`SHA256SUMS` stays inside the artifact and keeps its recipe. Its job is now
integrity alone — a consumer who wants to check that the bytes they received are
the bytes that were published still can, with `sha256sum -c`. It no longer
defines identity, and no checksum of ours is threaded through `metadata.json`.

A hash still appears in `metadata.json` wherever a hash is an **address** rather
than a checksum. The container's OCI digest is the only such case: it is how the
image is pulled (`oras://…@sha256:…`), and pulling by tag instead would cite a
mutable name, which rule 2 forbids.

Minting is unconditional — every published artifact gets an id this way,
including ones in curated namespaces, so there is one rule rather than two.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Keep content addressing, exclude `metadata.json` from the manifest | Resolves the circularity but unprotects every pin in `metadata.json`, so the id no longer covers what the run actually depends on. Still no lineage. |
| Sequential ids | Needs an allocator that is online and correct at publish time — the same objection [ADR 0005](0005-namespace-decides-the-key.md) raised against a uniqueness check. |
| UUIDv4 | Works, and the collision argument is identical. A 256-bit hex string was chosen only for shape: it matches the container digests already in the file and the ids already in S3 keys and URLs. |
| Content hash plus a separate lineage field | Keeps the circularity, and pays for automatic dedup we measured no use for. |

## Consequences

Identity no longer verifies itself. Verification becomes a separate, optional
step against `SHA256SUMS`, and a consumer who skips it has no way to detect that
the bytes moved under an id — mitigated by the fact that published artifacts are
immutable (rule 1) and the store, not the id, enforces that.

Two byte-identical artifacts now get two ids. Deduplication was automatic under
content addressing and is not any more; as with curated prefixes before it, the
manifest makes the duplication detectable rather than preventing it.

Lineage becomes expressible. Version tracking can link ids without the key
fighting it, and the fields that do so are a later, additive change.

This supersedes [ADR 0005](0005-namespace-decides-the-key.md) in part: open
namespaces are keyed by a minted id rather than a content hash. Nothing else in
that decision changes — the namespace still decides the key, and the collision
argument that separates open from curated is untouched. It also supersedes
[ADR 0002](0002-five-versioned-axes.md) in part: axes 2 and 3 no longer describe
an identifier that falls out of the content, and axis 5's tree hash stays in the
artifact as an integrity manifest rather than a checksum in `metadata.json`.
