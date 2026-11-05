# ADR 0032 — WBM code is published under `wbm-code/` and pinned by its tree hash

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-07 |
| **Affects** | [ADR 0002](0002-five-versioned-axes.md) (axis 5), [ADR 0008](0008-exclude-inline-from-code-hash.md), [ADR 0014](0014-identity-is-a-minted-id.md), [`../architecture/artifact-versioning.md`](../architecture/artifact-versioning.md), [`../reference/s3-layout.md`](../reference/s3-layout.md), [`../reference/metadata-format.md`](../reference/metadata-format.md), open items 3, 11, 24 and P5 |

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

The UNH team maintains WBM and releases it publicly as archives; a public
GitHub repository is expected later. We do not keep a repository of our own for
it (decided 2026-11-05, replacing the private repository decided on
2026-10-07). Some of the files carry UNH's "strictly prohibited" notice (P10),
which is a separate, open question.

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
- **Where new versions come from:** UNH's public release archive today, and
  UNH's public repository once it exists (decided 2026-11-05). Either is
  a directory to `openghm code publish`, so only the way the tree is obtained
  changes between them, and `wbm-code/` stays the distribution and its
  versions stay fixed.
- **`openghm code publish <archive or directory>`** is how a version gets there:
  it reads `WBM_VERSION`, computes the tree hash, refuses other bytes under a
  version already published (and names the next free `-r<N>`), uploads every
  file public-read with its mode, then `SHA256SUMS`, then `TREEHASH` last, and
  re-reads the result. `model/wbm.pl` and `utilities/build_spool.pl` are
  published 0755 whatever the source says, because WBM runs them directly:
  `23.9.0` had the second at 0644, so `wbm.pl -bldSpool` failed silently
  with "Permission denied". It was corrected in place on 2026-11-05 (mode
  only, size and ETag unchanged).
- **A manifest says what each version may be used for** (2026-11-06):
  `wbm-code/manifest.json`, in the shape of `containers/manifest.json`, lists every published version
  with its tree hash, its date and a `status`: `current`, `legacy` or `withdrawn`
  ([`../reference/s3-layout.md`](../reference/s3-layout.md#publish-a-code-version)). It is an
  index, not a version: the bytes of a published version stay fixed, and only this file changes. The
  toolkit is its only writer (`openghm code publish`, `code manifest sync`, `code set-status`).
- **The gateway applies the status.** A new snapshot draft starts from a base snapshot and runs on
  that snapshot's own `model/`, so the code of a new draft is decided by its base. Only snapshots on
  `current` code are offered as a base, and the server refuses another one (422
  `wbm_code_not_current`). Existing snapshots and drafts on a `legacy` version keep working, and a draft on
  `withdrawn` code, or on code whose tree hash is not the listed one, cannot be submitted (422
  `wbm_code_withdrawn`, `wbm_code_mismatch`). A manifest the gateway cannot read blocks nothing (the
  state of every snapshot is then `unknown`). When a new WBM release is published, the maintainers
  set the older versions to `legacy`, and from then on new snapshots start from the new one.
- **The original archive is kept somewhere other than S3.** The bucket is not
  backed up (confirmed 2026-11-05), so the archive and `publish` are what makes a
  version reproducible. `22.1.1` and `23.9.0` have no archive; a verified
  copy of each is kept outside the bucket.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Treat `uses.container.version` as the code version | The images carry no code, so it pins the wrong thing. |
| Pin by name and version only | Rule 2: a name is a convenience, and only the hash shows that the bytes are the bytes. |
| Leave `_Inline` out of `wbm-code/` | A snapshot assembled from it could not run, since `_Inline` cannot be compiled into a read-only bind. |
| Wait for a WBM repository before publishing anything | The published snapshots already ran these two trees. Pinning them now costs nothing a repository's structure could change. |
| The gateway offers every published version, and a draft picks its code | A draft runs on its base snapshot's code, so a pick would need the toolkit to run a snapshot on other code (not built) and a rule for which `.init` parameters carry over. Limiting the base snapshots to those on `current` code gives "new snapshots on the newest code" without either. |
| A private repository of our own for the WBM source | UNH maintains the code and releases it publicly, so ours would be a second source to keep in step. `wbm-code/` already holds fixed, hash-pinned versions, and `publish` takes a clone as readily as an archive. |
| Version by the image's version (`1.0.0`, `2.0.0`) | Those are image versions. The code says what it is itself. |

## Consequences

- `schemas/snapshot-spec/metadata/1.0.0.json` gains a required
  `uses.modelCode` (edited in place, in development), and the generated
  code is regenerated.
- The three examples, the three published snapshots and the local
  catalogue carry it. A snapshot published from a draft inherits it from
  its base, because publish copies the base's code.
- Open item 11 is answered, and so are open items 3 and 24 (how upstream changes
  arrive, and the shape of a WBM repository). P5 waits for UNH's public
  repository.
- A snapshot still ships its own copy of the code, and `fetch` still
  downloads it from the snapshot. Fetching it once from `wbm-code/` instead
  is possible later and not part of this decision.
