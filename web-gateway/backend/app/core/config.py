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
    # NEXT_PUBLIC_RECAPTCHA_SITE_KEY, not here.
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
    ANVIL_CONTAINER_IMAGE: str = ""

    # Job defaults
    JOB_DEFAULT_WALLTIME: str = "02:00:00"
    JOB_DEFAULT_NODES: int = 1
    JOB_DEFAULT_NTASKS: int = 1
    JOB_STATUS_POLL_INTERVAL: int = 10
    JOB_BACKGROUND_SYNC_INTERVAL: int = 60
    # How many active jobs (PENDING/SUBMITTED/RUNNING/COMPLETING) one user
    # may have at once — every job spends the one shared SLURM allocation
    # (ADR 0024). admin and staff are exempt. See app.core.authz.require_submitter.
    JOB_MAX_ACTIVE_PER_USER: int = 2


settings = Settings()
