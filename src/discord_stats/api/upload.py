"""Replacing the database from the admin board (spec §10.6).

An upload is two requests, not one, because the operator has to see what they
are about to replace: the first stages the file, validates it, checks the disk
floor and dry-runs the diff; the second commits it. Validation happens on the
staged copy, so a bad file can never touch the live database.

Committing is ordered so that nothing the server reads changes until the last
step: the staged file gets the rollup and control tables a rebuild needs, the
current file is kept as a hard link (or a copy) at ``.bak``, and only then does
one ``os.replace`` swap it in. A failure anywhere earlier leaves the live file
exactly as it was.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO

from discord_scraper.rollups.schema import create_control_tables, create_rollup_tables

# Explicit, not implicit (§10.6): FastAPI's defaults would accept a stream of any
# size, and the reference database is 783 MB, so the cap is generous but real.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024
CHUNK = 1024 * 1024
# The swap keeps the old file beside the new one and holds the staged copy until
# the rename, so the disk has to carry about twice the upload through the
# changeover. Below that floor the operator is told before anything is replaced.
DISK_FLOOR_FACTOR = 2

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
    channel_id: str | None
    timezone: str | None
    added: int | None
    lost: int | None
    free_bytes: int


def _uri(path: Path, mode: str = "ro") -> str:
    """SQLite URI for a path, so a ``?`` in a filename is not read as a query."""
    return f"{path.resolve().as_uri()}?mode={mode}"


def _free_bytes(directory: Path) -> int:
    return shutil.disk_usage(directory).free


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def _diff(staged: Path, current: Path) -> tuple[int | None, int | None]:
    """``(added, lost)`` — rows the staged file would bring and take away.

    Compared by ``id``: the ``messages`` primary key is globally unique, so one
    id identifies one row. ``None`` means the comparison could not be made (no
    current file, or a file that is not this schema) and the board says so
    rather than printing a confident zero.
    """
    if not current.exists():
        return None, None
    try:
        conn = sqlite3.connect(_uri(staged), uri=True)
    except sqlite3.Error:
        return None, None
    try:
        conn.execute("ATTACH DATABASE ? AS current", (_uri(current),))
        added = conn.execute(
            "SELECT COUNT(*) FROM messages m WHERE NOT EXISTS "
            "(SELECT 1 FROM current.messages c WHERE c.id = m.id)"
        ).fetchone()[0]
        lost = conn.execute(
            "SELECT COUNT(*) FROM current.messages c WHERE NOT EXISTS "
            "(SELECT 1 FROM messages m WHERE m.id = c.id)"
        ).fetchone()[0]
        return int(added), int(lost)
    except sqlite3.Error:
        return None, None
    finally:
        conn.close()


def _inspect(path: Path, target: Path) -> dict[str, Any]:
    """Validate a candidate database and describe it. Raises ValueError."""
    try:
        conn = sqlite3.connect(_uri(path), uri=True)
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
        channel = conn.execute(
            f"SELECT channel_id FROM {REQUIRED_TABLE} LIMIT 1"
        ).fetchone()
        # The scraper never writes a zone into `meta`, but a database exported by
        # another install might; when it does, that is the zone its buckets were
        # built in and worth naming.
        timezone = None
        if "meta" in tables:
            found = conn.execute("SELECT value FROM meta WHERE key = 'timezone'").fetchone()
            timezone = found[0] if found else None
    except sqlite3.DatabaseError as exc:
        raise ValueError(f"not a usable SQLite database: {exc}") from None
    finally:
        conn.close()

    added, lost = _diff(path, target)
    if added is None and not target.exists():
        added, lost = int(rows or 0), 0
    return {
        "rows": int(rows or 0),
        "first": (first or "")[:10] or None,
        "last": (last or "")[:10] or None,
        "channel_id": channel[0] if channel else None,
        "timezone": timezone,
        "added": added,
        "lost": lost,
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
        # Same bytes as the file in place: nothing to replace, and letting the
        # operator "replace" it would only rotate a backup over itself. The size
        # comparison keeps this free in the ordinary case.
        if target.exists() and target.stat().st_size == written:
            if _digest(staged_path) == _digest(target):
                raise ValueError(
                    "the file is byte-for-byte the database already in place — "
                    "there is nothing to replace"
                )
        free = _free_bytes(directory)
        floor = DISK_FLOOR_FACTOR * written
        if free < floor:
            raise ValueError(
                f"not enough free disk space: {floor} bytes are needed for the swap "
                f"and its backup, and {free} are free"
            )
        described = _inspect(staged_path, target)
    except Exception:
        staged_path.unlink(missing_ok=True)
        raise

    return Staged(upload_id=upload_id, path=staged_path, target=target,
                  size_bytes=written, free_bytes=free, **described)


def _fsync(path: Path) -> None:
    handle = os.open(path, os.O_RDONLY)
    try:
        os.fsync(handle)
    finally:
        os.close(handle)


def _fsync_dir(directory: Path) -> None:
    # A directory rename is durable only once the directory itself is flushed.
    # Not every platform allows it, and failing here must not fail the commit.
    try:
        handle = os.open(directory, os.O_RDONLY)
    except OSError:  # pragma: no cover - platform dependent
        return
    try:
        os.fsync(handle)
    except OSError:  # pragma: no cover - platform dependent
        pass
    finally:
        os.close(handle)


def _prepare(path: Path) -> None:
    """Give a database built elsewhere the tables the API writes to.

    Done on the staged file, before the swap: a database that cannot take its
    own control plane is refused while the live file is still untouched.
    """
    conn = sqlite3.connect(_uri(path, mode="rwc"))
    try:
        create_rollup_tables(conn)
        create_control_tables(conn)
        conn.commit()
    finally:
        conn.close()


def commit(staged: Staged) -> Path | None:
    """Prepare the staged file, keep the current one, then swap atomically.

    The backup is a hard link where the filesystem allows one, so the swap costs
    no copy of a 783 MB file; a copy is the fallback. Either way the current
    database is safe before its path is reused.
    """
    _prepare(staged.path)
    backup: Path | None = None
    if staged.target.exists():
        backup = staged.target.with_suffix(staged.target.suffix + ".bak")
        backup.unlink(missing_ok=True)
        try:
            os.link(staged.target, backup)
        except OSError:  # pragma: no cover - filesystems without hard links
            shutil.copy2(staged.target, backup)
    _fsync(staged.path)
    os.replace(staged.path, staged.target)
    _fsync_dir(staged.target.parent)
    return backup


def discard(staged: Staged) -> None:
    staged.path.unlink(missing_ok=True)


def sweep_orphans(directory: Path) -> list[Path]:
    """Delete staging files this process cannot have written.

    A staged upload is only meaningful to the process that validated it: the
    upload id lives in memory and on the operator's screen, and a page reload
    takes it away, so nothing can confirm or discard the file afterwards. At
    boot, with no upload in flight, every ``.upload-*`` beside the database is
    one of those — and it is the size of a database.
    """
    if not directory.is_dir():
        return []
    removed: list[Path] = []
    for path in sorted(directory.glob(".upload-*")):
        try:
            path.unlink()
        except OSError:  # pragma: no cover - a file we cannot remove is not fatal
            continue
        removed.append(path)
    return removed
