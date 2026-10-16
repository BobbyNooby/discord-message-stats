"""The admin surface.

Everything here is admin-only, and one endpoint is genuinely different from the
rest of the API: ``/api/admin/search`` returns **message text**. That is the sole
exception to "the API returns aggregates, never message text" (§4.4), which is
why it is separated in one place and guarded by ``require_admin`` rather than
being a flag someone could forget to check.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel

from discord_scraper.api.deps import connect_writable
from discord_scraper.auth.session import require_admin
from discord_scraper.config import Config, config_from_settings
from discord_scraper.rollups import query
from discord_scraper.rollups.build import config_digest
from discord_scraper.rollups.schema import FAMILIES, is_stale

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])

JOB_KINDS = ("catch_up", "backfill", "probe", "rebuild_rollups")
ALLOWLIST_POLICIES = ("posted", "explicit")
# The control-plane `config` table holds operator overrides. A fixed key set:
# an admin endpoint that writes arbitrary rows is a liability, not a feature.
OVERRIDABLE = ("channel_id", "timezone", "ignore_words", "allowlist_policy",
               "cron_enabled", "cron_hours")

JOB_STATUSES = ("queued", "running", "done", "failed")


class JobRequest(BaseModel):
    kind: str


# Staged uploads, keyed by the id handed to the operator. In-process on purpose:
# a pending upload is only meaningful to the process that validated it.
PENDING_UPLOADS: dict[str, Any] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _conn(request: Request) -> sqlite3.Connection:
    return connect_writable(request.app.state.db_path)


def _overrides(conn: sqlite3.Connection) -> dict[str, str]:
    return dict(conn.execute("SELECT key, value FROM config"))


def effective_config(base: Config, overrides: dict[str, str]) -> Config:
    """``base`` with the operator's overrides applied."""
    changes: dict[str, Any] = {}
    if "channel_id" in overrides:
        changes["channel_id"] = overrides["channel_id"]
    if "timezone" in overrides:
        changes["timezone"] = overrides["timezone"]
    if "allowlist_policy" in overrides:
        changes["allowlist"] = overrides["allowlist_policy"]
    if "ignore_words" in overrides:
        try:
            changes["ignore_words"] = json.loads(overrides["ignore_words"])
        except ValueError:
            changes["ignore_words"] = []
    if "cron_enabled" in overrides:
        changes["cron_enabled"] = str(overrides["cron_enabled"]).lower() in {"1", "true", "yes", "on"}
    if "cron_hours" in overrides:
        try:
            changes["cron_hours"] = int(overrides["cron_hours"])
        except ValueError:
            pass
    return config_from_settings(replace(base.settings, **changes)) if changes else base


def effective_for(conn: sqlite3.Connection, base: Config) -> Config:
    """``base`` with the stored operator overrides — public for other modules."""
    return effective_config(base, _overrides(conn))


def _effective_for(request: Request, conn: sqlite3.Connection) -> Config:
    return effective_config(request.app.state.cfg, _overrides(conn))


def _job_counts(conn: sqlite3.Connection) -> dict[str, int]:
    counts = {status: 0 for status in JOB_STATUSES}
    for status, total in conn.execute("SELECT status, COUNT(*) FROM jobs GROUP BY status"):
        counts[str(status)] = int(total)
    return counts


def _worker_view(conn: sqlite3.Connection) -> dict[str, Any]:
    """Worker health, with the raw key names translated.

    ``worker_state`` stores ``token_checked_at`` and friends; this view renames
    them to ``checked_at``/``last_ok_at`` so that the response contains no key
    starting with ``token`` other than the state itself. The bot token's *value*
    was never here — this is about not inviting a future edit to put it here.
    """
    stored = dict(conn.execute("SELECT key, value FROM worker_state"))
    return {
        "token_status": stored.get("token_status", "unknown"),
        "checked_at": stored.get("token_checked_at"),
        "last_ok_at": stored.get("token_last_ok_at"),
        "last_ingest_at": stored.get("last_ingest_at"),
        "last_ingest_added": stored.get("last_ingest_added"),
        "last_seen_at": stored.get("last_seen_at"),
        "consecutive_failures": stored.get("consecutive_failures"),
        "cron_enabled": stored.get("cron_enabled"),
        "cron_hours": stored.get("cron_hours"),
    }


@router.get("/status")
def status(request: Request) -> dict:
    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
        digest = config_digest(cfg, conn)
        rollups: dict[str, Any] = {}
        stale = False
        for family in FAMILIES:
            table = f"rollup_{family}"
            count = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE channel_id = ?", (cfg.channel_id,)
            ).fetchone()[0]
            meta = query.provenance_row(conn, cfg.channel_id, family)
            family_stale = is_stale(conn, cfg.channel_id, family, config_hash=digest, cheap=True)
            stale = stale or family_stale
            rollups[family] = {
                "rows": int(count),
                "stale": family_stale,
                "computed_at": meta["computed_at"] if meta else None,
            }
        active_sessions = conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE revoked = 0 AND expires_at > ?", (_now(),)
        ).fetchone()[0]
        database = Path(app_db_path(request))
        return {
            "app": cfg.app_name,
            "channel_id": cfg.channel_id,
            "timezone": cfg.timezone,
            "cache_stale": stale,
            "database": {
                "size_bytes": database.stat().st_size if database.exists() else 0,
                "path": str(database),
            },
            # The id, never the token: §10.2 keeps the token out of the database
            # and out of every response.
            "admin": {"discord_id": cfg.admin_id or ""},
            "config_hash": digest,
            "rollups": rollups,
            "worker": _worker_view(conn),
            "jobs": _job_counts(conn),
            "sessions": {"active": int(active_sessions)},
            "checked_at": _now(),
        }
    finally:
        conn.close()


@router.get("/config")
def get_config(request: Request) -> dict:
    conn = _conn(request)
    try:
        overrides = _overrides(conn)
        cfg = effective_config(request.app.state.cfg, overrides)
        return {
            "effective": {
                "channel_id": cfg.channel_id,
                "timezone": cfg.timezone,
                "ignore_words": list(cfg.ignore_words),
                "allowlist_policy": cfg.allowlist,
                "app_name": cfg.app_name,
                "count_types": list(cfg.count_types),
                "exclude_bots": cfg.exclude_bots,
                "cron_enabled": cfg.cron_enabled,
                "cron_hours": cfg.cron_hours,
            },
            "overridden": sorted(k for k in overrides if k in OVERRIDABLE),
        }
    finally:
        conn.close()


@router.put("/config")
def put_config(request: Request, payload: dict) -> dict:
    if not payload:
        raise HTTPException(status_code=400, detail="no settings given")
    unknown = sorted(set(payload) - set(OVERRIDABLE))
    if unknown:
        raise HTTPException(status_code=400, detail=f"not overridable: {', '.join(unknown)}")
    conn = _conn(request)
    try:
        for key, value in payload.items():
            _validate(key, value)
        for key, value in payload.items():
            stored = json.dumps(value) if key == "ignore_words" else str(value)
            conn.execute(
                "INSERT INTO config (key, value) VALUES (?, ?) "
                "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                (key, stored),
            )
        # The scheduler reads worker_state, not the config table, so a cron edit
        # is mirrored where the running worker will see it immediately.
        from discord_scraper.worker.state import set_worker_state

        for key in ("cron_enabled", "cron_hours"):
            if key in payload:
                set_worker_state(conn, key, payload[key])
        conn.commit()
    finally:
        conn.close()
    return get_config(request)


def _validate(key: str, value: Any) -> None:
    if key == "timezone":
        try:
            ZoneInfo(str(value))
        except Exception:
            raise HTTPException(status_code=400, detail=f"unknown timezone: {value}") from None
    elif key == "allowlist_policy" and str(value) not in ALLOWLIST_POLICIES:
        raise HTTPException(
            status_code=400,
            detail=f"allowlist_policy must be one of {', '.join(ALLOWLIST_POLICIES)}",
        )
    elif key == "ignore_words" and not isinstance(value, list):
        raise HTTPException(status_code=400, detail="ignore_words must be a list")
    elif key == "channel_id" and not str(value).strip():
        raise HTTPException(status_code=400, detail="channel_id cannot be empty")
    elif key == "cron_hours":
        try:
            hours = int(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="cron_hours must be a number") from None
        if not 1 <= hours <= 24:
            raise HTTPException(status_code=400, detail="cron_hours must be between 1 and 24")


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
    if body.kind not in JOB_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {', '.join(JOB_KINDS)}")
    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
        cursor = conn.execute(
            "INSERT INTO jobs (channel_id, kind, status, requested_at) VALUES (?, ?, 'queued', ?)",
            (cfg.channel_id, body.kind, _now()),
        )
        conn.commit()
        return {"id": int(cursor.lastrowid), "channel_id": cfg.channel_id,
                "kind": body.kind, "status": "queued"}
    finally:
        conn.close()


@router.post("/recalculate", status_code=202)
def recalculate(request: Request) -> dict:
    """Queue a full rebuild. The worker runs it; the API never rebuilds inline."""
    return create_job(request, JobRequest(kind="rebuild_rollups"))


@router.get("/search")
def search(
    request: Request,
    q: str = Query(..., min_length=1),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    """The one endpoint that returns message text (§4.4)."""
    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
        pattern = f"%{q}%"
        total = conn.execute(
            "SELECT COUNT(*) FROM messages WHERE channel_id = ? AND content LIKE ?",
            (cfg.channel_id, pattern),
        ).fetchone()[0]
        found = query.rows(
            conn,
            """
            SELECT m.id, m.author_id, m.created_at, m.content, n.name
              FROM messages m
              LEFT JOIN author_names n
                     ON n.channel_id = m.channel_id AND n.author_id = m.author_id
             WHERE m.channel_id = ? AND m.content LIKE ?
             ORDER BY m.created_at DESC, m.id DESC
             LIMIT ? OFFSET ?
            """,
            (cfg.channel_id, pattern, limit, offset),
        )
        return {
            "total": int(total),
            "limit": limit,
            "offset": offset,
            "rows": [
                {
                    "id": row[0],
                    "author_id": row[1],
                    "created_at": row[2],
                    "content": row[3],
                    "author_name": row[4] or row[1],
                }
                for row in found
            ],
        }
    finally:
        conn.close()


def _running_jobs(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM jobs WHERE status = 'running'").fetchone()[0])


def _describe_existing(target: Path) -> dict[str, Any]:
    """What is about to be replaced, so the operator sees both sides (§10.6)."""
    if not target.exists():
        return {"rows": 0, "first": None, "last": None, "size_bytes": 0}
    try:
        conn = sqlite3.connect(f"file:{target}?mode=ro", uri=True)
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
    from discord_scraper.api import upload as staging

    target = Path(request.app.state.db_path)
    conn = _conn(request)
    try:
        running = _running_jobs(conn)
    finally:
        conn.close()
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
    return {
        "upload_id": staged.upload_id,
        "rows": staged.rows,
        "first": staged.first,
        "last": staged.last,
        "size_bytes": staged.size_bytes,
        "replaces": _describe_existing(target),
    }


@router.post("/upload/{upload_id}/commit", status_code=202)
def commit_upload(request: Request, upload_id: str) -> dict:
    """Swap the staged file in, keep a `.bak`, and queue a rebuild."""
    from discord_scraper.api import upload as staging
    from discord_scraper.rollups.schema import create_control_tables, create_rollup_tables

    staged = PENDING_UPLOADS.pop(upload_id, None)
    if staged is None:
        raise HTTPException(status_code=404, detail="no such upload — stage it again")
    backup = staging.commit(staged)

    # A database built elsewhere has messages and meta but neither the rollups
    # nor the control plane; the rebuild about to be queued needs both.
    conn = _conn(request)
    try:
        create_rollup_tables(conn)
        create_control_tables(conn)
        conn.commit()
    finally:
        conn.close()

    job = create_job(request, JobRequest(kind="rebuild_rollups"))
    return {
        "rows": staged.rows,
        "first": staged.first,
        "last": staged.last,
        "backup": str(backup),
        "job": job,
    }


@router.delete("/upload/{upload_id}", status_code=204)
def discard_upload(upload_id: str) -> None:
    from discord_scraper.api import upload as staging

    staged = PENDING_UPLOADS.pop(upload_id, None)
    if staged is not None:
        staging.discard(staged)


def app_db_path(request: Request) -> str:
    return str(request.app.state.db_path)


class IdentityRequest(BaseModel):
    merges: list[dict]


@router.put("/identity")
def put_identity(request: Request, body: IdentityRequest) -> dict:
    """Replace the channel's merges. Add an alt, or drop it, with the same call."""
    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
        rows = []
        for merge in body.merges:
            canonical = str((merge or {}).get("canonical") or "").strip()
            accounts = [str(a).strip() for a in (merge or {}).get("accounts") or [] if str(a).strip()]
            if not canonical:
                raise HTTPException(status_code=400, detail="every merge needs a canonical id")
            if len(set(accounts)) != len(accounts):
                raise HTTPException(status_code=400, detail=f"duplicate account in {canonical}")
            members = sorted({canonical, *accounts})
            rows.extend((cfg.channel_id, canonical, account, None) for account in members)

        conn.execute("DELETE FROM identity WHERE channel_id = ?", (cfg.channel_id,))
        conn.executemany(
            "INSERT INTO identity (channel_id, canonical_id, account_id, note) VALUES (?, ?, ?, ?)",
            rows,
        )
        conn.commit()
        merges = [
            {"canonical": canonical, "accounts": members}
            for canonical, members in sorted(_grouped_merges(conn, cfg.channel_id).items())
        ]
        return {"merges": merges, "cache_stale": True}
    finally:
        conn.close()


def _grouped_merges(conn: sqlite3.Connection, channel_id: str) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for canonical, account in conn.execute(
        "SELECT canonical_id, account_id FROM identity WHERE channel_id = ? ORDER BY account_id",
        (channel_id,),
    ):
        grouped.setdefault(canonical, []).append(account)
    return grouped


class InclusionRequest(BaseModel):
    included: dict[str, bool]


@router.put("/inclusions")
def put_inclusions(request: Request, body: InclusionRequest) -> dict:
    """Who shows (§5.6). Hide, never delete: the messages stay on disk."""
    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
        for author_id, shown in body.included.items():
            conn.execute(
                """
                INSERT INTO author_names (channel_id, author_id, name, renamed, included)
                VALUES (?, ?, ?, 0, ?)
                ON CONFLICT (channel_id, author_id) DO UPDATE SET included = excluded.included
                """,
                (cfg.channel_id, str(author_id), str(author_id), 1 if shown else 0),
            )
        conn.commit()
        return {"included": dict(body.included), "cache_stale": True}
    finally:
        conn.close()


@router.post("/sessions/revoke-all")
def revoke_all_sessions(request: Request) -> dict:
    """Sign everybody else out. The caller keeps their own session."""
    from discord_scraper.auth.session import hash_token

    token = request.cookies.get("dsh_session", "")
    conn = _conn(request)
    try:
        cursor = conn.execute(
            "UPDATE sessions SET revoked = 1 WHERE revoked = 0 AND id != ?", (hash_token(token),)
        )
        conn.commit()
        return {"revoked": int(cursor.rowcount or 0)}
    finally:
        conn.close()
