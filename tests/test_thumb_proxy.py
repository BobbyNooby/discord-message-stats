"""The thumbnail proxy: an allowlist, no redirects, and only images.

The endpoint takes a URL from the query string, so anything permissive here is a
server-side request forgery primitive pointed at whatever the host can reach.
The hosts are exactly what the reference data contains.
"""

from fastapi.testclient import TestClient

from discord_scraper.api.app import create_app


def test_an_allowlisted_host_is_fetched_and_cached(client, monkeypatch):
    calls = {"n": 0}

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "image/gif"}
        content = b"GIF89a-not-really"

    def fake_get(url, **kwargs):
        calls["n"] += 1
        assert kwargs.get("follow_redirects") is False
        return FakeResponse()

    import httpx

    monkeypatch.setattr(httpx, "get", fake_get)
    first = client.get("/api/thumb", params={"u": "https://media.tenor.com/x/y.gif"})
    second = client.get("/api/thumb", params={"u": "https://media.tenor.com/x/y.gif"})

    assert first.status_code == second.status_code == 200
    assert first.headers["content-type"].startswith("image/")
    assert calls["n"] == 1, "the second request should come from the cache"


def test_a_host_off_the_list_is_refused(client, monkeypatch):
    import httpx

    def explode(*a, **k):        # must never be reached
        raise AssertionError("fetched a URL that is not allowlisted")

    monkeypatch.setattr(httpx, "get", explode)
    response = client.get("/api/thumb", params={"u": "http://127.0.0.1:8443/api/admin/status"})
    assert response.status_code == 400
    assert "allowlist" in response.json()["detail"]


def test_a_lookalike_host_is_refused(client, monkeypatch):
    """`tenor.com.evil.test` ends with neither `tenor.com` nor `.tenor.com`."""
    import httpx

    monkeypatch.setattr(httpx, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("fetched")))
    assert client.get("/api/thumb", params={"u": "https://tenor.com.evil.test/x.gif"}).status_code == 400


def test_a_non_image_response_is_refused(client, monkeypatch):

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "text/html"}
        content = b"<html>"

    import httpx

    monkeypatch.setattr(httpx, "get", lambda *a, **k: FakeResponse())
    assert client.get("/api/thumb", params={"u": "https://i.ytimg.com/vi/x/hq.jpg"}).status_code == 502


def test_thumbnails_need_a_session(db_cfg):
    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path))
    assert client.get("/api/thumb", params={"u": "https://i.ytimg.com/vi/x/hq.jpg"}).status_code == 401
