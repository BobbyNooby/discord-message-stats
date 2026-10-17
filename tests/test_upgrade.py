"""An old database upgrades at boot, and still serves.

``CREATE TABLE IF NOT EXISTS`` never adds a column to a table that already
exists, so a database created before a column existed keeps the old shape and
fails the first write that names it. That shipped twice: ``author_names.included``
(the first "hide this person" write on a running instance, "table author_names
has no column named included") and ``rollup_media.animated``. Every other fixture
creates fresh tables, so only a database built in the old shape — and then booted
through ``create_app`` — pins the upgrade.
"""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from discord_scraper.api.app import create_app
from discord_scraper.auth.session import SESSION_COOKIE, Level, establish_session
from discord_scraper.rollups.build import rebuild_all
from discord_scraper.rollups.schema import migrate
from tests.conftest import cfg_fixture

# The pre-migration shape: `messages` exactly as `scraper/database.py` writes it,
# `author_names` without `included`, `rollup_media` without `animated` (the last
# two copied from `rollups/schema.py` with the new columns deleted).
OLD_SCHEMA = """
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_username TEXT,
    content TEXT,
    created_at TEXT NOT NULL,
    edited_at TEXT,
    reply_to_id TEXT,
    has_attachments INTEGER DEFAULT 0,
    type INTEGER,
    pinned INTEGER DEFAULT 0,
    raw TEXT
);

CREATE TABLE author_names (
  channel_id TEXT NOT NULL,
  author_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  renamed    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, author_id)
);

CREATE TABLE rollup_media (
    channel_id TEXT NOT NULL,
    url        TEXT NOT NULL,
    provider   TEXT NOT NULL,
    kind       TEXT NOT NULL,
    title      TEXT,
    thumbnail  TEXT,
    uses       INTEGER NOT NULL,
    first_seen TEXT,
    last_seen  TEXT,
    PRIMARY KEY (channel_id, url)
);
"""

OLD_MESSAGE = (
    "m1", "c1", "u1", "u1handle", "an old message", "2026-01-01T10:00:00+00:00",
    None, None, 0, 0, 0, '{"author": {"id": "u1", "username": "u1handle"}}',
)
OLD_MEDIA_URL = "https://example.test/a.gif"


@pytest.fixture
def old_db_path(tmp_path):
    """A file database in the shape the previous release created, with data in it."""
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    try:
        conn.executescript(OLD_SCHEMA)
        conn.execute(
            "INSERT INTO messages (id, channel_id, author_id, author_username, content,"
            " created_at, edited_at, reply_to_id, has_attachments, type, pinned, raw)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            OLD_MESSAGE,
        )
        conn.execute(
            "INSERT INTO author_names (channel_id, author_id, name, renamed)"
            " VALUES ('c1', 'u1', 'OldName', 0)"
        )
        conn.execute(
            "INSERT INTO rollup_media (channel_id, url, provider, kind, uses)"
            " VALUES ('c1', ?, 'Tenor', 'gif', 3)",
            (OLD_MEDIA_URL,),
        )
        conn.commit()
    finally:
        conn.close()
    return path


@pytest.fixture
def old_cfg(tmp_path):
    return cfg_fixture(tmp_path, access={
        "client_id": "test-client",
        "redirect_uri": "https://stats.example/auth/callback",
    })


def _columns(path, table):
    conn = sqlite3.connect(path)
    try:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    finally:
        conn.close()


def test_the_old_shape_really_lacks_the_columns(old_db_path):
    """The needles are real: an insert naming a new column fails on the old shape.

    These are the two messages a running instance actually hit, which is the
    failure the boot migration exists to prevent.
    """
    conn = sqlite3.connect(old_db_path)
    try:
        with pytest.raises(sqlite3.OperationalError,
                           match="table author_names has no column named included"):
            conn.execute(
                "INSERT INTO author_names (channel_id, author_id, name, included)"
                " VALUES ('c1', 'u2', 'Bob', 1)"
            )
        with pytest.raises(sqlite3.OperationalError,
                           match="table rollup_media has no column named animated"):
            conn.execute(
                "INSERT INTO rollup_media (channel_id, url, provider, kind, animated, uses)"
                " VALUES ('c1', 'https://example.test/b.gif', 'Tenor', 'gif', 'a', 1)"
            )
    finally:
        conn.close()


def test_booting_the_api_adds_the_columns_an_old_database_lacks(old_db_path, old_cfg):
    create_app(old_cfg, old_db_path)

    assert "included" in _columns(old_db_path, "author_names")
    assert "animated" in _columns(old_db_path, "rollup_media")


def test_booting_the_api_keeps_the_rows_the_old_database_had(old_db_path, old_cfg):
    """The migration adds a column; it must never drop or rewrite data."""
    create_app(old_cfg, old_db_path)

    conn = sqlite3.connect(old_db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 1
        assert conn.execute(
            "SELECT content FROM messages WHERE id = 'm1'"
        ).fetchone()[0] == "an old message"
        # an existing author is shown by default, and the name is not rewritten
        assert conn.execute(
            "SELECT included, renamed, name FROM author_names WHERE author_id = 'u1'"
        ).fetchone() == (1, 0, "OldName")
        # an existing media row survives; only the new column is NULL
        assert conn.execute(
            "SELECT provider, kind, uses, animated FROM rollup_media WHERE url = ?",
            (OLD_MEDIA_URL,),
        ).fetchone() == ("Tenor", "gif", 3, None)
    finally:
        conn.close()


def test_the_upgrade_runs_twice_without_error(old_db_path, old_cfg):
    create_app(old_cfg, old_db_path)         # the first boot migrates
    create_app(old_cfg, old_db_path)         # a restart must not fail

    conn = sqlite3.connect(old_db_path)
    try:
        migrate(conn)                        # and the migration itself is repeatable
        migrate(conn)
    finally:
        conn.close()

    assert "included" in _columns(old_db_path, "author_names")
    assert "animated" in _columns(old_db_path, "rollup_media")


def test_an_upgraded_old_database_serves_the_bootstrap_payload(old_db_path, old_cfg):
    app = create_app(old_cfg, old_db_path)

    # The rollups are built on the upgraded database, from the one old message;
    # without the boot migration the media grain could not be written.
    conn = sqlite3.connect(old_db_path)
    try:
        rebuild_all(conn, old_cfg)
        token = establish_session(conn, "u1", Level.VIEWER)
    finally:
        conn.close()

    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, token)
    response = client.get("/api/bootstrap")

    assert response.status_code == 200, response.text
