#!/bin/bash
# Build the v2 lite SIF on anvil from the locally-built docker image.
#   docker save -> scp -> apptainer build docker-archive://  (no fakeroot needed)
set -euo pipefail

IMG=${IMG:-wbm-v2-full:latest}
REMOTE_DIR=${REMOTE_DIR:-/home/x-openghm/apps/wbm/v2-lite}
SIF=${SIF:-wbm_v2_lite.sif}
TAR=wbm-v2-full.tar

echo ">> docker save $IMG -> $TAR"
docker save "$IMG" -o "$TAR"
ls -lh "$TAR"

echo ">> ensure remote dir"
ssh openghm "mkdir -p $REMOTE_DIR"

echo ">> scp tar to anvil"
scp "$TAR" "openghm:$REMOTE_DIR/$TAR"

echo ">> apptainer build SIF on anvil (login node, unprivileged)"
ssh openghm "cd $REMOTE_DIR && apptainer build --force $SIF docker-archive://$TAR && ls -lh $SIF && rm -f $TAR"

echo ">> done. SIF at $REMOTE_DIR/$SIF"
