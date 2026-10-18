"""A dev-only sign-in, off unless explicitly enabled.

Discord OAuth needs a registered redirect URI and a client secret; when those
are not configured there is no way to reach the dashboard at all. This exists so
a developer can look at the real UI on a phone — and it is a flag, not a
default, so a deployed server cannot sign anybody in by accident.

`--dev-login` is the **only** way in while OAuth is unconfigured: the
`--dev-auto-login` shim that made every visitor an admin without a cookie was
removed, because it left no login screen at all.
"""

import inspect

import pytest
from fastapi.testclient import TestClient

from discord_stats.api.app import create_app
from discord_scraper.cli import build_parser
from tests.conftest import cfg_fixture


def test_the_auto_login_shim_is_gone_from_the_parser():
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["serve", "--dev-auto-login", "admin"])


def test_create_app_has_no_auto_login_switch():
    assert "dev_auto_login" not in inspect.signature(create_app).parameters


def test_an_anonymous_visitor_is_refused(seeded_db_path, tmp_path):
    client = TestClient(create_app(cfg_fixture(tmp_path), seeded_db_path))
    assert client.get("/api/bootstrap").status_code == 401
    assert client.get("/api/admin/status").status_code == 401


def test_dev_login_is_absent_without_the_flag(seeded_db_path, tmp_path):
    client = TestClient(create_app(cfg_fixture(tmp_path), seeded_db_path))
    assert client.get("/auth/dev-login").status_code == 404


def test_dev_login_offers_an_admin_session(db_cfg):
    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path, dev_login=True), base_url="https://stats.example")
    response = client.get("/auth/dev-login?level=admin", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert client.cookies.get("dsh_session")
    assert client.get("/api/admin/status").status_code == 200


def test_dev_login_defaults_to_a_viewer(db_cfg):
    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path, dev_login=True), base_url="https://stats.example")
    client.get("/auth/dev-login", follow_redirects=False)
    assert client.get("/api/bootstrap").status_code == 200
    assert client.get("/api/admin/status").status_code == 403


def test_dev_login_rejects_an_unknown_level(db_cfg):
    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path, dev_login=True), base_url="https://stats.example")
    assert client.get("/auth/dev-login?level=superuser").status_code == 400
