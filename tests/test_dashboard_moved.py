# moved from tests/test_db_connect_writable.py

def test_api_deps_reexports_the_tool_function():
    from discord_scraper import db
    from discord_stats.api import deps

    # Not an equal copy: the *same* object, so there is one implementation.
    assert deps.connect_writable is db.connect_writable


# moved from tests/test_rollup_schema.py

def test_the_api_boot_adds_the_channel_index(seeded_db_path, tmp_path):
    """Without it, every channel-scoped query scans the whole table."""
    import sqlite3

    from discord_stats.api.app import create_app
    from tests.conftest import cfg_fixture

    before = {row[1] for row in sqlite3.connect(seeded_db_path).execute("PRAGMA index_list(messages)")}
    assert "idx_channel" not in before

    create_app(cfg_fixture(tmp_path), seeded_db_path)

    after = {row[1] for row in sqlite3.connect(seeded_db_path).execute("PRAGMA index_list(messages)")}
    assert "idx_channel" in after
