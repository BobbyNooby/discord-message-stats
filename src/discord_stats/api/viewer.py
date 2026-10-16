"""The viewer payload — one shape the whole frontend is built against.

Key names and array layouts are the mockup's, not invented here: the mockup
(`docs/design/graphs-mockup-built.html`) reads `D.cells[day, author, msgs, chars,
replies, media, edits]` through its ``C_MSGS…C_EDITS`` constants, `D.heat[dow,
hour, author, year, msgs]`, and so on. Changing a layout here breaks the charts
silently, which is why the tests assert the widths.
"""

from __future__ import annotations

import gzip
import json
import sqlite3
from typing import Any

from discord_scraper.config import Config
from discord_scraper.rollups import query
from discord_scraper.rollups.build import config_digest
from discord_scraper.rollups.schema import is_stale
from discord_scraper.text import load_stopwords

# The spec ships a slice, not the vocabulary: 54,570 distinct words is not a
# payload, it is a database (spec §5.4, §9.1).
WORD_SLICE = 500
WORD_AUTHOR_SLICE = 420


def bootstrap(conn: sqlite3.Connection, cfg: Config) -> dict[str, Any]:
    """Assemble the whole viewer payload from the rollup tables."""
    channel = cfg.channel_id
    day_list = query.days(conn, channel)
    day_index = {day: index for index, day in enumerate(day_list)}

    author_rows = query.authors(conn, channel)
    author_index = {row["id"]: index for index, row in enumerate(author_rows)}

    cells = query.activity_cells(conn, channel, day_index, author_index)
    heat = query.heat_cells(conn, channel, author_index)
    words = query.top_words(conn, channel, WORD_SLICE)
    indexed_words = {word for word, _uses in words[:WORD_AUTHOR_SLICE]}
    by_word: dict[str, list[list[int]]] = {}
    author_totals = [0] * len(author_rows)
    author_distinct = [0] * len(author_rows)
    for word, _uses, author_id, uses in query.word_rows(conn, channel):
        index = author_index.get(author_id)
        if index is None:
            continue
        author_totals[index] += uses
        author_distinct[index] += 1
        if word in indexed_words:
            by_word.setdefault(word, []).append([index, uses])

    domains, host_index, host_keys = query.link_tables(conn, channel)
    provenance = query.provenance_row(conn, channel, "activity") or {}
    # The zone the numbers were *built* in, not the one configured now: after a
    # timezone edit the buckets are still last-zone until a rebuild, and
    # labelling them with the new zone is worse than labelling them old (§7.1).
    built_in = provenance.get("timezone") or cfg.timezone
    stale = (not provenance) or is_stale(conn, channel, "activity",
                                         config_hash=config_digest(cfg, conn))
    types = query.type_rows(conn, channel)

    payload: dict[str, Any] = {
        "meta": {
            "total": query.counted_total(conn, channel),
            "source_count": int(provenance.get("source_count", 0)),
            "stale": stale,
            "timezone": built_in,
            "authors": len(author_rows),
            "cells": len(cells),
            "heat_cells": len(heat),
            "active_days": len(day_list),
            "firstLocal": day_list[0] if day_list else None,
            "lastLocal": day_list[-1] if day_list else None,
            "stopwords": len(load_stopwords(cfg)),
            "kept_words": query.distinct_word_count(conn, channel),
            "types": types,
            "computed_at": provenance.get("computed_at"),
            "source_max_message_id": provenance.get("source_max_message_id"),
        },
        "authors": author_rows,
        "days": day_list,
        "cells": cells,
        "heat": heat,
        "edges": query.reply_edges(conn, channel, author_index),
        "response": query.response_times(conn, channel, author_index),
        "editSpeed": query.edit_speeds(conn, channel, author_index),
        "starters": query.starters(conn, channel, author_index),
        "attachments": query.pairs(conn, channel, "rollup_attachment", "mime", "count"),
        "words": [list(row) for row in words],
        "wordAuthors": by_word,
        "authorWordTotals": author_totals,
        "authorDistinct": author_distinct,
        "identities": query.identity_groups(conn, channel),
        "linkDomains": domains,
        "linkCells": query.link_cells(conn, channel, day_index, author_index, host_index),
        "topLinks": [list(row) for row in host_keys[:60]],
        "providers": query.pairs(conn, channel, "rollup_provider", "provider", "embeds"),
        "topMedia": query.top_media(conn, channel, cfg.media_top_n),
        "mediaThumbnails": cfg.media_thumbnails,
        "embedTypes": query.pairs(conn, channel, "rollup_embed_type", "embed_type", "embeds"),
        "linkStats": query.link_stats(conn, channel),
        "emoji": query.pairs(conn, channel, "rollup_emoji", "emoji", "uses"),
        "reactions": query.pairs(conn, channel, "rollup_reaction", "emoji", "count"),
        "types": types,
        "tz": {"name": built_in, "label": built_in},
        "channel_hint": channel,
    }
    # The mockup prints the payload's own size, so it is measured, not guessed.
    encoded = json.dumps(payload).encode("utf-8")
    payload["meta"]["payload_kb"] = round(len(encoded) / 1024)
    payload["meta"]["payload_gzip_kb"] = round(len(gzip.compress(encoded)) / 1024)
    return payload
