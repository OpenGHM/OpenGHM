#!/bin/bash
set -e
CFG=$1
ROOT=/anvil/projects/x-ees260008/data/dataRepo/snapshots
SNAP=$ROOT/wbm_storage_v2.0.0
ANC=$SNAP/data/wbm_ancillary_data_v2.0.0
V=$SCRATCH/verify3
SRC=/anvil/scratch/x-openghm/s3run
case $CFG in
  stock) SIF=/home/x-openghm/apps/wbm/2.0.0/bin/wbm_opensource_v2.0.0.sif
         MODEL=$SNAP/model;        UTIL=$SNAP/utilities;   DATA=$ANC;            INIT=wbm_v2_local.init ;;
  lloc)  SIF=/home/x-openghm/apps/wbm/v2-lite-s3/wbm_v2_lite_s3.sif
         MODEL=$SRC/code_direct/model; UTIL=$SRC/code_direct/utilities; DATA=$ANC; INIT=wbm_v2_local.init ;;
  s3)    SIF=/home/x-openghm/apps/wbm/v2-lite-s3/wbm_v2_lite_s3.sif
         MODEL=$SRC/code_direct/model; UTIL=$SRC/code_direct/utilities; DATA=$SRC/data_s3; INIT=wbm_v2_s3.init ;;
  *) echo "bad cfg"; exit 1;;
esac
O=$V/out_v2_$CFG; SP=$V/spool_v2_$CFG; ST=$V/state_v2_$CFG
rm -rf $O $SP $ST; mkdir -p $O $SP $ST
singularity exec -c -e --pwd / \
  -B $MODEL:/wbm/model -B $UTIL:/wbm/utilities \
  -B $DATA:/wbm/data \
  -B $SNAP/data_init:/wbm/data_init \
  -B $SNAP/gdal_test_files:/wbm/gdal_test_files \
  -B $V/v2_init:/wbm/wbm_init \
  -B $SP:/wbm/spool -B $O:/wbm/wbm_output -B $ST:/wbm/WBM_run_state \
  "$SIF" /wbm/model/wbm.pl -v /wbm/wbm_init/$INIT
