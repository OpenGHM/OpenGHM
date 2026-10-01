# ADR 0010 — Top-level directories grouped by what a thing *is*

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-04 |
| **Affects** | the whole repository |

## Context

[ADR 0001](0001-unified-repository.md) settled that one repository holds the
gateway, the toolkit and the spec. It did not say how they sit next to each
other, and the result was a flat root of eleven entries where two products were
each split into two pieces and deployment was split into four.

Adding zot and the schema host makes it worse: neither has source code, so
there is no obvious place for their configuration at all.

## Decision

| Directory | Holds |
|---|---|
| `web-gateway/` | the portal — frontend and backend together |
| `packages/` | publishing boundaries; today just the `openghm` wheel |
| `images/` | container recipes published to zot |
| `schemas/` | the snapshot spec, owned by neither side |
| `deploy/` | k8s manifests, third-party service config, the local stack |
| `devdocs/` | this knowledge base |
| `.github/` | workflows and shared actions — arrives with the first CI mission |

No `apps/` wrapper: there is one application. `container/` becomes `images/`
because the old name collided with the `containers/` S3 prefix and with the
gateway's own container images.

### What `images/` holds

**One directory per image**, including the two direct-S3 builds —
`images/wbm-v1-lite-s3/` and `images/wbm-v2-lite-s3/`. What makes them images
is that each is a separately published artifact: its own Singularity `.def`,
its own extras and patch notes, its own SIF at its own path on Anvil. zot gets
a distinct artifact from each, which is the test `images/` is for.

They are **not** independent builds, and the record should be honest about it:
stage 1 of each is the sibling image's Dockerfile. A derived image is still an
image, and `images/wbm-v1-lite-s3/` sitting beside `images/wbm-v1-lite/` states
that relationship the way the files already do.

That they are separate builds rather than one parameterised build is settled by
v1's constraint: v1 binds GDAL through the SWIG `Geo::GDAL` module, ABI-locked
to the libgdal it was compiled against and removed from GDAL after 3.4, so v1
cannot re-point at a bundled newer GDAL the way v2's FFI shim does. There is no
flag that turns one into the other. They also carry no `deploy_to_anvil.sh` —
Apptainer builds the SIF from the `.def` after stage 1, rather than the
docker-save-and-copy route the three Dockerfile images use.

**`images/verification/` is the one entry that is not an image.** Its scripts
name deployed SIFs by absolute Anvil path and compare *across* images — stock
against lite, lite against direct-S3 — so it belongs to no single image
directory, and each image already has its own `test/` for its own runs. It is
not published to zot.

So `images/` does not mean "one directory per image" without qualification. The
qualification is a single named exception rather than a category, so the next
non-image thing proposed for `images/` has to argue against a specific
precedent instead of a general rule.

## Alternatives considered

| Option | Why it lost |
|---|---|
| `apps/` + `packages/` + `infra/` (Nx / Turborepo convention) | Familiar, but `apps/` would hold exactly one entry. Adopt it if a second application appears. |
| Group by domain: `gateway/` and `wbm/{cli,images}` | Reads well, but buries the wheel's publishing boundary inside a topic directory, which is the one edge that has to stay sharp. |
| Leave the root flat and only group `frontend`/`backend` | Fixes the most visible half and leaves deployment split across four entries, with still nowhere for zot's config. |
| `images/wbm-v1-lite/s3/` — the S3 build under the image it derives from | Reads the dependency correctly but hides a separately built, separately deployed SIF one level down, where nothing published to zot otherwise sits. |
| A top-level verification directory | Every other directory answers "what is this?"; this one would answer "whose tests?". |

## Consequences

`deploy/k8s/<env>/` stayed flat when this was written, because
`kubectl apply -f` is not recursive, and four of its seven manifests were
near-duplicates across the two environments. It has since moved to `ops/k8s/` and become
kustomize — `base/` plus `overlays/{dev,prod}/` — which is what removed the
duplication.

The four superseded Dockerfiles that were in `container/old/` are not carried
over; they are committed in the `toolkits` repository this tree was copied
from. A reader following a reference to them needs that checkout, which no
other path in this repository requires.
