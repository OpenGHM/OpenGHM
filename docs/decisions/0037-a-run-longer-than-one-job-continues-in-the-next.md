# ADR 0037 — A run longer than one job continues in the next job, from WBM's last saved state

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-18 |
| **Affects** | [`../architecture/gateway.md`](../architecture/gateway.md) (submitting, how a job ends), the `openghm` toolkit's `sim run` |

## Context

One SLURM job on Anvil may run for at most 96 hours (the `shared` partition's
QOS limit; `MAX_WALLTIME_SECONDS` in `web-gateway/backend/app/models/job.py`). The
published Global snapshot's reference run took 111 h 30 min
(`recommendedCompute.walltime`), so the gateway used to refuse to submit it
(`walltime_over_limit`). Longer periods and larger domains will need more.

WBM can carry on from where it stopped. Measured on Anvil from 2026-10-14 to
2026-10-17, with the v2 tutorial and a shortened Wyoming:

- WBM writes its run state to `WBM_run_state/` at each 31 December, including
  the year ends inside the spinup, and at the end of the run. Running the same
  `openghm sim run --id` again on the same work directory reads `<ID>.dat` and
  resumes from the day after (`Previous run state files are read!`).
- A job that SLURM killed at its time limit, rerun, finished the run. The v2
  tutorial was bit-identical to an uninterrupted run. Wyoming, cut during its
  spinup, resumed from the spinup state and finished; its totals (runoff,
  discharge, groundwater) differed from the uninterrupted run at the level of
  floating-point noise (runoff by less than 1e-6 mm/day), soil moisture not at
  all. Tracking fractions differed by up to 1.0, but only in cells whose total
  is about zero; as volumes (fraction times total) they differed by at most
  0.1% of the 99th-percentile total.
- The difference comes from WBM itself. It stores a crop cell's soil moisture
  as `-x-1` (the crop mask folded into the sign) and decodes it as `-y-1`,
  which changes about 1% of values by up to about 3e-14 mm. Every tracking
  state variable is written and read back. v2 has no crops, hence identical.
- What is lost at a cut is the work since the last 31 December: on average
  half a simulated year, at most one (about 5.4 h for Global). The last year
  end of the spinup writes only `<ID>.spinup.*`, which a resume does not read,
  so a cut just after it repeats that year.
- WBM has no signal handler and no way to save on request. A state write
  overwrites the files in place, one after another (Global: 9.1 GB, a few
  seconds). A cut during those seconds would leave a mixed state; not seen,
  read from the code.
- When a run's `Run_End` falls inside the spinup's dates, WBM resuming from a
  spinup-phase state takes its last day for the run's end, prints
  `Destination dataset is up to date! Nothing to do...` and exits 0 (Wyoming,
  SLURM 21375982). The gateway already fails a run whose log holds
  `Nothing to do` (`wbm_silent_failure`).

## Decision

**A job that SLURM stops at its time limit, after WBM saved a newer state than
the job started with, is continued: the gateway submits the same job script
again, on the same work directory, and WBM resumes from that state.** The
snapshot draft stays one simulation, run by one or more SLURM jobs.

- **No prediction.** Each job asks for the time it would have asked for, capped
  at 96 h, and runs until it ends or SLURM stops it. Nothing estimates how long
  a year takes, and no job stops itself early. The work after the last save is
  done again by the next job; that is the whole cost.
- **Continue only on progress.** A job continues when SLURM ended it with
  `TIMEOUT`, no one asked to cancel, and the work directory holds a complete
  resumable state written after that job started. Otherwise the job ends as
  today (`timeout`). A simulation may take at most two weeks (decided
  2026-10-19, `MAX_RUN_SECONDS`), enforced as at most 4 jobs
  (`ceil(2 weeks / 96 h)`, `MAX_JOBS_PER_SIMULATION`); that stops a run that can
  never finish. The 384 h that 4 jobs may take, beyond the two weeks, is slack
  for the work each cut redoes, up to one simulated year.
- **The same script, the same toolkit.** The continuation runs the job script
  the first job ran, so it runs the same pinned toolkit
  ([ADR 0025](0025-a-gateway-job-runs-the-pinned-toolkit.md)) with the same
  options. The script is stored with the job when it is first submitted.
- **The toolkit prepares a rerun.** Before WBM starts on a work directory that
  already holds output, `sim run` refuses a state whose files were not all
  written by the same save, and deletes the output files written after the
  state it will resume from (output a cut job may have left half-written). After
  WBM exits 0, it checks that WBM reached the run's last day, whatever WBM
  printed. It reports the state of a work directory for the gateway to read
  (`openghm sim state`).
- **Submitting longer runs.** A draft whose recommended walltime is over 96 h is
  no longer refused for that. One whose estimated run time, the recommended
  walltime (with the post-processing time when the run post-processes) plus 50%,
  not capped at 96 h, is over two weeks is refused at submit (`run_over_limit`).
  Users no longer set a walltime: every job asks for the recommendation with
  that headroom, at most 96 h, and the wizard shows the estimate and the
  limit as a time, never as a number of jobs.

## Consequences

- The Global snapshot can be run through the gateway; it takes two jobs.
- A continued run is not byte-for-byte the run done in one job when the model
  has crop land (the encoding above). The differences are floating-point
  noise in the totals and noise in fractions of near-zero totals. A run's record
  says how many jobs ran it. Output is carried, not reproduced
  ([ADR 0009](0009-output-is-carried-not-reproducible.md)), so this changes no
  published artifact.
- A simulation can now span weeks of queueing. Each job touches its work
  directory, so scratch's 30-day purge does not reach it while it runs.
- A requeue after a node failure would now be harmless (it resumes too), but the
  job script still turns requeue off; changing that is separate.
- The `Run_End`-inside-spinup defect stays WBM's. The gateway fails it rather
  than reporting success, and the toolkit's last-day check fails it too.

## Alternatives not taken

- **Plan segments up front** (`Run_End` set to a year end that surely fits in
  one job, then extend). It needs a time per simulated year before the first
  run, which a new domain or period does not have, and measured rates varied
  twofold between two runs of the same Wyoming setup (20 and 11 minutes per
  spinup year, depending on what the spool cache held).
- **Stop early at a year end** (watch the log, stop WBM after a save when the
  next year would not fit). It needs the same estimate, and stopping early
  wastes the same amount of time on average as being stopped: the unused rest
  of the job instead of the redone part of a year.
- **A signal before the time limit** (`--signal=B:USR1@N`). It arrives (about
  75 s early for `@60`), but WBM cannot save on request, so it only moves the
  moment of the kill. It would need a slurmly change for nothing gained.
- **Change WBM to save on a signal or daily.** It would change the model code
  pinned by tree hash ([ADR 0032](0032-wbm-code-is-published-and-pinned-by-tree-hash.md)).
  A mid-year state also misses the month and year totals WBM holds in memory,
  and `-dState` (daily state) would write 9.1 GB a day for Global.
