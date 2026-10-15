"""Dependencies: the database handle and the config the app was built with."""

from __future__ import annotations

import sqlite3
from pathlib import Path


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


def connect_writable(db_path: str | Path) -> sqlite3.Connection:
    """A read/write handle, for the control plane only.

    Message data is read through ``connect`` (read-only). Sessions, jobs and
    worker state are rows this process must write, so they need a second handle;
    keeping them separate is what preserves "the API cannot alter message data" —
    the guarantee is the file handle, not a coding convention.
    """
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn
