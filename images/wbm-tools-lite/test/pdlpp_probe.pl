use strict;
use warnings;
use PDL;
use Inline Pdlpp => <<'END_PDLPP';
pp_def('myinc',
    Pars => 'i(); [o] o()',
    Code => '$o() = $i() + 1;',
);
END_PDLPP

my $x = pdl(1, 2, 3);
print "Pdlpp result: ", myinc($x), "\n";
