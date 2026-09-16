#!/bin/bash
#SBATCH -J wbm_v2_lite_golden
#SBATCH -A ees260008
#SBATCH -p shared
#SBATCH -N 1
#SBATCH -n 4
#SBATCH -t 00:40:00
#SBATCH -o %x_%j.out
#SBATCH -e %x_%j.out
# -----------------------------------------------------------------------------
# Golden test for the lightweight v2 full-model container.
#   [1] wbm.pl -v -noRun -test wbm_test.init   (full data init validation)
#   [2] wbm.pl -v wbm_test.init                (real short model run)
#   [3] embedded utility sanity (Geo::GDAL::FFI, PDL, Inline cache)
# Reads the shared v2 snapshot; writes to a fresh per-run scratch dir.
# -----------------------------------------------------------------------------
set -uo pipefail

SIF=${SIF:-/home/x-openghm/apps/wbm/v2-lite/wbm_v2_lite.sif}
SNAP=/anvil/projects/x-ees260008/data/dataRepo/snapshots/wbm_storage_v2.0.0
SUB=wbm_ancillary_data_v2.0.0
WORK=$SCRATCH/wbm_v2_lite_golden
rm -rf "$WORK"; mkdir -p "$WORK"/{spool,wbm_output,WBM_run_state}

bind=( -B "$SNAP/data/$SUB:/wbm/data"
       -B "$SNAP/data_init:/wbm/data_init"
       -B "$SNAP/wbm_init:/wbm/wbm_init"
       -B "$SNAP/gdal_test_files:/wbm/gdal_test_files"
       -B "$WORK/spool:/wbm/spool"
       -B "$WORK/wbm_output:/wbm/wbm_output"
       -B "$WORK/WBM_run_state:/wbm/WBM_run_state" )

echo "=== SIF: $SIF ==="; ls -lh "$SIF"

echo; echo "=== [1/3] wbm.pl -noRun -test (full data init validation) ==="
singularity exec -c -e "${bind[@]}" \
  "$SIF" /wbm/model/wbm.pl -v -noRun -test /wbm/wbm_init/wbm_test.init
echo "noRun exit=$?"

echo; echo "=== [2/3] wbm.pl real run (wbm_test.init) ==="
singularity exec -c -e "${bind[@]}" \
  "$SIF" /wbm/model/wbm.pl -v /wbm/wbm_init/wbm_test.init
echo "run exit=$?"
echo "--- spool/output produced ---"
find "$WORK/spool" "$WORK/wbm_output" -type f 2>/dev/null | head -20
du -sh "$WORK/spool" "$WORK/wbm_output" 2>/dev/null

echo; echo "=== [3/3] embedded utility sanity (Geo::GDAL::FFI, PDL, Inline cache) ==="
singularity exec -c -e "$SIF" bash -c '
  perl -e "use Geo::GDAL::FFI; print \"Geo::GDAL::FFI OK -> GDAL \", Geo::GDAL::FFI::GDALVersionInfo(\"RELEASE_NAME\"), \"\n\""
  perl -MPDL -e "print \"PDL \$PDL::VERSION\n\""
  echo "Inline .so baked: $(find /wbm/_Inline -name "*.so" | wc -l)"
  perl -c /wbm/utilities/networkTools 2>&1 | tail -1
  perl -c /wbm/utilities/spatial_aggregation.pl 2>&1 | tail -1
  perl -c /wbm/utilities/temporal_aggregation.pl 2>&1 | tail -1
'
echo; echo "=== DONE ==="
