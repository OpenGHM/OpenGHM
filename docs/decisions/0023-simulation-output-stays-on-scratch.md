# ADR 0023 — A simulation's output stays on Anvil scratch until it is published

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-30 |
| **Affects** | [ADR 0009](0009-output-is-carried-not-reproducible.md), [`../architecture/gateway.md`](../architecture/gateway.md#5-the-two-paths-that-leave-the-cluster), [open item 10](../reference/open-items.md) |

## Context

A simulation writes its output to its own directory on Anvil scratch
(`openghm sim`'s `output_base`; ADR 0009's per-simulation scratch). The
plan was that the SLURM script would then upload those results to S3
itself, from the compute node and with its own credentials, so that the
gateway could link to them. That upload was never built. It was blocked on
where the script's credentials come from (open item 10), and it would have
given every run write access to the bucket.

Most runs are never published. Someone runs one, looks at it and runs
another. Uploading each of them puts private, unpublished output into a
bucket whose objects are public, and that output has no id, no
`metadata.json` and no key in [`../reference/s3-layout.md`](../reference/s3-layout.md).

## Decision

**A simulation's output stays where the run wrote it, on Anvil scratch.
Nothing uploads it after the run.** It reaches S3 only when it is
published as a snapshot. The publish step writes it under the new
snapshot's own key, together with the rest of that tree.

So no job-output location or link exists, and none is planned. A
download link is always a link to a published artifact.

*Changed by [ADR 0040](0040-a-runs-output-on-scratch-downloads-as-a-zip-up-to-500-mb.md):
the owner of a run can download what is checked in its scratch output as one ZIP, which
the backend reads over SFTP and streams. The output still goes nowhere else: nothing is
uploaded to S3, and a link is still only ever to a published artifact.*

## Alternatives considered

| Option | Why it lost |
|---|---|
| The job script uploads its output after every run | It needs bucket write access for every run. It fills a public bucket with unpublished output that has no id and no key. |
| The backend copies the output to S3 | The backend deliberately holds no S3 credentials ([gateway.md §5](../architecture/gateway.md#5-the-two-paths-that-leave-the-cluster)). |

## Consequences

- Open item 10 is narrower. It now asks where the *publish* step's S3
  credentials come from. That is one step, run on purpose, not every job.
- Scratch is purged. Anvil has a purge (`purgelist` and `lastpurge` exist on
  the login nodes), but the age threshold is not confirmed here. So a
  finished run that has not been published can disappear. Its `jobs`
  document then points at nothing. Publishing is how a result is kept.
- The gateway shows a finished run's status and logs over SSH. It could not
  offer its output for download; since ADR 0040 it streams a selection of it as
  a ZIP of at most 500 MB.
