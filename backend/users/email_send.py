"""
Branded transactional email helper.

Picks the right transport at runtime:
- If `settings.RESEND_API_KEY` is set, POST to Resend's HTTPS API.
  Required on Render and similar platforms that block outbound SMTP.
- Otherwise fall back to Django's configured EMAIL_BACKEND (SMTP for
  local Gmail testing, console backend in DEBUG with no SMTP creds).

The HTML template should reference the logo via a public URL passed in
the context as `logo_url`. CID inline attachments are not used because
the HTTPS API does not support them.
"""

from __future__ import annotations

import logging
from typing import Optional

import requests
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string


LOGGER = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"
DEFAULT_TIMEOUT_SECONDS = 30


def send_branded_email(
    *,
    to_email: str,
    subject: str,
    template_base: str,
    context: dict,
    from_email: Optional[str] = None,
) -> None:
    """
    Render `<template_base>.html` and `<template_base>.txt` from the
    template loader path and send the result.

    Raises on transport error so the caller can mark the row as
    needing a retry and log the cause.
    """
    ctx = dict(context)
    ctx.setdefault("logo_url", getattr(settings, "EMAIL_LOGO_URL", ""))

    html_body = render_to_string(f"{template_base}.html", ctx)
    text_body = render_to_string(f"{template_base}.txt", ctx)

    resolved_from = from_email or getattr(settings, "RESEND_FROM_EMAIL", None) or settings.DEFAULT_FROM_EMAIL

    api_key = getattr(settings, "RESEND_API_KEY", "") or ""
    if api_key:
        _send_via_resend(
            api_key=api_key,
            from_email=resolved_from,
            to_email=to_email,
            subject=subject,
            html=html_body,
            text=text_body,
        )
    else:
        _send_via_django_smtp(
            from_email=resolved_from,
            to_email=to_email,
            subject=subject,
            html=html_body,
            text=text_body,
        )


def _send_via_resend(
    *,
    api_key: str,
    from_email: str,
    to_email: str,
    subject: str,
    html: str,
    text: str,
) -> None:
    """POST to Resend's HTTPS API. https://resend.com/docs/api-reference/emails/send-email"""
    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "text": text,
        "html": html,
    }
    response = requests.post(
        RESEND_ENDPOINT,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=DEFAULT_TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        # Surface the Resend error message in the log so the operator
        # can spot the cause (unverified sender, invalid key, etc).
        try:
            detail = response.json()
        except Exception:
            detail = response.text
        LOGGER.error(
            "Resend send failed | status=%s detail=%s",
            response.status_code,
            detail,
        )
        # Raise so the caller marks the reset row used and returns 400.
        response.raise_for_status()
    LOGGER.info("Resend send OK | to=%s subject=%s", to_email, subject)


def _send_via_django_smtp(
    *,
    from_email: str,
    to_email: str,
    subject: str,
    html: str,
    text: str,
) -> None:
    msg = EmailMultiAlternatives(
        subject=subject,
        body=text,
        from_email=from_email,
        to=[to_email],
    )
    msg.attach_alternative(html, "text/html")
    msg.send(fail_silently=False)
    LOGGER.info("SMTP send OK | to=%s subject=%s", to_email, subject)
