# Snapshot layout

The on-disk shape of a snapshot, and how its identity is computed.

## Snapshot on disk

```
<snapshot>/                          # slug e.g. wbm_storage_v2.0.0; published under its id
├── metadata.json                    # identity + pins (metadata-format)
├── SHA256SUMS                       # integrity manifest — inputs only; NOT PRESENT YET, see below
├── model/  utilities/               # WBM code, hashed (ADR 0008)
├── wbm_init/                        # run configuration
├── data/<mountAs>/                  # input data — LEAVING the bundle (ADR 0015)
├── data_init/                       # input init fragments — LEAVING the bundle (ADR 0015)
├── gdal_test_files/                 # GDAL fixtures the model probes at startup
├── wbm_output/<runId>/              # published results (ADR 0009)
└── spool/                           # cache — NOT in SHA256SUMS
    └── spool-manifest.json
```

`data/` and `data_init/` are drawn as they exist in the three snapshots on Anvil
today. [ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md)
moves them out: a snapshot will link one published model input by id and the
run will materialise it at `data/<mountAs>/`. Until model input has a spec of
its own, they stay bundled — and duplicated, both across snapshots and, for
`data_init/`, within one.

**The three snapshots published at `snapshots/<id>/` each have a
`SHA256SUMS`** (mission `2026-09-23-publish-the-staged-snapshots`, private),
built by the recipe below from the published copy. The
project-space staging copies (`ops/docs/reference/anvil-environment.md`,
private) still do not have one — nothing there runs this recipe until a
snapshot is published. The tree above leaves out two optional directories:
`WBM_run_state/`, which all three published snapshots have, and `meta_data/`,
which only the two v1.0.0 staging copies have and none of the published ones
does. That is what optional means here: the tree is the full shape, not the
guaranteed one. All three published snapshots also have `spool/`. v2.0.0's
`spool/`, `WBM_run_state/` and `wbm_output/` come from job 20909227
(2026-09-25), which ran its own `wbm_test.init` through the published
`wbm-v2-lite` 2.0.0.

`schemas/snapshot-spec/layout/<version>.json` ([metadata-format.md](metadata-format.md)) is the machine-readable
form of this tree, and the one that decides required from optional.

Sizes are not evenly distributed — measured on the Global snapshot
(`toolkits/docs/wbm_s3_direct_journey.md`):

| Component | Global size | Share |
|---|---|---|
| `data/` — input store | **49 GB** | 5 % |
| `spool/` — regenerable cache | **490 GB** | 49 % |
| `wbm_output/` — published results | **≈470 GB** | 47 % |
| **whole snapshot** | **1,009 GB** | |

95 % of a published snapshot is not input data. Tiering decisions ([ADR 0009](../decisions/0009-output-is-carried-not-reproducible.md)) are
about those two directories.

## Generate `SHA256SUMS`

`SHA256SUMS` covers the snapshot's **inputs** — everything except `spool/`
(a cache) and `wbm_output/` (a result). A model input uses the same recipe with
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
