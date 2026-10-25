"""What every admin route shares: the board's config and the audit log."""

from __future__ import annotations

import sqlite3

from fastapi import Request

from discord_stats.api.deps import board, database
from discord_scraper.config import Config


def saved_config(request: Request) -> Config:
    """The config with the board's saved settings, for a route that reads nothing else."""
    with board(request, write=True) as (_conn, cfg):
        return cfg


def log_event(request: Request, *, message: str, scope: str, level: str = "info",
              phase: str | None = None, rows: int | None = None,
              seconds: float | None = None) -> None:
    """Write one control-plane log line about an admin action.

    On its own connection, after the action has committed, so the audit line is
    never swept into the action's transaction — and a logging failure can never
    undo the change it describes.
    """
    from discord_scraper.rollups.build import record_event

    with database(request, write=True) as conn:
        try:
            record_event(conn, source="api", scope=scope, level=level, phase=phase,
                         message=message, rows=rows, seconds=seconds)
        except sqlite3.Error:
            pass   # the action is already done; a missing log line must not 500 it


def app_db_path(request: Request) -> str:
    return str(request.app.state.db_path)
