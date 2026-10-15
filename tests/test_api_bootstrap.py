import json
import sqlite3

import pytest

from discord_scraper.api.app import create_app
from discord_scraper.api.deps import connect

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
    assert body["meta"]["total"] == 7        # every source row, bots and joins included


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


def test_words_endpoint_searches_the_full_index(client):
    body = client.get("/api/words?q=abc").json()
    assert body["word"] == "abc"
    assert body["total"] == 1
    assert body["authors"] == [{"id": "u1", "name": "GlobalName", "count": 1}]


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
    from discord_scraper.auth.session import Level

    _cfg, path = db_cfg
    conn = sqlite3.connect(path)
    try:
        conn.execute("DROP TABLE messages")
        conn.commit()
    finally:
        conn.close()

    body = client_for(Level.VIEWER).get("/api/bootstrap")
    assert body.status_code == 200
    assert body.json()["meta"]["total"] == 7      # from provenance, not a scan
