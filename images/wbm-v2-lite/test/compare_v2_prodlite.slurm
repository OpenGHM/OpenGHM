#!/bin/bash
#SBATCH -J wbm_v2_prodlite
#SBATCH -A ees260008
#SBATCH -p shared
#SBATCH -N 1 -n 8
#SBATCH -t 00:40:00
#SBATCH -o %x_%j.out -e %x_%j.out
# -----------------------------------------------------------------------------
# v2 container reproduction proof + golden drift quantification.
#
# The v2 snapshot's STORED golden (wbm_short_standard) was produced in 2021 by
# WBM v21.2.0, but the snapshot now ships model v23.9.0 (and its own
# wbm_SHORT_standard.init uses obsolete 21.x spinup syntax that 23.9.0 rejects).
# The Jan-2022 release notes state numerics changed (PDL transition + TWS bug
# fix), so the 2021 golden is NOT a faithful bit-reproduction target for 23.9.0.
#
# Therefore the meaningful test is: does the LITE 23.9.0 container reproduce the
# PROD 2.0.0 SIF (same 23.9.0 model, isolating only the rebuilt library stack)?
#   * Run a spinup-block-MODERNIZED wbm_SHORT_standard init through BOTH SIFs.
#   * PROD binds the snapshot model/utilities so both run identical 23.9.0 code.
#   * Compare lite-vs-prod: file list, netCDF values, spool byte-identity.
#   * Bonus: quantify how far both differ from the 2021 v21.2.0 golden.
# -----------------------------------------------------------------------------
set -uo pipefail

LITE=${LITE:-/home/x-openghm/apps/wbm/v2-lite/wbm_v2_lite.sif}
PROD=${PROD:-/home/x-openghm/apps/wbm/2.0.0/bin/wbm_opensource_v2.0.0.sif}
SNAP=/anvil/projects/x-ees260008/data/dataRepo/snapshots/wbm_storage_v2.0.0
SUB=wbm_ancillary_data_v2.0.0
INIT=wbm_SHORT_standard_modern
GOLDID=wbm_short_standard
GOLD=$SNAP/wbm_output/$GOLDID
W=$SCRATCH/wbm_v2_prodlite
rm -rf "$W"; mkdir -p "$W/wbm_init"

# Modernized init was uploaded next to this script -> stage into wbm_init.
cp "$HOME/wbm_SHORT_standard_modern.init" "$W/wbm_init/$INIT.init"
echo "SIF lite = $LITE"
echo "SIF prod = $PROD"
echo "Run config:"; grep -E "Run_Start|Run_End|Spinup|Loops|Start|End|Output_dir|Network" "$W/wbm_init/$INIT.init"
echo

run() {  # $1=label  $2=sif  $3...=extra binds
  local label=$1 sif=$2; shift 2
  local d="$W/$label"; mkdir -p "$d"/{spool,wbm_output,WBM_run_state}
  echo ">>> [$label] wbm.pl ($sif)"
  date "+    [$label] start %T"
  singularity exec -c -e \
    -B "$SNAP/data/$SUB:/wbm/data" \
    -B "$SNAP/data_init:/wbm/data_init" \
    -B "$W/wbm_init:/wbm/wbm_init" \
    -B "$SNAP/gdal_test_files:/wbm/gdal_test_files" \
    -B "$d/spool:/wbm/spool" \
    -B "$d/wbm_output:/wbm/wbm_output" \
    -B "$d/WBM_run_state:/wbm/WBM_run_state" \
    "$@" \
    "$sif" /wbm/model/wbm.pl -v /wbm/wbm_init/$INIT.init 2>&1 | tail -6
  echo "    [$label] exit=${PIPESTATUS[0]}"
  date "+    [$label] end   %T"
}

run prod "$PROD" -B "$SNAP/model:/wbm/model" -B "$SNAP/utilities:/wbm/utilities"
run lite "$LITE"
sleep 30   # let detached PostProcessing finish

PO=$W/prod/wbm_output/$GOLDID; LO=$W/lite/wbm_output/$GOLDID

cmp_nc() {  # $1=label  $2=dirA  $3=dirB
  local strip='/:history|:_NCProperties|:NCO|:created|:Conventions|date|:institution/d'
  local ok=0 bad=0
  while IFS= read -r f; do
    local a="$2/$f" b="$3/$f"
    [ -f "$a" ] && [ -f "$b" ] || { bad=$((bad+1)); echo "    MISSING: $f"; continue; }
    if diff -q <(singularity exec -e "$LITE" ncdump -p 6 "$a" 2>/dev/null | sed -E "$strip") \
               <(singularity exec -e "$LITE" ncdump -p 6 "$b" 2>/dev/null | sed -E "$strip") >/dev/null
    then ok=$((ok+1)); else bad=$((bad+1)); echo "    DIFFERS: $f"; fi
  done < <(cd "$3" && find . -name '*.nc' 2>/dev/null | sort)
  echo "  [$1] netCDF match: $ok  differ/missing: $bad"
}

echo; echo "================= (A) LITE vs PROD  (both 23.9.0 -> container proof) ================="
echo "--- .nc file-list diff ---"
diff <(cd "$PO" && find . -name '*.nc'|sort) <(cd "$LO" && find . -name '*.nc'|sort) \
  && echo "NC FILE LIST: identical" || echo "NC FILE LIST: differs"
cmp_nc "lite-vs-prod" "$PO" "$LO"
echo "--- spool byte-identity (sha256) ---"
sid=0; sd=0
while IFS= read -r f; do
  a=$(sha256sum "$W/prod/spool/$f" 2>/dev/null|cut -d' ' -f1)
  b=$(sha256sum "$W/lite/spool/$f" 2>/dev/null|cut -d' ' -f1)
  [ -n "$a" ] && [ "$a" = "$b" ] && sid=$((sid+1)) || sd=$((sd+1))
done < <(cd "$W/lite/spool" && find . -type f 2>/dev/null|sort)
echo "  spool identical: $sid  differ: $sd"

echo; echo "================= (B) drift vs 2021 v21.2.0 golden (informational) ================="
echo "  (differences here are MODEL-VERSION drift 21.2.0->23.9.0, not container)"
cmp_nc "lite-vs-2021golden" "$GOLD" "$LO"
echo; echo "=== DONE ==="
