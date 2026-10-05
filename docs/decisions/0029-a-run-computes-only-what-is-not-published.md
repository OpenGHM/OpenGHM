# ADR 0029 — A run computes only what is not already published

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-05 |
| **Affects** | [`../architecture/simulation-reuse.md`](../architecture/simulation-reuse.md), [`../architecture/gateway.md`](../architecture/gateway.md), [ADR 0009](0009-output-is-carried-not-reproducible.md), [ADR 0025](0025-a-gateway-job-runs-the-pinned-toolkit.md) |

## Context

Every gateway run starts WBM from an empty run state into an empty spool. Yet
every draft the gateway accepts today asks for a period inside the snapshot's
and variables among its own, so its answer is already in the snapshot's
`wbm_output/`. A Global rerun costs 4 d 15 h on 26 cores to produce files that
are public on S3.

WBM can resume from a saved state, and a snapshot carries the state its run
ended with. Run in a snapshot folder that holds it, WBM ends in seconds and
writes nothing; that is where "with the spool it finishes at once" came from,
and it is not a rerun. The spool, measured, saves about a quarter of a Global
day that has to build it and 40% of a v2 day, not most of the run.

## Decision

**A draft is classified before it is queued, and WBM computes only what the
snapshot does not already answer.**

- A draft the snapshot answers (same inputs, domain and parameters; period and
  variables inside the published ones) is not queued. Its results are the
  published files. Rerunning it is an explicit choice for verification.
- A draft that only extends the period past the published end starts from the
  snapshot's end-of-run state and computes the added years.
- Any other draft computes from an empty state, as today.
- A spool belongs to the model input, not to a snapshot: it is kept per
  model input, network and variant (the run's settings without its dates and
  names), in a scratch cache and under `spools/<model input id>/` on S3,
  filled from S3 before it is built, built into a run's own directory and
  moved into the cache after the run, and read-only to a run that reads it.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Keep rerunning everything | Spends days of allocation to reproduce public files. |
| Mount the snapshot's `WBM_run_state/` as the run's own | WBM resumes from the end and computes nothing; with a changed draft it resumes from the wrong state. |
| Reuse the spinup state (`<ID>.spinup.*`) for changed drafts | It is only valid when nothing that shapes the spinup changed, and such a draft is already Published or Continue. |
| Keep the spool in each snapshot, as now | Every snapshot of the same model input and network repeats it; the Global and Wyoming snapshots already hold the same 10 GB Wyoming spool twice. |
| Put the spool inside the model input's tree | A published model input does not change, and a spool gains days whenever a run needs new ones. |
| Share one spool directory per network, as WBM lays it out | Its path leaves out the warp options and the dataset definition, so a variant would read another's files, and its writes are not atomic, so a half-written day could be read. |

## Consequences

- The most common run, a snapshot as published, costs no allocation.
- Published results become something the gateway shows, not only something a
  snapshot carries; ADR 0009 says the snapshot does not assert that output is
  reproducible, so the results page says which run produced them.
- `fetch` has to download `WBM_run_state/` for a Continue run (9 GB for Global),
  and the wizard's latest end becomes the model input's coverage.
- A run gains a preparation step (`wbm.pl -noRun`, then the missing days).
- The spool key is the reuse envelope open item 2 asks for. A snapshot's own
  `spool/` is retired once its days are under `spools/<model input id>/`, and the snapshot
  layout and spec stop listing it.
- Uploading the days a run builds waits on open item 10; until then they live
  only in the scratch cache.
