use strict; use warnings; use Fcntl qw(O_RDONLY); use PDL; use PDL::NetCDF;
my ($A,$B)=@ARGV;
my $na=PDL::NetCDF->new($A,{MODE=>O_RDONLY}); my $nb=PDL::NetCDF->new($B,{MODE=>O_RDONLY});
my %va=map{$_=>1}@{$na->getvariablenames}; my %vb=map{$_=>1}@{$nb->getvariablenames};
my @only_a=grep{!$vb{$_}}sort keys %va; my @only_b=grep{!$va{$_}}sort keys %vb;
my ($nv,$bit,$bad,@rows)=(0,0,0);
for my $v (sort keys %va) {
  next unless $vb{$v}; next if $v eq 'crs';
  my $a=eval{$na->get($v)}; my $b=eval{$nb->get($v)};
  if(!defined $a || !defined $b){ print "  UNREADABLE $v\n"; $bad++; next }
  if($a->nelem!=$b->nelem || join(',',$a->dims) ne join(',',$b->dims)){ print "  SHAPE $v ".join('x',$a->dims)." vs ".join('x',$b->dims)."\n"; $bad++; next }
  my $m=($a!=-9999)&($b!=-9999); my $n=$m->sum->sclr;
  my $fillmis=(($a==-9999)!=($b==-9999))->sum->sclr;
  my $mx= $n ? ($a-$b)->abs->where($m)->max->sclr : 0;
  $nv++; if($mx==0 && $fillmis==0){$bit++} else { push @rows,[$v,$mx,$fillmis] }
}
printf "%s vars=%d bit-identical=%d differing=%d bad=%d only_prod=[%s] only_lite=[%s]\n", ($A=~m{wbm_output/(.*)})[0], $nv,$bit,scalar(@rows),$bad,join(',',@only_a),join(',',@only_b);
printf "    DIFF %-24s maxabs=%.3e fill_mismatch=%d\n",@$_ for @rows;
