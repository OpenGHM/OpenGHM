#!/bin/bash
# Build the SIF on anvil from the locally-built docker image.
#   1. docker save  -> tar (amd64 image)
#   2. scp tar to anvil
#   3. apptainer build sif docker-archive://tar   (NO fakeroot needed: this only
#      assembles a squashfs from existing layers, so it works as x-openghm)
set -euo pipefail

IMG=${IMG:-wbm-lite:latest}
REMOTE_DIR=${REMOTE_DIR:-/home/x-openghm/apps/wbm/lite}
TAR=wbm-lite.tar

echo ">> docker save $IMG -> $TAR"
docker save "$IMG" -o "$TAR"
ls -lh "$TAR"

echo ">> ensure remote dir"
ssh openghm "mkdir -p $REMOTE_DIR"

echo ">> scp tar to anvil"
scp "$TAR" "openghm:$REMOTE_DIR/$TAR"

echo ">> apptainer build SIF on anvil (login node, unprivileged)"
ssh openghm "cd $REMOTE_DIR && apptainer build --force wbm_tools_lite.sif docker-archive://$TAR && ls -lh wbm_tools_lite.sif"

echo ">> done. SIF at $REMOTE_DIR/wbm_tools_lite.sif"
