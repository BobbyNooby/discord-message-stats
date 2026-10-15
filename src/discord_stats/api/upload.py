"""Replacing the database from the admin board (spec §10.6).

An upload is two requests, not one, because the operator has to see what they
are about to replace: the first stages the file, validates it and reports the
row count and date range; the second commits it. Validation happens on the
staged copy, so a bad file can never touch the live database, and the swap is
``os.replace`` — atomic on POSIX, and the previous file survives as ``.bak``.
"""

from __future__ import annotations

import os
import secrets
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO

# Explicit, not implicit (§10.6): FastAPI's defaults would accept a stream of any
# size, and the reference database is 783 MB, so the cap is generous but real.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024
CHUNK = 1024 * 1024

REQUIRED_TABLE = "messages"
REQUIRED_COLUMNS = {"id", "channel_id", "author_id", "created_at", "type"}


class UploadTooLarge(ValueError):
    """Raised before an oversized file is buffered any further."""


@dataclass
class Staged:
    upload_id: str
    path: Path
    target: Path
    rows: int
    first: str | None
    last: str | None
    size_bytes: int


def _inspect(path: Path) -> dict[str, Any]:
    """Validate a candidate database and describe it. Raises ValueError."""
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error as exc:  # pragma: no cover - connect rarely fails here
        raise ValueError(f"could not open the file: {exc}") from None
    try:
        check = conn.execute("PRAGMA integrity_check").fetchone()
        if not check or str(check[0]).lower() != "ok":
            raise ValueError(f"integrity check failed: {check[0] if check else 'no result'}")
        tables = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )}
        if REQUIRED_TABLE not in tables:
            raise ValueError(f"the database has no {REQUIRED_TABLE} table")
        columns = {row[1] for row in conn.execute(f"PRAGMA table_info({REQUIRED_TABLE})")}
        missing = REQUIRED_COLUMNS - columns
        if missing:
            raise ValueError(f"{REQUIRED_TABLE} is missing columns: {', '.join(sorted(missing))}")
        rows, first, last = conn.execute(
            "SELECT COUNT(*), MIN(created_at), MAX(created_at) FROM messages"
        ).fetchone()
    except sqlite3.DatabaseError as exc:
        raise ValueError(f"not a usable SQLite database: {exc}") from None
    finally:
        conn.close()
    return {
        "rows": int(rows or 0),
        "first": (first or "")[:10] or None,
        "last": (last or "")[:10] or None,
    }


def stage(stream: BinaryIO, target: Path, upload_dir: Path | None = None) -> Staged:
    """Stream an upload to a temp file beside the target and validate it.

    Beside the target because ``os.replace`` is only atomic within a filesystem.
    """
    directory = upload_dir or target.parent
    directory.mkdir(parents=True, exist_ok=True)
    upload_id = secrets.token_urlsafe(12)
    staged_path = directory / f".upload-{upload_id}"

    written = 0
    try:
        with staged_path.open("wb") as handle:
            while True:
                chunk = stream.read(CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise UploadTooLarge(
                        f"the file is larger than the {MAX_UPLOAD_BYTES // (1 << 30)} GiB limit"
                    )
                handle.write(chunk)
        if written == 0:
            raise ValueError("the upload was empty")
        described = _inspect(staged_path)
    except Exception:
        staged_path.unlink(missing_ok=True)
        raise

    return Staged(upload_id=upload_id, path=staged_path, target=target,
                  size_bytes=written, **described)


def commit(staged: Staged) -> Path:
    """Swap the staged file in, keeping the previous one as ``.bak``."""
    backup = staged.target.with_suffix(staged.target.suffix + ".bak")
    if staged.target.exists():
        os.replace(staged.target, backup)
    os.replace(staged.path, staged.target)
    return backup


def discard(staged: Staged) -> None:
    staged.path.unlink(missing_ok=True)
