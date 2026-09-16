# WBM `v2-lite-s3` — direct S3 reads (`wbm_v2_lite_s3`)

A WBM v2 environment container (plus the model-code patches it needs) that lets
WBM read its NetCDF input **directly from S3-compatible object storage** (Anvil's
Ceph RGW at `https://s3.anvil.rcac.purdue.edu`) over GDAL `/vsicurl` — true lazy
HTTP range reads, full CF georeferencing, and **no local pre-staging** of the
multi-GB input snapshot.

This folder is the whole S3-direct bundle:

| File | What |
|---|---|
| `wbm_v2_lite_s3.def` | **recommended** build recipe — slim (`libgdal-core`, no python/BLAS) |
| `wbm_v2_lite_s3_full.def` | heavier variant — full conda `gdal` (incl. Python bindings) |
| `extras/Alien_gdal_stub.pm` | `Geo::GDAL::FFI` → `/opt/gdal` shim (copied in by the def) |
| `extras/proj_epsg_custom` | custom-CRS init file (PROJ 9 migration; baked into the SIF) |
| `patches/wbm_s3_direct.md` | the WBM model-code changes for `/vsicurl` reads (applied to the **bound** snapshot code, not the container) |

The name reflects the two things that define it: it is built on the **`v2-lite`**
base, and its purpose is **S3** direct access. The S3 capability is the container
(GDAL 3.10 `/vsicurl`) **plus** the `patches/` applied to the bound model — the
container alone is the enabler.

## Why a new GDAL

The `v2-lite` base ships Ubuntu-20.04 apt **GDAL 3.0.4**. Its netCDF driver cannot
open `/vsicurl` (needs a local POSIX file); its HDF5 driver can stream `/vsicurl`
but drops the geotransform → `gdalwarp` fails. **GDAL ≥ 3.x with the conda-forge
`libgdal-netcdf` plugin** opens `NETCDF:"/vsicurl/<url>":<var>` with the correct
geotransform and issues byte-range GETs.

Verified on Anvil (GDAL 3.10.3): an 864 KB daily MERRA2 file is read with **3 HTTP
range requests, not a full download**; the WBM `gdal_translate`→`gdalwarp` pipeline
produces a correctly georeferenced 807×425 CONUS grid.

## What changed (and what did NOT)

Only the **GDAL / PROJ / netCDF C stack** is upgraded. The `v2-lite` base is
bootstrapped as-is, so the frozen, snapshot-compatible Perl stack is untouched:

| Component | Status |
|---|---|
| Ubuntu 20.04 / perl 5.30 (snapshot `_Inline` cache compat) | **unchanged** (base) |
| PDL 2.063, FFI::Platypus 2.01, Geo::GDAL::FFI 0.09 + patches, FlexRaw, WBMQuiet | **unchanged** (base) |
| GDAL 3.0.4 → **3.10.3** (conda-forge, `libgdal-netcdf` + `libgdal-hdf5` plugins) | **upgraded**, bundled at `/opt/gdal` |
| PROJ 6.3.1 → **9.x** (conda dep) + custom-CRS init file | **upgraded** |
| `Alien::gdal` shim, gdal CLI, `GDAL_DATA`/`PROJ_DATA`/`GDAL_DRIVER_PATH` | re-pointed to `/opt/gdal` |

`Geo::GDAL::FFI 0.09` binds the libgdal **C API** (ABI-stable across GDAL 3.x), so
it drives 3.10 with no rebuild (verified: `GDAL API version: 3.10.3`).

## Base layer — `wbm_v2_lite` (built from [`../wbm-v2-lite/`](../wbm-v2-lite))

This container is **not standalone source** — it `Bootstrap: localimage` from
`/home/x-openghm/apps/wbm/v2-lite/wbm_v2_lite.sif`, the frozen WBM v2 environment.
That base's recipe lives in this repo at [`images/wbm-v2-lite/`](../wbm-v2-lite):

- [`images/wbm-v2-lite/Dockerfile`](../wbm-v2-lite/Dockerfile) — the lite image: Ubuntu 20.04,
  **perl 5.30** (so the snapshot's prebuilt `model/_Inline` cache loads read-only,
  no recompile), **PDL 2.063**, **FFI::Platypus 2.01**, **Geo::GDAL::FFI 0.09 +
  `double[6]` patch**, FlexRaw + WBMQuiet patches, **PROJ 6.3.1**, apt **GDAL
  3.0.4**. Environment-only (no embedded model code — `wbm.pl`/RIMS/utilities are
  bind-mounted from the snapshot). Each pin is load-bearing; the Dockerfile header
  documents why (e.g. FFI 1.34 breaks `OCTTransform`, PDL 2.08x desyncs NiceSlice).
- [`images/wbm-v2-lite/deploy_to_anvil.sh`](../wbm-v2-lite/deploy_to_anvil.sh) — builds that
  Dockerfile to a docker image, `docker save`s it, scps to Anvil, and
  `apptainer build wbm_v2_lite.sif docker-archive://…` into
  `/home/x-openghm/apps/wbm/v2-lite/` (login node, unprivileged, no fakeroot).

### Can I keep only `v2-lite-s3` and delete `v2-lite`?

**At runtime, yes.** `Bootstrap: localimage` is a **build-time** dependency only —
apptainer squashes the whole base into the new SIF, so `wbm_v2_lite_s3.sif` is a
self-contained single file (the validation runs below used only that SIF). Once
built and validated you may delete the `wbm_v2_lite.sif` binary from `apps/`.
**Keep [`images/wbm-v2-lite/`](../wbm-v2-lite) regardless** — it is the source needed to rebuild
the base before rebuilding this layer.

The lite base only matters here for its **Perl stack**; its apt GDAL 3.0.4 / PROJ
6.3.1 are fully superseded by `/opt/gdal` (3.10 / PROJ 9) + the CLI symlinks, so
the base's GDAL is effectively dead weight (a candidate for a future base-slimming
pass, left in place to keep the base byte-identical to the validated v2 lite).

## Build

Two stages — build the base once, then bolt this layer on (rootless on Anvil; no
`/etc/subuid` needed — apptainer 1.4 uses a root-mapped namespace + fakeroot for
`%post`; build host needs outbound HTTPS for micromamba):

```bash
# Stage 1 — base (once): build the lite env and place wbm_v2_lite.sif on Anvil
cd images/wbm-v2-lite && ./deploy_to_anvil.sh        # docker -> SIF at apps/wbm/v2-lite/

# Stage 2 — this layer (slim, recommended)
cd images/wbm-v2-lite-s3
apptainer build --fakeroot wbm_v2_lite_s3.sif wbm_v2_lite_s3.def
```

The slim `%post` installs `libgdal-core` + the netCDF/HDF5 plugins + PROJ 9 via
micromamba, strips build cruft, bakes the custom-CRS init file, writes the
`Alien::gdal` shim, and symlinks the gdal CLI over `/usr/local/bin` (WBM's
`RIMS.conf` hardcodes that path). For the heavier full-`gdal` build, swap in
`wbm_v2_lite_s3_full.def`.

## Run (direct S3 reads)

The model code is bind-mounted (env-only container). Apply
[`patches/wbm_s3_direct.md`](patches/wbm_s3_direct.md) to a copy of the snapshot
`model/`+`utilities/`, redirect the dataset descriptors' `File_Path` to
`/vsicurl/https://s3.anvil.rcac.purdue.edu/openghm/...`, and keep the small
Perl-read config (descriptors, Magic Table) and outputs local:

```bash
singularity exec -c -e --pwd / \
  -B $WORK/code/model:/wbm/model -B $WORK/code/utilities:/wbm/utilities \
  -B $WORK/data:/wbm/data            # descriptors only when ALL inputs are on S3 \
  -B $SNAP/data_init:/wbm/data_init -B $SNAP/gdal_test_files:/wbm/gdal_test_files \
  -B $WORK/wbm_init:/wbm/wbm_init \
  -B $WORK/spool:/wbm/spool -B $WORK/wbm_output:/wbm/wbm_output \
  -B $WORK/WBM_run_state:/wbm/WBM_run_state \
  wbm_v2_lite_s3.sif /wbm/model/wbm.pl -v /wbm/wbm_init/<run>.init
```

**Validated end-to-end** (see *Performance* for the full year): WBM writes
`wbm_output/.../daily/wbm_2000.nc` (runoff, discharge, streamAge) with forcing
fetched live from S3 — no daily climate file exists locally.

## Slim vs full

`wbm_v2_lite_s3.def` (recommended) builds on `libgdal-core` instead of the full
`gdal` package, dropping the Python 3 bindings, NumPy and the OpenBLAS/LAPACK stack
`gdal` pulls in, plus headers, static libs, cmake, the compiler sysroot, man/doc,
and locales. `wbm_v2_lite_s3_full.def` keeps the full `gdal` (use only if you need
the in-container GDAL Python bindings).

| | full (`…_full`) | slim (recommended) |
|---|---|---|
| `/opt/gdal` (uncompressed) | ~1.3 GB | **~240 MB** |
| SIF | 489 MB | **376 MB** |
| GDAL layer over the lite base | ~170 MB | **~56 MB** |
| Python / NumPy / BLAS | present | **removed** |
| GDAL / netCDF / HDF5 / PROJ | 3.10.3 / plugins / 9.x | same |

The SIF floor is the frozen ~320 MB `wbm_v2_lite` base (Ubuntu 20.04 / perl 5.30 /
PDL 2.063 / FFI stack), deliberately left untouched — so 376 MB is the GDAL layer
essentially minimized, not a 150 MB whole-image target.

## Custom CRS migration

The stock v2 (PROJ 6) container registered WBM's custom projections by appending
`extras/proj.txt` to `/usr/share/proj/epsg`. PROJ 9 dropped the bundled `epsg`
init file but **still honors `+init=epsg:<CODE>`** when an `epsg` init file is
present in `PROJ_DATA`. `extras/proj_epsg_custom` is that file (baked to
`/opt/gdal/share/proj/epsg` by the def), restoring the original behavior.

Verified inside the slim SIF — real `gdalwarp` reprojection succeeds for all six
codes (`8000/8001/8002` WRF, `7703` Pnet, `7704` NDFD-Alaska, `900918`
sinusoidal). Full PROJ.4 strings (e.g. the `8001` string WBM bakes into
`GDAL_test`) also resolve natively with no init file.

> **Latent bug surfaced & fixed:** `7704` was defined with both `+lat_ts=60` and
> `+k=90` — contradictory for Polar Stereographic (`k=90` is not a real scale
> factor). PROJ 6 silently tolerated it; PROJ 9 rejects it. Corrected to
> `+lat_ts=60` only (the NDFD Alaska standard parallel).

## Validation vs the stock 1.9 GB container

Checked against the original `wbm_opensource_v2.0.0.sif` (1.9 GB, GDAL 3.4.3) —
itself an environment container with the same bind-mounted-model design. Running
the **identical** patched model code and the **identical** S3 inputs through both:

- **Output is bit-for-bit identical.** All `runoff` / `discharge` / `streamAge`
  bands (every time step) have matching GDAL checksums. The only difference
  between the two `wbm_2000.nc` files (120 bytes) is the GDAL / netCDF version
  strings stamped into `NC_GLOBAL` metadata — no data difference.
- Both run on perl 5.30 + `Geo::GDAL::FFI 0.09`; both register the netCDF/HDF5
  GDAL drivers. `v2-lite-s3` reproduces the original's science at ~1/5 the size
  and reads its forcing directly from S3.

Incidental finding: GDAL **3.4.3 in the original 1.9 GB container already reads
`/vsicurl` netCDF with georeferencing** (and has its own CA bundle that works
under `-c`). The upgrade was required because the *lite* base shipped apt **GDAL
3.0.4**, whose netCDF driver cannot — not because 3.4.3 couldn't.

## Performance: direct S3 vs local

Two back-to-back benchmarks on the Mississippi CONUS domain (186,615 network
cells), all inputs — daily MERRA2 climate, soil AWC, root depth, evwater
climatology and the network grid — read directly from S3 `/vsicurl` vs the same
inputs on Anvil's local Lustre project filesystem. Cold spool both times; slim
SIF; output bit-for-bit identical in every case.

**(a) 1-year subset** (run 2000 only, negligible spinup) — login node:

| | local (Lustre) | direct S3 |
|---|---|---|
| Wall clock | **6:54** | **7:53** |
| Overhead | — | **+59 s (~14%)** |
| Peak RSS | 648 MB | 681 MB |

**(b) Full snapshot period** (run 2000–2001 + 1-year spinup of 2000, exactly as
`wbm_test.init` specifies) — SLURM compute node `a002`, 8 cores:

| | local (Lustre) | direct S3 |
|---|---|---|
| Wall clock | **14:27** | **16:51** |
| Overhead | — | **+2:24 (~17%)** |
| MaxRSS (job) | ~856 MB | |
| Output 2000 / 2001 | 731 daily bands | 731 daily bands |

Both years × `runoff`/`discharge`/`streamAge` are **bit-for-bit identical**
between S3 and local. The slightly higher overhead in (b) is expected — the
1-year spinup adds cold first-reads, raising the share of HTTP-latency-bound work.

**Verified on a compute node** (`a002` → S3 `HTTP 200`): direct `/vsicurl` works
from SLURM batch jobs, not just login nodes — no pre-staging step needed.

Reading forcing straight from object storage costs ~14–17% wall-clock over a local
Lustre copy, while **eliminating the bulk pre-staging step entirely** (otherwise
hundreds of MB of daily climate copied per model-year before the run can start).
`/vsicurl` fetches only the byte ranges each daily grid needs (≈3 range GETs per
864 KB file), so the win grows with snapshot size and one-shot/subset runs; the
overhead is the per-file HTTP-latency tax for repeated reads. All inputs being
remote also means the model needs **no populated `/wbm/data` filesystem** — only
the small Perl-read descriptors/Magic-Table and the output dir are local. For
unattended production, tune retries/cache first — see *Production hardening*.

> **Scope note:** these are the snapshot's *test* configs (`runoff`/`discharge`/
> `streamAge` only, no irrigation/reservoirs/glaciers/DIN). The snapshot's bundled
> reference run (`wbm_output/wbm_short_standard/`) is a 154-cell Merrimack case
> that took ~5 min on a workstation in 2021. A full-component global production run
> is a much larger workload (hours+) and is not represented here; the S3 overhead
> ratio shrinks as compute comes to dominate IO.

## Production hardening

Direct S3 is validated for correctness, but unattended production jobs should add
retry/timeout, range-caching, an access-policy decision, and a hybrid
`direct`/`staged` toggle. See **[PRODUCTION_HARDENING.md](PRODUCTION_HARDENING.md)**
for the full checklist (applies to both `v1-lite-s3` and `v2-lite-s3`).

## Caveats / known differences

- **CA certificates under `apptainer -c` (contain):** conda libcurl has no system
  CA bundle in contain mode → HTTPS fails (`HTTP code 0`). The def sets
  `SSL_CERT_FILE`/`CURL_CA_BUNDLE=/opt/gdal/ssl/cacert.pem` to fix this. Required.
- **GDAL 3.10 ≠ 3.0.4 for non-epsg:4326 inputs.** WRF / Lambert-Conformal NetCDF
  (curvilinear `XLONG/XLAT`) reads change behavior under 3.10 (geographic via
  geolocation arrays vs. computed Lambert grid). epsg:4326 datasets are identical;
  WRF/curvilinear inputs need separate validation. Patch #6 makes the startup
  `GDAL_test` degrade gracefully rather than abort.
- **Custom CRS** (`<900918>`, `<7703>`, `<7704>`, `<8000-8002>`) — **migrated**;
  see *Custom CRS migration*. The slim `.def` bakes them in; if you build from
  `wbm_v2_lite_s3_full.def`, add the init file the same way.

## Validation artifacts (Anvil, this session)

- Built SIF: `$SCRATCH/wbmbuild/wbm_v2_lite_s3.sif` (376 MB, slim) and
  `wbm_v2_lite_s3_full.sif` (489 MB) — scratch is purgeable; copy to a durable
  apps path, e.g. `apps/wbm/v2-lite-s3/wbm_v2_lite_s3.sif`, to keep
- Run workspace: `$SCRATCH/s3run/` (patched code in `code_direct/`, S3-redirected
  descriptors in `data_s3/`, full-year outputs in `out_yrlocal/` & `out_yrs3/`)
