"""A merged-away account must never reach the payload as a separate person.

The identity table records merges, but the rollup tables only know about them
after a rebuild. Until then ``rollup_activity`` still carries the alt id, and the
dashboard showed both accounts — the "9/9 authors" the owner saw. These tests
build the stale state deliberately (build first, merge after) and pin the
read-time fix: canonical-only authors, index alignment kept, and a staleness
signal so the operator is warned to rebuild.
"""

from __future__ import annotations

from discord_stats.api import viewer
from discord_scraper.cli import main
from discord_scraper.rollups import identity, query
from discord_scraper.rollups.build import config_digest, rebuild_all
from discord_scraper.rollups.schema import is_stale
from tests.conftest import author_raw, cfg_fixture, seed_messages

# u9 is the alt: it must disappear from the author list once merged into u1.
ALT_ROWS = (
    ("m8", "u9", "alt_handle", "zebra", "2026-01-01T12:00:00+00:00", None, None, 0, 0,
     author_raw("u9", "alt_handle", "AltName")),
    ("m9", "u9", "alt_handle", "quokka", "2026-01-02T12:00:00+00:00", None, None, 0, 0,
     author_raw("u9", "alt_handle", "AltName")),
)


def _built_without_the_merge(tmp_path, conn):
    """A real stale state: rollups built before the merge is recorded."""
    cfg = cfg_fixture(tmp_path)
    seed_messages(conn, ALT_ROWS)
    rebuild_all(conn, cfg)
    return cfg


def _record_merge(conn, canonical="u1", account="u9"):
    conn.execute(
        "INSERT INTO identity (channel_id, canonical_id, account_id, note) "
        "VALUES ('c1', ?, ?, '')",
        (canonical, account),
    )
    conn.commit()


def _index_of(payload, author_id):
    return next(index for index, row in enumerate(payload["authors"]) if row["id"] == author_id)


def test_a_merge_makes_the_payload_author_list_canonical_only(tmp_path, conn):
    cfg = _built_without_the_merge(tmp_path, conn)
    # The stale table really does carry the alt as its own row.
    assert query.authors(conn, "c1")  # sanity: authors read from rollups
    assert conn.execute(
        "SELECT COUNT(DISTINCT author_id) FROM rollup_activity "
        " WHERE channel_id = 'c1' AND author_id = 'u9'"
    ).fetchone()[0] == 1

    _record_merge(conn)
    payload = viewer.bootstrap(conn, cfg)

    ids = [row["id"] for row in payload["authors"]]
    assert "u9" not in ids
    assert ids.count("u1") == 1
    u1 = next(row for row in payload["authors"] if row["id"] == "u1")
    assert u1["msgs"] == 5          # u1's own 3 plus u9's 2, combined
    assert "u9" in u1["accounts"]   # the merged account is recorded, not hidden


def test_author_count_equals_the_number_of_canonical_identities(tmp_path, conn):
    cfg = _built_without_the_merge(tmp_path, conn)
    _record_merge(conn)
    payload = viewer.bootstrap(conn, cfg)

    ids = [row["id"] for row in payload["authors"]]
    assert payload["meta"]["authors"] == len(payload["authors"])
    # Two people: u1 (with u9 folded in) and u2. Counting the rollup's raw ids
    # would say three.
    assert sorted(ids) == ["u1", "u2"]
    assert payload["meta"]["authors"] == len(set(ids))
    assert payload["meta"]["authors"] <= len(
        set(identity.canonical_map(conn, "c1", cfg).values()) | {"u2"}
    )


def test_every_author_index_stays_in_step_after_a_merge(tmp_path, conn):
    """``authors`` and every parallel array keep one index per canonical person.

    Dropping the alt row without re-indexing would silently shift every chart;
    combining its series into the canonical's index is the only honest move.
    """
    cfg = _built_without_the_merge(tmp_path, conn)
    _record_merge(conn)
    payload = viewer.bootstrap(conn, cfg)
    count = len(payload["authors"])
    index = _index_of(payload, "u1")

    assert len(payload["authorWordTotals"]) == count
    assert len(payload["authorDistinct"]) == count
    for _day, author, *_rest in payload["cells"]:
        assert 0 <= author < count
    for _dow, _hour, author, _year, _msgs in payload["heat"]:
        assert 0 <= author < count
    for parent, child, _msgs in payload["edges"]:
        assert 0 <= parent < count and 0 <= child < count
    for author, _avg, _replies in payload["response"]:
        assert 0 <= author < count
    for author, _avg, _edits in payload["editSpeed"]:
        assert 0 <= author < count
    for author, _n in payload["starters"]:
        assert 0 <= author < count
    for _day, author, _host, _uses in payload["linkCells"]:
        assert 0 <= author < count
    for entries in payload["wordAuthors"].values():
        for author, _uses in entries:
            assert 0 <= author < count

    # A chart's value for the known author survived: u1's own day plus u9's.
    assert sum(row[2] for row in payload["cells"] if row[1] == index) == 5
    assert payload["authorWordTotals"][index] == conn.execute(
        "SELECT SUM(uses) FROM rollup_word WHERE channel_id = 'c1' "
        " AND author_id IN ('u1', 'u9')"
    ).fetchone()[0]
    assert payload["authorDistinct"][index] == conn.execute(
        "SELECT COUNT(DISTINCT word) FROM rollup_word WHERE channel_id = 'c1' "
        " AND author_id IN ('u1', 'u9')"
    ).fetchone()[0]
    assert sum(row[4] for row in payload["heat"] if row[2] == index) == conn.execute(
        "SELECT SUM(msgs) FROM rollup_heat WHERE channel_id = 'c1' "
        " AND author_id IN ('u1', 'u9')"
    ).fetchone()[0]


def test_a_merge_alone_marks_the_rollups_stale(tmp_path, conn, seeded_db_path, capsys):
    """The operator has to be told, not left to infer it from a stale count."""
    cfg = _built_without_the_merge(tmp_path, conn)
    digest = config_digest(cfg, conn)
    assert not is_stale(conn, "c1", "activity", config_hash=digest)
    assert viewer.bootstrap(conn, cfg)["meta"]["stale"] is False

    _record_merge(conn)
    moved = config_digest(cfg, conn)
    assert moved != digest
    assert is_stale(conn, "c1", "activity", config_hash=moved)
    assert viewer.bootstrap(conn, cfg)["meta"]["stale"] is True

    # `rollups status` sees it too, without a rebuild in between.
    assert main(["rollups", "status", "--db", str(seeded_db_path),
                 "--config", str(tmp_path / "config.toml")]) == 0
    assert "stale" in capsys.readouterr().out
