# ADR 0015 — Model input is published on its own; snapshots link to it

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-15 |
| **Affects** | [ADR 0002](0002-five-versioned-axes.md), [ADR 0005](0005-namespace-decides-the-key.md), `architecture/artifact-versioning.md`, `reference/snapshot-layout.md`, `reference/s3-layout.md`, `reference/metadata-format.md` |

## Context

A snapshot bundles its input data. Measured on the staging tree at
`/anvil/projects/x-ees260008/data/dataRepo/snapshots`, that costs more than it
buys:

- `wbm_storage_v1.0.0_Wyoming` and `wbm_storage_v1.0.0_Global` carry the same
  49 GB. All nine categories match in size (`climate` 32 G, `crops` 13 G,
  `glaciers` 4.3 G, …) and the two directories we checksummed, `masks/` and
  `soil/`, are byte-identical.
- The Global snapshot contains `Wyoming_05min_flwdir.asc`, and the Wyoming
  snapshot contains the global network. Neither is a subset of the ancillary
  dataset; both are the whole thing.
- `data_init/` is duplicated *within* a single snapshot — the top-level copy and
  the one under `data/<dataSubdir>/` are identical.

The data is one published dataset: "University of New Hampshire Water Balance
Model Ancillary Data" (Grogan and Zuidema, 2022), whose readme ships inside it.
Region is not selected by subsetting it. It is selected by which river network
file the `.init`'s `Network` key points at — the ancillary data is carried whole
either way.

So every snapshot pays 49 GB to store a copy of the same dataset, and the copies
have no snapshot-specific content to justify them.

## Decision

Model input becomes a published artifact in its own right, with its own spec —
metadata and layout, versioned like the snapshot spec. It is stored under
`model-inputs/<id>/` and a snapshot **links** to one instead of containing it.

`metadata.json` gains `uses.modelInput`, naming the input by id:

```json
"modelInput": { "id": "7d4e9a1c…" }
```

At run time the linked input is fetched into a cache shared by every snapshot that
links it (`<model_input_dir>/<id>/`, `openghm snapshot fetch`) and mounted
read-only: its root at `/wbm/data` and its `data_init/` at `/wbm/data_init`. The
snapshot names the input and nothing else about it. Nothing about how the model
reads its inputs changes.

The namespace is **open**. Publishing is restricted to admins at first, but the
design assumes any user will publish into it, so by
[ADR 0005](0005-namespace-decides-the-key.md) the key cannot be a name someone
picks — two users will choose `merra2`. It is a minted id
([ADR 0014](0014-identity-is-a-minted-id.md)), like a snapshot's.

This replaces the `raw_data` axis. The name goes with it: "raw data" says the
bytes are unprocessed, which these are not — they are prepared model inputs.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Keep bundling; deduplicate in the store | Needs content-addressed storage underneath, which [ADR 0014](0014-identity-is-a-minted-id.md) just gave up, and leaves every snapshot nominally 49 GB larger than it is. |
| Keep `raw_data` curated, keyed by name + serial | Contradicts the premise: once users publish inputs, names collide, which is the whole argument in [ADR 0005](0005-namespace-decides-the-key.md). Deferring the change until users arrive means migrating live ids. |
| Link, but copy a per-snapshot subset | There is no subset. The region comes from the `Network` key, and the measured trees are identical. |
| Leave inputs in the snapshot and link only the large ones | Two mechanisms for one kind of thing, and the split would be re-litigated per dataset. |

## Consequences

A snapshot no longer contains its input data. `data/` and `data_init/` are not in
its layout; the linked input fills `/wbm/data` and `/wbm/data_init` at run time.
That removes about 49 GB from every snapshot and the within-snapshot duplication
with it.

The pin in `metadata.json` becomes load-bearing in a way it was not before:
previously the bytes were inside the artifact, now the artifact names them. This
is the same relationship the container already has, and it rests on the same
guarantee — a published id is immutable (rule 1).

Model input has a spec of its own (`schemas/model-input-spec/`), and a published
model input is what a snapshot's `uses.modelInput.id` resolves to.

`raw_data` disappears as a term. This supersedes
[ADR 0002](0002-five-versioned-axes.md) in part — axis 3 becomes model input,
identified by a minted id rather than name + serial — and
[ADR 0005](0005-namespace-decides-the-key.md) in part, moving that prefix from
the curated side of the line to the open one.
