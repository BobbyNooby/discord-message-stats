"""Replacing the database from an upload: stage, check, commit, discard."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from discord_stats.api.admin.common import log_event
from discord_stats.api.admin.jobs import JobRequest, create_job
from discord_stats.api.deps import board, connect_readonly

router = APIRouter()


# Staged uploads, keyed by the id handed to the operator. In-process on purpose:
# a pending upload is only meaningful to the process that validated it.
PENDING_UPLOADS: dict[str, Any] = {}


def _running_jobs(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM jobs WHERE status = 'running'").fetchone()[0])


def _describe_existing(target: Path) -> dict[str, Any]:
    """What is about to be replaced, so the operator sees both sides (§10.6)."""
    if not target.exists():
        return {"rows": 0, "first": None, "last": None, "size_bytes": 0}
    try:
        conn = connect_readonly(target)
        try:
            rows, first, last = conn.execute(
                "SELECT COUNT(*), MIN(created_at), MAX(created_at) FROM messages"
            ).fetchone()
        finally:
            conn.close()
    except sqlite3.Error:
        return {"rows": 0, "first": None, "last": None, "size_bytes": target.stat().st_size}
    return {
        "rows": int(rows or 0),
        "first": (first or "")[:10] or None,
        "last": (last or "")[:10] or None,
        "size_bytes": target.stat().st_size,
    }


@router.post("/upload")
def upload_database(request: Request, file: UploadFile = File(...)) -> dict:
    """Stage and validate an upload. Nothing is replaced until the commit call."""
    from discord_stats.api import upload as staging

    target = Path(request.app.state.db_path)
    with board(request, write=True) as (conn, cfg):
        running = _running_jobs(conn)
    if running:
        # A rebuild mid-upload would read a moving file (§10.6 step 1).
        raise HTTPException(
            status_code=409,
            detail=f"{running} job(s) are running — wait for them to finish before uploading",
        )

    try:
        staged = staging.stage(file.file, target)
    except staging.UploadTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    PENDING_UPLOADS[staged.upload_id] = staged
    log_event(request, scope="upload", phase="staged", rows=staged.rows,
               message=(f"upload staged: {staged.rows} rows, +{staged.added} "
                        f"-{staged.lost} against the live database"))
    return {
        "upload_id": staged.upload_id,
        "rows": staged.rows,
        "first": staged.first,
        "last": staged.last,
        "size_bytes": staged.size_bytes,
        # The channel and the zone the file's buckets were built in. A file that
        # records no zone is labelled with the server's own, and `timezone_source`
        # says which of the two the operator is looking at.
        "channel_id": staged.channel_id or cfg.channel_id,
        "timezone": staged.timezone or cfg.timezone,
        "timezone_source": "database" if staged.timezone else "config",
        # The dry run: what the swap would take away as well as bring (§10.6).
        "added": staged.added,
        "lost": staged.lost,
        "disk": {
            "free_bytes": staged.free_bytes,
            "required_bytes": staged.size_bytes * staging.DISK_FLOOR_FACTOR,
        },
        "replaces": _describe_existing(target),
    }


@router.post("/upload/{upload_id}/commit", status_code=202)
def commit_upload(request: Request, upload_id: str) -> dict:
    """Swap the staged file in, keep a `.bak`, and queue a rebuild.

    ``upload.commit`` prepares the staged file and backs the current one up
    before the single replace, so a failure here leaves the live database as it
    was rather than half-replaced.
    """
    from discord_stats.api import upload as staging

    staged = PENDING_UPLOADS.pop(upload_id, None)
    if staged is None:
        raise HTTPException(status_code=404, detail="no such upload — stage it again")
    try:
        backup = staging.commit(staged)
    except FileNotFoundError:
        raise HTTPException(status_code=410,
                            detail="the staged file is gone — upload it again") from None
    job = create_job(request, JobRequest(kind="rebuild_rollups"))
    log_event(request, scope="upload", phase="committed", rows=staged.rows,
               message=(f"upload committed: {staged.rows} rows, "
                        f"job {job['id']} queued"))
    return {
        "rows": staged.rows,
        "first": staged.first,
        "last": staged.last,
        "backup": str(backup) if backup else None,
        "job": job,
    }


@router.delete("/upload/{upload_id}", status_code=204)
def discard_upload(request: Request, upload_id: str) -> None:
    from discord_stats.api import upload as staging

    staged = PENDING_UPLOADS.pop(upload_id, None)
    if staged is not None:
        staging.discard(staged)
        log_event(request, scope="upload", phase="discarded", rows=staged.rows,
                   message=f"upload discarded: {staged.rows} rows staged, never committed")
