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
| `wbm-v2-lite/` | **v2-lite** | `ubuntu:20.04` | full model `wbm.pl` + utilities, WBM **2.0.0** — **bit-identical** to prod-2.0.0 | `…/apps/wbm/v2-lite/wbm_v2_lite.sif` |
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

## What the Dockerfiles pin

The three Dockerfile images pin every input they can
([ADR 0004](../docs/decisions/0004-store-images-not-rebuild.md)); each recipe is
written from the committed lock record
(`<name>/lock/<version>.dpkg.txt` and `.lock.json`), not from memory:

- **Base** by digest: `FROM image:tag@sha256:…`, with the date it was resolved
  in a comment. The published SIFs' own base digest is unrecoverable, so for
  `ubuntu:20.04` it is today's digest for the tag, and for `wbm-tools-lite` it
  is the dated tag `debian:bookworm-20260518-slim`, the one whose base packages
  match the published SIF's dpkg list. Neither is a proven identity.
- **apt** from a dated snapshot mirror (`snapshot.ubuntu.com` or
  `snapshot.debian.org`), not the live archive, with every package the recipe
  names written as `package=version`. Their dependencies resolve to whatever
  the snapshot holds. The timestamp is in each Dockerfile.
- **CPAN** as `Module@version`, or an exact tarball URL checked against a
  sha256, for every distribution the build installs, including the ones
  `cpanm` would otherwise pull in as dependencies.

Pinning does not make a rebuild the published image (ADR 0004): `apptainer
build` stamps its own times into the squashfs, so the SIF digest differs
between builds. What it does is make the *contents* repeatable, and that is
checked: build, then compare the package list with the lock.

```bash
docker build --platform linux/amd64 -t wbm-v2-lite-pinned:check wbm-v2-lite
docker run --rm --platform linux/amd64 wbm-v2-lite-pinned:check \
  dpkg-query -W -f '${binary:Package}\t${Version}\n' | sort \
  | diff - <(sort wbm-v2-lite/lock/2.0.0.dpkg.txt)      # empty = the lock
```

The lock lists `${binary:Package}` (`libc6:amd64`), not `${Package}`. The same
comparison through SLURM, on the SIF `apptainer` builds from that image, is
`verification/check_pinned_recipe.slurm`; it writes only under scratch and never
touches a deployed SIF.

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
version-string false differences. `reproduce_v2.slurm`'s own netCDF step still uses
`ncdump -p` and reports every file as differing for exactly that reason (its
spool step is sound). `control_v1.slurm`'s `datacmp` counts a variable
missing from either side as bit-identical, and it checks only one daily
file. The strict comparison is `verification/nc_datacmp.pl <a.nc> <b.nc>`.
For every non-`crs` variable in both files it reports maxabs and
fill-mask mismatches, prints `UNREADABLE`/`SHAPE` rather than skipping,
and lists variables present on one side only. Run it inside a lite SIF, e.g.
`singularity exec -e <sif> perl nc_datacmp.pl a.nc b.nc`.

Across images, in `verification/`: `nc_datacmp.pl` above, and ten scripts that run a basin through two or
three SIFs and compare the results — stock against lite, lite against
direct-S3, for both Global and Wyoming. They address the SIFs by their
**deployed** Anvil path, so they run on Anvil against what is installed there,
not against anything in this directory.
