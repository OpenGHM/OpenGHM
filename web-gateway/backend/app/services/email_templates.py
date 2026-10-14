"""Every transactional email the gateway sends, built on one layout.

`_render()` is the layout: a navy OpenGHM band, a white card with a heading,
the text, one button, the link written out for clients that drop the
button, and a footer. Each email the gateway sends is a small function below
that fills it in, so a new kind of email is one more function, not a new
layout. Every value is HTML-escaped here — the name in a greeting is
whatever the user typed at registration.

The HTML is table-based with inline styles because that is what mail
clients render reliably (Outlook ignores most CSS, Gmail strips <style>).
Each email also carries a plain-text part with the same words.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import escape
from urllib.parse import urlsplit

from app.core.config import settings

# The site's palette (web-gateway/frontend/app/globals.css): --hero,
# --hero-eyebrow, --primary, --accent-foreground.
_NAVY = "#0b2a3d"
_EYEBROW = "#9fd3e6"
_PRIMARY = "#0b6a8f"
_INK = "#10283a"
_BODY = "#33475b"
_MUTED = "#6b7c8a"
_PAGE = "#eef2f5"
_RULE = "#e3e9ee"
_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"


@dataclass(frozen=True)
class Email:
    subject: str
    html: str
    text: str


@dataclass(frozen=True)
class _Action:
    label: str
    url: str


def _render(
    *,
    subject: str,
    preheader: str,
    heading: str,
    name: str,
    paragraphs: list[str],
    action: _Action,
    expiry: str,
    closing: str,
) -> Email:
    site = settings.FRONTEND_URL.rstrip("/")
    host = urlsplit(site).netloc or site
    p_style = f"margin:0 0 16px;font-size:15px;line-height:24px;color:{_BODY};"
    body = "".join(f'<p style="{p_style}">{escape(p)}</p>' for p in paragraphs)
    url = escape(action.url, quote=True)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>{escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:{_PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{_PAGE};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:{_FONT};">
<tr><td style="background:{_NAVY};border-radius:12px 12px 0 0;padding:20px 32px;">
<span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">OpenGHM</span>
<span style="font-size:12px;font-weight:600;color:{_EYEBROW};letter-spacing:1.2px;text-transform:uppercase;padding-left:8px;">Gateway</span>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid {_RULE};border-top:0;border-radius:0 0 12px 12px;padding:32px;">
<h1 style="margin:0 0 20px;font-size:22px;line-height:30px;font-weight:700;color:{_INK};">{escape(heading)}</h1>
<p style="{p_style}">Hi {escape(name)},</p>
{body}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px;">
<tr><td style="background:{_PRIMARY};border-radius:8px;">
<a href="{url}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">{escape(action.label)}</a>
</td></tr>
</table>
<p style="margin:0 0 24px;font-size:13px;line-height:20px;color:{_MUTED};">{escape(expiry)}</p>
<p style="margin:0 0 6px;font-size:13px;line-height:20px;color:{_MUTED};">If the button does not work, copy this link into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;line-height:20px;word-break:break-all;"><a href="{url}" style="color:{_PRIMARY};">{url}</a></p>
<hr style="border:0;border-top:1px solid {_RULE};margin:0 0 20px;">
<p style="margin:0;font-size:13px;line-height:20px;color:{_MUTED};">{escape(closing)}</p>
</td></tr>
<tr><td style="padding:20px 32px;text-align:center;font-size:12px;line-height:18px;color:{_MUTED};">
Sent by <a href="{escape(site, quote=True)}" style="color:{_MUTED};">OpenGHM Gateway</a> ({escape(host)}).<br>
This is an automated message. Replies to it are not read.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
"""

    text = "\n\n".join(
        [
            f"Hi {name},",
            *paragraphs,
            f"{action.label}: {action.url}",
            expiry,
            closing,
            f"-- \nOpenGHM Gateway ({site})\nThis is an automated message. Replies to it are not read.",
        ]
    )
    return Email(subject=subject, html=html, text=text + "\n")


def verification_email(name: str, link: str) -> Email:
    return _render(
        subject="Verify your OpenGHM email address",
        preheader="Confirm your email address to finish setting up your account.",
        heading="Verify your email address",
        name=name,
        paragraphs=[
            "Confirm that this is your email address to finish setting up "
            "your OpenGHM Gateway account.",
        ],
        action=_Action("Verify email address", link),
        expiry="This link expires in 24 hours.",
        closing="If you did not create an OpenGHM Gateway account, you can "
        "ignore this email.",
    )


def link_confirmation_email(name: str, method: str, link: str) -> Email:
    """`method` names the new sign-in method, e.g. "a password sign-in"."""
    return _render(
        subject="Confirm linking a new sign-in method to your OpenGHM account",
        preheader=f"Someone tried to add {method} to your account.",
        heading="Confirm a new sign-in method",
        name=name,
        paragraphs=[
            f"Someone tried to add {method} to your OpenGHM Gateway account "
            "using this email address. If it was you, review and confirm it "
            "with the button below.",
        ],
        action=_Action("Review and confirm", link),
        expiry="This link expires in 24 hours.",
        closing="If it was not you, ignore this email. Nothing changes on "
        "your account unless the link is confirmed.",
    )


def password_reset_email(name: str, link: str, *, has_password: bool = True) -> Email:
    """An account created by CILogon has no password to reset; its email says
    "set" instead, since the person is adding a way in, not recovering one."""
    if not has_password:
        return _render(
            subject="Set a password for your OpenGHM account",
            preheader="Add a password as another way to sign in.",
            heading="Set a password",
            name=name,
            paragraphs=[
                "Someone asked to set a password for your OpenGHM Gateway "
                "account, which you sign in to without one. If it was you, "
                "choose a password with the button below. You can keep using "
                "CILogon too.",
            ],
            action=_Action("Set a password", link),
            expiry="This link expires in 1 hour.",
            closing="If you did not ask for this, you can ignore this email. "
            "Nothing changes on your account unless the link is used.",
        )
    return _render(
        subject="Reset your OpenGHM password",
        preheader="Choose a new password for your account.",
        heading="Reset your password",
        name=name,
        paragraphs=[
            "Someone asked to reset the password for your OpenGHM Gateway "
            "account. If it was you, choose a new password with the button "
            "below.",
        ],
        action=_Action("Choose a new password", link),
        expiry="This link expires in 1 hour.",
        closing="If you did not ask for this, you can ignore this email. "
        "Your password stays as it is.",
    )
