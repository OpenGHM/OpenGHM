# ADR 0033 — WBM output is read on Anvil by the toolkit, and the gateway asks for subsets

| | |
|---|---|
| **Status** | accepted |
| **Date** | 2026-10-09 |
| **Affects** | [ADR 0023](0023-simulation-output-stays-on-scratch.md), [ADR 0025](0025-a-gateway-job-runs-the-pinned-toolkit.md), [`../architecture/gateway.md`](../architecture/gateway.md), the toolkit README |

## Context

A person should be able to look at a simulation's output and download parts
of it, both for a run that is still only on Anvil scratch (ADR 0023) and for a
published snapshot. The gateway's interface for it comes later; this decision
is about where the output is read and what the gateway asks for.

What the output is (checked 2026-10-08 and 2026-10-09 on the three published
snapshots):

- `daily/wbm_<year>.nc` holds every output variable for one year: 4 GB a year
  for Wyoming (165 variables), about 50 GB for Global.
  `monthly/<variable>/wbm_<year>.nc` and `yearly/<variable>/wbm_<year>.nc`
  are one small file per variable and year.
- NetCDF-4 (HDF5), deflate level 1, one chunk per time step over the whole
  grid (Global: nine). Latitude is stored south to north.

Measured ways to read it:

| Reader | Header of a Wyoming daily file | One map (one day, one variable) | One pixel, one year |
|---|---|---|---|
| A laptop, HTTP range requests to Anvil S3 | 1 min 52 s | 3.3 s (CONUS) | about 5 min (extrapolated) |
| Anvil login node, the file on scratch (h5py) | 0.15 s | 0.014 s | 3.2 s |
| Anvil login node, the same file over HTTPS from Anvil S3 | 0.35 s | 0.14 s | 0.36 s for 31 days |

Anvil S3 sends no CORS headers, so a browser cannot read it directly. A new
SSH connection from a laptop took 2.8 s; the backend's slurmly transport keeps
one connection open.

EarthAtlas, UNH's viewer, renders maps on demand from the NetCDF files on its
own disks and caches tiles; it precomputes nothing. We cannot reuse it (its
server is not open source and reads only UNH's disks), and we cannot run a
standing service next to our data on Anvil (rule 7).

## Decision

**The toolkit reads WBM output where it is, on Anvil, and answers subsets.
The gateway runs it over SSH, the way it runs `openghm spool status`, and
precomputes nothing.**

- `openghm output inventory` describes one run's output: its folders, the
  files and years that exist, each variable with its units, time steps and
  display settings (from the output `*.MT.csv`, keeping only what exists, with
  its run-time paths rewritten), and the grid.
- `openghm output subset` cuts one variable by period and area, at one
  temporal resolution (daily, monthly, yearly), and writes it as:
  - `nc`: a NetCDF file, for download;
  - `png`: a north-up map of one time step, for a bounding box and a size,
    coloured by the variable's display settings;
  - `json`: values, for a pixel's time series or a point query.
- Both read either a run's folder on scratch or a published snapshot's output
  on Anvil S3 (anonymous HTTPS range requests from Anvil).
- They are short commands on a login node. Each has a limit on what one call
  may read, and refuses past it with a message; nothing long runs there
  (rule 7).
- The toolkit's reader needs `h5py` and `numpy`, native wheels that install on
  Anvil's Python 3.9, and `h5netcdf` to write a NetCDF subset. They are an
  optional extra, so the rest of the toolkit stays pure Python.
- The backend runs the commands through slurmly's one persistent connection
  and reads a `nc` subset back over SFTP, streaming it to the person. A run's
  scratch output is shown to whoever may see the job (its owner, staff and
  admins, as for its logs); a published snapshot's to anyone.

## Consequences

- One reader serves both a draft's scratch output and a published snapshot,
  and nothing new is stored: no derivatives under `snapshots/`, no cache in
  the cluster (rule 6).
- Every view costs an SSH round trip, about a second. Panning a map tile by
  tile or animating days would be slow; the gateway asks for one image per
  view. Precomputed derivatives (map pyramids, time-major series) stay a later
  option for what proves slow, and would need a decision of their own.
- A scratch run's output disappears when scratch purges it (30 days); the
  gateway says so rather than failing.
- Downloading a whole Global daily year (about 50 GB) through the gateway is
  not offered; a subset of one variable is about 1 GB.
- The display colours are ours: the MT csv names ramps (`DarkBlue(0:20)`) whose
  definitions live in UNH's private EarthAtlas code.
