"""The development shim: no login screen at all, and nothing persisted.

Off unless the flag is passed — the whole point is that a deployed server cannot
end up in this state by accident.
"""

from fastapi.testclient import TestClient

from discord_scraper.api.app import create_app


def test_without_the_flag_an_anonymous_visitor_is_still_refused(db_cfg):
    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path))
    assert client.get("/api/bootstrap").status_code == 401


def test_the_shim_admits_a_viewer_with_no_cookie(db_cfg):
    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path, dev_auto_login="viewer"))
    assert client.get("/api/bootstrap").status_code == 200
    # a viewer is not an admin: the shim grants a level, it does not remove the rules
    assert client.get("/api/admin/status").status_code == 403


def test_the_shim_can_be_admin(db_cfg):
    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path, dev_auto_login="admin"))
    assert client.get("/api/admin/status").status_code == 200


def test_the_shim_persists_no_credentials(db_cfg, conn):
    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path, dev_auto_login="admin"))
    client.get("/api/bootstrap")
    client.get("/api/admin/status")
    # no session rows, no token: the shim is not a login, so there is nothing to
    # revoke and nothing to leak
    assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
    assert client.cookies.get("dsh_session") is None
