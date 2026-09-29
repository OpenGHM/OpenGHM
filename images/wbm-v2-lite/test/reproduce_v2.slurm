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
# new LITE v2 SIF, then compares the outputs. Both PDL 2.063 -> expect a match.
#
# Comparison = file list of the two trees + spool sha256 byte-identity + every
# .nc under wbm_output through images/verification/nc_datacmp.pl (PDL, run in
# the lite SIF; fill -9999 masked; attribute order is not compared). A file
# missing on either side, a variable present on one side only, or any
# differing/unreadable variable fails that file. PASS = file lists identical +
# spool identical + every .nc identical; the script exits non-zero on FAIL.
#
# Submit from the root of the checkout, so that the comparator resolves:
#   cd <OpenGHM checkout> && sbatch images/wbm-v2-lite/test/reproduce_v2.slurm
# (sbatch runs a copy of this script, so its own location is not usable; the
# comparator defaults to $SLURM_SUBMIT_DIR/images/verification/nc_datacmp.pl.
# Override: DATACMP=/path/to/nc_datacmp.pl sbatch ...)
# -----------------------------------------------------------------------------
set -uo pipefail

LITE=${LITE:-/home/x-openghm/apps/wbm/v2-lite/wbm_v2_lite.sif}
PROD=/anvil/projects/x-ees260008/data/containers/wbm_opensource_v2.0.0_with_paws.sif
SNAP=/anvil/projects/x-ees260008/data/dataRepo/snapshots/wbm_storage_v2.0.0
SUB=wbm_ancillary_data_v2.0.0
INIT=wbm_test
DATACMP=${DATACMP:-${SLURM_SUBMIT_DIR:-$PWD}/images/verification/nc_datacmp.pl}
[ -f "$DATACMP" ] || { echo "ERROR: comparator not found: $DATACMP (set DATACMP=)"; exit 2; }
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

RESULT=PASS

nc_compare() {  # $1=label  $2=dirA  $3=dirB : nc_datacmp.pl on every .nc under <dir>/wbm_output
  local lab=$1 A=$2/wbm_output B=$3/wbm_output f out rc n=0 id=0 fl=0
  local ok_re='vars=[1-9][0-9]* bit-identical=[0-9]+ differing=0 bad=0 only_prod=\[\] only_lite=\[\]'
  echo "  [$lab] every .nc (nc_datacmp.pl, fill -9999 masked; only_prod = only in the first tree, only_lite = only in the second):"
  while IFS= read -r f; do
    f=${f#./}; n=$((n+1))
    if [ ! -f "$A/$f" ] || [ ! -f "$B/$f" ]; then
      echo "  MISSING $f  (first: $([ -f "$A/$f" ] && echo present || echo ABSENT)  second: $([ -f "$B/$f" ] && echo present || echo ABSENT))"
      fl=$((fl+1)); continue
    fi
    out=$(singularity exec -e "$LITE" perl "$DATACMP" "$A/$f" "$B/$f" </dev/null 2>&1); rc=$?
    echo "$out"
    if [ $rc -eq 0 ] && [[ $out =~ $ok_re ]]; then id=$((id+1)); else fl=$((fl+1)); echo "  FAIL $f (exit=$rc)"; fi
  done < <({ (cd "$A" && find . -name '*.nc'); (cd "$B" && find . -name '*.nc'); } | sort -u)
  NC_N=$n; NC_ID=$id; NC_FAIL=$fl
}

echo; echo "================= COMPARE ================="
echo "--- output file-list diff (prod vs lite) ---"
if diff <(cd "$W/prod" && find . -type f | sort) <(cd "$W/lite" && find . -type f | sort); then
  echo "FILE LIST: identical"
else
  echo "FILE LIST: DIFFERS (above)"; RESULT=FAIL
fi

echo; echo "--- netCDF data compare (nc_datacmp.pl over every .nc in wbm_output) ---"
nc_compare v2 "$W/prod" "$W/lite"
echo "netCDF summary: files compared=$NC_N  identical=$NC_ID  failed=$NC_FAIL"
{ [ "$NC_FAIL" -eq 0 ] && [ "$NC_N" -gt 0 ]; } || RESULT=FAIL

echo; echo "--- spool FlexRaw byte-identity (sha256) ---"
sid=0; sdiff=0
while IFS= read -r f; do
  a=$(sha256sum "$W/prod/spool/$f" 2>/dev/null | cut -d' ' -f1)
  b=$(sha256sum "$W/lite/spool/$f" 2>/dev/null | cut -d' ' -f1)
  if [ -n "$a" ] && [ "$a" = "$b" ]; then sid=$((sid+1)); else sdiff=$((sdiff+1)); fi
done < <(cd "$W/lite/spool" && find . -type f | sort)
echo "spool identical: $sid  differ: $sdiff"
[ "$sdiff" -eq 0 ] || RESULT=FAIL

echo; echo "=== DONE ==="
echo "RESULT: $RESULT"
[ "$RESULT" = PASS ]
