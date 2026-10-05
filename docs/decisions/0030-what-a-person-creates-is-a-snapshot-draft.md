# ADR 0030 — What a person creates is a snapshot draft, not a simulation

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-06 |
| **Affects** | [`../architecture/gateway.md`](../architecture/gateway.md), [`../glossary.md`](../glossary.md), [ADR 0024](0024-who-may-run-a-simulation.md), [ADR 0028](0028-a-new-simulation-is-stored-when-the-user-saves-it.md) |

## Context

The gateway exists to publish snapshots. What a person creates in the
workspace is the beginning of one: it is edited, submitted, run, and later
published as a snapshot. It was called a *simulation* all the same, and that
word already had a job: one execution of WBM, which is also what a snapshot
reproduces and what the spec's `simulation` block describes. So "simulation"
meant both the thing being prepared and the computation inside it, and a
sentence like "delete a simulation" could be about either.

## Decision

**What a person creates and works on is a snapshot draft, from the moment it
is created until it is published. "Simulation" means one WBM execution and
nothing else.**

- **Snapshot draft** is the whole lifecycle in user-facing copy and in docs:
  *edited*, *submitted*, *run*, and in time *published as a snapshot*. After
  the first mention, "draft" alone is fine where it is unambiguous.
- **The action that starts one is "New snapshot".** A person sets out to
  make a snapshot; that it is a draft until published is what the list and
  its status say, so the button does not repeat it.
- **Status `DRAFT` is shown as "Editing".** The word "draft" now names the
  thing at every status, so it cannot also name one status.
- **A submitted draft's execution is its run** (Queued, Running, Completed,
  Failed, Cancelled). "Cancel run", "Run progress", and the permission is
  "submit runs". "Job" stays the internal and SLURM word.
- **"Simulation" is kept** for one WBM execution, for the spec's and
  `metadata.json`'s `simulation` block, for the toolkit (`openghm sim`,
  `simulation.json`), and for the landing page's marketing copy.
- **Internal names do not change.** The `/jobs` routes, the `Job` model, the
  stored fields (`can_run_simulations`), status values (`DRAFT`, ...), audit
  event ids and the `/workspace` URLs keep their names. They are identifiers
  other things already depend on; the rename is of what a person reads.

## Consequences

- The UI says snapshot draft everywhere a person used to read simulation
  (My snapshot drafts, New snapshot, Delete snapshot draft, Can submit
  runs), and the frontend files and symbols that meant the workspace thing
  are renamed `draft-*`. `job-*` components keep their names, as they mirror
  the backend's job.
- [`../glossary.md`](../glossary.md) defines snapshot draft and run, and
  narrows simulation. The architecture and reference documents use the new
  words.
- Accepted ADRs keep their text, and their filenames keep "simulation".
  ADRs 0001 to 0029 are read with this one: where one says *simulation* for the
  workspace thing, it means a snapshot draft.
