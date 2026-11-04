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


# --- /api/setup: what the page shows while there is nothing to show yet -----


def test_setup_needs_a_signed_in_caller(fresh_db, tmp_path):
    from discord_scraper.testing import cfg_fixture

    anonymous = _client(cfg_fixture(tmp_path), fresh_db, None)
    assert anonymous.get("/api/setup").status_code == 401


def test_a_viewer_is_told_only_that_setup_is_under_way(fresh_viewer):
    assert fresh_viewer.get("/api/setup").json() == {"needed": True, "can_admin": False}


def test_an_admin_gets_what_the_first_run_screen_shows(fresh_admin):
    body = fresh_admin.get("/api/setup").json()
    assert body == {
        "needed": True,
        "can_admin": True,
        "channel_id": "c1",
        "messages": 0,
        "rollups_built": False,
        "worker_seen_at": None,
        "job": None,
    }


def test_the_first_scrape_is_the_job_in_flight(fresh_admin):
    fresh_admin.post("/api/admin/jobs", json={"kind": "catch_up"})
    job = fresh_admin.get("/api/setup").json()["job"]
    assert job["kind"] == "catch_up"
    assert job["status"] == "queued"
    assert job["error"] is None


def test_a_job_that_is_not_ingest_or_rebuild_is_not_the_one_shown(fresh_admin):
    fresh_admin.post("/api/admin/jobs", json={"kind": "catch_up"})
    fresh_admin.post("/api/admin/jobs", json={"kind": "probe"})
    assert fresh_admin.get("/api/setup").json()["job"]["kind"] == "catch_up"


def test_a_built_dashboard_needs_no_setup(client):
    assert client.get("/api/setup").json() == {"needed": False, "can_admin": False}


def test_messages_without_rollups_still_need_setup(seeded_db_path, tmp_path, conn):
    from discord_scraper.testing import cfg_fixture
    from discord_stats.auth.session import Level

    admin = _client(cfg_fixture(tmp_path), seeded_db_path, Level.ADMIN)
    body = admin.get("/api/setup").json()
    assert body["needed"] is True
    assert body["rollups_built"] is False
    assert body["messages"] > 0


def test_a_scrape_that_found_nothing_still_needs_setup(fresh_db, tmp_path):
    """A wrong channel id scrapes zero rows and the rebuild still runs."""
    from discord_scraper.db import connect_writable
    from discord_scraper.rollups.build import rebuild_all
    from discord_scraper.testing import cfg_fixture
    from discord_stats.auth.session import Level

    cfg = cfg_fixture(tmp_path)
    viewer = _client(cfg, fresh_db, Level.VIEWER)   # boots, so the table exists
    conn = connect_writable(fresh_db)
    try:
        rebuild_all(conn, cfg)
    finally:
        conn.close()

    assert viewer.get("/api/setup").json()["needed"] is True
    response = viewer.get("/api/bootstrap")
    assert response.status_code == 503
    assert "nothing has been scraped" in response.json()["detail"]


def test_no_channel_yet_needs_setup(fresh_db, tmp_path):
    from discord_scraper.config import load_config
    from discord_scraper.testing import cfg_fixture
    from discord_stats.auth.session import Level

    cfg_fixture(tmp_path)   # writes the .env and a config.toml with a channel
    (tmp_path / "config.toml").write_text('[source]\nchannel_id = ""\n', encoding="utf-8")
    cfg = load_config(env_path=tmp_path / ".env", config_path=tmp_path / "config.toml",
                      require_channel=False)
    body = _client(cfg, fresh_db, Level.ADMIN).get("/api/setup").json()
    assert body["needed"] is True
    assert body["channel_id"] == ""


def test_setup_is_decided_from_the_rollups_alone(db_cfg, client_for):
    """Like the payload (§5.3): a file without its messages still has a dashboard."""
    from discord_stats.auth.session import Level

    _cfg, path = db_cfg
    conn = sqlite3.connect(path)
    try:
        conn.execute("DROP TABLE messages")
        conn.commit()
    finally:
        conn.close()

    assert client_for(Level.VIEWER).get("/api/setup").json()["needed"] is False
