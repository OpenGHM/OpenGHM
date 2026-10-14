"""The transactional emails share one layout (app.services.email_templates),
escape what users typed, and go out with an HTML and a plain-text part."""

from __future__ import annotations

import asyncio

import pytest

from app.services import email as email_service
from app.services.email_templates import (
    link_confirmation_email,
    password_reset_email,
    verification_email,
)

LINK = "https://dev.openghm.org/auth/verify-email?token=abc&x=1"

EMAILS = [
    verification_email("Ada", LINK),
    link_confirmation_email("Ada", "a password sign-in", LINK),
    password_reset_email("Ada", LINK),
]


@pytest.mark.parametrize("email", EMAILS, ids=lambda e: e.subject)
def test_every_email_carries_the_link_in_both_parts(email):
    assert (
        email.html.count(
            'href="https://dev.openghm.org/auth/verify-email?token=abc&amp;x=1"'
        )
        == 2
    )
    assert LINK in email.text
    assert "Hi Ada," in email.html and email.text.startswith("Hi Ada,")
    assert "OpenGHM" in email.html and "Replies to it are not read." in email.text


def test_the_subjects_name_what_each_email_is_for():
    assert [e.subject for e in EMAILS] == [
        "Verify your OpenGHM email address",
        "Confirm linking a new sign-in method to your OpenGHM account",
        "Reset your OpenGHM password",
    ]
    assert "expires in 1 hour" in EMAILS[2].text
    assert "a password sign-in" in EMAILS[1].html


def test_a_typed_name_cannot_inject_markup():
    email = verification_email('<a href="https://evil.example">x</a>', LINK)
    assert '<a href="https://evil.example">' not in email.html
    assert (
        "Hi &lt;a href=&quot;https://evil.example&quot;&gt;x&lt;/a&gt;," in email.html
    )
    # The plain-text part is not HTML; it carries the name as typed.
    assert '<a href="https://evil.example">' in email.text


def test_send_email_sends_both_parts(monkeypatch):
    sent = []

    async def fake_send(params):
        sent.append(params)

    monkeypatch.setattr(email_service.settings, "RESEND_API_KEY", "re_test")
    monkeypatch.setattr(email_service.resend.Emails, "send_async", fake_send)
    message = password_reset_email("Ada", LINK)
    asyncio.run(email_service.send_email("ada@example.org", message))
    assert sent == [
        {
            "from": email_service.settings.EMAIL_FROM,
            "to": ["ada@example.org"],
            "subject": message.subject,
            "html": message.html,
            "text": message.text,
        }
    ]


def test_without_a_key_development_logs_the_text_with_its_link(monkeypatch, caplog):
    monkeypatch.setattr(email_service.settings, "RESEND_API_KEY", "")
    monkeypatch.setattr(email_service.settings, "ENVIRONMENT", "development")
    with caplog.at_level("INFO", logger="app.services.email"):
        asyncio.run(
            email_service.send_email("ada@example.org", verification_email("Ada", LINK))
        )
    assert LINK in caplog.text
    assert "<table" not in caplog.text
