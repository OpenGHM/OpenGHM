#!/bin/bash
# Runs INSIDE the wbm-lite container. Validates that every Perl module each of
# the three utility scripts pulls in actually loads, that the scripts compile,
# and that they print usage.
set -u
fail=0

echo "############ 1. Perl module load test ############"
# Union of modules used by networkTools / spatial_aggregation.pl /
# temporal_aggregation.pl and their transitive WBM deps (RIMS, RIMS::WBM).
perl -e '
use strict; use warnings;
my @mods = qw(
  Benchmark Getopt::Long File::Basename File::Path File::Temp FileHandle
  List::Util Math::Trig Fcntl Storable POSIX Cwd Sys::Hostname Data::Dumper
  CGI Time::JulianDay Time::DaysInMonth Parallel::ForkManager File::Copy
  PDL PDL::Char PDL::Image2D PDL::Math PDL::NiceSlice PDL::IO::FlexRaw
  PDL::NetCDF PDL::GSL::MROOT
  Geo::GDAL::FFI
);
my $bad = 0;
for my $m (@mods) {
    eval "require $m; 1" or do { print "  FAIL  $m: $@\n"; $bad++; next };
    print "  ok    $m\n";
}
exit($bad ? 1 : 0);
' || fail=1

echo
echo "############ 2. RIMS / RIMS::WBM (embedded WBM libs) ############"
perl -e 'use lib "/wbm/model"; use RIMS; use RIMS::WBM; print "  ok    RIMS + RIMS::WBM\n"' || fail=1

echo
echo "############ 3. GDAL FFI <-> system libgdal ############"
perl -e 'use Geo::GDAL::FFI; print "  ok    GDAL ", Geo::GDAL::FFI::GetVersionInfo("RELEASE_NAME"), "\n"' || fail=1

echo
echo "############ 4. perl -c (compile) each utility script ############"
for s in networkTools spatial_aggregation.pl temporal_aggregation.pl; do
    if perl -c /wbm/utilities/$s 2>/tmp/c.log; then
        echo "  ok    $s syntax"
    else
        echo "  FAIL  $s:"; cat /tmp/c.log; fail=1
    fi
done

echo
echo "############ 5. usage (-h) for each script ############"
for s in networkTools spatial_aggregation.pl temporal_aggregation.pl; do
    out=$(/wbm/utilities/$s -h 2>&1)
    if echo "$out" | grep -qiE "usage|INIT_FILE|DATA_CODE|SRC_DATA_CODE"; then
        echo "  ok    $s prints usage"
    else
        echo "  FAIL  $s usage:"; echo "$out" | head; fail=1
    fi
done

echo
echo "############ 6. Inline::Pdlpp cache present (no runtime compile) ############"
if find /wbm/utilities/_Inline -name '*.so' 2>/dev/null | grep -q .; then
    echo "  ok    baked Inline .so: $(find /wbm/utilities/_Inline -name '*.so')"
else
    echo "  FAIL  no baked Inline cache"; fail=1
fi

echo
echo "############ 7. external GDAL/proj binaries on PATH ############"
for b in gdalinfo ogr2ogr gdal_rasterize gdal_translate; do
    p=$(command -v $b) && echo "  ok    $b -> $p" || { echo "  FAIL  $b missing"; fail=1; }
done

echo
[ $fail -eq 0 ] && echo "==== ALL SMOKE CHECKS PASSED ====" || echo "==== SMOKE FAILURES PRESENT ===="
exit $fail
