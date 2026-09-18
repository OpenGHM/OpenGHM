# Snapshot spec

Where the spec lives, what a version consists of, and the rules for bumping it.

## Spec repository

One semver covers both the folder layout and the metadata fields, in two files
per version because they are checked two different ways:

| File | What it is | Checked by |
|---|---|---|
| `metadata/<version>.json` | JSON Schema for `metadata.json`'s fields | `check-jsonschema`, against the document |
| `layout/<version>.json` | plain path list for the snapshot folder | existence check against the folder |

JSON Schema validates documents, not directory trees, so these cannot be one
file.

```
schemas/
  common/
    about/1.0.0.json        # citation block shared by both specs below (ADR 0018)
  snapshot-spec/
    metadata/1.0.0.json     # metadata.json's schema, $id = its published URL, about by $ref
    layout/1.0.0.json       # required/optional snapshot paths
    index.json              # { "versions": [...], "current": ..., "deprecated": [...] }
    examples/*.json         # real metadata.json files, byte-identical to the staged ones
  model-input-spec/
    metadata/1.0.0.json     # a published model input's metadata.json schema
    layout/1.0.0.json       # required/optional model-input paths
    index.json
    examples/*.json
```

`schemas/common/` and `schemas/model-input-spec/` do not exist yet — mission
`2026-09-18-complete-the-spec-tree` (private, `ops/missions/`) creates both.
Everything else in the tree above exists. There is deliberately no `docs/`
subfolder: [ADR 0018](../decisions/0018-shared-definitions-and-no-renderings.md)
removed the one `snapshot-spec/` had, which sat empty since
[ADR 0006](../decisions/0006-spec-is-two-files.md) reserved it and never got a
generator. The examples are flat rather than per-version because they are
exhibits of what real snapshots carry, not fixtures owned by one spec version.

These files live at the top of the **`OpenGHM` repository**, which holds the
application, the toolkit and the spec together
([ADR 0010](../decisions/0010-repository-layout.md)):

```
OpenGHM/
  schemas/                    # the spec — one source, three consumers below
  web-gateway/                # backend + frontend; generated models and types
  packages/openghm/           # the openghm library + CLI, built as a wheel
  images/                     # image recipes and lock records
  deploy/local/                # the local compose stack
  ops/                        # private; this deployment's manifests and missions
```

One repository because a spec bump is one atomic change across all three
consumers: the schema files, the generated backend model, the generated
frontend types, and the copy that ships as **package data inside the wheel**
so `openghm snapshot validate` works with no network
(`toolkits/dev/openghm_portable_install_plan.md`). Split across repositories that change
would be several pull requests that have to land together, and a codegen CI
gate could not run at all.

Git holds the source. Publishing copies them to `s3://openghm/schemas/`
([s3-layout.md](s3-layout.md#anvil-s3-bucket)), and `schemas.openghm.org` serves
that copy ([artifact-versioning.md](../architecture/artifact-versioning.md#5-the-spec)). One file
therefore exists in three places with distinct roles:

| Copy | Role | Mutable |
|---|---|---|
| `schemas/` in the repository | source, reviewed and versioned | yes, until published |
| `s3://openghm/schemas/` | the published copy `$id` resolves to | no |
| inside the `openghm` wheel | offline validation | pinned per wheel release |

Published URLs, once serving exists (not yet — see below):

```
https://schemas.openghm.org/snapshot-spec/metadata/1.0.0.json
https://schemas.openghm.org/model-input-spec/metadata/1.0.0.json
```

`$id` inside each schema must be this resolvable published URL, never a relative
path and never the raw bucket endpoint — the hostname is a permanent identifier
and outlives any decision about where the bytes sit. A schema's `$ref` to a
shared definition under `schemas/common/` is the one exception: it stays
relative, resolved from the local tree
([ADR 0018](../decisions/0018-shared-definitions-and-no-renderings.md)), because
an unpublished schema has no absolute URL to point at yet.

**Nothing is served at this hostname today.** `$id` names the URL a version
will resolve to once published, not a claim that it does now — serving is its
own mission ([ADR 0007](../decisions/0007-schemas-on-s3-behind-a-proxy.md)),
deliberately after the spec stops changing, because [rule
1](../../AGENTS.md#the-rules) makes serving irreversible: a published version
is never edited in place.

## `layout/<version>.json`

The real file, matching what the three staged snapshots on Anvil have today —
not an aspirational shape:

```json
{
  "specVersion": "1.0.0",
  "required": [
    "metadata.json", "model/", "utilities/", "wbm_init/",
    "data/", "data_init/", "gdal_test_files/", "wbm_output/"
  ],
  "optional": ["SHA256SUMS", "spool/", "meta_data/", "WBM_run_state/"]
}
```

`data/` and `data_init/` are required in 1.0.0 because a snapshot bundles its
input data today. [ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md)
moves that data out to a linked, separately published model input — at which
point a snapshot no longer contains it, so both entries leave `required`. That
is a MAJOR bump (2.0.0), not a MINOR one: removing a required path is exactly
the case the version-rules table below calls breaking. Until the data actually
moves, 1.0.0 describes the bundle as it is.

`SHA256SUMS` is optional because **no staged snapshot has one yet** — see
[snapshot-layout.md](snapshot-layout.md#generate-sha256sums). Requiring it is
Next item 5's MAJOR bump, not this version's.

## Version rules

| Bump | Change | Reader impact |
|---|---|---|
| MAJOR | remove/rename/retype a required field, remove a required path | breaks |
| MINOR | add an optional field or optional path | safe |
| PATCH | description or constraint wording only | none |
