# openghm

A Python **library + CLI** that wraps the three WBM **processing tools** behind one
entry point, calling them inside the lightweight WBM container
(`wbm_tools_lite.sif`) via `singularity`/`apptainer` (or `docker` locally).

The core is UI-agnostic: it builds a `BuiltCommand` (the exact container invocation
plus any generated `.init`/Magic-Table files) and either runs it or shows it. The CLI
and the interactive wizard are thin frontends; `import openghm` exposes the same core
for notebooks, batch scripts, and a future GUI.

> Scope: the three synchronous processing commands — `network`, `spatial`,
> `temporal` — plus `sim`, WBM model runs either **locally** (`run`, foreground) or
> on **SLURM** (`submit` / `status` / `list` / `logs` / `cancel`), and setup
> commands (`init`, `sif`). Snapshots are **self-describing folders** (a root
> `metadata.json`), so there is no separate `snapshot` command group.

**Status:** verified end-to-end on Anvil (Python 3.9.5). `sim submit` ran a real
WBM job to completion and `sim status` reads live `sacct` records; 82 tests pass
(processing-tool goldens, dry-run contract, `sim` build/run + management, image
assets, `init`, library API, wizard). **Full library/API reference:**
[`docs/library.md`](docs/library.md).

## Install

`pip install` deliberately downloads **no container image** — it installs only the
pure-Python package. `openghm init` then sets you up (downloads the image(s) after
asking, and configures SLURM if you need it):

```sh
pip install openghm          # once published to PyPI (or: pip install . from a checkout)
openghm init                 # interactive: pick runtime, download image, configure
```

`init` announces each image's size (lite ≈ 317 MB; WBM model images ≈ 0.5–1.8 GB)
and asks before downloading. Non-interactive setup for CI/provisioning:

```sh
openghm init --non-interactive --preset local   # or --preset anvil
openghm sif pull lite                            # fetch an image on demand
openghm sif list                                 # what's available / already cached
```

Requires Python ≥ 3.9. All dependencies are pure-Python (`click`, `rich`,
`questionary`, and `tomli` on < 3.11), so installation needs no compiler — important
for HPC. Images are cached under `sif_dir` (default `~/.openghm/sif`); an existing
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
| `openghm sif list` / `pull` | — | list available images / download one into `sif_dir` |
| `openghm sim run [PATH]` | `singularity`/`docker` WBM run | **local, foreground, no SLURM**; same snapshot mechanism as `submit` |
| `openghm sim submit [PATH]` | `sbatch` + `singularity` WBM run | snapshot folder (default cwd) w/ `metadata.json`; split-mount; writes `simulation.json` |
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

### Simulations (`openghm sim`)

`sim run` and `sim submit` share the same snapshot mechanism (point at a folder with
`metadata.json`; the snapshot is bound read-only, and per-sim `spool`/`wbm_output`/
`WBM_run_state` + a `simulation.json` sidecar are written under `output_base/<id>/`).
They differ only in **where** the model runs:

- **`sim run`** executes the container in the **foreground on this machine** — no
  SLURM. Best for small domains and testing; a big domain can take hours.
- **`sim submit`** generates an `sbatch` script and submits it. Run `submit` and the
  management commands (`status`/`logs`/`cancel`, which call `sacct`/`scancel`) on a
  SLURM login node. `list` just reads the local sidecars.

Full contract: [`../dev/openghm_cli_design.md`](../dev/openghm_cli_design.md),
[`../dev/openghm_jobrun_params.md`](../dev/openghm_jobrun_params.md).

```sh
cd /path/to/snapshots/wbm_storage_v2.0.0   # a folder with metadata.json

# Local, foreground (no SLURM):
openghm sim run --id smoke                  # runs here; records exit_code in simulation.json

# On a SLURM cluster:
openghm sim submit --id run-001             # sbatch the job; records the job id
openghm sim list                            # every run under output_base
openghm sim status run-001                  # sacct → State / ExitCode / Elapsed
openghm sim logs run-001 --follow           # tail slurm-<job>.out
openghm sim cancel run-001                  # scancel (prompts unless -y)
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
```

A wrapper on `PATH` keeps callers from needing `module load`:

```sh
# /home/x-openghm/apps/openghm/bin/openghm
#!/bin/bash
source ~/etc/bashrc
module load python/3.9.5
exec /home/x-openghm/apps/openghm/venv/bin/openghm "$@"
```
