#!/bin/bash
#SBATCH -J wbm_v1_ctrl
#SBATCH -A ees260008
#SBATCH -p shared
#SBATCH -N 1 -n 8 --mem=48G
#SBATCH -t 01:30:00
#SBATCH -o %x_%j.out -e %x_%j.out
# -----------------------------------------------------------------------------
# ENV-ONLY container verification. The lite SIF embeds NO code (like prod), so
# the snapshot's model+utilities are bound into BOTH lite and prod — the test
# then isolates purely the apt library stack. SHORT config (1-month spinup,
# 3-month run) applied identically to every run (golden not involved).
#
#   (1) SELF-TEST  : same lite SIF run TWICE -> WBM-v1 bit-deterministic here?
#   (2) CONTAINER  : fresh PROD-1.0.0 vs fresh LITE, identical bound code ->
#                    any diff is purely the rebuilt library stack.
#
# Comparison = spool sha256 byte-identity + every .nc under wbm_output through
# images/verification/nc_datacmp.pl (PDL, run in the lite SIF; fill -9999
# masked; attribute order is not compared). A file missing on either side, a
# variable present on one side only, or any differing/unreadable variable
# fails that file. PASS = both comparisons have spool identical + every .nc
# identical; the script exits non-zero on FAIL. A real difference in (2) is
# reported as it is, not tuned away.
#
# Submit from the root of the checkout, so that the comparator resolves:
#   cd <OpenGHM checkout> && sbatch images/wbm-v1-lite/test/control_v1.slurm
# (sbatch runs a copy of this script, so its own location is not usable; the
# comparator defaults to $SLURM_SUBMIT_DIR/images/verification/nc_datacmp.pl.
# Override: DATACMP=/path/to/nc_datacmp.pl sbatch ...)
# -----------------------------------------------------------------------------
set -uo pipefail
LITE=${LITE:-/home/x-openghm/apps/wbm/v1-lite/wbm_v1_lite.sif}
PROD=/home/x-openghm/apps/wbm/1.0.0/bin/wbm_opensource_v1.0.0.sif
SNAP=/anvil/projects/x-ees260008/data/dataRepo/snapshots/wbm_storage_v1.0.0_Wyoming
SUB=Wyoming_tracking; INIT=Wyoming_tracking
DATACMP=${DATACMP:-${SLURM_SUBMIT_DIR:-$PWD}/images/verification/nc_datacmp.pl}
[ -f "$DATACMP" ] || { echo "ERROR: comparator not found: $DATACMP (set DATACMP=)"; exit 2; }
W=$SCRATCH/wbm_v1_ctrl
rm -rf "$W"; mkdir -p "$W/wbm_init"

# Writable copy of the snapshot code (so Inline can use/refresh model/_Inline);
# bound into every run exactly like the original run_wbm binds model+utilities.
mkdir -p "$W/code"
cp -r "$SNAP/model"     "$W/code/model"
cp -r "$SNAP/utilities" "$W/code/utilities"
CODE_BIND="-B $W/code/model:/wbm/model -B $W/code/utilities:/wbm/utilities"

# SHORT config (identical for all runs).
cp -r "$SNAP/wbm_init/." "$W/wbm_init/"
perl -0777 -i -pe 's/Run_End\s*=>.*?,/Run_End => '"'"'2000-03-31'"'"',/s' "$W/wbm_init/$INIT.init"
perl -0777 -i -pe 's/(Spinup\s*=>\s*\{.*?End\s*=>\s*)'"'"'[^'"'"']*'"'"'(.*?Loops\s*=>\s*)\d+/${1}'"'"'2000-01-31'"'"'${2}1/s' "$W/wbm_init/$INIT.init"
echo "Short config:"; grep -E "Run_Start|Run_End|Start|End|Loops" "$W/wbm_init/$INIT.init"; echo

run() {  # $1=label $2=sif
  local label=$1 sif=$2
  local d="$W/$label"; mkdir -p "$d"/{spool,wbm_output,WBM_run_state}
  echo ">>> [$label] ($sif)"
  singularity exec -c -e \
    $CODE_BIND \
    -B "$SNAP/data/$SUB:/wbm/data" -B "$SNAP/data_init:/wbm/data_init" \
    -B "$W/wbm_init:/wbm/wbm_init" -B "$SNAP/gdal_test_files:/wbm/gdal_test_files" \
    -B "$d/spool:/wbm/spool" -B "$d/wbm_output:/wbm/wbm_output" \
    -B "$d/WBM_run_state:/wbm/WBM_run_state" \
    "$sif" /wbm/model/wbm.pl -v /wbm/wbm_init/$INIT.init 2>&1 | tail -3
  echo "    [$label] exit=${PIPESTATUS[0]}  files=$(find "$d/wbm_output" -name '*.nc'|wc -l) spool=$(find "$d/spool" -type f|wc -l)"
}

run lite_A "$LITE"
run lite_B "$LITE"
run prod   "$PROD"

RESULT=PASS

spoolcmp() {  # $1=label dirA dirB ; sets SP_DIFF
  local lab=$1 A=$2 B=$3 id=0 df=0
  while IFS= read -r f; do
    local x y; x=$(sha256sum "$A/$f" 2>/dev/null|cut -d' ' -f1); y=$(sha256sum "$B/$f" 2>/dev/null|cut -d' ' -f1)
    [ -n "$x" ] && [ "$x" = "$y" ] && id=$((id+1)) || df=$((df+1))
  done < <(cd "$A" && find . -type f|sort)
  echo "  [$lab] spool identical=$id differ=$df"
  SP_DIFF=$df
}

nc_compare() {  # $1=label dirA dirB : nc_datacmp.pl on every .nc under <dir>/wbm_output ; sets NC_N NC_ID NC_FAIL
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

compare() {  # $1=label dirA dirB : spool + netCDF for one pair; folds into RESULT
  local lab=$1 A=$2 B=$3 sec=PASS
  spoolcmp "$lab" "$A/spool" "$B/spool"
  nc_compare "$lab" "$A" "$B"
  echo "  [$lab] netCDF summary: files compared=$NC_N  identical=$NC_ID  failed=$NC_FAIL"
  { [ "$SP_DIFF" -eq 0 ] && [ "$NC_FAIL" -eq 0 ] && [ "$NC_N" -gt 0 ]; } || sec=FAIL
  echo "  [$lab] RESULT: $sec"
  [ "$sec" = PASS ] || RESULT=FAIL
}

echo; echo "================= (1) SELF-TEST  lite_A vs lite_B ================="
compare self "$W/lite_A" "$W/lite_B"

echo; echo "================= (2) CONTAINER  prod vs lite_A ================="
compare cont "$W/prod" "$W/lite_A"
echo; echo "=== DONE ==="
echo "RESULT: $RESULT"
[ "$RESULT" = PASS ]
