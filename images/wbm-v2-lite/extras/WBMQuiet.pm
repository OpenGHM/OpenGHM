# Loaded via PERL5OPT=-MWBMQuiet. Drops exactly one non-fatal warning that newer
# FFI::Platypus (>=2.x) emits from RIMS.pm's transform_point (OCTTransform is
# passed scalar refs, which older Platypus accepted silently). Output values are
# unaffected; this only stops ~tens of MB of identical stderr lines per run.
# Every other warning is passed through unchanged.
package WBMQuiet;
use strict;
use warnings;

my $prev = $SIG{__WARN__};
$SIG{__WARN__} = sub {
    return if defined $_[0]
        && $_[0] =~ m{passing non array reference into ffi/platypus array argument type};
    if ($prev) { $prev->(@_) } else { CORE::warn(@_) }
};

1;
