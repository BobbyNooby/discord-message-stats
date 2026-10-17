"""The FastAPI application factory.

The app is constructed, not global: it takes its config and database path as
arguments, so a test can point it at a fixture and the CLI can point it at the
real 740 MB file without either knowing about the other.
"""

from __future__ import annotations

import sqlite3
import threading
import urllib.parse
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.gzip import GZipMiddleware
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
from discord_scraper.rollups.schema import is_stale

STATE_COOKIE = "dsh_oauth_state"

# 400 cached thumbnails at the 25 MB fetch cap would be 10 GB of resident memory,
# so the cache is bounded by total bytes as well as by entry count.
THUMB_CACHE_BYTES = 256 * 1024 * 1024


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
    # 544 KB of JSON per dashboard load, every load. Gzip takes it to ~140 KB.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    # The payload is a pure function of the rollups and the config, and it costs
    # seconds to assemble — so it is assembled once per rebuild, not per request.
    app.state.payload_cache: dict[str, dict] = {}
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
        from discord_scraper.scraper.database import INDEXES as MESSAGE_INDEXES

        try:
            boot = connect_writable(app.state.db_path)
            try:
                create_rollup_tables(boot)
                create_control_tables(boot)
                boot.executescript(MESSAGE_INDEXES)   # including idx_channel
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

    # ---- thumbnails ---------------------------------------------------------
    # A GIF posted 63 times is worth showing, but letting every viewer's browser
    # fetch it from Tenor hands those CDNs a list of who is reading this chat.
    # `media.thumbnails = "proxy"` (the default) fetches and caches it here; the
    # suffix list is what the data actually contains, and it is a hard allowlist
    # because this endpoint takes a URL from the query string.
    THUMB_SUFFIXES = (
        "ytimg.com", "ggpht.com", "ytimg.googleusercontent.com",
        "tenor.com", "tenor.co", "klipy.com",
        "twimg.com", "discordapp.net", "discordapp.com",
        "akamaihd.net", "scdn.co", "streamable.com", "imgur.com", "redd.it", "reddit.com",
    )
    # Streamed, not buffered: the body is read in chunks and abandoned the moment
    # it passes the cap, so a large asset costs a bounded amount of memory rather
    # than its own size. That is what makes a generous cap safe — and a cap is
    # still needed, because this endpoint fetches a URL from the query string
    # (the largest thumbnail in the reference data is 36.8 MB).
    THUMB_MAX_BYTES = 25 * 1024 * 1024
    THUMB_CACHE_ENTRIES = 400
    # Insertion-ordered, so the front of the dict is the least recently used
    # entry; a hit is moved to the back and eviction takes from the front.
    thumb_cache: dict[str, tuple[float, bytes, str]] = {}
    thumb_cache_bytes = 0
    # Without this, N parallel requests each hold their own 25 MB body, which is
    # what would turn the byte ceiling above into a per-request promise.
    thumb_fetches = threading.Semaphore(4)

    def _thumb_allowed(url: str) -> bool:
        try:
            parsed = urllib.parse.urlparse(url)
        except ValueError:
            return False
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        host = parsed.hostname.lower()
        return any(host == s or host.endswith("." + s) for s in THUMB_SUFFIXES)

    @app.get("/api/thumb")
    def thumb(u: str = Query(..., max_length=2048),
              _level: Level = Depends(require_viewer)) -> Response:
        import time as _time

        import httpx

        nonlocal thumb_cache_bytes
        if not _thumb_allowed(u):
            raise HTTPException(status_code=400, detail="that host is not on the thumbnail allowlist")
        now = _time.monotonic()
        hit = thumb_cache.get(u)
        if hit and hit[0] > now:
            # A hit is a use: move the entry to the most-recently-used end so
            # eviction below throws away the genuinely cold entries.
            thumb_cache[u] = thumb_cache.pop(u)
            return Response(hit[1], media_type=hit[2],
                            headers={"Cache-Control": "public, max-age=86400"})
        too_big = f"that image is larger than {THUMB_MAX_BYTES // 1024 // 1024} MB"
        thumb_fetches.acquire()
        try:
            try:
                # Redirects are not followed: a redirect is how an allowlisted host
                # would be used to reach one that is not.
                with httpx.stream("GET", u, timeout=10.0, follow_redirects=False) as response:
                    kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
                    # mp4 as well as images: the playable asset of a gifv is an mp4,
                    # and routing it through here is what keeps Tenor and Klipy out
                    # of the viewer's browser.
                    if response.status_code != 200 or not (
                        kind.startswith("image/") or kind in ("video/mp4", "video/webm")
                    ):
                        raise HTTPException(status_code=502, detail="that URL did not return an image")
                    declared = response.headers.get("content-length", "")
                    if declared.isdigit() and int(declared) > THUMB_MAX_BYTES:
                        raise HTTPException(status_code=502, detail=too_big)
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body += chunk
                        if len(body) > THUMB_MAX_BYTES:
                            raise HTTPException(status_code=502, detail=too_big)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"thumbnail fetch failed: {exc}") from exc
        finally:
            thumb_fetches.release()
        body = bytes(body)
        # An entry for this URL that has expired is replaced, not double-counted.
        expired = thumb_cache.pop(u, None)
        if expired is not None:
            thumb_cache_bytes -= len(expired[1])
        while thumb_cache and (
            len(thumb_cache) >= THUMB_CACHE_ENTRIES
            or thumb_cache_bytes + len(body) > THUMB_CACHE_BYTES
        ):
            # `dict` keeps insertion order and has no `popitem(last=False)`, so
            # the front of the dict — the least recently used entry — is named.
            coldest = next(iter(thumb_cache))
            thumb_cache_bytes -= len(thumb_cache.pop(coldest)[1])
        thumb_cache[u] = (now + 86400, body, kind)
        thumb_cache_bytes += len(body)
        return Response(body, media_type=kind,
                        headers={"Cache-Control": "public, max-age=86400"})

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
        state = oauth.new_state(cfg.session_secret)
        response = RedirectResponse(oauth.authorize_url(cfg.client_id, cfg.redirect_uri, state))
        response.set_cookie(STATE_COOKIE, state, max_age=600, httponly=True, samesite="lax",
                            secure=True)
        return response

    @app.get("/auth/callback")
    def callback(request: Request, code: str = "", state: str = ""):
        ip = request.client.host if request.client else "unknown"
        expected = request.cookies.get(STATE_COOKIE, "")
        if not oauth.state_is_valid(state, expected, cfg.session_secret):
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

    def assemble(conn: sqlite3.Connection, effective, *, why: str) -> dict:
        import sys
        import time

        started = time.monotonic()
        payload = viewer.bootstrap(conn, effective)
        print(f"payload {why} in {time.monotonic() - started:.2f}s", file=sys.stderr)
        return payload

    def warm_the_payload() -> None:
        """Assemble once, in the background, so the first page load is not the one
        that pays for it.

        Best effort, but not silent: a warm-up that fails must say why, or the
        next person debugging "why is the first load slow" has nothing to read.
        """
        import os
        import sys
        if os.environ.get("DISCORD_SCRAPER_NO_WARMUP"):
            return
        try:
            conn = connection()
            try:
                if not conn.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='rollup_meta'"
                ).fetchone():
                    return
                if not conn.execute("SELECT 1 FROM rollup_meta LIMIT 1").fetchone():
                    return
                effective = admin.effective_for(conn, cfg)
                app.state.payload_cache = {_payload_key(conn, effective):
                                           assemble(conn, effective, why="warmed")}
            finally:
                conn.close()
        except Exception as exc:
            print(f"payload warm-up skipped: {type(exc).__name__}: {exc}", file=sys.stderr)

    threading.Thread(target=warm_the_payload, daemon=True, name="payload-warmup").start()

    @app.get("/api/bootstrap")
    def bootstrap(level: Level = Depends(require_viewer)) -> dict:
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

            key = _payload_key(conn, effective)
            cached = app.state.payload_cache.get(key)
            if cached is None:
                cached = assemble(conn, effective, why="assembled for a request")
                # One entry is enough: rollups change when somebody rebuilds, and
                # a rebuild replaces the key rather than accumulating entries.
                app.state.payload_cache = {key: cached}
            body = dict(cached)
            # Freshness is the one field that can change without a rebuild (a new
            # message arrives), so it is recomputed rather than cached.
            body["meta"] = {
                **cached["meta"],
                # Per-request, like freshness: the payload is shared between
                # viewers, but "may you see /admin" is about the caller.
                "can_admin": level >= Level.ADMIN,
                # `cheap=True`: an indexed MAX(id) instead of a full count. The
                # scraper only appends, so "is there a newer message?" is the
                # question here; the exact count is the CLI's audit.
                "stale": is_stale(conn, effective.channel_id, "activity",
                                  config_hash=key_config_hash(key), cheap=True),
            }
            return body
        finally:
            conn.close()

    @app.get("/api/recent")
    def recent_messages(limit: int | None = Query(None, ge=1, le=200),
                        _level: Level = Depends(require_viewer)) -> dict:
        """The "is this still alive" strip (§11.8), bounded by ``ui.show_recent``.

        ``limit`` lets a caller ask for fewer messages; the 200 ceiling is this
        endpoint's own, so a generous ``ui.show_recent`` cannot widen it.
        """
        from discord_scraper.api.recent import recent

        conn = connection()
        try:
            effective = admin.effective_for(conn, cfg)
            return recent(conn, effective, limit=min(limit or effective.show_recent, 200))
        finally:
            conn.close()

    @app.get("/api/media")
    def media(provider: str | None = Query(None, max_length=64),
              limit: int = Query(12, ge=1, le=100),
              _level: Level = Depends(require_viewer)) -> dict:
        """Top reposted media, optionally for one provider.

        The dashboard's payload ranks everything together, where a GIF beats a
        video link every time; this is how "top YouTube links" becomes visible.
        """
        conn = connection()
        try:
            _require_rollups(conn)
            effective = admin.effective_for(conn, cfg)
            return {
                "provider": provider,
                "items": query.top_media(conn, effective.channel_id, limit, provider=provider),
            }
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


def _payload_key(conn: sqlite3.Connection, cfg) -> str:
    """What the payload depends on: the rollups' provenance and the config.

    Any rebuild moves ``computed_at``, any config edit moves the digest, so a
    matching key means the assembled payload is still the right answer.
    """
    from discord_scraper.rollups.build import config_digest

    row = conn.execute(
        "SELECT MAX(computed_at), MAX(source_max_message_id), COUNT(*) "
        "  FROM rollup_meta WHERE channel_id = ?",
        (cfg.channel_id,),
    ).fetchone()
    return "|".join([
        cfg.channel_id,
        str(row[0]), str(row[1]), str(row[2]),
        config_digest(cfg, conn),
        cfg.timezone,
    ])


def key_config_hash(key: str) -> str:
    """The digest is the fifth field of the cache key."""
    parts = key.split("|")
    return parts[4] if len(parts) > 4 else ""


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
