"""The thumbnail proxy: reposted media shown without telling Tenor who is looking.

A GIF posted 63 times is worth showing, but letting every viewer's browser fetch
it from Tenor hands those CDNs a list of who is reading this chat.
`media.thumbnails = "proxy"` (the default) fetches and caches it here instead.
"""

from __future__ import annotations

import threading
import time
import urllib.parse

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from discord_stats.api.cache import BoundedCache
from discord_stats.auth.session import Level, require_viewer

# The suffix list is what the data actually contains, and it is a hard
# allowlist because this endpoint takes a URL from the query string.
THUMB_SUFFIXES = (
    "ytimg.com", "ggpht.com", "ytimg.googleusercontent.com",
    "tenor.com", "tenor.co", "klipy.com",
    "twimg.com", "discordapp.net", "discordapp.com",
    "akamaihd.net", "scdn.co", "streamable.com", "imgur.com", "redd.it", "reddit.com",
)
# Streamed, not buffered: the body is read in chunks and abandoned the moment
# it passes the cap, so a large asset costs a bounded amount of memory rather
# than its own size. That is what makes a generous cap safe — and a cap is
# still needed, because this endpoint fetches a URL from the query string
# (the largest thumbnail in the reference data is 36.8 MB).
THUMB_MAX_BYTES = 25 * 1024 * 1024
THUMB_CACHE_ENTRIES = 400
# 400 cached thumbnails at the 25 MB fetch cap would be 10 GB of resident memory,
# so the cache is bounded by total bytes as well as by entry count.
THUMB_CACHE_BYTES = 256 * 1024 * 1024
THUMB_TTL = 86400

# A signed CDN link outlives its signature: fetching one that now 404s again on
# every dashboard load is noise, not a retry. A refusal is remembered for a
# short while instead. Nothing but the refusal is stored, so the count is the
# only budget this cache needs.
THUMB_FAILURES = 512
THUMB_FAIL_TTL = 600

CACHED = {"Cache-Control": "public, max-age=86400"}

router = APIRouter()


class ThumbProxy:
    """One app's thumbnail state: what it holds, what it refused, and who is fetching.

    Built when the app is, so two apps (two tests) never share a cache.
    """

    def __init__(self) -> None:
        self.images = BoundedCache(THUMB_CACHE_ENTRIES, max_weight=THUMB_CACHE_BYTES)
        # The value is what to replay — (status, detail) — not a body.
        self.refusals = BoundedCache(THUMB_FAILURES)
        # Without this, N parallel requests each hold their own 25 MB body, which
        # is what would turn the byte ceiling above into a per-request promise.
        self.fetches = threading.Semaphore(4)

    def refuse(self, url: str, status: int, detail: str) -> None:
        """Remember a refusal so the next request for it is answered, not fetched."""
        self.refusals.put(url, (status, detail), expires_at=time.monotonic() + THUMB_FAIL_TTL)


def allowed(url: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    return any(host == s or host.endswith("." + s) for s in THUMB_SUFFIXES)


@router.get("/api/thumb")
def thumb(request: Request, u: str = Query(..., max_length=2048),
          _level: Level = Depends(require_viewer)) -> Response:
    import httpx

    proxy: ThumbProxy = request.app.state.thumbs
    if not allowed(u):
        raise HTTPException(status_code=400, detail="that host is not on the thumbnail allowlist")
    now = time.monotonic()
    hit = proxy.images.get(u, now)
    if hit is not None:
        return Response(hit[0], media_type=hit[1], headers=CACHED)
    refused = proxy.refusals.get(u, now)
    if refused is not None:
        raise HTTPException(status_code=refused[0], detail=refused[1])
    too_big = f"that image is larger than {THUMB_MAX_BYTES // 1024 // 1024} MB"
    proxy.fetches.acquire()
    try:
        try:
            # Redirects are not followed: a redirect is how an allowlisted host
            # would be used to reach one that is not.
            with httpx.stream("GET", u, timeout=10.0, follow_redirects=False) as response:
                kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
                # mp4 as well as images: the playable asset of a gifv is an mp4,
                # and routing it through here is what keeps Tenor and Klipy out
                # of the viewer's browser.
                if response.status_code != 200 or not (
                    kind.startswith("image/") or kind in ("video/mp4", "video/webm")
                ):
                    raise HTTPException(status_code=502, detail="that URL did not return an image")
                declared = response.headers.get("content-length", "")
                if declared.isdigit() and int(declared) > THUMB_MAX_BYTES:
                    raise HTTPException(status_code=502, detail=too_big)
                body = bytearray()
                for chunk in response.iter_bytes():
                    body += chunk
                    if len(body) > THUMB_MAX_BYTES:
                        raise HTTPException(status_code=502, detail=too_big)
        except HTTPException as refusal:
            # An expired link 404s every time it is asked, so remember the
            # refusal — and nothing else — rather than ask again.
            proxy.refuse(u, refusal.status_code, str(refusal.detail))
            raise
        except Exception as exc:
            detail = f"thumbnail fetch failed: {exc}"
            proxy.refuse(u, 502, detail)
            raise HTTPException(status_code=502, detail=detail) from exc
    finally:
        proxy.fetches.release()
    body = bytes(body)
    # A success supersedes a remembered refusal for the same URL.
    proxy.refusals.pop(u)
    proxy.images.put(u, (body, kind), expires_at=now + THUMB_TTL, weight=len(body))
    return Response(body, media_type=kind, headers=CACHED)
