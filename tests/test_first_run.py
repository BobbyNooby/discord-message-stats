"""A fresh install: a database with no messages must never be an error.

The container's entrypoint seeds an empty volume with the control tables only,
so every endpoint that reads ``messages`` used to answer a 500. These tests
start from exactly that file.
"""

from __future__ import annotations

import sqlite3

import pytest


@pytest.fixture
def fresh_db(tmp_path):
    """What ``docker/entrypoint.sh`` leaves on an empty volume."""
    from discord_scraper.db import connect_writable
    from discord_scraper.rollups.schema import create_control_tables

    path = tmp_path / "messages.db"
    conn = connect_writable(path)
    try:
        create_control_tables(conn)
        conn.commit()
    finally:
        conn.close()
    return path


def _client(cfg, path, level):
    from fastapi.testclient import TestClient

    from discord_scraper.db import connect_writable
    from discord_stats.api.app import create_app
    from discord_stats.auth.session import SESSION_COOKIE, establish_session

    client = TestClient(create_app(cfg, path))
    if level is not None:
        conn = connect_writable(path)
        try:
            client.cookies.set(SESSION_COOKIE, establish_session(conn, "u1", level))
        finally:
            conn.close()
    return client


@pytest.fixture
def fresh_admin(fresh_db, tmp_path):
    from discord_scraper.testing import cfg_fixture
    from discord_stats.auth.session import Level

    # A configured admin id is what sent the overview into `messages`.
    return _client(cfg_fixture(tmp_path, admin_id="9001"), fresh_db, Level.ADMIN)


@pytest.fixture
def fresh_viewer(fresh_db, tmp_path):
    from discord_scraper.testing import cfg_fixture
    from discord_stats.auth.session import Level

    return _client(cfg_fixture(tmp_path, admin_id="9001"), fresh_db, Level.VIEWER)


def test_boot_gives_a_fresh_database_the_messages_table(fresh_admin, fresh_db):
    conn = sqlite3.connect(fresh_db)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(messages)")}
    finally:
        conn.close()
    # The tool's own shape, so the worker's first insert lands in it as is.
    assert {"id", "channel_id", "author_id", "created_at", "type", "pinned", "raw"} <= columns


@pytest.mark.parametrize("path", [
    "/api/admin/status",
    "/api/admin/admins",
    "/api/admin/diagnostics",
    "/api/admin/progress",
    "/api/admin/search?q=pixelfox",
    "/api/admin/jobs",
    "/api/recent",
])
def test_no_admin_read_errors_on_a_fresh_database(fresh_admin, path):
    assert fresh_admin.get(path).status_code == 200, path


def test_the_dashboard_refuses_politely_instead_of_crashing(fresh_viewer):
    response = fresh_viewer.get("/api/bootstrap")
    assert response.status_code == 503
    assert response.json()["detail"]


def test_a_fresh_status_reports_the_configured_admin_as_not_seen_yet(fresh_admin):
    body = fresh_admin.get("/api/admin/status").json()
    assert body["admin"] == {"discord_id": "9001", "known": False}
