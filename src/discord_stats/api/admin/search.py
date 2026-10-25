"""The one endpoint that returns message text.

That is the sole exception to "the API returns aggregates, never message text"
(§4.4), which is why it lives apart and is reachable only through the admin
router, guarded by ``require_admin`` rather than a flag someone could forget.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from discord_stats.api.admin.common import _conn, _effective_for
from discord_scraper.rollups import query

router = APIRouter()


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
