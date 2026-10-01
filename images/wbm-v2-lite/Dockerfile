# =============================================================================
# WBM v2.0.0 — lightweight ENVIRONMENT container  (bit-identical to prod-2.0.0)
#
# Like the ORIGINAL production v2 SIF, this image ships ONLY the runtime
# environment — NO embedded code. wbm.pl, RIMS, and the utility scripts are
# bind-mounted from the snapshot at run time (the original `run_wbm` workflow:
# -B <snap>/model:/wbm/model -B <snap>/utilities:/wbm/utilities).
#
# BASE = ubuntu:20.04 (perl 5.30) so the snapshot's prebuilt Inline cache
# (model/_Inline, config-…-5.030000) loads READ-ONLY with no recompile — prod
# v2 is also perl 5.30. PROJ 6.3.1 also matches prod v2; GDAL is 3.0.4 here vs
# prod's 3.4.3, which is immaterial for the standard (glacier-free, epsg:4326)
# config — verified maxabs=0 even across 3.2.2/3.4.3 (see docs §13). A v2 run
# that exercises version-sensitive regridding is NOT covered (no stock base
# ships prod's exact GDAL 3.4.3).
#
# v2 code uses Geo::GDAL::FFI (not SWIG), so install the PINNED, PATCHED FFI
# stack — NOT apt libgdal-perl.
#   PDL 2.063 (cpanm; wbm.pl guards >=2.063 and NiceSlice desyncs on 2.081)
#   FFI::Platypus 2.01  (1.34 silently no-ops RIMS::transform_point's OCTTransform
#                        scalar-ref writeback -> GDAL_test aborts)
#   Geo::GDAL::FFI 0.09 + double[6] patch (CPAN 0.09 declares the geotransform
#                        args double*; RIMS passes arrayrefs -> segfault under
#                        FFI 2.01. Prod patched to double[6]; only diff vs 0.09)
#
# Dropped vs the original prod image: libreoffice, R, nedit/vim, OpenGL,
# PostgreSQL, mlocate, and the from-source GDAL/proj builds.
# =============================================================================

# Base pinned by digest: the index of `ubuntu:20.04` (a.k.a. `focal-20250404`),
# resolved 2026-10-01. The published SIF's own base digest is unrecoverable
# (lock/2.0.0.lock.json), so this is today's digest for the tag; its package set
# matches the published SIF's dpkg list except libc6, which apt below moves from
# 2.31-0ubuntu9.17 to the pinned 2.31-0ubuntu9.18 anyway. `docker buildx
# imagetools inspect ubuntu:20.04` prints this digest.
FROM ubuntu:20.04@sha256:8feb4d8ca5354def3d8fce243717141ce31e2c428701f6682bd2fafe15388214 AS base

LABEL maintainer="openghm"
LABEL description="WBM v2.0.0 lightweight ENV (no embedded code; bind snapshot model+utilities). ubuntu 20.04: PROJ 6.3.1, PDL 2.063, Geo::GDAL::FFI 0.09"
LABEL wbm_version="2.0.0"

ARG DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC

# --- System libs + build toolchain (focal apt) — NO libgdal-perl (v2 uses FFI).
# build-essential + libinline-c-perl kept for runtime Inline compile of bound
# utilities and to build the PDL/FFI CPAN stack below.
# apt reads a dated snapshot of the Ubuntu archive (snapshot.ubuntu.com), not
# archive.ubuntu.com, and every package this recipe names is pinned to the
# version in lock/2.0.0.dpkg.txt; their dependencies resolve to whatever the
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

# --- PDL 2.063 from CPAN ------------------------------------------------------
# Every CPAN distribution is pinned by version (`Module@version`, resolved by
# cpanm through MetaCPAN) or by URL plus sha256. The first line of each RUN
# below lists the build-time dependencies cpanm would otherwise resolve to
# their latest release; the versions are the ones found in the published SIF's
# /usr/local (perllocal / .pm $VERSION), so the set matches it.
RUN cpanm --notest ExtUtils::MakeMaker@7.78 ExtUtils::Depends@0.8002 \
      Convert::UU@0.5201 File::Map@0.71 Sub::Exporter::Progressive@0.001013 \
      Term::ReadKey@2.38 || (cat ~/.cpanm/build.log; false)
RUN wget -q -O /tmp/PDL-2.063.tar.gz \
      https://cpan.metacpan.org/authors/id/E/ET/ETJ/PDL-2.063.tar.gz \
 && echo "b4a0ccaec8442b5f2853cd882c612a9477be038c65281cf4f0bbfd335b2f7a4f  /tmp/PDL-2.063.tar.gz" | sha256sum -c - \
 && cpanm --notest /tmp/PDL-2.063.tar.gz || (cat ~/.cpanm/build.log; false)
RUN rm -f /tmp/PDL-2.063.tar.gz
RUN cpanm --notest PDL::NetCDF@4.25 || (cat ~/.cpanm/build.log; false)

# --- FFI binding stack PINNED + PATCHED to production versions ---------------
RUN cpanm --notest Capture::Tiny@0.50 FFI::CheckLib@0.31 File::Which@1.27 \
      File::chdir@0.1011 Mozilla::CA@20250602 Path::Tiny@0.150 PkgConfig@0.26026 \
      YAML@1.31 Alien::Build@2.84 Alien::Build::Plugin::Download::GitHub@0.10 \
      Alien::FFI@0.27 || (cat ~/.cpanm/build.log; false)
RUN wget -q -O /tmp/FFI-Platypus-2.01.tar.gz \
      https://cpan.metacpan.org/authors/id/P/PL/PLICEASE/FFI-Platypus-2.01.tar.gz \
 && echo "729a0e1c2ff52933982b8cde74be7e9238bfe387f979447477b6e496524f9fd5  /tmp/FFI-Platypus-2.01.tar.gz" | sha256sum -c - \
 && cpanm --notest /tmp/FFI-Platypus-2.01.tar.gz && rm -f /tmp/FFI-Platypus-2.01.tar.gz
RUN cpanm --notest Alien::Base::Wrapper@2.84 || (cat ~/.cpanm/build.log; false)
COPY extras/Alien_gdal_stub.pm /wbm/perllib/Alien/gdal.pm
RUN wget -q -O /tmp/Geo-GDAL-FFI-0.09.tar.gz \
      https://cpan.metacpan.org/authors/id/A/AJ/AJOLMA/Geo-GDAL-FFI-0.09.tar.gz \
 && echo "f194a22ec4723028283ab8d328cf3bdacc5f5ba2f81cb92dd0131cc776c97885  /tmp/Geo-GDAL-FFI-0.09.tar.gz" | sha256sum -c - \
 && PERL5LIB=/wbm/perllib cpanm --notest /tmp/Geo-GDAL-FFI-0.09.tar.gz \
 && rm -f /tmp/Geo-GDAL-FFI-0.09.tar.gz || (cat ~/.cpanm/build.log; false)
RUN F=$(PERL5LIB=/wbm/perllib perl -MGeo::GDAL::FFI -e 'print $INC{"Geo/GDAL/FFI.pm"}') \
 && perl -i -pe "s/'GDALInvGeoTransform' => \[qw\/double\* double\*\//'GDALInvGeoTransform' => [qw\/double[6] double[6]\//" "$F" \
 && perl -i -pe "s/'GDALApplyGeoTransform' => \[qw\/double\* double double/'GDALApplyGeoTransform' => [qw\/double[6] double double/" "$F" \
 && grep -q 'GDALInvGeoTransform. => \[qw/double\[6\] double\[6\]' "$F" \
 && echo "patched GGF geotransform attaches: $F"

# --- Patched PDL::IO::FlexRaw (in place) -------------------------------------
RUN FR=$(perl -MPDL::IO::FlexRaw -e 'print $INC{"PDL/IO/FlexRaw.pm"}') \
 && perl -0777 -i -pe 's/(\t*print \$h join\("\\n",\$_->\{Type\},)/\t        \$_->{BadValue} = q{} if \$_->{BadFlag} && !defined(\$_->{BadValue});\n$1/' "$FR" \
 && echo "FlexRaw checked/patched: $FR"

# --- Custom CRS into proj's epsg file ----------------------------------------
COPY extras/proj.txt /wbm/proj/proj.txt
RUN cat /wbm/proj/proj.txt >> /usr/share/proj/epsg

# --- Silence one noisy (non-fatal) FFI::Platypus warning from transform_point.
COPY extras/WBMQuiet.pm /wbm/perllib/WBMQuiet.pm

# --- Mount points + conf symlinks (DANGLING until the snapshot model is bound).
RUN mkdir -p /wbm/model /wbm/utilities \
 && ln -sf /wbm/model/RIMS.conf /etc/RIMS.conf \
 && ln -sf /wbm/model/WBM.conf  /etc/WBM.conf

ENV PERL5LIB=/wbm/model:/wbm/perllib
ENV PERL5OPT=-MWBMQuiet
ENV PATH=/wbm/model:/wbm/utilities:${PATH}
ENV GDAL_DATA=/usr/share/gdal
ENV PROJ_LIB=/usr/share/proj
ENV PROJ_DATA=/usr/share/proj
ENV GDAL_NETCDF_IGNORE_XY_AXIS_NAME_CHECKS=YES
# No PERL_INLINE_DIRECTORY: Inline uses the bound /wbm/model/_Inline (perl-5.30 .so).

WORKDIR /wbm
