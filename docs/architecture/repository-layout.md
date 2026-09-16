# Repository layout

**Status: built.** These directories exist, with the two marked exceptions —
`deploy/services/` and `.github/` are empty placeholders and say which mission
fills them.

Seven top-level directories, each answering "what is this?" in one word.
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

**`deploy/services/` is for things we operate but do not build.** zot and the
schema-host nginx have no source in this repository — a Helm values file and an
`nginx.conf`. Placing them next to `web-gateway/` would read as though they
were products of ours. Nothing lives there yet: mission 0000 creates `deploy/`
but has no third-party config to put in it, and the directory arrives with
mission 0004, which deploys zot.

**`deploy/local/` is defined as much by what it lacks.** It brings up MongoDB,
a Redis nothing reads ([gateway.md](gateway.md#6-what-is-absent-and-not-by-oversight)),
and nothing else. Open the compose file and the absence of S3 and of the
registry is the signal that those are remote
(see [local-development.md](local-development.md)).

## Generated files

Four artifacts are produced from `schemas/snapshot-spec/metadata/<ver>.json`
and are never hand-edited. **None of them exists yet** — the source arrives
with mission 0001 and the generators with mission 0002; this is the shape they
take:

```
schemas/snapshot-spec/metadata/<ver>.json
   ├─ datamodel-codegen ──▶ web-gateway/backend/app/models/snapshot_generated.py
   ├─ json2ts ────────────▶ web-gateway/frontend/src/types/snapshot.d.ts
   ├─ copy ───────────────▶ packages/openghm/src/openghm/schemas/
   └─ generate-schema-doc ▶ schemas/snapshot-spec/docs/<ver>/
```

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
