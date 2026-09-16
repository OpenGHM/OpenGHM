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
  snapshot-spec/
    metadata/1.0.0.json     # metadata.json's schema, $id = its published URL
    layout/1.0.0.json       # required/optional snapshot paths
    docs/                   # generated HTML renderings — empty; deferred past 1.0.0
    index.json              # { "versions": [...], "current": ..., "deprecated": [...] }
    examples/*.json         # real metadata.json files, byte-identical to the staged ones
```

Only `index.json` and `examples/` exist today; the two versioned files —
`metadata/1.0.0.json` and `layout/1.0.0.json` — are not written yet and no
mission currently covers writing them. The examples are flat rather than
per-version because they are exhibits of what real snapshots carry, not
fixtures owned by one spec version.

These files live at the top of the **`OpenGHM` repository**, which holds the
application, the toolkit and the spec together
([ADR 0010](../decisions/0010-repository-layout.md)):

```
OpenGHM/
  schemas/snapshot-spec/…     # the spec — one source, three consumers below
  web-gateway/                # backend + frontend; generated models and types
  packages/openghm/           # the openghm library + CLI, built as a wheel
  images/                     # image recipes and lock records
  deploy/                     # cluster manifests and the local compose stack
```

One repository because a spec bump is one atomic change across all three
consumers: the schema file, the generated backend model, the generated frontend
types, and the copy that ships as **package data inside the wheel** so
`openghm snapshot validate` works with no network
(`toolkits/dev/openghm_portable_install_plan.md`). Split across repositories that change
would be several pull requests that have to land together, and the CI mission's codegen
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

Published URLs:

```
https://schemas.openghm.org/snapshot-spec/metadata/1.1.0.json
https://schemas.openghm.org/snapshot-spec/docs/1.1.0/
```

`$id` inside each schema must be this resolvable published URL, never a relative
path and never the raw bucket endpoint — the hostname is a permanent identifier
and outlives any decision about where the bytes sit.

## `layout/<version>.json`

```json
{
  "specVersion": "1.1.0",
  "required": [
    "metadata.json", "SHA256SUMS", "model/", "utilities/",
    "wbm_init/", "data/", "data_init/", "gdal_test_files/"
  ],
  "optional": ["wbm_output/", "spool/"]
}
```

## Version rules

| Bump | Change | Reader impact |
|---|---|---|
| MAJOR | remove/rename/retype a required field, remove a required path | breaks |
| MINOR | add an optional field or optional path | safe |
| PATCH | description or constraint wording only | none |
