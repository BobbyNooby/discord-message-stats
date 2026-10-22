"""The admin surface.

Everything here is admin-only, and one endpoint is genuinely different from the
rest of the API: ``/api/admin/search`` returns **message text**. That is the sole
exception to "the API returns aggregates, never message text" (§4.4), which is
why it is separated in one place and guarded by ``require_admin`` rather than
being a flag someone could forget to check.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime, timezone
from typing import Any
from zoneinfo import available_timezones

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel

from discord_stats.api.deps import connect_writable
from discord_stats.auth.admins import (
    AdminLocked,
    UnknownAdmin,
    add_admin,
    list_admins,
    remove_admin,
)
from discord_stats.auth.session import SESSION_COOKIE, hash_token, require_admin
from discord_scraper.config import AUTO_TIMEZONE, Config
from discord_scraper.overrides import (
    OVERRIDABLE,
    InvalidOverride,
    apply as effective_config,
    effective_for,
    read as _overrides,
    validate as _validate_override,
)
from discord_scraper.rollups import query
from discord_scraper.rollups.build import config_digest
from discord_scraper.rollups.schema import FAMILIES, is_stale
from discord_scraper.scraper import api as discord_api

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])

JOB_KINDS = ("catch_up", "backfill", "probe", "rebuild_rollups", "backup")

JOB_STATUSES = ("queued", "running", "done", "failed", "cancelled")

# An on-demand check is a button, not a job: it must answer in seconds, so it
# uses a short timeout instead of the scraper's 30 s.
TOKEN_TEST_TIMEOUT = 10.0
# The board shows the newest answer; the older ones are only useful as a short
# failure trail, so the table is pruned to this many rows on every write.
TOKEN_CHECK_HISTORY = 50


class JobRequest(BaseModel):
    kind: str


# Staged uploads, keyed by the id handed to the operator. In-process on purpose:
# a pending upload is only meaningful to the process that validated it.
PENDING_UPLOADS: dict[str, Any] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _conn(request: Request) -> sqlite3.Connection:
    return connect_writable(request.app.state.db_path)


def _log_event(request: Request, *, message: str, scope: str, level: str = "info",
               phase: str | None = None, rows: int | None = None,
               seconds: float | None = None) -> None:
    """Write one control-plane log line about an admin action.

    On its own connection, after the action has committed, so the audit line is
    never swept into the action's transaction — and a logging failure can never
    undo the change it describes.
    """
    from discord_scraper.rollups.build import record_event

    conn = _conn(request)
    try:
        record_event(conn, source="api", scope=scope, level=level, phase=phase,
                     message=message, rows=rows, seconds=seconds)
    except sqlite3.Error:
        pass   # the action is already done; a missing log line must not 500 it
    finally:
        conn.close()


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
        "ingest_failures": stored.get("ingest_failures"),
        "cron_enabled": stored.get("cron_enabled"),
        "cron_hours": stored.get("cron_hours"),
        "last_backup_at": stored.get("last_backup_at"),
    }


@router.get("/status")
def status(request: Request) -> dict:
    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
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
            "SELECT COUNT(*) FROM sessions WHERE revoked = 0 AND expires_at > ?", (_now(),)
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
            "checked_at": _now(),
        }
    finally:
        conn.close()


# --- token and channel health ------------------------------------------------
#
# The board shows "token status unknown" because nothing ever asked Discord. The
# check below is that ask, on a button: `GET /users/@me` proves the token, then
# `GET /channels/{id}` proves the configured channel is one the token can read.
# Neither the token nor a fragment of it is ever put in a response or a log — the
# only thing kept is the account's public identity.


def _bot_from(body: Any) -> dict[str, Any] | None:
    """The account behind a token, or ``None`` when Discord gave nothing usable."""
    if not isinstance(body, dict):
        return None
    ident = str(body.get("id") or "")
    if not ident:
        return None
    avatar = body.get("avatar")
    avatar_url = None
    if avatar:
        suffix = "gif" if str(avatar).startswith("a_") else "png"
        avatar_url = f"https://cdn.discordapp.com/avatars/{ident}/{avatar}.{suffix}"
    return {
        "id": ident,
        "username": body.get("username"),
        "global_name": body.get("global_name"),
        "avatar_url": avatar_url,
    }


def _check_channel(token: str, channel_id: str) -> dict[str, Any]:
    status, body, error = discord_api.get_channel(token, channel_id, timeout=TOKEN_TEST_TIMEOUT)
    if status == 200 and isinstance(body, dict):
        return {
            "ok": True,
            "id": str(body.get("id") or channel_id),
            "name": body.get("name"),
            "error": None,
        }
    return {
        "ok": False,
        "id": channel_id,
        "name": None,
        "error": error or f"HTTP {status}: unexpected response",
    }


def run_token_check(token: str, channel_id: str) -> dict[str, Any]:
    """Ask Discord who the token is, then whether it can reach the channel.

    A network failure is a reported result, never an exception: a dead Discord
    must not turn the admin button into a 500. The channel is only checked when
    the token worked — a failed token makes every other answer meaningless.
    """
    checked_at = _now()
    status, body, error = discord_api.get_current_user(token, timeout=TOKEN_TEST_TIMEOUT)
    bot = _bot_from(body) if status == 200 else None
    if bot is not None:
        error = None
        channel = _check_channel(token, channel_id)
    else:
        error = error or f"HTTP {status}: unexpected response"
        channel = {
            "ok": False,
            "id": channel_id,
            "name": None,
            "error": "token check failed — channel not checked",
        }
    return {
        "ok": bot is not None,
        "checked_at": checked_at,
        "http_status": status,
        "bot": bot,
        "error": error,
        "channel": channel,
    }


def _store_token_check(conn: sqlite3.Connection, result: dict[str, Any]) -> None:
    """Append the result, then keep only the newest few. Pruned on every write."""
    bot = result.get("bot") or {}
    channel = result.get("channel") or {}
    conn.execute(
        """
        INSERT INTO token_checks (checked_at, ok, http_status, bot_id, bot_username,
                                  bot_global_name, bot_avatar_url, error, channel_id,
                                  channel_ok, channel_name, channel_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            result["checked_at"], 1 if result["ok"] else 0, result["http_status"],
            bot.get("id"), bot.get("username"), bot.get("global_name"), bot.get("avatar_url"),
            result.get("error"),
            channel.get("id"), None if "ok" not in channel else (1 if channel["ok"] else 0),
            channel.get("name"), channel.get("error"),
        ),
    )
    conn.execute(
        "DELETE FROM token_checks WHERE id NOT IN "
        "(SELECT id FROM token_checks ORDER BY id DESC LIMIT ?)",
        (TOKEN_CHECK_HISTORY,),
    )
    conn.commit()


def _token_result(row: sqlite3.Row) -> dict[str, Any]:
    """One stored check as the board's shape. ``error`` is only the token's."""
    bot = None
    if row["bot_id"]:
        bot = {
            "id": row["bot_id"],
            "username": row["bot_username"],
            "global_name": row["bot_global_name"],
            "avatar_url": row["bot_avatar_url"],
        }
    channel = None
    if row["channel_id"]:
        channel = {
            "ok": bool(row["channel_ok"]),
            "id": row["channel_id"],
            "name": row["channel_name"],
            "error": row["channel_error"],
        }
    return {
        "status": "ok" if row["ok"] else "failed",
        "checked_at": row["checked_at"],
        "bot": bot,
        "error": row["error"],
        "channel": channel,
    }


def _remember_check(request: Request, result: dict[str, Any]) -> None:
    conn = _conn(request)
    try:
        try:
            _store_token_check(conn, result)
        except sqlite3.OperationalError:
            # An unwritable control plane must not erase the answer the button
            # was pressed for; the reply is still honest, just not remembered.
            pass
    finally:
        conn.close()


def _token_source(request: Request) -> str:
    """Where the token in use comes from — never the token itself."""
    if _read_saved_token(request):
        return "saved"
    return "environment" if request.app.state.cfg.token else "none"


def _read_saved_token(request: Request) -> str:
    from discord_scraper.config import token_file_for

    try:
        return token_file_for(request.app.state.db_path).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


@router.post("/token/test")
def test_token(request: Request) -> dict:
    """Run the check now and persist it, so the board need not run it again."""
    from discord_scraper.config import current_token

    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
    finally:
        conn.close()
    # Read at click time, so a token saved a moment ago is the one tested.
    result = run_token_check(current_token(cfg, request.app.state.db_path), cfg.channel_id)
    _remember_check(request, result)
    return result


NOT_A_TOKEN = "that does not look like a Discord token"


def _token_from(raw: bytes) -> str:
    """The token in a ``{"token": "..."}`` body, or a 400 that repeats nothing.

    Parsed here rather than by a pydantic model on purpose: FastAPI's 422 for a
    malformed body echoes the input back, and the input is the secret.
    """
    try:
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail=NOT_A_TOKEN) from None
    token = body.get("token") if isinstance(body, dict) else None
    if not isinstance(token, str):
        raise HTTPException(status_code=400, detail=NOT_A_TOKEN)
    token = token.strip()
    if not token or len(token) > 200 or any(ch.isspace() for ch in token):
        raise HTTPException(status_code=400, detail=NOT_A_TOKEN)
    return token


@router.put("/token")
async def save_token(request: Request) -> dict:
    """Check a new token with Discord, then keep it beside the database.

    Saved only if Discord accepts it, so a typo cannot replace a working token.
    The file is owner-only, never in the database, a log or a response; the
    worker reads it on its next job, and the probe queued here lets a schedule
    paused by a dead token resume without a restart.
    """
    from starlette.concurrency import run_in_threadpool

    token = _token_from(await request.body())
    # The check is a blocking HTTP call; off the event loop, like a sync route.
    return await run_in_threadpool(_check_and_save_token, request, token)


def _check_and_save_token(request: Request, token: str) -> dict:
    from discord_scraper.config import save_token as write_token
    from discord_scraper.worker.jobs import enqueue

    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
    finally:
        conn.close()
    result = run_token_check(token, cfg.channel_id)
    if not result["ok"]:
        status = result.get("http_status")
        detail = ("Discord rejected that token — nothing was saved" if status == 401
                  else f"could not check that token ({result.get('error')}) — nothing was saved")
        raise HTTPException(status_code=400 if status == 401 else 502, detail=detail)
    write_token(request.app.state.db_path, token)
    _remember_check(request, result)
    try:
        conn = _conn(request)
        try:
            enqueue(conn, cfg.channel_id, "probe")
        finally:
            conn.close()
    except sqlite3.Error:
        # The token is saved either way; a busy database only means the worker
        # meets it on its next interval instead of in fifteen seconds.
        pass
    _log_event(request, scope="token", message="token replaced from the admin board")
    return {**result, "source": "saved"}


@router.delete("/token", status_code=204)
def forget_token(request: Request) -> None:
    """Drop the saved token, falling back to DISCORD_TOKEN from the environment.

    The fallback is a different token, so it is probed straight away: a pause
    left by the saved one would otherwise outlast it until the next interval.
    """
    from discord_scraper.config import token_file_for
    from discord_scraper.worker.jobs import enqueue

    token_file_for(request.app.state.db_path).unlink(missing_ok=True)
    conn = _conn(request)
    try:
        enqueue(conn, _effective_for(request, conn).channel_id, "probe")
    finally:
        conn.close()
    _log_event(request, scope="token", message="saved token removed from the admin board")


@router.get("/token")
def token_status(request: Request) -> dict:
    """The stored last check. ``unknown`` is a real state: never checked."""
    conn = _conn(request)
    try:
        row = conn.execute(
            "SELECT * FROM token_checks ORDER BY id DESC LIMIT 1"
        ).fetchone()
    except sqlite3.OperationalError:
        row = None
    finally:
        conn.close()
    if row is None:
        return {"status": "unknown", "checked_at": None, "bot": None,
                "error": None, "channel": None, "source": _token_source(request)}
    return {**_token_result(row), "source": _token_source(request)}


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

    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
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
    finally:
        conn.close()

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
        "checked_at": _now(),
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


@router.post("/uploads/sweep")
def sweep_uploads(request: Request) -> dict:
    """Reclaim staging files a reload orphaned, reporting the bytes recovered.

    ``sweep_orphans`` is the implementation the boot path already uses; this is
    only a way to reach it on demand.
    """
    from discord_stats.api import upload as staging

    directory = Path(app_db_path(request)).parent
    sizes: dict[str, int] = {}
    for path in directory.glob(".upload-*"):
        if path.is_file():
            try:
                sizes[path.name] = path.stat().st_size
            except OSError:
                sizes[path.name] = 0
    removed = staging.sweep_orphans(directory)
    return {
        "removed": [path.name for path in removed],
        "count": len(removed),
        "bytes_reclaimed": sum(sizes.get(path.name, 0) for path in removed),
    }


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


@router.get("/timezones")
def list_timezones(request: Request) -> dict:
    """The real IANA vocabulary for the picker, plus the zone in force today.

    ``zoneinfo.available_timezones()`` is the same set the loader validates
    against, so the picker cannot offer a name the server would reject, and the
    board can name the host zone ``"auto"`` actually resolves to.
    """
    from discord_scraper.timeutil import resolve_tz

    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
    finally:
        conn.close()
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
    _log_event(request, scope="config", phase="changed",
               message=f"config changed: {', '.join(sorted(payload))}")
    return get_config(request)


def _validate(key: str, value: Any) -> None:
    """Refuse a bad value as a 400, using the authority's own rules."""
    try:
        _validate_override(key, value)
    except InvalidOverride as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


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
        cursor = conn.execute(
            "INSERT INTO jobs (channel_id, kind, status, requested_at) VALUES (?, ?, 'queued', ?)",
            (cfg.channel_id, body.kind, _now()),
        )
        conn.commit()
        return {"id": int(cursor.lastrowid), "channel_id": cfg.channel_id,
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
    from discord_stats.api import upload as staging

    target = Path(request.app.state.db_path)
    conn = _conn(request)
    try:
        running = _running_jobs(conn)
        cfg = _effective_for(request, conn)
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
    _log_event(request, scope="upload", phase="staged", rows=staged.rows,
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
    backup = staging.commit(staged)
    job = create_job(request, JobRequest(kind="rebuild_rollups"))
    _log_event(request, scope="upload", phase="committed", rows=staged.rows,
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
        _log_event(request, scope="upload", phase="discarded", rows=staged.rows,
                   message=f"upload discarded: {staged.rows} rows staged, never committed")


def app_db_path(request: Request) -> str:
    return str(request.app.state.db_path)


class IdentityRequest(BaseModel):
    merges: list[dict]
    # Canonicas whose pinned name this call should drop. Undo uses it to clear a
    # pin the merge it is undoing introduced for an id that had no group before.
    clear_names: list[str] = []


def _pinned_name(conn: sqlite3.Connection, channel_id: str, canonical: str) -> str | None:
    """The display name an operator pinned for this id, or ``None``.

    Undo needs this: the merge set is restored by another PUT, but the name the
    merge pinned lives in ``author_names`` and would otherwise outlive the undo.
    """
    row = conn.execute(
        "SELECT name FROM author_names "
        "WHERE channel_id = ? AND author_id = ? AND renamed = 1",
        (channel_id, canonical),
    ).fetchone()
    return str(row[0]) if row is not None else None


def _migrate_admins(
    conn: sqlite3.Connection, cfg: Config, canonical_of: dict[str, str]
) -> list[dict]:
    """Move admin rights along with the person when a merge absorbs an admin id.

    Admin is keyed on a Discord id, so absorbing that id into somebody else would
    otherwise leave the privilege on a dead account (or drop it entirely). The
    surviving canonical gets a row, the absorbed row is deleted and its live
    sessions follow, because the same person is still behind them. The configured
    admin (``ADMIN_DISCORD_ID``) cannot be deleted — the config is a second
    source — so its row stays and the response flags it for the UI to explain.
    """
    migrated: list[dict] = []
    for row in conn.execute("SELECT discord_id FROM admins").fetchall():
        who = str(row[0])
        target = canonical_of.get(who, who)
        if target == who:
            continue
        configured = bool(cfg.admin_id) and who == str(cfg.admin_id)
        conn.execute(
            "INSERT OR IGNORE INTO admins (discord_id, added_at, added_by) VALUES (?, ?, 'merge')",
            (target, _now()),
        )
        if not configured:
            conn.execute("DELETE FROM admins WHERE discord_id = ?", (who,))
            conn.execute(
                "UPDATE sessions SET discord_id = ? WHERE discord_id = ?", (target, who)
            )
        migrated.append({"from": who, "to": target, "configured": configured})
    return migrated


@router.put("/identity")
def put_identity(request: Request, body: IdentityRequest) -> dict:
    """Replace the channel's merges. Add an alt, or drop it, with the same call.

    The set is validated as a whole before anything is written, because an
    account may belong to exactly one person: the same id in two merges is not a
    merge, it is a chain that either crashes the insert or silently absorbs a
    whole identity. Absorbing one is legitimate, but the caller must say so by
    listing every account in the surviving merge and dropping the absorbed group.

    A merge may carry ``name``: the display name the operator chose to win. It is
    written to ``author_names`` with ``renamed = 1`` so a rebuild keeps it, and an
    explicit ``name: null`` clears that pin again. The response carries the state
    the call replaced — names included — which is what the undo button writes
    back, so undo restores the whole chain and the names it had.
    """
    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
        previous = [
            {
                "canonical": canonical,
                "accounts": members,
                "name": _pinned_name(conn, cfg.channel_id, canonical),
            }
            for canonical, members in sorted(_grouped_merges(conn, cfg.channel_id).items())
        ]
        rows = []
        pinned: list[tuple[str, str]] = []
        clears: list[str] = []
        parsed: list[tuple[str, list[str]]] = []
        canonicals: set[str] = set()
        for merge in body.merges:
            canonical = str((merge or {}).get("canonical") or "").strip()
            accounts = [str(a).strip() for a in (merge or {}).get("accounts") or [] if str(a).strip()]
            if not canonical:
                raise HTTPException(status_code=400, detail="every merge needs a canonical id")
            if len(set(accounts)) != len(accounts):
                raise HTTPException(status_code=400, detail=f"duplicate account in {canonical}")
            members = sorted({canonical, *accounts})
            if len(members) < 2:
                raise HTTPException(
                    status_code=400,
                    detail=f"{canonical} cannot be merged with itself — a merge needs at least two accounts",
                )
            parsed.append((canonical, members))
            canonicals.add(canonical)

        # An account belongs to one person. Two merges sharing one is either a
        # cycle (A holds B while B holds A) or the silent absorption this screen
        # exists to prevent; both are refused here rather than at the insert.
        owner: dict[str, str] = {}
        for canonical, members in parsed:
            for account in members:
                other = owner.get(account)
                if other is not None and other != canonical:
                    if account in canonicals:
                        raise HTTPException(
                            status_code=400,
                            detail=(
                                f"{account} is the canonical of another identity — merge that "
                                "whole identity so its alts move explicitly, instead of listing "
                                "it as a plain alt"
                            ),
                        )
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"{account} is already in the merge for {other} — an account can "
                            "belong to only one person"
                        ),
                    )
                owner[account] = canonical

        for canonical, members in parsed:
            rows.extend((cfg.channel_id, canonical, account, None) for account in members)
        for merge, (canonical, _members) in zip(body.merges, parsed):
            if "name" not in (merge or {}):
                continue
            name = str((merge or {}).get("name") or "").strip()
            if name:
                pinned.append((canonical, name))
            else:
                clears.append(canonical)
        pinned_ids = {canonical for canonical, _name in pinned}
        clears.extend(
            str(who).strip()
            for who in body.clear_names
            if str(who).strip() and str(who).strip() not in pinned_ids
        )

        conn.execute("DELETE FROM identity WHERE channel_id = ?", (cfg.channel_id,))
        conn.executemany(
            "INSERT INTO identity (channel_id, canonical_id, account_id, note) VALUES (?, ?, ?, ?)",
            rows,
        )
        for canonical, name in pinned:
            conn.execute(
                """
                INSERT INTO author_names (channel_id, author_id, name, renamed, included)
                VALUES (?, ?, ?, 1, 1)
                ON CONFLICT (channel_id, author_id) DO UPDATE
                    SET name = excluded.name, renamed = 1
                """,
                (cfg.channel_id, canonical, name),
            )
        for canonical in clears:
            conn.execute(
                "UPDATE author_names SET renamed = 0 WHERE channel_id = ? AND author_id = ?",
                (cfg.channel_id, canonical),
            )
        admins_moved = _migrate_admins(conn, cfg, owner)
        conn.commit()
        merges = [
            {"canonical": canonical, "accounts": members}
            for canonical, members in sorted(_grouped_merges(conn, cfg.channel_id).items())
        ]
        added, removed = _identity_delta(previous, merges)
        phase = "merged" if added > removed else ("unmerged" if removed else "updated")
        moved = f", {len(admins_moved)} admin moved" if admins_moved else ""
        _log_event(request, scope="identity", phase=phase,
                   message=(f"identity {phase}: +{added} -{removed} accounts across "
                            f"{len(merges)} identities{moved}"))
        return {
            "merges": merges,
            "cache_stale": True,
            "previous": previous,
            "admins_moved": admins_moved,
        }
    finally:
        conn.close()


def _identity_delta(previous: list[dict], merges: list[dict]) -> tuple[int, int]:
    """How many accounts this call added to, and removed from, the merge map."""
    before = {str(account) for group in previous for account in group.get("accounts") or []}
    after = {str(account) for group in merges for account in group.get("accounts") or []}
    return len(after - before), len(before - after)


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
    from discord_stats.auth.session import hash_token

    token = request.cookies.get("dsh_session", "")
    conn = _conn(request)
    try:
        cursor = conn.execute(
            "UPDATE sessions SET revoked = 1 WHERE revoked = 0 AND id != ?", (hash_token(token),)
        )
        conn.commit()
        revoked = int(cursor.rowcount or 0)
    finally:
        conn.close()
    _log_event(request, scope="session", level="warn", phase="revoked",
               message=f"revoked {revoked} session(s)")
    return {"revoked": revoked}


class AdminRequest(BaseModel):
    discord_id: str
    # An id with no message is refused by default; the operator can insist.
    force: bool = False


def _actor(request: Request, conn: sqlite3.Connection) -> str:
    """The Discord id behind the request, for the `added_by` audit column."""
    token = request.cookies.get(SESSION_COOKIE, "")
    if token:
        row = conn.execute(
            "SELECT discord_id FROM sessions WHERE id = ?", (hash_token(token),)
        ).fetchone()
        if row is not None:
            return str(row[0])
    return "board"


@router.get("/admins")
def list_the_admins(request: Request) -> dict:
    """Who may run the board (§8.1), each with whether they have posted."""
    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
        return {"admins": list_admins(conn, cfg, cfg.channel_id)}
    finally:
        conn.close()


@router.post("/admins", status_code=201)
def add_an_admin(request: Request, body: AdminRequest) -> dict:
    """Grant admin to one id. A typo is refused unless `force` says otherwise."""
    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
        actor = _actor(request, conn)
        added = add_admin(
            conn,
            discord_id=body.discord_id,
            channel_id=cfg.channel_id,
            added_by=actor,
            force=body.force,
        )
    except UnknownAdmin as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    finally:
        conn.close()
    _log_event(request, scope="admin", phase="added",
               message=f"admin added: {added['discord_id']} by {actor}")
    return added


@router.delete("/admins/{discord_id}")
def remove_an_admin(request: Request, discord_id: str) -> dict:
    """Remove one id and revoke its sessions. The last admin cannot go."""
    conn = _conn(request)
    try:
        cfg = _effective_for(request, conn)
        try:
            revoked = remove_admin(conn, cfg, discord_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        except AdminLocked as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from None
    finally:
        conn.close()
    _log_event(request, scope="admin", level="warn", phase="removed",
               message=f"admin removed: {discord_id} ({revoked} session(s) revoked)")
    return {"removed": discord_id, "revoked": revoked}
