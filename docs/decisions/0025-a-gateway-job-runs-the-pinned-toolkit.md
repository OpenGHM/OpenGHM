# ADR 0025 — A gateway job is a slurmly batch job whose body runs the pinned toolkit

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-30 |
| **Affects** | [`../architecture/gateway.md` §5](../architecture/gateway.md#5-the-two-paths-that-leave-the-cluster), [open item 9](../reference/open-items.md), [ADR 0015](0015-model-input-is-a-published-artifact.md), [ADR 0023](0023-simulation-output-stays-on-scratch.md) |

## Context

The gateway can submit, watch and cancel a SLURM job over SSH (`slurmly`).
What it submits does not run WBM: the body was a placeholder `echo`, or an
`apptainer run` against a runscript that is `/bin/bash`.

The toolkit already knows how to run a published snapshot on Anvil, and it
reproduced the published output bit-for-bit, first by fetching the snapshot
and then after the model input moved out of it. The steps are:

1. `openghm snapshot fetch` downloads and verifies the tree, the linked model
   input and the pinned image.
2. `openghm sim run` rewrites the init, binds the pieces, and runs `wbm.pl`.

The gateway was first meant to work without the toolkit, because the toolkit
did not exist yet. That reason is gone.

## Decision

**The gateway keeps submitting and watching the batch job through slurmly.
The job's body runs the toolkit.** Two steps, in order:

1. `openghm snapshot fetch <id>` into a shared cache on Anvil scratch, under
   `flock` so two jobs never fetch the same tree at once.
2. `openghm sim run <cache>/<id> --id <sim_id>` with the draft's run period
   and output variables, and a spool of its own, so that no two runs share
   one.

- **The toolkit is pinned by identity.** It is installed per public-repository
  commit at `/home/x-openghm/apps/openghm/<commit>/`, and it runs with a
  gateway-only config beside it.
  - The gateway names the install through a setting.
  - Each job records the path and the commit.
  - A new install is a new directory. An old one is never rebuilt in place.
- **The caches live on scratch.** The snapshot tree, the model inputs and the
  images all go under `/anvil/scratch/x-openghm/cache/`.
  - The project filesystem was 97.7% full on 2026-09-30 (`myquota`), so it
    cannot hold them.
  - Home is 25 GB.
  - A purged cache is re-fetched and re-verified by the next job.
- **The work of each run stays under `output_base/<sim_id>/`** on scratch
  (ADR 0023). slurmly's own job directory, holding the script and its logs,
  sits beside it.
- SLURM gets `--cpus-per-task` and `--time` from the draft, falling back to
  the snapshot's `simulation.recommendedCompute`. It also gets the account.

## Alternatives considered

| Option | Why it lost |
|---|---|
| **A.** The gateway renders the whole run itself: downloads and checksums, the init rewrite, bind mounts, `apptainer exec` | A second copy of what `fetch.py` and `sim.py` already do and have verified. The model-input move had to change two places; this would make it three, each needing its own verification |
| **C.** The gateway SSHes `openghm sim submit`, and the toolkit owns sbatch | `sim submit` needs the snapshot already fetched, so a multi-gigabyte first fetch would run on a login node (rule 7) inside an HTTP request. Moving the fetch into the toolkit's own batch script would be a toolkit feature first. It stays possible later, and nothing here blocks it |

## Consequences

- The gateway depends on a toolkit install on Anvil. A job cannot run until
  the pinned commit is installed there. The runbook is in the ops
  repository's `anvil-environment.md`.
- Only a snapshot's defaults run until the toolkit grows flags for them:
  - a model-input override;
  - a spatial subset;
  - custom init parameters.

  The submit route refuses those fields (open item 9, narrowed).
- WBM uses its own default of 4 threads whatever SLURM grants, because the
  toolkit passes no thread count.
- A run builds its own spool, which costs time on every run. Sharing a
  published spool read-only would need evidence that WBM never writes to a
  complete one.
