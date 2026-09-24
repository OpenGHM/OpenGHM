# ADR 0020 — A live schema viewer is not a generated rendering

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-24 |
| **Affects** | [ADR 0018](0018-shared-definitions-and-no-renderings.md), `docs/architecture/repository-layout.md`, `docs/reference/s3-layout.md` |

## Context

`schemas.openghm.org` serves raw JSON only. [ADR 0018](0018-shared-definitions-and-no-renderings.md)
explicitly decided against generated renderings — specifically the shape ADR
0006 had reserved a `docs/` subfolder for: a per-spec-version HTML file, baked
at publish time and stored in the published S3 tree next to the schemas it
describes. ADR 0018 rejected that shape because it would be a third stored
copy of facts the schemas and `reference/metadata-format.md` already state,
needing a generator, a style and somewhere to serve it, with no consumer
asking for it at the time.

A consumer is now asking for it: a person wants to browse the spec — spec
names, versions, field-by-field descriptions with `$ref` (including
`schemas/common/*`) resolved inline — without reading raw JSON by hand.

## Decision

**This ADR narrows "no generated renderings" to the shape ADR 0018 actually
rejected: baked, per-version, stored in the published spec tree.** It adds a
*different* shape as accepted: a single, source-controlled, dependency-free
static viewer (`schema-docs/` — plain HTML/CSS/JS, no build step) that fetches
the already-published JSON at read time, in the browser, and renders it. It
resolves `$ref` (including into `schemas/common/`) client-side, by fetching
the referenced file too. Nothing version-specific is ever stored — no HTML
file exists for any given spec version until a browser asks for it.

It is served from the same `schemas.openghm.org` host, certificate and nginx
pod [ADR 0007](0007-schemas-on-s3-behind-a-proxy.md) already runs, at a new
`/docs/` path, backed by a new, separate S3 prefix,
`s3://openghm/schema-docs/`. That prefix is a sibling of `s3://openghm/schemas/`,
never nested inside it, so the "published tree mirrors the source tree"
contract ADR 0018 makes load-bearing for `schemas/` stays exactly true.
Nothing under `schemas/` changes.

This avoids what ADR 0018 actually argued against. There is no third *stored*
copy of any given fact: no rendering exists until a browser requests it, so
nothing can drift out of sync with a schema edit — the viewer always reads
whatever `schemas/`'s published copy currently says. And no schema-version-
specific work is needed when a new spec version is added: the viewer is
generic over whatever `index.json` lists, not regenerated per version.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Bake per-version HTML into `schemas/` at publish time | Exactly the shape ADR 0018 already rejected, for the same reasons: a third stored copy of the same facts, a generator, a style, and a published tree that now needs regenerating on every schema change. |
| A server-side renderer or backend | Adds a stateful or standing-compute component. Rule 6 puts state in object storage, not the cluster; rule 7 runs compute through SLURM, with nothing long-lived on a login or compute node. A rendering service is exactly the kind of standing compute ADR 0007 already sidestepped by proxying static files instead of running one. |
| Do nothing; point people at the raw JSON | The status quo this ADR exists to change. Rejected because a person asked directly to browse the spec, not validate it. |

## Consequences

`docs/architecture/repository-layout.md` gains an eighth top-level directory,
`schema-docs/`, and its note that generated HTML documentation is deliberately
absent needs correcting to describe what exists now and why it is not the
shape ADR 0018 rejected. That edit is a separate task in this mission, not
made by this ADR.

`docs/reference/s3-layout.md` gains a row for the `schema-docs/` prefix.
Also a separate task.

`ops/k8s/prod/schemas.yml` gains a new `location /docs/` block proxying to
that prefix. Also a separate task, in the private `ops/` repository, and its
application to the cluster is the user's to run, not this mission's.

The viewer has no build step and no test of its own beyond manual
verification against the live public JSON. That is acceptable because it
stores no facts of its own to get wrong — every fact it shows is fetched
fresh from the schema it is displaying.
