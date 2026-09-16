#!/bin/sh -l
#SBATCH -A ees260008
#SBATCH -p shared
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH -c 4
#SBATCH --time=00:20:00
#SBATCH --output=/anvil/scratch/x-openghm/wbm_lite_test/test_lite_%j.out

# =============================================================================
# Functional test of the lightweight WBM utilities container (wbm_tools_lite.sif)
# Reproduces the three golden tests from docs/wbm_utilities_scripts.md, but with
# the slim image: code is EMBEDDED, so we bind only data (read) + work (write).
# =============================================================================
set -u

SIF=${SIF:-/home/x-openghm/apps/wbm/lite/wbm_tools_lite.sif}
SNAP=/anvil/projects/x-ees260008/data/dataRepo/snapshots/wbm_storage_v1.0.0_Global
GTOUT=$SNAP/wbm_output/Global_tracking
NET=$SNAP/data/Global_tracking/network
MASKS=$SNAP/data/Global_tracking/masks
WORK=/anvil/scratch/x-openghm/wbm_lite_test
mkdir -p $WORK

# Minimal binds: 3 read data dirs + 1 work dir (vs. the old 9-mount layout).
BINDS="-B $GTOUT:/data/gt_output -B $NET:/data/network -B $MASKS:/data/masks -B $WORK:/work"

echo "SIF = $SIF"
singularity exec $SIF gdalinfo --version
echo

# --- Magic Table with container paths under /data --------------------------
python3 - "$WORK/test.MT.csv" <<'PY'
import csv, sys
header = ['Code_Name','Data_Cube','Project','Time_Series','Start_Date','End_Date',
          'Legend_File','Legend_Img','Name','Param_Name','Var_Name','Units',
          'Var_Scale','Var_Offset','Orig_Units','Bands','Shade_factor','Shade_Default',
          'Processing','Projection','Round','MetadataLink','File_Path',
          'Data_Attrib','Point_Data','Polygon_Aggregation','DownloadLink']
rows = [
  # yearly runoff (spatial test data)
  ['Global_tracking_runoff_y','Global_tracking_runoff','','yearly',
   '2000-00-00','2009-00-00','','','WBM Runoff yearly','Runoff','runoff','mm/year',
   '365','','mm/day','1','','5:0','','epsg:4326','%.2f','',
   '(1e20,1e5):/data/gt_output/yearly/runoff/wbm__YEAR_.nc;','','','',''],
  # monthly runoff (temporal test source)
  ['Global_tracking_runoff_m','Global_tracking_runoff','','monthly',
   '2000-01-00','2009-12-00','','','WBM Runoff monthly','Runoff','runoff','mm/month',
   '30','','mm/day','12','','5:0','','epsg:4326','%.2f','',
   '(1e20,1e5):/data/gt_output/monthly/runoff/wbm__YEAR_.nc;','','','',''],
  # yearly average destination (temporal test dst)
  ['test_runoff_yearly','test_runoff_yearly','','yearly',
   '2000-00-00','2009-00-00','','','Test Runoff Yearly','Runoff','runoff','mm/year',
   '1','','mm/year','1','','','','epsg:4326','%.2f','',
   '(1e20,0):/work/test_runoff_y__YEAR_.nc;','','','',''],
  # US state mask (spatial test mask)
  ['US_states_6min','','','','','','','','US States 6min','State ID','','integer',
   '1','','integer','1','','','','epsg:4326','','',
   '(1e20,0):/data/masks/state_6min.ascii;','','','',''],
]
with open(sys.argv[1],'w',newline='') as f:
    w=csv.writer(f,delimiter='\t'); w.writerow(header)
    for r in rows: w.writerow(r)
print("wrote", sys.argv[1])
PY

# --- init for networkTools preclip -----------------------------------------
cat > $WORK/preclip_test.init <<'EOF'
{
  Net_file => '/data/network/05min_flwdir.tif',
  preclip  => {
    output_file      => '/work/preclip_test.asc',
    truncation_check => 1,
    trim_nodata      => 0,
    rectangle => { lonMin => -110.0, lonMax => -100.0, latMin => 40.0, latMax => 48.0 }
  }
}
EOF

echo "########## TEST 1: networkTools preclip (expect 120x96) ##########"
rm -f $WORK/preclip_test.asc
singularity exec -c -e $BINDS $SIF /wbm/utilities/networkTools -v /work/preclip_test.init
echo "rc=$?"
if [ -f $WORK/preclip_test.asc ]; then
  echo "ncols/nrows:"; head -2 $WORK/preclip_test.asc
fi
echo

echo "########## TEST 2: spatial_aggregation.pl (expect 51 polygons x 10 layers) ##########"
rm -f $WORK/output_runoff_by_state.nc $WORK/states.msk
singularity exec -c -e $BINDS $SIF /wbm/utilities/spatial_aggregation.pl -v \
  -mt /work/test.MT.csv -f /work/states.msk \
  Global_tracking_runoff_y US_states_6min /work/output_runoff_by_state.nc
echo "rc=$?"
[ -f $WORK/output_runoff_by_state.nc ] && \
  singularity exec $SIF gdalinfo -nomd NETCDF:/work/output_runoff_by_state.nc:runoff 2>/dev/null | grep -E "Size is"
echo

echo "########## TEST 3: temporal_aggregation.pl (expect 3 yearly files) ##########"
rm -f $WORK/test_runoff_y_*.nc
singularity exec -c -e $BINDS $SIF /wbm/utilities/temporal_aggregation.pl -v -ndc \
  -mt /work/test.MT.csv -sd 2000-01-01 -ed 2002-12-31 \
  Global_tracking_runoff_m test_runoff_yearly
echo "rc=$?"
echo "output files:"; ls -la $WORK/test_runoff_y_*.nc 2>/dev/null

echo
echo "########## DONE ##########"
