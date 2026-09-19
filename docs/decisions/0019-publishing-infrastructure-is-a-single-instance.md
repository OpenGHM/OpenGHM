# ADR 0019 — Publishing infrastructure is a single instance, in prod

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-19 |
| **Affects** | `ops/k8s/`, the `schemas.openghm.org` proxy, zot |

## Context

The gateway runs as a dev/prod pair: `openghm-dev` is where work is verified,
`openghm` is what users get, and one built image is promoted between them. The
obvious generalisation is that everything we deploy gets the same treatment.

Two workloads do not fit it: the nginx proxy that serves
`schemas.openghm.org` ([ADR 0007](0007-schemas-on-s3-behind-a-proxy.md)) and
the zot registry at `registry.openghm.org`
([ADR 0003](0003-zot-as-sif-registry.md)). Neither holds state we own, and
neither runs code we wrote. What they serve is *published* — immutable, and
addressed by exactly one name.

ADR 0007 never said which namespace its proxy runs in. ADR 0003 did say
`openghm`, but as a fact rather than a reason, so nothing stopped the next
reader from adding a dev copy for symmetry.

## Decision

The gateway — frontend, backend, MongoDB — is a dev/prod pair. **Publishing
infrastructure is a single instance, in the `openghm` namespace, with no dev
counterpart.** That is the schemas proxy and zot today, and anything later
whose content is published rather than owned.

The dividing question is not what a workload *is*, it is what it *serves*:

| | dev/prod pair | Why |
|---|---|---|
| frontend, backend | yes | our code; one image promoted between them |
| MongoDB | yes | this deployment's own state — accounts, jobs, catalogue, audit |
| schemas proxy | **no** | `$id` names one permanent URL; a second copy is a second source of truth |
| zot | **no** | images are pinned by digest; two registries split the digest namespace |

A dev or local consumer reads from the single instance. That is not a leak and
needs no exception: both are anonymous-read public services, so a dev pod
fetching a published schema is doing exactly what a laptop does.

## Alternatives considered

| Option | Why it lost |
|---|---|
| A dev copy of each, for symmetry | A dev schemas proxy serves the same bucket prefix at a second hostname, returning documents whose `$id` still claims the prod URL. Rule 4: one of the two is wrong, and it is the copy. |
| A dev registry | An image digest present in one registry and absent from the other makes any snapshot pinning it unreproducible — rule 2 pins by digest precisely so that cannot happen. |
| Dev copies backed by separate S3 prefixes | Fixes the split-brain by creating a second published namespace, which is the same problem one layer down. Where publish-path *development* writes is genuinely undecided and tracked in the **Next** list, but it is a question about the bucket, not about running two proxies. |

## Consequences

`ops/k8s/prod/` is a superset of `ops/k8s/dev/` rather than its mirror. That is
deliberate, and it matters for the kustomize work on the **Next** list: the
absence of `schemas.yml` from dev is the design, not drift to be reconciled in
`base/`.

Config changes to these workloads are verified locally instead of in a dev
namespace — a container run against the real S3 endpoint exercises the same
upstream the cluster would, which is a closer test than a second deployment
would give. The durable artefact is the bytes in the bucket, and those are
uploaded independently of whether any proxy is running.
