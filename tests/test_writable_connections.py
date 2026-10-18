"""Writable handles must be WAL and must wait for a lock, not fail at once.

In rollback-journal mode a committing writer blocks every reader outright, and
a busy timeout of 0 turns ordinary control-plane contention into "database is
locked". Both are per-connection settings, so both writers — the API's control
plane and the CLI's rebuild — need them, on a database that has not already
been switched to WAL by someone else.
"""

import shutil


def _pragmas(conn):
    mode = str(conn.execute("PRAGMA journal_mode").fetchone()[0]).lower()
    timeout = int(conn.execute("PRAGMA busy_timeout").fetchone()[0])
    return mode, timeout


def test_each_writable_connection_sets_its_own_pragmas(seeded_db_path, tmp_path):
    from discord_scraper.api.deps import connect_writable
    from discord_scraper.cli import _connect

    deps_db = tmp_path / "deps.db"
    cli_db = tmp_path / "cli.db"
    shutil.copy(seeded_db_path, deps_db)
    shutil.copy(seeded_db_path, cli_db)

    for conn in (connect_writable(deps_db), _connect(str(cli_db))):
        try:
            mode, timeout = _pragmas(conn)
            assert mode == "wal"
            assert timeout >= 10_000
        finally:
            conn.close()
