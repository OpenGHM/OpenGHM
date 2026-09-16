#!/bin/bash
set -e
CFG=$1
ROOT=/anvil/projects/x-ees260008/data/dataRepo/snapshots
SNAP=$ROOT/wbm_storage_v1.0.0_Wyoming
V=$SCRATCH/verify3
SRC=/anvil/scratch/x-openghm/v1run          # proven patched code + descriptors
INIT=test_mon.init
case $CFG in
  stock) SIF=/home/x-openghm/apps/wbm/1.0.0/bin/wbm_opensource_v1.0.0.sif
         MODEL=$SNAP/model;        UTIL=$SNAP/utilities;   DINIT=$SRC/data_init_local ;;
  lloc)  SIF=/home/x-openghm/apps/wbm/v1-lite-s3/wbm_v1_lite_s3.sif
         MODEL=$SRC/code_model;    UTIL=$SRC/code_util;    DINIT=$SRC/data_init_local ;;
  s3)    SIF=/home/x-openghm/apps/wbm/v1-lite-s3/wbm_v1_lite_s3.sif
         MODEL=$SRC/code_model;    UTIL=$SRC/code_util;    DINIT=$SRC/data_init ;;
  *) echo "bad cfg"; exit 1;;
esac
O=$V/out_wyo_$CFG; SP=$V/spool_wyo_$CFG; ST=$V/state_wyo_$CFG
rm -rf $O $SP $ST; mkdir -p $O $SP $ST
singularity exec -c -e --pwd / \
  -B $MODEL:/wbm/model -B $UTIL:/wbm/utilities \
  -B $DINIT:/wbm/data_init \
  -B $SNAP/data/Wyoming_tracking:/wbm/data \
  -B $SNAP/gdal_test_files:/wbm/gdal_test_files \
  -B $V/wbm_init_wyo:/wbm/wbm_init \
  -B $SP:/wbm/spool -B $O:/wbm/wbm_output -B $ST:/wbm/WBM_run_state \
  "$SIF" /wbm/model/wbm.pl -v /wbm/wbm_init/$INIT
