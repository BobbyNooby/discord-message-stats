"""The admin list: who may run the board, stored as rows (§8.1).

Admin used to mean "matches the one ``ADMIN_DISCORD_ID`` in the environment".
The owner wants to grant it to other people from the board, and wants his own
id to live in the database by default — seeded from the config so his snowflake
is never hardcoded in shipped code. The config stays a fallback, so a deleted
row or an out-of-date seed cannot lock him out.
"""

from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient

from discord_scraper.api.app import create_app
from discord_scraper.auth.admins import is_admin
from discord_scraper.auth.allowlist import decision_for
from discord_scraper.auth.session import Level, establish_session, session_level
from tests.conftest import cfg_fixture


# --- the seed and the predicate ---------------------------------------------

def test_boot_seeds_the_configured_admin_into_the_table(seeded_db_path, tmp_path):
    """``ADMIN_DISCORD_ID`` becomes a row, not only an environment variable."""
    cfg = cfg_fixture(tmp_path, admin_id="424242424242424242")
    create_app(cfg, seeded_db_path)

    conn = sqlite3.connect(seeded_db_path)
    try:
        rows = conn.execute("SELECT discord_id, added_by FROM admins").fetchall()
    finally:
        conn.close()
    assert rows == [("424242424242424242", "config")]


def test_the_seed_is_idempotent_and_never_hardcodes_an_id(seeded_db_path, tmp_path):
    from discord_scraper.auth.admins import seed_admin

    cfg = cfg_fixture(tmp_path, admin_id="admin-1")
    create_app(cfg, seeded_db_path)
    conn = sqlite3.connect(seeded_db_path)
    try:
        seed_admin(conn, "admin-1")
        seed_admin(conn, "admin-1")
        kept = conn.execute(
            "SELECT COUNT(*) FROM admins WHERE discord_id = 'admin-1'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert kept == 1


def test_a_row_in_the_admins_table_is_an_admin(conn, tmp_path):
    cfg = cfg_fixture(tmp_path)          # no configured admin at all
    conn.execute(
        "INSERT INTO admins (discord_id, added_at, added_by) VALUES ('second', 'now', 'board')"
    )
    assert is_admin(conn, cfg, "second") is True
    assert is_admin(conn, cfg, "stranger") is False


def test_the_configured_admin_is_still_an_admin_with_no_row(conn, tmp_path):
    """A stale seed or a deleted row must not lock the owner out."""
    cfg = cfg_fixture(tmp_path, admin_id="admin-1")
    assert is_admin(conn, cfg, "admin-1") is True
    assert decision_for(conn, cfg, "admin-1") is Level.ADMIN


# --- the endpoints -----------------------------------------------------------

def test_the_admin_list_starts_with_the_configured_admin(seeded_db_path, tmp_path):
    cfg = cfg_fixture(tmp_path, admin_id="admin-1")
    client = TestClient(create_app(cfg, seeded_db_path, dev_login=True),
                        base_url="https://stats.example")
    client.get("/auth/dev-login?level=admin", follow_redirects=False)

    body = client.get("/api/admin/admins").json()
    assert [row["discord_id"] for row in body["admins"]] == ["admin-1"]
    assert body["admins"][0]["added_by"] == "config"


def test_admin_endpoints_require_an_admin_session(client_for):
    anonymous = client_for(None)
    assert anonymous.get("/api/admin/admins").status_code == 401

    viewer = client_for(Level.VIEWER)
    assert viewer.get("/api/admin/admins").status_code == 403
    assert viewer.post("/api/admin/admins", json={"discord_id": "u1"}).status_code == 403


def test_a_second_id_added_to_the_table_is_granted_admin(admin_client, conn):
    response = admin_client.post("/api/admin/admins", json={"discord_id": "u2"})
    assert response.status_code == 201
    assert response.json()["discord_id"] == "u2"

    cfg = admin_client.app.state.cfg
    assert decision_for(conn, cfg, "u2") is Level.ADMIN


def test_adding_an_id_that_has_posted_needs_no_force(admin_client):
    body = admin_client.post("/api/admin/admins", json={"discord_id": "u1"}).json()
    assert body["known"] is True


def test_adding_an_id_that_matches_no_message_is_refused_unless_forced(admin_client):
    refused = admin_client.post("/api/admin/admins", json={"discord_id": "999999999999999999"})
    assert refused.status_code == 409
    assert "no message" in refused.json()["detail"]

    # The operator can insist: their own id may simply never have posted here.
    forced = admin_client.post(
        "/api/admin/admins", json={"discord_id": "999999999999999999", "force": True}
    )
    assert forced.status_code == 201
    assert forced.json()["known"] is False


def test_adding_an_empty_id_is_a_400(admin_client):
    assert admin_client.post("/api/admin/admins", json={"discord_id": "  "}).status_code == 400


def test_the_list_says_whether_each_admin_has_posted(admin_client):
    admin_client.post("/api/admin/admins", json={"discord_id": "u1"})
    admin_client.post("/api/admin/admins", json={"discord_id": "999999999999999999", "force": True})

    rows = {row["discord_id"]: row for row in admin_client.get("/api/admin/admins").json()["admins"]}
    assert rows["u1"]["known"] is True
    assert rows["999999999999999999"]["known"] is False


def test_the_configured_admin_cannot_be_removed(seeded_db_path, tmp_path):
    cfg = cfg_fixture(tmp_path, admin_id="admin-1")
    # A row for the configured admin is seeded at boot; removing it is refused.
    client = TestClient(create_app(cfg, seeded_db_path, dev_login=True),
                        base_url="https://stats.example")
    client.get("/auth/dev-login?level=admin", follow_redirects=False)

    response = client.delete("/api/admin/admins/admin-1")
    assert response.status_code == 409
    assert "configured admin" in response.json()["detail"]


def test_the_last_admin_cannot_be_removed(admin_client):
    admin_client.post("/api/admin/admins", json={"discord_id": "u1"})

    response = admin_client.delete("/api/admin/admins/u1")
    assert response.status_code == 409
    assert "last admin" in response.json()["detail"]
    assert [row["discord_id"] for row in admin_client.get("/api/admin/admins").json()["admins"]] == [
        "u1"
    ]


def test_removing_a_non_last_admin_works_and_revokes_their_sessions(admin_client, conn):
    admin_client.post("/api/admin/admins", json={"discord_id": "u1"})
    admin_client.post("/api/admin/admins", json={"discord_id": "u2"})
    victim = establish_session(conn, "u2", Level.ADMIN)

    response = admin_client.delete("/api/admin/admins/u2")
    assert response.status_code == 200
    assert response.json()["removed"] == "u2"
    assert response.json()["revoked"] >= 1
    assert session_level(conn, victim) is None
    assert [row["discord_id"] for row in admin_client.get("/api/admin/admins").json()["admins"]] == [
        "u1"
    ]


def test_removing_an_unknown_admin_is_a_404(admin_client):
    assert admin_client.delete("/api/admin/admins/404404404").status_code == 404
