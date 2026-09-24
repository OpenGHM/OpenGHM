# ADR 0018 — Specs share definitions from `schemas/common/`, and ship no generated renderings

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-18 |
| **Affects** | [ADR 0006](0006-spec-is-two-files.md), [ADR 0007](0007-schemas-on-s3-behind-a-proxy.md), [ADR 0015](0015-model-input-is-a-published-artifact.md), `schemas/`, `reference/snapshot-spec.md` |
| **Amended by** | [0020](0020-a-live-schema-viewer-is-not-a-generated-rendering.md) — narrows "no generated renderings" to the shape rejected here; a live-fetching viewer is a different shape, accepted there |

## Context

[ADR 0015](0015-model-input-is-a-published-artifact.md) makes model input a
published artifact needing a spec of its own. That turns a layout written for
one spec into a tree holding two, and two things about
[ADR 0006](0006-spec-is-two-files.md) stop working.

**The citation block is the same block.** A model input is a citable dataset —
the ancillary data staged on Anvil ships a readme with a title, three named
authors, a licence and a funding list. A snapshot is a citable dataset too, and
`about` already holds exactly those fields. Writing `about` twice, once per
spec, is two copies of one definition that have to be changed together: rule 4
says one of them would be wrong.

**`docs/` never earned its slot.** ADR 0006 gave every version a `docs/`
subfolder for generated HTML renderings. The folder has existed since, empty
apart from a `.gitkeep`, and nothing generates into it. The schemas carry
`description` on every field they define, and `reference/metadata-format.md`
explains the parts a description cannot. A renderer would be a third
presentation of the same facts, needing a generator, a style and somewhere to
serve it.

## Decision

**Shared definitions live in `schemas/common/<name>/<version>.json`** and are
pulled in by `$ref`. `about` is the first one. The tree becomes:

```
schemas/
  common/
    about/1.0.0.json          # citation block, shared by both specs
  snapshot-spec/
    metadata/1.0.0.json  layout/1.0.0.json  examples/  index.json
  model-input-spec/
    metadata/1.0.0.json  layout/1.0.0.json  examples/  index.json
```

**`$ref` is relative; `$id` stays absolute.** A schema keeps citing its own
published URL as `$id`, as ADR 0006 requires, but points at a shared definition
with a repository-relative path:

```json
"about": { "$ref": "../../common/about/1.0.0.json" }
```

This resolves identically in both places a schema is read — from a checkout, and
from `https://schemas.openghm.org/…` — **on one condition: the published tree
mirrors the source tree.** That condition is now load-bearing rather than
incidental, so `mc cp` to `s3://openghm/schemas/`
([ADR 0007](0007-schemas-on-s3-behind-a-proxy.md)) copies the layout whole and
never flattens it.

**A shared definition is versioned on its own** and each `$ref` pins a version.
Changing `about` means adding a new version file under `schemas/common/about/`; a spec adopts it by
repointing its `$ref`, which is that spec's own bump to make. Neither spec is
dragged along by the other's schedule.

**`docs/` is removed.** No generated renderings, in this version or a later one.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Copy `about` into each spec | Two definitions of one thing, kept in step by discipline. Rule 4 exists because that does not hold. |
| Absolute `$ref` to the published URL | Validation would reach the network to resolve a local file, and an unpublished spec could not be validated at all — which is the state every spec is in while it is being written. |
| One schema for both artifact kinds, with a discriminator | A snapshot has `simulation`, `uses` and `runtime`; a model input has none of them and carries a dataset inventory instead. The shared part is the citation block, not the document. |
| Keep `docs/`, generate later | It has been empty since ADR 0006 and nothing has needed it. An empty folder in a published tree is a promise the layout keeps making. |

## Consequences

A validator must resolve `$ref` against a local tree. Every consumer already
has one — the wheel bundles the schema files, CI has the checkout, the gateway
has the repository — so this is a resolver configuration, not a network
dependency. A consumer that downloads one schema file alone and validates it
naively will fetch the shared definition over HTTPS, which is ordinary JSON
Schema behaviour and works once the tree is published.

The published layout is now a contract. Flattening `schemas/` on the way to S3,
or serving `schemas/common/` from a different prefix, breaks every `$ref` at once.

`index.json` becomes per-spec rather than global: each spec folder declares its
own versions, because the two bump independently.

This amends [ADR 0006](0006-spec-is-two-files.md) twice — a version's files are
`metadata/` and `layout/` only, and a schema may now reference a definition it
does not contain — without changing what it decided: one semver still covers
both files, and they are still checked two different ways.
