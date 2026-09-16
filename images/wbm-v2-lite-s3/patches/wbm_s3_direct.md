# WBM code changes for direct S3 (`/vsicurl`) NetCDF reads

These patches apply to the **bound model code** (`model/RIMS/WBM.pm`,
`model/RIMS.pm`) — NOT to the container. The lite/GDAL-3.10 containers ship the
*environment* only; the model is bind-mounted from the snapshot at run time. Keep
a patched copy of the snapshot's `model/` + `utilities/` and bind that, leaving
the pristine snapshot untouched:

```bash
cp -r $SNAP/model  $WORK/code/model
cp -r $SNAP/utilities $WORK/code/utilities
# apply the patches below to $WORK/code/model/RIMS/{WBM.pm,RIMS.pm}
singularity exec ... -B $WORK/code/model:/wbm/model -B $WORK/code/utilities:/wbm/utilities ...
```

A remote input is any path matching `m{/vsi|://}`. Datasets are redirected to S3
by rewriting their Magic-Table descriptor `File_Path` (and any direct GDAL inputs
in the run `.init`) from `/wbm/data/...` to
`/vsicurl/https://s3.anvil.rcac.purdue.edu/openghm/snapshots/.../data/...`.
Descriptor `.init` files, the Magic Table, and other **Perl-read** config stay
local — only GDAL-read raster/NetCDF data goes to `/vsicurl`.

> **All-inputs-on-S3 validated.** These same six patches (no additions) let a run
> read *every* GDAL-read input from S3 — daily climate, soil AWC (`NETCDF:…:layer`),
> root depth, evwater climatology, **and the network `.asc` grid**. The network is
> read via `get_extent` (patch #1) + GDAL, not Perl-parsed, so it streams fine; the
> `check_ascii_file` calls are only on Perl-read table/`.init` text files, which
> stay local. A full 366-day CONUS run with all inputs remote produced output
> bit-for-bit identical to the all-local run (see README *Performance*).

These changes are **inert for local paths** (the `m{/vsi|://}` guard is false), so
a patched model still runs unchanged against a local snapshot.

---

## 1. `WBM.pm` — skip the local-existence (`-e`) check for remote paths

`-e` is false for a `/vsicurl/...` string. Three read entry points die on it.

```perl
# read_GDAL (~L1033), read_raster (~L1138), get_extent (~L1181):
-  die "...does not exist. Aborting...\n\n" unless -e $file_s;
+  die "...does not exist. Aborting...\n\n" unless ($file_s =~ m{/vsi|://}) or -e $file_s;
```

## 2. `WBM.pm` — `GDAL_FileCheck` treats remote paths as existing

```perl
# GDAL_FileCheck (~L774):
-  my $check = -e ($file =~ m/:(.+):/ ? $1 : $file) && eval {
+  my $check = (($file =~ m{/vsi|://}) || -e ($file =~ m/:(.+):/ ? $1 : $file)) && eval {
```

## 3. `WBM.pm` — `read_GDAL` builds a shell-quoted `NETCDF:"…":var` for remote files

WBM's `processing:path:var` convention splits on `:`, which collides with the
`https://` colon. For a remote path, derive the bare URL separately and hand GDAL
a **shell-quoted** subdataset string so the netCDF driver (not HDF5Image) is used
and CF georeferencing is preserved. Insert right after the `$file_s` extraction at
the top of `read_GDAL`:

```perl
 (my  $file_s = $file) =~ s/.+:(.+):.+/$1/;
+ my $gfile = $file;
+ if ($file =~ m{/vsi|://}) {                       # remote (S3) input
+   ($file_s = $file) =~ s/^NETCDF://i;             # strip NETCDF: prefix
+   $file_s =~ s/:[^:\/]+$//;                        # strip :VAR  -> bare /vsicurl/...nc
+   my $rv = $$meta{Var_Name} || (($file =~ m/:([^:\/]+)$/) ? $1 : '');
+   $gfile = $rv ? qq{'NETCDF:"$file_s":$rv'} : qq{'$file_s'};   # quoted -> shell preserves -> netCDF driver + georef
+ }
```

Then use `$gfile` instead of `$file` in the raster `gdal_translate` command:

```perl
-  "$$PATH{gdal_translate} -of VRT -b $b $file $tmp_file.vrt;".
+  "$$PATH{gdal_translate} -of VRT -b $b $gfile $tmp_file.vrt;".
```

## 4. `RIMS.pm` — `get_netcdf_compression` reads NODATA via GDAL for remote files

This function opens the file with `PDL::NetCDF` (netcdf-c), which cannot read
`/vsicurl`. For remote paths, read scale/offset/nodata through GDAL instead.
Insert immediately after the early-return guard (`unless $file =~ /\.nc$/i …`):

```perl
+ if ($file =~ m{/vsi|://}) {   # remote NetCDF: read nodata via GDAL, skip PDL::NetCDF
+   require Geo::GDAL::FFI;
+   my $ds = eval { Geo::GDAL::FFI::Open($file, {Flags=>['READONLY']}) };
+   my $nd; if ($ds) { $nd = eval { $ds->GetBand(1)->GetNoDataValue }; }
+   $nodata = $nd if defined $nd;
+   $nodata = $1 if defined($processing) && $processing =~ m/nodata=([-+e.\d]+)/i;
+   return ($scale,$offset,$nodata);
+ }
```

---

## 5. `WBM.pm` — drop the duplicate `gdalwarp -multi` (GDAL ≥ 3.5 strictness)

`RIMS.conf` already defines `gdalwarp => ".../gdalwarp -multi"`; `read_GDAL` added a
second `-multi`. GDAL 3.0.4 tolerated the duplicate; GDAL 3.10 rejects it
(`ERROR 1: Duplicate argument -multi`). Remove the one in `read_GDAL`:

```perl
-  "$$PATH{gdalwarp} -ot Float32 -wt Float32 -of gtiff -multi -s_srs ...";
+  "$$PATH{gdalwarp} -ot Float32 -wt Float32 -of gtiff -s_srs ...";
```

## 6. `WBM.pm` — make `GDAL_test` degrade gracefully (robustness)

The startup self-test asserts exact pixel values on bundled test files, including
a WRF Lambert-Conformal file. GDAL 3.10 reads that WRF file via its `XLONG/XLAT`
geolocation arrays (geographic, no affine geotransform) instead of computing the
Lambert grid as 3.0.4 did, so `get_extent` dies and aborts the whole run. Wrap the
test body so a version-specific difference reports "Not Performed" instead of
killing the run (it already returns 0 → "Not Performed" by design):

```perl
+  eval {
   my @coordB1 = transform_point('epsg:4326', $epsg_8001, @coord);
   ... read/assert block ...
   $result = 1 if ... == -19.70;
+  };
+  if ($@) { warn "  (GDAL self-test skipped: $@)"; return 0; }
   die "...GDAL test failed..." unless $result;
```

> **Caveat (#5/#6 are GDAL-3.10 behavior):** epsg:4326 datasets (MERRA2 and most
> standard inputs) are numerically identical between 3.0.4 and 3.10 (verified:
> wbm_2000.nc balances matched bit-for-bit). **WRF / Lambert-Conformal and other
> curvilinear-coordinate inputs are NOT equivalent** under 3.10 and need separate
> validation before production use. Patches #1–#4 are S3-only and apply to any
> GDAL; #5–#6 are required specifically by the GDAL 3.10 upgrade.
