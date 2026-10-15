"""The Discord authorization-code flow — scope `identify` only.

`identify` is the whole requirement: the app needs to know *which* Discord
account is asking, and nothing else. Asking for `guilds` or `email` to render a
stats page would be collecting data for no stated purpose (spec §8.1).
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
TOKEN_URL = "https://discord.com/api/oauth2/token"
ME_URL = "https://discord.com/api/users/@me"
SCOPE = "identify"
TIMEOUT = 15.0


def authorize_url(client_id: str, redirect_uri: str, state: str) -> str:
    """Where to send the browser. ``state`` is the CSRF guard (spec §8.3)."""
    return f"{AUTHORIZE_URL}?" + urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
    })


def exchange_code(
    client_id: str, client_secret: str, code: str, redirect_uri: str
) -> str | None:
    """Trade the code for an access token. ``None`` means "Discord said no"."""
    try:
        response = httpx.post(
            TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    try:
        return response.json().get("access_token")
    except ValueError:
        return None


def fetch_identity(access_token: str) -> dict[str, Any] | None:
    """``GET /users/@me``: the account's id and names, or ``None``."""
    try:
        response = httpx.get(
            ME_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    try:
        return response.json()
    except ValueError:
        return None
