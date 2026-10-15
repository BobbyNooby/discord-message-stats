"""The API serves the built SPA: one process, one port, no CORS (spec §4.7)."""

from fastapi.testclient import TestClient

from discord_scraper.api.app import create_app
from tests.conftest import cfg_fixture


def _spa(tmp_path):
    directory = tmp_path / "dist"
    directory.mkdir()
    (directory / "index.html").write_text("<html><body>the app</body></html>", encoding="utf-8")
    (directory / "assets").mkdir()
    (directory / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    return directory


def test_the_spa_answers_root_and_deep_links(seeded_db_path, tmp_path):
    client = TestClient(create_app(cfg_fixture(tmp_path), seeded_db_path, static_dir=_spa(tmp_path)))
    assert "the app" in client.get("/").text
    assert "the app" in client.get("/admin").text      # SPA fallback, not a 404
    assert "the app" in client.get("/login").text


def test_assets_are_served(seeded_db_path, tmp_path):
    client = TestClient(create_app(cfg_fixture(tmp_path), seeded_db_path, static_dir=_spa(tmp_path)))
    assert client.get("/assets/app.js").status_code == 200


def test_the_api_still_wins_over_the_mount(seeded_db_path, tmp_path):
    client = TestClient(create_app(cfg_fixture(tmp_path), seeded_db_path, static_dir=_spa(tmp_path)))
    assert client.get("/api/health").json()["ok"] is True
    assert client.get("/api/bootstrap").status_code == 401     # routing, not a fallback page


def test_without_a_build_the_api_stands_alone(seeded_db_path, tmp_path):
    client = TestClient(create_app(cfg_fixture(tmp_path), seeded_db_path))
    assert client.get("/api/health").status_code == 200
    assert client.get("/").status_code == 404
