"""What every admin route shares: the writable handle, the board's config, the audit log."""

from __future__ import annotations

import sqlite3

from fastapi import Request

from discord_stats.api.deps import connect_writable
from discord_scraper.config import Config
from discord_scraper.overrides import apply as effective_config, read as _overrides


def _conn(request: Request) -> sqlite3.Connection:
    return connect_writable(request.app.state.db_path)


def _log_event(request: Request, *, message: str, scope: str, level: str = "info",
               phase: str | None = None, rows: int | None = None,
               seconds: float | None = None) -> None:
    """Write one control-plane log line about an admin action.

    On its own connection, after the action has committed, so the audit line is
    never swept into the action's transaction — and a logging failure can never
    undo the change it describes.
    """
    from discord_scraper.rollups.build import record_event

    conn = _conn(request)
    try:
        record_event(conn, source="api", scope=scope, level=level, phase=phase,
                     message=message, rows=rows, seconds=seconds)
    except sqlite3.Error:
        pass   # the action is already done; a missing log line must not 500 it
    finally:
        conn.close()


def _effective_for(request: Request, conn: sqlite3.Connection) -> Config:
    return effective_config(request.app.state.cfg, _overrides(conn))


def app_db_path(request: Request) -> str:
    return str(request.app.state.db_path)
