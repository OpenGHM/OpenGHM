# Artifact versioning — architecture

How a WBM simulation is identified, stored, and reproduced.

**Status: target**, with most of it built. Where something exists, the text
says so; where it does not, it is target. Built: the five axes and their pins in
`metadata.json`, three published snapshots and two published model inputs, the
`wbm-code/` and `containers/` prefixes, the published spools, and publishing
a finished run as a snapshot (`openghm snapshot publish`, [ADR 0031](../decisions/0031-a-snapshot-draft-is-published-by-a-job.md)).
Not built: enforcement of immutability beyond the publisher's own check
([Upload and lock](../reference/s3-layout.md#upload-and-lock)), a CI-driven
publish, the `-s3` image variants' publication, a toolkit command that publishes
a model input, fetching a snapshot's code from `wbm-code/` instead of from the
snapshot, and the WBM repository that would feed `wbm-code/`
([open items](../reference/open-items.md)). Read it as a description of the
destination that the system is already close to, never as a description of how
the gateway behaves.

The gateway that runs today is a different document:
[gateway.md](gateway.md).

This document is **stable by design**: it describes shape, not procedure. The
reasoning behind each choice is in [`../decisions/`](../decisions/); the exact
commands, formats and environment values are in
[`../reference/`](../reference/); the work to build any of it is a mission in
`ops/missions/` (private).

---

## 1. The unit: a snapshot

A **snapshot** is one folder that reproduces one WBM simulation — code, run
configuration, a link to the inputs, and the output it produced.

![Snapshot assembly and run](diagrams/img/snapshot_graph.png)

*What is bundled, what is pinned, and what the run produces. Solid edges move
bytes; dashed accent edges are declarations in `metadata.json`. The snapshot is
mounted read-only, so everything the run produces lands in per-simulation
scratch.*

The snapshot folder holds the model code, run configuration, `metadata.json` and
its `SHA256SUMS` integrity manifest — plus the `wbm_output/` it produced, which is
deliberately *not* part of its identity
([ADR 0009](../decisions/0009-output-is-carried-not-reproducible.md)) and is most
of a published snapshot's bytes, which is why what to ship is a real decision
rather than a detail. A run's saved state, `WBM_run_state/`, is optional and
travels the same way: it is what a run continues from
([simulation-reuse.md](simulation-reuse.md) §3).

The spool is not in the folder either. It is the model input's datasets warped
onto a network grid, so it belongs to the model input, not the snapshot: it is
kept once per model input, network and variant, under `spools/<model input id>/`
on S3 and in a scratch cache that runs share. A run links the days the cache
holds, read-only, builds the rest in its own scratch, and hands them to the
cache after it exits 0
([ADR 0029](../decisions/0029-a-run-computes-only-what-is-not-published.md),
[simulation-reuse.md](simulation-reuse.md) §4).

Input data is **not** in the folder. It is a separately published artifact that
`metadata.json` links by id, and the run binds it from a shared cache
(`<model_input_dir>/<id>/`) at `/wbm/data` and `/wbm/data_init`
([ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md)).
Bundling it meant every snapshot stored its own copy of the same 49 GB.

Exact tree and sizes: [`../reference/snapshot-layout.md`](../reference/snapshot-layout.md).

## 2. Five axes

Five artifacts version independently. One snapshot's `metadata.json` pins all
five ([ADR 0002](../decisions/0002-five-versioned-axes.md)).

| # | Artifact | Identifier — what a pin cites | Assigned by | Verifiable against |
|---|---|---|---|---|
| 1 | Snapshot spec | semver | us, per change | n/a — the version *is* the contract |
| 2 | Snapshot instance | minted id | the publisher, at publish | `SHA256SUMS` |
| 3 | Model input | minted id | the publisher, at publish | `SHA256SUMS` |
| 4 | Container image | `sha256` digest | the build | digest + lock record |
| 5 | WBM code | `sha256` tree hash | the code | `TREEHASH` |

Only axis 4 is still **recorded rather than chosen** — an OCI digest falls out
of the build and is also the address the image is pulled by. Axes 2 and 3 were
content hashes until
[ADR 0014](../decisions/0014-identity-is-a-minted-id.md): their ids are now
minted at publish time, unique but not derived from the bytes, and integrity
moved to a separate, optional check against `SHA256SUMS`.

Three kinds of identifier appear above, and they behave differently:

| Kind | Rule | Used by |
|---|---|---|
| **Contract** — semver | MAJOR bump on a breaking change | axis 1 |
| **Minted** — random id | assigned once at publish, never reused, never reassigned | axes 2, 3 |
| **Content** — digest | the hash *is* the identity; different bytes are a different version | axes 4, 5 |

Tags and slugs are mutable aliases for humans. **Pins always cite a minted id or
a digest.**

Axis 5 is pinned by its tree hash in `uses.modelCode`
([ADR 0032](../decisions/0032-wbm-code-is-published-and-pinned-by-tree-hash.md)):
`{ name, version, treeHash }`, where the hash (the recipe of
[ADR 0008](../decisions/0008-exclude-inline-from-code-hash.md)) is the identity
and the name and version say which `wbm-code/<name>/<version>/` directory holds
the bytes. The container carries no code, so its version does not stand in for
it. A snapshot ships its own copy of the code, and `validate`, `fetch` and
`publish` refuse a tree that does not hash to the pin.

## 3. Storage

One Anvil S3 bucket, `openghm`, is the published destination for everything.
Anvil's GPFS project space is staging — where snapshots are assembled and where
jobs read from — not the archive.

```
openghm/
  snapshots/<id>/…                   # minted id — an open namespace
  model-inputs/<id>/…                # minted id — an open namespace
  spools/<model input id>/<network>/<variant>/…   # curated — warped inputs shared by runs
  wbm-code/<name>/<version>/…        # curated
  containers/<name>/<version>/…      # curated — plain-S3 SIF mirror
  registry/…                         # zot's own blob store, opaque
  schemas/…                          # the spec's published files
  schema-docs/…                      # the browsable spec docs
```

`old/` also exists, for objects that left the curated layout; nothing cites it.

**The namespace decides the key, not the kind of artifact**
([ADR 0005](../decisions/0005-namespace-decides-the-key.md)): snapshots and
model inputs are the prefixes users publish into, so their keys are minted ids
that cannot collide with a name somebody else picked
([ADR 0014](../decisions/0014-identity-is-a-minted-id.md),
[ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md)); the rest
are curated by us, so a readable path is worth more. Integrity never depends on
the path: a snapshot, a model input and a code version each ship a manifest, and
checking it is a step of its own.

Per-prefix rules and mutable objects:
[`../reference/s3-layout.md`](../reference/s3-layout.md).

## 4. What runs where

![What runs where](diagrams/img/deployment_topology.png)

*What is deployed now. A maintainer's workstation applies manifests and pushes
images to Anvil's Composable Subsystem, and reaches Anvil's HPC side over ssh.
The Composable Subsystem runs the gateway (dev) and the workloads that serve
published content (prod, accented). Anvil S3 holds the published bytes and is
read over plain HTTPS. Anvil's HPC side runs the jobs, and what writes to the
bucket runs there too, apart from zot. The gateway's own request path is
[gateway.md](gateway.md).*

The diagram follows the manifests in the private `openghm-ops` repository; what
the cluster itself holds was not re-checked.

| Namespace | Workload | Job | Hostname | Decision |
|---|---|---|---|---|
| `openghm` (prod) | **zot** | OCI registry for SIFs | `registry.openghm.org` | [ADR 0003](../decisions/0003-zot-as-sif-registry.md) |
| | **nginx** | proxies the spec's schemas out of S3 | `schemas.openghm.org` | [ADR 0007](../decisions/0007-schemas-on-s3-behind-a-proxy.md) |
| | **nginx** | one static page, a placeholder for the gateway | `openghm.org` | |
| `openghm-dev` | **gateway**: frontend, backend, MongoDB | the portal as it runs | `dev.openghm.org` | [ADR 0019](../decisions/0019-publishing-infrastructure-is-a-single-instance.md) |

The publishing workloads are one instance, in prod, and **hold no state**: zot
and the schemas proxy keep their bytes in Anvil S3, so a rescheduled pod loses
nothing and there is no volume to back up. The gateway holds state, and MongoDB
is the one workload with a volume ([gateway.md](gateway.md) section 4). The
gateway's manifests are in prod too, at no replicas; prod serves the landing
page until the gateway is activated there.

**zot is deployed and live** (`2026-09-25-zot-deploy`, private): one pod,
anonymous read, htpasswd publisher auth, backed by Anvil S3 under `registry/`.
Three images are published so far — `wbm-v1-lite`, `wbm-v2-lite`,
`wbm-tools-lite`, all `openghm/<name>:<tag>` — mirroring the S3 layout above,
`containers/` is no longer empty either. Each of the three has a committed lock
record, `images/<name>/lock/<version>.lock.json`, read from the published SIF
itself and backed by a fresh prod-comparison run
([metadata-format.md](../reference/metadata-format.md#container-lock-record)).
That is axis 4's "digest + lock record" made real for them.

**What publishes.** There is no CI (`.github/` holds only `CODEOWNERS`) and
neither repository has a git remote, so nothing publishes from a git host. A
publish is a script or a job that runs on Anvil and writes to the bucket with
`s3cmd`, except zot's own writes under `registry/`
([s3-layout.md](../reference/s3-layout.md), the *Written by* column). A snapshot
is published by a SLURM job the gateway submits
([ADR 0031](../decisions/0031-a-snapshot-draft-is-published-by-a-job.md)); an
image by `ops/anvil/publish_container.sh`, which pushes it to zot with `oras`
and mirrors it to `containers/`; model inputs and spools by the scripts under
`ops/anvil/`, run as batch jobs. All of the private scripts are started from a
maintainer's workstation over ssh.

**Still target:**

- The `-s3` image variants are not published, and have no lock record.
- A CI-driven publish path does not exist.
- Installing a revision from zot into a shared tree on the login node is not
  built: nothing in the repository pulls from zot, and a job reads the S3
  mirror (`uses.container.https`) because it needs no credentials and no
  `oras://` support.

## 5. The spec

The snapshot spec is the contract every snapshot declares conformance to. One
semver version covers two files, because they are checked two different ways
([ADR 0006](../decisions/0006-spec-is-two-files.md)): a **JSON Schema** for
`metadata.json`'s fields, and a **plain path list** for the folder layout,
which JSON Schema cannot express.

It lives in `schemas/` in this repository and is generated outward — into the
backend model and the frontend types — while the `openghm` wheel carries
`schemas/` itself, through a symlink, for offline validation. That is why the
application, the toolkit and the spec share one repository
([ADR 0001](../decisions/0001-unified-repository.md)). A model input has a spec
of its own beside it, `model-input-spec`
([ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md)), and both
share the `about` and `spatial-coverage` definitions under `schemas/common/`
([ADR 0018](../decisions/0018-shared-definitions-and-no-renderings.md)).

Field vocabulary, publish URLs, and version rules:
[`../reference/snapshot-spec.md`](../reference/snapshot-spec.md).

## 6. Tying it together

Every axis resolves from one object — the pin block in a snapshot's
`metadata.json`:

```json
{
  "$schema": "https://schemas.openghm.org/snapshot-spec/metadata/1.0.0.json",
  "id": "3f9c1a…",
  "slug": "wbm_storage_v2.0.0",

  "simulation": { "init": "wbm_test.init" },

  "uses": {
    "container": { "image": "wbm-v2-lite", "version": "2.0.0-r3",
                   "digest": "sha256:9f2c…", "oras": "…", "https": "…" },
    "modelCode":  { "name": "wbm", "version": "23.9.0", "treeHash": "664c291d…" },
    "modelInput": { "id": "7d4e9a…" }
  }
}
```

Full field reference:
[`../reference/metadata-format.md`](../reference/metadata-format.md).

---

## Where the rest went

| You want | Look in |
|---|---|
| Why a choice was made, and what lost | [`../decisions/`](../decisions/) |
| Exact paths, endpoints, versions, formats | [`../reference/`](../reference/) |
| How to build any of this | `ops/missions/` (private) |
| What is still undecided | [`../reference/open-items.md`](../reference/open-items.md) |

Diagram sources are in [`diagrams/`](diagrams/); rasterize with
`rsvg-convert -z 2 -b white -o diagrams/img/<name>.png diagrams/<name>.svg`.
