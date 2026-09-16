# Minimal Alien::gdal shim for the GDAL 3.10 upgrade container.
# Geo::GDAL::FFI uses Alien::gdal only to (a) locate libgdal at runtime via
# dynamic_libs() and (b) compare ->version. Here we point it at the bundled
# conda-forge GDAL 3.10 under /opt/gdal instead of the (removed) system apt GDAL.
# (Identical in spirit to the v2 stub, only the search paths/version differ.)
package Alien::gdal;
use strict;
use warnings;

our $VERSION = '1.44';

sub _find_lib {
    for my $pat ('/opt/gdal/lib/libgdal.so', '/opt/gdal/lib/libgdal.so.*') {
        for my $p (glob $pat) {
            return $p if -e $p;
        }
    }
    return '/opt/gdal/lib/libgdal.so';
}

sub dynamic_libs { return (_find_lib()); }

sub version {
    my $v = `/opt/gdal/bin/gdalinfo --version 2>/dev/null`;
    return $1 if defined $v && $v =~ /GDAL\s+([\d.]+)/;
    return '3.10.3';
}

sub data_dir     { '/opt/gdal/share/gdal' }
sub dist_dir     { '/opt/gdal' }
sub cflags       { '' }
sub libs         { '-lgdal' }
sub install_type { 'system' }

1;
