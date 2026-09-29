# openghm — Python library reference

`openghm` is a library first and a CLI second. Everything the `openghm` command
does is available through `import openghm`, so you can drive the WBM tools-lite
container from notebooks, batch scripts, a web backend, or a future GUI.

- **Overview & CLI:** [`../README.md`](../README.md)
- **This doc:** the complete `import openghm` API — functions, options, mounts,
  config, error handling, recipes, and a flag↔option↔script map.

---

## Contents

1. [Install & import](#1-install--import)
2. [Quick start](#2-quick-start)
3. [Module-level functions](#3-module-level-functions)
4. [Option objects](#4-option-objects)
   - [`NetworkOptions`](#networkoptions) · [`SpatialOptions`](#spatialoptions) · [`TemporalOptions`](#temporaloptions)
5. [Data types](#5-data-types)
6. [Mounts & host→container path translation](#6-mounts--hostcontainer-path-translation)
7. [Configuration](#7-configuration)
8. [Runtime selection (singularity / apptainer / docker)](#8-runtime-selection)
9. [Error handling](#9-error-handling)
10. [Recipes](#10-recipes)
11. [Appendix — flag ↔ option ↔ wrapped-script map](#11-appendix--flag--option--wrapped-script-map)

---

## 1. Install & import

```sh
pip install openghm          # once published to PyPI
# or, from a checkout (needs pip >= 21.3, or --use-feature=in-tree-build on
# Anvil's python/3.9.5 pip 21.1 — see the package README's Install):
pip install packages/openghm
```

Python ≥ 3.9. Pure-Python dependencies only (`click`, `rich`, `questionary`,
and `tomli` on < 3.11) — no compiler needed, so it installs cleanly on Anvil's
`module load python/3.9.5` toolchain.

```python
import openghm
print(openghm.__version__)   # "0.1.0"
```

Public surface:

```python
from openghm import (
    preclip, subset, spatial, temporal,   # primary functions
    RunResult, Mount, BuiltCommand,        # data types
    Config, load_config,                   # configuration
    OpenghmError, ValidationError,         # errors
)
```

---

## 2. Quick start

```python
import openghm

# Inspect without doing anything (no files written, no container run):
res = openghm.spatial(
    mt="/work/test.MT.csv",
    data_code="Global_tracking_runoff_y",
    mask_code="US_states_6min",
    work="/scratch/work",
    mounts={"gt_output": "/data/snap/gtout", "masks": "/data/snap/masks"},
    output="/work/out.nc",
    dry_run=True,
)
print(res.display)
# singularity exec -c -e -B /data/snap/gtout:/data/gt_output ... \
#   /wbm/utilities/spatial_aggregation.pl -f /work/US_states_6min.msk \
#   -mt /work/test.MT.csv Global_tracking_runoff_y US_states_6min /work/out.nc

# Actually run it:
res = openghm.spatial(
    mt="/work/test.MT.csv", data_code="Global_tracking_runoff_y",
    mask_code="US_states_6min", work="/scratch/work",
    mounts={"gt_output": "/data/snap/gtout", "masks": "/data/snap/masks"},
    output="/work/out.nc",
)
print(res.exit_code)   # 0 on success
```

---

## 3. Module-level functions

The four functions are the primary `import openghm` surface. Each loads
`~/.openghm/config.toml`, builds the container command, and runs it.

```python
openghm.preclip(*, runtime=None, sif=None, config_path=None,
                   dry_run=False, capture=False, **network_opts) -> RunResult
openghm.subset(*,  runtime=None, sif=None, config_path=None,
                   dry_run=False, capture=False, **network_opts) -> RunResult
openghm.spatial(*, runtime=None, sif=None, config_path=None,
                   dry_run=False, capture=False, **spatial_opts) -> RunResult
openghm.temporal(*, runtime=None, sif=None, config_path=None,
                    dry_run=False, capture=False, **temporal_opts) -> RunResult
```

### Control kwargs (common to all four)

| kwarg | Type | Meaning |
|---|---|---|
| `runtime` | str \| None | override runtime: `"singularity"` \| `"apptainer"` \| `"docker"` |
| `sif` | str \| None | override SIF path (or docker image name) |
| `config_path` | str \| None | path to a `config.toml`; default: `~/.openghm/config.toml` |
| `dry_run` | bool | build the command but do not execute it; returns `RunResult.dry_run=True` |
| `capture` | bool | collect `stdout`/`stderr` into the `RunResult` instead of streaming |

The remaining `**kwargs` are the fields of the matching options dataclass —
[`NetworkOptions`](#networkoptions) for `preclip`/`subset`,
[`SpatialOptions`](#spatialoptions) for `spatial`,
[`TemporalOptions`](#temporaloptions) for `temporal`.

```python
# dry-run: inspect the singularity command
res = openghm.preclip(
    net="/.../05min_flwdir.tif", output="/work/preclip.asc",
    work="/scratch/work", mounts={"network": "/.../net"},
    lon_min=-110, lon_max=-100, lat_min=40, lat_max=48,
    dry_run=True,
)
print(res.display)

# switch to docker for local testing
res = openghm.spatial(..., runtime="docker", dry_run=True)
```

---

## 4. Option objects

The `**kwargs` above are the fields of the typed options dataclasses. You can
also use them directly when you want to reuse or inspect option sets:

```python
from openghm.spatial import SpatialOptions, build_spatial
from openghm.runtime import RuntimeContext
from openghm import load_config

opts = SpatialOptions(mt="/work/t.MT.csv", data_code="RUNOFF_Y",
                      mask_code="US_states_6min", work="/scratch/work",
                      mounts={"gt_output": "/data/snap/gtout"})
ctx  = RuntimeContext.from_config(load_config().config)
cmd  = build_spatial(opts, ctx)     # BuiltCommand — inspect without running
print(cmd.display)
```

> **Numbers** (`lon_min`, `scale`, …) accept `int` or `float`. Integer-valued
> floats drop the decimal point (`-110`, not `-110.0`), matching the reference
> (Node) output for `.init` files.

### `NetworkOptions`

Drives `preclip` / `subset` (the `networkTools` script). The library
**generates the `.init`** from these fields (Mode A). Pass `init=` to run a
hand-authored `.init` verbatim (Mode B).

| Field | Type | Default | Meaning / init key |
|---|---|---|---|
| `net` | str | — | input flow-direction network → `Net_file` (required, Mode A) |
| `output` | str | — | output file → `<job>.output_file` (required, Mode A) |
| `lon_min`,`lon_max`,`lat_min`,`lat_max` | float | — | clip box → `rectangle.*` |
| `shapefile` | str | None | polygon subset → `polygon.file` (subset) |
| `id_field` | str | None | polygon ID attribute → `polygon.shp_var` |
| `ids` | list[int] | None | polygon IDs to keep → `polygon.polIDs` |
| `proj` | str | `"epsg:4326"` | polygon projection → `polygon.proj` |
| `basin_id` | str | None | basin-ID raster → `basinID_file` |
| `trim_nodata` | bool | None→0 | crop nodata margins → `trim_nodata` |
| `inscribe` | bool | None | inscribe vs superscribe → `inscribe` (subset) |
| `continuous` | bool | None | one connected region → `polygon.continuous` |
| `truncation_check` | bool | None→1 | preclip truncation check → `truncation_check` |
| `init` | str | None | **Mode B**: run this `.init` verbatim |
| `verbose` | bool | None | `-v` into the script |
| `work` | str | None | host dir bound to `/work` |
| `mounts` | dict / list | None | data mounts → `/data/<name>` |

Either a rectangle (`lon_*`/`lat_*`) **or** a `shapefile` is required in
Mode A; otherwise `build_network` raises [`OpenghmError`](#9-error-handling).

### `SpatialOptions`

Drives `spatial` (the `spatial_aggregation.pl` script).

| Field | Type | Default | Maps to |
|---|---|---|---|
| `mt` | str | — | `-mt` Magic Table CSV (**required**) |
| `data_code` | str | — | positional `DATA_CODE` (**required**) |
| `mask_code` | str | — | positional `MASK_CODE[+MASK2+…]` (**required**) |
| `output` | str | None | positional `NetCDF_OUT` |
| `key_file` | str | None | `-f`; **auto-defaults** to `/work/<mask>.msk` when omitted |
| `start` / `end` | str | None | `-sd` / `-ed` (`YYYY-MM-DD`) |
| `method` | `"mean"`\|`"sum"` | `"mean"` | `sum` → `-c` |
| `weight` | float | None | `-na` (constant weight, no area weighting) |
| `mask_res` | float | None | `-tr` (rasterize resolution) |
| `out_type` | str | None | `-ot` (`byte\|short\|long\|float\|double`) |
| `scale` / `offset` | float | None | `-scl` / `-off` |
| `metadata` | str | None | `-mdt` (`NAME:UNITS:FORMAT`) |
| `remove` | bool | None | `-rm` |
| `remove_mask` | bool | None | `-rmsk` |
| `remove_records` | int | None | `-rr` |
| `zero_id` | bool | None | `-z` |
| `verbose` | bool | None | `-v` |
| `work` | str | None | `/work` host dir (required) |
| `mounts` | dict / list | None | `/data/<name>` mounts |

> `mt` is required (no `DataID_DB.csv` for global lookup); `key_file` auto-defaults
> under `/work` (RIMS.conf lacks `pol_key_dir`, so the script would otherwise crash).

### `TemporalOptions`

Drives `temporal` (the `temporal_aggregation.pl` script).

| Field | Type | Default | Maps to |
|---|---|---|---|
| `mt` | str | — | `-mt` Magic Table CSV (**required**) |
| `src_code` | str | — | positional `SRC_DATA_CODE` (**required**) |
| `dst_code` | str | — | positional `DST_DATA_CODE` (**required**) |
| `start` / `end` | str | None | `-sd` / `-ed` |
| `method` | `"mean"`\|`"sum"`\|`"category"` | None | `-a 0`\|`-a 1`\|`-a 2` |
| `scale` / `offset` | float | None | combined `-so SCALE OFFSET` (defaults 1/0 if only one given) |
| `out_type` | str | None | `-ot` |
| `patch` | float | None | `-p` (patch nodata) |
| `metadata` | str | None | `-mdt` |
| `remove` | bool | None | `-rm` |
| `remove_records` | int | None | `-rr` |
| `trim` | bool | None | `-trim` |
| `push_dates` | bool | None | `-pd` |
| `no_datacube_check` | bool | None | `-ndc` |
| `nc3` | bool | None | `-nc3` (classic NetCDF-3) |
| `verbose` | bool | None | `-v` |
| `work` | str | None | `/work` host dir (required) |
| `mounts` | dict / list | None | `/data/<name>` mounts |

---

## 5. Data types

All are dataclasses in `openghm.types` (re-exported at top level).

### `RunResult`
```python
RunResult(
    dry_run: bool,
    argv: list[str],
    display: str,
    exit_code: int | None = None,     # None for a dry run
    stdout: str | None = None,        # set only when capture=True
    stderr: str | None = None,
)
```
Returned by all four module functions. `display` is the shell-safe one-liner
you'd paste into a terminal. `argv` is the list ready to pass to `subprocess`.

### `Mount`
```python
Mount(host: str, container: str, readonly: bool = False)
```
A single bind mount. Rendered as `-B host:container` (singularity/apptainer)
or `-v host:container` (docker); `readonly=True` appends `:ro`.

### `BuiltCommand`
```python
BuiltCommand(
    argv: list[str],                  # full runtime invocation, ready to spawn
    mounts: list[Mount],
    inner_cmd: list[str],             # the command run *inside* the container
    generated_files: list[GeneratedFile],
    display: str,                     # shell-safe one-liner
)
```
Returned by the low-level `build_*` functions. The four module functions use
this internally; it is exposed for advanced use.

### `GeneratedFile`
```python
GeneratedFile(host_path: str, content: str)
```
A file the builder generated (e.g. a networkTools `.init`) that must be
written before running. The module functions handle this automatically.

### `Config`
See [§7](#7-configuration).

### `RuntimeContext`
```python
RuntimeContext(runtime: str, image: str)
RuntimeContext.from_config(config, *, runtime=None, sif=None) -> RuntimeContext
```
Resolves which runtime + image to use (overrides beat config; for docker the
image defaults to `config.docker_image`, otherwise `config.sif`). Rarely
needed by library users — pass `runtime=` / `sif=` to the module functions.

---

## 6. Mounts & host→container path translation

The container sees two roots, mirroring `run/wbm-tools`:

- **`/data/<name>`** — inputs (read). Declared via `mounts`.
- **`/work`** — outputs + generated `.init`/MT files. Declared via `work`.

You pass **host paths**; the builder rewrites them to container paths and
records the bind mounts automatically. Rules:

1. **Explicit data mounts.** `mounts={"network": "/host/net"}` binds `/host/net`
   → `/data/network`. An input under that dir (e.g. `net="/host/net/05min.tif"`)
   becomes `/data/network/05min.tif`.
2. **Auto-mount.** An input whose directory wasn't declared is auto-mounted under
   `/data/<sanitized-name>` (deduplicated if the name is taken).
3. **`/work`.** `work="/scratch/run"` binds it to `/work`. Output paths are
   rewritten relative to it. If `work` is omitted, it is **inferred** from the
   host output/`mt` path's directory.
4. **Container paths pass through.** A path already starting with `/data` or
   `/work` is used as-is — so you can hand-author an MT/init with container paths
   and just declare the mounts.

`mounts` accepts several shapes (all equivalent):

```python
mounts={"gt_output": "/host/gt", "masks": "/host/masks"}        # dict (recommended)
mounts=[("gt_output", "/host/gt"), ("masks", "/host/masks")]     # (name, dir) tuples
```

---

## 7. Configuration

```python
load_config(path: str | None = None, *, create: bool = True) -> LoadedConfig
```

Reads `~/.openghm/config.toml` (creating it with Anvil defaults on first use;
falls back to in-memory defaults on read-only filesystems). `LoadedConfig` has
`.config` (a `Config`), `.path`, and `.created`.

The four module functions call `load_config()` automatically. Override via
`config_path=`:

```python
openghm.spatial(..., config_path="/path/to/custom.toml")
```

### `Config`

```python
Config(
    runtime="singularity",
    sif="/home/x-openghm/apps/wbm/lite/wbm_tools_lite.sif",
    docker_image="wbm-lite:latest",
    snapshot_root=..., output_base=..., account=..., partition=...,  # reserved
)
```

`config.toml` (auto-created):

```toml
runtime       = "singularity"   # singularity | apptainer | docker
sif           = "/home/x-openghm/apps/wbm/lite/wbm_tools_lite.sif"
docker_image  = "wbm-lite:latest"
```

---

## 8. Runtime selection

| `runtime` | invocation | image source |
|---|---|---|
| `singularity` (default) | `singularity exec -c -e -B h:c … SIF cmd…` | `config.sif` / `sif=` |
| `apptainer` | `apptainer exec -c -e -B h:c … SIF cmd…` | `config.sif` / `sif=` |
| `docker` | `docker run --rm -v h:c … IMAGE cmd…` | `config.docker_image` / `sif=` |

```python
openghm.spatial(..., runtime="docker")                   # uses wbm-lite:latest
openghm.spatial(..., runtime="apptainer", sif="/p.sif")
```

`-c` (contain) and `-e` (cleanenv) match the `run/wbm-tools` launcher exactly.

---

## 9. Error handling

```python
from openghm import OpenghmError      # base
from openghm import ValidationError   # subclass (invalid/missing options)
```

Builders raise `OpenghmError` for bad/missing options (missing `--mt`, no
`/work` mount, missing clip region, etc.) and **never** call `sys.exit` — so
callers stay in control. The CLI catches it, prints `openghm: <message>` to
stderr, and exits 2.

```python
try:
    openghm.spatial(mt="", data_code="X", mask_code="Y", work="/w", dry_run=True)
except openghm.OpenghmError as e:
    print("bad options:", e)   # bad options: --mt (Magic Table CSV) is required
```

A nonzero **container** exit is *not* an exception — it is `RunResult.exit_code`:

```python
res = openghm.temporal(...)
if res.exit_code:
    ...   # the wrapped script failed; inspect res.stderr if capture=True
```

---

## 10. Recipes

**Inspect the exact container command without running**
```python
print(openghm.spatial(..., dry_run=True).display)
```

**Capture output for logging**
```python
res = openghm.spatial(..., capture=True)
logger.info(res.stdout)
if res.exit_code:
    logger.error(res.stderr)
```

**Batch over many regions**
```python
boxes = {"ne": (-80, -70, 40, 45), "wy": (-111, -104, 41, 45)}
for name, (lo, hi, la, ha) in boxes.items():
    res = openghm.preclip(
        net="/data/snap/net/05min_flwdir.tif", output=f"/work/{name}.asc",
        work="/scratch/run", mounts={"network": "/data/snap/net"},
        lon_min=lo, lon_max=hi, lat_min=la, lat_max=ha, capture=True,
    )
    print(name, "->", res.exit_code)
```

**Polygon (shapefile) subset**
```python
openghm.subset(
    net="/data/snap/net/05min_flwdir.tif", output="/work/admin.asc",
    work="/scratch/run", mounts={"network": "/data/snap/net"},
    shapefile="/data/snap/shp/admin.shp", id_field="ObjectID", ids=[153], inscribe=True,
)
```

**Run a hand-authored `.init` verbatim (Mode B)**
```python
openghm.preclip(init="/work/manual.init", work="/scratch/run",
                mounts={"network": "/data/snap/net"})
# paths inside the init must already be container paths
```

**Local development with docker**
```python
res = openghm.spatial(..., runtime="docker", dry_run=True)
print(res.display)   # docker run --rm -v …
```

**Serialize a plan to JSON (e.g. for an API/GUI)**
```python
from openghm.spatial import build_spatial, SpatialOptions
from openghm.runtime import RuntimeContext
from openghm import load_config
from openghm.cli.render import build_payload

ctx  = RuntimeContext.from_config(load_config().config)
cmd  = build_spatial(SpatialOptions(...), ctx)
payload = build_payload("spatial", ctx.runtime, ctx.image, cmd)   # dict → json.dumps
```

---

## 11. Appendix — flag ↔ option ↔ wrapped-script map

The CLI flag, the Python keyword argument, and the underlying script
argument/init key are three names for the same thing. Python uses `snake_case`;
CLI flags use `--kebab-case`.

### Common (all commands)
| CLI flag | Python kwarg | Notes |
|---|---|---|
| `--mount NAME=DIR` | `mounts={NAME: DIR}` | repeatable → `/data/NAME` |
| `--work DIR` | `work=DIR` | → `/work` |
| `--runtime` | `runtime=` | `singularity`\|`apptainer`\|`docker` |
| `--sif` | `sif=` | SIF path or docker image |
| `-v/--verbose` | `verbose=True` | `-v` into the script |
| `--dry-run` | `dry_run=True` | build only |
| `--config` | `config_path=` | path to `config.toml` |

### network (`networkTools`, generates `.init`)
| CLI flag | Python (`NetworkOptions`) | init key |
|---|---|---|
| `--net` | `net` | `Net_file` |
| `--output` | `output` | `<job>.output_file` |
| `--lon-min/-max --lat-min/-max` | `lon_min/lon_max/lat_min/lat_max` | `rectangle.*` |
| `--shapefile` | `shapefile` | `polygon.file` |
| `--id-field` | `id_field` | `polygon.shp_var` |
| `--ids 1,2,3` | `ids=[1,2,3]` | `polygon.polIDs` |
| `--proj` | `proj` | `polygon.proj` |
| `--basin-id` | `basin_id` | `basinID_file` |
| `--trim-nodata` | `trim_nodata=True` | `trim_nodata` |
| `--inscribe` | `inscribe=True` | `inscribe` |
| `--continuous` | `continuous=True` | `polygon.continuous` |
| `--no-truncation-check` | `truncation_check=False` | omits `truncation_check` (preclip) |
| `--init` | `init` | Mode B (verbatim) |

### spatial (`spatial_aggregation.pl`)
| CLI flag | Python (`SpatialOptions`) | script arg |
|---|---|---|
| `--mt` | `mt` | `-mt` |
| `--data` | `data_code` | positional `DATA_CODE` |
| `--mask` | `mask_code` | positional `MASK_CODE` |
| `--output` | `output` | positional `NetCDF_OUT` |
| `--key-file` | `key_file` | `-f` (auto `/work/<mask>.msk`) |
| `--start/--end` | `start`/`end` | `-sd`/`-ed` |
| `--method sum` | `method="sum"` | `-c` |
| `--weight` | `weight` | `-na` |
| `--mask-res` | `mask_res` | `-tr` |
| `--out-type` | `out_type` | `-ot` |
| `--scale/--offset` | `scale`/`offset` | `-scl`/`-off` |
| `--metadata` | `metadata` | `-mdt` |
| `--remove` | `remove` | `-rm` |
| `--remove-mask` | `remove_mask` | `-rmsk` |
| `--remove-records` | `remove_records` | `-rr` |
| `--zero-id` | `zero_id` | `-z` |

### temporal (`temporal_aggregation.pl`)
| CLI flag | Python (`TemporalOptions`) | script arg |
|---|---|---|
| `--mt` | `mt` | `-mt` |
| `--src` | `src_code` | positional `SRC_DATA_CODE` |
| `--dst` | `dst_code` | positional `DST_DATA_CODE` |
| `--start/--end` | `start`/`end` | `-sd`/`-ed` |
| `--method mean\|sum\|category` | `method` | `-a 0\|1\|2` |
| `--scale/--offset` | `scale`/`offset` | `-so SCALE OFFSET` |
| `--out-type` | `out_type` | `-ot` |
| `--patch` | `patch` | `-p` |
| `--metadata` | `metadata` | `-mdt` |
| `--remove` | `remove` | `-rm` |
| `--remove-records` | `remove_records` | `-rr` |
| `--trim` | `trim` | `-trim` |
| `--push-dates` | `push_dates` | `-pd` |
| `--no-datacube-check` | `no_datacube_check` | `-ndc` |
| `--nc3` | `nc3` | `-nc3` |

---

*Verified end-to-end on Anvil (Python 3.9.5): 28 unit tests, the four `tools-lite`
goldens, 16 extended cases, the public API, and the interactive wizard. See
[`../README.md`](../README.md) for deployment.*
