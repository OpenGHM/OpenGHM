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

FROM debian:bookworm-slim AS base

LABEL maintainer="openghm"
LABEL description="Lightweight WBM utilities (networkTools, spatial/temporal aggregation)"

ARG DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8

# --- System + scientific Perl stack (apt only) -------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
      perl cpanminus \
      build-essential pkg-config ca-certificates \
      pdl \
      libinline-c-perl \
      libpdl-netcdf-perl \
      gdal-bin libgdal-dev \
      netcdf-bin libnetcdf-dev \
      proj-bin proj-data \
      libgsl-dev \
      libcgi-pm-perl \
      libtime-parsedate-perl \
      libparallel-forkmanager-perl \
      libmath-vecstat-perl \
      libclone-perl \
      libdevel-checklib-perl \
      libffi-platypus-perl \
 && rm -rf /var/lib/apt/lists/*

# --- Alien::gdal shim + Geo::GDAL::FFI ---------------------------------------
# The shim points Geo::GDAL::FFI at the system libgdal (apt). It pulls only
# pure-perl PkgConfig + the apt FFI::Platypus — no compilers/git/cmake.
COPY extras/Alien_gdal_stub.pm /usr/local/share/perl/5.36.0/Alien/gdal.pm
RUN cpanm --notest Geo::GDAL::FFI || (cat ~/.cpanm/build.log; false)

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
