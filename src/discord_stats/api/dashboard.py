"""What the dashboard reads: the payload, the word and media lookups, and health.

The payload is a pure function of the rollups and the config, and it costs
seconds to assemble — so it is assembled once per rebuild, not per request, and
the word periods computed beside it are retired with it.
"""

from __future__ import annotations

import sqlite3
import sys
import time
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request

from discord_stats.api import query, viewer
from discord_stats.api.deps import board, connect, database
from discord_stats.auth.session import Level, require_viewer
from discord_scraper.config import Config
from discord_scraper.overrides import effective_for
from discord_scraper.rollups.schema import is_stale
from discord_scraper.timeutil import utc_stamp

# A local month, as the word-by-month rollup keys it.
MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"
# One answer per period someone looked at, retired with the payload on a
# rebuild. Each is a payload's word fields, tens of kilobytes, so a few dozen.
PERIOD_CACHE_ENTRIES = 32

router = APIRouter()


def _require_rollups(conn: sqlite3.Connection) -> None:
    """Refuse politely when the rollups have never been built.

    A 503 with a sentence beats a 500 with an SQLite traceback, which is what an
    unbuilt database would otherwise produce. The sentence is for the browser —
    the page renders it — so it names the fix in plain words rather than a shell
    command nobody reading the dashboard is going to run.
    """
    if not _rollups_built(conn):
        raise HTTPException(
            status_code=503,
            detail="the rollups have not been built yet — an admin can rebuild them from here",
        )


def _rollups_built(conn: sqlite3.Connection) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rollup_meta'"
    ).fetchone() is not None and conn.execute(
        "SELECT 1 FROM rollup_meta LIMIT 1"
    ).fetchone() is not None


def _built_from(conn: sqlite3.Connection, channel_id: str) -> int | None:
    """How many messages this channel's last build read; ``None`` if never built.

    The build's own record, not a look at ``messages``: the payload is served
    from the rollups alone (§5.3), so whether there is anything to show is too.
    """
    if not channel_id or not _rollups_built(conn):
        return None
    recorded = query.provenance_row(conn, channel_id, "activity")
    return None if recorded is None else recorded["source_count"]


def _setup_needed(conn: sqlite3.Connection, cfg: Config) -> bool:
    """Nothing to show yet: never built for this channel, or built from nothing.

    Both, not just the first: a scrape of the wrong channel finds nothing and
    still queues a rebuild, and an empty build must not pass for a dashboard.
    """
    return not _built_from(conn, cfg.channel_id)


# The jobs a first run waits on. A probe is the worker's own housekeeping.
SETUP_JOB_KINDS = ("catch_up", "backfill", "rebuild_rollups")


def _schema_meta(conn: sqlite3.Connection) -> dict:
    """The database's schema stamp versus what this library expects.

    The dashboard serves regardless: a disagreement means some numbers may be
    from a different revision, not that none of them are readable. So this
    returns a warning line rather than raising — and ``schema_message`` is null
    exactly when the two agree. An unstamped database (built before the stamp
    existed) gets its own honest sentence: unknown, never a made-up number.
    """
    from discord_scraper.rollups.schema import SCHEMA_VERSION, schema_version

    actual = schema_version(conn)
    if actual is None:
        message = (
            "this database has no schema version stamped — it predates versioning; "
            f"this dashboard expects v{SCHEMA_VERSION} — rebuild the rollups to match"
        )
    elif actual != SCHEMA_VERSION:
        message = (
            f"this database was built by library schema v{actual}; this dashboard "
            f"expects v{SCHEMA_VERSION} — rebuild the rollups to match"
        )
    else:
        message = None
    return {
        "schema_version": actual,
        "schema_expected": SCHEMA_VERSION,
        "schema_message": message,
    }


def _channel_meta(cfg: Config) -> dict:
    """Whether a channel is configured yet, and the line to show if not.

    Same shape as the schema and timezone warnings: a fresh volume is seeded
    with an empty ``source.channel_id``, and the dashboard serves anyway — exiting
    there would hide the admin board that is one of the two ways to set it.
    """
    if cfg.channel_id:
        return {"channel_configured": True, "channel_message": None}
    return {
        "channel_configured": False,
        "channel_message": (
            "no channel configured: set source.channel_id in config.toml "
            "(or in the admin board), then scrape that channel"
        ),
    }


def payload_key(conn: sqlite3.Connection, cfg: Config) -> str:
    """What the payload depends on: the rollups' provenance and the config.

    Any rebuild moves ``computed_at``, any config edit moves the digest, so a
    matching key means the assembled payload is still the right answer.
    """
    from discord_scraper.rollups.build import config_digest

    row = conn.execute(
        "SELECT MAX(computed_at), MAX(source_max_message_id), COUNT(*) "
        "  FROM rollup_meta WHERE channel_id = ?",
        (cfg.channel_id,),
    ).fetchone()
    return "|".join([
        cfg.channel_id,
        str(row[0]), str(row[1]), str(row[2]),
        config_digest(cfg, conn),
        cfg.timezone,
    ])


def key_config_hash(key: str) -> str:
    """The digest is the fifth field of the cache key."""
    parts = key.split("|")
    return parts[4] if len(parts) > 4 else ""


def _assemble(conn: sqlite3.Connection, cfg: Config, *, why: str) -> dict:
    started = time.monotonic()
    payload = viewer.bootstrap(conn, cfg)
    print(f"payload {why} in {time.monotonic() - started:.2f}s", file=sys.stderr)
    return payload


def _period_for(app: FastAPI, conn: sqlite3.Connection, cfg: Config, key: tuple,
                first: str | None, last: str | None, picked: tuple[int, ...]) -> dict:
    """Compute one period's word fields and keep them under ``key``."""
    author_rows = query.authors(conn, cfg.channel_id, cfg)
    uses = query.word_author_uses_between(
        conn, cfg.channel_id, query.author_index(author_rows), first, last, picked)
    body = {"built": uses is not None, "from": first, "to": last, "years": list(picked),
            **viewer.period_words(uses or {}, len(author_rows))}
    app.state.period_cache.put(key, body)
    return body


def _warm_the_years(app: FastAPI, conn: sqlite3.Connection, cfg: Config) -> None:
    """Each year's words, so a year chip answers at once.

    A year is the period people pick most and the slowest one to count
    (most of a second on the reference database); a day range is a few
    months and quick, so it is left to the first request that asks.
    """
    found = conn.execute(
        "SELECT DISTINCT substr(month, 1, 4) FROM rollup_word_month WHERE channel_id = ?",
        (cfg.channel_id,),
    ).fetchall()
    base = payload_key(conn, cfg)
    for (year,) in found:
        picked = (int(year),)
        _period_for(app, conn, cfg, (base, None, None, picked), None, None, picked)


def warm_the_payload(app: FastAPI) -> None:
    """Assemble once, in the background, so the first page load is not the one
    that pays for it — then each year's words, for the same reason.

    Best effort, but not silent: a warm-up that fails must say why, or the
    next person debugging "why is the first load slow" has nothing to read.
    """
    try:
        conn = connect(app.state.db_path)
        try:
            if not _rollups_built(conn):
                return
            cfg = effective_for(conn, app.state.cfg)
            app.state.payload_cache = {payload_key(conn, cfg): _assemble(conn, cfg, why="warmed")}
            try:
                _warm_the_years(app, conn, cfg)
            except sqlite3.OperationalError:
                pass   # no month table before the first rebuild: nothing to warm
        finally:
            conn.close()
    except Exception as exc:
        print(f"payload warm-up skipped: {type(exc).__name__}: {exc}", file=sys.stderr)


@router.get("/api/health")
def health(request: Request) -> dict:
    """Liveness plus the banner state (spec §11.7).

    Read from the database on every request, never cached in the process: a
    restart must not reset the banner to healthy. The raw ``last_ingest_at``
    travels with the banner because "never ingested" and "ingested 30 days
    ago" are different sentences, and only the client knows which to print.
    """
    from discord_scraper.worker.state import banner_for

    with database(request, write=True) as conn:
        stored = {}
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'worker_state'"
        ).fetchone():
            stored = dict(conn.execute("SELECT key, value FROM worker_state"))
    return {
        "ok": True,
        "checked_at": utc_stamp(),
        "banner": banner_for(stored),
        "last_ingest_at": stored.get("last_ingest_at"),
        **_channel_meta(request.app.state.cfg),
    }


@router.get("/api/bootstrap")
def bootstrap(request: Request, level: Level = Depends(require_viewer)) -> dict:
    # Admin overrides count as "the configured timezone" (§7.1).
    with board(request) as (conn, cfg):
        _require_rollups(conn)
        if _built_from(conn, cfg.channel_id) == 0:
            # The page asks /api/setup on a 503 and shows the first-run screen.
            raise HTTPException(
                status_code=503,
                detail="nothing has been scraped for this channel yet",
            )
        recorded = query.provenance_row(conn, cfg.channel_id, "activity")
        # A zone disagreement is not unusable data: the buckets are correct
        # for the zone they were built in, and every other panel's numbers
        # are right. Served with a warning in `meta` instead of a 409, which
        # used to blank the whole dashboard — and with an override the
        # rebuild path ignored, could never be cleared at all.
        built_zone = (recorded or {}).get("timezone") or cfg.timezone
        mismatch = bool(recorded) and recorded["timezone"] != cfg.timezone

        key = payload_key(conn, cfg)
        cached = request.app.state.payload_cache.get(key)
        if cached is None:
            cached = _assemble(conn, cfg, why="assembled for a request")
            # One entry is enough: rollups change when somebody rebuilds, and
            # a rebuild replaces the key rather than accumulating entries.
            request.app.state.payload_cache = {key: cached}
        body = dict(cached)
        # Freshness is the one field that can change without a rebuild (a new
        # message arrives), so it is recomputed rather than cached.
        body["meta"] = {
            **cached["meta"],
            # Per-request, like freshness: the payload is shared between
            # viewers, but "may you see /admin" is about the caller.
            "can_admin": level >= Level.ADMIN,
            # `cheap=True`: an indexed MAX(id) instead of a full count. The
            # scraper only appends, so "is there a newer message?" is the
            # question here; the exact count is the CLI's audit.
            "stale": is_stale(conn, cfg.channel_id, "activity",
                              config_hash=key_config_hash(key), cheap=True),
            # The frontend's contract for the warning banner: a flag, both
            # zones, and a line it can show without knowing the details.
            "timezone_mismatch": mismatch,
            "configured_timezone": cfg.timezone,
            "timezone_message": (
                f"These numbers were built in {built_zone}; the configured "
                f"timezone is {cfg.timezone}. Recalculate to rebuild them."
                if mismatch else None
            ),
            # Same shape as the zone warning: what the database says, what
            # this library expects, and one line the browser can print.
            **_schema_meta(conn),
            # And the same again for "there is no channel yet", which is the
            # state of every freshly seeded volume.
            **_channel_meta(cfg),
        }
        return body


@router.get("/api/setup")
def setup(request: Request, level: Level = Depends(require_viewer)) -> dict:
    """Whether the dashboard has anything to show yet, for the first-run screen.

    A viewer learns only that setup is under way. An admin also gets what the
    screen needs to bring the data in: the channel, how many messages have
    arrived, whether a worker is alive, and the newest scrape or rebuild job.
    The page asks only after the bootstrap refused, so an installed dashboard
    never pays for the count.
    """
    with board(request) as (conn, cfg):
        needed = _setup_needed(conn, cfg)
        body: dict[str, Any] = {"needed": needed, "can_admin": level >= Level.ADMIN}
        if level < Level.ADMIN:
            return body
        # The one live figure during a first scrape: rows arriving, counted
        # through idx_channel. The board asks only while setup is under way.
        count = 0
        if cfg.channel_id:
            try:
                count = int(conn.execute(
                    "SELECT COUNT(*) FROM messages WHERE channel_id = ?", (cfg.channel_id,)
                ).fetchone()[0] or 0)
            except sqlite3.OperationalError:
                pass   # a file the boot migration could not give a messages table
        seen = conn.execute(
            "SELECT value FROM worker_state WHERE key = 'last_seen_at'"
        ).fetchone()
        marks = ",".join("?" * len(SETUP_JOB_KINDS))
        job = conn.execute(
            "SELECT id, kind, status, phase, requested_at, started_at, finished_at, "
            "       result, error "
            f" FROM jobs WHERE channel_id = ? AND kind IN ({marks}) ORDER BY id DESC LIMIT 1",
            (cfg.channel_id, *SETUP_JOB_KINDS),
        ).fetchone()
        return {
            **body,
            "channel_id": cfg.channel_id,
            "messages": count,
            "rollups_built": _built_from(conn, cfg.channel_id) is not None,
            "worker_seen_at": seen[0] if seen else None,
            "job": dict(job) if job else None,
        }


@router.get("/api/recent")
def recent_messages(request: Request, limit: int | None = Query(None, ge=1, le=200),
                    _level: Level = Depends(require_viewer)) -> dict:
    """The "is this still alive" strip (§11.8), bounded by ``ui.show_recent``.

    ``limit`` lets a caller ask for fewer messages; the 200 ceiling is this
    endpoint's own, so a generous ``ui.show_recent`` cannot widen it.
    """
    from discord_stats.api.recent import recent

    with board(request) as (conn, cfg):
        return recent(conn, cfg, limit=min(limit or cfg.show_recent, 200))


@router.get("/api/media")
def media(request: Request,
          provider: str | None = Query(None, max_length=64),
          kind: str | None = Query(None, min_length=1, max_length=32),
          limit: int = Query(12, ge=1, le=100),
          _level: Level = Depends(require_viewer)) -> dict:
    """Top reposted media, optionally for one provider and one kind.

    The dashboard's payload ranks everything together, where a GIF beats a
    video link every time; this is how "top YouTube links" becomes visible.
    `kind` is a WHERE clause, not a filter over the page: narrowing to one
    kind has to search the whole rollup, or a chip would only ever reorder
    the fifty rows the limit returned. `kinds` is the set the chips offer.
    """
    with board(request) as (conn, cfg):
        _require_rollups(conn)
        return {
            "provider": provider,
            "kind": kind,
            "kinds": query.media_kinds(conn, cfg.channel_id, provider=provider),
            "items": query.top_media(conn, cfg.channel_id, limit,
                                     provider=provider, kind=kind),
        }


@router.get("/api/media/detail")
def media_detail(request: Request, url: str = Query(..., min_length=1, max_length=2048),
                 _level: Level = Depends(require_viewer)) -> dict:
    """Everything about one reposted URL: who posted it, how often, and when.

    ``people`` and ``months`` are ``null`` (not empty) on a database built
    before the per-person table existed, so the card can say "recalculate"
    rather than "nobody posted this".
    """
    with board(request) as (conn, cfg):
        _require_rollups(conn)
        item = query.media_item(conn, cfg.channel_id, url)
        if item is None:
            raise HTTPException(status_code=404, detail="no media with that URL")
        posts = query.media_posts(conn, cfg.channel_id, url)
        names = {row["id"]: row["name"] for row in query.authors(conn, cfg.channel_id)}
    body: dict[str, Any] = {"item": item[:7], "first_seen": item[7],
                            "last_seen": item[8], "people": None, "months": None,
                            "first_post": None}
    if posts is None:
        return body
    people: dict[str, dict[str, Any]] = {}
    for _month, author, uses, first_seen, _mid in posts:
        person = people.setdefault(author, {"id": author,
                                            "name": names.get(author, author),
                                            "count": 0, "first_seen": first_seen})
        person["count"] += uses
        person["first_seen"] = min(person["first_seen"], first_seen)
    body["people"] = sorted(people.values(), key=lambda p: (-p["count"], p["first_seen"]))
    body["months"] = [{"month": month, "id": author, "count": uses}
                      for month, author, uses, _first, _mid in posts]
    if posts:
        _month, author, _uses, first_seen, message_id = min(posts, key=lambda p: p[3])
        body["first_post"] = {
            "id": author, "name": names.get(author, author), "at": first_seen,
            "message_id": message_id,
            # The scrape records no guild id, so this is the DM / group DM
            # form of a message link; a server channel would need the guild.
            "jump_url": f"https://discord.com/channels/@me/{cfg.channel_id}/{message_id}",
        }
    return body


@router.get("/api/words")
def words(request: Request, q: str = Query(..., min_length=1),
          limit: int = Query(50, ge=1, le=500),
          _level: Level = Depends(require_viewer)) -> dict:
    """Search the **full** word index, which the payload only slices.

    ``months`` is the word's timeline; ``null`` means the month table has not
    been built yet, which is a "recalculate", not "never said".
    """
    # The channel the admin board saved, like every other endpoint — the
    # file's channel would search a chat the board moved away from.
    with board(request) as (conn, cfg):
        _require_rollups(conn)
        word = q.strip().lower()
        matches = query.words_for(conn, cfg.channel_id, word)
        names = {row["id"]: row["name"] for row in query.authors(conn, cfg.channel_id)}
        timeline = query.word_timeline(conn, cfg.channel_id, word)
    return {
        "word": word,
        "total": sum(count for _author, count in matches),
        "authors": [
            {"id": author_id, "name": names.get(author_id, author_id), "count": count}
            for author_id, count in matches[:limit]
        ],
        "months": None if timeline is None else [
            {"month": month, "id": author, "count": count}
            for month, author, count in timeline
        ],
    }


@router.get("/api/words/period")
def words_for_period(
    request: Request,
    first: str | None = Query(None, alias="from", pattern=MONTH_PATTERN),
    last: str | None = Query(None, alias="to", pattern=MONTH_PATTERN),
    years: str | None = Query(None, pattern=r"^\d{4}(,\d{4})*$", max_length=200),
    _level: Level = Depends(require_viewer),
) -> dict:
    """The payload's word fields for a stretch of months and/or some years.

    What the word cards draw while a time filter is on; with none they use
    the payload and never ask. Month grain, because that is what the rollup
    keeps: the caller rounds a day range out to whole months. ``built`` is
    false until a rebuild has written the month table.
    """
    picked = tuple(sorted({int(year) for year in years.split(",")})) if years else ()
    with board(request) as (conn, cfg):
        _require_rollups(conn)
        # Keyed on the payload's own key, so a rebuild or a merge retires
        # every cached period along with the payload it was computed beside.
        key = (payload_key(conn, cfg), first, last, picked)
        cached = request.app.state.period_cache.get(key)
        if cached is not None:
            return cached
        return _period_for(request.app, conn, cfg, key, first, last, picked)


@router.get("/api/words/suggest")
def word_suggestions(request: Request, q: str = Query(..., min_length=1, max_length=64),
                     limit: int = Query(8, ge=1, le=25),
                     _level: Level = Depends(require_viewer)) -> dict:
    """Words in the full index that start with what is typed, most used first."""
    with board(request) as (conn, cfg):
        _require_rollups(conn)
        return {"words": [[word, uses] for word, uses in
                          query.word_suggestions(conn, cfg.channel_id, q, limit)]}
