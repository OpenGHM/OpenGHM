# WBM container images

Lightweight Singularity/Apptainer containers that replace the heavy original
WBM images, plus the harness that verifies them. One directory per image;
`verification/` is the single exception and is not an image
(see [ADR 0010](../devdocs/decisions/0010-repository-layout.md)).

Full background, version pins and bit-identity method: `wbm_lite_container.md`
in the `toolkits` checkout, which is this directory's archive — it is not in
this repository.

## The five images

| Dir | Image | Base | Scope | Deployed SIF (Anvil) |
|-----|-------|------|-------|----------------------|
| `wbm-v1-lite/` | **v1-lite** | `ubuntu:20.04` | full model `wbm.pl` + utilities, WBM **1.0.0** — **bit-identical** to prod-1.0.0 | `…/apps/wbm/v1-lite/wbm_v1_lite.sif` |
| `wbm-v2-lite/` | **v2-lite** | `debian:bullseye-slim` | full model `wbm.pl` + utilities, WBM **2.0.0** — **bit-identical** to prod-2.0.0 | `…/apps/wbm/v2-lite/wbm_v2_lite.sif` |
| `wbm-tools-lite/` | **tools-lite** | `debian:bookworm-slim` | the 3 utility scripts only (no model) | `…/apps/wbm/lite/wbm_tools_lite.sif` |
| `wbm-v1-lite-s3/` | **v1-lite-s3** | `wbm_v1_lite` | v1 reading NetCDF forcing directly from S3 over GDAL `/vsicurl` | `…/apps/wbm/v1-lite-s3/wbm_v1_lite_s3.sif` |
| `wbm-v2-lite-s3/` | **v2-lite-s3** | `wbm_v2_lite` | the same for v2; slim build, with a full-conda-GDAL variant beside it | `…/apps/wbm/v2-lite-s3/wbm_v2_lite_s3.sif` |

`wbm-v1-lite/` is pinned to `ubuntu:20.04` on purpose: it ships GDAL 3.0.4 /
PROJ 6.3.1 / perl 5.30 — the exact stack the v1 production SIF used — so
glacier regridding, and everything downstream of it, reproduces bit-for-bit.

## Two build styles

The first three are Dockerfile images and carry their own deploy script:

```
wbm-<name>/
├── Dockerfile            # the image definition
├── deploy_to_anvil.sh    # docker save -> scp -> apptainer build (no root on Anvil)
├── extras/               # files COPYd into the image (Alien shim, proj.txt, …)
├── run/                  # the entrypoint wrappers
└── test/                 # SLURM verification scripts for this image
```

```bash
cd wbm-v1-lite                                              # or wbm-v2-lite, wbm-tools-lite
docker build --platform linux/amd64 -t wbm-v1-full:latest .  # amd64 mandatory on Apple Silicon
./deploy_to_anvil.sh                                         # -> SIF on Anvil
```

The two `-s3` directories are Singularity recipes and have **no** deploy
script — Apptainer builds the SIF from the `.def` once the base exists:

```
wbm-<name>-s3/
├── wbm_<name>_s3.def     # the recipe; stage 1 is the base image next door
├── extras/               # proj_epsg_custom, the GDAL CLI shim
└── patches/              # model-code changes, applied to the bound snapshot
```

Each takes its base from the sibling it derives from, so build that first:

```bash
cd wbm-v1-lite && ./deploy_to_anvil.sh    # stage 1: the v1-lite base
cd ../wbm-v1-lite-s3                      # stage 2: apptainer build from the .def
```

The built SIF is self-contained — the base is squashed in — but keep the base
directory: it is the only recipe for rebuilding it.

## Publishing a built SIF

`deploy_to_anvil.sh` (or an `apptainer build` for the `-s3` recipes) only gets
the SIF onto Anvil at the "Deployed SIF" path above — it is not yet reachable
by anything outside this cluster. Publishing it to zot and the S3 mirror is a
separate step, `just publish-container <image> <version> <sif>`
(`ops/anvil/publish_container.sh`, private `ops/` repo):
[s3-layout.md](../docs/reference/s3-layout.md#publish-a-container-image) has
the full procedure. A version is never republished under the same string —
a rebuild, even byte-identical, gets a new version (rule 1).

## Verifying bit-identity against production

Per-image, in each image's own `test/`:

- `wbm-v1-lite/test/control_v1.slurm` — self-test (lite×2) plus a fresh
  prod-1.0.0 co-run; pass = spool identical and all daily vars `maxabs=0`.
  (`compare_stored_v1.slurm` is the full Wyoming run against the stored golden,
  ~6 h.)
- `wbm-v2-lite/test/reproduce_v2.slurm` — fresh prod-2.0.0 against lite; pass =
  spool identical and `maxabs=0`. (`compare_v2_prodlite.slurm` adds drift
  against the stale 2021 golden.)

Verdict uses **PDL::NetCDF maxabs** with fill `-9999` masked, plus **spool
sha256** — not `ncdump -p`, which reports cosmetic attribute-order and
version-string false differences.

Across images, in `verification/`: ten scripts that run a basin through two or
three SIFs and compare the results — stock against lite, lite against
direct-S3, for both Global and Wyoming. They address the SIFs by their
**deployed** Anvil path, so they run on Anvil against what is installed there,
not against anything in this directory.
