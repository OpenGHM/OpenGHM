#!/bin/bash
#SBATCH -J wbm_v1_lite_golden
#SBATCH -A ees260008
#SBATCH -p shared
#SBATCH -N 1
#SBATCH -n 4
#SBATCH -t 00:30:00
#SBATCH -o %x_%j.out
#SBATCH -e %x_%j.out
# -----------------------------------------------------------------------------
# Golden test for the lightweight v1 full-model container.
#   wbm.pl -v -noRun -test Wyoming_tracking.init  (the doc-verified v1 smoke run)
# Reads the shared v1 Wyoming snapshot; writes to a fresh per-run scratch dir.
# Model + utilities are EMBEDDED in the SIF (not bound).
# -----------------------------------------------------------------------------
set -uo pipefail

SIF=${SIF:-/home/x-openghm/apps/wbm/v1-lite/wbm_v1_lite.sif}
SNAP=/anvil/projects/x-ees260008/data/dataRepo/snapshots/wbm_storage_v1.0.0_Wyoming
WORK=$SCRATCH/wbm_v1_lite_golden
rm -rf "$WORK"; mkdir -p "$WORK"/{spool,wbm_output,WBM_run_state}

echo "=== SIF: $SIF ==="; ls -lh "$SIF"

echo; echo "=== [1/2] wbm.pl -noRun -test (full data init validation) ==="
singularity exec -c -e \
  -B "$SNAP/data/Wyoming_tracking:/wbm/data" \
  -B "$SNAP/data_init:/wbm/data_init" \
  -B "$SNAP/wbm_init:/wbm/wbm_init" \
  -B "$SNAP/gdal_test_files:/wbm/gdal_test_files" \
  -B "$WORK/spool:/wbm/spool" \
  -B "$WORK/wbm_output:/wbm/wbm_output" \
  -B "$WORK/WBM_run_state:/wbm/WBM_run_state" \
  "$SIF" /wbm/model/wbm.pl -v -noRun -test /wbm/wbm_init/Wyoming_tracking.init
RC=$?
echo "wbm.pl -noRun -test exit=$RC"

echo; echo "=== [2/2] embedded utility sanity (Geo::GDAL SWIG, PDL, Inline cache) ==="
singularity exec -c -e "$SIF" bash -c '
  perl -e "use Geo::GDAL; print \"Geo::GDAL SWIG v\$Geo::GDAL::VERSION\n\""
  perl -MPDL -e "print \"PDL \$PDL::VERSION\n\""
  echo "Inline .so baked: $(find /wbm/_Inline -name "*.so" | wc -l)"
  perl -c /wbm/utilities/networkTools.pl 2>&1 | tail -1
  perl -c /wbm/utilities/spatial_aggregation.pl 2>&1 | tail -1
  perl -c /wbm/utilities/temporal_aggregation.pl 2>&1 | tail -1
'
echo; echo "=== DONE (wbm.pl rc=$RC) ==="
