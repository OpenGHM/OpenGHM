# openghm

A Python **library + CLI** that wraps the three WBM **processing tools** behind one
entry point, calling them inside the lightweight WBM container
(`wbm-tools-lite`) via `singularity`/`apptainer` (or `docker` locally).

The core is UI-agnostic: it builds a `BuiltCommand` (the exact container invocation
plus any generated `.init`/Magic-Table files) and either runs it or shows it. The CLI
and the interactive wizard are thin frontends; `import openghm` exposes the same core
for notebooks, batch scripts, and a future GUI.

> Scope: the three synchronous processing commands — `network`, `spatial`,
> `temporal` — plus `sim`, WBM model runs either **locally** (`run`, foreground) or
> on **SLURM** (`submit` / `status` / `list` / `logs` / `cancel`), setup
> commands (`init`, `sif`), `snapshot` (`fetch` a published snapshot,
> `publish` a finished run as one, `validate` a folder), `code` (`hash` the WBM code a snapshot pins), and `model-input` (`fetch`, `validate`). Snapshots are **self-describing folders** (a root
> `metadata.json`), and `sim` runs the folder you point it at.

**Status:** `sim submit` has run a real WBM job to completion on Anvil (Python 3.9.5)
and `sim status` reads live `sacct` records. The test suite covers the
processing-tool goldens, the dry-run contract, `sim` build/run + management, image
assets, `snapshot fetch` and `model-input fetch` (against a local HTTP fixture), `init`, the library API
and the wizard. On Anvil, a published snapshot fetched with `snapshot fetch` and run with
`sim submit`, with and without a prebuilt spool, reproduced its published output bit-for-bit. **Full library/API reference:**
[`docs/library.md`](docs/library.md).

## Install

`pip install` deliberately downloads **no container image** — it installs only the
pure-Python package. `openghm init` then sets you up (downloads the image(s) after
asking, and configures SLURM if you need it):

```sh
pip install openghm          # once published to PyPI (or: pip install packages/openghm from a checkout)
openghm init                 # interactive: pick runtime, download image, configure
```

**Installing from a checkout needs pip 21.3 or newer.** The package reaches the
spec schemas through a relative symlink (`src/openghm/schemas` -> the repository's
top-level `schemas/`), and pip older than 21.3 copies the source tree to a temporary
directory before building, where the symlink dangles: the build stops with
`openghm: ... does not resolve to the spec schemas`. No build setting can fix that
from inside the copy. Anvil's `module load python/3.9.5` venv has pip 21.1, so there
(from the repository root):

```sh
module load python/3.9.5 && python -m venv venv
venv/bin/python -m pip install --upgrade pip              # 21.1 -> current, into the venv
env -u PYTHONPATH venv/bin/python -m pip install packages/openghm
```

The `env -u PYTHONPATH` is needed on Anvil: the module puts its own pip 21.1.2 on
`PYTHONPATH`, which shadows the venv's upgraded pip, so a plain `venv/bin/python -m
pip` still runs 21.1 and fails the same way. (`openghm` itself runs fine with the
module loaded.) The alternative that keeps the old pip is one flag, accepted only by
pip 21.1 to 21.x:

```sh
venv/bin/python -m pip install --use-feature=in-tree-build packages/openghm
```

A wheel or sdist built once (`python -m build`) carries the schemas as real files
and installs under any pip.

`init` announces each image's size (about 300–330 MB each) and asks before
downloading. Non-interactive setup for CI/provisioning:

```sh
openghm init --non-interactive --preset local   # or --preset anvil
openghm sif list                                 # what's published / already cached
openghm sif pull wbm-tools-lite                  # fetch an image on demand
openghm sif pull wbm-v2-lite:2.0.0               # one exact version
```

Images are named `<image>:<version>` (`openghm sif list` shows them; a bare
`<image>` or `<image>:latest` follows the manifest's `latest` alias). They come
from `containers/manifest.json` in the public bucket, are checked against its
sha256, and are cached at `<sif_dir>/<image>/<version>/<filename>`. The old names
`lite`, `1.0.0` and `2.0.0` still work as `wbm-tools-lite`, `wbm-v1-lite:1.0.0`
and `wbm-v2-lite:2.0.0`. `sif` in the config (the tools image, for `network`,
`spatial`, `temporal`) defaults to where `sif pull wbm-tools-lite` puts it.

Requires Python ≥ 3.9. All dependencies are pure-Python (`click`, `rich`,
`questionary`, and `tomli` on < 3.11), so installation needs no compiler — important
for HPC. Images are cached under `sif_dir` (default `~/.openghm/sif`) and model
inputs under `model_input_dir` (default `~/.openghm/model-inputs`); spool files shared
between runs under `spool_cache` (default `~/.openghm/spools`; keep it on the filesystem
of `output_base`, see [Simulations](#simulations-openghm-sim)); an existing
Anvil shared install keeps working without `init`.

## Use as a library

```python
import openghm

# Run spatial aggregation
res = openghm.spatial(
    mt="/work/test.MT.csv",
    data_code="Global_tracking_runoff_y",
    mask_code="US_states_6min",
    work="/scratch/work",
    mounts={"gt_output": "/.../gtout", "masks": "/.../masks"},
    output="/work/out.nc",
)
print(res.exit_code, res.display)

# Dry-run: build the command without executing it
res = openghm.preclip(
    net="/.../05min_flwdir.tif", output="/work/preclip.asc",
    work="/scratch/work", mounts={"network": "/.../network"},
    lon_min=-110, lon_max=-100, lat_min=40, lat_max=48,
    dry_run=True,
)
print(res.display)        # the singularity exec line

# Switch runtime
res = openghm.temporal(
    mt="/work/test.MT.csv", src_code="RUNOFF_M", dst_code="RUNOFF_Y",
    work="/scratch/work", mounts={"gt_output": "/.../gtout"},
    runtime="docker", dry_run=True,
)

# Run a WBM model simulation locally (foreground, no SLURM)
res = openghm.run(snapshot_dir="/path/to/wbm_storage_v2.0.0", simulation_id="smoke")
print(res.exit_code)
# …or submit it to SLURM instead
res = openghm.submit(snapshot_dir="/path/to/wbm_storage_v2.0.0", simulation_id="run-001")
```

The processing functions (`preclip`, `subset`, `spatial`, `temporal`) and the model
runners (`run` = local, `submit` = SLURM) all load `~/.openghm/config.toml`
automatically and return a `RunResult` (with `display`, `argv`, `exit_code`,
`stdout`). Pass `dry_run=True` to inspect without running; `capture=True` to capture
stdout/stderr. Raise `openghm.OpenghmError` on bad options.

For the complete API — every option field, all data types, mounts/path-translation
rules, config, runtime selection, error handling, and recipes — see
**[`docs/library.md`](docs/library.md)**.

## Use as a CLI

| Command | Wraps | Notes |
|---|---|---|
| `openghm network preclip` | `networkTools` (preclip) | CLI **generates the `.init`** from flags |
| `openghm network subset` | `networkTools` (subset) | rectangle or `--shapefile` polygon modes |
| `openghm spatial` | `spatial_aggregation.pl` | `--mt` required; `--key-file` auto-defaults under `/work` |
| `openghm temporal` | `temporal_aggregation.pl` | `--mt` required |
| `openghm init` | — | one-time setup: download image(s), configure runtime/SLURM |
| `openghm sif list` / `pull <image[:version]>` | — | list published images / download one into `sif_dir` |
| `openghm snapshot fetch <id>` | anonymous HTTPS | download `snapshots/<id>/`, the model input it links and the image it pins, verified; `--dest`, `--no-model-input`, `--no-image`, `--jobs` |
| `openghm snapshot publish <run dir> --metadata FILE` | `s3cmd`, anonymous HTTPS | publish a finished run's work directory as `snapshots/<id>/`; `--id`, `--dry-run`, `--s3cfg`, `--s3cmd`, `--base-url`, `--jobs`; see below |
| `openghm snapshot validate [PATH]` | — | check a folder's `metadata.json` and layout against the snapshot spec, and its WBM code against the tree hash `uses.modelCode.treeHash` pins (ADR 0032) |
| `openghm code hash [DIR]` | — | print the tree hash of the WBM code in `DIR` (`model/` and `utilities/`, `_Inline` left out; ADR 0032), the value `uses.modelCode.treeHash` pins |
| `openghm model-input fetch <id>` | anonymous HTTPS | download `model-inputs/<id>/` into `model_input_dir`, verified; `--dest`, `--jobs` |
| `openghm model-input validate [PATH]` | — | check a folder's `metadata.json` and layout against the model-input spec |
| `openghm sim run [PATH]` | `singularity`/`docker` WBM run | **local, foreground, no SLURM**; same snapshot mechanism as `submit` |
| `openghm sim submit [PATH]` | `sbatch` + `singularity` WBM run | snapshot folder (default cwd) w/ `metadata.json`; split-mount; `--spool cache\|fresh` (default `cache`); writes `simulation.json` |
| `openghm spool variant [PATH]` | `perl` in the pinned image | print a snapshot's spool variant and what it is made of, as JSON (`--init`, the `sim run` init overrides) |
| `openghm spool prune [--dry-run]` | `myquota` | delete the least recently used years of the spool cache when scratch is nearly full (`--high`, `--low`, `--json`); `--all` deletes every unit no running simulation holds, whatever the quota says |
| `openghm spool status [--json]` | `myquota` | print the scratch quota (files and bytes) and what the spool cache holds per variant, with the unexpired leases; deletes nothing |
| `openghm sim status <id\|jobid>` | `sacct` | State / ExitCode / Elapsed |
| `openghm sim list` | — | table of runs under `output_base` (reads `simulation.json` sidecars) |
| `openghm sim logs <id> [-f]` | slurm `.out`/`.err` | print or `--follow` (tail) the SLURM log |
| `openghm sim cancel <id>` | `scancel` | cancel the run's SLURM job (`-y` to skip confirm) |
| `openghm wizard` | — | interactive, prompt-driven; one-line hint per step |

### Mounts (mirrors `images/wbm-tools-lite/run/wbm-tools`)
- `--mount NAME=DIR` (repeatable) → binds `DIR` to `/data/NAME`
- `--work DIR` → binds `DIR` to `/work` (outputs + generated init/MT)

Host paths you pass (`--net`, `--output`, …) are translated to container paths
automatically; a path already container-absolute (`/data/...`, `/work/...`) is passed
through. For `spatial`/`temporal` the `--mt` Magic Table must already use container
paths (v1 does not rewrite it).

### Global flags
`--runtime singularity|apptainer|docker` · `--sif <path>` (or docker image) ·
`--dry-run` · `-v/--verbose` · `--json` · `--config <path>` · `--version`.
Config is read from `~/.openghm/config.toml` (written by `openghm init`, or
auto-created with defaults on first use).

### Examples

```sh
# Preclip a network to a rectangle (generates the init for you)
openghm network preclip \
  --mount network=$NET --net $NET/05min_flwdir.tif \
  --work $WORK --output /work/preclip.asc \
  --lon-min -110 --lon-max -100 --lat-min 40 --lat-max 48

# See the exact container command without running it
openghm spatial --mt /work/test.MT.csv --data RUNOFF_Y --mask US_states_6min \
  --mount gt_output=$GTOUT --mount masks=$MASKS --work $WORK \
  --output /work/out.nc --dry-run

# Monthly → yearly aggregation
openghm temporal --mt /work/test.MT.csv --no-datacube-check \
  --start 2000-01-01 --end 2002-12-31 \
  --mount gt_output=$GTOUT --work $WORK \
  --src RUNOFF_M --dst RUNOFF_Y
```

### Fetching a snapshot (`openghm snapshot fetch`)

```sh
openghm snapshot fetch <id>                    # -> ./<id>, plus the model input in model_input_dir and the pinned image in sif_dir
openghm snapshot fetch <id> --dest /scratch/me/snap --jobs 16 --no-image --no-model-input
```

Reads `snapshots/<id>/` from the public bucket with anonymous HTTPS (no
credentials). It downloads everything **except** `wbm_output/` (a snapshot carries
its output, it does not consume it; ADR 0009 — the fetched tree gets an empty
`wbm_output/`, which the layout requires), `WBM_run_state/` (a new run
starts its own), `data/` and `data_init/` (a snapshot holds no input data; it
links a model input, ADR 0015), and `spool/` (a spool belongs to the model input
and runs share it through the spool cache, see [Simulations](#simulations-openghm-sim);
an old tree whose listing still has a `spool/` is fetched without it).

- Every file with a `SHA256SUMS` line is checked against it. `SHA256SUMS` itself
  has no line, so it is checked by size and, when its ETag is a plain MD5 (not
  multipart), by MD5. A file in the bucket with no line, or a line with no object,
  is a failure.
- Modes come from each object's `x-amz-meta-s3cmd-attrs` header (ADR 0022); an
  object without one is a failure rather than a guessed mode (setuid/setgid/sticky
  bits are never applied).
- The model input is `uses.modelInput.id` from `metadata.json`, fetched into
  `<model_input_dir>/<id>/` and checked like the snapshot. A model input that several
  snapshots link (Wyoming and Global share one) is downloaded once: the second fetch
  finds every file valid and skips it. `--no-model-input` leaves it out.
- The image is `uses.container.https` from `metadata.json`, cached under `sif_dir`
  and checked against `uses.container.digest`.
- Once the tree is down, its WBM code (`model/` and `utilities/`) must hash to
  `uses.modelCode.treeHash` (ADR 0032; `openghm code hash` prints it). A code tree that does
  not is a failure listed as `WBM code`, naming both hashes, and the model input and the image
  are then not downloaded. A `metadata.json` that pins no code stops the fetch with exit 2.
  A `<file>.part` left by an interrupted run is removed before the check, so it cannot change the hash.
- It resumes: a file already at its path with the right size and hash is skipped
  (re-run it after an interruption; the last line is `downloaded N, skipped M,
  failed K`). Exit status is 1 if anything failed (a file, the image, the code), with the paths
  listed, and 2 when the fetch cannot go on (an unknown id, an unreadable `metadata.json`, no
  `uses.modelCode`).
- A transient error is tried again, three attempts with a growing pause: for a file,
  and for each page of the listing. Unreachable, a dropped connection and a 5xx are
  transient; a 403 or 404 is an answer and is not.

### Fetching a model input (`openghm model-input fetch`)

```sh
openghm model-input fetch <id>                 # -> <model_input_dir>/<id>, where `sim` looks
openghm model-input fetch <id> --dest /scratch/me/input --jobs 16
```

Reads `model-inputs/<id>/` (all of it, `metadata.json` and `SHA256SUMS` included)
with the same anonymous HTTPS, `SHA256SUMS` check, modes and resume as
`snapshot fetch`, and prints `model input: <dir>` and the `downloaded N, skipped M,
failed K` line. `snapshot fetch` does this for the model input a snapshot links; use
`model-input fetch` to get one alone.

### Publishing a run (`openghm snapshot publish`)

```sh
openghm snapshot publish <run dir> --metadata metadata.json --dry-run     # the plan; writes nothing, needs no credentials
openghm snapshot publish <run dir> --metadata metadata.json               # prints "snapshot id: <id>", then publishes
openghm snapshot publish <run dir> --metadata metadata.json --id <id>     # a retry under the same id
```

`<run dir>` is a simulation's work directory, the one `sim submit` / `sim run` leave
under `output_base`: its `simulation.json` names the base snapshot, and `wbm_init/`,
`wbm_output/<sim id>/` and `WBM_run_state/` hold the run. `--metadata` is the new
snapshot's `metadata.json`, which the caller composes; the command checks it and sets
its `id`. Run it in a SLURM job on Anvil (a large output takes hours); it uses
`s3cmd` with `--s3cfg` (default `~/.s3cfg`), whose contents it never reads or prints.
ADR 0031 has the reasoning.

The new `snapshots/<id>/` holds:

- the base's files **copied server-side** (same bytes, same `x-amz-meta-*` and so the same
  file modes, ADR 0022), except `metadata.json`, `SHA256SUMS`, `wbm_init/`, `wbm_output/`,
  `WBM_run_state/` and `spool/`, and `data/` and `data_init/` as `snapshot fetch` leaves them;
- the run's `wbm_init/`, `wbm_output/<sim id>/` and `WBM_run_state/`, **uploaded** public-read
  with their file modes and each file's sha256 as `x-amz-meta-sha256`. The run's `spool/` and
  `spool-cache` are not uploaded;
- a new `SHA256SUMS` by the recipe in
  [`snapshot-layout.md`](../../docs/reference/snapshot-layout.md#generate-sha256sums): the base's
  own line for a copied file, a hash for an uploaded one, no line for `wbm_output/`;
- `metadata.json`, **last**. A `snapshots/<id>/` without one is an unfinished publish.

What it checks **before the first write** (a failure writes nothing):

- the given `metadata.json` passes the snapshot spec once its `id` is set (whatever `id` it
  carried is replaced, so a copy of the base's document cannot publish onto the base), and
  agrees with the run: `simulation.init` is the run's init, `uses.modelInput.id` is the run's
  model input, `uses.container` is the base's, and `about.isBasedOn` names the base;
- its `uses.modelCode.treeHash` is the tree hash of the code the publish copies from the base
  (ADR 0032), computed from the base's `SHA256SUMS` lines, which is how the copied bytes are
  known. A document that pins other code is bad input (exit 2), the same kind of failure as
  `uses.container` not being the base's, with nothing written;
- the run succeeded (`exit_code` is not non-zero), `wbm_output/<sim id>/` holds no empty file, a
  `daily/wbm_<year>.nc` for every year from the init's first year (`Run_Start`, else the spinup's
  `Start`) to its `Run_End`, and, when the init sets `Temporal_Aggregation => 1`, a
  `monthly/<variable>/wbm_<year>.nc` for every `Output_vars` entry and year. Other files are fine.
  What the init does not state (no run dates, a monthly or sub-daily file size, no
  `Output_vars`) is not checked, and a `note:` line says so;
- the tree passes the layout spec.

What it does **per key**: it reads the key first. Absent, it writes it. Present with the same
bytes, it skips it. Present with other bytes, it stops, and nothing is replaced. So a retry
with the same `--id` continues where the last attempt stopped. "Same bytes" is decided by:

| Key | Same bytes when |
|---|---|
| uploaded (`wbm_init/`, `wbm_output/`, `WBM_run_state/`, `SHA256SUMS`, `metadata.json`) | the size is equal, and `x-amz-meta-sha256` is equal; an object with no such header is the same when its ETag equals the local file's MD5 |
| copied | the size and the ETag equal the source's |

Before writing anything it also reads `metadata.json`: one with other bytes under this id
stops the publish with nothing changed. Order: copies, uploads, `SHA256SUMS`, `metadata.json`
(`--jobs` parallelises within the copies and within the uploads). The exit code of every
`s3cmd` call is checked. Afterwards it re-reads `SHA256SUMS` anonymously and HEADs every key
anonymously: present, public-read, the size it wrote, and for an upload the mode and sha256 it
sent.

`--dry-run` prints every key with its action, `copy`, `upload` or `skip`, decided from
anonymous reads, so it needs no credentials. It exits with the code a real run would stop at.

Exit codes:

| Code | Meaning |
|---|---|
| 0 | done (with `--dry-run`: a plan that would go through) |
| 2 | bad input: an unreadable run, base or `metadata.json`; `metadata.json` fails the spec or disagrees with the run, including a `uses.modelCode.treeHash` that is not the tree hash of the code to be copied; a bad `--id` |
| 3 | output incomplete: the run failed, or lacks a year or variable the init asked for, or holds an empty file; the tree fails the layout |
| 4 | a key already holds other bytes (nothing is replaced) |
| 5 | no credentials: `--s3cfg` missing or unreadable, or no `s3cmd` |
| 6 | an `s3cmd` call failed (a read, a copy or an upload) |
| 7 | verification failed: a key is missing, not public-read, or the wrong size, mode or hash |

A line `snapshot id: <id>` is printed, to stdout, before the first write.

### Simulations (`openghm sim`)

`sim run` and `sim submit` share the same snapshot mechanism (point at a folder with
`metadata.json`, e.g. one from `snapshot fetch`; the snapshot is bound read-only,
and per-sim `wbm_output`/`WBM_run_state` + a `simulation.json` sidecar are written
under `output_base/<id>/`). The model image is the one the snapshot pins
(`uses.container`), found at `<sif_dir>/<image>/<version>/<filename>`; if it is not
there the command stops and names `openghm snapshot fetch <id>` and
`openghm sif pull <image>:<version>`. `--sif PATH` overrides it. The input data is
the model input the snapshot links (`uses.modelInput.id`), found at
`<model_input_dir>/<id>`: its root is bound read-only at `/wbm/data` and its
`data_init/` at `/wbm/data_init`. If it is not there the command stops and names
`openghm snapshot fetch <id>` and `openghm model-input fetch <model-input-id>`; a
`--dry-run` prints the plan without either. `simulation.json` records `model_input`
and `model_input_path`.

**Spool** (`--spool`), what WBM reads in place of rebuilding a forcing day:

- `cache` (the default): the run's own `output_base/<id>/spool`, read-write, shared
  with other runs through a cache at `spool_cache`. One cache directory holds one
  **variant**, `<spool_cache>/<model input id>/<network>/<variant>/`, laid out as
  WBM lays out `<spool>/<network>/`. The variant is the first 16 hex characters of a
  sha256 over the image digest the snapshot pins, the `SHA256SUMS` lines of its
  `model/` and `utilities/`, the network file's sha256 (from the model input's
  `SHA256SUMS`) and the run's final init as `perl` in the image evaluates it, minus
  what only names or times the run (`ID`, `Comment`, `Project`, `Output_vars`,
  `Output_dir`, `PostProcessing`, `spool_dir`, `MT_Code_Name.{MT_ID,Run_Start,Run_End,File_Size}`,
  the spinup; `STRIPPED_KEYS` in `openghm/spool.py`). A different image, model code,
  network file, dataset, patch value or projection is a different variant, a different
  period, spinup, variable list, ID or output directory is not. `openghm spool variant
  <snapshot>` prints it and its inputs.
  Before WBM starts the run **fills** the cache from the bucket's
  `spools/<model input id>/<network>/<variant>/` (anonymous HTTPS, only the days from
  the spinup start to the year after the run end that the cache lacks; an empty
  prefix or an unreachable bucket is not an error, WBM builds what is missing) and
  **links** the cached days of those years into its own spool as symlinks, with the
  variant directory bound read-only at `/wbm/spool/.cache` (a nested bind under
  `/wbm/spool`; `output_base/<id>/spool-cache` is the symlink it is bound from,
  pointed at the variant once the init is evaluated). WBM reads a linked day and builds
  the others as regular files in its own spool. After WBM exits 0 each regular
  `.dat`/`.dat.hdr` pair under a dataset directory moves into the variant directory
  (`.hdr` first, by hard link, never overwriting: two runs that built the same day
  both finish and the cache keeps one copy); `Cell_Table.dat`, the reservoir tifs and
  other network-level files are per run and stay. A run that exits non-zero harvests
  nothing. `simulation.json` records `spool_variant`, `spool_cache` and `spool`
  (`downloaded`, `linked`, `failed`, `fill_error`, `dangling`, `harvested`,
  `already_present`, in days; `prune`, below) and the `spool_plan` that `sim submit`'s job script reads: it runs
  `openghm spool prepare <sim dir>` before WBM and `openghm spool harvest <sim dir>`
  after, on the compute node. The cache is not uploaded anywhere.

  **The cache has a cap.** Scratch allows a fixed number of files, so `spool prepare`
  first runs `openghm spool prune`: it reads the `scratch` row of `myquota` (Files and
  Limit, `59.6K` or `1.0M` with K, M, G as powers of 1000) and, when files used are at
  least `spool_prune_high` of the limit (default `0.80`), deletes whole **units** until
  the projected use is at most `spool_prune_low` (default `0.50`; the two must satisfy
  `low < high`). Without `myquota`, or with a row it cannot read, nothing is deleted and
  the run says so; a prune that fails never fails the run, and `simulation.json` records
  its result as `spool.prune`. A unit is one variant's year (every dataset's `YYYY-…`
  files, `.dat` and `.hdr`) or its `clim` unit (`0000-…` names and the undated
  climate-bias and `_MinMax` files). Each variant directory keeps an index of its units,
  `.units/<YYYY|clim>.json` (`files`, `bytes`, `last_used`, `on_s3`: S3 holds every file
  of it), which `prepare` and `harvest` maintain so that pruning lists file names but
  does not `stat` them; a unit with no readable index (a cache from before the index, a
  year only a failed fill left) is counted when pruning first sees it. A run holds the units it links through a lease,
  `<spool_cache>/.leases/<sim id>.json`, written by `prepare` before it links and removed
  by `harvest`; it expires at the run's walltime (`simulation.json`'s, which `sim run --walltime` sets; else 97 hours,
  which covers a run that failed and so never harvested), and an expired lease is ignored
  and removed. Pruning skips every unit an unexpired lease names, and takes the others
  oldest last use first (by day; among units last used the same day, one S3 holds before
  one only this cache holds), re-reading the leases before each deletion. A unit goes
  index first, then its `.dat` files, then its `.hdr` files. After linking, `prepare`
  removes a link whose target is gone (counted as `spool.dangling`), so WBM builds that
  day itself. `spool prune --dry-run` prints the same plan and deletes nothing; `--high`
  and `--low` override the config for one call. `spool prune --all` ignores the quota and
  the thresholds and deletes every unit no unexpired lease holds (even without
  `myquota`; its `--json` is the same result plus `"all": true`, and `skipped_leased`
  then counts every leased unit). `spool status [--json]` deletes nothing: it prints
  `quota` (`files_used`, `files_limit`, `bytes_used`, `bytes_limit`, from the Files
  and Size columns of the `scratch` row, sizes in decimal units; `null` with
  `quota_error` where `myquota` is missing or unreadable), `high`, `low`, `cache_root`,
  one entry per variant (`units`, `files`, `bytes`, `last_used`, `on_s3_units`,
  `leased_units`, newest last use first), the unexpired `leases` and `totals`, reading
  the unit indexes as pruning does.
- `fresh`: an empty `output_base/<id>/spool`; nothing is shared (to check a cached
  spool against a built one).

`simulation.json` records `spool_mode` and `spool_dir`.

What the spool saves, measured on Anvil on 2026-10-04 with WBM's own per-day
timing (`-bd`, `-bm`), each run twice on one node, into an empty spool and then
reusing it, every run exiting 0. A day whose forcing is not yet spooled costs the
warp and the write; a spooled day reads `.dat` files instead.

- Global v1 (job 21040894, 26 cores, `-t 8`; a 10-day spinup that WBM ran as all of
  January, then 10 run days): 52.7 s per spinup day building the spool, 39.8 s
  reusing it, so about 13 s of a 53 s day; the step that gains is "Irrigation
  Processing # 1" (461 s against 120 s over the 41 days), not "Read climate data"
  (59 s against 9 s). Run days, which write output, took 52.8 and 53.4 s with the
  spool in place either way. An earlier January run (job 21036757) saved 414 s over
  31 days, the same 13 s a day. A fresh 10-year run builds each of its 3653
  distinct dates once (the spinup's two loops and the run share 2000 to 2004), so
  a prebuilt spool would save roughly 13 hours of the 4 d 15 h run, about 12%; an
  estimate, not a measurement.
- v2 tutorial (job 21040893, 1 core, the published two years after a one-year
  spinup, 1097 days): 1762 s building the spool, 1084 s reusing it (1.6 s and
  1.0 s a day).

Building the spool ahead with forks (`build_spool.pl -f`; v1 writes a
`build_spool_batch.pl` for its run into the output directory, v2's `wbm.pl
-bldSpool` starts it alongside the run) could save no more than that, and the
toolkit does neither.

**A run that ends at once has not run.** WBM resumes from
`WBM_run_state/<run id>.dat` when it exists. The published snapshots carry the
state saved at the end of their run, so running in a snapshot folder that has it
ends in seconds: the v2 tutorial with its published state stopped after 5 s with
"Destination dataset is up to date! Nothing to do..." and wrote no `.nc`
(job 21043201). `sim run` and `sim submit` always give a run an empty
`WBM_run_state`, so it computes. The same directory also holds the state at the
end of the spinup (`<run id>.spinup.dat`), which could skip a spinup that has not
changed; the toolkit does not use it.

They differ only in **where** the model runs:

- **`sim run`** executes the container in the **foreground on this machine** — no
  SLURM. Best for small domains and testing; a big domain can take hours.
  Inside a SLURM allocation (a gateway job runs it that way) it reads
  `SLURM_CPUS_PER_TASK`; elsewhere WBM keeps its own thread default.
  `--walltime TIME` tells it how long it may last, in SLURM's forms (`MM:SS`,
  `HH:MM:SS`, `D-HH`, `D-HH:MM:SS`; a bad value stops with an `openghm:` message and
  exit 2). It is recorded as `walltime` in `simulation.json`, and the run's spool
  lease expires that long after it starts: pass the walltime the enclosing SLURM job
  asked for, or a prune can delete units the run has linked. Without it the
  metadata's `recommendedCompute.walltime` is used. After the container exits, a
  failed write to `simulation.json` (the exit code, the harvest result) is a warning
  on stderr and the command still exits with the container's exit code, so a
  finished run is never reported as refused.
- **`sim submit`** generates an `sbatch` script and submits it. Run `submit` and the
  management commands (`status`/`logs`/`cancel`, which call `sacct`/`scancel`) on a
  SLURM login node. `list` just reads the local sidecars.

**Post-processing.** An init whose `PostProcessing` block has `Run => 1` asks WBM for
climatology, multi-year means and spatial aggregates (`PostProcessing.pl`). WBM starts that
script detached, and a container does not outlive `wbm.pl`: the image is unmounted under the
script, every call fails, and the run would still look successful (Anvil job 21163850: an empty
`climatology/`). So both commands stage such a run with `Run => 0` (only the value in that block;
`Run_Start` and `Run_End` are never touched), and after WBM exits 0 they run
`PostProcessing.pl` themselves, in the foreground and in the same container and mounts as WBM,
its output in `wbm_output/<id>/PostProcessing.log`. The step passes when the script exits 0,
prints "All Done!", has no `Can't exec` line in its log, and left the files it was asked for
(the script ignores the exit status of its own `system()` calls, so "All Done!" alone proves
nothing): per variable in its `@param` list, the `_dc`, `_mc` and `_yc` files in `climatology/`
that its `$climatology`, `$monthly` and `$TA_depth` call for, and a `spatial_agg/` that is not
empty when `$spatial_agg` is 1. Whatever happened, even after a failed WBM, the requested `Run`
value is put back in `wbm_init/<init>` and in WBM's own dump `wbm_output/<id>/init_files/<init>`,
so what is published and what a rerun reads say what was asked. The result is the
`post_processing` key of `simulation.json` (`requested`, `run_value`, `argv`, then `exit_code`,
`seconds`, `log`, `tail` (the last 40 lines), `all_done`, `expected`, `found`, `cant_exec`,
`problems`, `ok`; `exit_code` and `ok` are `null` when WBM failed and the step did not run).
A failed step makes `sim run` exit 1 and fails the `sim submit` job. In the job script the step
is `openghm sim post-process <sim dir> --wbm-exit-code "$rc"`, which exits with WBM's own code
when that is not 0. A run that is killed by its walltime never gets there, so its init keeps
`Run => 0`, which is what ran. Polygon aggregation calls `nc_aggr_read.pl`, which is not in any
snapshot's `utilities/`, so a run that asks for it fails the check.

**WBM threads.** Both pass `wbm.pl` `-t N` (`wbm_threads` in `sim.py`): one thread
per core the run holds, at most 8, which is all `wbm.pl` accepts. `submit` knows the
cores because it writes `--cpus-per-task` itself (`--cores`, else
`simulation.recommendedCompute.cores`); `run` reads `SLURM_CPUS_PER_TASK`, and
passes no `-t` when that is unset or not a positive integer, so a laptop run keeps
WBM's default of 4. The count used is recorded as `wbm_threads` in `simulation.json`
(`null` for no `-t`). Measured on one Anvil node, both runs of each pair exiting 0
with the same number of output files: the Global v1 snapshot, January 2000 after a
one-month spinup, took 3887 s at `-t 8` and 4659 s at `-t 1` (job 21026529, 26
cores held for its 34 to 35 GiB peak), 17% less time and 17% less allocation
charge; the v2 CONUS tutorial took 858 s at `-t 8` and 849 s at `-t 1` (job
21026015, 0.98 CPUs either way), so threads do nothing for it and it recommends 1
core. The full 10-year Global run with its two 5-year spinup loops is not
measured; the past full run (job 17037959, default 4 threads) averaged about 1.7
CPUs.

Full contract: [`../dev/openghm_cli_design.md`](../dev/openghm_cli_design.md),
[`../dev/openghm_jobrun_params.md`](../dev/openghm_jobrun_params.md).

```sh
openghm snapshot fetch <id> --dest /path/to/snap && cd /path/to/snap   # or any folder with metadata.json

# Local, foreground (no SLURM):
openghm sim run --id smoke                  # runs here; records exit_code in simulation.json
openghm sim run --id smoke --walltime 22:30:00   # the spool lease lasts 22 h 30 min (inside a 22:30:00 job)

# On a SLURM cluster:
openghm sim submit --id run-001             # sbatch the job; records the job id
openghm sim list                            # every run under output_base
openghm sim status run-001                  # sacct → State / ExitCode / Elapsed
openghm sim logs run-001 --follow           # tail slurm-<job>.out
openghm sim cancel run-001                  # scancel (prompts unless -y)
openghm sim post-process <output_base>/run-001 --wbm-exit-code 0   # what the job script runs after WBM, when the init asks for post-processing
```

## Develop / test

```sh
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest                 # parity goldens + dry-run contract + wizard + public API
python -m build        # wheel + sdist (pip install build)
```

`tests/test_goldens.py` asserts the builders reproduce, byte-for-byte, the `--json
--dry-run` output the original (verified) Node CLI emitted for the same inputs —
captured in `tests/goldens/`.

## Architecture

`src/openghm/` is the **UI-agnostic core** (`config`, `runtime`, `mounts`, `network`,
`spatial`, `temporal`, `build`, `run`) returning plain dataclasses; `src/openghm/cli/`
is the Click CLI + Rich rendering + questionary wizard. A future GUI imports the core
directly.

## Deploy & verify on Anvil

Anvil's system Python is too old (3.6). Use the Spack module + a venv:

```sh
ssh openghm
source ~/etc/bashrc && module load python/3.9.5
python -m venv /home/x-openghm/apps/openghm/venv
/home/x-openghm/apps/openghm/venv/bin/pip install <wheel>   # later: openghm (PyPI)
# from a checkout instead of a wheel: see Install (needs pip >= 21.3 or --use-feature=in-tree-build)
```

A wrapper on `PATH` keeps callers from needing `module load`:

```sh
# /home/x-openghm/apps/openghm/bin/openghm
#!/bin/bash
source ~/etc/bashrc
module load python/3.9.5
exec /home/x-openghm/apps/openghm/venv/bin/openghm "$@"
```
