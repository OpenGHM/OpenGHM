# ADR 0022 — A published file's mode is recorded on its own object

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-25 |
| **Affects** | [ADR 0014](0014-identity-is-a-minted-id.md), [ADR 0015](0015-model-input-is-a-published-artifact.md), `docs/reference/s3-layout.md`, `ops/anvil/publish_snapshot.sh` (private) |

## Context

A snapshot is run by executing its own files. `wbm-run` and every `test/`
script do `singularity exec <sif> /wbm/model/wbm.pl …`, so `wbm.pl` needs its
execute bit, and the prebuilt Inline object `model/_Inline/…/*.so` is 0555.
Nothing in the spec or in `SHA256SUMS` says what a file's mode is. So far
that has not mattered, because every run used a staged copy on GPFS where
the modes survived.

The published copies lost them. `publish_snapshot.sh` streams each object
through `curl … | s3cmd put -`, and from stdin `s3cmd` writes only
`x-amz-meta-s3cmd-attrs: gname:…/uname:…`, with no `mode:`. The model inputs
were then copied server-side from those objects and inherited the gap. The
only surviving record is on the legacy slug-keyed copies, which `s3cmd put`
of real files uploaded with `mode:` on every object, and which are scheduled
for deletion.

The recorded modes cannot be derived by rule. They are what the source tree
had, including `RIMS.conf` 0755 and an executable script
(`utilities/networkTools`) at 0644.

## Decision

**A file's POSIX mode is part of what a published tree records, and it is
recorded on the file's own object**, as `mode:<decimal st_mode>` inside
`x-amz-meta-s3cmd-attrs`. That is the field and encoding `s3cmd` already
writes, and any HTTPS client can read it from a `HEAD`. Of `s3cmd`'s own
download commands, only `s3cmd sync` applies it. `s3cmd get` never does,
even with `--preserve` (verified 2026-09-25 with s3cmd 2.4.0: `sync` → 0755,
`get --preserve` → 0644; the chmod exists only on its sync path). A
consumer either uses `sync` or applies the header itself.

For the five trees published without it, the mode is restored from the
legacy copy's record, once, by a metadata-only server-side copy of each
object onto itself. The bytes, the key and `SHA256SUMS` are untouched. This
was shown on scratch objects (a small one and a 1.2 GiB multipart one): the
bytes are identical and public-read, `Content-Type` and even the ETag are
unchanged. The copy has to be signed with SigV4. The shared `~/.s3cfg`'s
`signature_v2 = True` gets `403 SignatureDoesNotMatch` on it for any
object size.

**This is a narrow exception to rule 1, and it is stated as one.** Rule 1
protects what a published artifact *is*: its bytes, which `SHA256SUMS`
describes, and its key, which pins cite. A file's mode is a property of the
source file that the publish step failed to carry. Restoring it from that
file's own record makes the published copy *more* faithful to what was
published, not different from it. The exception covers exactly this and
nothing else:

- only a property recorded for the same source file,
- only filling a value that is absent, never changing one that is present,
- never bytes, never a key.

Anything else on a published object is still immutable.

Every publisher from here on sets `mode:` at upload time. For
`publish_snapshot.sh`, that means passing the source object's own
`x-amz-meta-s3cmd-attrs` through on each streamed put. It is a Next item,
not part of this decision's first mission.

## Alternatives considered

| Option | Why it lost |
|---|---|
| A `MODES` manifest file at the root of each tree | It adds a key to an already-published tree that its `SHA256SUMS` does not list. The alternative, rewriting `SHA256SUMS`, edits a published object's bytes, which rule 1 exists to prevent. It is also a layout change to the spec. It fits a *future* layout version; it does not fit these five trees |
| Republish all five under new minted ids | It spends about 143k object copies and new catalogue entries to change zero bytes. The old ids would stay published and stay unrunnable forever, since nothing can be withdrawn under rule 1 |
| Record modes only in git (a committed list per tree) | The artifact would stop describing itself. A consumer fetching from S3 would need this repository to run what it fetched, which is the dependency ADR 0016's split exists to avoid |
| Guess at fetch time (`chmod +x` on `*.pl`/`*.sh`) | It produces a different tree. The source has a 0644 executable and 0755 data files |

## Consequences

Object metadata becomes load-bearing on `snapshots/` and `model-inputs/`.
Anything that copies these prefixes has to carry `x-amz-meta-*`: a mirror,
a migration, or another publish script. A server-side `CopyObject` does by
default. A download-then-upload does not unless told to, which is exactly
how this was lost.

The metadata-only copy changes each object's `Last-Modified`. On this
endpoint it leaves the `ETag` alone, including for multipart objects, which
the scratch test showed. Nothing pins either one anyway: pins cite ids and
`SHA256SUMS` hashes.

Once the five trees carry their modes and a full scan has shown it, the
legacy slug copies hold nothing that does not exist elsewhere, and their
deletion (Next item 3) loses no information.
