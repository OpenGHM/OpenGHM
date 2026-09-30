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
    examples/*.json         # the three published snapshots' documents, creator anonymised
  model-input-spec/
    metadata/1.0.0.json     # a published model input's metadata.json schema
    layout/1.0.0.json       # required/optional model-input paths
    index.json
    examples/*.json
```

Every path in the tree above exists. There is deliberately no `docs/`
subfolder: [ADR 0018](../decisions/0018-shared-definitions-and-no-renderings.md)
removed the one `snapshot-spec/` had, which sat empty since
[ADR 0006](../decisions/0006-spec-is-two-files.md) reserved it and never got a
generator. The examples are flat rather than per-version because they are
exhibits of what real snapshots carry, not fixtures owned by one spec version.

The examples are the three snapshots' published `metadata.json` documents
(`snapshots/<id>/metadata.json`, mission
`2026-09-23-publish-the-staged-snapshots`, private), with `about.creator`
anonymised — real names stay out of this public repository, but the
published objects in S3 carry the real ones. They are **not copies of the
`metadata.json` files sitting in the project-space staging folders**: those
files predate the spec and still carry the pre-spec shape, and replacing them
is out of scope (staging is left as it is; the published copy is the document
of record).

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

`$id` is also where each version is served
([ADR 0007](../decisions/0007-schemas-on-s3-behind-a-proxy.md)). Until the
project is in operation, a version is corrected in place, served copy
included ([rule 1](../../AGENTS.md#the-rules)).

## `layout/<version>.json`

The real file:

```json
{
  "specVersion": "1.0.0",
  "required": [
    "metadata.json", "model/", "utilities/", "wbm_init/",
    "gdal_test_files/", "wbm_output/"
  ],
  "optional": ["SHA256SUMS", "spool/", "meta_data/", "WBM_run_state/"]
}
```

`data/` and `data_init/` are in neither list: a snapshot holds no input data. It
links a separately published model input by `uses.modelInput.id`
([ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md)), and the
run binds that input's root at `/wbm/data` and its `data_init/` at `/wbm/data_init`.

`SHA256SUMS` is optional, and stays optional: it is an integrity check a
consumer may run, not part of a snapshot's identity
([ADR 0014](../decisions/0014-identity-is-a-minted-id.md)). The three
snapshots published at `snapshots/<id>/` each ship one (mission
`2026-09-23-publish-the-staged-snapshots`, private) — see
[snapshot-layout.md](snapshot-layout.md#generate-sha256sums).

## Version rules

| Bump | Change | Reader impact |
|---|---|---|
| MAJOR | remove/rename/retype a required field, remove a required path | breaks |
| MINOR | add an optional field or optional path | safe |
| PATCH | description or constraint wording only | none |

The table applies once the project is in operation
([rule 1](../../AGENTS.md#the-rules)). Until then, every change, a breaking one
included, is made in place: the spec stays 1.0.0, and the examples, the
published snapshots and the served schema are changed with it.
