# WBM `v1-lite-s3` — direct S3 reads (`wbm_v1_lite_s3`)

The v1 counterpart of [`v2-lite-s3`](../wbm-v2-lite-s3): a WBM **v1** environment
container (plus model-code patches) that reads NetCDF forcing **directly from S3**
(Anvil's Ceph RGW) over GDAL `/vsicurl` — lazy HTTP range reads, full CF
georeferencing, no local pre-staging.

| File | What |
|---|---|
| `wbm_v1_lite_s3.def` | build recipe — bundles slim GDAL 3.10 alongside the kept SWIG GDAL 3.0.4 |
| `extras/gdalcli` | wrapper that isolates the 3.10 CLI's PROJ 9 / GDAL data dirs from the SWIG path |
| `extras/proj_epsg_custom` | custom-CRS init file (PROJ 9 migration; baked into the SIF) |
| `patches/wbm_s3_direct_v1.md` | the WBM v1 model-code changes for `/vsicurl` reads (bound code) |

## Why v1 is different from v2 — the SWIG problem

This is the crux, and it is **not** the same fix as v2:

- **v2** uses `Geo::GDAL::FFI`, which binds the libgdal **C API** (ABI-stable
  across GDAL 3.x). v2 just re-points the FFI shim at a bundled GDAL 3.10 and the
  whole stack — in-process *and* CLI — runs on 3.10.
- **v1** uses the **SWIG `Geo::GDAL`** Perl binding (apt `libgdal-perl`): a
  compiled XS module **ABI-locked** to the exact libgdal it was built against
  (3.0.4). You cannot swap libgdal underneath it, and **GDAL removed the SWIG Perl
  bindings after 3.4** — so "Geo::GDAL for 3.10" doesn't exist. The v2 approach is
  impossible here.

### The design: two GDALs side by side

| | used by | reads |
|---|---|---|
| **system libgdal 3.0.4** + `/usr/share/{gdal,proj}` (PROJ 6) — kept untouched | SWIG `Geo::GDAL` perl (in-process) | LOCAL files only: the network grid (run extent) + local warped tmp tiffs |
| **bundled GDAL 3.10** at `/opt/gdal` (libgdal-core + netCDF/HDF5 plugins + PROJ 9) | `read_GDAL`'s `gdal_translate`/`gdalwarp` CLI shellouts | the remote `/vsicurl` forcing → local tmp tiff |

`read_GDAL` already streams forcing by shelling out to the CLI and then reading the
**local** warped tiff in-process — so the remote file only ever touches the 3.10
CLI, never the 3.0.4 SWIG binding. The patches (`patches/wbm_s3_direct_v1.md`)
ensure nothing else opens a remote path in-process.

Two rules keep the coexistence safe (both verified):

1. **No `/opt/gdal/lib` on `LD_LIBRARY_PATH`** — it would shadow system libgdal
   3.0.4 and break the ABI-locked SWIG module. The 3.10 CLI finds its libs via
   RPATH, so it needs none.
2. **The CLI goes through `extras/gdalcli`**, a wrapper that sets PROJ 9 / GDAL
   3.10 data dirs per-invocation. The 3.10 CLI must not inherit the system PROJ 6
   db (it errors *"proj.db … from another PROJ installation"*), and the SWIG path
   must not see PROJ 9. `RIMS.conf` hardcodes `GDAL_path=/usr/bin`, so the wrapper
   symlinks land there.

## Base layer — `wbm_v1_lite` (built from [`../wbm-v1-lite/`](../wbm-v1-lite))

`Bootstrap: localimage` from `/home/x-openghm/apps/wbm/v1-lite/wbm_v1_lite.sif`
(Ubuntu 20.04, perl 5.30, SWIG `libgdal-perl` 3.0.4, PROJ 6.3.1, PDL 2.063).
Recipe: [`images/wbm-v1-lite/Dockerfile`](../wbm-v1-lite/Dockerfile) +
[`images/wbm-v1-lite/deploy_to_anvil.sh`](../wbm-v1-lite/deploy_to_anvil.sh). As with v2, the
built SIF is self-contained (the base is squashed in) — keep `images/wbm-v1-lite/` as
the source to rebuild, but the `wbm_v1_lite.sif` binary is droppable post-build.

## Build

```bash
cd images/wbm-v1-lite && ./deploy_to_anvil.sh        # stage 1: build the v1-lite base
cd images/wbm-v1-lite-s3
apptainer build --fakeroot wbm_v1_lite_s3.sif wbm_v1_lite_s3.def
```

## Run (direct S3 reads)

Apply `patches/wbm_s3_direct_v1.md` to a copy of the snapshot `model/`+`utilities/`,
redirect the **climate** descriptors' `File_Path` to `/vsicurl/...`, and **keep the
network grid local** (it defines the extent and is read in-process by SWIG 3.0.4).
Bind the patched code, the snapshot data (for the local network/soil), the
descriptors, and writable spool/output:

```bash
singularity exec -c -e --pwd / \
  -B $WORK/model:/wbm/model -B $WORK/utilities:/wbm/utilities \
  -B $WORK/data_init:/wbm/data_init \
  -B $SNAP/data/<domain>_tracking:/wbm/data \
  -B $SNAP/gdal_test_files:/wbm/gdal_test_files \
  -B $WORK/wbm_init:/wbm/wbm_init \
  -B $WORK/spool:/wbm/spool -B $WORK/wbm_output:/wbm/wbm_output \
  -B $WORK/WBM_run_state:/wbm/WBM_run_state \
  wbm_v1_lite_s3.sif /wbm/model/wbm.pl -v /wbm/wbm_init/<run>.init
```

## Validation

A Merrimack/Wyoming v1 run reading MERRA2 climate from S3 ran to completion and is
**bit-for-bit identical** to the same run reading the climate from the local
snapshot — `runoff` and `discharge` band checksums match. The patched-but-local
path is unchanged, confirming the patches are inert off-S3.

## Production hardening

For unattended production use (retry/timeout, range-caching, access-policy /
`/vsis3`, hybrid `direct`/`staged` toggle), see the shared checklist
**[../wbm-v2-lite-s3/PRODUCTION_HARDENING.md](../wbm-v2-lite-s3/PRODUCTION_HARDENING.md)**
— it applies to both v1 and v2.

## Caveats

- **S3 object ACLs:** not every snapshot prefix in the `openghm` bucket is
  anonymously readable. The `wbm_storage_v1.0.0_Wyoming/...` objects return **HTTP
  403** to anonymous GETs, while `wbm_storage_v2.0.0/...` returns 200. The MERRA2
  files are byte-identical across both prefixes, so validation pointed v1's
  climate at the public v2 path. Production use of a private prefix needs either a
  public-read ACL or signed/authenticated `/vsis3` access — this is a bucket
  policy matter, not a container limitation.
- **Network grid stays local** by design (in-process SWIG read). It is a one-time
  read at startup, so it has no bearing on run-time performance.
- **Per-file HTTP latency** dominates on tiny domains: a 1-month Merrimack run
  (154 cells) was ~20 s on S3 vs ~14 s local. On large domains the relative
  overhead shrinks (cf. v2's full-CONUS year at ~14%).
- **GDAL 3.10 ≠ 3.0.4 for non-epsg:4326 inputs** (WRF/curvilinear) — see patch P9.
  epsg:4326 datasets are numerically identical; the startup `GDAL_test` is skipped.
