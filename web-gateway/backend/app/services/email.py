"""Transactional email sending (password reset, email verification).

Kept behind a single `send_email()` function so switching providers later —
Brevo, SES, a Purdue SMTP relay if RCAC allowlists it — is a one-file
change; nothing else in the codebase should import `resend` directly.
What the emails say lives in app.services.email_templates.
"""

import logging

import resend

from app.core.config import settings
from app.services.email_templates import Email

logger = logging.getLogger(__name__)

resend.api_key = settings.RESEND_API_KEY


def _log_undelivered(reason: str, to: str, email: Email) -> None:
    """Record an email that didn't get delivered.

    In development the plain-text body is logged, which is what keeps the
    password-reset and verification flows testable locally: the one-time
    link is in there, so a developer can complete the flow with no working
    provider — whether that's because no API key is set or because the
    sending domain isn't verified yet.

    In production only the failure is logged. Those bodies carry
    single-use reset and verification tokens, and anyone who can read the
    logs could otherwise take over an account with them.
    """
    if settings.ENVIRONMENT == "development":
        logger.info(
            "Email not delivered (%s) — body follows so the flow stays "
            "testable.\nTo: %s\nSubject: %s\n%s",
            reason,
            to,
            email.subject,
            email.text,
        )
    else:
        logger.error(
            "Email not delivered (%s) to %s (subject: %s)", reason, to, email.subject
        )


async def send_email(to: str, email: Email) -> None:
    """Send a transactional email.

    Never raises: flows like forgot-password must return the same response
    whether or not the address exists, so a provider outage can't be
    allowed to surface as a 500 and leak that distinction. Undelivered mail
    is logged instead (see _log_undelivered).
    """
    if not settings.RESEND_API_KEY:
        _log_undelivered("RESEND_API_KEY not set", to, email)
        return

    try:
        await resend.Emails.send_async(
            {
                "from": settings.EMAIL_FROM,
                "to": [to],
                "subject": email.subject,
                "html": email.html,
                "text": email.text,
            }
        )
    except Exception:
        logger.exception("Failed to send email to %s (subject: %s)", to, email.subject)
        # Fall back to logging the body as well. Until the sending domain is
        # verified with the provider every send fails, and without this the
        # local reset/verification flows would be untestable the moment an
        # API key is present.
        _log_undelivered("provider error", to, email)
