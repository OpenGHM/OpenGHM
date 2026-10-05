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
Which run produced the published files differs by snapshot: v2's were
replaced by a run of the published image (job 20909227) and a rerun matched
them ([snapshot-layout.md](../reference/snapshot-layout.md),
[metadata-format.md](../reference/metadata-format.md)); Global's and Wyoming's
come from the lab's own runs and have not been reproduced. The results page
says which.

### Continue

The run starts on the day after the published end, from the published
end-of-run state through `State_ID`, and writes only the added years. The
result is shown as the published years plus the added ones. The latest end
allowed is the earliest end among the model input's datasets, not the
snapshot's own end.

### Compute

Today's path, with the spool of section 4.

## 4. A spool belongs to the model input

A spool is the model input's datasets warped onto a network grid, and the
networks are files of the model input too (Global's
`/wbm/data/network/05min_flwdir.tif` and Wyoming's
`Wyoming_05min_flwdir.asc` are both in model input `ff0ba2e5`). So a spool is
decided by the model input, the network the init names, and the warp options
the init gives each dataset; the snapshot only chooses among them. The run's
period is not part of it: a day is a file, and runs of different periods add
files to the same directory.

- **Keyed by what WBM's path does not say.** One directory per dataset as one
  run warps it: `<model input id>/<network>/<variant>/<dataset ID>/`, where the
  variant is a hash of the dataset's definition and the `-r`, `-p` and `-pp`
  options. Those are exactly the fields of a line of the `build_spool_batch.pl`
  WBM writes for every run (`make_build_spool` in `RIMS::WBM`). A run that swaps
  one dataset shares every other directory.
- **Three places, cheapest first.** The scratch cache
  (`<cache>/spools/...`), then S3 (`spools/<model input id>/...`, the same tree), then building
  it. Downloading is the faster way to fill it: a cold fetch on Anvil moved
  17.5 GB in 26 s (`ops/docs/reference/anvil-environment.md`, private), so a
  Global day of spool, about 130 MB, comes down in well under a second against
  about 13 s to build it.
- **Built into a temporary directory, then moved in.** A run lists what it
  needs with `wbm.pl -noRun` (which writes `build_spool_batch.pl`), builds the
  missing days with `build_spool.pl -f N` into a directory of its own, and
  renames each finished file into the cache. Two runs that build the same day
  at once both produce it and one rename wins; neither reads a half-written
  file, and neither waits on a lock.
- **Read-only during the run.** Each dataset directory is bound read-only at
  `/wbm/spool/<network>/<dataset ID>/`; only WBM's own `Cell_Table.dat` is
  written, in a per-run directory. A day the preparation missed makes WBM fail,
  instead of being written under another run.
- **A cache with a cap.** Scratch purges files untouched for 30 days. The
  binding limit is the file count, not the size: x-openghm has 100 TB and
  1 million files on scratch, and a 10-year spool is about 24,000 files (Global
  480 GB, Wyoming 10 GB, as published). So the cache evicts the least recently
  used dataset directories past a file cap. An evicted day costs a download or
  a rebuild, nothing else.
- **What S3 holds.** `spools/<model input id>/` is filled from the spools the published
  snapshots already carry, copied within S3. A file there never changes once
  written, since its key fixes its content. Whether a run uploads the days it
  built waits on who holds the write credentials (open item 10); until then
  they stay in the scratch cache only. A snapshot's own `spool/` then repeats
  `spools/<model input id>/` and is retired.

What it saves, measured: about 13 s of a 53 s Global day whose spool is not yet
built (roughly 12% of a fresh 10-year run, estimated), and 0.6 s of a 1.6 s v2
day.
