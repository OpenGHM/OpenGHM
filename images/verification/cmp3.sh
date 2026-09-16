#!/bin/bash
# cmp3.sh — multi-method equivalence check across 3 WBM outputs for ONE .nc file.
#   A = stock-container  / local reads   (reference / blessed)
#   B = lite-s3 container / local reads   (isolates the GDAL upgrade)
#   C = lite-s3 container / S3   reads    (isolates the object-store transport)
#
# Methods (independent, so a pass on all is strong):
#   M1 raw byte digest        sha256          (expected: B==C may match; A differs only by lib-version metadata)
#   M2 GDAL band checksum     gdalinfo -checksum per variable/band  (data fingerprint, metadata-blind)
#   M3 cdo diffn              element-wise diff: #differing-points + max abs diff per field  (the strong one)
#   M4 ncks data hash         ncks --cdl -v <var> | strip header | sha256  (independent of GDAL)
#   M5 header diff            ncdump -h, confirm ONLY version strings differ
#
# Usage: cmp3.sh <SIF_for_gdalinfo> <A.nc> <B.nc> <C.nc>
set -u
SIF=$1; A=$2; B=$3; C=$4
G(){ singularity exec -e "$SIF" gdalinfo "$@" 2>/dev/null; }

echo "############################################################"
echo "# FILE: $(basename "$A")"
echo "#  A stock   : $A"
echo "#  B lite-loc: $B"
echo "#  C lite-s3 : $C"
echo "############################################################"
for f in "$A" "$B" "$C"; do [ -f "$f" ] || { echo "MISSING: $f"; exit 2; }; done

echo "--- sizes ---"; ls -l "$A" "$B" "$C" | awk '{print $5"\t"$NF}'

echo
echo "=== M1: raw sha256 (whole file) ==="
sha256sum "$A" "$B" "$C" | awk '{print $1"  "$2}'

echo
echo "=== discover variables ==="
VARS=$(G "$A" | sed -n 's/.*SUBDATASET_[0-9]*_NAME=NETCDF:[^:]*:\(.*\)/\1/p' | sort -u)
[ -z "$VARS" ] && VARS=$(ncks --trd -m "$A" 2>/dev/null | sed -n 's/^\([A-Za-z0-9_]*\): type.*/\1/p' | grep -viE '^(lon|lat|time|crs|x|y|spatial_ref)$')
echo "vars: $(echo $VARS | tr '\n' ' ')"

echo
echo "=== M2: GDAL band-checksum per variable (metadata-blind data fingerprint) ==="
m2fail=0
for v in $VARS; do
  ca=$(G -checksum "NETCDF:$A:$v" | grep -i checksum | md5sum | cut -d' ' -f1)
  cb=$(G -checksum "NETCDF:$B:$v" | grep -i checksum | md5sum | cut -d' ' -f1)
  cc=$(G -checksum "NETCDF:$C:$v" | grep -i checksum | md5sum | cut -d' ' -f1)
  if [ "$ca" = "$cb" ] && [ "$cb" = "$cc" ]; then st="IDENTICAL (A=B=C)"; else st="DIFFER  A=$ca B=$cb C=$cc"; m2fail=1; fi
  printf "  %-22s %s\n" "$v" "$st"
done
echo "  M2 verdict: $([ $m2fail = 0 ] && echo ALL-IDENTICAL || echo MISMATCH)"

echo
echo "=== M3: cdo diffn (element-wise; nrecs differing + max abs diff) ==="
if command -v cdo >/dev/null; then
  for pair in "A:B:$A:$B" "A:C:$A:$C" "B:C:$B:$C"; do
    IFS=: read -r la lb fa fb <<<"$pair"
    out=$(cdo -s diffn "$fa" "$fb" 2>/dev/null)
    n=$(echo "$out" | grep -cE '[0-9]')
    if [ -z "$out" ]; then echo "  $la vs $lb : IDENTICAL (0 differing fields)";
    else echo "  $la vs $lb : $(echo "$out" | tail -1)"; echo "$out" | sed 's/^/      /' | head -3; fi
  done
else echo "  cdo not on PATH (module load cdo)"; fi

echo
echo "=== M4: ncks data-only sha256 per variable (GDAL-independent) ==="
m4fail=0
for v in $VARS; do
  ha=$(ncks --trd -H -v "$v" "$A" 2>/dev/null | sha256sum | cut -d' ' -f1)
  hb=$(ncks --trd -H -v "$v" "$B" 2>/dev/null | sha256sum | cut -d' ' -f1)
  hc=$(ncks --trd -H -v "$v" "$C" 2>/dev/null | sha256sum | cut -d' ' -f1)
  [ -z "$ha" ] && continue
  if [ "$ha" = "$hb" ] && [ "$hb" = "$hc" ]; then st="IDENTICAL"; else st="DIFFER ($ha/$hb/$hc)"; m4fail=1; fi
  printf "  %-22s %s\n" "$v" "$st"
done
echo "  M4 verdict: $([ $m4fail = 0 ] && echo ALL-IDENTICAL || echo MISMATCH)"

echo
echo "=== M5: header diff (expect ONLY GDAL/NETCDF version strings to differ) ==="
ncdump -h "$A" > /tmp/_hA.$$ 2>/dev/null; ncdump -h "$C" > /tmp/_hC.$$ 2>/dev/null
echo "  A-vs-C header diff lines:"; diff /tmp/_hA.$$ /tmp/_hC.$$ | grep -E '^[<>]' | head -20
rm -f /tmp/_hA.$$ /tmp/_hC.$$
echo
