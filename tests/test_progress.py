"""Progress events and the read-only progress endpoint.

The rebuild is expected to leave a start/finish pair for the run and for every
family, and the endpoint is expected to answer while one is still running as
well as after it finished — including on a database where one never ran.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from discord_scraper.api.app import create_app
from discord_scraper.api.progress import ABANDONED_AFTER_SECONDS
from discord_scraper.auth.session import SESSION_COOKIE, Level, establish_session
from discord_scraper.rollups.build import (
    EVENTS_KEEP,
    prune_rebuild_events,
    rebuild_all,
)
from discord_scraper.rollups.schema import FAMILIES
from tests.conftest import cfg_fixture


def _events(conn, **where):
    clauses = " AND ".join(f"{key} = ?" for key in where)
    return conn.execute(
        f"SELECT id, started_at, finished_at, kind, family, phase, message, rows, seconds "
        f"FROM rebuild_events WHERE {clauses} ORDER BY id",
        tuple(where.values()),
    ).fetchall()


def _client(db_path, cfg, level=Level.ADMIN):
    client = TestClient(create_app(cfg, db_path))
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        client.cookies.set(SESSION_COOKIE, establish_session(conn, "u1", level))
    finally:
        conn.close()
    return client


# --- what the rebuild writes -------------------------------------------------

def test_a_rebuild_writes_a_start_and_finish_pair_per_family(seeded_db, cfg):
    rebuild_all(seeded_db, cfg)
    started = {row["family"] for row in _events(seeded_db, kind="family", phase="started")}
    finished = {row["family"] for row in _events(seeded_db, kind="family", phase="finished")}
    assert started == set(FAMILIES)
    assert finished == set(FAMILIES)

    runs = [row["phase"] for row in _events(seeded_db, kind="run")]
    assert runs == ["started", "finished"]


def test_each_family_started_event_precedes_its_finished_event(seeded_db, cfg):
    rebuild_all(seeded_db, cfg)
    for family in FAMILIES:
        started = _events(seeded_db, kind="family", family=family, phase="started")[0]["id"]
        finished = _events(seeded_db, kind="family", family=family, phase="finished")[0]["id"]
        assert started < finished, family
    run = _events(seeded_db, kind="run")
    assert run[0]["id"] < run[-1]["id"]


def test_a_family_finish_carries_the_rows_and_seconds_the_cli_prints(seeded_db, cfg):
    counts = rebuild_all(seeded_db, cfg)
    row = _events(seeded_db, kind="family", family="activity", phase="finished")[0]
    assert row["rows"] == counts["activity"]
    assert row["seconds"] is not None and row["seconds"] >= 0
    assert f"{counts['activity']} rows rebuilt" in row["message"]


def test_the_run_finish_carries_the_total_rows(seeded_db, cfg):
    counts = rebuild_all(seeded_db, cfg)
    row = _events(seeded_db, kind="run", phase="finished")[0]
    assert row["rows"] == sum(counts.values())
    assert row["seconds"] is not None


def test_rebuild_reports_its_phases_to_the_caller(seeded_db, cfg):
    seen: list[str] = []
    rebuild_all(seeded_db, cfg, on_phase=seen.append)
    assert seen[0] == "deriving"
    assert "writing" in seen
    assert seen[-1] == "finished"


def test_the_run_start_is_committed_before_the_slow_prelude(seeded_db_path, cfg, monkeypatch):
    """A poll during the prelude must already see the run.

    Creating the tables, resolving identities and hashing the config take tens
    of seconds on a real database — that is the window where the operator used
    to click Recalculate and see nothing at all.
    """
    import discord_scraper.rollups.build as build

    seen: list[int] = []
    real = build.resolve_identities

    def spy(conn, config):
        check = sqlite3.connect(seeded_db_path)
        try:
            seen.append(check.execute(
                "SELECT COUNT(*) FROM rebuild_events WHERE kind = 'run' AND phase = 'started'"
            ).fetchone()[0])
        finally:
            check.close()
        return real(conn, config)

    monkeypatch.setattr(build, "resolve_identities", spy)
    conn = sqlite3.connect(seeded_db_path)
    try:
        rebuild_all(conn, cfg)
    finally:
        conn.close()
    assert seen == [1]


def test_a_failing_rebuild_records_its_failure(seeded_db, cfg, monkeypatch):
    import discord_scraper.rollups.build as build

    def boom(*args, **kwargs):
        raise RuntimeError("discord said no mid-rebuild")

    monkeypatch.setattr(build, "rebuild_word", boom)
    with pytest.raises(RuntimeError):
        rebuild_all(seeded_db, cfg)

    failed = _events(seeded_db, kind="run", phase="failed")
    assert len(failed) == 1
    assert "discord said no mid-rebuild" in failed[0]["message"]
    assert _events(seeded_db, kind="run", phase="finished") == []


# --- retention ---------------------------------------------------------------

def test_a_rebuild_prunes_the_log_to_the_most_recent_rows(seeded_db, cfg):
    rebuild_all(seeded_db, cfg)
    seeded_db.executemany(
        "INSERT INTO rebuild_events (started_at, kind, phase, message) VALUES (?, ?, ?, ?)",
        [("2026-01-01T00:00:00+00:00", "run", "started", "filler")] * (EVENTS_KEEP + 100),
    )
    seeded_db.commit()
    rebuild_all(seeded_db, cfg)   # its own write is what prunes
    kept = seeded_db.execute("SELECT COUNT(*) FROM rebuild_events").fetchone()[0]
    assert kept <= EVENTS_KEEP


def test_pruning_keeps_the_newest_and_drops_the_oldest(seeded_db, cfg):
    rebuild_all(seeded_db, cfg)
    newest_before = seeded_db.execute(
        "SELECT MAX(id) FROM rebuild_events").fetchone()[0]
    seeded_db.executemany(
        "INSERT INTO rebuild_events (started_at, kind, phase, message) VALUES (?, ?, ?, ?)",
        [("2026-01-01T00:00:00+00:00", "run", "started", "old")] * 60,
    )
    seeded_db.commit()
    prune_rebuild_events(seeded_db, keep=10)
    seeded_db.commit()
    kept = seeded_db.execute("SELECT id FROM rebuild_events ORDER BY id").fetchall()
    assert len(kept) == 10
    assert kept[-1][0] > newest_before          # the newest rows survived


# --- the endpoint ------------------------------------------------------------

def test_progress_requires_admin(viewer_client, client_unauthenticated, admin_client):
    assert viewer_client.get("/api/admin/progress").status_code == 403
    assert client_unauthenticated.get("/api/admin/progress").status_code == 401
    assert admin_client.get("/api/admin/progress").status_code == 200


def test_progress_on_a_fresh_database_is_empty_but_shaped(seeded_db_path, tmp_path):
    cfg = cfg_fixture(tmp_path, access={
        "client_id": "test-client",
        "redirect_uri": "https://stats.example/auth/callback",
    })
    client = _client(seeded_db_path, cfg)
    response = client.get("/api/admin/progress")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["running"] is False
    assert body["started_at"] is None and body["phase"] is None
    assert body["log"] == []
    assert body["latest_id"] == 0
    assert body["last"] is None
    assert body["totals"] == {"families": 0, "rows": 0, "seconds": None}
    assert [family["family"] for family in body["families"]] == list(FAMILIES)
    assert {family["state"] for family in body["families"]} == {"pending"}


def test_progress_reports_a_finished_run_and_freshness(admin_client):
    body = admin_client.get("/api/admin/progress").json()
    assert body["running"] is False
    assert body["phase"] is None
    assert body["last"]["status"] == "finished"
    assert body["totals"]["families"] == len(FAMILIES)
    assert body["totals"]["rows"] > 0
    assert {family["state"] for family in body["families"]} == {"done"}
    assert body["freshness"]["current"] is True
    assert body["latest_id"] == body["log"][0]["id"]        # newest first


def test_progress_shows_a_run_that_is_still_going(admin_client, conn):
    started = datetime.now(timezone.utc).isoformat(timespec="microseconds")
    conn.executemany(
        "INSERT INTO rebuild_events (started_at, kind, family, phase, message) "
        "VALUES (?, ?, ?, ?, ?)",
        [
            (started, "run", None, "started", "rebuild started"),
            (started, "family", "activity", "started", "activity started"),
        ],
    )
    conn.commit()
    body = admin_client.get("/api/admin/progress").json()
    assert body["running"] is True
    assert body["abandoned"] is False
    assert body["started_at"] == started
    assert body["phase"] == "writing"
    states = {family["family"]: family["state"] for family in body["families"]}
    assert states["activity"] == "running"
    assert states["word"] == "pending"


def test_a_run_that_died_before_finishing_is_not_claimed_as_running(admin_client, conn):
    """Started with no finish and long past the threshold: the feed must not lie.

    A worker killed mid-rebuild leaves the start row behind forever; without
    this the board would say "rebuild in progress" until the next rebuild.
    """
    died = (datetime.now(timezone.utc)
            - timedelta(seconds=ABANDONED_AFTER_SECONDS + 60)).isoformat(timespec="microseconds")
    conn.execute(
        "INSERT INTO rebuild_events (started_at, kind, phase, message) "
        "VALUES (?, 'run', 'started', 'rebuild started')",
        (died,),
    )
    conn.commit()

    body = admin_client.get("/api/admin/progress").json()
    assert body["running"] is False
    assert body["abandoned"] is True
    assert body["phase"] is None
    assert {family["state"] for family in body["families"]} == {"pending"}


def test_a_recent_start_is_still_running_within_the_threshold(admin_client, conn):
    """The guard must not turn a genuinely slow rebuild into a dead one."""
    started = (datetime.now(timezone.utc)
               - timedelta(seconds=ABANDONED_AFTER_SECONDS - 60)).isoformat(timespec="microseconds")
    conn.execute(
        "INSERT INTO rebuild_events (started_at, kind, phase, message) "
        "VALUES (?, 'run', 'started', 'rebuild started')",
        (started,),
    )
    conn.commit()

    body = admin_client.get("/api/admin/progress").json()
    assert body["running"] is True
    assert body["abandoned"] is False


def test_progress_since_returns_only_events_newer_than_that_id(admin_client):
    first = admin_client.get("/api/admin/progress").json()
    assert first["latest_id"] > 0
    assert first["log"]

    ids = [entry["id"] for entry in first["log"]]
    assert ids == sorted(ids, reverse=True)

    settled = admin_client.get(f"/api/admin/progress?since={first['latest_id']}").json()
    assert settled["log"] == []
    assert settled["latest_id"] == first["latest_id"]

    half = admin_client.get(
        f"/api/admin/progress?since={first['log'][-1]['id']}").json()
    assert 0 < len(half["log"]) < len(first["log"])


def test_progress_log_entries_carry_the_verbose_fields(admin_client):
    """The stream and the poll share one entry type, so the poll has it too."""
    body = admin_client.get("/api/admin/progress").json()
    entry = body["log"][0]
    assert set(entry) == {"id", "at", "kind", "family", "phase", "message",
                          "level", "source", "scope"}
    # Every rebuild row written now names its provenance; old rows stay readable.
    assert entry["source"] == "rebuild"
    assert entry["scope"] == "rollup"
    assert entry["level"] in ("info", "warn", "error")


def test_progress_says_how_far_behind_the_data_is(admin_client, conn):
    conn.execute(
        "INSERT INTO messages (id, channel_id, author_id, content, created_at, type) "
        "VALUES ('m8', 'c1', 'u1', 'new', '2026-01-05T10:00:00+00:00', 0)"
    )
    conn.commit()
    body = admin_client.get("/api/admin/progress").json()
    assert body["freshness"]["current"] is False
    assert body["freshness"]["added_since"] == 1
    activity = next(f for f in body["families"] if f["family"] == "activity")
    assert activity["added_since"] == 1
    assert activity["stale"] is True


def test_progress_answers_without_rollups_at_all(seeded_db_path, tmp_path):
    """No rollups built means no ``rollup_meta``; the endpoint says so, not 500."""
    cfg = cfg_fixture(tmp_path, access={
        "client_id": "test-client",
        "redirect_uri": "https://stats.example/auth/callback",
    })
    client = _client(seeded_db_path, cfg)
    body = client.get("/api/admin/progress").json()
    assert body["freshness"]["current"] is False
    assert body["freshness"]["built_at"] is None
