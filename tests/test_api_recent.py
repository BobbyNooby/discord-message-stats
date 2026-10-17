"""The one place a viewer sees message bodies (spec §11.8)."""

import json

import pytest

from discord_scraper.api.recent import BODY_LIMIT


def test_recent_returns_the_newest_first_with_names(client):
    body = client.get("/api/recent").json()
    assert body["messages"][0]["body"] == "beep"
    assert body["messages"][0]["created_at"].startswith("2026-01-03")
    assert {message["author"] for message in body["messages"]} >= {"plain_user"}


def test_recent_truncates_a_long_body(client, conn):
    from tests.conftest import author_raw, seed_messages

    seed_messages(conn, [("long", "u1", "u1handle", "x" * 400,
                          "2026-04-01T10:00:00+00:00", None, None, 0, 0,
                          author_raw("u1", "u1handle"))])
    newest = client.get("/api/recent").json()["messages"][0]
    assert len(newest["body"]) <= BODY_LIMIT
    assert newest["body"].endswith("…")


def test_recent_never_ships_raw_or_embeds(client):
    dumped = json.dumps(client.get("/api/recent").json())
    assert "raw" not in dumped and "embeds" not in dumped and "attachments" not in dumped


def test_show_recent_zero_restores_the_strict_rule(seeded_db_path, tmp_path):
    from fastapi.testclient import TestClient

    from discord_scraper.api.app import create_app
    from discord_scraper.auth.session import SESSION_COOKIE, Level, establish_session
    from tests.conftest import cfg_fixture

    cfg = cfg_fixture(tmp_path, ui={"show_recent": 0})
    client = TestClient(create_app(cfg, seeded_db_path))
    client.cookies.set(SESSION_COOKIE, _viewer(seeded_db_path))
    assert client.get("/api/recent").json()["messages"] == []


def test_recent_requires_a_viewer(client_unauthenticated):
    assert client_unauthenticated.get("/api/recent").status_code == 401


def test_a_viewer_can_ask_for_fewer_messages(client):
    """`ui.show_recent` is the default, not a floor: a caller may ask for less."""
    body = client.get("/api/recent", params={"limit": 2}).json()
    assert len(body["messages"]) == 2


@pytest.mark.parametrize("limit", [0, 999])
def test_a_limit_outside_one_to_two_hundred_is_refused(client, limit):
    assert client.get("/api/recent", params={"limit": limit}).status_code == 422


def _viewer(path):
    import sqlite3

    from discord_scraper.auth.session import Level, establish_session
    from discord_scraper.rollups.schema import create_control_tables

    conn = sqlite3.connect(path)
    create_control_tables(conn)
    token = establish_session(conn, "u1", Level.VIEWER)
    conn.close()
    return token
