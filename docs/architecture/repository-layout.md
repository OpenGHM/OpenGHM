# Repository layout

**Status: built.** These directories exist, with the two marked exceptions —
`deploy/services/` and `.github/` are empty placeholders and say which mission
fills them.

Eight top-level directories, each answering "what is this?" in one word.
`.claude/` is agent configuration and is not one of them.

```
OpenGHM/
├── web-gateway/     the portal — the only application we write
│   ├── frontend/    Next.js + Dockerfile
│   └── backend/     FastAPI + Dockerfile
├── packages/
│   └── openghm/     the library + CLI, published as a wheel
├── images/          WBM container recipes, published to zot
│   ├── wbm-tools-lite/  wbm-v1-lite/  wbm-v2-lite/
│   ├── wbm-v1-lite-s3/  wbm-v2-lite-s3/     the direct-S3 builds
│   └── verification/    cross-image comparison runs — not an image
├── schemas/         the snapshot spec — one source, generated outward
├── schema-docs/     the spec docs — generated from schemas/, checked in
├── deploy/          everything that reaches a laptop
│   ├── services/    third-party config — arrives with mission 0004
│   └── local/       compose stack, mongo init, .env.example
├── docs/            this knowledge base
├── .github/         workflows and shared actions — arrives with mission 0003
├── .claude/         shared agent settings (local grants are gitignored)
├── ops/             the private openghm-ops clone — gitignored, may be absent
└── AGENTS.md  CLAUDE.md  justfile  README.md
```

`ops/` is a separate repository ([ADR 0016](../decisions/0016-split-public-and-ops-repositories.md)):
cluster manifests, encrypted secrets, the operator reference documents and the
missions. Nothing here tracks it, and everything above works without it.

## Why each thing is where it is

**`web-gateway/` holds both halves of one product.** The frontend and backend
are one deployable thing with one release cycle; splitting them across the repo
root made that invisible. There is no `apps/` wrapper because there is one app,
and a directory containing exactly one thing is a level of nesting that buys
nothing.

**`packages/openghm/` is a publishing boundary, not a topic.** The wheel goes
to PyPI, so that directory has to stand alone: its own `pyproject.toml`,
`README.md` and `tests/`, self-contained enough to be extracted into its own
repository if a public source repo is ever needed
([ADR 0001](../decisions/0001-unified-repository.md)). Grouping it under a
topic directory would blur that edge.

**`images/` sits beside `packages/` because both are published artifacts** —
one to PyPI, one to zot. The name `container/` was dropped: it collided with
the `containers/` S3 prefix and with the gateway's own container images, three
different meanings for one word.

**Five of the six entries under `images/` are images, and one is not.** The
five are the three lite builds and the two direct-S3 builds beside them; the
S3 pair are separate images rather than variants because each carries a
complete Singularity `.def` instead of a patch over a neighbour, and deploys
its own SIF. `images/verification/` is the exception: its scripts name
**deployed** SIFs by absolute Anvil path and compare *across* images — stock
against lite, lite against direct-S3 — so it belongs to no single image
directory, and each image already carries its own tests for its own runs. It
is not published to zot. See
[ADR 0010](../decisions/0010-repository-layout.md).

**`schemas/` is top-level because neither side owns it.** It is the contract
between the gateway and the toolkit. Under either one, the other would be
reaching into a foreign directory for its own types.

**`schema-docs/` is neither `deploy/services/` nor `schemas/`.** It is code we
author and maintain — a hand-written `index.html` plus, since
[ADR 0021](../decisions/0021-generate-schema-docs-with-json-schema-for-humans.md),
a `schema-docs/generated/` subtree built by `just schema-docs-gen` — so it is not
third-party config, which is what `deploy/services/` is for. It is not part
of the spec tree either: `schemas/`'s own layout is a contract
([ADR 0018](../decisions/0018-shared-definitions-and-no-renderings.md)), and
nothing that isn't a schema belongs inside it, generated or not. Neither
existing directory fit, so it gets its own.

**`deploy/services/` is for things we operate but do not build — and stays
empty.** zot and the schema-host nginx have no source in this repository, so
placing them next to `web-gateway/` would read as though they were products of
ours. The plan when this was written was a Helm values file and an
`nginx.conf` here; what actually shipped for both
(`2026-09-19-serve-the-spec`, `2026-09-25-zot-deploy`, private) is plain k8s
manifests in the private `ops/` repository's `ops/k8s/prod/` — `schemas.yml`
and `zot.yml` — the same place every other cluster manifest already lives, so
a second, public-repo deployment tree for just these two never had anything
to hold. `deploy/services/` remains the placeholder for a *build artifact*
this repository is supposed to produce and doesn't own the deployment of
(a Helm chart, say) — nothing here has needed that shape yet.

**`deploy/local/` is defined as much by what it lacks.** It brings up MongoDB,
a Redis nothing reads ([gateway.md](gateway.md#6-what-is-absent-and-not-by-oversight)),
and nothing else. Open the compose file and the absence of S3 and of the
registry is the signal that those are remote
(see [local-development.md](local-development.md)).

## Generated files

Four artifacts are produced from `schemas/*-spec/metadata/<ver>.json` and are
never hand-edited. The first three now exist (`ops/missions/2026-09-18-gateway-on-the-spec/`,
private, built them); this is the shape:

```
schemas/snapshot-spec/metadata/<ver>.json
   ├─ datamodel-codegen ──▶ web-gateway/backend/app/models/…
   ├─ json2ts ────────────▶ web-gateway/frontend/lib/repository/…
   ├─ copy ───────────────▶ packages/openghm/src/openghm/schemas/
   └─ json-schema-for-humans ─▶ schema-docs/generated/snapshot-spec/<ver>/metadata.html
```

The fourth, `schema-docs/generated/`, **is built**: `just schema-docs-gen`
runs [json-schema-for-humans](https://github.com/coveooss/json-schema-for-humans)
over every version each spec's `index.json` lists and commits the result,
the same convention `web-gateway/backend/app/models/generated/` will use once
it exists — a `GENERATED -- do not edit by hand` marker on every output file,
idempotent, meant to be checked by CI once CI exists.
[ADR 0021](../decisions/0021-generate-schema-docs-with-json-schema-for-humans.md)
has the reasoning, including what was verified empirically about the tool's
`$ref` resolution and filename collisions. `schema-docs/index.html` itself is
hand-written, not generated: one card per spec, transcribing its current
version from `index.json` and its `title`/`$id` from the metadata schema by
hand, linking to the generated doc and the raw JSON. `layout/<ver>.json` is
not shown — it is a fixed, non-JSON-Schema shape json-schema-for-humans is
not pointed at. Each schema's own
`description` fields are still the underlying documentation;
`schema-docs/` is a second way to read them, not a replacement for them.

This is the whole reason the repository is unified: a spec bump is one commit,
and CI can assert that regenerating produces no diff. Split across
repositories that check cannot run at all.

## Conventions

- Directories are lowercase and hyphenated: `web-gateway`, `wbm-tools-lite`.
- `images/` holds one directory per image. `images/verification/` is the only
  exception, and it is a named one rather than a category — anything else
  non-image proposed for `images/` argues against that precedent, not a rule.
- A directory that would contain exactly one child forever does not get created.
- Anything generated carries a header saying so and names the source file.
- `ops/k8s/<env>/` stays **flat** — `kubectl apply -f` is not recursive.
  Converting to kustomize `base/` + `overlays/` is mission 0008.
