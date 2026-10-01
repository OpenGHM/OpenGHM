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

# Base pinned by digest: the index of `ubuntu:20.04` (a.k.a. `focal-20250404`),
# resolved 2026-10-01. The published SIF's own base digest is unrecoverable
# (lock/1.0.0.lock.json), so this is today's digest for the tag; its package set
# matches the published SIF's dpkg list except libc6, which apt below moves from
# 2.31-0ubuntu9.17 to the pinned 2.31-0ubuntu9.18 anyway. `docker buildx
# imagetools inspect ubuntu:20.04` prints this digest.
FROM ubuntu:20.04@sha256:8feb4d8ca5354def3d8fce243717141ce31e2c428701f6682bd2fafe15388214 AS base

LABEL maintainer="openghm"
LABEL description="WBM v1.0.0 lightweight ENV (no embedded code; bind snapshot model+utilities). ubuntu 20.04: GDAL 3.0.4, PROJ 6.3.1, PDL 2.063"
LABEL wbm_version="1.0.0"

ARG DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC

# --- System libs + build toolchain (focal apt) — SWIG libgdal-perl 3.0.4 ------
# build-essential + libinline-c-perl are kept so the bound utilities that use
# Inline::Pdlpp (e.g. networkTools) can compile their kernels at run time, and
# so PDL/CPAN modules build below.
# apt reads a dated snapshot of the Ubuntu archive (snapshot.ubuntu.com), not
# archive.ubuntu.com, and every package this recipe names is pinned to the
# version in lock/1.0.0.dpkg.txt; their dependencies resolve to whatever the
# snapshot holds, which reproduces the rest of that list. 20260608T000000Z is
# the day the published SIF was built (focal's archive has been frozen since its
# standard support ended, so any later date resolves the same).
# The base ships no CA bundle, and snapshot.ubuntu.com serves only https: the
# first apt call therefore skips peer verification just to fetch the pinned
# ca-certificates; package integrity still rests on apt's signature check of
# the archive's Release file, which does not depend on the transport.
RUN printf '%s\n' \
      'deb https://snapshot.ubuntu.com/ubuntu/20260608T000000Z/ focal main restricted universe multiverse' \
      'deb https://snapshot.ubuntu.com/ubuntu/20260608T000000Z/ focal-updates main restricted universe multiverse' \
      'deb https://snapshot.ubuntu.com/ubuntu/20260608T000000Z/ focal-security main restricted universe multiverse' \
      > /etc/apt/sources.list \
 && printf '%s\n' 'Acquire::Check-Valid-Until "false";' 'Acquire::Retries "5";' \
      > /etc/apt/apt.conf.d/99snapshot \
 && apt-get -o Acquire::https::Verify-Peer=false update \
 && apt-get -o Acquire::https::Verify-Peer=false install -y --no-install-recommends \
      ca-certificates=20240203~20.04.1 \
 && apt-get update && apt-get install -y --no-install-recommends \
      tzdata=2025b-0ubuntu0.20.04.1 \
      perl=5.30.0-9ubuntu0.5 \
      cpanminus=1.7044-1 \
      wget=1.20.3-1ubuntu2.1 \
      build-essential=12.8ubuntu1.1 \
      pkg-config=0.29.1-0ubuntu4 \
      libio-socket-ssl-perl=2.067-1 \
      libnet-ssleay-perl=1.88-2ubuntu1 \
      libinline-c-perl=0.81-1 \
      libgdal-perl=3.0.4+dfsg-1build3 \
      gdal-bin=3.0.4+dfsg-1build3 \
      libgdal-dev=3.0.4+dfsg-1build3 \
      netcdf-bin=1:4.7.3-1 \
      libnetcdf-dev=1:4.7.3-1 \
      nco=4.9.1-1build2 \
      proj-bin=6.3.1-1 \
      proj-data=6.3.1-1 \
      libproj-dev=6.3.1-1 \
      libgsl-dev=2.5+dfsg-6+deb10u1build0.20.04.1 \
      libcgi-pm-perl=4.46-1 \
      libtime-parsedate-perl=2015.103-3 \
      libfile-tee-perl=0.07-2 \
      libparallel-forkmanager-perl=2.02-1 \
      libmath-vecstat-perl=0.08-2 \
      libclone-perl=0.43-2 \
      libdevel-checklib-perl=1.14-1 \
 && rm -rf /var/lib/apt/lists/*

# --- PDL 2.063 from CPAN (wbm.pl hard-guards >= 2.063; prod shipped exactly this).
# Fetch the exact tarball by URL (cpanm metadb SSL-redirects fail for old pins)
# and check its sha256.
# Every other CPAN distribution is pinned by version (`Module@version`, resolved
# by cpanm through MetaCPAN). The first RUN lists the build-time dependencies
# cpanm would otherwise resolve to their latest release; the versions are the
# ones found in the published SIF's /usr/local (.pm $VERSION), so the set
# matches it.
RUN cpanm --notest ExtUtils::MakeMaker@7.78 ExtUtils::Depends@0.8002 \
      Convert::UU@0.5201 File::Map@0.71 Sub::Exporter::Progressive@0.001013 \
      Term::ReadKey@2.38 || (cat ~/.cpanm/build.log; false)
RUN wget -q -O /tmp/PDL-2.063.tar.gz \
      https://cpan.metacpan.org/authors/id/E/ET/ETJ/PDL-2.063.tar.gz \
 && echo "b4a0ccaec8442b5f2853cd882c612a9477be038c65281cf4f0bbfd335b2f7a4f  /tmp/PDL-2.063.tar.gz" | sha256sum -c - \
 && cpanm --notest /tmp/PDL-2.063.tar.gz || (cat ~/.cpanm/build.log; false)
RUN rm -f /tmp/PDL-2.063.tar.gz
RUN cpanm --notest PDL::NetCDF@4.25 || (cat ~/.cpanm/build.log; false)

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
