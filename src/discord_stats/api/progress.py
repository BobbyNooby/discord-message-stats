"""Progress and log for long operations, read-only.

`rebuild_all` writes a run-level start/finish pair plus one pair per family into
``rebuild_events``; this module turns those rows into the shape the admin board
polls. It lives apart from ``admin.py`` so the read path shares nothing with the
config endpoints, and every query here is cheap: the board may poll it once a
second while a rebuild runs, and a poll must never slow that rebuild down.

The freshness facts mirror ``admin.py``'s ``added_since`` without importing it:
per-family provenance is read straight from ``rollup_meta``, and the newest
message id comes from the same indexed lookup ``is_stale(cheap=True)`` uses, so
there is no ``COUNT(*)`` over ``messages`` on the steady-state path.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from discord_scraper.api.deps import connect
from discord_scraper.auth.session import require_admin
from discord_scraper.config import Config
from discord_scraper.rollups.schema import FAMILIES

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])

# The client asks for what is new; this bounds what a first load can return.
LOG_CAP = 200

# A `run/started` older than this with no finish is treated as a run whose
# process died. A rebuild is minutes of work even on the reference database
# (the prelude alone measured 43 s cold), so two hours is far above any real
# run yet short enough that a crashed one stops claiming "running" the same
# working session. Past it the endpoint reports `abandoned: true`.
ABANDONED_AFTER_SECONDS = 2 * 60 * 60

# The log line's shape, shared by `/api/admin/progress` and the SSE stream so the
# frontend needs one type rather than two. `level`, `source` and `scope` are the
# severity and provenance the verbose log added; a row written before those
# columns existed selects as NULL and reads as an unnamed info line.
EVENT_FIELDS: tuple[str, ...] = (
    "id", "started_at", "finished_at", "kind", "family", "phase", "message",
    "level", "source", "scope",
)


def event_columns(conn: sqlite3.Connection) -> str:
    """The event select list, with NULLs for columns a pre-migration db lacks.

    The API reads through a read-only handle, so it cannot migrate a database
    itself; naming an absent column would turn a stale file into a 500 on the
    board instead of a log line with no provenance.
    """
    present = {str(row[1]) for row in conn.execute("PRAGMA table_info(rebuild_events)")}
    return ", ".join(
        field if field in present else f"NULL AS {field}" for field in EVENT_FIELDS
    )


def event_entry(row: sqlite3.Row | tuple) -> dict:
    """One log line in the shared shape."""
    return {
        "id": int(row["id"]),
        "at": row["finished_at"] or row["started_at"],
        "kind": row["kind"],
        "family": row["family"],
        "phase": row["phase"],
        "message": row["message"],
        "level": row["level"],
        "source": row["source"],
        "scope": row["scope"],
    }


def read_events(conn: sqlite3.Connection, *, since: int = 0, limit: int = LOG_CAP,
                ascending: bool = False) -> list[dict]:
    """Log lines newer than ``since``, newest-first by default.

    One indexed range scan of the small control-plane table: no ``COUNT(*)`` over
    ``messages`` and nothing that grows with the size of the conversation, which
    is what lets the stream poll this twice a second.
    """
    order = "ASC" if ascending else "DESC"
    rows = conn.execute(
        f"SELECT {event_columns(conn)} FROM rebuild_events "
        f"WHERE id > ? ORDER BY id {order} LIMIT ?",
        (int(since), int(limit)),
    )
    return [event_entry(row) for row in rows]


@router.get("/progress")
def progress(request: Request, since: int = Query(0, ge=0)) -> dict:
    """Where a rebuild is, what it has done, and whether the data is current.

    ``since`` is an event id: the response's ``log`` carries only events newer
    than it and ``latest_id`` is what to ask with next. A poll during a quiet
    stretch therefore returns an empty ``log`` without re-reading the history.
    """
    conn = connect(request.app.state.db_path)
    try:
        return build_progress(conn, request.app.state.cfg, since=since)
    finally:
        conn.close()


def build_progress(conn: sqlite3.Connection, cfg: Config, *,
                   since: int = 0, log_cap: int = LOG_CAP) -> dict:
    channel_id = _channel_id(conn, cfg.channel_id)
    fresh = _freshness(conn, channel_id, cfg)
    view = _freshness_view(fresh)

    if not _has_table(conn, "rebuild_events"):
        families = _families(conn, 0, None, fresh["families"])
        return {
            "running": False, "abandoned": False, "started_at": None, "phase": None,
            "families": families, "log": [], "totals": _totals(families, None),
            "latest_id": 0, "last": None, "freshness": view,
        }

    latest_id = int(conn.execute(
        "SELECT COALESCE(MAX(id), 0) FROM rebuild_events").fetchone()[0])
    log = read_events(conn, since=since, limit=log_cap)

    latest = conn.execute(
        "SELECT id, started_at, finished_at, phase, message, rows, seconds "
        "FROM rebuild_events WHERE kind = 'run' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    run_start_id = int(conn.execute(
        "SELECT COALESCE(MAX(id), 0) FROM rebuild_events "
        "WHERE kind = 'run' AND phase = 'started'").fetchone()[0])
    run_phase = str(latest["phase"]) if latest is not None else None
    running = run_phase == "started"
    # A process killed between `started` and any finish leaves the start row
    # forever; past the threshold the run is reported as abandoned instead of
    # still running, and its family rows fall back to `pending`.
    abandoned = running and _abandoned(latest["started_at"])
    if abandoned:
        running = False
        run_phase = None
    # An abandoned run's family rows belong to a process that is gone, so read
    # none of them: the families fall back to `pending` rather than `running`.
    families = _families(conn, 0 if abandoned else run_start_id, run_phase,
                         fresh["families"])

    phase = None
    started_at = None
    seconds = None
    if running:
        started_at = latest["started_at"]
        seconds = _elapsed(started_at)
        writing = conn.execute(
            "SELECT 1 FROM rebuild_events "
            "WHERE kind = 'family' AND phase = 'started' AND id > ? LIMIT 1",
            (run_start_id,),
        ).fetchone() is not None
        phase = "writing" if writing else "deriving"

    last = None
    if latest is not None and run_phase in ("finished", "failed"):
        last = {
            "status": run_phase,
            "finished_at": latest["finished_at"],
            "seconds": latest["seconds"],
            "rows": latest["rows"],
            "message": latest["message"],
        }
        seconds = latest["seconds"]

    return {
        "running": running,
        "abandoned": abandoned,
        "started_at": started_at,
        "phase": phase,
        "families": families,
        "log": log,
        "totals": _totals(families, seconds),
        "latest_id": latest_id,
        "last": last,
        "freshness": view,
    }


def _totals(families: list[dict], seconds: Any) -> dict:
    done = [family for family in families if family["state"] == "done"]
    return {
        "families": len(done),
        "rows": sum(int(family["rows"] or 0) for family in done),
        "seconds": seconds,
    }


def _families(conn: sqlite3.Connection, run_start_id: int, run_phase: str | None,
              fresh: dict[str, dict]) -> list[dict]:
    latest: dict[str, Any] = {}
    if run_start_id:
        for row in conn.execute(
            "SELECT family, phase, rows, seconds FROM rebuild_events "
            "WHERE kind = 'family' AND id > ? ORDER BY id",
            (int(run_start_id),),
        ):
            latest[str(row["family"])] = row
    built: list[dict] = []
    for family in FAMILIES:
        entry = latest.get(family)
        if entry is None:
            state, rows, seconds = "pending", None, None
        elif entry["phase"] == "finished":
            state, rows, seconds = "done", entry["rows"], entry["seconds"]
        elif run_phase == "failed":
            state, rows, seconds = "failed", None, None
        else:
            state, rows, seconds = "running", None, None
        facts = fresh.get(family, {})
        built.append({
            "family": family,
            "state": state,
            "rows": rows,
            "seconds": seconds,
            "computed_at": facts.get("computed_at"),
            "added_since": facts.get("added_since"),
            "stale": facts.get("stale", True),
        })
    return built


def _freshness(conn: sqlite3.Connection, channel_id: str, cfg: Config) -> dict:
    """Per-family "is this current?" without counting every message.

    The newest id is one indexed lookup. A per-family count is only paid when a
    family is already known to be behind, and then it counts the tail after the
    build rather than the whole table.
    """
    newest = _newest_message_id(conn, channel_id)
    meta = _rollup_meta(conn, channel_id)
    try:
        from discord_scraper.rollups.build import config_digest

        digest = config_digest(cfg, conn)
    except Exception:
        digest = None

    per: dict[str, dict] = {}
    built_at = None
    added: list[int] = []
    any_stale = False
    for family in FAMILIES:
        recorded = meta.get(family)
        if recorded is None:
            per[family] = {"computed_at": None, "added_since": None, "stale": True}
            any_stale = True
            continue
        computed = recorded["computed_at"]
        if computed and (built_at is None or computed > built_at):
            built_at = computed
        source_behind = newest is not None and (recorded["source_max_message_id"] or "") != newest
        stale = source_behind or bool(digest and recorded["config_hash"] != digest)
        since = _added_since(conn, channel_id, recorded["source_max_message_id"], newest) \
            if source_behind else 0
        if since is not None:
            added.append(since)
        per[family] = {"computed_at": computed, "added_since": since, "stale": stale}
        any_stale = any_stale or stale

    return {
        "built_at": built_at,
        "current": bool(meta) and not any_stale,
        "added_since": (max(added) if added else (0 if meta else None)),
        "newest_message_id": newest,
        "families": per,
    }


def _freshness_view(fresh: dict) -> dict:
    return {
        "built_at": fresh["built_at"],
        "current": fresh["current"],
        "added_since": fresh["added_since"],
        "newest_message_id": fresh["newest_message_id"],
    }


def _rollup_meta(conn: sqlite3.Connection, channel_id: str) -> dict[str, dict]:
    if not _has_table(conn, "rollup_meta"):
        return {}
    return {
        str(row["family"]): {
            "computed_at": row["computed_at"],
            "source_max_message_id": row["source_max_message_id"],
            "config_hash": row["config_hash"],
        }
        for row in conn.execute(
            "SELECT family, computed_at, source_max_message_id, config_hash "
            "FROM rollup_meta WHERE channel_id = ?",
            (channel_id,),
        )
    }


def _added_since(conn: sqlite3.Connection, channel_id: str, built_newest: str | None,
                 newest: str | None) -> int | None:
    """How many messages arrived after the build.

    Ids are chronological snowflakes, so counting the tail is exact while the
    scraper only appends. This runs only when the family is already behind.
    """
    if not built_newest or not newest or built_newest == newest:
        return 0
    try:
        return int(conn.execute(
            "SELECT COUNT(*) FROM messages WHERE channel_id = ? AND id > ?",
            (channel_id, built_newest),
        ).fetchone()[0] or 0)
    except sqlite3.OperationalError:
        return None


def _newest_message_id(conn: sqlite3.Connection, channel_id: str) -> str | None:
    """The newest message id, via the primary-key index, like ``is_stale``."""
    for sql in (
        "SELECT id FROM messages INDEXED BY sqlite_autoindex_messages_1 "
        " WHERE channel_id = ? ORDER BY id DESC LIMIT 1",
        "SELECT id FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT 1",
    ):
        try:
            row = conn.execute(sql, (channel_id,)).fetchone()
        except sqlite3.OperationalError:
            continue
        return None if row is None else str(row[0])
    return None


def _channel_id(conn: sqlite3.Connection, default: str) -> str:
    """The operator's channel override, read without importing ``admin.py``."""
    try:
        row = conn.execute("SELECT value FROM config WHERE key = 'channel_id'").fetchone()
    except sqlite3.OperationalError:
        return default
    return str(row[0]) if row is not None and row[0] else default


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    try:
        return conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
        ).fetchone() is not None
    except sqlite3.OperationalError:
        return False


def _elapsed(started_at: str | None) -> float | None:
    if not started_at:
        return None
    try:
        then = datetime.fromisoformat(started_at)
    except ValueError:
        return None
    now = datetime.now(then.tzinfo) if then.tzinfo else datetime.now()
    return max(0.0, round((now - then).total_seconds(), 1))


def _abandoned(started_at: str | None) -> bool:
    """True when a started run has outlived the threshold — its process died."""
    elapsed = _elapsed(started_at)
    return elapsed is not None and elapsed > ABANDONED_AFTER_SECONDS
