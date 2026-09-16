# ADR 0007 — Schemas are stored in S3 and served by a stateless nginx proxy

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-04 |
| **Affects** | Composable Subsystem workloads, `schemas/` |

## Context

Published schema files must resolve at a stable URL, because that URL is the
`$id` every published `metadata.json` cites. They also have to get there from
CI on merge.

The obvious cluster-native options all fail on how files get *in*: a PVC cannot
be written from CI without a sync sidecar or a copy job, and a ConfigMap has a
size limit the generated HTML renderings would eventually breach.

## Decision

Publish with `mc cp` to `s3://openghm/schemas/`, and serve
`schemas.openghm.org` from a stateless `nginx` Deployment that reverse-proxies
that prefix. No PVC, no ConfigMap, no git-sync. The bucket is public-read, so
the proxy carries no credentials.

Git holds the source; S3 holds the published copy; the wheel bundles a third
copy for offline validation. Three copies, three distinct roles.

## Alternatives considered

| Option | Why it lost |
|---|---|
| nginx + PVC | Adds durable state to back up, and still needs a separate mechanism to get files onto the volume. |
| nginx + ConfigMap | Generated HTML renderings would outgrow the size limit. |
| S3 only, no proxy | `$id` would carry `s3.anvil.rcac.purdue.edu`, baking a storage decision into every published schema URL permanently. |
| Ingress-only (`ExternalName` + annotations) | Removes even the pod, but expresses the rewrite in annotations rather than a readable config file. Viable; kept as a documented variant. |

## Consequences

One stateless pod. Publishing is one `mc cp` and the proxy picks it up with no
redeploy. The `$id` hostname survives any future move of the underlying
storage.
