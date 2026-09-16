# =============================================================================
# WBM v1.0.0 — lightweight ENVIRONMENT container  (bit-identical to prod-1.0.0)
#
# Like the ORIGINAL production v1 SIF, this image ships ONLY the runtime
# environment — NO embedded code. wbm.pl, RIMS, and the utility scripts are
# bind-mounted from the snapshot at run time (exactly the original `run_wbm`
# workflow: -B <snap>/model:/wbm/model -B <snap>/utilities:/wbm/utilities).
#
# BASE = ubuntu:20.04 to match the production v1 numeric stack EXACTLY:
#     GDAL 3.0.4 + PROJ 6.3.1 + perl 5.30   (focal apt)   + PDL 2.063 (cpanm)
# perl 5.30 matters: the snapshot's prebuilt Inline cache (model/_Inline,
# config-…-5.030000) then loads READ-ONLY with no recompile. GDAL 3.0.4 / PROJ
# 6.3.1 reproduce glacier regridding bit-for-bit (bullseye's 3.2.2/7.2.1 did not).
#
# v1 model + utilities use the SWIG `Geo::GDAL` binding (apt libgdal-perl) — NOT
# Geo::GDAL::FFI and NOT Geo::Proj4 (verified: wbm.pl / RIMS.pm / RIMS::WBM all
# `use Geo::GDAL`). So no FFI stack and no Geo::Proj4 are installed.
#
# Dropped vs the original prod image: libreoffice, R, nedit/vim, OpenGL,
# PostgreSQL, mlocate, and the from-source GDAL/proj builds.
#
# RUN (bind code + data, like run_wbm):
#   singularity exec -c -e \
#     -B $SNAP/model:/wbm/model -B $SNAP/utilities:/wbm/utilities \
#     -B $SNAP/data/<sub>:/wbm/data -B $SNAP/data_init:/wbm/data_init \
#     -B $WORK/spool:/wbm/spool -B $WORK/wbm_output:/wbm/wbm_output ... \
#     wbm_v1_lite.sif /wbm/model/wbm.pl -v /wbm/wbm_init/<run>.init
# =============================================================================

FROM ubuntu:20.04 AS base

LABEL maintainer="openghm"
LABEL description="WBM v1.0.0 lightweight ENV (no embedded code; bind snapshot model+utilities). ubuntu 20.04: GDAL 3.0.4, PROJ 6.3.1, PDL 2.063"
LABEL wbm_version="1.0.0"

ARG DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC

# --- System libs + build toolchain (focal apt) — SWIG libgdal-perl 3.0.4 ------
# build-essential + libinline-c-perl are kept so the bound utilities that use
# Inline::Pdlpp (e.g. networkTools) can compile their kernels at run time, and
# so PDL/CPAN modules build below.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tzdata \
      perl cpanminus wget \
      build-essential pkg-config \
      libio-socket-ssl-perl libnet-ssleay-perl \
      libinline-c-perl \
      libgdal-perl \
      gdal-bin libgdal-dev \
      netcdf-bin libnetcdf-dev \
      nco \
      proj-bin proj-data libproj-dev \
      libgsl-dev \
      libcgi-pm-perl \
      libtime-parsedate-perl \
      libfile-tee-perl \
      libparallel-forkmanager-perl \
      libmath-vecstat-perl \
      libclone-perl \
      libdevel-checklib-perl \
 && rm -rf /var/lib/apt/lists/*

# --- PDL 2.063 from CPAN (wbm.pl hard-guards >= 2.063; prod shipped exactly this).
# Fetch the exact tarball by URL (cpanm metadb SSL-redirects fail for old pins).
RUN wget -q -O /tmp/PDL-2.063.tar.gz \
      https://cpan.metacpan.org/authors/id/E/ET/ETJ/PDL-2.063.tar.gz \
 && cpanm --notest /tmp/PDL-2.063.tar.gz || (cat ~/.cpanm/build.log; false)
RUN rm -f /tmp/PDL-2.063.tar.gz
RUN cpanm --notest PDL::NetCDF || (cat ~/.cpanm/build.log; false)

# --- Patched PDL::IO::FlexRaw (in place): writeflexhdr must define BadValue when
#     BadFlag is set. (A library patch — independent of the bound WBM code.)
RUN FR=$(perl -MPDL::IO::FlexRaw -e 'print $INC{"PDL/IO/FlexRaw.pm"}') \
 && perl -0777 -i -pe 's/(\t*print \$h join\("\\n",\$_->\{Type\},)/\t        \$_->{BadValue} = q{} if \$_->{BadFlag} && !defined(\$_->{BadValue});\n$1/' "$FR" \
 && echo "FlexRaw checked/patched: $FR"

# --- Custom CRS (WRF 8000/8001/8002, sinu 900918, NDFD 7703/7704) into proj's
#     epsg file (proj 6.3.1 still honours +init=epsg:NNNN). Original v1 behaviour.
COPY extras/proj.txt /wbm/proj/proj.txt
RUN cat /wbm/proj/proj.txt >> /usr/share/proj/epsg

# --- Mount points + conf symlinks (DANGLING until the snapshot model is bound —
#     identical to the original prod SIF). RIMS.pm / RIMS::WBM look for their
#     config next to $0 then fall back to /etc.
RUN mkdir -p /wbm/model /wbm/utilities \
 && ln -sf /wbm/model/RIMS.conf /etc/RIMS.conf \
 && ln -sf /wbm/model/WBM.conf  /etc/WBM.conf

ENV PERL5LIB=/wbm/model
ENV PATH=/wbm/model:/wbm/utilities:${PATH}
ENV GDAL_DATA=/usr/share/gdal
ENV PROJ_LIB=/usr/share/proj
ENV PROJ_DATA=/usr/share/proj
ENV GDAL_NETCDF_IGNORE_XY_AXIS_NAME_CHECKS=YES
# No PERL_INLINE_DIRECTORY: `use Inline qw/Pdlpp/` resolves _Inline next to the
# script, i.e. the bound /wbm/model/_Inline (snapshot's prebuilt perl-5.30 .so).

WORKDIR /wbm
