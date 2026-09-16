#!/bin/bash
# Decompose the Global stock-vs-lite difference.
# A = out_glb_stock  (stock GDAL 3.0.4 + PRISTINE model)   reference
# B = out_glb_lloc   (lite  GDAL 3.10  + PATCHED  model)
# S = out_glb_spatch (stock GDAL 3.0.4 + PATCHED  model)   <- the control
#   A vs S : holds GDAL constant (3.0.4), swaps pristine->patched  => PATCH effect
#   S vs B : holds model constant (patched), swaps GDAL 3.0.4->3.10 => GDAL-VERSION effect
V=$SCRATCH/verify3
SIF=/home/x-openghm/apps/wbm/v1-lite-s3/wbm_v1_lite_s3.sif
A=$V/out_glb_stock/glb/daily/wbm_2000.nc
B=$V/out_glb_lloc/glb/daily/wbm_2000.nc
S=$V/out_glb_spatch/glb/daily/wbm_2000.nc
G(){ singularity exec -e "$SIF" gdalinfo "$@" 2>/dev/null; }
for f in "$A" "$B" "$S"; do [ -f "$f" ] || { echo "MISSING $f"; exit 2; }; done
VARS=$(G "$A" | sed -n 's/.*SUBDATASET_[0-9]*_NAME=NETCDF:[^:]*:\(.*\)/\1/p' | sort -u)
nAS=0; nSB=0; tot=0
echo "var                     A-vs-S(PATCH)  S-vs-B(GDAL)"
for v in $VARS; do
  ca=$(G -checksum "NETCDF:$A:$v"|grep -i checksum|md5sum|cut -d' ' -f1)
  cb=$(G -checksum "NETCDF:$B:$v"|grep -i checksum|md5sum|cut -d' ' -f1)
  cs=$(G -checksum "NETCDF:$S:$v"|grep -i checksum|md5sum|cut -d' ' -f1)
  tot=$((tot+1)); as=SAME; sb=SAME
  [ "$ca" != "$cs" ] && { as=DIFF; nAS=$((nAS+1)); }
  [ "$cs" != "$cb" ] && { sb=DIFF; nSB=$((nSB+1)); }
  printf "  %-22s %-12s %s\n" "$v" "$as" "$sb"
done
echo "SUMMARY of $tot vars:  PATCH effect (A!=S): $nAS   |   GDAL-version effect (S!=B): $nSB"
module load cdo 2>/dev/null
echo "cdo A-vs-S (patch; expect 0 differing fields if inert):"; cdo -s diffn "$A" "$S" 2>/dev/null | tail -1
echo "cdo S-vs-B (GDAL 3.0.4 vs 3.10):";                         cdo -s diffn "$S" "$B" 2>/dev/null | tail -1
