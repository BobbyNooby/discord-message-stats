"""The FastAPI application factory.

The app is constructed, not global: it takes its config and database path as
arguments, so a test can point it at a fixture and the CLI can point it at the
real 740 MB file without either knowing about the other.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import secrets

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from discord_scraper.api import admin, viewer
from discord_scraper.api.deps import connect, connect_writable
from discord_scraper.auth import oauth
from discord_scraper.auth.allowlist import decision_for, record_login_attempt, too_many_attempts
from discord_scraper.auth.session import (
    SESSION_COOKIE,
    SESSION_DAYS,
    Level,
    establish_session,
    require_viewer,
    revoke_session,
)
from discord_scraper.config import Config
from discord_scraper.rollups import query

STATE_COOKIE = "dsh_oauth_state"


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")
SESSION_MAX_AGE = SESSION_DAYS * 24 * 3600


def _require_rollups(conn: sqlite3.Connection) -> None:
    """Refuse politely when the rollups have never been built.

    A 503 with the command to run beats a 500 with an SQLite traceback, which is
    what an unbuilt database would otherwise produce.
    """
    found = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rollup_meta'"
    ).fetchone()
    if not found:
        raise HTTPException(
            status_code=503,
            detail="rollups are not built — run: discord-scraper rollups rebuild",
        )


def create_app(cfg: Config, db_path: str | Path) -> FastAPI:
    app = FastAPI(title=cfg.app_name, docs_url=None, redoc_url=None)
    app.state.cfg = cfg
    app.state.db_path = str(db_path)
    app.include_router(admin.router)

    def connection() -> sqlite3.Connection:
        return connect(app.state.db_path)

    def writable() -> sqlite3.Connection:
        return connect_writable(app.state.db_path)

    def safe_redirect() -> str:
        """Where to land after login — the payload the browser came for."""
        return "/" if app.state.cfg.redirect_uri else "/"

    @app.get("/api/health")
    def health() -> dict:
        """Liveness plus the banner state (spec §11.7).

        Read from the database on every request, never cached in the process: a
        restart must not reset the banner to healthy.
        """
        from discord_scraper.worker.state import banner_for

        conn = writable()
        try:
            stored = {}
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'worker_state'"
            ).fetchone():
                stored = dict(conn.execute("SELECT key, value FROM worker_state"))
        finally:
            conn.close()
        return {"ok": True, "checked_at": _now(), "banner": banner_for(stored)}

    @app.get("/auth/login")
    def login(request: Request):
        ip = request.client.host if request.client else "unknown"
        conn = writable()
        try:
            if too_many_attempts(conn, ip):
                raise HTTPException(status_code=429, detail="too many login attempts")
        finally:
            conn.close()
        if not cfg.client_id or not cfg.redirect_uri:
            raise HTTPException(
                status_code=503,
                detail="OAuth is not configured — set access.client_id and access.redirect_uri",
            )
        state = secrets.token_urlsafe(24)
        response = RedirectResponse(oauth.authorize_url(cfg.client_id, cfg.redirect_uri, state))
        response.set_cookie(STATE_COOKIE, state, max_age=600, httponly=True, samesite="lax",
                            secure=True)
        return response

    @app.get("/auth/callback")
    def callback(request: Request, code: str = "", state: str = ""):
        ip = request.client.host if request.client else "unknown"
        expected = request.cookies.get(STATE_COOKIE, "")
        if not state or not expected or not secrets.compare_digest(state, expected):
            raise HTTPException(status_code=400, detail="state mismatch")
        token = oauth.exchange_code(cfg.client_id, cfg.client_secret or "", code, cfg.redirect_uri)
        identity = oauth.fetch_identity(token) if token else None
        conn = writable()
        try:
            if not identity or not identity.get("id"):
                record_login_attempt(conn, ip, ok=False)
                raise HTTPException(status_code=403, detail="login failed")
            level = decision_for(conn, cfg, str(identity["id"]))
            if level is None:
                record_login_attempt(conn, ip, ok=False)
                raise HTTPException(status_code=403, detail="not a member of this chat")
            record_login_attempt(conn, ip, ok=True)
            session = establish_session(conn, str(identity["id"]), level)
        finally:
            conn.close()
        response = RedirectResponse(safe_redirect())
        response.set_cookie(
            SESSION_COOKIE, session, max_age=SESSION_MAX_AGE, httponly=True, samesite="lax",
            secure=True,
        )
        response.delete_cookie(STATE_COOKIE)
        return response

    @app.get("/auth/logout")
    def logout(request: Request):
        token = request.cookies.get(SESSION_COOKIE, "")
        if token:
            conn = writable()
            try:
                revoke_session(conn, token)
            finally:
                conn.close()
        response = RedirectResponse("/")
        response.delete_cookie(SESSION_COOKIE)
        return response

    @app.get("/api/bootstrap")
    def bootstrap(_level: Level = Depends(require_viewer)) -> dict:
        conn = connection()
        try:
            _require_rollups(conn)
            # Admin overrides count as "the configured timezone" (§7.1).
            effective = admin.effective_for(conn, cfg)
            recorded = query.provenance_row(conn, effective.channel_id, "activity")
            if recorded and recorded["timezone"] != effective.timezone:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"rollups were built in {recorded['timezone']}, the configured "
                        f"timezone is {effective.timezone} — run: discord-scraper "
                        "rollups rebuild"
                    ),
                )
            return viewer.bootstrap(conn, effective)
        finally:
            conn.close()

    @app.get("/api/words")
    def words(q: str = Query(..., min_length=1), limit: int = Query(50, ge=1, le=500),
              _level: Level = Depends(require_viewer)) -> dict:
        """Search the **full** word index, which the payload only slices."""
        conn = connection()
        try:
            _require_rollups(conn)
            from discord_scraper.rollups import query

            matches = query.words_for(conn, cfg.channel_id, q.strip().lower())
            names = {row["id"]: row["name"] for row in query.authors(conn, cfg.channel_id)}
            return {
                "word": q.strip().lower(),
                "total": sum(count for _author, count in matches),
                "authors": [
                    {"id": author_id, "name": names.get(author_id, author_id), "count": count}
                    for author_id, count in matches[:limit]
                ],
            }
        finally:
            conn.close()

    return app
