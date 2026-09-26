#!/bin/bash
#SBATCH -J wbm_v2_reproduce
#SBATCH -A ees260008
#SBATCH -p shared
#SBATCH -N 1 -n 4
#SBATCH -t 00:55:00
#SBATCH -o %x_%j.out -e %x_%j.out
# -----------------------------------------------------------------------------
# "Reproduce production" golden test for the lightweight v2 container.
# Runs the SAME init (wbm_test.init) through the PRODUCTION v2 SIF and the
# new LITE v2 SIF, then diffs the outputs. Both PDL 2.063 -> expect a match.
# -----------------------------------------------------------------------------
set -uo pipefail

LITE=${LITE:-/home/x-openghm/apps/wbm/v2-lite/wbm_v2_lite.sif}
PROD=/anvil/projects/x-ees260008/data/containers/wbm_opensource_v2.0.0_with_paws.sif
SNAP=/anvil/projects/x-ees260008/data/dataRepo/snapshots/wbm_storage_v2.0.0
SUB=wbm_ancillary_data_v2.0.0
INIT=wbm_test
W=$SCRATCH/wbm_v2_reproduce
rm -rf "$W"; mkdir -p "$W"

run() {  # $1=label  $2=sif  $3...=extra binds
  local label=$1 sif=$2; shift 2
  local d="$W/$label"; mkdir -p "$d"/{spool,wbm_output,WBM_run_state}
  echo ">>> [$label] run wbm.pl ($sif)"
  # --pwd / so wbm_test.init's relative Output_dir 'wbm/wbm_output/...' lands in
  # the mounted /wbm/wbm_output (the doc's known relative-path quirk).
  singularity exec -c -e --pwd / \
    -B "$SNAP/data/$SUB:/wbm/data" \
    -B "$SNAP/data_init:/wbm/data_init" \
    -B "$SNAP/wbm_init:/wbm/wbm_init" \
    -B "$SNAP/gdal_test_files:/wbm/gdal_test_files" \
    -B "$d/spool:/wbm/spool" \
    -B "$d/wbm_output:/wbm/wbm_output" \
    -B "$d/WBM_run_state:/wbm/WBM_run_state" \
    "$@" \
    "$sif" /wbm/model/wbm.pl -v /wbm/wbm_init/$INIT.init 2>&1 | tail -5
  echo "    [$label] exit=${PIPESTATUS[0]}  output files: $(find "$d/wbm_output" "$d/spool" -type f 2>/dev/null | wc -l)"
}

# Neither image embeds code (NO embedded code, by design) — bind the v2
# snapshot's model/utilities into BOTH runs so they run the SAME code.
run prod "$PROD" -B "$SNAP/model:/wbm/model" -B "$SNAP/utilities:/wbm/utilities"
run lite "$LITE" -B "$SNAP/model:/wbm/model" -B "$SNAP/utilities:/wbm/utilities"

echo; echo "================= COMPARE ================="
echo "--- output file-list diff (prod vs lite) ---"
diff <(cd "$W/prod" && find . -type f | sort) <(cd "$W/lite" && find . -type f | sort) \
  && echo "FILE LIST: identical" || echo "FILE LIST: DIFFERS (above)"

echo; echo "--- netCDF data compare (ncdump -p 6, volatile attrs stripped) ---"
strip='/:history|:_NCProperties|:NCO|:created|:Conventions|date/d'
ncdiff_ok=0; ncdiff_bad=0
while IFS= read -r f; do
  pf="$W/prod/wbm_output/$f"; lf="$W/lite/wbm_output/$f"
  [ -f "$pf" ] || { echo "  MISSING in prod: $f"; ncdiff_bad=$((ncdiff_bad+1)); continue; }
  if diff -q \
      <(singularity exec -e "$LITE" ncdump -p 6 "$pf" 2>/dev/null | sed -E "$strip") \
      <(singularity exec -e "$LITE" ncdump -p 6 "$lf" 2>/dev/null | sed -E "$strip") >/dev/null; then
    ncdiff_ok=$((ncdiff_ok+1))
  else
    ncdiff_bad=$((ncdiff_bad+1)); echo "  DIFFERS: $f"
  fi
done < <(cd "$W/lite/wbm_output" && find . -name '*.nc' | sort)
echo "netCDF match: $ncdiff_ok  differ/missing: $ncdiff_bad"

echo; echo "--- spool FlexRaw byte-identity (sha256) ---"
sid=0; sdiff=0
while IFS= read -r f; do
  a=$(sha256sum "$W/prod/spool/$f" 2>/dev/null | cut -d' ' -f1)
  b=$(sha256sum "$W/lite/spool/$f" 2>/dev/null | cut -d' ' -f1)
  if [ -n "$a" ] && [ "$a" = "$b" ]; then sid=$((sid+1)); else sdiff=$((sdiff+1)); fi
done < <(cd "$W/lite/spool" && find . -type f | sort)
echo "spool identical: $sid  differ: $sdiff"
echo; echo "=== DONE ==="
