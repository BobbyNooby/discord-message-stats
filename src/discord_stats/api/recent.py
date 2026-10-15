"""The last few messages — the one viewer endpoint that returns message text.

Spec §11.8 makes this a deliberate, bounded hole in the aggregates-only rule:
it exists so a stats page that has quietly stopped updating cannot look
identical to a healthy one. Bounded means: viewer-gated, newest-first, and
truncated here rather than in the browser, so the full body never crosses the
wire at all.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from discord_scraper.config import Config

# ~120 chars (§11.8). The ellipsis is counted inside the limit: a "120 char"
# body that is 121 bytes long is the kind of detail that makes a spec lie.
BODY_LIMIT = 120


def _truncate(text: str) -> tuple[str, bool]:
    body = " ".join((text or "").split())
    if len(body) <= BODY_LIMIT:
        return body, False
    return body[: BODY_LIMIT - 1].rstrip() + "…", True


def recent(conn: sqlite3.Connection, cfg: Config, limit: int | None = None) -> dict[str, Any]:
    """``{"messages": [...], "truncated": bool}``, newest first.

    Reads ``messages`` — this is the only viewer endpoint allowed to — but sends
    only the author's display name, the timestamp and a truncated body: no
    ``raw``, no embeds, no attachments, no mentions.
    """
    count = cfg.show_recent if limit is None else limit
    if count <= 0:
        return {"messages": [], "truncated": False}

    found = conn.execute(
        """
        SELECT m.author_id, m.created_at, m.content, COALESCE(n.name, m.author_id)
          FROM messages m
          LEFT JOIN author_names n
                 ON n.channel_id = m.channel_id AND n.author_id = m.author_id
         WHERE m.channel_id = ? AND m.content IS NOT NULL AND TRIM(m.content) <> ''
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT ?
        """,
        (cfg.channel_id, count),
    ).fetchall()

    messages = []
    truncated = False
    for author_id, created_at, content, name in found:
        body, cut = _truncate(content)
        truncated = truncated or cut
        messages.append({
            "author": name,
            "author_id": author_id,
            "created_at": created_at,
            "body": body,
        })
    return {"messages": messages, "truncated": truncated}
