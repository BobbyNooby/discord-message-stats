import sqlite3

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from discord_scraper.auth.allowlist import decision_for, record_login_attempt, too_many_attempts
from discord_scraper.auth.oauth import authorize_url, exchange_code
from discord_scraper.auth.session import (
    SESSION_COOKIE,
    Level,
    establish_session,
    revoke_session,
    session_level,
)
from discord_scraper.rollups.schema import create_control_tables, create_rollup_tables
from tests.conftest import cfg_fixture


# --- sessions ----------------------------------------------------------------

def test_sessions_are_revocable(conn):
    """The plan's version updated `WHERE id = <token>`; rows store a hash (§8.2),
    so the update has to go through the same hashing the lookup uses."""
    from discord_scraper.auth.session import hash_token

    sid = establish_session(conn, "u1", Level.VIEWER)
    assert session_level(conn, sid) is Level.VIEWER
    conn.execute("UPDATE sessions SET revoked = 1 WHERE id = ?", (hash_token(sid),))
    assert session_level(conn, sid) is None


def test_a_session_token_is_not_stored_in_the_clear(conn):
    sid = establish_session(conn, "u1", Level.ADMIN)
    stored = conn.execute("SELECT id FROM sessions").fetchone()[0]
    assert stored != sid
    assert len(stored) == 64          # sha256 hex, not the bearer token


def test_an_unknown_or_expired_session_is_none(conn):
    assert session_level(conn, "not-a-session") is None
    sid = establish_session(conn, "u1", Level.VIEWER, ttl_days=-1)
    assert session_level(conn, sid) is None


def test_revoke_session(conn):
    sid = establish_session(conn, "u1", Level.VIEWER)
    revoke_session(conn, sid)
    assert session_level(conn, sid) is None


def test_a_login_loop_keeps_at_most_twenty_sessions_per_identity(conn):
    """Nothing else evicts, so 25 logins used to mean 25 rows and 25 live tokens."""
    tokens = [establish_session(conn, "u1", Level.VIEWER) for _ in range(25)]

    kept = conn.execute(
        "SELECT COUNT(*) FROM sessions WHERE discord_id = 'u1'"
    ).fetchone()[0]
    assert kept == 20
    assert session_level(conn, tokens[-1]) is Level.VIEWER   # the newest still works
    assert session_level(conn, tokens[0]) is None            # the oldest is gone


def test_the_session_cap_is_per_identity(conn):
    old = establish_session(conn, "u1", Level.VIEWER)
    for _ in range(25):
        establish_session(conn, "u2", Level.VIEWER)
    assert session_level(conn, old) is Level.VIEWER
    assert conn.execute(
        "SELECT COUNT(*) FROM sessions WHERE discord_id = 'u1'"
    ).fetchone()[0] == 1


def test_session_levels_compare_by_privilege():
    assert Level.ADMIN > Level.VIEWER


# --- the privilege matrix ----------------------------------------------------

def _guarded(dependency):
    def endpoint(level: Level = Depends(dependency)):
        return {"level": level.value}

    return endpoint


@pytest.mark.parametrize("dependency,level,expected", [
    ("viewer", None, 401),
    ("viewer", Level.VIEWER, 200),
    ("viewer", Level.ADMIN, 200),     # an admin is also a viewer
    ("admin", None, 401),
    ("admin", Level.VIEWER, 403),
    ("admin", Level.ADMIN, 200),
])
def test_privilege_matrix(db_cfg, conn, dependency, level, expected):
    from discord_scraper.api.app import create_app
    from discord_scraper.auth.session import require_admin, require_viewer

    cfg, path = db_cfg
    configured = create_app(cfg, path)
    dependency_fn = require_viewer if dependency == "viewer" else require_admin

    guarded = FastAPI()
    guarded.get("/guarded")(_guarded(dependency_fn))
    guarded.state.cfg = configured.state.cfg
    guarded.state.db_path = configured.state.db_path

    client = TestClient(guarded)
    if level is not None:
        client.cookies.set(SESSION_COOKIE, establish_session(conn, "u1", level))
    assert client.get("/guarded").status_code == expected


def test_bootstrap_requires_a_session(client_unauthenticated):
    assert client_unauthenticated.get("/api/bootstrap").status_code == 401


def test_bootstrap_accepts_a_viewer(client_for):
    assert client_for(Level.VIEWER).get("/api/bootstrap").status_code == 200


# --- allowlist ---------------------------------------------------------------

def test_the_admin_id_is_admin_and_a_poster_is_a_viewer(conn, tmp_path):
    cfg = cfg_fixture(tmp_path, admin_id="admin-1")
    assert decision_for(conn, cfg, "admin-1") is Level.ADMIN
    assert decision_for(conn, cfg, "u1") is Level.VIEWER       # u1 has posted
    assert decision_for(conn, cfg, "stranger") is None


def test_an_explicit_allow_row_admits_a_lurker(conn, tmp_path):
    cfg = cfg_fixture(tmp_path)
    conn.execute(
        "INSERT INTO viewers (discord_id, note, allow, added_at) VALUES ('lurker', NULL, 1, 'now')"
    )
    assert decision_for(conn, cfg, "lurker") is Level.VIEWER


def test_an_explicit_deny_row_removes_a_poster(conn, tmp_path):
    cfg = cfg_fixture(tmp_path)
    conn.execute(
        "INSERT INTO viewers (discord_id, note, allow, added_at) VALUES ('u1', NULL, 0, 'now')"
    )
    assert decision_for(conn, cfg, "u1") is None


def test_allowlist_policy_can_deny_by_default(conn, tmp_path):
    cfg = cfg_fixture(tmp_path, access={"allowlist": "explicit"})
    assert decision_for(conn, cfg, "u1") is None       # posted, but policy is explicit-only


# --- login hardening ---------------------------------------------------------

def test_failed_logins_are_rate_limited(conn):
    for _ in range(10):
        record_login_attempt(conn, "203.0.113.5", ok=False)
    assert too_many_attempts(conn, "203.0.113.5") is True
    assert too_many_attempts(conn, "203.0.113.6") is False


def test_a_successful_login_clears_the_attempts(conn):
    for _ in range(10):
        record_login_attempt(conn, "203.0.113.5", ok=False)
    record_login_attempt(conn, "203.0.113.5", ok=True)
    assert too_many_attempts(conn, "203.0.113.5") is False


# --- oauth -------------------------------------------------------------------

def test_authorize_url_asks_for_identify_and_carries_state():
    url = authorize_url("client-1", "https://stats.example/auth/callback", "state-1")
    assert url.startswith("https://discord.com/oauth2/authorize?")
    assert "scope=identify" in url
    assert "state=state-1" in url
    assert "client_id=client-1" in url
    assert "response_type=code" in url
    assert "redirect_uri=https%3A%2F%2Fstats.example%2Fauth%2Fcallback" in url


def test_exchange_code_posts_the_code_and_returns_the_token(monkeypatch):
    """Intercepted at the transport, not at ``httpx.post`` — authlib drives an
    ``httpx.Client`` instance, so the module function is never the seam."""
    from urllib.parse import parse_qs

    import httpx

    seen = {}

    def fake_handle_request(self, request):
        seen.update({"url": str(request.url),
                     "data": {k: v[0] for k, v in parse_qs(request.content.decode()).items()}})
        return httpx.Response(
            200, json={"access_token": "an-access-token", "token_type": "Bearer"}, request=request
        )

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", fake_handle_request)
    token = exchange_code("client-1", "secret", "code-1", "https://stats.example/auth/callback")
    assert token == "an-access-token"
    assert seen["data"]["grant_type"] == "authorization_code"
    assert seen["data"]["code"] == "code-1"
    assert seen["url"].endswith("/oauth2/token")


def test_exchange_code_rejects_a_failed_response(monkeypatch):
    import httpx

    def fake_handle_request(self, request):
        return httpx.Response(400, json={"error": "invalid_grant"}, request=request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", fake_handle_request)
    assert exchange_code("c", "s", "bad", "https://x/auth/callback") is None


def test_the_token_exchange_is_made_by_authlib(monkeypatch):
    """The code is traded by ``authlib``'s client, and its POST carries the
    code, the grant and the credentials Discord expects in the body."""
    from urllib.parse import parse_qs

    import httpx
    from authlib.integrations.httpx_client import OAuth2Client

    seen = {}
    real_fetch_token = OAuth2Client.fetch_token

    def spy_fetch_token(self, url=None, **kwargs):
        seen["client"] = type(self)
        seen["endpoint"] = url
        return real_fetch_token(self, url, **kwargs)

    def fake_handle_request(self, request):
        seen["body"] = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        return httpx.Response(200, json={"access_token": "authlib-token"}, request=request)

    monkeypatch.setattr(OAuth2Client, "fetch_token", spy_fetch_token)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", fake_handle_request)

    token = exchange_code("client-1", "secret", "code-1", "https://stats.example/auth/callback")
    assert token == "authlib-token"
    assert issubclass(seen["client"], OAuth2Client)
    assert seen["endpoint"] == "https://discord.com/api/oauth2/token"
    assert seen["body"]["grant_type"] == "authorization_code"
    assert seen["body"]["code"] == "code-1"
    assert seen["body"]["client_id"] == "client-1"


def test_the_authorize_url_still_carries_the_five_oauth_fields(db_cfg):
    from fastapi.testclient import TestClient

    from discord_scraper.api.app import create_app

    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path), base_url="https://stats.example")
    location = client.get("/auth/login", follow_redirects=False).headers["location"]
    for field in ("client_id=test-client", "response_type=code", "scope=identify",
                  "redirect_uri=https%3A%2F%2Fstats.example%2Fauth%2Fcallback"):
        assert field in location, field
    assert "state=" in location


# --- the login round trip ----------------------------------------------------

def test_login_redirects_to_discord_and_sets_a_state_cookie(db_cfg):
    from fastapi.testclient import TestClient

    from discord_scraper.api.app import create_app

    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path), base_url="https://stats.example")
    response = client.get("/auth/login", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert response.headers["location"].startswith("https://discord.com/oauth2/authorize?")
    body = response.text or response.headers.get("location", "")
    assert "scope=identify" in body
    assert client.cookies.get("dsh_oauth_state")


def test_callback_rejects_a_mismatched_state(db_cfg):
    from fastapi.testclient import TestClient

    from discord_scraper.api.app import create_app

    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path), base_url="https://stats.example")
    client.cookies.set("dsh_oauth_state", "the-real-state")
    response = client.get("/auth/callback?code=x&state=a-different-state")
    assert response.status_code == 400


def test_callback_rejects_a_missing_state(db_cfg):
    from fastapi.testclient import TestClient

    from discord_scraper.api.app import create_app

    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path), base_url="https://stats.example")
    assert client.get("/auth/callback?code=x").status_code == 400


def test_a_state_cookie_signed_with_another_secret_is_rejected(db_cfg):
    """The cookie is not trusted on its own: the HMAC has to verify with the
    server's ``SESSION_SECRET``, so a forged pair is still a mismatch."""
    from dataclasses import replace

    from fastapi.testclient import TestClient

    from discord_scraper.api.app import create_app
    from discord_scraper.auth import oauth

    cfg, path = db_cfg
    signed = replace(cfg, secrets=replace(cfg.secrets, session_secret="the-real-key"))
    client = TestClient(create_app(signed, path), base_url="https://stats.example")
    forged = oauth.new_state("a-different-key")
    client.cookies.set("dsh_oauth_state", forged)
    response = client.get(f"/auth/callback?code=x&state={forged}")
    assert response.status_code == 400


def test_a_valid_signed_state_round_trips_into_a_session(db_cfg, conn, monkeypatch):
    """The state ``/auth/login`` mints and signs is the one the callback
    accepts, and the fake token the provider hands back still ends in a
    revocable session row."""
    from dataclasses import replace
    from urllib.parse import parse_qs, urlparse

    import httpx
    from fastapi.testclient import TestClient

    from discord_scraper.api.app import create_app
    from discord_scraper.auth import oauth

    cfg, path = db_cfg
    signed = replace(cfg, secrets=replace(cfg.secrets, session_secret="a-signing-key"))

    def fake_handle_request(self, request):
        return httpx.Response(200, json={"access_token": "fake-token"}, request=request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", fake_handle_request)
    monkeypatch.setattr(oauth, "fetch_identity",
                        lambda token: {"id": "u1", "username": "u1handle"})

    client = TestClient(create_app(signed, path), base_url="https://stats.example")
    login = client.get("/auth/login", follow_redirects=False)
    state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]
    assert state == client.cookies.get("dsh_oauth_state")   # signed, and the same one

    response = client.get(f"/auth/callback?code=code-1&state={state}", follow_redirects=False)
    assert response.status_code in (302, 307)
    token = client.cookies.get(SESSION_COOKIE)
    assert token
    assert session_level(conn, token) is Level.VIEWER
