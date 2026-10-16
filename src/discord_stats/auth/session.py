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
        # Development shim, off unless `--dev-auto-login` was passed: no session,
        # no cookie, no row in `sessions` — the visitor is simply treated as the
        # configured level. It exists so a phone can open the site without the
        # login screen; it is a flag and never a default.
        shim = getattr(request.app.state, "dev_auto_login", None)
        return Level[shim.upper()] if shim else None
    from discord_scraper.api.deps import connect_writable

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
