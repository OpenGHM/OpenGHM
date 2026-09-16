#!/bin/bash
#SBATCH -A ees260008
#SBATCH -p highmem
#SBATCH -N 1
#SBATCH -n 32
#SBATCH -t 01:00:00
#SBATCH -J vfy_spatch
#SBATCH -o /anvil/scratch/x-openghm/verify3/job_spatch.%j.out
set -u
V=/anvil/scratch/x-openghm/verify3
echo "node $(hostname) $(date)"
echo "=== run spatch (stock GDAL3.0.4 + PATCHED model + local) ==="
/usr/bin/time -v bash $V/run_glb_spatch.sh > $V/log_glb_spatch.log 2>$V/log_glb_spatch.time || echo "spatch rc=$?"
echo "spatch output:"; ls -l $V/out_glb_spatch/glb/daily/*.nc 2>/dev/null | awk '{print $5,$NF}'
echo "=== DECOMPOSITION ==="
bash $V/cmp_ctrl.sh
echo "DONE $(date)"
