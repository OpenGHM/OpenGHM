# =============================================================================
# WBM utilities — lightweight container
#
# Provides exactly the runtime for the three WBM utility scripts:
#   /wbm/utilities/networkTools
#   /wbm/utilities/spatial_aggregation.pl
#   /wbm/utilities/temporal_aggregation.pl
#
# Design vs. the original ubuntu:20.04 image (~1.9 GB):
#   * debian:bookworm-slim base (alpine/musl breaks the PDL+GDAL XS/Inline stack)
#   * PDL / GDAL / netCDF / proj / GSL all from apt — NO source builds
#   * Scripts use Geo::GDAL::FFI (not the old SWIG Geo::GDAL), so any modern
#     libgdal works; we link the apt libgdal via a tiny Alien::gdal shim,
#     avoiding the Alien::patchelf -> Alien::Build::Git -> git / cmake chain.
#   * Dropped entirely: libreoffice, R, nedit/vim, OpenGL (freeglut/libxi/libxmu),
#     PostgreSQL, mlocate, and the from-source GDAL 3.0.4 / proj 4.9.3 builds.
#   * WBM source (model + utilities + RIMS) is EMBEDDED, so no code bind mounts.
# =============================================================================

# Base pinned by digest: the index of `debian:bookworm-slim` as `bookworm-20260518-slim`
# (resolved 2026-10-01). The published SIF's own base digest is unrecoverable
# (lock/2026-05-31.lock.json); this is the dated tag whose five base packages
# that differ between tags (base-files, libgcrypt20, libgnutls30, liblzma5,
# libpcre2-8-0) match the published SIF's dpkg list, so it is the closest match
# that can be named, not a proven identity. `docker buildx imagetools inspect
# debian:bookworm-20260518-slim` prints this digest.
FROM debian:bookworm-slim@sha256:0104b334637a5f19aa9c983a91b54c89887c0984081f2068983107a6f6c21eeb AS base

LABEL maintainer="openghm"
LABEL description="Lightweight WBM utilities (networkTools, spatial/temporal aggregation)"

ARG DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8

# --- System + scientific Perl stack (apt only) -------------------------------
# apt reads a dated snapshot of the Debian archive, not deb.debian.org, so the
# versions below stay installable after the live archive moves on. 20260531T000000Z
# is the lock date (lock/2026-05-31.dpkg.txt). Every package this recipe names
# is pinned to the version in that file; their dependencies resolve to whatever
# that snapshot holds, which reproduces the rest of the list. The snapshot's
# Release files are long expired by design, hence Check-Valid-Until.
RUN rm -f /etc/apt/sources.list.d/debian.sources \
 && printf '%s\n' \
      'deb http://snapshot.debian.org/archive/debian/20260531T000000Z/ bookworm main' \
      'deb http://snapshot.debian.org/archive/debian/20260531T000000Z/ bookworm-updates main' \
      'deb http://snapshot.debian.org/archive/debian-security/20260531T000000Z/ bookworm-security main' \
      > /etc/apt/sources.list \
 && printf '%s\n' 'Acquire::Check-Valid-Until "false";' 'Acquire::Retries "5";' \
      > /etc/apt/apt.conf.d/99snapshot \
 && apt-get update && apt-get install -y --no-install-recommends \
      perl=5.36.0-7+deb12u3 \
      cpanminus=1.7046-1 \
      build-essential=12.9 \
      pkg-config=1.8.1-1 \
      ca-certificates=20230311+deb12u1 \
      pdl=1:2.081-2 \
      libinline-c-perl=0.82-1 \
      libpdl-netcdf-perl=4.24-1+b1 \
      gdal-bin=3.6.2+dfsg-1+b2 \
      libgdal-dev=3.6.2+dfsg-1+b2 \
      netcdf-bin=1:4.9.0-3+b1 \
      libnetcdf-dev=1:4.9.0-3+b1 \
      proj-bin=9.1.1-1+b1 \
      proj-data=9.1.1-1 \
      libgsl-dev=2.7.1+dfsg-5+deb12u1 \
      libcgi-pm-perl=4.55-1 \
      libtime-parsedate-perl=2015.103-4 \
      libparallel-forkmanager-perl=2.02-1 \
      libmath-vecstat-perl=0.08-3 \
      libclone-perl=0.46-1 \
      libdevel-checklib-perl=1.16-1 \
      libffi-platypus-perl=2.05-1 \
 && rm -rf /var/lib/apt/lists/*

# --- Alien::gdal shim + Geo::GDAL::FFI ---------------------------------------
# The shim points Geo::GDAL::FFI at the system libgdal (apt). It pulls only
# pure-perl PkgConfig + the apt FFI::Platypus — no compilers/git/cmake.
COPY extras/Alien_gdal_stub.pm /usr/local/share/perl/5.36.0/Alien/gdal.pm
# Pinned to the versions in the lock's cpanPins. PkgConfig and Sort::Versions are
# the dependencies of Geo::GDAL::FFI that apt does not provide.
RUN cpanm --notest PkgConfig@0.26026 Sort::Versions@1.62 Geo::GDAL::FFI@0.16 || (cat ~/.cpanm/build.log; false)

# --- Embed WBM source --------------------------------------------------------
COPY wbm/model     /wbm/model
COPY wbm/utilities /wbm/utilities

# Patched PDL::IO::FlexRaw: writeflexhdr must define BadValue when BadFlag is set.
# Apply just that one-line fix to the apt PDL (don't replace the whole module,
# which would be version-mismatched against PDL 2.081).
RUN FR=$(perl -MPDL::IO::FlexRaw -e 'print $INC{"PDL/IO/FlexRaw.pm"}') \
 && grep -q "BadValue must be defined" "$FR" || \
    perl -0777 -i -pe 's/(\t*print \$h join\("\\n",\$_->\{Type\},)/\t        \$_->{BadValue} = q{} if \$_->{BadFlag} && !defined(\$_->{BadValue});\n$1/' "$FR" \
 && echo "patched FlexRaw: $FR"

# RIMS.conf is loaded from /etc/RIMS.conf and hardcodes gdal binaries under
# /usr/local/bin; apt installs them in /usr/bin.
# RIMS.pm -> /etc/RIMS.conf, RIMS::WBM (WBM.pm) -> /etc/WBM.conf (both fall back
# to /etc when not found next to $0; networkTools lives in /wbm/utilities, not
# /wbm/model, so the symlinks are required).
RUN ln -sf /wbm/model/RIMS.conf /etc/RIMS.conf \
 && ln -sf /wbm/model/WBM.conf  /etc/WBM.conf \
 && sed -i 's|/usr/local/bin|/usr/bin|g' /wbm/model/RIMS.conf \
 && find /wbm/model /wbm/utilities \( -name '*.pl' -o -name 'networkTools' \) -exec chmod +x {} +

# Silence one noisy (non-fatal) FFI::Platypus warning from RIMS.pm transform_point.
COPY extras/WBMQuiet.pm /wbm/perllib/WBMQuiet.pm

ENV PERL5LIB=/wbm/model:/wbm/perllib
ENV PERL5OPT=-MWBMQuiet
ENV PATH=/wbm/model:/wbm/utilities:${PATH}
ENV GDAL_DATA=/usr/share/gdal
ENV PROJ_DATA=/usr/share/proj
# required for GDAL > 3.0 netCDF axis handling (WBM.pm sets this too)
ENV GDAL_NETCDF_IGNORE_XY_AXIS_NAME_CHECKS=YES
# pin the Inline::Pdlpp cache location so we can bake it at build time
ENV PERL_INLINE_DIRECTORY=/wbm/utilities/_Inline

# --- Bake the Inline::Pdlpp cache so runtime needs no compiler ----------------
# networkTools `use Inline qw/Pdlpp/` compiles its __Pdlpp__ section at load
# time; running it once here embeds the compiled .so. (-h exits non-zero after
# usage, so we verify success by the presence of a compiled object instead.)
RUN cd /wbm/utilities \
 && (./networkTools -h >/tmp/nt_bake.log 2>&1 || true) \
 && (find /wbm/utilities/_Inline -name '*.so' | grep -q . \
      && echo "Inline cache baked OK" \
      || (echo "INLINE BAKE FAILED:"; cat /tmp/nt_bake.log; false))

WORKDIR /wbm
