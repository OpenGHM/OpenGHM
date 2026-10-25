"""Google reCAPTCHA v2 verification for POST /auth/register.

Only the public registration form is protected — see
docs/architecture/authentication.md for why the SSO-completion form
isn't: reaching it already requires having signed in through a real
identity provider, a much higher bar than anything a captcha adds.
Keys and setup: ops/docs/reference/external-services.md (private).
"""

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"


async def verify_recaptcha(token: str | None) -> bool:
    """Returns True if the token is valid, or if reCAPTCHA isn't
    configured (empty RECAPTCHA_SECRET_KEY — the local-dev default, so
    registration stays testable without a Google account)."""
    if not settings.RECAPTCHA_SECRET_KEY:
        return True

    if not token:
        return False

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                VERIFY_URL,
                data={"secret": settings.RECAPTCHA_SECRET_KEY, "response": token},
            )
        data = resp.json()
        return bool(data.get("success"))
    except Exception:
        # A reCAPTCHA outage shouldn't be able to block every signup — fail
        # open and log it, the same tradeoff app.services.email makes for
        # a flaky provider.
        logger.exception("reCAPTCHA verification request failed")
        return True
