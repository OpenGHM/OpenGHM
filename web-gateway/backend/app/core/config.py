from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    # Defaults to "production" (fail-safe): a deployment that forgets to set
    # this explicitly should land in the strict mode, not the permissive one.
    # Local dev sets ENVIRONMENT=development via web-gateway/backend/.env.example.
    ENVIRONMENT: Literal["development", "production"] = "production"
    # Independent kill switch for the X-Mock-Role auth bypass — lets a
    # dev/staging deployment keep ENVIRONMENT=development (for logging, debug
    # behavior, etc.) while still disabling password-free login once it's
    # reachable from the internet. Only takes effect when ENVIRONMENT is
    # already "development"; production never honors X-Mock-Role regardless.
    ALLOW_MOCK_AUTH: bool = False
    SECRET_KEY: str = "dev-secret-key-change-in-production-min-32-chars"
    PROJECT_NAME: str = "OpenGHM Gateway"
    API_V1_PREFIX: str = "/api/v1"
    # Set at build time (docker build --build-arg / k8s env), e.g. a git
    # short sha. Never shelled out to `git` at runtime — the container has
    # no .git, and a subprocess per request would be worse anyway.
    APP_VERSION: str = "dev"

    # MongoDB
    MONGODB_URL: str = "mongodb://root:rootpassword@localhost:27418/openghm?authSource=admin"
    MONGODB_DB_NAME: str = "openghm"

    # Redis
    REDIS_URL: str = "redis://localhost:6479/0"

    # Whether a snapshot draft may ask for WBM's climatology (`post_processing`
    # "climatology"; 422 `climatology_unavailable` when off). Off because WBM's
    # post-processing time grows with a snapshot's size and period (the Global
    # snapshot needs about 15 core-hours per variable-year) and the gateway does not
    # predict it per draft yet. When on, a snapshot also needs a measured
    # `recommendedCompute.postProcessingWalltime` to offer it.
    CLIMATOLOGY_ENABLED: bool = False

    # Whether the Workspace is open: creating, editing, running and publishing a
    # snapshot draft (403 `workspace_disabled` when off). A deployment that only
    # shows the repository turns it off; reading, cancelling and deleting the
    # drafts that exist still work. The frontend reads the same variable.
    WORKSPACE_ENABLED: bool = True

    # Object storage (Anvil/RCAC S3). The backend never talks to S3 directly —
    # Slurm job scripts upload outputs from Anvil compute nodes using their own
    # credentials, and datasets/outputs are served as plain public HTTPS links.
    # These are just used to build those link strings.
    S3_PUBLIC_BASE_URL: str = "https://s3.anvil.rcac.purdue.edu"
    S3_BUCKET: str = "openghm"

    # JWT
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60
    # Refresh tokens are opaque random strings (not JWTs) stored hashed on
    # the user document — see app.core.security.generate_refresh_token.
    # Revocation is then a single update_one, no denylist needed.
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3100"]

    # Email (see app.services.email) — password reset + verification links.
    # Empty RESEND_API_KEY means "log instead of send" (local dev default).
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "no-reply@openghm.org"
    # Used to build links embedded in emails (reset/verify pages live on the
    # frontend, not this API) — must be the user-facing origin, not BACKEND_URL.
    FRONTEND_URL: str = "http://localhost:3100"

    # CILogon/OIDC handoff (see app.api.v1.auth.sso_login and
    # web-gateway/frontend/lib/auth.ts). NextAuth performs the actual OIDC handshake and
    # verifies the id_token itself — this backend never talks to CILogon
    # directly, it only trusts NextAuth's server-side callback to hand it an
    # already-verified identity. INTERNAL_SERVICE_SECRET is that trust
    # boundary: without it, POST /auth/sso-login would let anyone mint a
    # valid session for any email by just naming it. Empty by default so a
    # deployment that hasn't configured CILogon can't accidentally expose
    # this endpoint with a guessable/empty secret.
    INTERNAL_SERVICE_SECRET: str = ""

    # reCAPTCHA v2 (see app.services.recaptcha) — POST /auth/register only.
    # Empty means skip verification (local dev default, so signup stays
    # testable without a Google account). The site key is public by design
    # (it's meant to be embedded in the page) and lives on the frontend as
    # RECAPTCHA_SITE_KEY, read per request (docs/architecture/gateway.md), not here.
    RECAPTCHA_SECRET_KEY: str = ""

    # HPC / Anvil — slurmly client config
    ANVIL_SSH_HOST: str = "anvil.rcac.purdue.edu"
    ANVIL_SSH_PORT: int = 22
    ANVIL_SSH_USERNAME: str = ""
    ANVIL_SSH_KEY_PATH: str = ""      # 파일 경로 (key_content 없을 때 사용)
    ANVIL_SSH_KEY_CONTENT: str = ""   # PEM 문자열 직접 입력 (key_path보다 우선)
    ANVIL_REMOTE_BASE_DIR: str = "/anvil/scratch/{username}/openghm"
    ANVIL_PARTITION: str = "shared"
    ANVIL_QOS: str = "cpu"
    ANVIL_ACCOUNT: str = ""
    ANVIL_MAX_CONCURRENT_COMMANDS: int = 4
    ANVIL_EXECUTION_PROFILE: str = "anvil_cpu_modules"
    # The pinned toolkit install a job runs (ADR 0025): a directory named for
    # the public commit, holding bin/openghm and gateway.toml. Empty means no
    # toolkit is installed for this gateway, so submit refuses (503
    # anvil_not_configured) rather than run anything.
    ANVIL_OPENGHM_HOME: str = ""
    # Shared snapshot / model-input / image caches on scratch (ADR 0025), and
    # where `sim run` writes <sim_id>/ (ADR 0023). ANVIL_OUTPUT_BASE must equal
    # the output_base in the toolkit's gateway.toml: the job records
    # <output_base>/<sim_id> as its work directory without asking the toolkit.
    ANVIL_CACHE_DIR: str = "/anvil/scratch/x-openghm/cache"
    ANVIL_OUTPUT_BASE: str = "/anvil/scratch/x-openghm/simulations"
    # The one lock every job's `snapshot fetch` takes (ADR 0025). It must live
    # on /home (NFS): flock on /anvil (GPFS) is node-local, so two jobs on
    # different nodes both held a lock on scratch at once (Anvil jobs 20974770
    # and 20974771), while on /home it serialised across nodes (20974926 on
    # a000, 20974927 on a004). The directory must exist on Anvil.
    ANVIL_FETCH_LOCK: str = "/home/x-openghm/apps/openghm/locks/fetch.lock"
    # Reading WBM output (ADR 0033): where the toolkit writes a `nc` subset for
    # the backend to stream back over SFTP, on Anvil, one file per request and
    # deleted after it. Empty means `<ANVIL_REMOTE_BASE_DIR>/output-downloads`.
    # Scratch, and writable by the gateway's Anvil account; the toolkit creates
    # the directory (mode 0700) on the first download.
    ANVIL_OUTPUT_DOWNLOAD_DIR: str = ""
    # Publishing a snapshot draft (ADR 0031). The user-facing origin the new
    # snapshot's canonical `about.url` is built on (`<origin>/snapshots/<id>`),
    # the form the three published snapshots use. The s3cmd credentials file the
    # publish job hands `openghm snapshot publish --s3cfg`, on Anvil, and
    # never read by the gateway (`~` is expanded by the toolkit, on Anvil). The
    # publish job's walltime: it copies and uploads a whole run, and one with
    # a large output takes hours.
    PUBLIC_SITE_URL: str = "https://openghm.org"
    ANVIL_S3CFG: str = "~/.s3cfg"
    PUBLISH_WALLTIME: str = "4:00:00"

    # Jobs
    JOB_STATUS_POLL_INTERVAL: int = 10
    # The sweep's interval when no job is active; while one is, it runs every
    # JOB_BACKGROUND_SYNC_ACTIVE_INTERVAL (ADR 0027).
    JOB_BACKGROUND_SYNC_INTERVAL: int = 60
    JOB_BACKGROUND_SYNC_ACTIVE_INTERVAL: int = 10
    # How long a SLURM answer, a progress read or a log read is shared between
    # the callers that ask for it (app.services.job_live, ADR 0027).
    JOB_LIVE_TTL_SECONDS: int = 5
    # Log reads are by byte offset: the default and the largest chunk one call
    # returns, and the largest file the download route streams.
    JOB_LOG_READ_DEFAULT_BYTES: int = 262144
    JOB_LOG_READ_MAX_BYTES: int = 1048576
    JOB_LOG_DOWNLOAD_MAX_BYTES: int = 52428800
    # How many active jobs (PENDING/SUBMITTED/RUNNING/COMPLETING) one user
    # may have at once — every job spends the one shared SLURM allocation
    # (ADR 0024). admin and staff are exempt. See app.core.authz.require_submitter.
    JOB_MAX_ACTIVE_PER_USER: int = 2
    # How long a job must stay absent from squeue and sacct before the gateway
    # gives up on it (ADR 0026, rule 4). One lookup that finds nothing proves
    # nothing: slurmly answers "absent" when both commands fail, too.
    JOB_LOST_AFTER_SECONDS: int = 600
    # A submit claims the draft (SUBMITTED) and then awaits sbatch in the request:
    # a few SSH commands of at most 30 s each. A job still SUBMITTED with no SLURM
    # id this long after its last write is a submit that lost its process or its
    # database write, and the sweep gives the draft back (`slurm.
    # reconcile_interrupted_submits`). Keep it well above the longest submit.
    JOB_SUBMIT_INTERRUPTED_AFTER_SECONDS: int = 300
    # A job whose verdict came from a squeue row has no end time (squeue's row
    # has none). The sweep asks sacct for it, once a job has been over for
    # JOB_END_BACKFILL_RETRY_SECONDS (so it is out of squeue) and then again
    # that long after each try that found no end time, at most
    # JOB_END_BACKFILL_MAX_TRIES times, and only for a job that ended within
    # JOB_END_BACKFILL_WINDOW_SECONDS. It never changes the verdict. The same
    # holds for each earlier job of a simulation (`previous_jobs`), with the tries
    # counted on the entry and the window counted from `recorded_at`.
    JOB_END_BACKFILL_WINDOW_SECONDS: int = 86400
    JOB_END_BACKFILL_RETRY_SECONDS: int = 300
    JOB_END_BACKFILL_MAX_TRIES: int = 5
    # A continuation whose submit's answer was lost is tried again by the sweep
    # (`slurm.reconcile_interrupted_submits`); after this many lost answers the
    # simulation fails `continuation_failed`.
    JOB_CONTINUATION_MAX_TRIES: int = 5
    # How often a finished job's work directory is checked for Anvil's purge.
    JOB_FILES_CHECK_INTERVAL_SECONDS: int = 86400


settings = Settings()
