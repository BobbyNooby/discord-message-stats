"""On-demand admin checks: token, channel, diagnostics, orphan sweep, cancel.

The Discord client is mocked for the honest-failure cases so the suite does not
depend on a network; one test deliberately leaves it unmocked and reports
whatever this machine can actually reach.
"""

from __future__ import annotations

import sqlite3

import pytest

import discord_stats.api.admin as admin

USER_BODY = {"id": "42", "username": "scraper", "global_name": "Scraper", "avatar": "abc"}
CHANNEL_BODY = {"id": "c1", "name": "general"}

# Every endpoint this change adds. Used for the auth sweep so a new one cannot
# be added without the same gate being exercised.
OPS = (
    ("post", "/api/admin/token/test"),
    ("get", "/api/admin/token"),
    ("put", "/api/admin/token"),
    ("delete", "/api/admin/token"),
    ("get", "/api/admin/diagnostics"),
    ("post", "/api/admin/uploads/sweep"),
    ("post", "/api/admin/jobs/1/cancel"),
)


def _mock(monkeypatch, *, user=(200, USER_BODY, None), channel=(200, CHANNEL_BODY, None)):
    monkeypatch.setattr(admin.discord_api, "get_current_user",
                        lambda token, timeout=10.0: user)
    monkeypatch.setattr(admin.discord_api, "get_channel",
                        lambda token, channel_id, timeout=10.0: channel)


# --- auth --------------------------------------------------------------------

def test_every_operational_endpoint_is_admin_only(client_unauthenticated, viewer_client):
    for method, path in OPS:
        call = getattr(client_unauthenticated, method)
        assert call(path).status_code == 401, path
        call = getattr(viewer_client, method)
        assert call(path).status_code == 403, path


# --- the token test ----------------------------------------------------------

def test_the_token_test_reports_the_account_behind_it(admin_client, monkeypatch):
    _mock(monkeypatch)
    body = admin_client.post("/api/admin/token/test").json()
    assert body["ok"] is True
    assert body["http_status"] == 200
    assert body["error"] is None
    assert body["checked_at"]
    assert body["bot"] == {
        "id": "42",
        "username": "scraper",
        "global_name": "Scraper",
        "avatar_url": "https://cdn.discordapp.com/avatars/42/abc.png",
    }
    assert body["channel"] == {"ok": True, "id": "c1", "name": "general", "error": None}


def _saved_token(client):
    from discord_scraper.config import token_file_for

    path = token_file_for(client.app.state.db_path)
    return path.read_text() if path.exists() else None


def test_a_working_token_is_saved_owner_only_and_never_echoed(admin_client, monkeypatch):
    import os
    import stat

    from discord_scraper.config import token_file_for

    seen = []
    monkeypatch.setattr(admin.discord_api, "get_current_user",
                        lambda token, timeout=10.0: seen.append(token) or (200, USER_BODY, None))
    monkeypatch.setattr(admin.discord_api, "get_channel",
                        lambda token, channel_id, timeout=10.0: (200, CHANNEL_BODY, None))
    response = admin_client.put("/api/admin/token", json={"token": "  new.secret-token \n"})
    assert response.status_code == 200
    assert "new.secret-token" not in response.text
    assert seen == ["new.secret-token"]
    assert _saved_token(admin_client) == "new.secret-token"
    path = token_file_for(admin_client.app.state.db_path)
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert admin_client.get("/api/admin/token").json()["source"] == "saved"
    queued = admin_client.get("/api/admin/jobs").json()
    assert "probe" in [job["kind"] for job in queued["jobs"]]


def test_a_rejected_token_is_not_saved(admin_client, monkeypatch):
    _mock(monkeypatch, user=(401, None, "HTTP 401: token is invalid or revoked"))
    response = admin_client.put("/api/admin/token", json={"token": "typo"})
    assert response.status_code == 400
    assert "nothing was saved" in response.json()["detail"]
    assert _saved_token(admin_client) is None


def test_a_token_that_cannot_be_checked_is_not_saved(admin_client, monkeypatch):
    _mock(monkeypatch, user=(None, None, "network error: no route to host"))
    response = admin_client.put("/api/admin/token", json={"token": "maybe-fine"})
    assert response.status_code == 502
    assert _saved_token(admin_client) is None


def test_a_malformed_token_body_is_refused_without_echoing_it(admin_client, monkeypatch):
    """FastAPI's 422 repeats the input it could not validate; here that is the secret."""
    monkeypatch.setattr(admin.discord_api, "get_current_user",
                        lambda *a, **k: pytest.fail("Discord should not be asked"))
    secret = "mfa.SECRET-should-never-come-back"
    attempts = [
        admin_client.put("/api/admin/token", data={"token": secret}),          # a form, not JSON
        admin_client.put("/api/admin/token", json={"token": [secret]}),
        admin_client.put("/api/admin/token", json={"token": {"value": secret}}),
        admin_client.put("/api/admin/token", content=secret),
        admin_client.put("/api/admin/token", json=[secret]),
    ]
    for response in attempts:
        assert response.status_code == 400
        assert secret not in response.text
    assert _saved_token(admin_client) is None


def test_a_token_with_spaces_inside_is_refused_without_asking_discord(admin_client, monkeypatch):
    monkeypatch.setattr(admin.discord_api, "get_current_user",
                        lambda *a, **k: pytest.fail("Discord should not be asked"))
    assert admin_client.put("/api/admin/token", json={"token": "two words"}).status_code == 400


def test_the_saved_token_is_what_the_test_button_checks_and_can_be_forgotten(
    admin_client, monkeypatch
):
    seen = []
    monkeypatch.setattr(admin.discord_api, "get_current_user",
                        lambda token, timeout=10.0: seen.append(token) or (200, USER_BODY, None))
    monkeypatch.setattr(admin.discord_api, "get_channel",
                        lambda token, channel_id, timeout=10.0: (200, CHANNEL_BODY, None))
    admin_client.put("/api/admin/token", json={"token": "saved-one"})
    admin_client.post("/api/admin/token/test")
    assert seen[-1] == "saved-one"
    before = len(admin_client.get("/api/admin/jobs").json()["jobs"])
    assert admin_client.delete("/api/admin/token").status_code == 204
    assert _saved_token(admin_client) is None
    assert admin_client.get("/api/admin/token").json()["source"] == "environment"
    # The environment's token is a different one, so it is checked at once.
    jobs = admin_client.get("/api/admin/jobs").json()["jobs"]
    assert len(jobs) == before + 1 and jobs[0]["kind"] == "probe"


def test_the_source_comes_from_the_worker_when_only_the_worker_has_a_token(admin_client, conn):
    """The container shape: DISCORD_TOKEN on the worker, not on the API."""
    from dataclasses import replace

    state = admin_client.app.state
    state.cfg = replace(state.cfg, secrets=replace(state.cfg.secrets, token=""))
    assert admin_client.get("/api/admin/token").json()["source"] == "none"
    conn.execute("INSERT INTO worker_state (key, value, updated_at) "
                 "VALUES ('token_source', 'environment', '2026-01-01')")
    conn.commit()
    assert admin_client.get("/api/admin/token").json()["source"] == "environment"


def test_an_animated_avatar_keeps_its_gif(admin_client, monkeypatch):
    _mock(monkeypatch, user=(200, {**USER_BODY, "avatar": "a_xyz"}, None))
    body = admin_client.post("/api/admin/token/test").json()
    assert body["bot"]["avatar_url"].endswith(".gif")


def test_a_network_failure_is_a_reported_result_not_a_500(admin_client, monkeypatch):
    """An unreachable Discord is the honest outcome the button must show."""
    monkeypatch.setattr(admin.discord_api, "get_current_user",
                        lambda token, timeout=10.0: (None, None, "network error: no route to host"))
    response = admin_client.post("/api/admin/token/test")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["http_status"] is None
    assert body["bot"] is None
    assert "network error" in body["error"]
    assert body["channel"]["ok"] is False
    assert "channel not checked" in body["channel"]["error"]


def test_a_revoked_token_reads_as_failed(admin_client, monkeypatch):
    monkeypatch.setattr(admin.discord_api, "get_current_user",
                        lambda token, timeout=10.0: (401, None, "HTTP 401: token is invalid or revoked"))
    body = admin_client.post("/api/admin/token/test").json()
    assert body["ok"] is False
    assert body["http_status"] == 401
    assert "invalid" in body["error"]
    assert body["channel"]["ok"] is False
    assert admin_client.get("/api/admin/token").json()["status"] == "failed"


def test_the_stored_status_is_unknown_until_it_is_checked(admin_client):
    """`unknown` is a defined state — never checked — not an error."""
    assert admin_client.get("/api/admin/token").json() == {
        "status": "unknown", "checked_at": None, "bot": None, "error": None, "channel": None,
        "source": "environment",
    }


def test_the_last_check_survives_a_restart(admin_client, monkeypatch, client_for):
    _mock(monkeypatch)
    checked = admin_client.post("/api/admin/token/test").json()
    stored = admin_client.get("/api/admin/token").json()
    assert stored["status"] == "ok"
    assert stored["checked_at"] == checked["checked_at"]
    assert stored["bot"]["id"] == "42"

    from discord_stats.auth.session import Level

    restarted = client_for(Level.ADMIN)          # a new app over the same database
    after = restarted.get("/api/admin/token").json()
    assert after["checked_at"] == checked["checked_at"]
    assert after["channel"] == {"ok": True, "id": "c1", "name": "general", "error": None}


def test_no_token_material_is_returned_or_logged(admin_client, monkeypatch, caplog):
    seen: dict[str, str] = {}

    def spy(token, timeout=10.0):
        seen["token"] = token
        return 200, USER_BODY, None

    monkeypatch.setattr(admin.discord_api, "get_current_user", spy)
    monkeypatch.setattr(admin.discord_api, "get_channel",
                        lambda token, channel_id, timeout=10.0: (200, CHANNEL_BODY, None))
    with caplog.at_level("DEBUG"):
        tested = admin_client.post("/api/admin/token/test")
        stored = admin_client.get("/api/admin/token")
        diagnostics = admin_client.get("/api/admin/diagnostics")
    # The client really was handed the token; that is the value it must not leak.
    assert seen["token"] == "test-token"
    for text in (tested.text, stored.text, diagnostics.text, caplog.text):
        assert "test-token" not in text


def test_a_bad_channel_is_proved_in_one_click(admin_client, monkeypatch):
    _mock(monkeypatch, channel=(404, None, "HTTP 404: /channels/c1 not found"))
    body = admin_client.post("/api/admin/token/test").json()
    assert body["ok"] is True                         # the token is fine…
    assert body["channel"] == {
        "ok": False, "id": "c1", "name": None,
        "error": "HTTP 404: /channels/c1 not found",  # …the channel is not
    }
    assert admin_client.get("/api/admin/token").json()["channel"]["ok"] is False


def test_a_real_call_never_raises_and_reports_what_happened(admin_client, monkeypatch):
    """No mock: what the button does on this machine, network or not."""
    monkeypatch.setattr(admin, "TOKEN_TEST_TIMEOUT", 3.0)
    response = admin_client.post("/api/admin/token/test")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is bool(body["bot"])
    if not body["ok"]:
        assert body["error"], "a failed real check must say why"


# --- diagnostics -------------------------------------------------------------

def test_diagnostics_reports_aggregates_and_never_message_content(admin_client):
    body = admin_client.get("/api/admin/diagnostics").json()
    assert body["version"]
    assert body["commit"] is None or len(body["commit"]) >= 7
    assert body["config"]["channel_id"] == "c1"
    assert body["config"]["timezone"] == "UTC"
    assert body["config"]["timezone_source"] == "file"
    assert body["database"]["path"].endswith("messages.db")
    assert body["database"]["size_bytes"] > 0
    assert isinstance(body["counts"]["messages"], int)
    assert isinstance(body["counts"]["media_messages"], int)
    assert isinstance(body["counts"]["media_urls"], int)
    assert body["counts"]["authors"] >= 1
    assert body["families"]["stale"] is False          # freshly built in the fixture
    assert len(body["families"]["items"]) == 15
    assert all(set(item) == {"family", "stale", "computed_at"}
               for item in body["families"]["items"])
    assert body["worker"]["running_job"] is None
    assert body["disk"]["free_bytes"] > 0
    assert body["orphans"] == {"count": 0, "bytes": 0}
    assert body["failures"] == []
    text = admin_client.get("/api/admin/diagnostics").text
    for content in ("defghi", "hello there", "embed here"):
        assert content not in text


def test_diagnostics_names_where_the_effective_timezone_came_from(admin_client):
    """The API applies DB overrides; the rebuild reads the file. Say which."""
    assert admin_client.put("/api/admin/config",
                            json={"timezone": "Europe/London"}).status_code == 200
    body = admin_client.get("/api/admin/diagnostics").json()
    assert body["config"]["timezone"] == "Europe/London"
    assert body["config"]["timezone_source"] == "override"
    assert body["config"]["channel_id_source"] == "file"


def test_diagnostics_reports_recent_control_plane_failures(admin_client, conn):
    conn.execute(
        "INSERT INTO jobs (channel_id, kind, status, requested_at, finished_at, error) "
        "VALUES ('c1', 'catch_up', 'failed', '2026-01-01T00:00:00+00:00', "
        "'2026-01-01T00:00:01+00:00', 'RuntimeError: HTTP 401: token is invalid or revoked')"
    )
    conn.execute(
        "INSERT INTO rebuild_events (started_at, finished_at, kind, phase, message) "
        "VALUES ('2026-01-02T00:00:00+00:00', '2026-01-02T00:00:05+00:00', 'run', "
        "'failed', 'ValueError: boom')"
    )
    conn.commit()
    failures = admin_client.get("/api/admin/diagnostics").json()["failures"]
    assert [item["source"] for item in failures] == ["rebuild", "job"]
    assert failures[0]["error"] == "ValueError: boom"
    assert failures[1]["kind"] == "catch_up"
    assert all(item["at"] for item in failures)


def test_diagnostics_never_counts_messages_with_a_scan(admin_client, monkeypatch):
    """Every count is a rollup; the only `messages` read is an indexed id lookup."""
    seen: list[str] = []

    class Tracing(sqlite3.Connection):
        def execute(self, sql, *args, **kwargs):
            seen.append(str(sql))
            return super().execute(sql, *args, **kwargs)

    def spy(path):
        connection = sqlite3.connect(str(path), factory=Tracing)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    monkeypatch.setattr(admin, "connect_writable", spy)
    admin_client.get("/api/admin/diagnostics")
    assert seen
    assert not any("count(*)" in sql.lower() and "messages" in sql.lower() for sql in seen)


# --- orphan sweep ------------------------------------------------------------

def test_the_orphan_sweep_reports_the_bytes_it_reclaims(admin_client, db_cfg):
    _cfg, path = db_cfg
    orphan = path.parent / ".upload-orphan"
    orphan.write_bytes(b"x" * 1234)
    body = admin_client.post("/api/admin/uploads/sweep").json()
    assert body["count"] == 1
    assert body["removed"] == [".upload-orphan"]
    assert body["bytes_reclaimed"] == 1234
    assert not orphan.exists()


# --- cancelling a stuck job --------------------------------------------------

def test_a_queued_job_becomes_cancelled_and_is_never_claimed(admin_client, conn):
    from discord_scraper.worker.jobs import claim_next

    created = admin_client.post("/api/admin/jobs", json={"kind": "rebuild_rollups"}).json()
    body = admin_client.post(f"/api/admin/jobs/{created['id']}/cancel").json()
    assert body == {
        "id": created["id"], "kind": "rebuild_rollups", "status": "cancelled",
        "previous_status": "queued", "cancelled_at": body["cancelled_at"], "already": False,
    }
    assert body["cancelled_at"]
    # The worker's single claim query only ever takes `queued`.
    assert claim_next(conn) is None
    assert conn.execute("SELECT status FROM jobs WHERE id = ?",
                        (created["id"],)).fetchone()["status"] == "cancelled"
    assert admin_client.get("/api/admin/status").json()["jobs"]["cancelled"] == 1
    assert admin_client.get("/api/admin/jobs").json()["jobs"][0]["status"] == "cancelled"


def test_cancelling_a_running_job_is_a_clear_conflict(admin_client, conn):
    from discord_scraper.worker.jobs import claim_next

    created = admin_client.post("/api/admin/jobs", json={"kind": "rebuild_rollups"}).json()
    claim_next(conn)
    response = admin_client.post(f"/api/admin/jobs/{created['id']}/cancel")
    assert response.status_code == 409
    assert "cannot be interrupted safely" in response.json()["detail"]
    assert conn.execute("SELECT status FROM jobs WHERE id = ?",
                        (created["id"],)).fetchone()["status"] == "running"


def test_cancelling_a_job_twice_says_it_was_already_cancelled(admin_client):
    created = admin_client.post("/api/admin/jobs", json={"kind": "catch_up"}).json()
    admin_client.post(f"/api/admin/jobs/{created['id']}/cancel")
    again = admin_client.post(f"/api/admin/jobs/{created['id']}/cancel").json()
    assert again["status"] == "cancelled"
    assert again["already"] is True
    assert again["cancelled_at"] is None


def test_cancelling_an_unknown_job_is_a_404(admin_client):
    response = admin_client.post("/api/admin/jobs/999/cancel")
    assert response.status_code == 404
    assert "999" in response.json()["detail"]


def test_a_job_claimed_mid_cancel_cannot_be_cancelled(seeded_db_path):
    """The SELECT-then-UPDATE gap: the worker wins and the admin is told."""
    from discord_scraper.rollups.schema import create_control_tables, create_rollup_tables
    from discord_scraper.worker.jobs import JobRunning, cancel_job, claim_next, enqueue

    other = sqlite3.connect(seeded_db_path)
    other.row_factory = sqlite3.Row
    create_rollup_tables(other)
    create_control_tables(other)
    other.commit()
    job_id = enqueue(other, "c1", "rebuild_rollups")
    raced: list[int] = []

    class Racing(sqlite3.Connection):
        def execute(self, sql, *args, **kwargs):
            if "SELECT kind, status FROM jobs" in str(sql) and not raced:
                raced.append(1)
                cursor = super().execute(sql, *args, **kwargs)
                rows = cursor.fetchall()          # release the read lock
                claim_next(other)                 # the worker claims right after the read

                class Done:
                    def fetchone(self):
                        return rows[0] if rows else None

                return Done()
            return super().execute(sql, *args, **kwargs)

    conn = sqlite3.connect(seeded_db_path, factory=Racing)
    try:
        with pytest.raises(JobRunning):
            cancel_job(conn, job_id)
        assert other.execute("SELECT status FROM jobs WHERE id = ?",
                             (job_id,)).fetchone()["status"] == "running"
    finally:
        conn.close()
        other.close()
