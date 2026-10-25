"""Signing in and out: Discord OAuth, and the local-only development bypass."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from discord_stats.api.deps import database
from discord_stats.auth import oauth
from discord_stats.auth.allowlist import decision_for, record_login_attempt, too_many_attempts
from discord_stats.auth.session import (
    SESSION_COOKIE,
    SESSION_DAYS,
    Level,
    establish_session,
    revoke_session,
)

STATE_COOKIE = "dsh_oauth_state"
SESSION_MAX_AGE = SESSION_DAYS * 24 * 3600

router = APIRouter()
# Mounted only by `serve --dev-login`: an OAuth-less deployment must never be
# able to hand out sessions, so this is a flag and never a default.
dev_router = APIRouter()


def _signed_in(token: str) -> RedirectResponse:
    """Back to the dashboard holding a session cookie."""
    response = RedirectResponse("/")
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_MAX_AGE, httponly=True,
                        samesite="lax", secure=True)
    return response


@router.get("/auth/login")
def login(request: Request):
    cfg = request.app.state.cfg
    ip = request.client.host if request.client else "unknown"
    with database(request, write=True) as conn:
        if too_many_attempts(conn, ip):
            raise HTTPException(status_code=429, detail="too many login attempts")
    if not cfg.client_id or not cfg.redirect_uri:
        raise HTTPException(
            status_code=503,
            detail="OAuth is not configured — set access.client_id and access.redirect_uri",
        )
    state = oauth.new_state(cfg.session_secret)
    response = RedirectResponse(oauth.authorize_url(cfg.client_id, cfg.redirect_uri, state))
    response.set_cookie(STATE_COOKIE, state, max_age=600, httponly=True, samesite="lax",
                        secure=True)
    return response


@router.get("/auth/callback")
def callback(request: Request, code: str = "", state: str = ""):
    cfg = request.app.state.cfg
    ip = request.client.host if request.client else "unknown"
    expected = request.cookies.get(STATE_COOKIE, "")
    if not oauth.state_is_valid(state, expected, cfg.session_secret):
        raise HTTPException(status_code=400, detail="state mismatch")
    token = oauth.exchange_code(cfg.client_id, cfg.client_secret or "", code, cfg.redirect_uri)
    identity = oauth.fetch_identity(token) if token else None
    with database(request, write=True) as conn:
        if not identity or not identity.get("id"):
            record_login_attempt(conn, ip, ok=False)
            raise HTTPException(status_code=403, detail="login failed")
        level = decision_for(conn, cfg, str(identity["id"]))
        if level is None:
            record_login_attempt(conn, ip, ok=False)
            raise HTTPException(status_code=403, detail="not a member of this chat")
        record_login_attempt(conn, ip, ok=True)
        session = establish_session(conn, str(identity["id"]), level)
    response = _signed_in(session)
    response.delete_cookie(STATE_COOKIE)
    return response


@dev_router.get("/auth/dev-login")
def dev_login(request: Request, level: str = "viewer"):
    try:
        chosen = Level[level.upper()]
    except KeyError:
        raise HTTPException(status_code=400, detail="level must be viewer or admin") from None
    with database(request, write=True) as conn:
        token = establish_session(conn, "dev-login", chosen)
    return _signed_in(token)


@router.get("/auth/logout")
def logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE, "")
    if token:
        with database(request, write=True) as conn:
            revoke_session(conn, token)
    response = RedirectResponse("/")
    response.delete_cookie(SESSION_COOKIE)
    return response
