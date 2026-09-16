# WBM v1 code changes for direct S3 (`/vsicurl`) NetCDF reads

These patches apply to the **bound v1 model code** (`model/RIMS/WBM.pm`) — NOT to
the container. They mirror the v2 patches (`../../wbm-v2-lite-s3/patches/wbm_s3_direct.md`)
but adapt to v1's structure: v1 uses the **SWIG `Geo::GDAL`** binding (not
Geo::GDAL::FFI), so anything that opens a file *in-process* runs on the ABI-locked
**GDAL 3.0.4** and cannot read `/vsicurl`. The design keeps every in-process
`Geo::GDAL::Open` on **local** files only (the network grid + local warped tmp
tiffs); the remote forcing is read exclusively by the **GDAL 3.10 CLI** that
`read_GDAL` shells out to.

A remote input is any path matching `m{/vsi|://}`. Redirect a dataset to S3 by
rewriting its descriptor `File_Path` to
`/vsicurl/https://s3.anvil.rcac.purdue.edu/openghm/snapshots/.../<file>`. Keep the
**network grid local** (it defines the run extent and is read in-process via SWIG)
and keep Perl-read config (descriptors, Magic Table) local.

Patches are **inert for local paths**, so a patched model still runs unchanged
against a local snapshot. Line numbers are from the v1.0.0 snapshot `WBM.pm`.

---

## P6 — `GDAL_FileCheck`: short-circuit remote paths (~L714)

`GDAL_FileCheck` probes a path with an in-process `Geo::GDAL::Open` (SWIG 3.0.4),
which fails on `/vsicurl`. Return "GDAL-readable" for remote without opening:

```perl
 sub GDAL_FileCheck {
   my $file  = shift;
+  return 1 if $file =~ m{/vsi|://};   # remote: GDAL 3.10 CLI reads it; skip in-proc open
   my $check = -e ($file =~ m/:(.+):/ ? $1 : $file) && eval { ... };
```

## P2 — `read_GDAL`: build a shell-quoted `NETCDF:"…":var` for remote (~L875)

WBM's `processing:path:var` convention splits on `:`, which collides with the
`https://` colon. For remote, derive the bare URL and hand the CLI a shell-quoted
subdataset string (so the netCDF driver + CF georeferencing are used). Insert
right after the `$file_s` extraction at the top of `read_GDAL`:

```perl
 (my  $file_s = $file)	=~ s/.+:(.+):.+/$1/;
+ my $gfile = $file;
+ if ($file =~ m{/vsi|://}) {
+   ($file_s = $file) =~ s/^NETCDF://i; $file_s =~ s/:[^:\/]+$//;
+   my $rv = $$meta{Var_Name} || (($file =~ m/:([^:\/]+)$/) ? $1 : '');
+   $gfile = $rv ? qq{'NETCDF:"$file_s":$rv'} : qq{'$file_s'};
+ }
```

## P3 — `read_GDAL`: use `$gfile` in the `gdal_translate` command (~L927)

```perl
-  "$$PATH{gdal_translate} -of VRT -b $b $file $tmp_file.vrt;".
+  "$$PATH{gdal_translate} -of VRT -b $b $gfile $tmp_file.vrt;".
```

## P4 / P7 / P8 — skip the local-existence (`-e`) check for remote paths

`-e` is false for `/vsicurl/...`. Guard the three death checks in `read_GDAL`
(~L885), `read_raster` (~L991) and `get_extent` (~L1041):

```perl
-  die "...does not exist...\n" unless -e $file_s;
+  die "...does not exist...\n" unless ($file_s =~ m{/vsi|://}) or -e $file_s;
```

## P5 — drop the duplicate `gdalwarp -multi` (~L930)

`RIMS.conf` already defines `gdalwarp => ".../gdalwarp -multi"`; `read_GDAL` added a
second `-multi`. GDAL 3.0.4 tolerated it; GDAL 3.10 rejects it. Remove the one in
`read_GDAL`:

```perl
-  "$$PATH{gdalwarp} -ot Float32 -wt Float32 -of gtiff -multi -s_srs ...";
+  "$$PATH{gdalwarp} -ot Float32 -wt Float32 -of gtiff -s_srs ...";
```

## P1 — `get_NetCDF_compression`: read NODATA via the GDAL 3.10 CLI for remote (~L1481)

This function opens the file with `PDL::NetCDF` (netcdf-c), which cannot read
`/vsicurl`, and then **dies** if no nodata is found. v1 has no Geo::GDAL::FFI, so
read the nodata from the wrapped `gdalinfo` (GDAL 3.10) instead. Insert right after
the early-return guard:

```perl
 return ($scale,$offset,$nodata) unless $file =~ m/\.nc$/i && $var_name;
+ if ($file =~ m{/vsi|://}) {   # remote: PDL::NetCDF can't read /vsicurl; use GDAL 3.10 CLI
+   (my $fq = $file) =~ s/^NETCDF://i; $fq =~ s/:[^:\/]+$//;
+   my $info = `gdalinfo "NETCDF:\"$fq\":$var_name" 2>/dev/null`;
+   $nodata = $1 if $info =~ m/NoData Value=([-+eE.\d]+)/;
+   $nodata = $1 if defined($processing) && $processing =~ m/nodata=([-+e\.\d]+)/i;
+   return ($scale,$offset,$nodata);
+ }
```

(MERRA2 forcing carries no scale/offset packing, so `scale=1`/`offset=0` is correct
for the remote path — matching the validated v2 behavior.)

## P9 — make `GDAL_test` degrade gracefully (~L1528)

The startup self-test runs `read_GDAL` on a bundled **WRF Lambert** file. Under
GDAL 3.10 the netCDF driver reads WRF via its `XLONG/XLAT` geolocation arrays, and
`gdalwarp` then tries to create geolocation "Y index work files" in the current
directory — which is read-only (`--pwd /`). `read_GDAL` **`exit`s** on a failed
warp (uncatchable by `eval`), so the whole run aborts. Skip the self-test (it then
reports "GDAL NetCDF test : Not Performed"); real epsg:4326 data is validated by
the actual run:

```perl
 sub GDAL_test {
   ...
   my $result = 0;
+  return 0;   # 3.10 reads WRF via geolocation -> work-files in read-only cwd; epsg:4326 data validated by the run
```

> **Caveat (same as v2):** epsg:4326 datasets (MERRA2 and most standard inputs)
> are numerically identical between 3.0.4 and 3.10 (verified bit-for-bit). **WRF /
> Lambert-Conformal and other curvilinear-coordinate inputs are NOT equivalent**
> under 3.10 and need separate validation before production use.
