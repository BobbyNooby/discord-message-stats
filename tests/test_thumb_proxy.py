"""The thumbnail proxy: an allowlist, no redirects, and only images.

The endpoint takes a URL from the query string, so anything permissive here is a
server-side request forgery primitive pointed at whatever the host can reach.
The hosts are exactly what the reference data contains.
"""

import httpx
from fastapi.testclient import TestClient

from discord_stats.api.app import create_app


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


# --- the cache is bounded by bytes, not only by entries ----------------------

def _urls(*names):
    return [f"https://media.tenor.com/{name}.gif" for name in names]


def test_the_cache_ceiling_counts_bytes_not_just_entries(client, monkeypatch):
    """400 entries at the 25 MB fetch cap would be 10 GB of resident memory."""
    import discord_stats.api.app as app_module

    monkeypatch.setattr(app_module, "THUMB_CACHE_BYTES", 2500, raising=False)
    seen = use(monkeypatch, chunks=[b"x" * 1000])

    first, second, third = _urls("a", "b", "c")
    for url in (first, second, third):
        assert client.get("/api/thumb", params={"u": url}).status_code == 200
    assert seen["calls"] == 3

    # Three 1000-byte entries cannot fit in 2500 bytes, so the first is gone.
    assert client.get("/api/thumb", params={"u": first}).status_code == 200
    assert seen["calls"] == 4, "an entry was kept past the byte ceiling"


def test_a_recently_read_entry_is_evicted_last(client, monkeypatch):
    import discord_stats.api.app as app_module

    monkeypatch.setattr(app_module, "THUMB_CACHE_BYTES", 2500, raising=False)
    seen = use(monkeypatch, chunks=[b"x" * 1000])

    first, second, third = _urls("a", "b", "c")
    client.get("/api/thumb", params={"u": first})
    client.get("/api/thumb", params={"u": second})
    assert seen["calls"] == 2

    # Reading the oldest entry makes it the most recently used...
    client.get("/api/thumb", params={"u": first})
    assert seen["calls"] == 2

    # ...so the next insert evicts `second`, not `first`.
    client.get("/api/thumb", params={"u": third})
    client.get("/api/thumb", params={"u": second})
    assert seen["calls"] == 4, "the least recently used entry was not the one evicted"


def test_a_refused_oversized_image_never_takes_a_positive_cache_slot(client, monkeypatch):
    """The 25 MB fetch cap is what keeps one entry smaller than the cache."""
    seen = use(monkeypatch, headers={"content-type": "image/gif",
                                     "content-length": str(26 * 1024 * 1024)})
    url = "https://media.tenor.com/huge.gif"
    assert client.get("/api/thumb", params={"u": url}).status_code == 502
    cache, total, _ = _thumb_cache(client.app)
    assert cache.cell_contents == {}, "a refused image took a slot in the byte cache"
    assert total.cell_contents == 0, "a refused image counted bytes it does not hold"

    # The refusal is what is remembered instead, so the repeat is not a fetch.
    assert client.get("/api/thumb", params={"u": url}).status_code == 502
    assert seen["calls"] == 1, "a refused image was fetched twice"


def _thumb_cache(app):
    """The endpoint's live closure: both caches and the byte counter.

    Read-only introspection, so the assertion is about the real structures the
    endpoint uses and not about a stub that happens to agree with itself.
    """
    for route in app.routes:
        endpoint = getattr(route, "endpoint", None)
        if getattr(endpoint, "__name__", "") == "thumb":
            cells = dict(zip(endpoint.__code__.co_freevars, endpoint.__closure__))
            return cells["thumb_cache"], cells["thumb_cache_bytes"], cells["thumb_failures"]
    raise AssertionError("no /api/thumb route")


def _thumb_failures(app) -> dict:
    """The negative cache the endpoint actually holds."""
    return _thumb_cache(app)[2].cell_contents


def _clock(monkeypatch):
    """A clock the test moves by hand, so a TTL can be spent without waiting.

    Only `app.py`'s view of `time` is replaced, the way the semaphore tests
    replace its view of `threading`.
    """
    import discord_stats.api.app as app_module

    class Clock:
        def __init__(self):
            self.now = 1000.0

        def monotonic(self):
            return self.now

    clock = Clock()
    monkeypatch.setattr(app_module, "time", clock)
    return clock


# --- a failure is remembered for a while, so it is not fetched again ---------

def test_a_url_that_fails_is_attempted_only_once(client, monkeypatch):
    """An expired CDN link is otherwise refetched on every dashboard load."""
    seen = use(monkeypatch, headers={"content-type": "text/html"}, chunks=[b"<html>"])
    url = "https://i.ytimg.com/vi/gone/hq.jpg"

    first = client.get("/api/thumb", params={"u": url})
    second = client.get("/api/thumb", params={"u": url})

    assert first.status_code == second.status_code == 502
    assert first.json()["detail"] == second.json()["detail"] == "that URL did not return an image"
    assert seen["calls"] == 1, "the second request went back to the network"


def test_a_transport_error_is_remembered_too(client, monkeypatch):
    calls = {"n": 0}

    def broken_stream(method, url, **opts):
        calls["n"] += 1
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "stream", broken_stream)

    url = "https://media.tenor.com/flaky.gif"
    for _ in range(2):
        response = client.get("/api/thumb", params={"u": url})
        assert response.status_code == 502
        assert "thumbnail fetch failed" in response.json()["detail"]
    assert calls["n"] == 1, "a transport error was retried immediately"


def test_a_later_success_wins_over_a_remembered_failure(client, monkeypatch):
    """The refusal is short-lived: once its window lapses, a success takes over."""
    import discord_stats.api.app as app_module

    clock = _clock(monkeypatch)
    url = "https://media.tenor.com/revived.gif"
    failed = use(monkeypatch, headers={"content-type": "text/html"}, chunks=[b"<html>"])
    assert client.get("/api/thumb", params={"u": url}).status_code == 502
    assert url in _thumb_failures(client.app)
    assert failed["calls"] == 1

    # The same URL starts answering with an image, so the refusal must not win.
    clock.now += app_module.THUMB_FAIL_TTL + 1
    succeeded = use(monkeypatch, chunks=[b"GIF89a-revived"])
    served = client.get("/api/thumb", params={"u": url})

    assert served.status_code == 200
    assert served.content == b"GIF89a-revived"
    assert succeeded["calls"] == 1
    assert url not in _thumb_failures(client.app), "the stale refusal outlived the success"

    # ...and it is served from the positive cache from then on.
    assert client.get("/api/thumb", params={"u": url}).status_code == 200
    assert succeeded["calls"] == 1


def test_a_remembered_failure_expires_after_its_ttl(client, monkeypatch):
    import discord_stats.api.app as app_module

    assert app_module.THUMB_FAIL_TTL == 600, "the refusal TTL is not the documented one"
    clock = _clock(monkeypatch)
    seen = use(monkeypatch, headers={"content-type": "text/html"}, chunks=[b"<html>"])
    url = "https://media.tenor.com/expired.gif"

    assert client.get("/api/thumb", params={"u": url}).status_code == 502
    assert client.get("/api/thumb", params={"u": url}).status_code == 502
    assert seen["calls"] == 1, "a live refusal was not answered from the negative cache"

    clock.now += app_module.THUMB_FAIL_TTL + 1
    assert client.get("/api/thumb", params={"u": url}).status_code == 502
    assert seen["calls"] == 2, "the lapsed refusal was never retried"


def test_the_negative_cache_is_bounded_to_its_newest_entries(client, monkeypatch):
    import discord_stats.api.app as app_module

    monkeypatch.setattr(app_module, "THUMB_FAILURES", 3, raising=False)
    seen = use(monkeypatch, headers={"content-type": "text/html"}, chunks=[b"<html>"])
    urls = _urls(*[f"dead-{n}" for n in range(5)])

    for url in urls:
        assert client.get("/api/thumb", params={"u": url}).status_code == 502
    assert seen["calls"] == 5

    held = _thumb_failures(client.app)
    assert len(held) == 3, "the negative cache grew past its cap"
    assert list(held) == urls[-3:], "the newest refusals were not the ones kept"

    # The kept ones are answered without a fetch; the evicted two are not.
    for url in urls[-3:]:
        assert client.get("/api/thumb", params={"u": url}).status_code == 502
    assert seen["calls"] == 5, "a kept refusal was fetched again"
    for url in urls[:2]:
        assert client.get("/api/thumb", params={"u": url}).status_code == 502
    assert seen["calls"] == 7, "the evicted refusals were never retried"


def test_reading_a_remembered_failure_makes_it_the_last_evicted(client, monkeypatch):
    import discord_stats.api.app as app_module

    monkeypatch.setattr(app_module, "THUMB_FAILURES", 2, raising=False)
    seen = use(monkeypatch, headers={"content-type": "text/html"}, chunks=[b"<html>"])
    first, second, third = _urls("a", "b", "c")

    client.get("/api/thumb", params={"u": first})
    client.get("/api/thumb", params={"u": second})
    client.get("/api/thumb", params={"u": first})      # a hit: `first` is now newest
    assert seen["calls"] == 2

    client.get("/api/thumb", params={"u": third})      # evicts `second`, not `first`
    client.get("/api/thumb", params={"u": second})
    assert seen["calls"] == 4, "the least recently read refusal was not the one evicted"


def test_an_off_allowlist_host_is_refused_without_being_remembered(client, monkeypatch):
    def explode(*a, **k):        # must never be reached
        raise AssertionError("fetched a URL that is not allowlisted")

    monkeypatch.setattr(httpx, "stream", explode)
    url = "http://127.0.0.1:8443/api/admin/status"
    for _ in range(2):
        response = client.get("/api/thumb", params={"u": url})
        assert response.status_code == 400
        assert "allowlist" in response.json()["detail"]
    assert _thumb_failures(client.app) == {}, "the allowlist refusal was cached"


def test_concurrent_stores_leave_the_counter_equal_to_the_bytes_held(db_cfg, conn, monkeypatch):
    """The semaphore bounds fetches; it does not bound the store.

    A store is a read-modify-write of the cache and its running total, so stores
    landing together can evict the same entry twice, drop one of the
    subtractions, or blow the ceiling. The counter must still equal the bytes
    actually held, and the ceiling must still hold.
    """
    import sys
    import threading
    import types

    import discord_stats.api.app as app_module
    from discord_stats.auth.session import SESSION_COOKIE, Level, establish_session

    class NoopSemaphore:
        """All the fetches at once: the fetch cap is not what guards the store."""

        def __init__(self, value):
            pass

        def acquire(self):
            pass

        def release(self):
            pass

    monkeypatch.setattr(app_module, "threading", types.SimpleNamespace(
        Semaphore=NoopSemaphore, Thread=threading.Thread, Lock=threading.Lock))
    body = b"x" * 100
    monkeypatch.setattr(app_module, "THUMB_CACHE_BYTES", 100 * len(body) * 100, raising=False)
    use(monkeypatch, chunks=[body])

    cfg, path = db_cfg
    app = create_app(cfg, path)
    # An exception mid-store has to surface as a 500 the assertion can count,
    # not be re-raised in a worker thread where nobody sees it.
    client = TestClient(app, raise_server_exceptions=False)
    client.cookies.set(SESSION_COOKIE, establish_session(conn, "u1", Level.VIEWER))
    cache, total, _ = _thumb_cache(app)

    # The default 5 ms switch interval is far longer than this critical section,
    # so a test has to make preemption land inside it to see the interleaving.
    interval = sys.getswitchinterval()
    sys.setswitchinterval(1e-5)
    try:
        for burst in range(3):
            # A cache filled to a hundred entries, then squeezed: every store
            # below has to evict most of it, which is the window that races.
            use(monkeypatch, chunks=[body])
            monkeypatch.setattr(app_module, "THUMB_CACHE_BYTES", 100 * len(body) * 100)
            for n in range(100):
                warm = _urls(f"warm-{burst}-{n}")[0]
                assert client.get("/api/thumb", params={"u": warm}).status_code == 200
            monkeypatch.setattr(app_module, "THUMB_CACHE_BYTES", 10 * len(body))

            urls = _urls(*[f"cold-{burst}-{n}" for n in range(12)])
            ready = threading.Barrier(len(urls))
            failures = []

            def fetch(method, url, **opts):
                ready.wait(timeout=10)   # every store arrives at once
                return FakeStream(chunks=[body])

            monkeypatch.setattr(httpx, "stream", fetch)

            def store(url):
                response = client.get("/api/thumb", params={"u": url})
                if response.status_code != 200:
                    failures.append(response.status_code)

            threads = [threading.Thread(target=store, args=(url,)) for url in urls]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=30)

            held = sum(len(entry[1]) for entry in cache.cell_contents.values())
            assert failures == [], f"burst {burst}: a concurrent store failed: {failures}"
            assert total.cell_contents == held, (
                f"burst {burst}: the counter says {total.cell_contents} bytes, "
                f"the cache holds {held}"
            )
            assert held <= 10 * len(body), (
                f"burst {burst}: the byte ceiling was blown: {held} bytes held"
            )
    finally:
        sys.setswitchinterval(interval)


def test_at_most_four_fetches_run_at_once_and_a_slot_is_always_freed(db_cfg, conn, monkeypatch):
    """N parallel requests must not each hold a 25 MB body at the same time."""
    import threading
    import types

    import discord_stats.api.app as app_module
    from discord_stats.auth.session import SESSION_COOKIE, Level, establish_session

    made = []

    class RecordingSemaphore:
        def __init__(self, value):
            self.value = value
            self.acquired = 0
            self.released = 0
            made.append(self)

        def acquire(self):
            self.acquired += 1

        def release(self):
            self.released += 1

    # Replace only how app.py sees `threading`: patching the real module would
    # hand the fake to every library the test client uses.
    monkeypatch.setattr(app_module, "threading", types.SimpleNamespace(
        Semaphore=RecordingSemaphore, Thread=threading.Thread, Lock=threading.Lock))
    use(monkeypatch, headers={"content-type": "image/gif",
                              "content-length": str(26 * 1024 * 1024)})
    cfg, path = db_cfg
    client = TestClient(create_app(cfg, path))
    client.cookies.set(SESSION_COOKIE, establish_session(conn, "u1", Level.VIEWER))

    # Two distinct URLs: a repeat of either would come from the negative cache
    # and never reach the semaphore at all.
    for url in ("https://media.tenor.com/too-big.gif", "https://media.tenor.com/too-big-too.gif"):
        assert client.get("/api/thumb", params={"u": url}).status_code == 502

    assert made, "no fetch semaphore was created"
    assert made[0].value == 4, "more than four outbound fetches may run at once"
    assert made[0].acquired == made[0].released == 2, "a fetch slot leaked"
