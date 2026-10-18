"""The live SSE log stream and the verbose control-plane log.

The stream is expected to require admin, to push only what the cursor has not
seen, to survive an empty database with heartbeats, and to leave nothing behind
when the client goes away. The verbose log is expected to cover operations the
rebuild log never mentioned — ingest, upload, identity, admin and config.

``TestClient`` buffers a response to completion before it hands back a response
object, so an endless SSE body can never be read through it. The HTTP layer is
therefore tested against a bounded stand-in for the generator (auth, headers,
cursor), and the real generator is driven directly with ``asyncio``.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from discord_stats.api import logstream
from discord_stats.api.app import create_app
from discord_stats.api.progress import read_events
from discord_stats.auth.session import SESSION_COOKIE, Level, establish_session
from discord_scraper.rollups.build import record_event
from tests.conftest import cfg_fixture


def _bounded(*chunks):
    """A finite stand-in with the real generator's signature."""
    async def frames(db_path, since):
        for chunk in chunks:
            yield chunk
    return frames


def _payload(chunk: str) -> dict | None:
    for line in chunk.splitlines():
        if line.startswith("data: "):
            return json.loads(line[len("data: "):])
    return None


async def _take(generator, count: int) -> list[str]:
    """Pull ``count`` frames, then close the stream."""
    taken: list[str] = []
    try:
        for _ in range(count):
            taken.append(await generator.__anext__())
    finally:
        await generator.aclose()
    return taken


def _admin_client(db_path, cfg):
    client = TestClient(create_app(cfg, db_path))
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        client.cookies.set(SESSION_COOKIE, establish_session(conn, "u1", Level.ADMIN))
    finally:
        conn.close()
    return client


# --- auth and the HTTP contract ----------------------------------------------

def test_the_stream_requires_admin(viewer_client, client_unauthenticated, admin_client,
                                   monkeypatch):
    monkeypatch.setattr(logstream, "_frames", _bounded(": keep-alive\n\n"))
    assert client_unauthenticated.get("/api/admin/logs/stream").status_code == 401
    assert viewer_client.get("/api/admin/logs/stream").status_code == 403
    assert admin_client.get("/api/admin/logs/stream").status_code == 200


def test_the_route_passes_the_cursor_the_header_and_query_agree_on(admin_client,
                                                                   monkeypatch):
    seen: list[int] = []

    def capture(db_path, since):
        seen.append(since)
        return _bounded(": keep-alive\n\n")(db_path, since)

    monkeypatch.setattr(logstream, "_frames", capture)
    admin_client.get("/api/admin/logs/stream?since=4")
    admin_client.get("/api/admin/logs/stream?since=4", headers={"Last-Event-ID": "9"})
    admin_client.get("/api/admin/logs/stream?since=9", headers={"Last-Event-ID": "4"})
    admin_client.get("/api/admin/logs/stream", headers={"Last-Event-ID": "not-a-number"})
    assert seen == [4, 9, 9, 0]


def test_the_response_is_not_cached_or_gzipped(admin_client, monkeypatch):
    monkeypatch.setattr(logstream, "_frames", _bounded("id: 1\ndata: {}\n\n"))
    response = admin_client.get("/api/admin/logs/stream", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"
    assert "content-encoding" not in response.headers
    assert response.text == "id: 1\ndata: {}\n\n"


# --- the generator itself ----------------------------------------------------

def test_new_events_arrive_as_frames_in_order_exactly_once(conn, seeded_db_path,
                                                           monkeypatch):
    monkeypatch.setattr(logstream, "POLL_SECONDS", 0.01)
    monkeypatch.setattr(logstream, "HEARTBEAT_SECONDS", 30.0)
    before = conn.execute("SELECT COALESCE(MAX(id), 0) FROM rebuild_events").fetchone()[0]
    for index in range(3):
        record_event(conn, source="worker", scope="test", phase="tick",
                     message=f"line {index}")

    chunks = asyncio.run(_take(logstream._frames(seeded_db_path, before), 3))
    payloads = [_payload(chunk) for chunk in chunks]
    assert [p["message"] for p in payloads] == ["line 0", "line 1", "line 2"]
    ids = [p["id"] for p in payloads]
    assert ids == sorted(ids) and len(set(ids)) == len(ids)
    assert [chunk.splitlines()[0] for chunk in chunks] == [f"id: {i}" for i in ids]


def test_since_skips_what_the_client_already_has(conn, seeded_db_path, monkeypatch):
    monkeypatch.setattr(logstream, "POLL_SECONDS", 0.01)
    monkeypatch.setattr(logstream, "HEARTBEAT_SECONDS", 30.0)
    record_event(conn, source="worker", scope="test", phase="tick", message="old")
    seen = conn.execute("SELECT MAX(id) FROM rebuild_events").fetchone()[0]
    record_event(conn, source="worker", scope="test", phase="tick", message="new")

    chunk = asyncio.run(_take(logstream._frames(seeded_db_path, seen), 1))[0]
    assert _payload(chunk)["message"] == "new"


def test_a_live_event_is_pushed_after_the_stream_is_open(conn, seeded_db_path,
                                                         monkeypatch):
    """The writer is another process, so the push is a table poll — prove it."""
    monkeypatch.setattr(logstream, "POLL_SECONDS", 0.05)
    monkeypatch.setattr(logstream, "HEARTBEAT_SECONDS", 30.0)
    cursor = conn.execute("SELECT COALESCE(MAX(id), 0) FROM rebuild_events").fetchone()[0]

    async def run():
        generator = logstream._frames(seeded_db_path, cursor)

        def publish():
            record_event(conn, source="worker", scope="test", phase="live",
                         message="published while the stream was open")

        asyncio.get_running_loop().call_later(0.2, publish)
        try:
            return await generator.__anext__()
        finally:
            await generator.aclose()

    assert _payload(asyncio.run(run()))["message"] == "published while the stream was open"


def test_the_frame_json_is_the_progress_log_entry(conn, seeded_db_path, monkeypatch):
    """One type for both endpoints: the frame is exactly a progress log row."""
    monkeypatch.setattr(logstream, "POLL_SECONDS", 0.01)
    monkeypatch.setattr(logstream, "HEARTBEAT_SECONDS", 30.0)
    before = conn.execute("SELECT COALESCE(MAX(id), 0) FROM rebuild_events").fetchone()[0]
    record_event(conn, source="api", scope="upload", level="warn", phase="discarded",
                 message="shape check")

    payload = _payload(asyncio.run(_take(logstream._frames(seeded_db_path, before), 1))[0])
    expected = next(entry for entry in read_events(conn, since=before, ascending=True)
                    if entry["message"] == "shape check")
    assert payload == expected
    assert payload["level"] == "warn"
    assert payload["source"] == "api"
    assert payload["scope"] == "upload"
    assert set(payload) == {"id", "at", "kind", "family", "phase", "message",
                            "level", "source", "scope"}


def test_a_fresh_database_stays_open_and_heartbeats(seeded_db_path, monkeypatch):
    """No log table and no rows: comment frames only, and the stream stays up."""
    monkeypatch.setattr(logstream, "POLL_SECONDS", 0.01)
    monkeypatch.setattr(logstream, "HEARTBEAT_SECONDS", 0.0)
    chunk = asyncio.run(_take(logstream._frames(seeded_db_path, 0), 1))[0]
    assert chunk == ": keep-alive\n\n"
    assert _payload(chunk) is None


def test_closing_the_stream_releases_its_connection_and_its_task(seeded_db_path,
                                                                 monkeypatch):
    monkeypatch.setattr(logstream, "POLL_SECONDS", 0.01)
    monkeypatch.setattr(logstream, "HEARTBEAT_SECONDS", 0.0)
    opened: list = []
    real_open = logstream._open

    class Tracked:
        def __init__(self, inner):
            self._inner = inner
            self.closed = False

        def execute(self, *args, **kwargs):
            return self._inner.execute(*args, **kwargs)

        def close(self):
            self.closed = True
            self._inner.close()

    def fake_open(db_path):
        tracked = Tracked(real_open(db_path))
        opened.append(tracked)
        return tracked

    monkeypatch.setattr(logstream, "_open", fake_open)

    async def run():
        generator = logstream._frames(seeded_db_path, 0)
        await generator.__anext__()          # one heartbeat opens the connection
        await generator.aclose()
        await asyncio.sleep(0.05)
        return [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]

    assert asyncio.run(run()) == []
    assert opened, "the stream must have opened a connection"
    assert all(conn.closed for conn in opened), "a closed stream leaked its handle"


# --- the verbose events are actually written ---------------------------------

def _events(conn, scope):
    return conn.execute(
        "SELECT scope, phase, level, source, message, rows FROM rebuild_events "
        "WHERE scope = ? ORDER BY id",
        (scope,),
    ).fetchall()


def test_an_ingest_logs_its_start_and_finish_with_counts(conn, cfg, monkeypatch):
    from discord_scraper import pipeline
    from discord_scraper.worker.jobs import _ingest

    monkeypatch.setattr(pipeline, "catch_up", lambda *a, **k: 412)
    _ingest(conn, cfg, "catch_up")

    rows = _events(conn, "ingest")
    assert [row["phase"] for row in rows] == ["started", "finished"]
    assert rows[0]["source"] == "worker" and rows[0]["level"] == "info"
    assert rows[1]["rows"] == 412
    assert "412 new messages" in rows[1]["message"]


def test_a_failed_ingest_logs_an_error(conn, cfg, monkeypatch):
    from discord_scraper import pipeline
    from discord_scraper.worker.jobs import _ingest

    def boom(*a, **k):
        raise RuntimeError("discord said no")

    monkeypatch.setattr(pipeline, "catch_up", boom)
    with pytest.raises(RuntimeError):
        _ingest(conn, cfg, "catch_up")

    rows = _events(conn, "ingest")
    assert rows[-1]["phase"] == "failed" and rows[-1]["level"] == "error"
    assert "discord said no" in rows[-1]["message"]


def test_a_config_change_is_logged(admin_client, conn):
    response = admin_client.put("/api/admin/config", json={"timezone": "Asia/Tokyo"})
    assert response.status_code == 200, response.text
    row = _events(conn, "config")[-1]
    assert row["phase"] == "changed"
    assert "timezone" in row["message"]


def test_an_admin_add_and_remove_is_logged(admin_client, conn):
    assert admin_client.post("/api/admin/admins",
                             json={"discord_id": "u1"}).status_code == 201
    assert admin_client.post("/api/admin/admins",
                             json={"discord_id": "u2"}).status_code == 201
    assert admin_client.delete("/api/admin/admins/u2").status_code == 200

    rows = _events(conn, "admin")
    assert [row["phase"] for row in rows] == ["added", "added", "removed"]
    assert rows[-1]["level"] == "warn"
    assert "u2" in rows[-1]["message"]


def test_a_session_revoke_is_logged(admin_client, conn):
    response = admin_client.post("/api/admin/sessions/revoke-all")
    assert response.status_code == 200, response.text
    row = _events(conn, "session")[-1]
    assert row["level"] == "warn"
    assert "session" in row["message"]


def test_an_identity_merge_is_logged(admin_client, conn):
    response = admin_client.put(
        "/api/admin/identity", json={"merges": [{"canonical": "u1", "accounts": ["u2"]}]}
    )
    assert response.status_code == 200, response.text
    row = _events(conn, "identity")[-1]
    assert row["phase"] == "merged"
    # Canonical and alt both enter the merge map.
    assert "+2" in row["message"] and "-0" in row["message"]


def test_an_upload_stage_and_discard_is_logged(admin_client, conn, tmp_path):
    from discord_scraper.scraper.database import SCHEMA

    candidate = tmp_path / "candidate.db"
    maker = sqlite3.connect(candidate)
    maker.executescript(SCHEMA)
    maker.execute(
        "INSERT INTO messages (id, channel_id, author_id, content, created_at, type) "
        "VALUES ('m1', 'c1', 'u1', 'x', '2026-01-01T10:00:00+00:00', 0)"
    )
    maker.commit()
    maker.close()

    staged = admin_client.post(
        "/api/admin/upload",
        files={"file": ("messages.db", candidate.read_bytes(), "application/octet-stream")},
    )
    assert staged.status_code == 200, staged.text
    upload_id = staged.json()["upload_id"]
    assert admin_client.delete(f"/api/admin/upload/{upload_id}").status_code == 204

    rows = _events(conn, "upload")
    assert [row["phase"] for row in rows] == ["staged", "discarded"]
    assert rows[0]["rows"] == 1


def test_a_long_derive_writes_a_heartbeat(seeded_db, cfg, monkeypatch):
    """The 20–40 s derive used to be silent; it must say it is still moving."""
    import discord_scraper.rollups.build as build

    monkeypatch.setattr(build, "DERIVE_HEARTBEAT_SECONDS", 0.0)
    monkeypatch.setattr(build, "DERIVE_HEARTBEAT_ROWS", 1)
    build.rebuild_all(seeded_db, cfg)

    beats = seeded_db.execute(
        "SELECT phase, kind, message FROM rebuild_events WHERE phase = 'deriving' ORDER BY id"
    ).fetchall()
    assert beats, "a derive must leave at least one heartbeat"
    assert all(row["kind"] == "op" for row in beats)
    assert "messages scanned" in beats[0]["message"]
