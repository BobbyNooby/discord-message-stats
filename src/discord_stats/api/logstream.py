"""The live log stream: server-sent events over the control-plane log.

Server-sent events, not WebSockets. The traffic is one-way (server → browser),
and this tier already runs Starlette, whose WebSocket support needs an extra
package (``websockets`` or ``wsproto``) that is not installed — while SSE needs
nothing new and the browser reconnects on its own through ``EventSource``. So WS
would add a dependency to buy half-duplex behaviour this feed cannot use.

The writer is a **different process** from the API in production
(``serve --api`` and ``serve --worker`` run separately), so the shared channel is
the ``rebuild_events`` table, not in-process pub/sub. This endpoint polls that
table on a read-only handle and pushes what is new; because the poll reads an
indexed range of a small table it costs the API nothing like a dashboard load,
and it never counts ``messages``.

Framing is the SSE wire format the browser already understands::

    id: 412
    data: {"id": 412, "at": "...", "kind": "op", ...}

    : keep-alive

Each entry's shape is exactly ``api.progress.event_entry``'s, so the frontend
needs one type for the polled log and the live one alike.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from discord_stats.api.progress import read_events
from discord_stats.auth.session import require_admin

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])

# How often the writer's rows are checked. The writer is another process, so
# there is nothing to subscribe to; half a second is the latency an operator
# reads as "live" without making the poll a busy loop.
POLL_SECONDS = 0.5

# A comment frame on an idle connection. Long enough not to waste bytes, short
# enough that a proxy in front of the API does not time the stream out and the
# client can tell the connection is still alive.
HEARTBEAT_SECONDS = 15.0

# One poll's frame budget. Newer rows than this are simply picked up by the next
# poll, so a burst cannot turn one response into an unbounded write.
BATCH = 500

# The cursor starts at the caller's `since`, but `EventSource` resends the id of
# the last frame it accepted in `Last-Event-ID`, and that is the more precise
# answer after a reconnect. Whichever is larger skips only what the client has.
HEADER = "last-event-id"


@router.get("/logs/stream")
def log_stream(request: Request, since: int = Query(0, ge=0)) -> StreamingResponse:
    """Stream log lines newer than the cursor as ``text/event-stream``.

    ``Cache-Control: no-cache`` and ``X-Accel-Buffering: no`` keep caches and
    reverse proxies from holding frames back; ``text/event-stream`` is excluded
    by Starlette's ``GZipMiddleware``, so the response is never buffered for
    compression (which would stall an endless body forever).
    """
    cursor = _cursor(since, request.headers.get(HEADER))
    return StreamingResponse(
        _frames(request.app.state.db_path, cursor),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _cursor(since: int, header: str | None) -> int:
    """The highest of the query's ``since`` and the reconnecting header."""
    try:
        resumed = int(header) if header is not None else None
    except (TypeError, ValueError):
        resumed = None
    if resumed is not None and resumed > since:
        return resumed
    return since


def _open(db_path: str | Path) -> sqlite3.Connection:
    """A read-only handle for this stream alone.

    ``check_same_thread=False`` because the poll runs in a worker thread; calls
    are serialized (each poll is awaited), so no two threads ever use it at once.
    Read-only is what keeps the streaming path unable to write, and one handle
    per stream is what keeps two streams from sharing a cursor's connection.
    """
    conn = sqlite3.connect(
        f"file:{Path(db_path)}?mode=ro", uri=True, check_same_thread=False
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def _frame(event: dict) -> str:
    return f"id: {event['id']}\ndata: {json.dumps(event, separators=(',', ':'))}\n\n"


async def _frames(db_path: str | Path, since: int):
    """Yield frames until the client goes away, then release everything.

    The connection is opened on the first poll and closed exactly once in the
    teardown, whether that teardown is a clean disconnect (``GeneratorExit``) or
    a cancelled task. Nothing is cached in the app, so a closed stream leaves no
    task, no cursor and no connection behind.
    """
    state: dict = {"conn": None, "cursor": since, "polling": False, "closed": False}

    def poll() -> list[dict]:
        state["polling"] = True
        try:
            if state["conn"] is None:
                state["conn"] = _open(db_path)
            events = read_events(
                state["conn"], since=state["cursor"], limit=BATCH, ascending=True
            )
            if events:
                state["cursor"] = events[-1]["id"]
            return events
        finally:
            # If the generator was torn down while this poll was in flight, the
            # handle has to be closed from the thread that owns it.
            state["polling"] = False
            if state["closed"]:
                _close(state)

    def _close() -> None:
        conn = state["conn"]
        state["conn"] = None
        if conn is not None:
            try:
                conn.close()
            except sqlite3.Error:
                pass

    last_beat = time.monotonic()
    try:
        while True:
            try:
                events = await asyncio.to_thread(poll)
            except sqlite3.OperationalError:
                # A database without the log table (or a lock held past the
                # timeout) is "nothing new yet", not the end of the stream.
                events = []
            for event in events:
                yield _frame(event)
            now = time.monotonic()
            if now - last_beat >= HEARTBEAT_SECONDS:
                last_beat = now
                yield ": keep-alive\n\n"
            await asyncio.sleep(POLL_SECONDS)
    except asyncio.CancelledError:
        raise
    finally:
        state["closed"] = True
        if not state["polling"]:
            _close()
