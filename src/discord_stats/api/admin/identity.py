"""Who is who: merging alt accounts into one person, and who shows at all."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from discord_stats.api.admin.common import log_event
from discord_stats.api.deps import board
from discord_scraper.config import Config
from discord_scraper.timeutil import utc_stamp

router = APIRouter()


class IdentityRequest(BaseModel):
    merges: list[dict]
    # Canonicas whose pinned name this call should drop. Undo uses it to clear a
    # pin the merge it is undoing introduced for an id that had no group before.
    clear_names: list[str] = []


def _pinned_name(conn: sqlite3.Connection, channel_id: str, canonical: str) -> str | None:
    """The display name an operator pinned for this id, or ``None``.

    Undo needs this: the merge set is restored by another PUT, but the name the
    merge pinned lives in ``author_names`` and would otherwise outlive the undo.
    """
    row = conn.execute(
        "SELECT name FROM author_names "
        "WHERE channel_id = ? AND author_id = ? AND renamed = 1",
        (channel_id, canonical),
    ).fetchone()
    return str(row[0]) if row is not None else None


def _migrate_admins(
    conn: sqlite3.Connection, cfg: Config, canonical_of: dict[str, str]
) -> list[dict]:
    """Move admin rights along with the person when a merge absorbs an admin id.

    Admin is keyed on a Discord id, so absorbing that id into somebody else would
    otherwise leave the privilege on a dead account (or drop it entirely). The
    surviving canonical gets a row, the absorbed row is deleted and its live
    sessions follow, because the same person is still behind them. The configured
    admin (``ADMIN_DISCORD_ID``) cannot be deleted — the config is a second
    source — so its row stays and the response flags it for the UI to explain.
    """
    migrated: list[dict] = []
    for row in conn.execute("SELECT discord_id FROM admins").fetchall():
        who = str(row[0])
        target = canonical_of.get(who, who)
        if target == who:
            continue
        configured = bool(cfg.admin_id) and who == str(cfg.admin_id)
        conn.execute(
            "INSERT OR IGNORE INTO admins (discord_id, added_at, added_by) VALUES (?, ?, 'merge')",
            (target, utc_stamp()),
        )
        if not configured:
            conn.execute("DELETE FROM admins WHERE discord_id = ?", (who,))
            conn.execute(
                "UPDATE sessions SET discord_id = ? WHERE discord_id = ?", (target, who)
            )
        migrated.append({"from": who, "to": target, "configured": configured})
    return migrated


@router.put("/identity")
def put_identity(request: Request, body: IdentityRequest) -> dict:
    """Replace the channel's merges. Add an alt, or drop it, with the same call.

    The set is validated as a whole before anything is written, because an
    account may belong to exactly one person: the same id in two merges is not a
    merge, it is a chain that either crashes the insert or silently absorbs a
    whole identity. Absorbing one is legitimate, but the caller must say so by
    listing every account in the surviving merge and dropping the absorbed group.

    A merge may carry ``name``: the display name the operator chose to win. It is
    written to ``author_names`` with ``renamed = 1`` so a rebuild keeps it, and an
    explicit ``name: null`` clears that pin again. The response carries the state
    the call replaced — names included — which is what the undo button writes
    back, so undo restores the whole chain and the names it had.
    """
    with board(request, write=True) as (conn, cfg):
        previous = [
            {
                "canonical": canonical,
                "accounts": members,
                "name": _pinned_name(conn, cfg.channel_id, canonical),
            }
            for canonical, members in sorted(_grouped_merges(conn, cfg.channel_id).items())
        ]
        rows = []
        pinned: list[tuple[str, str]] = []
        clears: list[str] = []
        parsed: list[tuple[str, list[str]]] = []
        canonicals: set[str] = set()
        for merge in body.merges:
            canonical = str((merge or {}).get("canonical") or "").strip()
            accounts = [str(a).strip() for a in (merge or {}).get("accounts") or [] if str(a).strip()]
            if not canonical:
                raise HTTPException(status_code=400, detail="every merge needs a canonical id")
            if len(set(accounts)) != len(accounts):
                raise HTTPException(status_code=400, detail=f"duplicate account in {canonical}")
            members = sorted({canonical, *accounts})
            if len(members) < 2:
                raise HTTPException(
                    status_code=400,
                    detail=f"{canonical} cannot be merged with itself — a merge needs at least two accounts",
                )
            parsed.append((canonical, members))
            canonicals.add(canonical)

        # An account belongs to one person. Two merges sharing one is either a
        # cycle (A holds B while B holds A) or the silent absorption this screen
        # exists to prevent; both are refused here rather than at the insert.
        owner: dict[str, str] = {}
        for canonical, members in parsed:
            for account in members:
                other = owner.get(account)
                if other is not None and other != canonical:
                    if account in canonicals:
                        raise HTTPException(
                            status_code=400,
                            detail=(
                                f"{account} is the canonical of another identity — merge that "
                                "whole identity so its alts move explicitly, instead of listing "
                                "it as a plain alt"
                            ),
                        )
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"{account} is already in the merge for {other} — an account can "
                            "belong to only one person"
                        ),
                    )
                owner[account] = canonical

        for canonical, members in parsed:
            rows.extend((cfg.channel_id, canonical, account, None) for account in members)
        for merge, (canonical, _members) in zip(body.merges, parsed):
            if "name" not in (merge or {}):
                continue
            name = str((merge or {}).get("name") or "").strip()
            if name:
                pinned.append((canonical, name))
            else:
                clears.append(canonical)
        pinned_ids = {canonical for canonical, _name in pinned}
        clears.extend(
            str(who).strip()
            for who in body.clear_names
            if str(who).strip() and str(who).strip() not in pinned_ids
        )

        conn.execute("DELETE FROM identity WHERE channel_id = ?", (cfg.channel_id,))
        conn.executemany(
            "INSERT INTO identity (channel_id, canonical_id, account_id, note) VALUES (?, ?, ?, ?)",
            rows,
        )
        for canonical, name in pinned:
            conn.execute(
                """
                INSERT INTO author_names (channel_id, author_id, name, renamed, included)
                VALUES (?, ?, ?, 1, 1)
                ON CONFLICT (channel_id, author_id) DO UPDATE
                    SET name = excluded.name, renamed = 1
                """,
                (cfg.channel_id, canonical, name),
            )
        for canonical in clears:
            conn.execute(
                "UPDATE author_names SET renamed = 0 WHERE channel_id = ? AND author_id = ?",
                (cfg.channel_id, canonical),
            )
        admins_moved = _migrate_admins(conn, cfg, owner)
        conn.commit()
        merges = [
            {"canonical": canonical, "accounts": members}
            for canonical, members in sorted(_grouped_merges(conn, cfg.channel_id).items())
        ]
        added, removed = _identity_delta(previous, merges)
        phase = "merged" if added > removed else ("unmerged" if removed else "updated")
        moved = f", {len(admins_moved)} admin moved" if admins_moved else ""
        log_event(request, scope="identity", phase=phase,
                   message=(f"identity {phase}: +{added} -{removed} accounts across "
                            f"{len(merges)} identities{moved}"))
        return {
            "merges": merges,
            "cache_stale": True,
            "previous": previous,
            "admins_moved": admins_moved,
        }


def _identity_delta(previous: list[dict], merges: list[dict]) -> tuple[int, int]:
    """How many accounts this call added to, and removed from, the merge map."""
    before = {str(account) for group in previous for account in group.get("accounts") or []}
    after = {str(account) for group in merges for account in group.get("accounts") or []}
    return len(after - before), len(before - after)


def _grouped_merges(conn: sqlite3.Connection, channel_id: str) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for canonical, account in conn.execute(
        "SELECT canonical_id, account_id FROM identity WHERE channel_id = ? ORDER BY account_id",
        (channel_id,),
    ):
        grouped.setdefault(canonical, []).append(account)
    return grouped


class InclusionRequest(BaseModel):
    included: dict[str, bool]


@router.put("/inclusions")
def put_inclusions(request: Request, body: InclusionRequest) -> dict:
    """Who shows (§5.6). Hide, never delete: the messages stay on disk."""
    with board(request, write=True) as (conn, cfg):
        for author_id, shown in body.included.items():
            conn.execute(
                """
                INSERT INTO author_names (channel_id, author_id, name, renamed, included)
                VALUES (?, ?, ?, 0, ?)
                ON CONFLICT (channel_id, author_id) DO UPDATE SET included = excluded.included
                """,
                (cfg.channel_id, str(author_id), str(author_id), 1 if shown else 0),
            )
        conn.commit()
        return {"included": dict(body.included), "cache_stale": True}
