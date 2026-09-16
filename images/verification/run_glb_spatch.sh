#!/bin/bash
set -e
SNAP=/anvil/projects/x-ees260008/data/dataRepo/snapshots/wbm_storage_v1.0.0_Global
V=$SCRATCH/verify3; SRC=/anvil/scratch/x-openghm/glbrun
SIF=/home/x-openghm/apps/wbm/1.0.0/bin/wbm_opensource_v1.0.0.sif   # stock GDAL 3.0.4
MODEL=$SRC/code_model; UTIL=$SRC/code_util                          # PATCHED model
DINIT=$SRC/data_init_local
O=$V/out_glb_spatch; SP=$V/spool_glb_spatch; ST=$V/state_glb_spatch
rm -rf $O $SP $ST; mkdir -p $O $SP $ST
singularity exec -c -e --pwd / \
  -B $MODEL:/wbm/model -B $UTIL:/wbm/utilities \
  -B $DINIT:/wbm/data_init -B $SNAP/data/Global_tracking:/wbm/data \
  -B $SRC/wbm_init:/wbm/wbm_init \
  -B $SP:/wbm/spool -B $O:/wbm/wbm_output -B $ST:/wbm/WBM_run_state \
  "$SIF" /wbm/model/wbm.pl -v /wbm/wbm_init/glb_proof.init
