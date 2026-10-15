import json
import sqlite3

import pytest

from discord_scraper.auth.session import Level


def test_status_never_leaks_the_token(admin_client):
    body = admin_client.get("/api/admin/status").json()
    assert "token" not in json.dumps(body).lower().replace("token_status", "")


def test_status_reports_rollups_worker_and_jobs(admin_client):
    body = admin_client.get("/api/admin/status").json()
    assert body["rollups"]["activity"]["rows"] == 2
    assert body["cache_stale"] is False          # freshly built in the fixture
    assert body["worker"]["token_status"] in {"ok", "dead", "unknown"}
    assert body["jobs"] == {"queued": 0, "running": 0, "done": 0, "failed": 0}
    assert body["channel_id"] == "c1"


def test_config_change_marks_the_cache_stale(admin_client):
    admin_client.put("/api/admin/config", json={"timezone": "Europe/London"})
    assert admin_client.get("/api/admin/status").json()["cache_stale"] is True


def test_config_round_trip_shows_what_is_overridden(admin_client):
    admin_client.put("/api/admin/config", json={"timezone": "Asia/Kuala_Lumpur"})
    body = admin_client.get("/api/admin/config").json()
    assert body["effective"]["timezone"] == "Asia/Kuala_Lumpur"
    assert body["overridden"] == ["timezone"]


def test_config_rejects_an_unknown_key(admin_client):
    assert admin_client.put("/api/admin/config", json={"token": "nope"}).status_code == 400
    assert admin_client.put("/api/admin/config", json={"timezone": "Mars/Olympus"}).status_code == 400


def test_the_viewer_cannot_reach_the_admin_surface(viewer_client):
    for method, path in [("get", "/api/admin/status"), ("get", "/api/admin/config"),
                         ("get", "/api/admin/jobs"), ("get", "/api/admin/search?q=a")]:
        assert getattr(viewer_client, method)(path).status_code == 403, path
    assert viewer_client.put("/api/admin/config", json={"timezone": "UTC"}).status_code == 403


def test_an_anonymous_caller_gets_401(anon_client):
    assert anon_client.get("/api/admin/status").status_code == 401


def test_jobs_can_be_enqueued_and_listed(admin_client):
    created = admin_client.post("/api/admin/jobs", json={"kind": "catch_up"})
    assert created.status_code == 201
    assert created.json()["kind"] == "catch_up"
    assert created.json()["status"] == "queued"
    listed = admin_client.get("/api/admin/jobs").json()["jobs"]
    assert [job["kind"] for job in listed] == ["catch_up"]


def test_an_unknown_job_kind_is_rejected(admin_client):
    assert admin_client.post("/api/admin/jobs", json={"kind": "rm -rf"}).status_code == 400


def test_recalculate_enqueues_a_rebuild(admin_client):
    assert admin_client.post("/api/admin/recalculate").status_code == 202
    jobs = admin_client.get("/api/admin/jobs").json()["jobs"]
    assert [job["kind"] for job in jobs] == ["rebuild_rollups"]


def test_search_is_admin_only_and_paginated(viewer_client, admin_client):
    assert viewer_client.get("/api/admin/search?q=a").status_code == 403
    r = admin_client.get("/api/admin/search?q=a&limit=5")
    assert len(r.json()["rows"]) <= 5


def test_search_finds_message_text_and_names_the_author(admin_client):
    body = admin_client.get("/api/admin/search?q=hello").json()
    assert [row["content"] for row in body["rows"]] == ["hello there"]
    assert body["rows"][0]["author_name"] == "plain_user"


def test_search_is_case_insensitive(admin_client):
    assert admin_client.get("/api/admin/search?q=HELLO").json()["total"] == 1


def test_search_requires_a_query(admin_client):
    assert admin_client.get("/api/admin/search").status_code == 422


@pytest.fixture
def anon_client(client_unauthenticated):
    return client_unauthenticated


@pytest.fixture
def viewer_client(client_for):
    return client_for(Level.VIEWER)


@pytest.fixture
def admin_client(client_for):
    return client_for(Level.ADMIN)
