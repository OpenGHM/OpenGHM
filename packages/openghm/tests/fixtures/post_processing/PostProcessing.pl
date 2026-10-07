#!/usr/bin/perl

#######################################################################
#
#	WBM output data post processing:
#	Temporal and spatial aggregation. Adopted from data_cube.pl
#
#	Written by Dr. A. Prusevich (alex.proussevitch@unh.edu)
#
#	October 2016	Adopted from stand alone script
#	April 2020	Updated with var list, TA depth, etc.
#	July 2020	Updated with pre-creating output directories
#
#######################################################################

use strict;
use File::Path;
use Parallel::ForkManager;
use RIMS;			### WSAG UNH module

my $perl_path = '/wbm/utilities/';
my $forks     = 4;
my $pm        = new Parallel::ForkManager($forks);	# Parallel Processing object

my @param = qw(
	WMB_test_runoff
	WMB_test_discharge
	WMB_test_streamAge
);

my @multi_year_dates = (
);

#################################################################
#		Options for processing				#
#################################################################

my $hourly       = 0;			# Set if the source dataset is hourly ts
my $monthly      = 0;			# Set if the source dataset is monthly ts
my $temporal_agg = 1;
my $spatial_agg  = 0;
my $climatology  = 1;
my $TA_depth     ='year';		# Temporal aggregation depth
my $v            = 0 ? '-v'    : '';	# Verbose for aggregations (not for data_cube.pl)
my $rm           = 0 ? '-rm'   : '';
my $trim         = 0 ? '-trim' : '';
my $nc3          = 0 ? '-nc3'  : '';
my $MT           = '/wbm/wbm_output/pp-check-1/wbm_test.MT.csv';
my $output_dir   = '/wbm/wbm_output/pp-check-1';
my @PA_ID_list   = qw();

#################################################################
#		Pre-create output directories
#		to avoid fork conflicts
#################################################################

my   @dir_list;				if($temporal_agg) {
push @dir_list,$output_dir.'/daily'		if $hourly;
push @dir_list,$output_dir.'/monthly'		if $TA_depth !~ m/day/;
push @dir_list,$output_dir.'/yearly'		if $TA_depth !~ m/day|month/;
push @dir_list,$output_dir.'/climatology'	if $climatology; }
push @dir_list,$output_dir.'/spatial_agg'	if $spatial_agg;

foreach my $dir (@dir_list) {
  unless (-e $dir) { mkpath($dir,0,0775) or die "Cannot create-
$dir
"; }
}

#################################################################

my @suff  = qw/_d _m _y _dc _mc _yc/;
my $count = 0;
$pm->run_on_finish(sub{
  my ($pid,$exit_code,$ident,$exit_signal,$core_dump,$data) = @_;
  printf "Done (%d)- $$data[0]\n",++$count;
});
printf "\nDataCube aggregation started for %d WBM output variables (%d forks):\n\n",
	scalar(@param), $forks;

#################################################################
#		Temporal Aggregation				#
#################################################################

foreach my $param (@param) {
  $pm->start and next;			### Run fork processes

  if ($temporal_agg) {
	# Hourly -> Daily
    system "$perl_path/temporal_aggregation.pl $v $rm $trim $nc3 -mt $MT $param\_h $param\_d" if $hourly;

	# Daily -> Monthly
    unless ($TA_depth eq 'day') {
    system "$perl_path/temporal_aggregation.pl $v $rm $trim $nc3 -mt $MT $param\_d $param\_m" unless $monthly;

	# Daily/Monthly -> Yearly
    unless ($TA_depth eq 'month') {
    my $suf = $monthly ? '_m' : '_d';
    system "$perl_path/temporal_aggregation.pl $v $rm $trim $nc3 -mt $MT $param$suf $param\_y";
    }}
    if ($climatology) {
	# Daily -> Daily Climatology
      system "$perl_path/temporal_aggregation.pl $v -rm $nc3 -mt $MT $param\_d $param\_dc" unless $monthly;
      next if $TA_depth eq 'day';

	# Monthly -> Monthly Climatology
      system "$perl_path/temporal_aggregation.pl $v -rm $nc3 -mt $MT $param\_m $param\_mc";
      next if $TA_depth eq 'month';

	# Yearly -> Yearly Climatology (Multi-Year)
      foreach my $range (@multi_year_dates) {
	my $dates   = sprintf "-sd %d-00-00 -ed %d-00-00", @$range;
	my $yc_file = file_pyramid({read_attrib($MT, $param.'_yc', 'Code_Name')}->{File_Path});
       (my $my_file = $yc_file) =~ s/(_yc.nc)$/_$$range[0]-$$range[1]$1/;

	system "$perl_path/temporal_aggregation.pl $v -rm $nc3 $dates -mt $MT $param\_y $param\_yc";
	rename $yc_file, $my_file;
      }
	# Yearly -> Yearly Climatology
      system "$perl_path/temporal_aggregation.pl $v -rm $nc3 -mt $MT $param\_y $param\_yc";
    }
  }
#################################################################
#		Spatial Aggregation				#
#################################################################

  if ($spatial_agg) {
    foreach my $suff (@suff) {
      next if $monthly             && ($suff=~m/_(h|d)$/);
      next if $TA_depth eq 'day'   && ($suff=~m/_(m|y)/);
      next if $TA_depth eq 'month' && ($suff=~m/_y/);
      next if !$temporal_agg && (($hourly && $suff ne '_h') || (!$hourly && !$monthly && $suff ne '_d'));
      my $flag  = $rm;
      if ($suff =~ m/c$/) {
	next unless $climatology;
	$flag   = '-rm';
      }

      my %dataAttr	= read_attrib($MT, $param.$suff, 'Code_Name');

      foreach my $pol_ID (@PA_ID_list) {
	my $file_nc  = "/wbm/wbm_output/pp-check-1/spatial_agg/$param$suff.$pol_ID.nc";
	system "$perl_path/spatial_aggregation.pl $v $flag  -mt $MT $param$suff $pol_ID $file_nc";
	  # Convert NetCDF to scv table
       (my $file_csv = $file_nc) =~ s/nc$/csv/;
	system "$perl_path/nc_aggr_read.pl $dataAttr{Var_Name} $file_nc > $file_csv";
      }
    }
  }
  $pm->finish(0,[$param]);
}
$pm->wait_all_children;

print "\nAll Done!\n\n";

exit;

