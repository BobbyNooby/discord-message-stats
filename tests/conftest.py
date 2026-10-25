"""Test bootstrap.

Makes ``src/`` importable so the suite runs from a bare checkout with no
install step. The database and config fixtures come from the tool's shared
plugin, ``discord_scraper.testing``; only the API's own fixtures live here.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

pytest_plugins = ["discord_scraper.testing"]


@pytest.fixture
def db_cfg(seeded_db_path, tmp_path):
    """``(config, path)`` for a seeded database with its rollups built.

    Built here because the API reads rollups and never builds them: a server
    that computed on request would be the design this project rejected.
    """
    from discord_scraper.rollups.build import rebuild_all
    from discord_scraper.testing import cfg_fixture

    cfg = cfg_fixture(tmp_path, access={
        "client_id": "test-client",
        "redirect_uri": "https://stats.example/auth/callback",
    })
    connection = sqlite3.connect(seeded_db_path)
    try:
        rebuild_all(connection, cfg)
    finally:
        connection.close()
    return cfg, seeded_db_path


def _client_for(db_cfg, conn, level):
    from fastapi.testclient import TestClient

    from discord_stats.api.app import create_app
    from discord_stats.auth.session import SESSION_COOKIE, establish_session

    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path))
    if level is not None:
        client.cookies.set(SESSION_COOKIE, establish_session(conn, "u1", level))
    return client


@pytest.fixture
def client_for(db_cfg, conn):
    """A client holding a session at the requested level (``None`` = anonymous)."""
    def build(level):
        return _client_for(db_cfg, conn, level)

    return build


@pytest.fixture(autouse=True)
def _no_payload_warmup(monkeypatch):
    """The boot warm-up is a background thread; tests that count assemblies need
    the work to happen where they expect it."""
    monkeypatch.setenv("DISCORD_SCRAPER_NO_WARMUP", "1")


@pytest.fixture
def client(db_cfg, conn):
    """An authenticated client — the viewer every read endpoint expects."""
    from discord_stats.auth.session import Level

    return _client_for(db_cfg, conn, Level.VIEWER)


@pytest.fixture
def client_unauthenticated(db_cfg, conn):
    return _client_for(db_cfg, conn, None)


@pytest.fixture
def viewer_client(client_for):
    """A signed-in viewer — what every read endpoint expects."""
    from discord_stats.auth.session import Level

    return client_for(Level.VIEWER)


@pytest.fixture
def admin_client(client_for):
    """A signed-in admin — the only level that may see the admin surface."""
    from discord_stats.auth.session import Level

    return client_for(Level.ADMIN)
