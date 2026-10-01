#!/bin/bash
#SBATCH -A ees260008
#SBATCH -p shared
#SBATCH -n 4
#SBATCH -t 01:00:00
#SBATCH --mem=16G
#SBATCH -o /anvil/scratch/x-openghm/image-pin-check/check-%x.%j.out

# =============================================================================
# Rebuild a pinned Dockerfile image through SLURM and list what is inside it.
#
# Input: the `docker save` of the locally built image, at
#   $D/<NAME>-pinned.tar          (D = /anvil/scratch/x-openghm/image-pin-check)
# Run:
#   sbatch -J <NAME> --export=ALL,NAME=<NAME>[,PUB=<published sif>] \
#       verification/check_pinned_recipe.slurm
# Output, under $D only:
#   <NAME>.dpkg.check.txt          dpkg-query -W (binary:Package, Version), sorted
#   <NAME>.usrlocal.check.txt      find /usr/local -type f, sorted
#   <NAME>.usrlocal.md5.check.txt  md5sum of those files
# and, when PUB is set, <NAME>.usrlocal.md5.published.txt for that SIF, which is
# only exec'd, never written. Compare the first with images/<NAME>/lock/*.dpkg.txt.
# The check SIF and the tar are scratch artifacts: delete them afterwards.
# =============================================================================
set -u
D=/anvil/scratch/x-openghm/image-pin-check
source ~/etc/bashrc 2>/dev/null
export APPTAINER_TMPDIR=$D/tmp APPTAINER_CACHEDIR=$D/cache
mkdir -p $APPTAINER_TMPDIR $APPTAINER_CACHEDIR
SIF=$D/$NAME-pinned-check.sif
rm -f $SIF
start=$(date +%s)
apptainer build $SIF docker-archive://$D/$NAME-pinned.tar </dev/null || { echo BUILD_FAILED; exit 1; }
echo "apptainer build: $(( $(date +%s)-start )) s"
apptainer exec $SIF dpkg-query -W -f '${binary:Package}\t${Version}\n' </dev/null | sort > $D/$NAME.dpkg.check.txt
apptainer exec $SIF sh -c 'find /usr/local -type f | sort' </dev/null > $D/$NAME.usrlocal.check.txt
apptainer exec $SIF sh -c 'find /usr/local -type f -exec md5sum {} + | sort -k2' </dev/null > $D/$NAME.usrlocal.md5.check.txt
if [ -n "${PUB:-}" ]; then
  apptainer exec "$PUB" sh -c 'find /usr/local -type f -exec md5sum {} + | sort -k2' </dev/null > $D/$NAME.usrlocal.md5.published.txt
fi
echo "dpkg lines: $(wc -l < $D/$NAME.dpkg.check.txt)"
echo DONE
