"""Operator overrides are one authority, with one fixed key set.

These tests pin the contract the API, the worker and the CLI all resolve
configuration through: the same six keys, the same refusals, and an ``apply``
that never mutates the config it was given.
"""

import sqlite3

import pytest

from tests.conftest import cfg_fixture


def _config_table(conn):
    conn.execute("CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT)")
    return conn


def test_the_key_set_is_exactly_six():
    from discord_scraper import overrides

    assert overrides.OVERRIDABLE == (
        "channel_id", "timezone", "ignore_words", "allowlist_policy",
        "cron_enabled", "cron_hours",
    )


def test_read_returns_every_stored_row():
    from discord_scraper import overrides

    conn = _config_table(sqlite3.connect(":memory:"))
    conn.executemany("INSERT INTO config (key, value) VALUES (?, ?)",
                     [("timezone", "Europe/London"), ("stray", "x")])
    assert overrides.read(conn) == {"timezone": "Europe/London", "stray": "x"}


def test_read_survives_a_database_with_no_config_table():
    """A worker may run before the control tables exist; that is no overrides."""
    from discord_scraper import overrides

    assert overrides.read(sqlite3.connect(":memory:")) == {}


def test_a_valid_override_wins_over_the_file(tmp_path):
    from discord_scraper import overrides

    base = cfg_fixture(tmp_path, timezone="UTC")
    effective = overrides.apply(base, {"timezone": "Europe/London"})
    assert effective.timezone == "Europe/London"
    assert base.timezone == "UTC"          # the file's value is untouched


def test_every_key_is_applied(tmp_path):
    from discord_scraper import overrides

    base = cfg_fixture(tmp_path)
    effective = overrides.apply(base, {
        "channel_id": "c2",
        "timezone": "Europe/London",
        "allowlist_policy": "explicit",
        "ignore_words": '["spam", "eggs"]',
        "cron_enabled": "false",
        "cron_hours": "3",
    })
    assert effective.channel_id == "c2"
    assert effective.timezone == "Europe/London"
    assert effective.allowlist == "explicit"
    assert effective.ignore_words == ["spam", "eggs"]
    assert effective.cron_enabled is False
    assert effective.cron_hours == 3


def test_an_unknown_key_is_ignored(tmp_path):
    from discord_scraper import overrides

    base = cfg_fixture(tmp_path)
    assert overrides.apply(base, {"token": "nope"}).timezone == base.timezone


def test_apply_keeps_the_base_secrets(tmp_path):
    """Applying a setting must not strip the token the base carried."""
    from discord_scraper import overrides

    base = cfg_fixture(tmp_path, admin_id="admin-1")
    effective = overrides.apply(base, {"timezone": "Europe/London"})
    assert effective.token == base.token
    assert effective.admin_id == base.admin_id


@pytest.mark.parametrize("key, value", [
    ("timezone", "Mars/Olympus"),
    ("allowlist_policy", "sometimes"),
    ("ignore_words", "spam"),
    ("ignore_words", ["ok", 7]),
    ("channel_id", ["c1"]),
    ("channel_id", "   "),
    ("cron_hours", "soon"),
    ("cron_hours", "0"),
    ("cron_hours", "25"),
])
def test_bad_values_are_rejected(key, value):
    from discord_scraper import overrides

    with pytest.raises(overrides.InvalidOverride):
        overrides.validate(key, value)


@pytest.mark.parametrize("key, value", [
    ("timezone", "Europe/London"),
    ("timezone", "auto"),
    ("allowlist_policy", "posted"),
    ("allowlist_policy", "explicit"),
    ("ignore_words", []),
    ("ignore_words", ["spam"]),
    ("channel_id", "c1"),
    ("cron_hours", 1),
    ("cron_hours", "24"),
    ("cron_enabled", "false"),
])
def test_valid_values_pass(key, value):
    from discord_scraper import overrides

    overrides.validate(key, value)   # must not raise


def test_validate_names_the_offending_setting():
    from discord_scraper import overrides

    with pytest.raises(overrides.InvalidOverride) as excinfo:
        overrides.validate("timezone", "Mars/Olympus")
    assert "unknown timezone: Mars/Olympus" in str(excinfo.value)


def test_the_api_re_exports_the_single_authority():
    """The admin surface must not keep a second copy that can drift."""
    from discord_scraper import overrides
    from discord_stats.api import admin

    assert admin.OVERRIDABLE is overrides.OVERRIDABLE
    assert admin.effective_config is overrides.apply
    assert admin.effective_for is overrides.effective_for
    assert admin._overrides is overrides.read
    assert admin.InvalidOverride is overrides.InvalidOverride
