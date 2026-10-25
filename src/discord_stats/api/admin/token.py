"""The Discord token: check it, replace it, forget it — never echo it."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from discord_stats.api.admin.common import log_event, saved_config
from discord_stats.api.deps import board, database
from discord_scraper.scraper import api as discord_api
from discord_scraper.timeutil import utc_stamp

router = APIRouter()


# An on-demand check is a button, not a job: it must answer in seconds, so it
# uses a short timeout instead of the scraper's 30 s.
TOKEN_TEST_TIMEOUT = 10.0

# The board shows the newest answer; the older ones are only useful as a short
# failure trail, so the table is pruned to this many rows on every write.
TOKEN_CHECK_HISTORY = 50


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
    checked_at = utc_stamp()
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
    with database(request, write=True) as conn:
        try:
            _store_token_check(conn, result)
        except sqlite3.OperationalError:
            # An unwritable control plane must not erase the answer the button
            # was pressed for; the reply is still honest, just not remembered.
            pass


def _token_source(request: Request) -> str:
    """Where the token in use comes from — never the token itself.

    The worker records what it started with: in a container only the worker
    may hold DISCORD_TOKEN, and this process would wrongly answer "none".
    """
    if _read_saved_token(request):
        return "saved"
    if request.app.state.cfg.token:
        return "environment"
    with database(request, write=True) as conn:
        try:
            found = conn.execute(
                "SELECT value FROM worker_state WHERE key = 'token_source'"
            ).fetchone()
        except sqlite3.OperationalError:
            found = None
    return "environment" if found and found[0] == "environment" else "none"


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

    cfg = saved_config(request)
    # Read at click time, so a token saved a moment ago is the one tested.
    token = current_token(cfg, request.app.state.db_path)
    if not token:
        # In a container only the worker may hold DISCORD_TOKEN. Asking Discord
        # with nothing would come back 401 and read as a dead token.
        raise HTTPException(
            status_code=409,
            detail=("this server holds no token to check — save one here, or use "
                    "Probe token, which runs on the worker that has it"),
        )
    result = run_token_check(token, cfg.channel_id)
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

    cfg = saved_config(request)
    result = run_token_check(token, cfg.channel_id)
    if not result["ok"]:
        status = result.get("http_status")
        detail = ("Discord rejected that token — nothing was saved" if status == 401
                  else f"could not check that token ({result.get('error')}) — nothing was saved")
        raise HTTPException(status_code=400 if status == 401 else 502, detail=detail)
    write_token(request.app.state.db_path, token)
    _remember_check(request, result)
    try:
        with database(request, write=True) as conn:
            enqueue(conn, cfg.channel_id, "probe")
    except sqlite3.Error:
        # The token is saved either way; a busy database only means the worker
        # meets it on its next interval instead of in fifteen seconds.
        pass
    log_event(request, scope="token", message="token replaced from the admin board")
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
    with board(request, write=True) as (conn, cfg):
        enqueue(conn, cfg.channel_id, "probe")
    log_event(request, scope="token", message="saved token removed from the admin board")


@router.get("/token")
def token_status(request: Request) -> dict:
    """The stored last check. ``unknown`` is a real state: never checked."""
    with database(request, write=True) as conn:
        try:
            row = conn.execute(
                "SELECT * FROM token_checks ORDER BY id DESC LIMIT 1"
            ).fetchone()
        except sqlite3.OperationalError:
            row = None
    if row is None:
        return {"status": "unknown", "checked_at": None, "bot": None,
                "error": None, "channel": None, "source": _token_source(request)}
    return {**_token_result(row), "source": _token_source(request)}
