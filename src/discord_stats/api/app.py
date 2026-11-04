"""The FastAPI application factory.

The app is constructed, not global: it takes its config and database path as
arguments, so a test can point it at a fixture and the CLI can point it at the
real 740 MB file without either knowing about the other. The routes live in
their own modules by topic; this file wires them together and owns the state
each app instance keeps (its caches, its config, its database path).
"""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from discord_stats.api import admin, dashboard, login, thumbs
from discord_stats.api.cache import BoundedCache
from discord_stats.api.deps import connect_writable
from discord_scraper.config import Config


def create_app(
    cfg: Config,
    db_path: str | Path,
    static_dir: str | Path | None = None,
    dev_login: bool = False,
) -> FastAPI:
    app = FastAPI(title=cfg.app_name, docs_url=None, redoc_url=None)
    # 544 KB of JSON per dashboard load, every load. Gzip takes it to ~140 KB.
    # Level 6, not the default 9: the same size on this payload at a quarter of
    # the time (about 80 ms against 350 ms), paid on every load.
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
    app.state.cfg = cfg
    app.state.db_path = str(db_path)
    # Per app, never per module: two apps (two tests) must not share a cache.
    app.state.payload_cache: dict[str, dict] = {}
    app.state.period_cache = BoundedCache(dashboard.PERIOD_CACHE_ENTRIES)
    app.state.thumbs = thumbs.ThumbProxy()
    for router in (dashboard.router, login.router, thumbs.router, admin.router):
        app.include_router(router)
    if dev_login:
        app.include_router(login.dev_router)

    _migrate(app)

    # A staged upload from a previous process is unreachable: its id lived in
    # that process's memory and on an operator's screen that has since reloaded.
    # Boot is the one moment nothing can be in flight, so this is where the
    # files a reload orphaned are reclaimed rather than sitting in the size of a
    # database each.
    from discord_stats.api import upload as staging

    staging.sweep_orphans(Path(app.state.db_path).parent)

    if not os.environ.get("DISCORD_SCRAPER_NO_WARMUP"):
        threading.Thread(target=dashboard.warm_the_payload, args=(app,), daemon=True,
                         name="payload-warmup").start()

    _mount_spa(app, static_dir)
    return app


def _migrate(app: FastAPI) -> None:
    """Bring the database up to shape once, at boot.

    `CREATE TABLE IF NOT EXISTS` never adds a column, so an instance started
    before a schema addition fails its first write with "no column named ..." —
    which is exactly what a browser saw. Idempotent, and skipped when there is
    no database yet.

    A fresh volume holds only the control tables, so the empty ``messages``
    table is created here too, from the tool's own DDL. One table here beats a
    guard in every reader: the board, the admin list, search and the recent
    strip all then read an honest zero, and the worker's first scrape inserts
    into the shape it expects. It is schema, not message data, so the API still
    never writes a message.
    """
    if not Path(app.state.db_path).exists():
        return
    from discord_stats.auth.admins import seed_admin
    from discord_scraper.rollups.schema import create_control_tables, create_rollup_tables
    from discord_scraper.scraper.database import INDEXES as MESSAGE_INDEXES
    from discord_scraper.scraper.database import SCHEMA as MESSAGE_SCHEMA

    try:
        boot = connect_writable(app.state.db_path)
        try:
            create_rollup_tables(boot)
            create_control_tables(boot)
            # The configured admin becomes a row here, so "who is an admin"
            # lives in the database by default rather than only in `.env`.
            seed_admin(boot, app.state.cfg.admin_id)
            boot.executescript(MESSAGE_SCHEMA)    # a no-op once the scraper has run
            boot.executescript(MESSAGE_INDEXES)   # including idx_channel
            boot.commit()
        finally:
            boot.close()
    except sqlite3.OperationalError:
        pass   # not a database we can migrate; the endpoints will say so


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
