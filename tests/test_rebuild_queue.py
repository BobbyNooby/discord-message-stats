"""Recalculate must not stack full rebuilds.

One rebuild writes every rollup family; four identical queued copies do not
make it faster, they only make the board look busy and delay the next real job
(spec: the live board showed five jobs, four of them identical).
"""

import pytest


def test_a_second_recalculate_reuses_the_queued_job(admin_client):
    first = admin_client.post("/api/admin/recalculate")
    assert first.status_code == 202
    first_id = first.json()["id"]

    second = admin_client.post("/api/admin/recalculate")
    assert second.status_code in (200, 202)
    body = second.json()
    assert body["id"] == first_id
    assert body["already"] is True
    assert body["message"] == f"already queued as job #{first_id}"

    jobs = admin_client.get("/api/admin/jobs").json()["jobs"]
    assert len(jobs) == 1


def test_a_running_rebuild_is_reused_too(admin_client, conn):
    created = admin_client.post("/api/admin/recalculate").json()
    conn.execute("UPDATE jobs SET status = 'running' WHERE id = ?", (created["id"],))
    conn.commit()

    second = admin_client.post("/api/admin/recalculate").json()
    assert second["id"] == created["id"]
    assert second["already"] is True
    assert second["status"] == "running"

    assert len(admin_client.get("/api/admin/jobs").json()["jobs"]) == 1


def test_a_finished_rebuild_does_not_block_a_new_one(admin_client, conn):
    created = admin_client.post("/api/admin/recalculate").json()
    conn.execute("UPDATE jobs SET status = 'done' WHERE id = ?", (created["id"],))
    conn.commit()

    second = admin_client.post("/api/admin/recalculate").json()
    assert second["id"] != created["id"]
    assert second.get("already") is False


def test_other_job_kinds_still_stack(admin_client):
    assert admin_client.post("/api/admin/jobs", json={"kind": "catch_up"}).status_code == 201
    assert admin_client.post("/api/admin/jobs", json={"kind": "catch_up"}).status_code == 201
    jobs = admin_client.get("/api/admin/jobs").json()["jobs"]
    assert [job["kind"] for job in jobs] == ["catch_up", "catch_up"]
