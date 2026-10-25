"""The admin surface: everything under ``/api/admin``, admin-only.

One router and one guard: every topic below is mounted here behind
``require_admin``, so an endpoint cannot be added to the board without it. One
endpoint is genuinely different from the rest — ``search`` returns message
text, the sole exception to "aggregates only" (§4.4) — and it keeps a module
of its own for that reason.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from discord_stats.api.admin import (
    access,
    board,
    identity,
    jobs,
    logstream,
    progress,
    search,
    token,
    uploads,
)
from discord_stats.auth.session import require_admin

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])
for topic in (board, token, jobs, uploads, search, identity, access, progress, logstream):
    router.include_router(topic.router)
