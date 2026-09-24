#!/bin/bash
#SBATCH -A ees260008
#SBATCH -p shared
#SBATCH -N 1
#SBATCH -n 16
#SBATCH -t 04:00:00
#SBATCH -J vfy_v2
#SBATCH -o /anvil/scratch/x-openghm/verify3/job_v2.%j.out
set -u
V=/anvil/scratch/x-openghm/verify3; SNAP=v2
CMPSIF=/home/x-openghm/apps/wbm/v2-lite-s3/wbm_v2_lite_s3.sif
echo "node $(hostname)  $(date)"
curl -s -o /dev/null -w "S3 HTTP %{http_code}\n" "https://s3.anvil.rcac.purdue.edu/openghm/snapshots/fc66a2cdeee9d456f83bc0b0a6f00cd447b0194c124a3bb4008a02990779ec89/data/wbm_ancillary_data_v2.0.0/network/hyd_5m_CONUS_mississippi_patched.asc" || echo "S3 UNREACHABLE"
for cfg in stock lloc s3; do
  echo "===== V2 $cfg $(date +%T) ====="
  /usr/bin/time -v bash $V/run_v2.sh $cfg > $V/log_v2_$cfg.log 2> $V/log_v2_$cfg.time || echo "V2 $cfg rc=$?"
  grep -iE "Time used|Elapsed \(wall" $V/log_v2_$cfg.log $V/log_v2_$cfg.time 2>/dev/null | tail -2
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
