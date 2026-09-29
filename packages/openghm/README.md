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
> commands (`init`, `sif`), and `snapshot` (`fetch` a published snapshot,
> `validate` a folder). Snapshots are **self-describing folders** (a root
> `metadata.json`), and `sim` runs the folder you point it at.

**Status:** `sim submit` has run a real WBM job to completion on Anvil (Python 3.9.5)
and `sim status` reads live `sacct` records. The test suite covers the
processing-tool goldens, the dry-run contract, `sim` build/run + management, image
assets, `snapshot fetch` (against a local HTTP fixture), `init`, the library API
and the wizard. `snapshot fetch` and `sim --spool` have not yet run on Anvil. **Full library/API reference:**
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
| `openghm sif list` / `pull <image[:version]>` | — | list published images / download one into `sif_dir` |
| `openghm snapshot fetch <id>` | anonymous HTTPS | download `snapshots/<id>/` and the image it pins, verified; `--dest`, `--spool auto\|skip`, `--no-image`, `--jobs` |
| `openghm snapshot validate [PATH]` | — | check a folder's `metadata.json` and layout against the snapshot spec |
| `openghm sim run [PATH]` | `singularity`/`docker` WBM run | **local, foreground, no SLURM**; same snapshot mechanism as `submit` |
| `openghm sim submit [PATH]` | `sbatch` + `singularity` WBM run | snapshot folder (default cwd) w/ `metadata.json`; split-mount; `--spool snapshot\|fresh`; writes `simulation.json` |
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
openghm snapshot fetch <id>                    # -> ./<id>, plus the pinned image in sif_dir
openghm snapshot fetch <id> --spool skip       # without the (large) spool cache
openghm snapshot fetch <id> --dest /scratch/me/snap --jobs 16 --no-image
```

Reads `snapshots/<id>/` from the public bucket with anonymous HTTPS (no
credentials). It downloads everything **except** `wbm_output/` (a snapshot carries
its output, it does not consume it; ADR 0009 — the fetched tree gets an empty
`wbm_output/`, which the layout requires) and `WBM_run_state/` (a new run
starts its own). `spool/` is downloaded with `--spool auto` (the default) when the
snapshot has one, and never with `--spool skip`.

- Every file with a `SHA256SUMS` line is checked against it. A spool file has no
  line, so it is checked by size and, when its ETag is a plain MD5 (not
  multipart), by MD5. A file in the bucket with no line and outside `spool/`, or a
  line with no object, is a failure.
- Modes come from each object's `x-amz-meta-s3cmd-attrs` header (ADR 0022); an
  object without one is a failure rather than a guessed mode (setuid/setgid/sticky
  bits are never applied).
- The image is `uses.container.https` from `metadata.json`, cached under `sif_dir`
  and checked against `uses.container.digest`.
- It resumes: a file already at its path with the right size and hash is skipped
  (re-run it after an interruption; the last line is `downloaded N, skipped M,
  failed K`). Exit status is 1 if anything failed, with the paths listed.

### Simulations (`openghm sim`)

`sim run` and `sim submit` share the same snapshot mechanism (point at a folder with
`metadata.json`, e.g. one from `snapshot fetch`; the snapshot is bound read-only,
and per-sim `wbm_output`/`WBM_run_state` + a `simulation.json` sidecar are written
under `output_base/<id>/`). The model image is the one the snapshot pins
(`uses.container`), found at `<sif_dir>/<image>/<version>/<filename>`; if it is not
there the command stops and names `openghm snapshot fetch <id>` and
`openghm sif pull <image>:<version>`. `--sif PATH` overrides it.

**Spool** (`--spool`): `snapshot` (the default) binds `<snapshot>/spool` read-write
as `/wbm/spool` and creates it if absent, so a fetched spool is used in place
(never copied) and a missing one is there after the run. It needs the snapshot
folder to be writable; otherwise the command fails and suggests `--spool fresh`,
which gives the run an empty `output_base/<id>/spool`. `simulation.json` records
`spool_mode` and `spool_dir`. **Two simulations must not share one snapshot's spool
at the same time** (nothing stops them; use `--spool fresh` for the second).

They differ only in **where** the model runs:

- **`sim run`** executes the container in the **foreground on this machine** — no
  SLURM. Best for small domains and testing; a big domain can take hours.
- **`sim submit`** generates an `sbatch` script and submits it. Run `submit` and the
  management commands (`status`/`logs`/`cancel`, which call `sacct`/`scancel`) on a
  SLURM login node. `list` just reads the local sidecars.

Full contract: [`../dev/openghm_cli_design.md`](../dev/openghm_cli_design.md),
[`../dev/openghm_jobrun_params.md`](../dev/openghm_jobrun_params.md).

```sh
openghm snapshot fetch <id> --dest /path/to/snap && cd /path/to/snap   # or any folder with metadata.json

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
