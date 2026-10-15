"""The FastAPI application factory.

The app is constructed, not global: it takes its config and database path as
arguments, so a test can point it at a fixture and the CLI can point it at the
real 740 MB file without either knowing about the other.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query

from discord_scraper.api import viewer
from discord_scraper.api.deps import connect
from discord_scraper.config import Config


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

    def connection() -> sqlite3.Connection:
        return connect(app.state.db_path)

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    @app.get("/api/bootstrap")
    def bootstrap() -> dict:
        conn = connection()
        try:
            _require_rollups(conn)
            return viewer.bootstrap(conn, cfg)
        finally:
            conn.close()

    @app.get("/api/words")
    def words(q: str = Query(..., min_length=1), limit: int = Query(50, ge=1, le=500)) -> dict:
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
