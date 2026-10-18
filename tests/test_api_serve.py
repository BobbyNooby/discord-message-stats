"""The dashboard's serve command: parser shape, boot, and failure modes.

HTTP moved out of the tool (`discord-scraper serve` is worker-only now, pinned
in `tests/test_cli_rollups.py`), so the API/SPA shape is pinned here.
"""

from __future__ import annotations

import pytest

from discord_stats.cli import main as stats_main


def _database(tmp_path):
    """A file database with the control plane the app reads at boot."""
    from discord_scraper.db import connect_writable
    from discord_scraper.rollups.schema import create_control_tables

    database = tmp_path / "messages.db"
    conn = connect_writable(database)
    create_control_tables(conn)
    conn.close()
    return database


def _config(tmp_path):
    (tmp_path / "config.toml").write_text(
        '[source]\nchannel_id = "c1"\ntimezone = "UTC"\n', encoding="utf-8"
    )
    return tmp_path / "config.toml"


def test_the_dashboard_parser_accepts_host_and_port():
    from discord_stats.cli import _parser

    parsed = _parser().parse_args(
        ["serve", "--db", "x.db", "--host", "0.0.0.0", "--port", "9001"]
    )
    assert (parsed.host, parsed.port) == ("0.0.0.0", 9001)


def test_the_dashboard_serve_has_the_api_and_worker_shapes():
    from discord_stats.cli import _parser

    parser = _parser()
    assert parser.parse_args(["serve"]).api is False
    assert parser.parse_args(["serve", "--api"]).api is True
    assert parser.parse_args(["serve", "--with-worker"]).with_worker is True


def test_serve_refuses_a_missing_database_without_binding_a_port(tmp_path, capsys):
    assert stats_main(["serve", "--api", "--db", str(tmp_path / "absent.db")]) == 2
    assert "no database" in capsys.readouterr().err.lower()


def test_the_api_shape_needs_no_discord_token(tmp_path, monkeypatch):
    """`serve --api` is the shape that runs where the token is not allowed to be."""
    import uvicorn

    database = _database(tmp_path)
    config = _config(tmp_path)
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: None)
    assert stats_main(["serve", "--api", "--db", str(database),
                       "--config", str(config), "--port", "8098"]) == 0


def test_the_api_shape_boots_the_app(tmp_path, monkeypatch):
    """The app the dashboard hands to uvicorn answers /api/health (no port bound)."""
    import uvicorn
    from fastapi.testclient import TestClient

    database = _database(tmp_path)
    config = _config(tmp_path)
    seen: dict = {}
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: seen.update(app=app, **kw))
    assert stats_main(["serve", "--api", "--dev-login", "--db", str(database),
                       "--config", str(config)]) == 0
    response = TestClient(seen["app"]).get("/api/health")
    assert response.status_code == 200


def test_an_unbuilt_spa_is_a_hint_not_a_crash(tmp_path, monkeypatch, capsys):
    import uvicorn

    from discord_scraper import cli as cli_module

    database = _database(tmp_path)
    config = _config(tmp_path)
    seen: dict = {}
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: seen.update(app=app, **kw))
    # No SPA anywhere: the API still starts, with a hint instead of an error.
    monkeypatch.setattr(cli_module, "_find_static", lambda explicit, **kw: None)
    assert stats_main(["serve", "--api", "--db", str(database),
                       "--config", str(config), "--port", "8099"]) == 0
    assert "no built SPA" in capsys.readouterr().err
    assert seen["port"] == 8099


def test_the_checkout_spa_is_served_without_an_explicit_static_dir(tmp_path, monkeypatch):
    """`discord-stats serve` with no --static-dir must find this checkout's SPA.

    The tool's own fallbacks look beside the tool install
    (`vendor/discord-message-scraper`), which never holds the dashboard's build,
    so the dashboard has to name its own `web/dist`.
    """
    import uvicorn

    from discord_scraper import cli as cli_module
    from discord_stats import cli as stats_cli

    database = _database(tmp_path)
    config = _config(tmp_path)
    spa = tmp_path / "web" / "dist"
    spa.mkdir(parents=True)
    (spa / "index.html").write_text("<html></html>", encoding="utf-8")
    monkeypatch.setattr(stats_cli, "_spa_dir", lambda: spa)
    seen: dict = {}
    monkeypatch.setattr(
        cli_module,
        "_find_static",
        lambda explicit, **kw: seen.setdefault("explicit", explicit) or spa,
    )
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: None)
    assert stats_main(["serve", "--api", "--db", str(database),
                       "--config", str(config)]) == 0
    assert seen["explicit"] == spa


def test_an_explicit_static_dir_still_wins(tmp_path, monkeypatch):
    import uvicorn

    from discord_scraper import cli as cli_module

    database = _database(tmp_path)
    config = _config(tmp_path)
    chosen = tmp_path / "elsewhere"
    seen: dict = {}
    monkeypatch.setattr(
        cli_module,
        "_find_static",
        lambda explicit, **kw: seen.setdefault("explicit", explicit) or chosen,
    )
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: None)
    assert stats_main(["serve", "--api", "--db", str(database),
                       "--config", str(config), "--static-dir", str(chosen)]) == 0
    assert str(seen["explicit"]) == str(chosen)


def test_the_spa_lookup_never_raises():
    from discord_stats.cli import _spa_dir

    found = _spa_dir()
    assert found is None or (found / "index.html").is_file()


def test_tls_flags_must_come_as_a_pair(tmp_path, capsys):
    """A certificate without its key would silently serve plain HTTP."""
    from tests.conftest import cfg_fixture

    database = _database(tmp_path)
    cfg_fixture(tmp_path)   # never the checkout's untracked config.toml
    assert stats_main(["serve", "--api", "--db", str(database),
                       "--config", str(tmp_path / "config.toml"),
                       "--tls-cert", str(tmp_path / "c.pem")]) == 2
    assert "together" in capsys.readouterr().err


def test_serve_api_without_the_web_extra_names_the_fix(tmp_path, monkeypatch, capsys):
    """No uvicorn: `serve --api` must say what to install, not traceback.

    The environment is made to look like a web-dependency-free install whatever
    is actually installed here, so the test does not depend on this machine.
    """
    import builtins

    database = _database(tmp_path)
    config = _config(tmp_path)

    real_import = builtins.__import__

    def without_uvicorn(name, *args, **kwargs):
        if name == "uvicorn":
            raise ModuleNotFoundError("No module named 'uvicorn'", name="uvicorn")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", without_uvicorn)

    code = stats_main(["serve", "--api", "--db", str(database),
                       "--config", str(config), "--port", "8097"])
    assert code == 2
    err = capsys.readouterr().err
    assert 'pip install -e ".[web]"' in err
    assert "Traceback" not in err


def test_the_dashboard_imports_without_the_old_tool_api():
    """The dashboard must not reach for the tool's old api/auth modules."""
    import sys

    sys.modules.pop("discord_scraper.api", None)
    import discord_stats.api.app  # noqa: F401

    assert "discord_scraper.api" not in sys.modules
