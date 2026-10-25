"""Who may run the board: the admin list and signing everybody else out."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from discord_stats.api.admin.common import log_event
from discord_stats.api.deps import board, database
from discord_stats.auth.admins import (
    AdminLocked,
    UnknownAdmin,
    add_admin,
    list_admins,
    remove_admin,
)
from discord_stats.auth.session import SESSION_COOKIE, hash_token

router = APIRouter()


@router.post("/sessions/revoke-all")
def revoke_all_sessions(request: Request) -> dict:
    """Sign everybody else out. The caller keeps their own session."""
    token = request.cookies.get(SESSION_COOKIE, "")
    with database(request, write=True) as conn:
        cursor = conn.execute(
            "UPDATE sessions SET revoked = 1 WHERE revoked = 0 AND id != ?", (hash_token(token),)
        )
        conn.commit()
        revoked = int(cursor.rowcount or 0)
    log_event(request, scope="session", level="warn", phase="revoked",
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
    with board(request, write=True) as (conn, cfg):
        return {"admins": list_admins(conn, cfg, cfg.channel_id)}


@router.post("/admins", status_code=201)
def add_an_admin(request: Request, body: AdminRequest) -> dict:
    """Grant admin to one id. A typo is refused unless `force` says otherwise."""
    with board(request, write=True) as (conn, cfg):
        actor = _actor(request, conn)
        try:
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
    log_event(request, scope="admin", phase="added",
               message=f"admin added: {added['discord_id']} by {actor}")
    return added


@router.delete("/admins/{discord_id}")
def remove_an_admin(request: Request, discord_id: str) -> dict:
    """Remove one id and revoke its sessions. The last admin cannot go."""
    with board(request, write=True) as (conn, cfg):
        try:
            revoked = remove_admin(conn, cfg, discord_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None
        except AdminLocked as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from None
    log_event(request, scope="admin", level="warn", phase="removed",
               message=f"admin removed: {discord_id} ({revoked} session(s) revoked)")
    return {"removed": discord_id, "revoked": revoked}
