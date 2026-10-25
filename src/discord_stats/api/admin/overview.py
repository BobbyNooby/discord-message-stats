"""The board's overview: status, diagnostics, and the settings saved on it."""

from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path
from typing import Any
from zoneinfo import available_timezones

from fastapi import APIRouter, HTTPException, Request

from discord_stats.api.admin.common import app_db_path, log_event, saved_config
from discord_stats.api.admin.jobs import JOB_STATUSES
from discord_stats.api.deps import board, database
from discord_scraper.config import AUTO_TIMEZONE
from discord_scraper.overrides import (
    OVERRIDABLE,
    InvalidOverride,
    apply as effective_config,
    read as _overrides,
    validate as _validate_override,
)
from discord_scraper.rollups import query
from discord_scraper.rollups.build import config_digest
from discord_scraper.rollups.schema import FAMILIES, is_stale
from discord_scraper.timeutil import utc_stamp

router = APIRouter()


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
        "ingest_failures": stored.get("ingest_failures"),
        "cron_enabled": stored.get("cron_enabled"),
        "cron_hours": stored.get("cron_hours"),
        "last_backup_at": stored.get("last_backup_at"),
    }


@router.get("/status")
def status(request: Request) -> dict:
    with board(request, write=True) as (conn, cfg):
        digest = config_digest(cfg, conn)
        # One count for the whole board: "how much has arrived since the build"
        # is the same source figure for every family.
        try:
            source_now = int(conn.execute(
                "SELECT COUNT(*) FROM messages WHERE channel_id = ?", (cfg.channel_id,)
            ).fetchone()[0] or 0)
        except sqlite3.OperationalError:
            source_now = 0
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
            built_from = int(meta["source_count"]) if meta else None
            rollups[family] = {
                "rows": int(count),
                "stale": family_stale,
                "computed_at": meta["computed_at"] if meta else None,
                # What the family was built from, so the board can say what has
                # changed since rather than only that something has (§11.6).
                "built_from_rows": built_from,
                "built_from_newest": meta["source_max_message_id"] if meta else None,
                "built_in_timezone": meta["timezone"] if meta else None,
                "added_since": None if built_from is None else max(0, source_now - built_from),
                "config_changed": bool(meta and meta["config_hash"] != digest),
            }
        active_sessions = conn.execute(
            "SELECT COUNT(*) FROM sessions WHERE revoked = 0 AND expires_at > ?", (utc_stamp(),)
        ).fetchone()[0]
        # A typo'd id is "nobody is admin" in silence, so the board is told
        # plainly. `known` is None when no id is configured at all, which is a
        # different state from "configured and seen nowhere".
        admin_id = cfg.admin_id or ""
        known: bool | None = None
        if admin_id:
            known = conn.execute(
                "SELECT 1 FROM messages WHERE channel_id = ? AND author_id = ? LIMIT 1",
                (cfg.channel_id, admin_id),
            ).fetchone() is not None
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
            "admin": {"discord_id": admin_id, "known": known},
            "config_hash": digest,
            "rollups": rollups,
            "worker": _worker_view(conn),
            "jobs": _job_counts(conn),
            "sessions": {"active": int(active_sessions)},
            "checked_at": utc_stamp(),
        }


# --- diagnostics -------------------------------------------------------------
#
# Everything here is an aggregate: a count, an id, a timestamp, a size or a
# name. Message content and media URLs never appear — that is the one rule this
# endpoint shares with the rest of the API, and it is the reason a viewer cannot
# call it. Counts come from the rollups the rebuild already wrote, never from a
# fresh scan of `messages`.


def _scalar(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> int | None:
    try:
        row = conn.execute(sql, params).fetchone()
    except sqlite3.OperationalError:
        return None
    return None if row is None else int(row[0] or 0)


def _short(text: Any, limit: int = 300) -> str | None:
    if text is None:
        return None
    text = str(text)
    return text if len(text) <= limit else text[:limit] + "…"


def _git_commit(root: Path) -> str | None:
    """The short commit, read from ``.git`` directly — no process per call."""
    git = root / ".git"
    try:
        if git.is_file():
            line = git.read_text(encoding="utf-8").strip()
            if not line.startswith("gitdir:"):
                return None
            git = Path(line.split(":", 1)[1].strip())
            if not git.is_absolute():
                git = root / git
        head = (git / "HEAD").read_text(encoding="utf-8").strip()
        if head.startswith("ref:"):
            head = (git / head[4:].strip()).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return head[:12] or None


def _recent_failures(conn: sqlite3.Connection, limit: int = 5) -> list[dict[str, Any]]:
    """The last few control-plane failures, newest first.

    Jobs are the queue's record; ``rebuild_events`` is the rebuild's. Both carry
    only an exception string or a phase message — never message text.
    """
    found: list[dict[str, Any]] = []
    for row in conn.execute(
        "SELECT id, kind, finished_at, error FROM jobs "
        "WHERE status = 'failed' ORDER BY id DESC LIMIT ?",
        (int(limit),),
    ):
        found.append({"source": "job", "id": int(row[0]), "kind": str(row[1]),
                      "at": row[2], "error": _short(row[3])})
    try:
        for row in conn.execute(
            "SELECT id, family, finished_at, message FROM rebuild_events "
            "WHERE phase = 'failed' ORDER BY id DESC LIMIT ?",
            (int(limit),),
        ):
            found.append({"source": "rebuild", "id": int(row[0]),
                          "kind": str(row[1] or "run"), "at": row[2],
                          "error": _short(row[3])})
    except sqlite3.OperationalError:
        pass
    found.sort(key=lambda item: (item["at"] or ""), reverse=True)
    return found[:limit]


@router.get("/diagnostics")
def diagnostics(request: Request) -> dict:
    """The one screen an admin opens when something looks wrong."""
    from discord_scraper import __version__
    from discord_scraper import overrides as override_authority
    from discord_scraper.scraper.config import PROJECT_DIR

    with board(request, write=True) as (conn, cfg):
        # Read through the override table's single authority, not a local copy,
        # so the "where did this come from?" answer stays correct when the
        # rebuild path resolves config the same way.
        stored_overrides = override_authority.read(conn)
        digest = config_digest(cfg, conn)
        database = Path(app_db_path(request))
        size_bytes = database.stat().st_size if database.exists() else 0

        families: list[dict[str, Any]] = []
        stale_count = 0
        for family in FAMILIES:
            # `cheap=True`: an indexed newest-id lookup, not a message count.
            family_stale = is_stale(conn, cfg.channel_id, family, config_hash=digest, cheap=True)
            stale_count += 1 if family_stale else 0
            meta = query.provenance_row(conn, cfg.channel_id, family)
            families.append({
                "family": family,
                "stale": family_stale,
                "computed_at": meta["computed_at"] if meta else None,
            })

        counts = {
            # Summed from `rollup_type`: a rollup over types covers every counted
            # message, so no `COUNT(*) FROM messages` and no full-table scan.
            "messages": _scalar(
                conn, "SELECT COALESCE(SUM(msgs), 0) FROM rollup_type WHERE channel_id = ?",
                (cfg.channel_id,)),
            "media_messages": _scalar(
                conn, "SELECT COALESCE(SUM(media), 0) FROM rollup_activity WHERE channel_id = ?",
                (cfg.channel_id,)),
            "media_urls": _scalar(
                conn, "SELECT COUNT(*) FROM rollup_media WHERE channel_id = ?",
                (cfg.channel_id,)),
            "link_messages": _scalar(
                conn, "SELECT COALESCE(SUM(value), 0) FROM rollup_stats "
                      "WHERE channel_id = ? AND key = 'link_msgs'", (cfg.channel_id,)),
            "authors": _scalar(
                conn, "SELECT COUNT(DISTINCT author_id) FROM rollup_activity "
                      "WHERE channel_id = ?", (cfg.channel_id,)),
        }

        stored = dict(conn.execute("SELECT key, value FROM worker_state"))
        running = conn.execute(
            "SELECT id, kind, started_at, phase FROM jobs "
            "WHERE status = 'running' ORDER BY id LIMIT 1"
        ).fetchone()
        running_job = None
        if running is not None:
            running_job = {"id": int(running[0]), "kind": str(running[1]),
                           "started_at": running[2], "phase": running[3]}
        failures = _recent_failures(conn)

    disk: dict[str, Any] | None = None
    try:
        usage = shutil.disk_usage(database.parent)
        disk = {"path": str(database.parent), "free_bytes": usage.free,
                "total_bytes": usage.total, "used_bytes": usage.used}
    except OSError:
        pass

    orphans = [path for path in database.parent.glob(".upload-*") if path.is_file()]
    orphan_bytes = 0
    for path in orphans:
        try:
            orphan_bytes += path.stat().st_size
        except OSError:
            pass

    return {
        "checked_at": utc_stamp(),
        "version": __version__,
        "commit": _git_commit(PROJECT_DIR),
        "config": {
            "digest": digest,
            "channel_id": cfg.channel_id,
            "timezone": cfg.timezone,
            # The API applies the database's operator overrides on top of the
            # file, and the rebuild path does not. Saying where this timezone
            # came from is what keeps that difference visible instead of silent.
            "timezone_source": "override" if "timezone" in stored_overrides else "file",
            "channel_id_source": "override" if "channel_id" in stored_overrides else "file",
            "app_name": cfg.app_name,
        },
        "database": {"path": str(database), "size_bytes": size_bytes},
        "counts": counts,
        "families": {
            "stale": stale_count > 0,
            "stale_count": stale_count,
            "items": families,
        },
        "worker": {
            "last_seen_at": stored.get("last_seen_at"),
            "running_job": running_job,
            "consecutive_failures": stored.get("consecutive_failures"),
            "last_error": _short(stored.get("last_error")),
        },
        "disk": disk,
        "orphans": {"count": len(orphans), "bytes": orphan_bytes},
        "failures": failures,
    }


@router.get("/config")
def get_config(request: Request) -> dict:
    with database(request, write=True) as conn:
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


@router.get("/timezones")
def list_timezones(request: Request) -> dict:
    """The real IANA vocabulary for the picker, plus the zone in force today.

    ``zoneinfo.available_timezones()`` is the same set the loader validates
    against, so the picker cannot offer a name the server would reject, and the
    board can name the host zone ``"auto"`` actually resolves to.
    """
    from discord_scraper.timeutil import resolve_tz

    cfg = saved_config(request)
    host = resolve_tz("auto")
    auto_zone = getattr(host, "key", None) or str(host)
    return {
        "zones": sorted(available_timezones()),
        "configured": cfg.timezone,
        "effective": auto_zone if cfg.timezone == AUTO_TIMEZONE else cfg.timezone,
        "auto_zone": auto_zone,
    }


@router.put("/config")
def put_config(request: Request, payload: dict) -> dict:
    if not payload:
        raise HTTPException(status_code=400, detail="no settings given")
    unknown = sorted(set(payload) - set(OVERRIDABLE))
    if unknown:
        raise HTTPException(status_code=400, detail=f"not overridable: {', '.join(unknown)}")
    with database(request, write=True) as conn:
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
    log_event(request, scope="config", phase="changed",
               message=f"config changed: {', '.join(sorted(payload))}")
    return get_config(request)


def _validate(key: str, value: Any) -> None:
    """Refuse a bad value as a 400, using the authority's own rules."""
    try:
        _validate_override(key, value)
    except InvalidOverride as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
