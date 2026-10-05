# Snapshot layout

The on-disk shape of a snapshot, and how its identity is computed.

## Snapshot on disk

```
<snapshot>/                          # slug e.g. wbm_storage_v2.0.0; published under its id
├── metadata.json                    # identity + pins (metadata-format)
├── SHA256SUMS                       # integrity manifest — inputs only; NOT PRESENT YET, see below
├── model/  utilities/               # WBM code, hashed (ADR 0008)
├── wbm_init/                        # run configuration
├── gdal_test_files/                 # GDAL fixtures the model probes at startup
└── wbm_output/<runId>/              # published results (ADR 0009)
```

A snapshot holds no input data and no spool: no `data/`, no `data_init/`, no
`spool/`. It links one published
model input by `uses.modelInput.id`
([ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md)), which
`openghm snapshot fetch` puts in a shared cache and `sim` binds at `/wbm/data`
and `/wbm/data_init`. The three published snapshots hold neither directory; the
project-space staging copies on Anvil keep theirs, because their test scripts
read them. A spool, the model input's datasets warped onto a network grid, is
kept per model input, network and variant in a cache that runs share, not in
the snapshot ([ADR 0029](../decisions/0029-a-run-computes-only-what-is-not-published.md),
[packages/openghm/README.md](../../packages/openghm/README.md)).

**The three snapshots published at `snapshots/<id>/` each have a
`SHA256SUMS`** (mission `2026-09-23-publish-the-staged-snapshots`, private),
built by the recipe below from the published copy. The
project-space staging copies (`ops/docs/reference/anvil-environment.md`,
private) still do not have one — nothing there runs this recipe until a
snapshot is published. The tree above leaves out two optional directories:
`WBM_run_state/`, which all three published snapshots have, and `meta_data/`,
which only the two v1.0.0 staging copies have and none of the published ones
does. That is what optional means here: the tree is the full shape, not the
guaranteed one. All three published snapshots still have a `spool/` from
before the spool left the snapshot; it goes once its days are under
`spools/<model input id>/` (mission `2026-10-05-runs-share-a-spool`, private).
v2.0.0's `spool/`, `WBM_run_state/` and `wbm_output/` come from job 20909227
(2026-09-25), which ran its own `wbm_test.init` through the published
`wbm-v2-lite` 2.0.0.

`schemas/snapshot-spec/layout/<version>.json` ([metadata-format.md](metadata-format.md)) is the machine-readable
form of this tree, and the one that decides required from optional.

Sizes are not evenly distributed — measured on the Global snapshot while it still
bundled its input (`toolkits/docs/wbm_s3_direct_journey.md`):

| Component | Global size | Share |
|---|---|---|
| `data/` — input store, now the model input's | **49 GB** | 5 % |
| `spool/` — regenerable cache, now kept per model input | **490 GB** | 49 % |
| `wbm_output/` — published results | **≈470 GB** | 47 % |
| **whole snapshot, then** | **1,009 GB** | |

With the input and the spool out, `wbm_output/` is what a snapshot's bytes are,
and tiering decisions ([ADR 0009](../decisions/0009-output-is-carried-not-reproducible.md))
are about it.

## Generate `SHA256SUMS`

`SHA256SUMS` covers the snapshot's **inputs** — everything except
`wbm_output/` (a result) and a leftover `spool/` (a cache). A model input uses the same recipe with
no exclusions ([s3-layout.md](s3-layout.md)).

```bash
cd <snapshot>
find . -type f \
  -not -path './spool/*' \
  -not -path './wbm_output/*' \
  -not -name 'SHA256SUMS' \
  -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS

# verify, on either side of a transfer
sha256sum -c SHA256SUMS --quiet
```

This manifest is an **integrity** check, not an identity. It answers "did the
bytes arrive intact", and a consumer runs it or does not
([ADR 0014](../decisions/0014-identity-is-a-minted-id.md)). Nothing derived from
it is carried in `metadata.json`.

`openghm snapshot fetch <id>` is one such consumer: it checks every file it
downloads against `SHA256SUMS` (a spool file, which has no line, by size and
MD5), and does not download `wbm_output/` or `WBM_run_state/`. It then does the
same for the linked model input, into its own cache, which has its own `SHA256SUMS`
([packages/openghm/README.md](../../packages/openghm/README.md#fetching-a-snapshot-openghm-snapshot-fetch)).

## Mint the id

The id is assigned once, at publish, and never reused or reassigned: 256 bits of
randomness as lowercase hex.

```bash
# the snapshot id — the S3 key (s3-layout) and the `id` in metadata.json (metadata-format)
openssl rand -hex 32
```

It is unique, not derived from the content. Deriving it from the content was
circular — `metadata.json` is inside `SHA256SUMS`, and `metadata.json` has to
carry the id — and it made every changed byte an unrelated identity, which is
the opposite of what version tracking needs
([ADR 0014](../decisions/0014-identity-is-a-minted-id.md)).

Model inputs are minted the same way, from the same command
([s3-layout.md](s3-layout.md#publish-a-model-input)).
