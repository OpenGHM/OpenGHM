# Simulation reuse — architecture

How a simulation avoids computing what is already published or already
computed: the snapshot's own output, its saved run state, and the spool of
warped inputs.

**Status: target**, except where a section says it is built. A draft the
snapshot answers is no longer queued (section 3, built 2026-10-05); every other
submitted draft runs WBM from an empty run state into an empty spool, start to
finish (section 1). The reasoning is
[ADR 0029](../decisions/0029-a-run-computes-only-what-is-not-published.md)
(accepted 2026-10-05); the gateway as it runs is [gateway.md](gateway.md).

---

## 1. Where it stands

A gateway job runs `openghm snapshot fetch` and then `openghm sim run
--spool cache` ([ADR 0025](../decisions/0025-a-gateway-job-runs-the-pinned-toolkit.md)).
`fetch` leaves out the snapshot's `wbm_output/`, `WBM_run_state/` and `spool/`
(`packages/openghm/src/openghm/fetch.py`, `EXCLUDED_DIRS`), and `sim run` gives
every run an empty `WBM_run_state/`. So WBM computes every day of the spinup
and the run; it warps only the inputs the shared spool cache does not already
hold (§4).

What a draft can change today is narrow. The wizard bounds the run period to
the snapshot's `simulation.temporalCoverage`, the output variables are chosen
from the snapshot's list, and a submit naming a model input, a spatial domain or
custom parameters is refused (`unsupported_fields`, open item 9). So **every run
the gateway can submit today asks for output the snapshot already carries**, with
one exception: a draft can ask for WBM's climatology, which no published snapshot
holds (the output choice, [gateway.md](gateway.md)). Apart from that, a draft
asks for a period inside the published one and variables among the published
ones. Such a draft is now answered from that output instead of run (section 3),
unless the person asks for a rerun. A draft that asks for climatology is not
answered by a snapshot whose own init did not (`climatology_not_published`), so it
runs.

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
| **Published** | same model input, domain and parameters as the snapshot; period inside the published one; variables among the published ones; no climatology unless the snapshot's init asked for it | nothing; the draft is answered by the snapshot's `wbm_output/` |
| **Continue** | as Published, but the period ends after the published end | WBM from the snapshot's end-of-run state, for the added years only |
| **Compute** | anything else: another model input, domain or parameters (once open item 9 allows them) | WBM from an empty state, spinup included, as today |

### Published

Built: [gateway.md](gateway.md), "A draft the snapshot already answers is not
queued". Which run produced the published files differs by snapshot: v2's
were replaced by a run of the published image (job 20909227) and a rerun
matched them ([snapshot-layout.md](../reference/snapshot-layout.md),
[metadata-format.md](../reference/metadata-format.md)); Global's and Wyoming's
come from the lab's own runs and have not been reproduced. The results card
does not say which yet.

### Continue

The run starts on the day after the published end, from the published
end-of-run state, and writes only the added years. The result is shown as the
published years plus the added ones.

**No published snapshot can be continued today** (open item 23). The latest
end is the last year for which every dataset the init reads has its files, and
the published model inputs carry only the years their snapshots ran for some
datasets, whatever their definitions declare: model input `ff0ba2e5` (Global,
Wyoming) has glacier files for 1980 and 2000 to 2009 while its definition says
1980 to 2012, and a Wyoming run for 2010 stopped at
`glacier_RDI40_6min_2010_m.nc` (job 21087911); model input `52585562` (the v2
tutorial) has precipitation and temperature for 2000 and 2001 only. So the end
is read from the files, not from the definitions, and today it is each
snapshot's own end.

What is known about resuming, measured on Wyoming on 2026-10-05:

- WBM resumes from a copied state: with the published end-of-spinup state
  named as `State_ID`, it logged "Previous run state files are read! Resume
  date is 2000-01-01." and ran no spinup (job 21086458). With the published
  end-of-run state as the run's own (no `State_ID`) and a `Run_Start` the day
  after the published end, it resumed on that day (job 21087911, until the
  missing glacier file).
- Resumed from the published end-of-spinup state, 2000 matched the published
  2000 within floating-point noise: over the year runoff differed by at most
  3.7e-4 mm/day and soil moisture by at most 0.0025 mm, on the days sampled at
  most 152 of 67,480 cells differed, and soil moisture was identical by 31
  December. Fractions of tracked components differed by up to 1 in a few
  cells, where the totals they divide are near zero.
- A short run extended is close to the run done in one go, not identical
  (jobs 21089734 to 21089736, each day from an empty spool): Wyoming from the
  published end-of-spinup state through 2000, then a new run from its
  end-of-run state for January and February 2001, against one run from
  2000-01-01 to 2001-02-28. The two 2000s were bit-identical, so a run repeats
  itself; the extended two months differed from the first day by at most
  5.5e-4 mm/day in runoff, 2.6e-3 in discharge (of up to 2.4e4) and 7.7e-3 mm
  in soil moisture, in 14 to 327 of 67,480 cells, and the soil-moisture
  difference was down to one cell by the end of February. A tracked
  component's soil-moisture fraction differed by up to 0.23. So WBM's saved
  state does not carry everything it holds in memory, at a level close to
  floating-point noise; a continued run is a continuation, not a bit-exact
  replay.
- An earlier self-check that resumed from a one-month spinup overlapping the
  run's own months (job 21089081) differed more (runoff by up to 0.4 mm/day in
  about 1,300 cells). Not the spool: reading every day from a spool is
  bit-identical to building it (§4). Its spinup overlapped the run's months,
  which no published run does, and it was not pursued.

### Compute

Today's path, with the spool of section 4.

## 4. A spool belongs to the model input

A spool is the model input's datasets warped onto a network grid, and the
networks are files of the model input too (Global's
`/wbm/data/network/05min_flwdir.tif` and Wyoming's
`Wyoming_05min_flwdir.asc` are both in model input `ff0ba2e5`). So a spool is
decided by the model input, the network and the settings the run warps with;
the snapshot only chooses among them, and it no longer carries one (the snapshot
diagram in [artifact-versioning.md](artifact-versioning.md) §1). The run's
period is not part of it: a day is a file, and runs of different periods add
files to the same directory.

**Built** (`openghm sim --spool cache`, the toolkit's default since `24b261f`,
and what a gateway job passes):

- **One directory per variant.** `<spool cache>/<model input id>/<network>/<variant>/`,
  laid out inside as WBM lays out its own spool. The variant hashes the image
  the snapshot pins, its model code, the network file and the run's init
  without what only names or times the run (its ID, dates, spinup, output
  variables and directories). That is coarser than one variant per dataset: a
  draft that changes a dataset or a model parameter gets a directory of its
  own. It is exact for what a draft changes today, its period and variables.
  A finer key needs the list of datasets a run reads, and WBM's own list
  (`build_spool_batch.pl`) leaves some out (`luAgr`, `CropAreaFrac`, the
  irrigation efficiency, among others), so the toolkit does not plan a
  spool ahead.
- **Linked in, read-only.** Before WBM starts, every day the cache holds for
  the run's years is a symlink in the run's own spool to the variant
  directory, which is bound read-only. WBM reads a day that exists and builds
  one that does not, so a day the cache lacks is built in the run's own
  directory, as before. Files WBM keeps at network level (`Cell_Table.dat`,
  the reservoir tifs, `glAreaFrac`) depend on the run's dates or are cheap and
  are never cached.
- **Harvested after exit 0.** The days a run built move into the variant
  directory by hard link, `.hdr` before `.dat`, never over a file already
  there: two runs that built a day built the same bytes, and neither waits on
  a lock. A run that fails hands nothing over, since its last day may be half
  written.
- **S3 first.** Before linking, the days S3's `spools/<model input id>/…`
  (the same tree) has and the cache lacks are downloaded, which is faster
  than building them: a cold fetch on Anvil moved 17.5 GB in 26 s
  (`ops/docs/reference/anvil-environment.md`, private), so a Global day of
  spool, about 130 MB, comes down in well under a second against about 13 s
  to build it. A run never uploads: who would hold the write credentials is
  open item 10.

- **What S3 holds.** `spools/<model input id>/` holds the three published
  snapshots' spools under their variants, copied within S3 after a byte-for-byte
  check against what each variant builds ([s3-layout.md](../reference/s3-layout.md)).
  A Wyoming run from an empty scratch cache downloaded the 6,236 days its
  years needed (6.5 GB) and built none (job 21093028). The cache takes whole
  years from S3, the spinup's first to the year after the run's last, so a
  two-month run fetches two years.
- **The snapshots' own `spool/` is gone.** Deleted from S3 on 2026-10-06, after
  `spools/<model input id>/` repeated it. The toolkit has no `--spool snapshot`
  mode and `snapshot fetch` has no `--spool` option; it never downloads a
  `spool/`, so an old tree that lists one still fetches.

- **A cache with a cap** (`57d8bac`). The binding limit is scratch's file
  count, not its size: x-openghm has 100 TB and 1 million files, shared with
  the model-input cache, simulation output and slurmly's job directories, and
  the quota is not to be raised (the user, 2026-10-06). A 10-year spool is
  about 48,700 files with headers. Before a run fills its spool it reads the
  scratch row of `myquota`; at 80% of the file limit or more it deletes whole
  units, a variant's year or its `clim` unit (climatology, static, bias and
  `_MinMax` files), until the projection is at 50% or less. Oldest last use
  goes first, and among one day's units those S3 holds go before those only
  the cache holds. A run leases its years before the fill and releases them
  in the harvest; a lease ends at the run's walltime, and a leased unit is
  never deleted. A link whose target is gone after linking is dropped, so WBM
  builds that day. Each variant keeps a per-unit index (`<variant>/.units/<unit>.json`) of files,
  bytes, last use and whether S3 holds it. Without `myquota`, nothing is
  deleted. `openghm spool prune --dry-run` shows what would go; on Anvil it
  read 59,700 of 1,000,000 files (6.0%) on 2026-10-06. Scratch's own 30-day
  purge still applies on top. `openghm spool status --json` reports the quota
  (files and bytes) and the cache per variant, and `spool prune --all` deletes
  every unit no lease holds; the admin page reads and clears the cache through
  them (`GET /api/v1/admin/anvil/scratch`, `POST /api/v1/admin/anvil/spool-cache/clear`,
  admin only, [gateway.md §7](gateway.md#7-audit-log)).

What it changes and saves, measured:

- **Nothing in the output.** Wyoming (v1) from 2000-01-01 to 2001-02-28 run
  twice, once building every day and once reading every day from the first
  run's spool: all 165 variables of both years bit-identical (jobs 21089734,
  21089736). The v2 tutorial through `sim --spool cache`, two runs at once from
  an empty cache, then a third with the cache full, against a `--spool fresh`
  run: every output file bit-identical (job 21090004).
- **The second run builds nothing.** In job 21090004 the first of the two
  concurrent runs harvested 1,827 days, the second found all 1,827 already
  there, and the third linked 1,827 and built none.
- **Time:** the Wyoming run reading its spool took 1,090 s against 2,978 s
  building it, 63% less; v2 9 min against 13.5 min. A Global day spends about
  13 s of 53 s building its spool (roughly 12% of a fresh 10-year run,
  estimated).
