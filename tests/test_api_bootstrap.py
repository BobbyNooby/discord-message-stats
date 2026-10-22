import json
import sqlite3

import pytest

from discord_stats.api.app import create_app
from discord_stats.api.deps import connect

PAYLOAD_KEYS = (
    "meta", "authors", "days", "cells", "heat", "edges", "response", "editSpeed",
    "starters", "attachments", "words", "wordAuthors", "authorWordTotals",
    "authorDistinct", "identities", "linkDomains", "linkCells", "topLinks",
    "providers", "embedTypes", "linkStats", "emoji", "reactions", "types", "tz",
    "channel_hint",
)


def test_health(seeded_db_path, tmp_path):
    from fastapi.testclient import TestClient

    client = TestClient(create_app(cfg_for(tmp_path), seeded_db_path))
    assert client.get("/api/health").json()["ok"] is True


def cfg_for(tmp_path):
    from tests.conftest import cfg_fixture

    return cfg_fixture(tmp_path)


def test_bootstrap_shape_matches_the_frontend_contract(client):
    r = client.get("/api/bootstrap")
    assert r.status_code == 200
    body = r.json()
    for key in PAYLOAD_KEYS:
        assert key in body, key
    assert len(body["cells"][0]) == 7        # day, author, msgs, chars, replies, media, edits
    assert len(body["heat"][0]) == 5         # dow, hour, author, year, msgs
    assert len(body["edges"][0]) == 3        # parent, child, msgs
    assert len(body["response"][0]) == 3     # author, avg seconds, replies
    assert len(body["editSpeed"][0]) == 3    # author, avg seconds, edits
    assert len(body["starters"][0]) == 2     # author, count
    assert len(body["linkCells"][0]) == 4 if body["linkCells"] else True


def test_bootstrap_indices_are_in_range(client):
    body = client.get("/api/bootstrap").json()
    authors, days = body["authors"], body["days"]
    for day_index, author_index, *_ in body["cells"]:
        assert 0 <= day_index < len(days)
        assert 0 <= author_index < len(authors)
    for dow, hour, author_index, year, msgs in body["heat"]:
        assert 0 <= dow < 7 and 0 <= hour < 24 and 0 <= author_index < len(authors)
        assert msgs > 0
    for parent, child, msgs in body["edges"]:
        assert 0 <= parent < len(authors) and 0 <= child < len(authors) and msgs > 0


def test_bootstrap_carries_the_golden_numbers(client):
    body = client.get("/api/bootstrap").json()
    assert body["meta"]["cells"] == 2
    totals = {body["authors"][cell[1]]["name"]: cell[2] for cell in body["cells"]}
    assert totals == {"GlobalName": 3, "plain_user": 2}
    assert body["meta"]["total"] == 5        # counted messages, not the table size
    assert body["meta"]["source_count"] == 7  # every row, for staleness


def test_bootstrap_never_returns_message_text(client):
    """Words are the point; message *content* is not.

    The word index necessarily carries individual words. What must never ship is
    a message body, its `raw` object, or a phrase — so the check is recursive on
    keys and looks for whole phrases, not tokens.
    """
    body = client.get("/api/bootstrap").json()
    dumped = json.dumps(body)
    for text in ("hello there", "embed here", "react to me"):
        assert text not in dumped
    assert not _keys_named(body, {"content", "raw", "referenced_message"})


def _keys_named(node, names):
    found = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if key in names:
                found.add(key)
            found |= _keys_named(value, names)
    elif isinstance(node, list):
        for item in node:
            found |= _keys_named(item, names)
    return found


def test_authors_carry_name_and_volume(client):
    body = client.get("/api/bootstrap").json()
    first = body["authors"][0]
    assert first["name"] == "GlobalName"
    assert first["msgs"] == 3
    assert first["id"] == "u1"


def test_payload_does_not_ship_the_retired_per_provider_media(client):
    """The top-50 view asks `/api/media?provider=…&kind=…`, so the key is gone.

    It was a dozen rows per provider that nothing read after P3 — dead weight in
    a payload that is measured to the kilobyte.
    """
    assert "mediaByProvider" not in client.get("/api/bootstrap").json()


def test_words_are_a_slice_and_word_authors_is_keyed_by_word(client):
    body = client.get("/api/bootstrap").json()
    assert len(body["words"]) <= 500
    assert body["meta"]["kept_words"] >= len(body["words"])
    assert all(len(row) == 2 for row in body["words"])
    for word, by_author in body["wordAuthors"].items():
        assert word in {row[0] for row in body["words"]} or by_author == []
        for author_index, uses in by_author:
            assert 0 <= author_index < len(body["authors"]) and uses > 0
    assert len(body["authorWordTotals"]) == len(body["authors"])
    assert len(body["authorDistinct"]) == len(body["authors"])


def test_media_endpoint_filters_by_kind_across_the_whole_ranking(client, conn):
    """A kind chip must search the rollup, not the page of rows already fetched.

    Two GIFs and one video, with a limit of two: the default page is all GIFs, so
    a client-side filter would find no video at all. The endpoint has to answer
    from the whole table, and it has to say which kinds exist.
    """
    conn.execute("DELETE FROM rollup_media WHERE channel_id = ?", ("c1",))
    conn.executemany(
        "INSERT INTO rollup_media (channel_id, url, provider, kind, uses)"
        " VALUES (?, ?, ?, ?, ?)",
        [
            ("c1", "https://tenor.com/a", "Tenor", "gifv", 50),
            ("c1", "https://tenor.com/b", "Tenor", "gifv", 40),
            ("c1", "https://youtu.be/c", "YouTube", "video", 5),
        ],
    )
    conn.commit()

    page = client.get("/api/media?limit=2").json()
    assert [item[2] for item in page["items"]] == ["gifv", "gifv"]

    filtered = client.get("/api/media?kind=video&limit=2").json()
    assert filtered["kind"] == "video"
    assert [item[2] for item in filtered["items"]] == ["video"]
    assert filtered["kinds"] == ["gifv", "video"]


def test_media_endpoint_rejects_a_blank_kind(client):
    assert client.get("/api/media?kind=").status_code == 422


def test_words_endpoint_searches_the_full_index(client):
    body = client.get("/api/words?q=abc").json()
    assert body["word"] == "abc"
    assert body["total"] == 1
    assert body["authors"] == [{"id": "u1", "name": "GlobalName", "count": 1}]


def test_words_endpoint_returns_the_timeline_by_month(client):
    body = client.get("/api/words?q=abc").json()
    assert body["months"] == [{"month": "2026-01", "id": "u1", "count": 1}]


def test_words_endpoint_reports_an_unbuilt_timeline_as_null(client, db_cfg):
    """A database rebuilt before the month table existed must read "recalculate"."""
    _cfg, path = db_cfg
    raw = sqlite3.connect(path)
    try:
        raw.execute("DROP TABLE rollup_word_month")
        raw.commit()
    finally:
        raw.close()
    body = client.get("/api/words?q=abc").json()
    assert body["total"] == 1
    assert body["months"] is None


def test_words_endpoint_searches_the_channel_the_admin_saved(client, conn):
    """It read `config.toml`'s channel while every other endpoint used the override."""
    conn.execute("INSERT INTO config (key, value) VALUES ('channel_id', 'elsewhere')")
    conn.commit()
    body = client.get("/api/words?q=abc").json()
    assert body["total"] == 0


def test_word_suggestions_complete_from_the_full_index(client):
    body = client.get("/api/words/suggest?q=ab").json()
    assert body["words"] == [["abc", 1]]
    assert client.get("/api/words/suggest?q=").status_code == 422


def test_media_detail_says_who_posted_it_and_links_the_first_post(client, conn, db_cfg):
    cfg, path = db_cfg
    from discord_scraper.rollups.build import rebuild_all
    from tests.conftest import author_raw, seed_messages

    gif = [{"type": "gifv", "url": "https://tenor.com/view/cat", "provider": {"name": "Tenor"}}]
    seed_messages(conn, [
        ("md1", "u2", "plain_user", "", "2026-01-05T10:00:00+00:00", None, None, 0, 0,
         author_raw("u2", "plain_user", embeds=gif)),
        ("md2", "u1", "u1handle", "", "2026-01-06T10:00:00+00:00", None, None, 0, 0,
         author_raw("u1", "u1handle", embeds=gif)),
        ("md3", "u1", "u1handle", "", "2026-02-06T10:00:00+00:00", None, None, 0, 0,
         author_raw("u1", "u1handle", embeds=gif)),
    ])
    rebuild_all(conn, cfg)
    body = client.get("/api/media/detail", params={"url": "https://tenor.com/view/cat"}).json()
    assert body["item"][6] == 3
    assert [(p["id"], p["count"]) for p in body["people"]] == [("u1", 2), ("u2", 1)]
    assert [m["month"] for m in body["months"]] == ["2026-01", "2026-01", "2026-02"]
    assert body["first_post"]["id"] == "u2"
    assert body["first_post"]["jump_url"].endswith("/c1/md1")
    assert client.get("/api/media/detail", params={"url": "https://nope"}).status_code == 404


def test_words_endpoint_rejects_an_empty_query(client):
    assert client.get("/api/words").status_code == 422
    assert client.get("/api/words?q=").status_code == 422


def test_database_is_opened_read_only(seeded_db_path):
    conn = connect(seeded_db_path)
    try:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute("DELETE FROM messages")
    finally:
        conn.close()


def test_bootstrap_is_served_from_rollups_only(db_cfg, client_for):
    """Drop the messages table: the payload must still assemble (spec §5.3)."""
    from discord_stats.auth.session import Level

    _cfg, path = db_cfg
    conn = sqlite3.connect(path)
    try:
        conn.execute("DROP TABLE messages")
        conn.commit()
    finally:
        conn.close()

    body = client_for(Level.VIEWER).get("/api/bootstrap")
    assert body.status_code == 200
    meta = body.json()["meta"]
    assert meta["total"] == 5            # from rollup_activity, not a scan
    assert meta["source_count"] == 7     # from provenance, not a scan
    assert meta["stale"] is True         # nothing can be current without a source


def test_total_is_the_counted_message_count_not_the_table(client):
    """Spec §18.1: the headline must agree with `analyze stats`.

    `source_count` stays for staleness (it fingerprints the whole table); the
    number a reader sees is what the configured rules count.
    """
    meta = client.get("/api/bootstrap").json()["meta"]
    assert meta["total"] == 5            # counted: real types, no bots
    assert meta["source_count"] == 7     # every row in the channel


def test_link_stats_report_messages_hosts_and_unfurled(client, conn):
    """The three numbers under "Where the chat lives" (spec §5.11).

    `msgs` is messages containing a URL, `domains` is distinct hosts uncapped,
    and `both` is messages carrying a link *and* an embed — none of which the
    top-60 grain can answer.
    """
    from tests.conftest import author_raw, seed_messages

    seed_messages(conn, [
        ("u1", "u1", "u1handle", "look https://youtube.com/watch?v=x",
         "2026-02-01T10:00:00+00:00", None, None, 0, 0, author_raw("u1", "u1handle")),
        ("u2", "u2", "plain_user", "https://example.org/a and an embed",
         "2026-02-01T10:01:00+00:00", None, None, 0, 0,
         author_raw("u2", "plain_user", embeds=[{"type": "link"}])),
    ])
    from discord_scraper.rollups.build import rebuild_all

    rebuild_all(conn, cfg_for_writes(conn))
    stats = client.get("/api/bootstrap").json()["linkStats"]
    assert stats == {"msgs": 2, "domains": 2, "both": 1}


def cfg_for_writes(conn):
    import sqlite3

    from discord_scraper.config import config_from_settings, load_settings

    path = conn.execute("PRAGMA database_list").fetchone()[2]
    import tempfile
    from pathlib import Path

    directory = Path(tempfile.mkdtemp())
    for row in conn.execute("SELECT channel_id FROM messages LIMIT 1"):
        channel = row[0]
    (directory / "config.toml").write_text(
        f'[source]\nchannel_id = "{channel}"\ntimezone = "UTC"\n', encoding="utf-8"
    )
    return config_from_settings(load_settings(config_path=directory / "config.toml"))


def test_meta_reports_the_rollup_timezone_and_freshness(client, conn):
    from tests.conftest import author_raw, seed_messages

    meta = client.get("/api/bootstrap").json()["meta"]
    assert meta["timezone"] == "UTC"     # the zone the numbers were built in
    assert meta["configured_timezone"] == "UTC"
    assert meta["timezone_mismatch"] is False
    assert meta["stale"] is False

    # "z9" sorts after the fixture's "m7", like a real snowflake would
    seed_messages(conn, [("z9", "u1", "u1handle", "new news", "2026-03-01T10:00:00+00:00",
                          None, None, 0, 0, author_raw("u1", "u1handle"))])
    assert client.get("/api/bootstrap").json()["meta"]["stale"] is True


def test_meta_carries_the_ui_display_settings(db_cfg, tmp_path, conn, client):
    """`ui.week_start` and `ui.time_format` reach the browser through `meta`.

    They are display settings — the calendar's first column and how a clock is
    written — and `meta` is the only path to the frontend, so a setting that is
    not here is a setting that does nothing.
    """
    from fastapi.testclient import TestClient

    from discord_stats.api.app import create_app
    from discord_stats.auth.session import SESSION_COOKIE, Level, establish_session
    from tests.conftest import cfg_fixture

    # The documented defaults, from a config that sets neither.
    defaults = client.get("/api/bootstrap").json()["meta"]
    assert defaults["week_start"] == "monday"
    assert defaults["time_format"] == "24h"

    _cfg, path = db_cfg
    configured = cfg_fixture(tmp_path, ui={"week_start": "sunday", "time_format": "12h"})
    other = TestClient(create_app(configured, path))
    other.cookies.set(SESSION_COOKIE, establish_session(conn, "u1", Level.VIEWER))

    meta = other.get("/api/bootstrap").json()["meta"]
    assert meta["week_start"] == "sunday"
    assert meta["time_format"] == "12h"


def test_a_timezone_change_is_served_with_a_warning(db_cfg, tmp_path, conn):
    """Spec §7.1, revised: the buckets are correct for the zone they were built
    in, so the dashboard serves them and names both zones instead of blanking.
    The old 409 made a config edit indistinguishable from an unbuilt database,
    and with an operator override set no rebuild could ever clear it."""
    from fastapi.testclient import TestClient

    from discord_stats.api.app import create_app
    from discord_stats.auth.session import SESSION_COOKIE, Level, establish_session
    from tests.conftest import cfg_fixture

    _cfg, path = db_cfg
    moved = cfg_fixture(tmp_path, timezone="Europe/London")
    client = TestClient(create_app(moved, path))
    client.cookies.set(SESSION_COOKIE, establish_session(conn, "u1", Level.VIEWER))
    response = client.get("/api/bootstrap")
    assert response.status_code == 200
    meta = response.json()["meta"]
    assert meta["timezone"] == "UTC"                    # built in
    assert meta["configured_timezone"] == "Europe/London"
    assert meta["timezone_mismatch"] is True
    assert "UTC" in meta["timezone_message"]
    assert "Europe/London" in meta["timezone_message"]


def test_an_operator_override_zone_mismatch_is_a_warning(admin_client):
    """The live bug: an override the rebuild path used to ignore. The guard can
    never be satisfied while that happens, so it must warn, not 409 forever."""
    changed = admin_client.put("/api/admin/config", json={"timezone": "Europe/London"})
    assert changed.status_code == 200

    response = admin_client.get("/api/bootstrap")
    assert response.status_code == 200
    meta = response.json()["meta"]
    assert meta["timezone"] == "UTC"
    assert meta["configured_timezone"] == "Europe/London"
    assert meta["timezone_mismatch"] is True


def test_no_rollups_is_still_fatal(seeded_db_path, tmp_path, conn):
    """No rollups at all is genuinely unusable data, not a zone disagreement."""
    from fastapi.testclient import TestClient

    from discord_stats.auth.session import SESSION_COOKIE, Level, establish_session

    client = TestClient(create_app(cfg_for(tmp_path), seeded_db_path))
    client.cookies.set(SESSION_COOKIE, establish_session(conn, "u1", Level.VIEWER))
    response = client.get("/api/bootstrap")
    assert response.status_code == 503
    assert "have not been built" in response.json()["detail"]


def test_a_matching_schema_version_is_silent(client, conn):
    from discord_scraper.rollups.schema import SCHEMA_VERSION
    from discord_scraper.scraper.database import set_meta

    set_meta(conn, "schema_version", str(SCHEMA_VERSION))
    response = client.get("/api/bootstrap")
    assert response.status_code == 200
    body = response.json()
    assert body["authors"]                    # the payload is intact
    meta = body["meta"]
    assert meta["schema_version"] == SCHEMA_VERSION
    assert meta["schema_expected"] == SCHEMA_VERSION
    assert meta["schema_message"] is None


def test_a_mismatched_schema_version_warns_but_serves(client, conn):
    from discord_scraper.rollups.schema import SCHEMA_VERSION
    from discord_scraper.scraper.database import set_meta

    set_meta(conn, "schema_version", str(SCHEMA_VERSION + 1))
    response = client.get("/api/bootstrap")
    assert response.status_code == 200             # never fail closed
    body = response.json()
    assert body["authors"]
    assert body["meta"]["cells"] == 2
    meta = body["meta"]
    assert meta["schema_version"] == SCHEMA_VERSION + 1
    assert meta["schema_expected"] == SCHEMA_VERSION
    assert str(SCHEMA_VERSION + 1) in meta["schema_message"]
    assert str(SCHEMA_VERSION) in meta["schema_message"]


def test_an_unstamped_database_warns_honestly(client, conn):
    from discord_scraper.rollups.schema import SCHEMA_VERSION
    from discord_scraper.scraper.database import delete_meta

    delete_meta(conn, "schema_version")
    response = client.get("/api/bootstrap")
    assert response.status_code == 200
    body = response.json()
    assert body["authors"]
    meta = body["meta"]
    assert meta["schema_version"] is None
    assert meta["schema_expected"] == SCHEMA_VERSION
    message = meta["schema_message"]
    assert message is not None
    assert str(SCHEMA_VERSION) in message           # names what this library expects
    assert "was built by library schema v" not in message   # no invented version
