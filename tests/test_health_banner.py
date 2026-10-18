"""The health banner: three states, and the two rules that keep them honest.

State lives in SQLite, so a restart cannot reset the banner to healthy, and the
API only reads it (spec §11.7).
"""

from datetime import datetime, timedelta, timezone

import pytest


def _stamp(**delta):
    return (datetime.now(timezone.utc) - timedelta(**delta)).isoformat(timespec="seconds")


def test_no_banner_when_healthy(client, conn):
    from discord_scraper.worker.state import set_worker_state

    set_worker_state(conn, "token_status", "ok")
    set_worker_state(conn, "last_ingest_at", _stamp(hours=2))
    assert client.get("/api/health").json()["banner"] is None


def test_banner_is_red_when_the_token_is_dead(client, conn):
    from discord_scraper.worker.state import set_worker_state

    set_worker_state(conn, "token_status", "dead")
    set_worker_state(conn, "last_ingest_at", _stamp(hours=2))
    assert client.get("/api/health").json()["banner"] == "token_dead"


def test_banner_is_amber_once_ingest_is_stale(client, conn):
    from discord_scraper.worker.state import set_worker_state

    set_worker_state(conn, "token_status", "ok")
    set_worker_state(conn, "last_ingest_at", _stamp(days=4))
    assert client.get("/api/health").json()["banner"] == "stale"


def test_a_dead_token_outranks_stale_data(client, conn):
    from discord_scraper.worker.state import set_worker_state

    set_worker_state(conn, "token_status", "dead")
    set_worker_state(conn, "last_ingest_at", _stamp(days=30))
    assert client.get("/api/health").json()["banner"] == "token_dead"


def test_never_ingested_at_all_is_amber(client, conn):
    from discord_scraper.worker.state import set_worker_state

    set_worker_state(conn, "token_status", "ok")
    assert client.get("/api/health").json()["banner"] == "stale"


def test_the_banner_reads_sqlite_not_process_memory(db_cfg, conn):
    """A second app instance sees state written through another connection."""
    from fastapi.testclient import TestClient

    from discord_stats.api.app import create_app
    from discord_scraper.worker.state import set_worker_state

    cfg, path = db_cfg
    set_worker_state(conn, "token_status", "dead")
    fresh = TestClient(create_app(cfg, path))
    assert fresh.get("/api/health").json()["banner"] == "token_dead"


def test_health_still_reports_liveness(client):
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert "checked_at" in body


def test_health_carries_the_ingest_stamp_the_banner_needs(client, conn):
    """The banner cannot say how old the data is unless health hands it the stamp."""
    from discord_scraper.worker.state import set_worker_state

    stamp = _stamp(hours=2)
    set_worker_state(conn, "last_ingest_at", stamp)
    assert client.get("/api/health").json()["last_ingest_at"] == stamp


def test_health_reports_a_null_stamp_when_nothing_was_ever_ingested(client, conn):
    """Never ingested is a fact, not a missing field — the banner says so."""
    from discord_scraper.worker.state import set_worker_state

    set_worker_state(conn, "token_status", "ok")
    body = client.get("/api/health").json()
    assert body["last_ingest_at"] is None
    assert body["banner"] == "stale"
