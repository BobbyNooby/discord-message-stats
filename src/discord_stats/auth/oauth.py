"""The Discord authorization-code flow — scope `identify` only.

`identify` is the whole requirement: the app needs to know *which* Discord
account is asking, and nothing else. Asking for `guilds` or `email` to render a
stats page would be collecting data for no stated purpose (spec §8.1).

The dance itself is `authlib`'s: the token endpoint is not a place to hand-roll
form encoding, client authentication and error shapes. Where `SESSION_SECRET`
is set the state cookie also carries an HMAC of the nonce, so a value this
server did not mint is refused before the code is ever exchanged.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

import httpx
from authlib.integrations.httpx_client import OAuth2Client, OAuthError

AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
TOKEN_URL = "https://discord.com/api/oauth2/token"
ME_URL = "https://discord.com/api/users/@me"
SCOPE = "identify"
TIMEOUT = 15.0
STATE_SEPARATOR = "."


def authorize_url(client_id: str, redirect_uri: str, state: str) -> str:
    """Where to send the browser. ``state`` is the CSRF guard (spec §8.3)."""
    with OAuth2Client(client_id=client_id, redirect_uri=redirect_uri) as client:
        url, _ = client.create_authorization_url(
            AUTHORIZE_URL, state=state, scope=SCOPE, response_type="code"
        )
    return url


def exchange_code(
    client_id: str, client_secret: str, code: str, redirect_uri: str
) -> str | None:
    """Trade the code for an access token. ``None`` means "Discord said no"."""
    with OAuth2Client(
        client_id=client_id,
        client_secret=client_secret,
        # Discord wants the credentials in the form body, which is not authlib's
        # default for a confidential client (it would send HTTP Basic instead).
        token_endpoint_auth_method="client_secret_post",
        timeout=TIMEOUT,
    ) as client:
        try:
            token = client.fetch_token(
                TOKEN_URL,
                grant_type="authorization_code",
                code=code,
                redirect_uri=redirect_uri,
            )
        except (OAuthError, httpx.HTTPError, ValueError):
            return None
    return token.get("access_token")


def _sign_state(nonce: str, secret: str) -> str:
    return hmac.new(
        secret.encode("utf-8"), nonce.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def new_state(secret: str | None) -> str:
    """A fresh nonce for the authorize URL, tagged when a key is available.

    Without ``SESSION_SECRET`` this is the opaque random value it always was:
    the cookie still separates two browsers, it just cannot prove the nonce is
    ours. With it, a value that was not minted here fails the HMAC check.
    """
    nonce = secrets.token_urlsafe(24)
    if not secret:
        return nonce
    return f"{nonce}{STATE_SEPARATOR}{_sign_state(nonce, secret)}"


def state_is_valid(returned: str, cookie: str, secret: str | None) -> bool:
    """Whether the callback's ``state`` is the one this browser was given."""
    if not returned or not cookie:
        return False
    if secret:
        nonce, separator, signature = returned.partition(STATE_SEPARATOR)
        if not separator or not hmac.compare_digest(signature, _sign_state(nonce, secret)):
            return False
    return secrets.compare_digest(returned, cookie)


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
