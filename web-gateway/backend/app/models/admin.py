"""Response models for admin-only aggregate views (time-series metrics,
system status) — kept separate from models/user.py and models/job.py since
these aren't shaped like either domain's resources.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

DependencyStatus = Literal["ok", "degraded", "unconfigured", "error"]


class DependencyHealth(BaseModel):
    """One external dependency's reachability. `detail` is always a short,
    hand-written phrase — never str(exception); see app.services.system_info
    for why."""

    name: str
    status: DependencyStatus
    detail: str | None = None
    latency_ms: float | None = None


class FeatureStatus(BaseModel):
    """An optional integration and whether it's configured — never its value."""

    name: str
    configured: bool
    note: str | None = None


class RuntimeSettingsSummary(BaseModel):
    """Non-secret operational settings, whitelisted field by field in
    app.services.system_info — never a denylist dump of app.core.config,
    which would leak the next *_SECRET added there by default."""

    jwt_expire_minutes: int
    refresh_token_expire_days: int
    #: How often the background sweep asks SLURM about jobs, as a sentence:
    #: both intervals, the short one while a job is active (ADR 0027).
    job_status_sweep: str
    #: How long one SLURM answer is shared between callers (ADR 0027).
    job_live_ttl_seconds: int
    anvil_host: str
    anvil_partition: str
    anvil_execution_profile: str
    #: Empty when no toolkit is installed for this gateway (submit refuses).
    anvil_openghm_home: str
    s3_bucket: str
    cors_origins: list[str]


class SystemInfoResponse(BaseModel):
    environment: str
    project_name: str
    version: str
    server_time: datetime
    uptime_seconds: float
    dependencies: list[DependencyHealth]
    features: list[FeatureStatus]
    settings: RuntimeSettingsSummary


class TimeSeriesPoint(BaseModel):
    """One bucket. `bucket` is the UTC instant of the bucket's start in the
    requested timezone — not a local wall-clock time — so clients can render
    it without re-deriving the offset."""

    bucket: datetime
    count: int


class TimeSeriesResponse(BaseModel):
    metric: str
    granularity: str
    timezone: str
    start: datetime
    end: datetime
    total: int  # sum over the returned points, not an all-time total
    points: list[TimeSeriesPoint]


class StatusCount(BaseModel):
    status: str
    count: int


class StatusBreakdownResponse(BaseModel):
    """Every JobStatus appears, including zero-count ones, so a chart's
    legend and colors are stable across reloads/empty windows."""

    items: list[StatusCount]
    total: int
    since: datetime | None = None


class ScratchQuota(BaseModel):
    """The `scratch` row of Anvil's `myquota`: files and bytes (decimal units)."""

    files_used: int
    files_limit: int
    bytes_used: int
    bytes_limit: int


class SpoolVariantUsage(BaseModel):
    """One variant directory of the spool cache,
    `<cache root>/<model input id>/<network>/<variant>`. A unit is one year of
    it (or its climatology); `last_used` is the newest of its units' last use
    (UTC, `YYYY-MM-DDTHH:MM:SSZ`)."""

    # `model_input_id` is the toolkit's field name; pydantic reserves `model_`.
    model_config = ConfigDict(protected_namespaces=())

    model_input_id: str
    network: str
    variant: str
    dir: str
    units: int
    files: int
    bytes: int
    last_used: str | None = None
    on_s3_units: int
    leased_units: int


class SpoolLease(BaseModel):
    """What one active simulation holds in the cache; never deleted until it
    expires (UTC, same format as `last_used`)."""

    sim_id: str
    variant_dir: str
    units: list[str]
    expires: str


class SpoolTotals(BaseModel):
    units: int
    files: int
    bytes: int


class ScratchStatusResponse(BaseModel):
    """GET /admin/anvil/scratch: Anvil's scratch quota and the spool cache, as
    `openghm spool status --json` reports them. `quota` is null, with
    `quota_error` saying why, when `myquota` could not be read. `high` and
    `low` are the toolkit's automatic-prune thresholds (fractions of the file
    quota); `variants` are newest last use first and `leases` unexpired only."""

    quota: ScratchQuota | None = None
    quota_error: str | None = None
    high: float
    low: float
    cache_root: str
    variants: list[SpoolVariantUsage]
    leases: list[SpoolLease]
    totals: SpoolTotals
    checked_at: datetime


class SpoolCacheClearRequest(BaseModel):
    dry_run: bool = False


class SpoolDeletedUnit(BaseModel):
    variant_dir: str
    unit: str
    files: int
    bytes: int


class SpoolCacheClearResponse(BaseModel):
    """POST /admin/anvil/spool-cache/clear. With `dry_run` nothing was deleted
    and the counts are what would be. `skipped_leased` is the units kept
    because an active simulation holds them."""

    dry_run: bool
    deleted_units: int
    deleted_files: int
    deleted_bytes: int
    skipped_leased: int
    deleted: list[SpoolDeletedUnit]
