# Simulation reuse — architecture

How a simulation avoids computing what is already published or already
computed: the snapshot's own output, its saved run state, and the spool of
warped inputs.

**Status: target.** Nothing below runs yet. Today every submitted draft runs
WBM from an empty run state into an empty spool, start to finish (section 1).
Where a piece already exists, the text says so. The reasoning is
[ADR 0029](../decisions/0029-a-run-computes-only-what-is-not-published.md)
(proposed); the gateway as it runs is [gateway.md](gateway.md).

---

## 1. Where it stands

A gateway job runs `openghm snapshot fetch` and then `openghm sim run
--spool fresh` ([ADR 0025](../decisions/0025-a-gateway-job-runs-the-pinned-toolkit.md)).
`fetch` leaves out the snapshot's `wbm_output/` and `WBM_run_state/`
(`packages/openghm/src/openghm/fetch.py`, `EXCLUDED_DIRS`), and `sim run` gives
every run an empty `WBM_run_state/` and, with `--spool fresh`, an empty spool.
So WBM computes every day of the spinup and the run, and warps every input it
reads.

What a draft can change today is narrow. The wizard bounds the run period to
the snapshot's `simulation.temporalCoverage`, the output variables are chosen
from the snapshot's list, and a submit naming a model input, a spatial domain or
custom parameters is refused (`unsupported_fields`, open item 9). So **every run
the gateway can submit today asks for output the snapshot already carries**: a
period inside the published one, and variables among the published ones.

The cost of that, measured on Anvil (toolkit README, "WBM threads" and the
spool measurement after it): a published Global run is 20 simulated years
(two 5-year spinup loops, then 10 years) at about 53 s a day on 26 cores,
4 d 15 h in all; the v2 tutorial is 1097 days at 1.0 to 1.6 s a day.

## 2. What WBM already does

These are WBM's own behaviours, read in v1's `wbm.pl` and its `RIMS::WBM`
module as the Global snapshot ships them (the v2 tutorial's resume was also
run, below), and described in the
[WBM wiki's 2023 tutorial](https://github.com/wsag/WBM/wiki), whose folder
layout (`model/`, `spool/`, `wbm_init/`, `WBM_run_state/`, `wbm_output/`) is
the snapshot layout.

- **Run state.** WBM saves its state at the end of the spinup
  (`WBM_run_state/<ID>.spinup.*`), at each year end and at the end of the run
  (`<ID>.*`). When `<ID>.dat` exists it resumes from it: with the state of a
  finished run it does nothing ("Destination dataset is up to date! Nothing to
  do...", 5 s for the v2 tutorial, no output written); with a later `Run_End` it
  computes only the added days (tutorial step 5c). A `Spinup` block with
  `State_ID => '<other ID>'` starts a new run from another run's saved state, so
  it has no spinup of its own (step 5d). `-rm` deletes the state and the output
  and starts over.
- **Spool.** A day's input is read from
  `spool/<network file name>/<dataset ID>/<date>.dat` when that file exists, and
  otherwise warped from the source and written there (`read_dateLayer`). The
  path names the network and the dataset, and nothing else: a different
  resampling method, numeric patch value or dataset definition under the same
  ID would read a stale file without a word. A different network under the same
  file name stops WBM ("Network file has changed but old spool area is not
  removed"). Writes are not atomic.

## 3. Three kinds of run

The backend classifies a draft against its snapshot before anything is queued,
from fields it already holds.

| Kind | When | What runs |
|---|---|---|
| **Published** | same model input, domain and parameters as the snapshot; period inside the published one; variables among the published ones | nothing; the draft is answered by the snapshot's `wbm_output/` |
| **Continue** | as Published, but the period ends after the published end | WBM from the snapshot's end-of-run state, for the added years only |
| **Compute** | anything else: another model input, domain or parameters (once open item 9 allows them) | WBM from an empty state, spinup included, as today |

### Published

The Review step says the results exist and links them; submitting is replaced
by opening them. The published files are public on S3 under
`snapshots/<id>/wbm_output/<run ID>/`: one `daily/wbm_<year>.nc` per year with
every published variable, and `monthly/<variable>/` and `yearly/<variable>/`.
A narrower period or fewer variables is a selection of those files, not a run.
A deliberate rerun, to check that the snapshot reproduces its own output, stays
possible as an explicit choice that says it uses allocation.

### Continue

The run starts on the day after the published end, from the published
end-of-run state through `State_ID`, and writes only the added years. The
result is shown as the published years plus the added ones. The latest end
allowed is the earliest end among the model input's datasets, not the
snapshot's own end.

### Compute

Today's path, with the spool of section 4.

## 4. A shared spool

A spool depends on the inputs and the network, not on the run's period,
variables or parameters, so runs of the same inputs share one:

- **Keyed by what the path does not say.** The cache directory is
  `<cache>/spool/<key>/`, where the key covers the model input id (immutable,
  [ADR 0015](../decisions/0015-model-input-is-a-published-artifact.md)), the
  network file's hash, and the init's input section without its dates, output
  variables and output paths.
- **Built ahead, read-only during the run.** A preparation step builds the
  days the run needs (`build_spool.pl -f N`, which v1 writes for its own run as
  `build_spool_batch.pl` and v2 starts with `-bldSpool`), holding a lock on
  `/home` (an `flock` on GPFS scratch is node-local). The run then mounts the
  spool read-only, so a day the preparation missed fails loudly instead of being
  written half-way under another run.
- **Seeded from S3 where that is cheaper.** A snapshot's published spool can
  fill the cache with `fetch --spool auto` (490 GB for Global).
- **Disposable.** Scratch purges it after 30 days untouched; a purged day is
  rebuilt.

What it saves, measured: about 13 s of a 53 s Global day whose spool is not yet
built (roughly 12% of a fresh 10-year run, estimated), and 0.6 s of a 1.6 s v2
day.
