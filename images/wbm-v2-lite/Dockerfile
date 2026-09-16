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

FROM ubuntu:20.04 AS base

LABEL maintainer="openghm"
LABEL description="WBM v2.0.0 lightweight ENV (no embedded code; bind snapshot model+utilities). ubuntu 20.04: PROJ 6.3.1, PDL 2.063, Geo::GDAL::FFI 0.09"
LABEL wbm_version="2.0.0"

ARG DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC

# --- System libs + build toolchain (focal apt) — NO libgdal-perl (v2 uses FFI).
# build-essential + libinline-c-perl kept for runtime Inline compile of bound
# utilities and to build the PDL/FFI CPAN stack below.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tzdata \
      perl cpanminus wget \
      build-essential pkg-config \
      libio-socket-ssl-perl libnet-ssleay-perl \
      libinline-c-perl \
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

# --- PDL 2.063 from CPAN ------------------------------------------------------
RUN wget -q -O /tmp/PDL-2.063.tar.gz \
      https://cpan.metacpan.org/authors/id/E/ET/ETJ/PDL-2.063.tar.gz \
 && cpanm --notest /tmp/PDL-2.063.tar.gz || (cat ~/.cpanm/build.log; false)
RUN rm -f /tmp/PDL-2.063.tar.gz
RUN cpanm --notest PDL::NetCDF || (cat ~/.cpanm/build.log; false)

# --- FFI binding stack PINNED + PATCHED to production versions ---------------
RUN wget -q -O /tmp/FFI-Platypus-2.01.tar.gz \
      https://cpan.metacpan.org/authors/id/P/PL/PLICEASE/FFI-Platypus-2.01.tar.gz \
 && cpanm --notest /tmp/FFI-Platypus-2.01.tar.gz && rm -f /tmp/FFI-Platypus-2.01.tar.gz
RUN cpanm --notest Alien::Base::Wrapper
COPY extras/Alien_gdal_stub.pm /wbm/perllib/Alien/gdal.pm
RUN wget -q -O /tmp/Geo-GDAL-FFI-0.09.tar.gz \
      https://cpan.metacpan.org/authors/id/A/AJ/AJOLMA/Geo-GDAL-FFI-0.09.tar.gz \
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
