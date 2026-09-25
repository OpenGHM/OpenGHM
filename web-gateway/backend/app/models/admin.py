"""Response models for admin-only aggregate views (time-series metrics,
system status) — kept separate from models/user.py and models/job.py since
these aren't shaped like either domain's resources.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

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
    job_default_walltime: str
    job_default_nodes: int
    job_default_ntasks: int
    job_background_sync_interval: int
    anvil_host: str
    anvil_partition: str
    anvil_execution_profile: str
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
