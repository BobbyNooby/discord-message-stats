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
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

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
    built = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rollup_meta'"
    ).fetchone() is not None and conn.execute(
        "SELECT 1 FROM rollup_meta LIMIT 1"
    ).fetchone() is not None
    if not built:
        raise HTTPException(
            status_code=503,
            detail="rollups are not built — run: discord-scraper rollups rebuild",
        )


def create_app(
    cfg: Config,
    db_path: str | Path,
    static_dir: str | Path | None = None,
    dev_login: bool = False,
    dev_auto_login: str | None = None,
) -> FastAPI:
    app = FastAPI(title=cfg.app_name, docs_url=None, redoc_url=None)
    app.state.cfg = cfg
    app.state.db_path = str(db_path)
    # "viewer" or "admin", or None. Set by `serve --dev-auto-login`.
    app.state.dev_auto_login = dev_auto_login
    app.include_router(admin.router)

    # Bring the database up to shape once, at boot. `CREATE TABLE IF NOT EXISTS`
    # never adds a column, so an instance started before a schema addition fails
    # its first write with "no column named ..." — which is exactly what a
    # browser saw. Idempotent, control plane only, and skipped when there is no
    # database yet.
    if Path(app.state.db_path).exists():
        from discord_scraper.rollups.schema import create_control_tables, create_rollup_tables

        try:
            boot = connect_writable(app.state.db_path)
            try:
                create_rollup_tables(boot)
                create_control_tables(boot)
                boot.commit()
            finally:
                boot.close()
        except sqlite3.OperationalError:
            pass   # not a database we can migrate; the endpoints will say so

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

    if dev_login:
        # Deliberately a flag, never a default: an OAuth-less deployment must not
        # be able to hand out sessions. `serve --dev-login` prints a warning.
        @app.get("/auth/dev-login")
        def dev_login_route(level: str = "viewer"):
            from discord_scraper.auth.session import Level, establish_session

            try:
                chosen = Level[level.upper()]
            except KeyError:
                raise HTTPException(status_code=400, detail="level must be viewer or admin") from None
            conn = writable()
            try:
                token = establish_session(conn, "dev-login", chosen)
            finally:
                conn.close()
            response = RedirectResponse("/")
            response.set_cookie(
                SESSION_COOKIE, token, max_age=SESSION_MAX_AGE, httponly=True, samesite="lax",
                secure=True,
            )
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

    @app.get("/api/recent")
    def recent_messages(_level: Level = Depends(require_viewer)) -> dict:
        """The "is this still alive" strip (§11.8), bounded by ``ui.show_recent``."""
        from discord_scraper.api.recent import recent

        conn = connection()
        try:
            effective = admin.effective_for(conn, cfg)
            return recent(conn, effective)
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

    _mount_spa(app, static_dir)
    return app


def _mount_spa(app: FastAPI, static_dir: str | Path | None) -> None:
    """Serve the built SPA from the same port as the API (§4.7).

    Registered last, so every ``/api`` route matches first. ``/admin`` and
    ``/login`` are routes rather than files because the SPA owns those paths —
    without them a deep link would 404 on refresh, which is the classic way a
    single-port SPA deployment loses its admin page.
    """
    if static_dir is None:
        return
    directory = Path(static_dir)
    index = directory / "index.html"
    if not index.is_file():
        return

    @app.get("/admin", include_in_schema=False)
    @app.get("/login", include_in_schema=False)
    def spa_route():
        return FileResponse(index)

    app.mount("/", StaticFiles(directory=str(directory), html=True), name="spa")
