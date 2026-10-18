"""Dependencies: the database handle and the config the app was built with."""

from __future__ import annotations

import sqlite3
from pathlib import Path

# The write handle belongs to the tool that owns the schema and the locks; this
# re-export keeps every existing dashboard caller importing the same name.
from discord_scraper.db import connect_writable


def connect(db_path: str | Path) -> sqlite3.Connection:
    """Open the database **read-only**.

    ``mode=ro`` is enforced by SQLite itself rather than by convention: the web
    process then cannot write even by accident, which is what makes "the API
    only reads rollups" a property of the system and not a promise (spec §4.4).
    """
    conn = sqlite3.connect(f"file:{Path(db_path)}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=10000")
    return conn
