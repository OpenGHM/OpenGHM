# ADR 0003 — zot is the SIF registry, with a plain-S3 mirror alongside

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-04 |
| **Affects** | Composable Subsystem workloads, `container/` |

## Context

Container images for WBM are Singularity/Apptainer SIF files, and runs must
pin an exact image. That needs somewhere to store SIFs addressable by digest.

Anvil already runs a registry at `registry.anvil.rcac.purdue.edu`, which the
gateway uses for its own backend and frontend images.

## Decision

Run **zot** — a single-binary OCI registry — in the `openghm` namespace on
Anvil's Composable Subsystem, backed by Anvil S3 under a `registry/` prefix,
with anonymous read and authenticated publish. SIFs are pushed and pulled with
**ORAS**, which stores the SIF as one plain OCI artifact so a pull returns
exactly the bytes that were verified.

Alongside it, mirror every image to plain S3 under `containers/<name>/<version>/`.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Anvil's existing registry | We want control over retention, access policy and lifecycle for published scientific artifacts, and not to be coupled to another team's registry policy for images that snapshots pin permanently. |
| Harbor | 8–10 pods (core, portal, registry, jobservice, redis, postgres, trivy) for what one Go binary does at our scale. |
| `docker://` instead of ORAS | A `docker://` pull rebuilds a SIF per user, so the bytes differ from what was verified. |
| Plain S3 only, no registry | No tags, no digest resolution, no garbage collection — we would reimplement registry semantics in `manifest.json`. |
| `library://` (Sylabs) | Self-hosting is a commercial product. |
| `shub://` | Retired since 2021. |

## Consequences

One new stateless workload. Two distribution paths for the same images, which
must be kept in step — `containers/manifest.json` is the only mutable object in
the mirror.

The mirror is not redundant: compute nodes have outbound internet and *could*
pull from zot, but plain HTTPS needs no `oras://` support and no login, and the
existing `assets.py` client already speaks it — which also covers consumers
that are not Apptainer at all, such as `openghm` running on a laptop.
