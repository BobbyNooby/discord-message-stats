"""The read side of the rollups: what the dashboard asks the tables.

The scraper's own suite covers what a rebuild writes; these cover the readers,
which live here because only the dashboard reads the tables this way.
"""

from discord_scraper.rollups.build import rebuild_media, rebuild_word
from discord_scraper.rollups.identity import resolve_identities
from discord_scraper.testing import author_raw, cfg_fixture, seed_messages
from discord_stats.api import query


def _gif(url):
    return [{"type": "gifv", "url": url, "provider": {"name": "Tenor"}}]


def test_media_posts_say_who_posted_it_when_and_which_post_was_first(conn, cfg):
    cat = "https://tenor.com/view/cat"
    seed_messages(conn, [
        ("zz3", "u2", "plain_user", "", "2026-02-03T10:00:00+00:00", None, None, 0, 0,
         author_raw("u2", "plain_user", embeds=_gif(cat))),
        ("zz1", "u1", "u1handle", "", "2026-02-01T10:00:00+00:00", None, None, 0, 0,
         author_raw("u1", "u1handle", embeds=_gif(cat))),
        ("zz2", "u1", "u1handle", "", "2026-02-02T10:00:00+00:00", None, None, 0, 0,
         author_raw("u1", "u1handle", embeds=_gif(cat))),
        ("zz4", "u1", "u1handle", "", "2026-03-01T10:00:00+00:00", None, None, 0, 0,
         author_raw("u1", "u1handle", embeds=_gif(cat))),
    ])
    rebuild_media(conn, cfg, resolve_identities(conn, cfg))
    posts = query.media_posts(conn, "c1", cat)
    assert [(month, author, uses) for month, author, uses, _f, _m in posts] == [
        ("2026-02", "u1", 2), ("2026-02", "u2", 1), ("2026-03", "u1", 1),
    ]
    first = min(posts, key=lambda row: row[3])
    assert (first[1], first[4]) == ("u1", "zz1")
    assert query.media_item(conn, "c1", cat)[6] == 4


def test_media_posts_are_none_before_a_rebuild_writes_them(conn):
    assert query.media_posts(conn, "c1", "https://tenor.com/view/cat") is None


def test_the_word_timeline_and_the_all_time_table_agree(conn, tmp_path):
    # 23:30 UTC on 31 January is already February in Kuala Lumpur.
    cfg = cfg_fixture(tmp_path, timezone="Asia/Kuala_Lumpur")
    seed_messages(conn, [
        ("w1", "u1", "u1handle", "zebra zebra", "2026-01-31T23:30:00+00:00", None, None, 0, 0,
         author_raw("u1", "u1handle")),
        ("w2", "u2", "plain_user", "zebra", "2026-03-05T10:00:00+00:00", None, None, 0, 0,
         author_raw("u2", "plain_user")),
    ])
    rebuild_word(conn, cfg, resolve_identities(conn, cfg))
    assert query.word_timeline(conn, "c1", "zebra") == [
        ("2026-02", "u1", 2), ("2026-03", "u2", 1),
    ]
    assert dict(query.words_for(conn, "c1", "zebra")) == {"u1": 2, "u2": 1}
    assert query.word_timeline(conn, "c1", "unicorn") == []


def test_word_uses_between_months_honour_the_range_and_the_years(conn, cfg):
    seed_messages(conn, [
        ("p1", "u1", "u1handle", "zebra", "2021-03-05T10:00:00+00:00", None, None, 0, 0,
         author_raw("u1", "u1handle")),
        ("p2", "u1", "u1handle", "zebra zebra", "2022-06-05T10:00:00+00:00", None, None, 0, 0,
         author_raw("u1", "u1handle")),
        ("p3", "u2", "plain_user", "zebra okapi", "2023-01-05T10:00:00+00:00", None, None, 0, 0,
         author_raw("u2", "plain_user")),
    ])
    rebuild_word(conn, cfg, resolve_identities(conn, cfg))
    index = {"u1": 0, "u2": 1}
    every = query.word_author_uses_between(conn, "c1", index)
    assert every[("zebra", 0)] == 3 and every[("zebra", 1)] == 1
    ranged = query.word_author_uses_between(conn, "c1", index, "2022-01", "2023-12")
    assert ranged[("zebra", 0)] == 2 and ranged[("okapi", 1)] == 1
    # Two years that are not next to each other: 2022 is left out.
    picked = query.word_author_uses_between(conn, "c1", index, years=(2021, 2023))
    assert picked[("zebra", 0)] == 1 and picked[("zebra", 1)] == 1
    # The shared fixture has messages up to 2026; nothing is said after that.
    assert query.word_author_uses_between(conn, "c1", index, "2027-01", None) == {}


def test_word_uses_between_months_is_none_before_a_rebuild(conn):
    assert query.word_author_uses_between(conn, "c1", {"u1": 0}, "2022-01", "2022-12") is None


def test_the_period_query_is_served_from_the_month_index_even_for_years_alone(conn, monkeypatch):
    """Years with no range used to scan the table by channel: 8 s cold."""
    conn.execute("INSERT INTO rollup_word_month VALUES ('c1', 'zebra', 'u1', '2022-03', 1)")
    plans: list[str] = []
    real_rows = query.rows

    def explain(conn_, sql, params=()):
        if "rollup_word_month" in sql and "GROUP BY word, author_id" in sql:
            plans.append(str([tuple(r) for r in conn_.execute("EXPLAIN QUERY PLAN " + sql, params)]))
        return real_rows(conn_, sql, params)

    monkeypatch.setattr(query, "rows", explain)
    query.word_author_uses_between(conn, "c1", {"u1": 0}, years=(2021, 2023))
    assert plans and "idx_rollup_word_month_period" in plans[0]
    assert "month>" in plans[0] and "month<" in plans[0]


def test_word_suggestions_rank_indexed_words_by_use(conn, cfg):
    seed_messages(conn, [
        ("s1", "u1", "u1handle", "zebra zebra zest", "2026-01-05T10:00:00+00:00", None, None,
         0, 0, author_raw("u1", "u1handle")),
        ("s2", "u2", "plain_user", "zebra zeal", "2026-01-06T10:00:00+00:00", None, None,
         0, 0, author_raw("u2", "plain_user")),
    ])
    rebuild_word(conn, cfg, resolve_identities(conn, cfg))
    assert query.word_suggestions(conn, "c1", "ZE") == [("zebra", 3), ("zeal", 1), ("zest", 1)]
    assert query.word_suggestions(conn, "c1", "   ") == []
