#!/bin/bash
#SBATCH -A ees260008
#SBATCH -p highmem
#SBATCH -N 1
#SBATCH -n 32
#SBATCH -t 06:00:00
#SBATCH -J vfy_glb
#SBATCH -o /anvil/scratch/x-openghm/verify3/job_glb.%j.out
set -u
V=/anvil/scratch/x-openghm/verify3; SNAP=glb
CMPSIF=/home/x-openghm/apps/wbm/v1-lite-s3/wbm_v1_lite_s3.sif
echo "node $(hostname)  $(date)"
curl -s -o /dev/null -w "S3 HTTP %{http_code}\n" "https://s3.anvil.rcac.purdue.edu/openghm/snapshots/fc66a2cdeee9d456f83bc0b0a6f00cd447b0194c124a3bb4008a02990779ec89/data/wbm_ancillary_data_v2.0.0/climate/airTemp/2000/MERRA2.T2M.2000-01-01.nc" || echo "S3 UNREACHABLE"
for cfg in stock lloc s3; do
  echo "===== GLB $cfg $(date +%T) ====="
  /usr/bin/time -v bash $V/run_glb.sh $cfg > $V/log_glb_$cfg.log 2> $V/log_glb_$cfg.time || echo "GLB $cfg rc=$?"
  grep -iE "Time used|Elapsed \(wall" $V/log_glb_$cfg.log $V/log_glb_$cfg.time 2>/dev/null | tail -2
done
echo "=================== COMPARISON ($SNAP) ==================="
module load cdo nco netcdf-c 2>/dev/null || module load cdo nco 2>/dev/null || true
echo "cdo: $(command -v cdo)  ncks: $(command -v ncks)  ncdump: $(command -v ncdump)"
STK=$V/out_${SNAP}_stock
cd "$STK" 2>/dev/null && \
for rel in $(find . -path '*/daily/*.nc' | sed 's#^\./##'); do
  A=$V/out_${SNAP}_stock/$rel
  B=$V/out_${SNAP}_lloc/$rel
  C=$V/out_${SNAP}_s3/$rel
  bash $V/cmp3.sh "$CMPSIF" "$A" "$B" "$C"
done
echo "=================== END COMPARISON ==================="
echo "DONE $(date)"
