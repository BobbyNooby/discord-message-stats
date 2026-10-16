"""The thumbnail proxy: an allowlist, no redirects, and only images.

The endpoint takes a URL from the query string, so anything permissive here is a
server-side request forgery primitive pointed at whatever the host can reach.
The hosts are exactly what the reference data contains.
"""

import httpx
from fastapi.testclient import TestClient

from discord_scraper.api.app import create_app


class FakeStream:
    """Stands in for httpx's streaming response (a context manager)."""

    def __init__(self, status=200, headers=None, chunks=()):
        self.status_code = status
        self.headers = headers if headers is not None else {"content-type": "image/gif"}
        self._chunks = chunks

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def iter_bytes(self):
        return iter(self._chunks)


def use(monkeypatch, **kwargs):
    seen = {"calls": 0, "last": None}

    def fake_stream(method, url, **opts):
        seen["calls"] += 1
        seen["last"] = opts
        return FakeStream(**kwargs)

    monkeypatch.setattr(httpx, "stream", fake_stream)
    return seen


def test_an_allowlisted_host_is_fetched_and_cached(client, monkeypatch):
    seen = use(monkeypatch, chunks=[b"GIF89a-", b"not-really"])
    first = client.get("/api/thumb", params={"u": "https://media.tenor.com/x/y.gif"})
    second = client.get("/api/thumb", params={"u": "https://media.tenor.com/x/y.gif"})

    assert first.status_code == second.status_code == 200
    assert first.headers["content-type"].startswith("image/")
    assert seen["calls"] == 1, "the second request should come from the cache"
    assert seen["last"].get("follow_redirects") is False


def test_a_host_off_the_list_is_refused(client, monkeypatch):
    seen = use(monkeypatch)

    def explode(*a, **k):        # must never be reached
        raise AssertionError("fetched a URL that is not allowlisted")

    monkeypatch.setattr(httpx, "stream", explode)
    response = client.get("/api/thumb", params={"u": "http://127.0.0.1:8443/api/admin/status"})
    assert response.status_code == 400
    assert "allowlist" in response.json()["detail"]
    assert seen["calls"] == 0


def test_a_lookalike_host_is_refused(client, monkeypatch):
    """`tenor.com.evil.test` ends with neither `tenor.com` nor `.tenor.com`."""
    use(monkeypatch)
    assert client.get("/api/thumb", params={"u": "https://tenor.com.evil.test/x.gif"}).status_code == 400


def test_a_non_image_response_is_refused(client, monkeypatch):
    use(monkeypatch, headers={"content-type": "text/html"}, chunks=[b"<html>"])
    assert client.get("/api/thumb", params={"u": "https://i.ytimg.com/vi/x/hq.jpg"}).status_code == 502


def test_an_oversized_image_is_refused_not_truncated(client, monkeypatch):
    """Half a GIF renders as a broken image, which is worse than none."""
    use(monkeypatch, headers={"content-type": "image/gif", "content-length": str(26 * 1024 * 1024)})
    response = client.get("/api/thumb", params={"u": "https://media.tenor.com/big.gif"})
    assert response.status_code == 502
    assert "larger than" in response.json()["detail"]


def test_a_stream_that_exceeds_the_cap_midway_is_abandoned(client, monkeypatch):
    """The declared length is a hint; the stream is what actually costs memory."""
    use(monkeypatch, headers={"content-type": "image/gif"},
        chunks=[b"x" * (13 * 1024 * 1024), b"x" * (13 * 1024 * 1024)])
    response = client.get("/api/thumb", params={"u": "https://media.tenor.com/sneaky.gif"})
    assert response.status_code == 502


def test_thumbnails_need_a_session(db_cfg):
    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path))
    assert client.get("/api/thumb", params={"u": "https://i.ytimg.com/vi/x/hq.jpg"}).status_code == 401
