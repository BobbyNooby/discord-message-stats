"""The admin list: who may run the board.

Admin used to mean "your id equals the one ``ADMIN_DISCORD_ID`` in the
environment", which the owner could not change without a restart and a file
edit. Here it is a control-plane row, so the board can grant it to somebody
else. The configured id is seeded into the table at boot (never hardcoded), and
the config stays a second source: a deleted row or an out-of-date seed cannot
lock the owner out.

One predicate answers the question — :func:`is_admin` — so the login level and
the board's own checks cannot drift apart.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from discord_scraper.config import Config


class AdminLocked(Exception):
    """A removal the board refuses, because it would lock people out."""


class UnknownAdmin(Exception):
    """An id with no message in the channel, when the operator has not insisted."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def is_admin(conn: sqlite3.Connection, cfg: Config, discord_id: str) -> bool:
    """Is this Discord id an admin?

    The table **or** the configured id. The second half is the safety net: if
    the row was removed, or an older database never got the seed, the configured
    admin is still an admin.
    """
    who = str(discord_id or "").strip()
    if not who:
        return False
    if cfg.admin_id and who == str(cfg.admin_id):
        return True
    return conn.execute("SELECT 1 FROM admins WHERE discord_id = ?", (who,)).fetchone() is not None


def seed_admin(conn: sqlite3.Connection, admin_id: str | None) -> None:
    """Put the configured admin in the table. Idempotent, and a no-op with none."""
    who = str(admin_id or "").strip()
    if not who:
        return
    conn.execute(
        "INSERT OR IGNORE INTO admins (discord_id, added_at, added_by) VALUES (?, ?, 'config')",
        (who, _now()),
    )
    conn.commit()


def _known(conn: sqlite3.Connection, channel_id: str, discord_id: str) -> bool:
    """Reuse the status panel's ``known`` idea: has this id ever posted here?"""
    return conn.execute(
        "SELECT 1 FROM messages WHERE channel_id = ? AND author_id = ? LIMIT 1",
        (channel_id, discord_id),
    ).fetchone() is not None


def _rows(conn: sqlite3.Connection) -> list[sqlite3.Row | tuple]:
    return conn.execute(
        "SELECT discord_id, added_at, added_by FROM admins ORDER BY added_at, discord_id"
    ).fetchall()


def list_admins(conn: sqlite3.Connection, cfg: Config, channel_id: str) -> list[dict]:
    """Every admin, from the table and from the config, each with ``known``.

    The configured admin is included even with no row, because that is the truth
    :func:`is_admin` answers with — a list that omitted him would let the board
    disagree with the login check.
    """
    seen: dict[str, dict] = {}
    for row in _rows(conn):
        who = str(row[0])
        seen[who] = {
            "discord_id": who,
            "added_at": row[1],
            "added_by": row[2],
            "known": _known(conn, channel_id, who),
            "source": "table",
        }
    configured = str(cfg.admin_id or "").strip()
    if configured and configured not in seen:
        seen[configured] = {
            "discord_id": configured,
            "added_at": None,
            "added_by": "config",
            "known": _known(conn, channel_id, configured),
            "source": "config",
        }
    elif configured:
        seen[configured]["source"] = "config"
    return list(seen.values())


def add_admin(
    conn: sqlite3.Connection,
    *,
    discord_id: str,
    channel_id: str,
    added_by: str,
    force: bool = False,
) -> dict:
    """Add one id, refusing a typo unless the operator insists.

    An id that matches no message is almost always a typo, and a typo'd admin is
    a person who can read every message. Refusing it is the loud default; the
    ``force`` flag is the operator's override for the honest case (their own id
    simply never posted here).
    """
    who = str(discord_id or "").strip()
    if not who:
        raise ValueError("a Discord id is required")
    known = _known(conn, channel_id, who)
    if not known and not force:
        raise UnknownAdmin(
            f"{who} matches no message in this channel — check the id, or add it anyway"
        )
    conn.execute(
        "INSERT OR IGNORE INTO admins (discord_id, added_at, added_by) VALUES (?, ?, ?)",
        (who, _now(), added_by),
    )
    conn.commit()
    row = conn.execute(
        "SELECT added_at, added_by FROM admins WHERE discord_id = ?", (who,)
    ).fetchone()
    return {
        "discord_id": who,
        "added_at": row[0],
        "added_by": row[1],
        "known": known,
        "source": "table",
    }


def remove_admin(conn: sqlite3.Connection, cfg: Config, discord_id: str) -> int:
    """Remove one id and revoke its sessions. Returns how many were revoked.

    Two refusals, both about not locking the board. The configured admin has no
    row to remove that the config would not immediately reinstate, and the last
    admin cannot go: with an empty list and no configured id, nobody could ever
    add anybody back.
    """
    who = str(discord_id or "").strip()
    row = conn.execute("SELECT 1 FROM admins WHERE discord_id = ?", (who,)).fetchone()
    if row is None:
        raise LookupError(f"{who} is not in the admin list")
    if cfg.admin_id and who == str(cfg.admin_id):
        raise AdminLocked(
            "that is the configured admin (ADMIN_DISCORD_ID) — remove the setting there instead"
        )
    remaining = [str(r[0]) for r in _rows(conn) if str(r[0]) != who]
    if not remaining and not cfg.admin_id:
        raise AdminLocked("that is the last admin — removing it would lock everyone out")

    conn.execute("DELETE FROM admins WHERE discord_id = ?", (who,))
    # Demotion has to bite now, not at the session's 30-day expiry: the safer
    # reading is that a removed admin's live sessions stop working immediately.
    cursor = conn.execute(
        "UPDATE sessions SET revoked = 1 WHERE discord_id = ? AND revoked = 0", (who,)
    )
    conn.commit()
    return int(cursor.rowcount or 0)
