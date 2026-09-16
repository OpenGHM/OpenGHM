# Production hardening — WBM direct-S3 reads (`v1-lite-s3` / `v2-lite-s3`)

The `*-lite-s3` containers are **validated for correctness** (bit-for-bit
identical output to local-staged and to the stock 1.9 GB container) but the
proof-of-concept runs were interactive/benchmark runs. Before relying on direct
S3 reads for unattended production jobs, address the items below. They fall into
three buckets: **resilience**, **performance**, and **operations**.

> When is this worth it at all? Direct S3 is a clear win when **S3 is the primary
> store** and you want to skip bulk pre-staging (and when you subset small regions
> from large global files — `/vsicurl` fetches only the needed byte ranges). It is
> *not* worth it when the data already sits on fast parallel storage (Lustre) —
> there, local is ~15% faster and adds no network dependency. See each README's
> *Performance* section for measured overhead (~14–17% on the Mississippi domain).

---

## 1. Resilience — the run now depends on S3 for its whole duration

A local-staged run only needs the network up *before* it starts. A direct-S3 run
issues HTTP GETs throughout — a single transient `5xx`/timeout mid-run can abort a
multi-hour job. Harden with GDAL's built-in retry + timeout knobs (set in the
container `%environment`, or exported by the run wrapper):

```sh
export GDAL_HTTP_MAX_RETRY=5          # retry failed range GETs (default 0 = no retry)
export GDAL_HTTP_RETRY_DELAY=2        # seconds between retries (exponential-ish)
export GDAL_HTTP_TIMEOUT=60           # per-request timeout (s)
export GDAL_HTTP_CONNECTTIMEOUT=15    # connection timeout (s)
```

- **Why it matters most here:** WBM's `read_GDAL` *hard-`exit`s* on a failed warp
  (uncatchable by `eval`), so one un-retried S3 blip kills the whole run with no
  checkpoint resume. Retries turn transient blips into brief stalls.
- **Belt-and-braces:** WBM's spinup/spool already writes each fetched grid to the
  local spool on first read, so re-reads within a run are local. Keep the spool on
  fast storage so a retry never re-hits S3 for already-seen days.

## 2. Performance — caching and connection reuse

```sh
export CPL_VSIL_CURL_CACHE_SIZE=200000000   # 200 MB in-memory range cache (default 16 MB)
export GDAL_HTTP_MULTIPLEX=YES              # HTTP/2 multiplexing if the RGW supports it
export GDAL_NUM_THREADS=ALL_CPUS            # parallelize warp/IO where applicable
export VSI_CACHE=TRUE
export VSI_CACHE_SIZE=50000000              # per-file handle cache
```

- Bigger `CPL_VSIL_CURL_CACHE_SIZE` helps when many bands/variables come from one
  file (fewer repeat range GETs).
- The measured ~14–17% overhead was **without** these — they should narrow it.
- For latency-dominated tiny domains (e.g. the 154-cell Merrimack case, where
  overhead was ~40%), connection reuse matters more than raw bandwidth.

## 3. Operations — access policy, integrity, observability

### Bucket access / ACLs
- The `openghm` bucket is **inconsistent**: `wbm_storage_v2.0.0/...` is
  anonymously readable (HTTP 200) but `wbm_storage_v1.0.0_{Wyoming,Global}/...`
  return **403**. Anonymous `/vsicurl` cannot read a 403 prefix.
- **Pick one policy and apply it uniformly:**
  - *Public archives* → set public-read ACL on the whole prefix; keep using
    `/vsicurl`.
  - *Private data* → use authenticated **`/vsis3`** with credentials
    (`AWS_S3_ENDPOINT=s3.anvil.rcac.purdue.edu`, `AWS_ACCESS_KEY_ID`,
    `AWS_SECRET_ACCESS_KEY`, `AWS_VIRTUAL_HOSTING=FALSE` for path-style RGW), fed
    via SLURM secrets — **never** bake keys into the SIF or commit them.

### Integrity
- Add a lightweight pre-flight: `HEAD` (or `gdalinfo`) each dataset's first file
  and assert HTTP 200 + expected size before the daily loop, so a misconfigured
  path fails in seconds, not mid-run.
- Optionally checksum-verify a sample against a known-good manifest.

### Observability
- Log the S3 endpoint, the resolved `File_Path`s, and per-dataset first-byte
  latency at startup. `CPL_DEBUG=ON` (or `CPL_CURL_VERBOSE=YES`) surfaces every
  range GET when diagnosing.
- Record `MaxRSS` and wall-clock from `sacct`/`/usr/bin/time -v` so regressions
  are visible.

### Compute-node access (verified)
- Anvil **compute nodes can reach** `s3.anvil.rcac.purdue.edu` (validated: node
  `a002` got HTTP 200), so SLURM batch jobs work — no need to pre-stage on a login
  node. Don't assume this on other clusters: test outbound HTTPS from a compute
  node first (a one-line `curl -o /dev/null -w '%{http_code}'` in the job
  preamble).

---

## 4. A hybrid toggle (recommended default for production)

Don't hard-wire "S3 only." Make the data source a run-time switch so operators can
choose per job:

- **`direct`** — descriptors point at `/vsicurl` (or `/vsis3`). Best for
  exploration, small/subset runs, or when data lives only in S3.
- **`staged`** — a pre-step copies the needed years to local scratch and
  descriptors point there. Best for long unattended runs and when network
  resilience matters more than skipping the copy.

The two descriptor sets differ only in `File_Path` (and the `Network`/`soil`
paths), exactly as `data_s3/` vs `data_local/` in the validation workspace — so a
single `sed` (or an env-substituted descriptor template) flips the mode. Keep the
patched model code identical for both: the patches are inert for local paths.

---

## Checklist before first production use

- [ ] Retry/timeout env set (`GDAL_HTTP_MAX_RETRY` etc.)
- [ ] Range cache sized (`CPL_VSIL_CURL_CACHE_SIZE`)
- [ ] Access policy resolved (public-read **or** `/vsis3` + secret-managed keys)
- [ ] Pre-flight existence/size check in the run wrapper
- [ ] Compute-node S3 reachability tested in the job preamble
- [ ] Spool on fast local storage; output dir writable
- [ ] `MaxRSS`/wall-clock captured for sizing future jobs
- [ ] Hybrid `direct`/`staged` toggle wired into the run script
