#!/bin/sh -l
#SBATCH -A ees260008
#SBATCH -p shared
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH -c 4
#SBATCH --time=00:15:00
#SBATCH --output=/anvil/scratch/x-openghm/wbm_lite_test/subset_%j.out
set -u
SIF=/home/x-openghm/apps/wbm/lite/wbm_tools_lite.sif
SNAP=/anvil/projects/x-ees260008/data/dataRepo/snapshots/wbm_storage_v1.0.0_Global
NET=$SNAP/data/Global_tracking/network
WORK=/anvil/scratch/x-openghm/wbm_lite_test
mkdir -p $WORK
cat > $WORK/subset_test.init <<'INI'
{
  Net_file => '/data/network/05min_flwdir.tif',
  subset => {
    output_file => '/work/subset_test.asc',
    trim_nodata => 1,
    rectangle => { lonMin => -110.0, lonMax => -100.0, latMin => 40.0, latMax => 48.0, inscribe => 0 }
  }
}
INI
echo "##### networkTools SUBSET (expect 551x367, 15 basins) #####"
rm -f $WORK/subset_test.asc
singularity exec -c -e -B $NET:/data/network -B $WORK:/work \
  $SIF /wbm/utilities/networkTools -v /work/subset_test.init
echo "rc=$?"
echo "=== output header ==="
head -6 $WORK/subset_test.asc 2>/dev/null
echo "=== files ==="; ls -la $WORK/subset_test.* 2>/dev/null
