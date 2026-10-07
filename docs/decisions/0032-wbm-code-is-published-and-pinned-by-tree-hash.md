# ADR 0032 — WBM code is published under `wbm-code/` and pinned by its tree hash

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-07 |
| **Affects** | [ADR 0002](0002-five-versioned-axes.md) (axis 5), [ADR 0008](0008-exclude-inline-from-code-hash.md), [ADR 0014](0014-identity-is-a-minted-id.md), [`../architecture/artifact-versioning.md`](../architecture/artifact-versioning.md), [`../reference/s3-layout.md`](../reference/s3-layout.md), [`../reference/metadata-format.md`](../reference/metadata-format.md), open items 3, 11 and P5 |

## Context

WBM code is axis 5 ([ADR 0002](0002-five-versioned-axes.md)): `model/` and
`utilities/`, identified by a sha256 tree hash that leaves `model/_Inline`
out ([ADR 0008](0008-exclude-inline-from-code-hash.md)). The design put
versions under the curated prefix `wbm-code/<name>/<version>/` with a
`TREEHASH` ([`../reference/s3-layout.md`](../reference/s3-layout.md#publish-a-code-version)).
A snapshot would take its code from there and record the hash in
`metadata.json`.

None of that ran, as checked on 2026-10-07:

- `wbm-code/` holds no key.
- The three published snapshots carry code copied from their staging
  copies.
- `metadata.json` names no code at all. [ADR 0014](0014-identity-is-a-minted-id.md)
  took `modelCode.sha256` out, and open item 11 never replaced it.
- The WBM images hold the runtime and no code (their Dockerfiles say
  so), so `uses.container.version` says nothing about which code ran. The
  same image runs whatever `model/` is bound.

What the published trees hold (anonymous reads, 2026-10-07):

| Snapshots | `WBM_VERSION` in `model/wbm.pl` | Tree hash (ADR 0008 recipe) |
|---|---|---|
| v2 tutorial `fc66a2cd…` | `23.9.0` | `664c291d7a5b98d5…`, equal to the copy in `images/wbm-tools-lite/wbm/` |
| Wyoming `245430de…`, Global `4604e608…` | `22.1.1` | `f210a78bd43a870c…`, the same for both |

The WBM source will get a repository of its own, a private one, because
seven of its files carry UNH's "strictly prohibited" notice (P10) and
cannot sit in this public repository. The user decided this on 2026-10-07.
That repository does not exist yet, and its structure (a branch per
version, or a folder per version) is not decided.

## Decision

**`wbm-code/wbm/<version>/` is where WBM code is distributed, and a
snapshot's `metadata.json` pins the code it runs by tree hash, in
`uses.modelCode`. The toolkit checks the pin wherever it has the tree.**

- **Layout:** `wbm-code/wbm/<version>/` holds:
  - `model/` and `utilities/` exactly as a snapshot ships them, `_Inline`
    included, because a read-only bind cannot compile it;
  - `TREEHASH`: one line, the hash below;
  - `SHA256SUMS`: every file, so a copy can be checked file by file like
    every other prefix.

  Every key is public-read and carries its file mode
  ([ADR 0022](0022-file-modes-are-object-metadata.md)).
- **Version:** the `WBM_VERSION` constant in that tree's `model/wbm.pl`.
  Different bytes that declare a version already published get the suffix
  `-r<N>`. A published version is never changed (rule 1, once in operation).
- **Tree hash:**
  - Take every regular file under `model/` and `utilities/`, as a path
    relative to the tree's root (`model/wbm.pl`), skipping any path with an
    `_Inline` component.
  - Sort the paths bytewise.
  - Write one line per file: `<sha256 hex>  <path>\n`.
  - The tree hash is the sha256 of those lines, lowercase hex.

  It equals `find model utilities -type f -not -path '*/_Inline/*' -print0
  | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.
- **Pin:** `uses.modelCode` is `{ "name": "wbm", "version": "<version>",
  "treeHash": "<64 hex>" }` and is required, beside `uses.container` and
  `uses.modelInput`. The hash is the identity (rule 2). Name and version
  say where the bytes are.
- **Checks:**
  - **`openghm snapshot validate`** on a folder compares the folder's tree
    hash with `uses.modelCode.treeHash`;
  - **`openghm snapshot fetch`** compares after it downloads;
  - **`openghm snapshot publish`** compares the tree it writes.

  A mismatch is an error, not a warning.
- **The first two versions,** `22.1.1` and `23.9.0`, are copied
  server-side from the published snapshots, whose code ran and was verified
  bit-identical to prod. Their `metadata.json` gains `uses.modelCode` in
  place. That is a development-phase correction (rule 1), and their
  `SHA256SUMS` changes with it.
- **The git side waits for the WBM repository.** Once it exists, it becomes
  where new versions come from. Until then nothing is decided about:
  - how its structure maps to versions;
  - how a version moves from it to `wbm-code/`;
  - how upstream changes arrive (open item 3);
  - what replaces the copy in `images/wbm-tools-lite/wbm/` (P5).

  Whatever is decided, `wbm-code/` stays the distribution and its versions
  stay fixed.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Treat `uses.container.version` as the code version | The images carry no code, so it pins the wrong thing. |
| Pin by name and version only | Rule 2: a name is a convenience, and only the hash shows that the bytes are the bytes. |
| Leave `_Inline` out of `wbm-code/` | A snapshot assembled from it could not run, since `_Inline` cannot be compiled into a read-only bind. |
| Wait for the WBM repository before publishing anything | The published snapshots already ran these two trees. Pinning them now costs nothing the repository's structure could change. |
| Version by the image's version (`1.0.0`, `2.0.0`) | Those are image versions. The code says what it is itself. |

## Consequences

- `schemas/snapshot-spec/metadata/1.0.0.json` gains a required
  `uses.modelCode` (edited in place, in development), and the generated
  code is regenerated.
- The three examples, the three published snapshots and the local
  catalogue carry it. A snapshot published from a draft inherits it from
  its base, because publish copies the base's code.
- Open item 11 is answered. P5 and open item 3 wait on the WBM repository,
  which is a new open item.
- A snapshot still ships its own copy of the code, and `fetch` still
  downloads it from the snapshot. Fetching it once from `wbm-code/` instead
  is possible later and not part of this decision.
