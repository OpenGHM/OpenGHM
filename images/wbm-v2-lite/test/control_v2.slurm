#!/bin/bash
#SBATCH -J wbm_v2_ctrl
#SBATCH -A ees260008
#SBATCH -p shared
#SBATCH -N 1 -n 8 --mem=48G
#SBATCH -t 01:30:00
#SBATCH -o %x_%j.out -e %x_%j.out
# -----------------------------------------------------------------------------
# ENV-ONLY v2 container verification (mirror of control_v1.slurm). The lite SIF
# embeds NO code; the snapshot model+utilities are bound into BOTH lite and prod,
# so the test isolates purely the apt library stack. wbm_test.init, SHORT config.
#   (1) SELF-TEST : same lite SIF twice.   (2) CONTAINER : prod-2.0.0 vs lite.
# PASS = spool identical + all-var daily maxabs=0.
# Note: wbm_test.init's Output_dir is RELATIVE ('wbm/wbm_output/WBM_test') -> run
# with --pwd / so it lands in the mounted /wbm/wbm_output.
# -----------------------------------------------------------------------------
set -uo pipefail
LITE=${LITE:-/home/x-openghm/apps/wbm/v2-lite/wbm_v2_lite.sif}
PROD=${PROD:-/home/x-openghm/apps/wbm/2.0.0/bin/wbm_opensource_v2.0.0.sif}
SNAP=/anvil/projects/x-ees260008/data/dataRepo/snapshots/wbm_storage_v2.0.0
SUB=wbm_ancillary_data_v2.0.0; INIT=wbm_test; OUTID=WBM_test
W=$SCRATCH/wbm_v2_ctrl
rm -rf "$W"; mkdir -p "$W/wbm_init"

mkdir -p "$W/code"
cp -r "$SNAP/model"     "$W/code/model"
cp -r "$SNAP/utilities" "$W/code/utilities"
CODE_BIND="-B $W/code/model:/wbm/model -B $W/code/utilities:/wbm/utilities"

# SHORT config (identical for all runs): 1-month spinup, 3-month run.
cp -r "$SNAP/wbm_init/." "$W/wbm_init/"
perl -0777 -i -pe 's/Run_End\s*=>.*?,/Run_End => '"'"'2000-03-31'"'"',/s' "$W/wbm_init/$INIT.init"
perl -0777 -i -pe 's/(Spinup\s*=>\s*\{.*?End\s*=>\s*)'"'"'[^'"'"']*'"'"'/${1}'"'"'2000-01-31'"'"'/s' "$W/wbm_init/$INIT.init"
echo "Short config:"; grep -E "Run_Start|Run_End|Start|End|Loops" "$W/wbm_init/$INIT.init"; echo

run() {  # $1=label $2=sif
  local label=$1 sif=$2
  local d="$W/$label"; mkdir -p "$d"/{spool,wbm_output,WBM_run_state}
  echo ">>> [$label] ($sif)"
  singularity exec -c -e --pwd / \
    $CODE_BIND \
    -B "$SNAP/data/$SUB:/wbm/data" -B "$SNAP/data_init:/wbm/data_init" \
    -B "$W/wbm_init:/wbm/wbm_init" -B "$SNAP/gdal_test_files:/wbm/gdal_test_files" \
    -B "$d/spool:/wbm/spool" -B "$d/wbm_output:/wbm/wbm_output" \
    -B "$d/WBM_run_state:/wbm/WBM_run_state" \
    "$sif" /wbm/model/wbm.pl -v /wbm/wbm_init/$INIT.init 2>&1 | tail -3
  echo "    [$label] exit=${PIPESTATUS[0]}  files=$(find "$d/wbm_output" -name '*.nc'|wc -l) spool=$(find "$d/spool" -type f|wc -l)"
}

run lite_A "$LITE"
run lite_B "$LITE"
run prod   "$PROD"

spoolcmp() {  # $1=label dirA dirB
  local lab=$1 A=$2 B=$3 id=0 df=0
  while IFS= read -r f; do
    local x y; x=$(sha256sum "$A/$f" 2>/dev/null|cut -d' ' -f1); y=$(sha256sum "$B/$f" 2>/dev/null|cut -d' ' -f1)
    [ -n "$x" ] && [ "$x" = "$y" ] && id=$((id+1)) || df=$((df+1))
  done < <(cd "$A" && find . -type f|sort)
  echo "  [$lab] spool identical=$id differ=$df"
}

datacmp() {  # $1=label fileA fileB
  echo "  [$1] daily data (fill -9999 masked):"
  singularity exec -e "$LITE" perl -MPDL -MPDL::NetCDF -e '
    my ($A,$B)=@ARGV;
    my $na=PDL::NetCDF->new($A); my $nb=PDL::NetCDF->new($B);
    my ($nv,$bit,@rows)=(0,0);
    for my $v (@{$na->getvariablenames}) {
      next if $v=~/^(lat|lon|time|crs|latitude|longitude|.*_bnds)$/;
      my ($mx,$rms,$frac,$pk)=(0,0,0,0);
      { my $a=eval{$na->get($v)}; my $b=eval{$nb->get($v)};
        last unless defined $a && defined $b && $a->nelem==$b->nelem;
        my $m=($a!=-9999)&($b!=-9999); my $n=$m->sum->sclr; last if $n==0;
        my $d=($a-$b)->abs->where($m); $mx=$d->max->sclr;
        $rms=sqrt(($d**2)->sum->sclr/$n);
        $pk=$a->where($m)->abs->max->sclr;
        $frac=($d > 1e-3*($pk>0?$pk:1))->sum->sclr / $n;
      }
      $nv++; $bit++ if $mx==0;
      push @rows,[$v,$mx,$rms,$frac,$pk];
    }
    @rows=sort{$b->[1]<=>$a->[1]}@rows;
    printf "    vars=%d  bit-identical=%d  differing=%d\n",$nv,$bit,$nv-$bit;
    printf "    %-20s %11s %11s %11s %11s\n","top-by-maxabs","maxabs","rms","frac>1e-3","peak";
    for my $i (0..14){ last if $i>$#rows; my $r=$rows[$i]; last if $r->[1]==0;
      printf "    %-20s %11.3e %11.3e %11.3e %11.3e\n",@$r; }
  ' "$2" "$3" 2>/dev/null
}

Y=daily/wbm_2000.nc
echo; echo "================= (1) SELF-TEST  lite_A vs lite_B ================="
spoolcmp self "$W/lite_A/spool" "$W/lite_B/spool"
datacmp self "$W/lite_A/wbm_output/$OUTID/$Y" "$W/lite_B/wbm_output/$OUTID/$Y"

echo; echo "================= (2) CONTAINER  prod vs lite_A ================="
spoolcmp cont "$W/prod/spool" "$W/lite_A/spool"
datacmp cont "$W/prod/wbm_output/$OUTID/$Y" "$W/lite_A/wbm_output/$OUTID/$Y"
echo; echo "=== DONE ==="
