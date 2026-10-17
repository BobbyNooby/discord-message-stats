"""The admin board's write paths: identity merges, who shows, sessions, cron.

All four are "change an aggregate" operations, so each one has to leave the
cache visibly stale — a config change that silently leaves the numbers wrong is
the failure mode §11.6 exists to prevent.
"""

import sqlite3

from discord_scraper.rollups.build import rebuild_all, config_digest
from discord_scraper.rollups.schema import is_stale
from tests.conftest import cfg_fixture


def test_a_merge_is_written_and_a_rebuild_folds_the_accounts(admin_client, conn, tmp_path):
    response = admin_client.put(
        "/api/admin/identity", json={"merges": [{"canonical": "u1", "accounts": ["u2"]}]}
    )
    assert response.status_code == 200
    assert response.json()["merges"] == [{"canonical": "u1", "accounts": ["u1", "u2"]}]
    assert response.json()["cache_stale"] is True

    rebuild_all(conn, cfg_fixture(tmp_path))
    authors = conn.execute(
        "SELECT DISTINCT author_id FROM rollup_activity ORDER BY author_id"
    ).fetchall()
    assert [row[0] for row in authors] == ["u1"]          # u2 folded in
    assert conn.execute("SELECT SUM(msgs) FROM rollup_activity").fetchone()[0] == 5


def test_unmerging_is_the_same_call_without_the_account(admin_client, conn, tmp_path):
    admin_client.put("/api/admin/identity", json={"merges": [{"canonical": "u1", "accounts": ["u2"]}]})
    admin_client.put("/api/admin/identity", json={"merges": []})
    rebuild_all(conn, cfg_fixture(tmp_path))
    authors = [row[0] for row in conn.execute(
        "SELECT DISTINCT author_id FROM rollup_activity ORDER BY author_id")]
    assert authors == ["u1", "u2"]


def test_a_merge_rejects_a_canonical_that_is_its_own_alt(admin_client):
    response = admin_client.put(
        "/api/admin/identity", json={"merges": [{"canonical": "u1", "accounts": ["u2", "u2"]}]}
    )
    assert response.status_code == 400


def test_hiding_an_identity_removes_it_from_every_rollup(admin_client, conn, tmp_path):
    assert admin_client.put("/api/admin/inclusions", json={"included": {"u2": False}}).status_code == 200
    rebuild_all(conn, cfg_fixture(tmp_path))
    authors = [row[0] for row in conn.execute(
        "SELECT DISTINCT author_id FROM rollup_activity ORDER BY author_id")]
    assert authors == ["u1"]
    # hidden, never deleted: the messages are all still there
    assert conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 7


def test_hiding_marks_the_cache_stale(admin_client):
    body = admin_client.put("/api/admin/inclusions", json={"included": {"u2": False}}).json()
    assert body["cache_stale"] is True
    assert admin_client.get("/api/admin/status").json()["cache_stale"] is True


def test_showing_again_restores_the_rollup(admin_client, conn, tmp_path):
    admin_client.put("/api/admin/inclusions", json={"included": {"u2": False}})
    admin_client.put("/api/admin/inclusions", json={"included": {"u2": True}})
    rebuild_all(conn, cfg_fixture(tmp_path))
    authors = [row[0] for row in conn.execute(
        "SELECT DISTINCT author_id FROM rollup_activity ORDER BY author_id")]
    assert authors == ["u1", "u2"]


def test_status_reports_the_database_size_and_the_admin_id(admin_client, tmp_path):
    body = admin_client.get("/api/admin/status").json()
    assert body["database"]["size_bytes"] > 0
    assert body["admin"]["discord_id"] == ""


def test_revoke_all_ends_every_session_but_the_caller(admin_client, conn, client_for):
    from discord_scraper.auth.session import Level

    other = client_for(Level.VIEWER)
    assert other.get("/api/bootstrap").status_code == 200
    response = admin_client.post("/api/admin/sessions/revoke-all")
    assert response.status_code == 200
    assert response.json()["revoked"] >= 1
    assert other.get("/api/bootstrap").status_code == 401      # signed out
    assert admin_client.get("/api/admin/status").status_code == 200   # still in


def test_cron_settings_are_writable_and_reach_the_worker(admin_client, conn):
    from discord_scraper.worker.scheduler import cron_hours, schedule_enabled

    response = admin_client.put("/api/admin/config", json={"cron_enabled": False, "cron_hours": 12})
    assert response.status_code == 200
    assert schedule_enabled(conn) is False        # the running worker sees it
    assert cron_hours(conn) == 12
    effective = response.json()["effective"]
    assert effective["cron_enabled"] is False and effective["cron_hours"] == 12


def test_an_invalid_cron_hour_is_rejected(admin_client):
    assert admin_client.put("/api/admin/config", json={"cron_hours": 0}).status_code == 400
    assert admin_client.put("/api/admin/config", json={"cron_hours": 99}).status_code == 400


def test_the_api_migrates_an_older_database_at_boot(seeded_db_path, tmp_path):
    """The bug a browser found: an instance started before a schema addition.

    The old `author_names` shape has no `included` column, and the first write to
    /api/admin/inclusions failed with "no column named included" — 500, in the
    UI, on a real database. The fix is a migration at boot.
    """
    import sqlite3

    from fastapi.testclient import TestClient

    from discord_scraper.api.app import create_app
    from discord_scraper.auth.session import SESSION_COOKIE, Level, establish_session
    from discord_scraper.rollups.schema import create_control_tables

    # rebuild the old table shape over an otherwise valid database
    conn = sqlite3.connect(seeded_db_path)
    create_control_tables(conn)
    conn.execute("DROP TABLE author_names")
    conn.executescript(
        """
        CREATE TABLE author_names (
          channel_id TEXT NOT NULL,
          author_id  TEXT NOT NULL,
          name       TEXT NOT NULL,
          renamed    INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (channel_id, author_id)
        );
        """
    )
    conn.commit()
    token = establish_session(conn, "u1", Level.ADMIN)
    conn.close()

    cfg = cfg_fixture(tmp_path)
    from discord_scraper.rollups.build import rebuild_all

    conn = sqlite3.connect(seeded_db_path)
    try:
        rebuild_all(conn, cfg)
    finally:
        conn.close()

    client = TestClient(create_app(cfg, seeded_db_path))
    client.cookies.set(SESSION_COOKIE, token)
    response = client.put("/api/admin/inclusions", json={"included": {"u2": False}})
    assert response.status_code == 200, response.text


def test_status_says_when_the_admin_id_matches_no_message(admin_client):
    """A typo'd ADMIN_DISCORD_ID means "nobody is admin" in silence; the board
    has to say so instead of showing an id that looks configured (audit #5)."""
    from dataclasses import replace

    cfg = admin_client.app.state.cfg
    admin_client.app.state.cfg = replace(
        cfg, secrets=replace(cfg.secrets, admin_id="999999999999999999")
    )
    body = admin_client.get("/api/admin/status").json()
    assert body["admin"] == {"discord_id": "999999999999999999", "known": False}


def test_status_confirms_an_admin_id_that_has_posted(admin_client):
    from dataclasses import replace

    cfg = admin_client.app.state.cfg
    admin_client.app.state.cfg = replace(cfg, secrets=replace(cfg.secrets, admin_id="u1"))
    assert admin_client.get("/api/admin/status").json()["admin"] == {
        "discord_id": "u1",
        "known": True,
    }


def test_status_leaves_known_unset_when_no_admin_id_is_configured(admin_client):
    body = admin_client.get("/api/admin/status").json()
    assert body["admin"] == {"discord_id": "", "known": None}


def test_a_merge_can_pin_the_display_name_that_wins(admin_client, conn):
    """The operator chose a name, so it is `renamed = 1`: Discord's next rename
    must not quietly undo the choice (§5.5 keeps a rename cosmetic)."""
    response = admin_client.put(
        "/api/admin/identity",
        json={"merges": [{"canonical": "u1", "accounts": ["u1", "u2"], "name": "Alice"}]},
    )
    assert response.status_code == 200
    row = conn.execute(
        "SELECT name, renamed FROM author_names WHERE channel_id = 'c1' AND author_id = 'u1'"
    ).fetchone()
    assert (row["name"], row["renamed"]) == ("Alice", 1)


def test_a_pinned_name_survives_a_rebuild(admin_client, conn, tmp_path):
    admin_client.put(
        "/api/admin/identity",
        json={"merges": [{"canonical": "u1", "accounts": ["u1", "u2"], "name": "Alice"}]},
    )
    rebuild_all(conn, cfg_fixture(tmp_path))
    assert conn.execute(
        "SELECT name FROM author_names WHERE channel_id = 'c1' AND author_id = 'u1'"
    ).fetchone()[0] == "Alice"


def test_a_merge_reports_the_state_it_replaced_so_it_can_be_undone(admin_client):
    admin_client.put(
        "/api/admin/identity", json={"merges": [{"canonical": "u1", "accounts": ["u2"]}]}
    )
    undone = admin_client.put("/api/admin/identity", json={"merges": []}).json()
    assert undone["merges"] == []
    assert undone["previous"] == [{"canonical": "u1", "accounts": ["u1", "u2"]}]

    restored = admin_client.put(
        "/api/admin/identity", json={"merges": undone["previous"]}
    ).json()
    assert restored["merges"] == [{"canonical": "u1", "accounts": ["u1", "u2"]}]
    assert restored["previous"] == []
