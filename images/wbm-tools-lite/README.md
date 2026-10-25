# Lightweight WBM utilities container

A slim Singularity/Apptainer container that runs the three WBM utility scripts:

- `networkTools`
- `spatial_aggregation.pl`
- `temporal_aggregation.pl`

It replaces the original `ubuntu:20.04` WBM image (~1.9 GB, built from
`/anvil/projects/x-ees260008/docker_build/wbm_2021_04_16/Dockerfile`) with a
**~317 MB** `debian:bookworm-slim` image. WBM code is **embedded**, so a run binds
only data + a work directory instead of the old 9 mounts.

## Why it can be this small

The original image source-built GDAL 3.0.4 (+ SWIG Perl bindings), proj 4.9.3 and
PDL 2.018, and also installed R, LibreOffice, OpenGL, PostgreSQL, vim/nedit, etc.

The current scripts use **`Geo::GDAL::FFI`** (not the old SWIG `Geo::GDAL`), which
binds to *any* modern `libgdal` at runtime. That removes the source build and lets
the whole stack come from Debian apt:

| Need | Source |
|------|--------|
| PDL 2.081 (+ GSL, Image2D, NiceSlice, Char, Math) | apt `pdl` |
| `PDL::NetCDF` | apt `libpdl-netcdf-perl` |
| `Inline::Pdlpp` (networkTools) | apt `libinline-c-perl` + `pdl` |
| GDAL 3.6.2 lib + CLI | apt `gdal-bin libgdal-dev` |
| `Geo::GDAL::FFI` | cpanm, via a tiny `Alien::gdal` shim → system libgdal |
| `Time::JulianDay`, `Time::DaysInMonth` | apt `libtime-parsedate-perl` |
| proj / netCDF / GSL | apt `proj-bin proj-data`, `netcdf-bin`, `libgsl-dev` |

The `Alien::gdal` shim (`extras/Alien_gdal_stub.pm`) avoids the upstream
`Alien::gdal → Alien::patchelf → Alien::Build::Git → git/cmake` source-build chain;
it just points `Geo::GDAL::FFI` at the apt `libgdal`.

## Pinned inputs

Every input of the Dockerfile is pinned (see the README one level up for the
rule): the base by digest (`debian:bookworm-slim@sha256:0104b334…`, the index
of the dated tag `bookworm-20260518-slim`), apt from the
`snapshot.debian.org` mirror at `20260531T000000Z` with every named package as
`package=version`, and `PkgConfig`, `Sort::Versions` and `Geo::GDAL::FFI` as
`Module@version`. The versions come from `lock/2026-05-31.dpkg.txt` and
`lock/2026-05-31.lock.json`, so the image `docker build` produces carries the
same package list as the published SIF.

## Build (on a machine with Docker)

> Apple Silicon: the `--platform linux/amd64` flag is **mandatory** — Anvil is x86_64.

```bash
cd images/wbm-tools-lite
docker build --platform linux/amd64 -t wbm-lite:latest .
docker run --rm --platform linux/amd64 \
  -v "$PWD/test/incontainer_smoke.sh":/tmp/smoke.sh wbm-lite:latest bash /tmp/smoke.sh
```

## Deploy to Anvil (build the SIF without root)

Anvil's `x-openghm` is not in `/etc/subuid`, so `--fakeroot` def-file builds don't
work. Building a SIF **from a docker archive** needs no fakeroot (it only assembles
a squashfs from existing layers):

```bash
./deploy_to_anvil.sh
# docker save -> scp -> apptainer build docker-archive://… on the login node
# => /home/x-openghm/apps/wbm/lite/wbm_tools_lite.sif
```

## Run

Code is embedded; bind only real I/O:

```bash
SIF=/home/x-openghm/apps/wbm/lite/wbm_tools_lite.sif
singularity exec -c -e \
  -B /path/to/data:/data \
  -B /path/to/work:/work \
  $SIF /wbm/utilities/networkTools -v /work/preclip.init
```

or via the wrapper `run/wbm-tools` (`-d` → `/data`, `-D name:dir` → `/data/name`,
`-w` → `/work`):

```bash
# single data dir
run/wbm-tools -d /path/to/netdir -w /path/to/work -- \
  /wbm/utilities/networkTools -v /work/preclip.init

# multiple named data dirs (paths must match your Magic Table File_Path)
run/wbm-tools -D gt_output:/path/out -D masks:/path/masks -w /path/work -- \
  /wbm/utilities/spatial_aggregation.pl -mt /work/test.MT.csv -f /work/m.key \
  Global_tracking_runoff_y US_states_6min /work/out.nc
```

`spatial_aggregation.pl` / `temporal_aggregation.pl` still need `-mt <MagicTable.csv>`
and `spatial` needs `-f <cache.key>` (the v2 deployment lacks `DataID_DB.csv` and
`pol_key_dir`; the container does not change that).

## Tests

- `test/incontainer_smoke.sh` — module load, `perl -c`, usage, baked Inline cache.
- Local `networkTools` preclip (`test/preclip_test.init` + `test/data/05min_flwdir.tif`)
  → **120×96**, NoData 247 (matches `docs/wbm_utilities_scripts.md` §5.2 in the archived `toolkits` checkout, not in this repository).
- `test/test_lite.slurm` — full golden tests on a compute node: preclip 120×96,
  spatial 51 polygons × 10 layers, temporal 3 yearly files.

## Layout

```
wbm-tools-lite/
├── Dockerfile
├── deploy_to_anvil.sh
├── README.md
├── extras/
│   ├── Alien_gdal_stub.pm      # system-libgdal shim for Geo::GDAL::FFI
│   ├── FlexRaw.pm              # reference for the writeflexhdr BadValue patch
│   ├── proj.txt                # custom CRS defs (not applied; see notes)
│   └── Dockerfile.original     # the 2021 ubuntu:20.04 source, for reference
├── run/wbm-tools               # minimal-bind launcher
├── test/
│   ├── incontainer_smoke.sh
│   ├── preclip_test.init
│   ├── test_lite.slurm
│   └── data/05min_flwdir.tif
└── wbm/                        # embedded WBM source (model + utilities + RIMS)
```

## Notes / not carried over

- **R utilities** (`process_root_depth.R`, `test_standard.R`) are not supported —
  out of scope for the three Perl utilities. Re-add `r-base` if needed.
- **Custom proj CRS** (`extras/proj.txt`: codes 900918, 7703, …) were appended to
  proj 4's `/usr/share/proj/epsg` text file in the original. proj 9 uses `proj.db`,
  so that mechanism is gone. The three utilities operate on EPSG:4326 data and don't
  need these; if a dataset uses a custom code, register it via a proj `init` file /
  `PROJ_DATA`.
- **Image size:** the deployed SIF is ~295 MB (squashfs); the uncompressed rootfs is
  ~1.4 GB, vs. the original ~1.9 GB SIF. The bulk is the apt scientific stack
  (PDL, libgdal, perl) plus `build-essential`.
- `build-essential` is needed **only at build time** (to bake the Inline::Pdlpp
  cache and install `Geo::GDAL::FFI`). At **runtime nothing compiles**: the baked
  cache at `/wbm/utilities/_Inline` loads read-only (verified by the subset test,
  which runs every pp_def kernel), and Geo::GDAL::FFI is pure-perl FFI. Note the
  Inline dir is read-only squashfs at runtime, so there is **no** runtime-recompile
  fallback — the baked cache is the mechanism. To slim further, a multi-stage build
  that drops `build-essential` (and the `-dev` packages) from the final stage would
  cut the rootfs substantially; not done here to keep the verified image intact.
