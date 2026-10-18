"""Who is allowed in, and who was told to stay out.

Two sources, checked in this order: an explicit `viewers` row (which is how a
lurker is admitted and how a poster is removed), then the auto-allowlist for
people who have posted. Discord's own id is the only key — a name changes.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from discord_stats.auth.admins import is_admin
from discord_stats.auth.session import Level
from discord_scraper.config import Config

LOGIN_WINDOW_MINUTES = 15
LOGIN_ATTEMPT_LIMIT = 10


def decision_for(conn: sqlite3.Connection, cfg: Config, discord_id: str) -> Level | None:
    """The level this Discord account gets, or ``None`` for "not in"."""
    who = str(discord_id or "").strip()
    if not who:
        return None
    # The one admin predicate: a row in `admins`, or the configured id.
    if is_admin(conn, cfg, who):
        return Level.ADMIN

    row = conn.execute(
        "SELECT allow FROM viewers WHERE discord_id = ?", (who,)
    ).fetchone()
    if row is not None:
        # An explicit row is a decision: it beats the auto-allowlist in both
        # directions, so removing somebody does not require deleting their posts.
        return Level.VIEWER if row[0] else None

    if (cfg.allowlist or "posted").lower() != "posted":
        return None
    posted = conn.execute(
        "SELECT 1 FROM messages WHERE author_id = ? LIMIT 1", (who,)
    ).fetchone()
    return Level.VIEWER if posted else None


def record_login_attempt(conn: sqlite3.Connection, ip: str, *, ok: bool) -> None:
    """One row per attempt; a success clears the failures for that address."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if ok:
        conn.execute("DELETE FROM login_attempts WHERE ip = ? AND ok = 0", (str(ip),))
    conn.execute(
        "INSERT INTO login_attempts (ip, at, ok) VALUES (?, ?, ?)",
        (str(ip), now, 1 if ok else 0),
    )
    conn.commit()


def too_many_attempts(conn: sqlite3.Connection, ip: str) -> bool:
    since = (datetime.now(timezone.utc) - timedelta(minutes=LOGIN_WINDOW_MINUTES)).isoformat(
        timespec="seconds"
    )
    found = conn.execute(
        "SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND ok = 0 AND at >= ?",
        (str(ip), since),
    ).fetchone()
    return int(found[0]) >= LOGIN_ATTEMPT_LIMIT
