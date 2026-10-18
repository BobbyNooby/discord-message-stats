"""Server-side sessions and privilege levels.

Sessions are rows, not signed cookies: a signed cookie cannot be revoked, and
this is other people's message data (spec §8.2). The database stores only the
hash of the bearer token, so a leaked database copy is not a set of live logins.
"""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from enum import IntEnum

from fastapi import HTTPException, Request

SESSION_COOKIE = "dsh_session"
SESSION_DAYS = 30
TOKEN_BYTES = 32
# How many rows one identity may hold. A login loop otherwise grows the table
# without bound, and the admin board lists every row.
SESSION_LIMIT = 20


class Level(IntEnum):
    """A level, not a flag: ``admin > viewer`` prevents an admin getting 403
    on a viewer page (spec §8.1)."""

    VIEWER = 1
    ADMIN = 2


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def establish_session(
    conn: sqlite3.Connection,
    discord_id: str,
    level: Level,
    ttl_days: int = SESSION_DAYS,
) -> str:
    """Create a session row and return the bearer token (never stored)."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    created = _now()
    # Dead rows first. The cap counts rows, so a login loop's expired (or
    # revoked) leftovers used to fill it and evict the live token that mattered.
    # Purging is per identity and does not touch anyone else's sessions.
    conn.execute(
        "DELETE FROM sessions WHERE discord_id = ? AND (revoked = 1 OR expires_at <= ?)",
        (str(discord_id), created.isoformat(timespec="seconds")),
    )
    conn.execute(
        """
        INSERT INTO sessions (id, discord_id, level, created_at, expires_at, revoked)
        VALUES (?, ?, ?, ?, ?, 0)
        """,
        (
            hash_token(token),
            str(discord_id),
            Level(level).name.lower(),
            created.isoformat(timespec="seconds"),
            (created + timedelta(days=ttl_days)).isoformat(timespec="seconds"),
        ),
    )
    # Keep only the newest rows for this identity. `created_at` has second
    # resolution, so `rowid` breaks the tie and the row just inserted is always
    # among the survivors.
    conn.execute(
        """
        DELETE FROM sessions
         WHERE discord_id = ?
           AND id NOT IN (
                 SELECT id FROM sessions
                  WHERE discord_id = ?
                  ORDER BY created_at DESC, rowid DESC
                  LIMIT ?
               )
        """,
        (str(discord_id), str(discord_id), SESSION_LIMIT),
    )
    conn.commit()
    return token


def session_level(conn: sqlite3.Connection, sid: str) -> Level | None:
    """The level of a live session, or ``None`` if unknown, expired or revoked."""
    if not sid:
        return None
    found = conn.execute(
        "SELECT level, expires_at, revoked FROM sessions WHERE id = ?", (hash_token(sid),)
    ).fetchone()
    if not found:
        return None
    level, expires_at, revoked = found[0], found[1], found[2]
    if revoked:
        return None
    try:
        if datetime.fromisoformat(expires_at) <= _now():
            return None
    except (TypeError, ValueError):
        return None
    try:
        return Level[level.upper()]
    except KeyError:
        return None


def revoke_session(conn: sqlite3.Connection, sid: str) -> None:
    conn.execute("UPDATE sessions SET revoked = 1 WHERE id = ?", (hash_token(sid),))
    conn.commit()


def _current_level(request: Request) -> Level | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        # No cookie, no session, no level. The `--dev-auto-login` shim that
        # treated every visitor as a level was removed: an unauthenticated
        # request must be refused, always.
        return None
    from discord_stats.api.deps import connect_writable

    conn = connect_writable(request.app.state.db_path)
    try:
        return session_level(conn, token)
    finally:
        conn.close()


def require_viewer(request: Request) -> Level:
    level = _current_level(request)
    if level is None:
        raise HTTPException(status_code=401, detail="login required",
                            headers={"WWW-Authenticate": "Session"})
    return level


def require_admin(request: Request) -> Level:
    level = _current_level(request)
    if level is None:
        raise HTTPException(status_code=401, detail="login required",
                            headers={"WWW-Authenticate": "Session"})
    if level < Level.ADMIN:
        raise HTTPException(status_code=403, detail="admin only")
    return level
