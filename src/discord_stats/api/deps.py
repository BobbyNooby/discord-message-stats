"""Dependencies: the database handle and the config the app was built with."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from fastapi import Request

from discord_scraper.config import Config
# The handles belong to the tool that owns the schema and the locks;
# ``connect_writable`` is re-exported so dashboard callers import one name.
from discord_scraper.db import connect_readonly, connect_writable
from discord_scraper.overrides import effective_for


def connect(db_path: str | Path) -> sqlite3.Connection:
    """Open the database **read-only**.

    ``mode=ro`` is enforced by SQLite itself rather than by convention: the web
    process then cannot write even by accident, which is what makes "the API
    only reads rollups" a property of the system and not a promise (spec §4.4).
    """
    return connect_readonly(db_path)


@contextmanager
def database(request: Request, *, write: bool = False) -> Iterator[sqlite3.Connection]:
    """The request's database for the length of a ``with`` block, then closed.

    Read-only unless ``write``: only the control plane (sessions, jobs, the
    admin board's settings) is ever written from here.
    """
    path = request.app.state.db_path
    conn = connect_writable(path) if write else connect(path)
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def board(request: Request, *, write: bool = False) -> Iterator[tuple[sqlite3.Connection, Config]]:
    """``database`` plus the config with the admin board's saved settings applied.

    Almost every endpoint wants both: the settings live in the database, and
    the channel, zone and word lists they hold decide what any query means.
    """
    with database(request, write=write) as conn:
        yield conn, effective_for(conn, request.app.state.cfg)
