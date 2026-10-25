"""The job queue as the board sees it: list, queue, recalculate, cancel."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from discord_stats.api.admin.common import _conn, _effective_for
from discord_scraper.rollups import query

router = APIRouter()


JOB_KINDS = ("catch_up", "backfill", "probe", "rebuild_rollups", "backup")

JOB_STATUSES = ("queued", "running", "done", "failed", "cancelled")


class JobRequest(BaseModel):
    kind: str


@router.get("/jobs")
def list_jobs(request: Request, limit: int = Query(50, ge=1, le=200)) -> dict:
    conn = _conn(request)
    try:
        found = query.rows(
            conn,
            """
            SELECT id, channel_id, kind, status, requested_at, started_at, finished_at,
                   result, error
              FROM jobs ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        fields = ("id", "channel_id", "kind", "status", "requested_at", "started_at",
                  "finished_at", "result", "error")
        return {"jobs": [dict(zip(fields, row)) for row in found]}
    finally:
        conn.close()


@router.post("/jobs", status_code=201)
def create_job(request: Request, body: JobRequest) -> dict:
    from discord_scraper.worker.jobs import enqueue

    if body.kind not in JOB_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {', '.join(JOB_KINDS)}")
    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
        if body.kind == "rebuild_rollups":
            # A rebuild takes minutes and writes every family; a second identical
            # one behind it is pure delay. Recalculate returns the job already in
            # flight rather than stacking another copy on top of it.
            existing = conn.execute(
                "SELECT id, channel_id, kind, status FROM jobs "
                "WHERE kind = 'rebuild_rollups' AND channel_id = ? "
                "AND status IN ('queued', 'running') ORDER BY id LIMIT 1",
                (cfg.channel_id,),
            ).fetchone()
            if existing is not None:
                state = "running" if existing["status"] == "running" else "queued"
                return {"id": int(existing["id"]), "channel_id": existing["channel_id"],
                        "kind": existing["kind"], "status": existing["status"],
                        "already": True,
                        "message": f"already {state} as job #{existing['id']}"}
        job_id = enqueue(conn, cfg.channel_id, body.kind)
        return {"id": job_id, "channel_id": cfg.channel_id,
                "kind": body.kind, "status": "queued", "already": False}
    finally:
        conn.close()


@router.post("/recalculate", status_code=202)
def recalculate(request: Request) -> dict:
    """Queue a full rebuild. The worker runs it; the API never rebuilds inline."""
    return create_job(request, JobRequest(kind="rebuild_rollups"))


@router.post("/jobs/{job_id}/cancel")
def cancel_a_job(request: Request, job_id: int) -> dict:
    """Clear a stuck queued job, or say plainly why it cannot be cleared.

    Only ``queued`` is cancellable. A running rebuild is mid-write, so it is
    refused with a 409 rather than pretended away; ``claim_next`` only ever takes
    ``queued`` rows, so a cancelled job is skipped by construction.
    """
    from discord_scraper.worker.jobs import JobNotCancellable, JobNotFound, cancel_job

    conn = _conn(request)
    try:
        try:
            return cancel_job(conn, job_id)
        except JobNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        except JobNotCancellable as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from None
    finally:
        conn.close()
