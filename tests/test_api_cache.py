"""The bootstrap payload is assembled once per rebuild, not once per request.

Measured before this existed: 1.6-1.8 s of CPU on every dashboard load (6.5 s in
a real browser, competing with 43 charts) for a document that only changes when
somebody rebuilds the rollups.
"""

from discord_scraper.rollups.build import rebuild_all


def test_the_second_request_does_not_reassemble_the_payload(client, monkeypatch):
    from discord_stats.api import viewer

    calls = {"n": 0}
    original = viewer.bootstrap

    def counted(conn, config):
        calls["n"] += 1
        return original(conn, config)

    monkeypatch.setattr(viewer, "bootstrap", counted)
    first = client.get("/api/bootstrap")
    second = client.get("/api/bootstrap")

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert calls["n"] == 1, "the payload was assembled more than once"


def test_a_rebuild_invalidates_the_cached_payload(client, conn, cfg, monkeypatch):
    from discord_stats.api import viewer

    calls = {"n": 0}
    original = viewer.bootstrap

    def counted(conn_, config):
        calls["n"] += 1
        return original(conn_, config)

    monkeypatch.setattr(viewer, "bootstrap", counted)
    assert client.get("/api/bootstrap").status_code == 200
    rebuild_all(conn, cfg)
    assert client.get("/api/bootstrap").status_code == 200

    assert calls["n"] == 2, "a rebuild must not serve the old payload"


def test_freshness_is_recomputed_even_when_the_payload_is_cached(client, conn):
    """A new message changes `stale` without changing the rollups."""
    from tests.conftest import author_raw, seed_messages

    assert client.get("/api/bootstrap").json()["meta"]["stale"] is False

    # an id that sorts after the fixture's ("m7"): real ids are fixed-width
    # snowflakes, so "newest by string" is "newest by time"
    seed_messages(conn, [("z9", "u1", "u1handle", "new news", "2026-05-01T10:00:00+00:00",
                          None, None, 0, 0, author_raw("u1", "u1handle"))])
    assert client.get("/api/bootstrap").json()["meta"]["stale"] is True


def test_the_payload_is_gzipped_when_the_client_asks(client):
    response = client.get("/api/bootstrap", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers.get("content-encoding") == "gzip"
    assert len(response.content) < 200_000      # ~140 KB, not 544 KB
