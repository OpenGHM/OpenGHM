# ADR 0026 — How a job's verdict is reached, and how long its files live

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-09-30 |
| **Affects** | [`../architecture/gateway.md` §5](../architecture/gateway.md#5-the-two-paths-that-leave-the-cluster), [ADR 0023](0023-simulation-output-stays-on-scratch.md), [ADR 0025](0025-a-gateway-job-runs-the-pinned-toolkit.md) |

## Context

A gateway job can fail in three layers: the gateway's submit over SSH,
SLURM, and the toolkit or WBM inside the job (ADR 0025). Until now the
gateway kept one of them. slurmly's lifecycle was mapped straight to a
status, the raw SLURM state was dropped, and the exit code survived only
as text in `status_reason`.

That is not enough, for four reasons.

- **SLURM's `COMPLETED` does not mean WBM succeeded.** WBM can stop and
  still exit 0: `Failed to warp … out of memory` is followed by a bare
  `exit`, and a re-run whose state is already at `Run_End` prints
  `Nothing to do`. A finished run prints `All Done!` last (tools copy of
  `wbm.pl`).
- **Exit code 2 means two things.** `openghm sim run` exits 2 when it
  refuses before staging (`packages/openghm/src/openghm/cli/main.py`, `OpenghmError`). After staging it
  exits with the container's code, and a WBM `die` can also be 2. The
  sidecar tells them apart: `simulation.json` gets an `exit_code` only
  once the container ran (`sim.record_exit_code`).
- **A job SLURM forgets stays non-terminal forever.** slurmly raises
  `SlurmJobNotFound` past a 120 s grace window, and the gateway swallowed it.
  Its batched `get_jobs` returns an empty result, not an error, when
  `squeue` and `sacct` both fail. So "absent from one lookup" cannot mean
  "gone".
- **Cancel flipped the status at once**, so SLURM's own end was never
  recorded, and nothing on Anvil was ever removed.

Anvil purges scratch: files not modified or accessed for 30 days are deleted
automatically, with no warning and no override. That is stated on the
Anvil user guide's system-architecture page,
<https://docs.rcac.purdue.edu/userguides/anvil/architecture/>, checked on
2026-09-30. The `lastpurge` and `purgelist` commands ADR 0023 mentions are
broken symlinks for `x-openghm` on the login node.

## Decision

### The job reports its own outcome

The job body (`render_job_body`) runs each step through a wrapper that
records its phase and exit code. An `EXIT` trap writes `outcome.json` into
slurmly's job directory (`$SLURM_SUBMIT_DIR`, since slurmly runs `cd <job
dir> && sbatch`). It writes to a temporary file first, then `mv`, so a
reader never sees half a record. The record holds facts, not a cause:

- the phase reached (`fetch`, `run` or `check`) and each step's exit code;
- the signal that ended the script, if one did;
- whether the run was staged (`simulation.json` has an `exit_code`);
- the WBM markers found in `<work_dir>/wbm_output/<sim_id>/<ID>.log`: `All
  Done!`, `Failed to warp` and `Nothing to do`, where `ID` is read from the
  init the toolkit wrote;
- the last lines of that log;
- the output manifest: each file's relative path and size, and the `.nc`
  count;
- start time, end time and host.

The script exits non-zero when those facts are not a success, so that SLURM
records `FAILED` and agrees with it. The record is written by Python from
the toolkit's own venv, because JSON built in bash breaks on the first
quote in a log line. A `SIGKILL` (out of memory, or the end of the walltime
grace) runs no trap, so a missing record is expected in exactly those
cases.

### The gateway classifies, in this order

The backend's `classify` is the only place a cause is named. The first rule
that matches wins:

1. **SLURM says `CANCELLED`.** If the gateway recorded a cancel request, the
   cause is `cancelled_by_user`. Otherwise it is `cancelled_by_system`.
   Status: CANCELLED.
2. **SLURM killed the job.** `TIMEOUT` → `timeout`, `OUT_OF_MEMORY` →
   `out_of_memory`, and `NODE_FAIL`, `BOOT_FAIL`, `PREEMPTED`, `DEADLINE` or
   `REVOKED` → `node_failure`. Status: FAILED. SLURM wins here because the
   script was killed and its record is absent or cut short.
3. **SLURM says the script exited** (`COMPLETED`, `FAILED` or
   `SPECIAL_EXIT`). The record decides, first failing fact first:
   - no record → `outcome_missing`;
   - fetch exited non-zero → `fetch_failed`;
   - run exited non-zero and was not staged → `run_refused`;
   - run exited non-zero after staging → `wbm_error`;
   - a step without an exit code → `outcome_missing`, because the script
     stopped mid-step;
   - `All Done!` missing, `Failed to warp` or `Nothing to do` present, or
     no `.nc` file → `wbm_silent_failure`;
   - otherwise success. Status: COMPLETED only if SLURM also said
     `COMPLETED`. If SLURM said `FAILED` over a successful record, the
     cause is `outcome_missing`, because the two disagree.
4. **SLURM has no record of the job.** A job absent from every lookup for
   at least `JOB_LOST_AFTER_SECONDS` (default 600) since the first miss,
   and past slurmly's submit grace window, is judged from its record by
   rule 3. With no record it is `lost` (FAILED). An SSH error or a failed
   lookup is never a miss. slurmly's batched `get_jobs` cannot say which an
   empty answer was (`client.py`, `_batch_lookup_chunk` skips a non-zero
   exit, empty output and unparseable output alike), so the gateway checks
   every job it reports absent with one `sacct` of its own, where the exit
   status and the output are visible. Only a `sacct` that exited 0 with a
   JSON `jobs` list and no `errors`, and does not list the job, counts as
   a miss. A row it does find is the job's answer. A `sacct` that fails
   changes nothing, the miss clock included, and is logged as a warning, so
   a tick where every job is absent never loses one, and a single tracked
   job that is truly gone is still lost.

A cause carries a phase, a message for the owner, and an excerpt. The
excerpt is the WBM log tail for the WBM causes, and the stderr tail for the
others. The verdict is stored the first time the gateway sees the terminal
state, together with the raw SLURM state, its exit code and SLURM's own
start and end times. So sacct's 14-day lookback (slurmly's `purdue_anvil`
preset) is never needed again.

### Submit failures stay drafts

These are unchanged from ADR 0025. `anvil_unreachable` (503) and
`sbatch_rejected` (502) put the draft back to DRAFT with the reason.

What is new is the case where sbatch may have run but the answer was lost
(an SSH error or an unparseable reply after the claim). The gateway then
runs `scancel --name=<sim_id> --user=<ssh user>`. A `sim_id` names one
attempt and no other job, so this removes a job the user was never told
about. If `scancel` cannot run either, the `sim_id` is kept on the draft,
and the sweep retries it until it succeeds.

### Cancel takes two steps

A cancel records `cancel_requested_at` and who asked, then runs `scancel`.
The status stays what it was until SLURM reports `CANCELLED`; the UI shows
*Cancelling* in between. If the job ends some other way first, that verdict
stands: the cancel came too late, and the job's real end is what is
recorded.

A job with no `slurm_job_id` yet is still inside its submit. It becomes
CANCELLED at once, and the submit route cancels what SLURM answers (ADR
0025). Every status write is conditional on the status it expects.

### Files live 30 days, or until the owner deletes them

- A job leaves two directories on scratch: slurmly's job directory
  `<ANVIL_REMOTE_BASE_DIR>/jobs/slurmly-<hex>/` (script, logs,
  `metadata.json`, `outcome.json`), and the toolkit's
  `<ANVIL_OUTPUT_BASE>/<sim_id>/`. **Nothing else belongs to a job.** The
  snapshot, model-input and image caches are shared, and a job never
  removes them.
- **The gateway never deletes a finished job's files on its own.** Anvil's
  30-day purge is the limit, and the UI says so on every finished job.
  Publishing is how a result is kept (ADR 0023).
- **Delete** is allowed on a draft and on a terminal job. It removes the
  slurmly directory with slurmly's `cleanup_remote_job_dir`, which only
  removes paths under `<base>/jobs/`. It removes the work directory only if
  that path is exactly `<ANVIL_OUTPUT_BASE>/<sim_id>`, the `sim_id`
  matches the id pattern, and the path is not a symlink. Only then is the
  document removed. If a removal fails, the document stays and the owner
  is told.
- A failed submit's slurmly directory is removed at once. It is found by
  its `metadata.json` naming the attempt's `sim_id`.
- **Purge detection.** Once a day the sweep checks, in one SSH command,
  which terminal jobs' work directories still exist. A missing one sets
  `files: purged`, and the UI stops offering the path.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Trust SLURM's state alone | It calls a WBM that stopped without finishing `COMPLETED`, and it cannot tell a refused run from a WBM error |
| The script names the cause, and the gateway copies it | The rule would live in bash, where it cannot be unit-tested against recorded SLURM states. SLURM's kills never reach the script anyway |
| Write `outcome.json` from bash | Escaping log lines into JSON by hand is where it breaks |
| Declare `lost` on the first `SlurmJobNotFound` | A failed batched lookup looks exactly like "absent", and would fail every running job at once |
| The gateway deletes finished files after N days | Anvil already purges at 30 days. A second, shorter clock would only lose results sooner |
| Reconcile a lost submit by adopting the job | The user was told the submit failed. Adopting it means recovering slurmly's paths from the cluster, for a case that should almost never happen |

## Consequences

- A new job-model field set: `slurm_state`, `slurm_exit_code`,
  `slurm_start`, `slurm_end`, `failure {cause, phase, message, excerpt}`,
  `outcome`, `cancel_requested_at`, `cancel_requested_by`, `missing_since`,
  `files`, `files_checked_at`, and `orphan_sim_ids` on a draft. The
  frontend types change in the same commit (rule 4).
- The job body grows a trap and a Python snippet, so its golden test
  grows, and a stub-driven test runs it locally.
- ADR 0023's unknown purge age is now known: 30 days since the last access
  or modification.
