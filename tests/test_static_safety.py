"""The SPA fallback serves ``index.html``; it never reads outside its directory.

``/admin`` and ``/login`` are handled by explicit routes and every other path by
the ``StaticFiles`` mount, so a traversal path must either be refused or answered
with the SPA — never with a file that lives outside ``static_dir``.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from discord_stats.api.app import create_app
from tests.conftest import cfg_fixture

INDEX_MARKER = "SPA-INDEX-MARKER"
SENTINEL_TEXT = "root:x:0:0:root:/root:/bin/bash\nSENTINEL-OUTSIDE-STATIC\n"
SENTINEL_MARKER = "SENTINEL-OUTSIDE-STATIC"

# The paths the task names, plus variants aimed at the sentinel that really sits
# one directory above the static root — so the test does not depend on the host's
# /etc/passwd existing, or on what it contains.
TRAVERSAL_PATHS = (
    "/admin/../../etc/passwd",
    "/%2e%2e/%2e%2e/etc/passwd",
    "/..%2f..%2fetc%2fpasswd",
    "//etc/passwd",
    "/../sentinel.txt",
    "/%2e%2e/sentinel.txt",
    "/..%2fsentinel.txt",
    "/admin/../../sentinel.txt",
    "//../../sentinel.txt",
    "/%2fetc%2fpasswd",
)

REFUSED = {200, 400, 403, 404}


@pytest.fixture
def spa(tmp_path):
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text(
        f"<!doctype html><body>{INDEX_MARKER}</body>", encoding="utf-8"
    )
    sentinel = tmp_path / "sentinel.txt"
    sentinel.write_text(SENTINEL_TEXT, encoding="utf-8")
    cfg = cfg_fixture(tmp_path)
    app = create_app(cfg, tmp_path / "app.db", static_dir=static_dir)
    return SimpleNamespace(app=app, static_dir=static_dir, sentinel=sentinel)


def _assert_no_escape(body: bytes, where: str) -> None:
    assert b"root:" not in body, f"{where} returned /etc/passwd-like content"
    assert SENTINEL_MARKER.encode() not in body, f"{where} returned the sentinel file"


def _raw_get(app, path: str) -> tuple[int, bytes]:
    """Ask the app for ``path`` exactly as written.

    ``TestClient`` goes through httpx, which resolves ``..`` segments and reads a
    leading ``//`` as an authority, so those paths never reach the app verbatim
    through it. A hostile client can send them, so the app is called through raw
    ASGI — the same scope a server like uvicorn builds from the request line.
    """
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("latin-1"),
        "root_path": "",
        "query_string": b"",
        "headers": [(b"host", b"testserver")],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    sent: list[dict] = []
    request_sent = False
    finished = asyncio.Event()

    async def receive() -> dict:
        nonlocal request_sent
        if not request_sent:
            request_sent = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await finished.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        sent.append(message)
        if message["type"] == "http.response.body" and not message.get("more_body"):
            finished.set()

    asyncio.run(app(scope, receive, send))

    start = next(m for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], body


def test_the_spa_fallback_still_serves_index_html_for_client_routes(spa):
    """The control: without this, a 404 below could just be a broken mount."""
    response = TestClient(spa.app).get("/admin")
    assert response.status_code == 200
    assert INDEX_MARKER in response.text


def test_traversal_paths_do_not_escape_the_static_dir(spa):
    assert "root:" in spa.sentinel.read_text(encoding="utf-8")   # the needle is real
    client = TestClient(spa.app)
    for path in TRAVERSAL_PATHS:
        response = client.get(path)
        assert response.status_code in REFUSED, f"{path}: {response.status_code}"
        _assert_no_escape(response.content, path)
        if response.status_code == 200:
            # a 200 is allowed only when it is the SPA, not a file from outside
            assert INDEX_MARKER in response.text, path


def test_raw_traversal_paths_do_not_escape_the_static_dir(spa):
    """The same paths, sent byte for byte rather than through httpx."""
    for path in TRAVERSAL_PATHS:
        status, body = _raw_get(spa.app, path)
        assert status in REFUSED, f"{path}: {status}"
        _assert_no_escape(body, path)
        if status == 200:
            assert INDEX_MARKER in body.decode("utf-8"), path
