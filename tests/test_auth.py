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
    seen = {}

    class Response:
        status_code = 200

        def json(self):
            return {"access_token": "an-access-token", "token_type": "Bearer"}

    def fake_post(url, data=None, headers=None, timeout=None):
        seen.update({"url": url, "data": data})
        return Response()

    import httpx

    monkeypatch.setattr(httpx, "post", fake_post)
    token = exchange_code("client-1", "secret", "code-1", "https://stats.example/auth/callback")
    assert token == "an-access-token"
    assert seen["data"]["grant_type"] == "authorization_code"
    assert seen["data"]["code"] == "code-1"
    assert seen["url"].endswith("/oauth2/token")


def test_exchange_code_rejects_a_failed_response(monkeypatch):
    class Response:
        status_code = 400

        def json(self):
            return {"error": "invalid_grant"}

    import httpx

    monkeypatch.setattr(httpx, "post", lambda *a, **k: Response())
    assert exchange_code("c", "s", "bad", "https://x/auth/callback") is None


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
