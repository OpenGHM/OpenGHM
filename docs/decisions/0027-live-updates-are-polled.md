# ADR 0027 — A job's live state is polled and shared, and its logs are read by byte offset

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-01 |
| **Affects** | [`../architecture/gateway.md` §5](../architecture/gateway.md#5-the-two-paths-that-leave-the-cluster), [ADR 0026](0026-how-a-job-verdict-is-reached.md) |

## Context

A job page has to follow a queued or running job: its SLURM state, why it
is still waiting, how far WBM has got, and the log WBM is writing. Four facts
shape how.

- **The source is polled.** SLURM's state reaches the gateway only when the
  gateway asks, over one SSH connection (`squeue`, then `sacct`, through
  slurmly). Nothing on Anvil can call the gateway back.
- **Every browser call already goes through Next.** The browser never calls
  FastAPI; server actions add the session's bearer token
  (`web-gateway/frontend/lib/api-client.ts`).
- **Pods are stateless** (rule 6). There is one backend replica today.
- **Each viewer used to cost its own SSH round trip.** Every status GET of a
  non-terminal job ran its own `get_jobs`, and the logs route tailed the last
  500 lines of both streams each time it was called.

What WBM writes was checked in real v2 run logs on Anvil
(`<work_dir>/wbm_output/<sim_id>/wbm_test.log`, jobs 20974970 and
20974971). Every simulated day prints one line that starts with the phase and
the date it reached:

```
Spinup 1/1 (2000-01-01) Balance=(0.00,0.00,0.00,   0.01,    0.01,   0.01,  0.00, 0.00,0.00) Spool+=3
File wbm_2001.nc (2001-12-22) Balance=(0.00,0.00,0.00,   8.20,  109.09,   0.81,  0.00, 0.00,0.00) Spool+=2
```

The log is written as the run goes, not at its end. Sampled every 20 s
during job 20977899, it grew by about 2.4 KB per sample, and its last line
advanced about 24 simulated days: from `Spinup 1/1 (2000-01-19)` 31 s after
the job started to `Spinup 1/1 (2000-06-13)` at 2 min 34 s. It holds no
carriage returns. slurmly's `stdout.log` and `stderr.log` are small (437 and
561 bytes, and they did not grow while WBM ran); the finished WBM log is
about 115 KB and 1,180 lines.

## Decision

### Polled, not pushed

The browser polls through server actions, every 5 s while a job is queued,
running or cancelling. It makes no request while the tab is hidden, polls
at once when the tab is shown again, and stops at a terminal status. After a
failed poll it backs off exponentially (5, 10, 20, 40, then 60 s at most);
a 401 stops it (mission 1).

### One SLURM lookup per job per window, however many watch

`web-gateway/backend/app/services/job_live.py` keeps an in-process cache of the last
SLURM answer for each job, with a short TTL (`JOB_LIVE_TTL_SECONDS`, 5).

- A caller that finds a fresh entry uses it. A caller that finds a lookup
  already in flight awaits that one. Only a caller that finds neither asks
  SLURM.
- The sweep and the status route share it. The sweep's one batched
  `get_jobs` fills the entries of every job it asked about.
- Settling a job from that answer is single-flight per job too, so a verdict
  is reached once, not once per viewer.
- A failed lookup is not cached; the next caller asks again.
- The cache is a cache, not state: a restart loses it, and costs one lookup.
  A second replica would keep its own and ask SLURM for itself.

The sweep runs every `JOB_BACKGROUND_SYNC_ACTIVE_INTERVAL` seconds (10)
while any job is active, and every `JOB_BACKGROUND_SYNC_INTERVAL` (60) when
none is.

### What the status answer adds

`live` carries what SLURM said at `checked_at`, and is not stored in Mongo:

- `queue_reason`, as SLURM names it (`Priority`, `Resources`, …);
- `time_limit_seconds`, what SLURM enforces;
- `estimated_start`, only when SLURM gives one;
- `progress`, read from the WBM log for a running job: the phase (`spinup`
  with its loop and loop count, or `run`), the simulated date, and the last
  progress line itself. A fraction is given only for the run phase, from
  the job's run start and end. A spin-up has no fraction, because its
  period is not known to the gateway.

The client computes elapsed time from `slurm_start`, so it ticks every
second without a poll. The progress read is a separate shared entry with
the same TTL, made only by the status route (a viewer), never by the sweep.

### Logs are read by byte offset

`GET /jobs/{id}/logs?stream=stdout|stderr|wbm&offset=N&limit=B` returns
`{data, offset, next_offset, size, eof, exists}`.

- The read is one SSH command: the file's size, then `tail -c +N | head -c
  B`, base64-encoded so that no byte is lost to decoding.
- Without `offset`, the read starts `limit` bytes before the end, at the
  next line start. A page that opens on a long log shows its end first.
- While the job runs, a chunk never ends inside a UTF-8 sequence: the
  incomplete bytes are left for the next read.
- The client keeps a trailing partial line until the next chunk completes
  it, so a line is never shown split.
- The `wbm` stream is `<work_dir>/wbm_output/<sim_id>/<ID>.log`: the path in
  `outcome.json` once the job has ended, or else the log of the init whose
  `Output_dir` is this `sim_id`. Once found it is stored on the job.
- `GET /jobs/{id}/logs/{stream}/download` streams the whole file, in chunks
  read the same way, and refuses one above `JOB_LOG_DOWNLOAD_MAX_BYTES`
  (50 MiB) with a 413 that says where the file is on Anvil. A Next route
  handler proxies it, because a server action cannot stream a file.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Server-sent events or websockets | The source is still a poll over SSH, so a push would only move the poll into the backend. It would need a connection that survives Next's server actions, and fan-out state that a stateless pod does not keep |
| Redis for the cache | One replica. A cache that is lost costs one lookup; Redis would add a dependency to save that |
| Progress from elapsed walltime | Walltime is an upper bound, not the work done. It is shown as walltime used, never as progress |
| Tail by lines (`tail -n`) | A line count gives no position to resume from, so every poll re-sends the whole tail and the client cannot tell new lines from old |
| slurmly's `download_artifact` for offset reads | It reads a file from the start with a size cap, and has no offset |

## Consequences

- `JobStatusResponse` gains `live`; the frontend types change in the same
  commit (rule 4).
- The logs route's shape changes: `{stdout, stderr, truncated}` becomes one
  stream per call.
- Log reads are per viewer. Two viewers at the same offset share a read
  (the cache key is job, stream, offset and limit); viewers at different
  offsets each cost a command.
- A WBM build that prints another progress line format shows no progress,
  only walltime used.
