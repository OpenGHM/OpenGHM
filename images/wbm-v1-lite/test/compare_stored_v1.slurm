#!/bin/bash
#SBATCH -J wbm_v1_vsgold
#SBATCH -A ees260008
#SBATCH -p shared
#SBATCH -N 1 -n 8
#SBATCH -t 06:00:00
#SBATCH -o %x_%j.out -e %x_%j.out
# -----------------------------------------------------------------------------
# Reproduce the STORED production Wyoming run with the new LITE v1 container and
# compare against the golden output already saved in the snapshot.
#
#   * Inputs (data/data_init/gdal_test_files) bound READ-ONLY from the shared
#     snapshot -- the snapshot is NEVER written to.
#   * The run is FULL (2000-2009, Spinup 2000-2004 x2) using the snapshot's own
#     Wyoming_tracking.init UNCHANGED, so output is directly comparable to the
#     stored golden (which took 3h59m in production).
#   * LITE embeds the v1 model, verified byte-identical (sha256) to the snapshot
#     model -> this isolates the rebuilt library stack (PDL 2.063, etc).
#   * Three checks vs golden: file list, netCDF values (ncdump -p6, volatile
#     attrs stripped), and spool FlexRaw byte-identity (sha256).
# -----------------------------------------------------------------------------
set -uo pipefail

LITE=${LITE:-/home/x-openghm/apps/wbm/v1-lite/wbm_v1_lite.sif}
SNAP=/anvil/projects/x-ees260008/data/dataRepo/snapshots/wbm_storage_v1.0.0_Wyoming
SUB=Wyoming_tracking
INIT=Wyoming_tracking
GOLD=$SNAP/wbm_output/$INIT     # stored production output (read-only golden)
GSPOOL=$SNAP/spool              # stored production spool   (read-only golden)
W=$SCRATCH/wbm_v1_vsgold
rm -rf "$W"; mkdir -p "$W/wbm_init" "$W/spool" "$W/wbm_output" "$W/WBM_run_state"

# Snapshot init UNCHANGED (full run) -> output matches the stored golden.
cp -r "$SNAP/wbm_init/." "$W/wbm_init/"
echo "SIF  = $LITE"
echo "GOLD = $GOLD"
echo "Run/Spinup config in test init:"
grep -E "Run_Start|Run_End|Start|End|Loops|Network" "$W/wbm_init/$INIT.init"
echo

echo ">>> LITE wbm.pl FULL run (2000-2009; production took ~4h)"
date '+start %F %T'
singularity exec -c -e \
  -B "$SNAP/data/$SUB:/wbm/data" \
  -B "$SNAP/data_init:/wbm/data_init" \
  -B "$W/wbm_init:/wbm/wbm_init" \
  -B "$SNAP/gdal_test_files:/wbm/gdal_test_files" \
  -B "$W/spool:/wbm/spool" \
  -B "$W/wbm_output:/wbm/wbm_output" \
  -B "$W/WBM_run_state:/wbm/WBM_run_state" \
  "$LITE" /wbm/model/wbm.pl -v /wbm/wbm_init/$INIT.init 2>&1 | tail -10
rc=${PIPESTATUS[0]}
date '+end   %F %T'
echo "wbm.pl exit=$rc"

LOUT=$W/wbm_output/$INIT
echo; echo "================= COMPARE vs STORED GOLDEN ================="

echo "--- output .nc file-list diff (stored vs lite) ---"
diff <(cd "$GOLD" && find . -name '*.nc' | sort) <(cd "$LOUT" && find . -name '*.nc' 2>/dev/null | sort) \
  && echo "NC FILE LIST: identical" || echo "NC FILE LIST: differs (above)"

echo; echo "--- netCDF data compare (ncdump -p 6, volatile attrs stripped) ---"
strip='/:history|:_NCProperties|:NCO|:created|:Conventions|date|:institution/d'
ok=0; bad=0
while IFS= read -r f; do
  gf="$GOLD/$f"; lf="$LOUT/$f"
  [ -f "$gf" ] || { echo "  MISSING in stored: $f"; bad=$((bad+1)); continue; }
  if diff -q \
      <(singularity exec -e "$LITE" ncdump -p 6 "$gf" 2>/dev/null | sed -E "$strip") \
      <(singularity exec -e "$LITE" ncdump -p 6 "$lf" 2>/dev/null | sed -E "$strip") >/dev/null; then
    ok=$((ok+1)); else bad=$((bad+1)); echo "  DIFFERS: $f"; fi
done < <(cd "$LOUT" && find . -name '*.nc' 2>/dev/null | sort)
echo "netCDF match: $ok  differ/missing: $bad"

echo; echo "--- spool FlexRaw byte-identity vs stored (sha256) ---"
sid=0; sdiff=0
while IFS= read -r f; do
  a=$(sha256sum "$GSPOOL/$f" 2>/dev/null | cut -d' ' -f1)
  b=$(sha256sum "$W/spool/$f" 2>/dev/null | cut -d' ' -f1)
  if [ -n "$a" ] && [ "$a" = "$b" ]; then sid=$((sid+1)); else sdiff=$((sdiff+1)); fi
done < <(cd "$W/spool" && find . -type f 2>/dev/null | sort)
echo "spool identical: $sid  differ: $sdiff  (stored spool files: $(find "$GSPOOL" -type f 2>/dev/null | wc -l))"
echo; echo "=== DONE ==="
