"""Uploading an existing messages.db (spec §10.6).

Two phases on purpose: validate and report first, commit only when the operator
has seen what they are about to replace.
"""

import sqlite3

import pytest

from discord_scraper.api.upload import MAX_UPLOAD_BYTES
from discord_scraper.scraper.database import SCHEMA


def make_database(path, rows=3):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    for index in range(rows):
        conn.execute(
            "INSERT INTO messages (id, channel_id, author_id, content, created_at, type) "
            "VALUES (?, 'c1', 'u1', ?, ?, 0)",
            (f"m{index}", f"body {index}", f"2026-01-0{index + 1}T10:00:00+00:00"),
        )
    conn.commit()
    conn.close()
    return path


def upload(admin_client, path, name="messages.db"):
    return admin_client.post(
        "/api/admin/upload", files={"file": (name, path.read_bytes(), "application/octet-stream")}
    )


def test_upload_stages_and_reports_before_committing(admin_client, tmp_path, seeded_db_path):
    candidate = make_database(tmp_path / "candidate.db", rows=2)
    preview = upload(admin_client, candidate)
    assert preview.status_code == 200
    body = preview.json()
    assert body["rows"] == 2
    assert body["first"] == "2026-01-01"
    assert body["last"] == "2026-01-02"
    assert body["upload_id"]
    # nothing has changed yet
    conn = sqlite3.connect(seeded_db_path)
    assert conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 7
    conn.close()


def test_committing_replaces_the_database_and_keeps_a_backup(
    admin_client, tmp_path, seeded_db_path, conn
):
    candidate = make_database(tmp_path / "candidate.db", rows=2)
    upload_id = upload(admin_client, candidate).json()["upload_id"]
    committed = admin_client.post(f"/api/admin/upload/{upload_id}/commit")
    assert committed.status_code == 202
    payload = committed.json()
    assert payload["rows"] == 2
    assert payload["job"]["kind"] == "rebuild_rollups"      # §10.6 step 6
    backup = seeded_db_path.with_suffix(seeded_db_path.suffix + ".bak")
    assert backup.exists(), "the previous database must survive as .bak"

    replaced = sqlite3.connect(seeded_db_path)
    assert replaced.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 2
    replaced.close()


def test_a_committed_upload_queues_a_rebuild(admin_client, tmp_path, seeded_db_path):
    candidate = make_database(tmp_path / "candidate.db", rows=1)
    upload_id = upload(admin_client, candidate).json()["upload_id"]
    admin_client.post(f"/api/admin/upload/{upload_id}/commit")

    # the *replaced* file is the live one now; the old inode is the .bak
    replaced = sqlite3.connect(seeded_db_path)
    kinds = [row[0] for row in replaced.execute("SELECT kind FROM jobs")]
    replaced.close()
    assert kinds == ["rebuild_rollups"]


def test_upload_refuses_while_a_job_is_running(admin_client, tmp_path, conn):
    from discord_scraper.worker.jobs import claim_next, enqueue

    enqueue(conn, "c1", "catch_up")
    claim_next(conn)
    candidate = make_database(tmp_path / "candidate.db")
    response = upload(admin_client, candidate)
    assert response.status_code == 409
    assert "running" in response.json()["detail"]


def test_upload_rejects_a_file_that_is_not_a_database(admin_client, tmp_path):
    junk = tmp_path / "junk.db"
    junk.write_bytes(b"this is not a sqlite database at all")
    response = upload(admin_client, junk)
    assert response.status_code == 400
    # The integrity check is what fails here, and SQLite's own words are the
    # most useful thing we can pass on.
    assert "not a usable sqlite database" in response.json()["detail"].lower()


def test_upload_rejects_a_database_without_the_expected_schema(admin_client, tmp_path):
    """A valid SQLite file that is simply not this schema."""
    wrong = tmp_path / "wrong.db"
    conn = sqlite3.connect(wrong)
    conn.execute("CREATE TABLE unrelated (x TEXT)")
    conn.commit()
    conn.close()
    response = upload(admin_client, wrong)
    assert response.status_code == 400
    assert "messages" in response.json()["detail"]


def test_upload_rejects_an_empty_file(admin_client, tmp_path):
    empty = tmp_path / "empty.db"
    empty.write_bytes(b"")
    response = upload(admin_client, empty)
    assert response.status_code == 400
    assert "empty" in response.json()["detail"]


def test_upload_rejects_an_oversized_file(admin_client, tmp_path, monkeypatch):
    monkeypatch.setattr("discord_scraper.api.upload.MAX_UPLOAD_BYTES", 100)
    big = tmp_path / "big.db"
    big.write_bytes(b"x" * 5000)
    response = upload(admin_client, big)
    assert response.status_code == 413


def test_only_an_admin_may_upload(viewer_client, tmp_path):
    candidate = make_database(tmp_path / "candidate.db")
    assert upload(viewer_client, candidate).status_code == 403


def test_the_cap_is_explicit_and_generous():
    assert MAX_UPLOAD_BYTES >= 1 << 30      # a 783 MB database must fit
