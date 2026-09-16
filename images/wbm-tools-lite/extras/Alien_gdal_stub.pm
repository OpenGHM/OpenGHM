# Minimal Alien::gdal shim.
# Geo::GDAL::FFI uses Alien::gdal only to (a) locate libgdal at runtime via
# dynamic_libs() and (b) compare ->version (skips a <=2.3.1 legacy branch).
# The full CPAN Alien::gdal drags in Alien::patchelf -> Alien::Build::Git -> git
# and source-builds proj/geos/sqlite. We link against the system libgdal (apt
# libgdal-dev / gdal-bin) instead, so this shim is all Geo::GDAL::FFI needs.
package Alien::gdal;
use strict;
use warnings;

our $VERSION = '1.44';

sub _find_lib {
    for my $pat (
        '/usr/lib/*/libgdal.so',      # libgdal-dev symlink (if present)
        '/usr/lib/*/libgdal.so.*',    # runtime soname (libgdalNN)
        '/usr/lib/libgdal.so*',
        '/usr/local/lib/libgdal.so*',
    ) {
        for my $p (glob $pat) {
            return $p if -e $p;
        }
    }
    return '/usr/lib/x86_64-linux-gnu/libgdal.so';
}

sub dynamic_libs { return (_find_lib()); }

sub version {
    my $v = `gdalinfo --version 2>/dev/null`;
    return $1 if defined $v && $v =~ /GDAL\s+([\d.]+)/;
    return '3.6.2';
}

# GDAL data dir (gcs.csv, *.svg, etc.) — Geo::GDAL::FFI sets $ENV{GDAL_DATA} from this.
sub data_dir   { -d '/usr/share/gdal' ? '/usr/share/gdal' : '/usr/share/gdal' }
sub dist_dir   { '/usr' }   # dist_dir . '/share/gdal' == /usr/share/gdal

# Methods Geo::GDAL::FFI never calls for modern GDAL, defined defensively.
sub cflags     { '' }
sub libs       { '-lgdal' }
sub install_type { 'system' }

1;
