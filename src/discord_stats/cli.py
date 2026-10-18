"""The dashboard's own command line: serve the API (and optionally a worker).

The tool keeps the worker and the data layer; this serves HTTP. The dependency
runs one way on purpose — the dashboard may import the tool, never the reverse.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _checkout_root() -> Path | None:
    """This dashboard checkout, when the package runs from one.

    The tool resolves its own home by walking up from its installed package,
    which under this repo is ``vendor/discord-message-scraper`` — a directory
    that never holds the dashboard's ``config.toml``, ``.env`` or ``output/``.
    The README keeps all three at the checkout root, so a plain
    ``discord-stats serve`` has to look here; ``DISCORD_SCRAPER_HOME`` still
    wins, and a wheel install (no checkout around it) keeps the tool's default.
    """
    candidate = Path(__file__).resolve().parents[2]
    if (candidate / "pyproject.toml").is_file() and (candidate / "src" / "discord_stats").is_dir():
        return candidate
    return None


def _spa_dir() -> Path | None:
    """The SPA this dashboard checkout built, if it has one.

    ``_find_static`` looks for the page beside the *tool* install, which in a
    checkout is ``vendor/discord-message-scraper`` — a directory that never
    holds the dashboard's build. Without this the README's plain
    ``discord-stats serve`` serves the API and 404s the page; only the
    container worked, because it sets ``DISCORD_SCRAPER_STATIC``.
    """
    candidate = Path(__file__).resolve().parents[2] / "web" / "dist"
    return candidate if (candidate / "index.html").is_file() else None


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="discord-stats",
        description="Serve the stats dashboard for a database built by discord-message-scraper.",
    )
    sub = parser.add_subparsers(dest="command", required=True, metavar="<command>")
    serve = sub.add_parser("serve", help="serve the dashboard API (and the SPA if it is built)")
    serve.add_argument("--db", help="path to the SQLite database (default: the tool's)")
    serve.add_argument("--config", help="path to config.toml (default: the tool's)")
    serve.add_argument("--static-dir", help="directory holding the built SPA")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--tls-cert")
    serve.add_argument("--tls-key")
    serve.add_argument(
        "--dev-login",
        action="store_true",
        help="skip the login screen. Anyone who can reach the port is in. Never on a public host.",
    )
    serve.add_argument(
        "--api",
        action="store_true",
        help="serve HTTP only; run the ingest worker as its own process (the default shape).",
    )
    serve.add_argument(
        "--with-worker",
        action="store_true",
        help="also run the ingest/rebuild worker in this process (one-shot deploys).",
    )
    return parser


def _serve(args: argparse.Namespace) -> int:
    import os
    from pathlib import Path

    from discord_scraper.cli import _find_static
    from discord_scraper.config import PROJECT_DIR, load_config
    from discord_scraper.scraper.config import resolve_db_path

    # `DISCORD_SCRAPER_HOME` wins, then this checkout, then the tool's own
    # walk-up. See `_checkout_root` for why the middle step exists.
    override = os.environ.get("DISCORD_SCRAPER_HOME")
    home = Path(override).expanduser() if override else (_checkout_root() or PROJECT_DIR)
    database = Path(args.db) if args.db else resolve_db_path(home)
    if not database.exists():
        print(
            f"no database at {database} — run `discord-scraper scrape` first",
            file=sys.stderr,
        )
        return 2
    config_path = Path(args.config) if args.config else home / "config.toml"
    try:
        # Serving no worker must not *demand* a Discord token, but the other secrets
        # still have to load or the admin list and OAuth client secret vanish.
        # Nor does it demand a channel: a fresh volume is seeded empty, and
        # refusing to boot would hide the admin board that sets it. The UI warns.
        cfg = load_config(
            env_path=home / ".env" if (home / ".env").is_file() else None,
            config_path=config_path,
            require_token=False,
            require_channel=False,
        )
    except SystemExit as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if not cfg.channel_id:
        print(
            "no channel configured: set source.channel_id in "
            f"{config_path} (or in the admin board) — serving a warning until then",
            file=sys.stderr,
        )

    if bool(args.tls_cert) != bool(args.tls_key):
        print("--tls-cert and --tls-key must be given together", file=sys.stderr)
        return 2

    try:
        import uvicorn

        from discord_stats.api.app import create_app
    except ModuleNotFoundError as exc:
        print(
            f"serve needs the web extra, which is not installed (missing {exc.name}) — "
            'run: pip install -e ".[web]"',
            file=sys.stderr,
        )
        return 2

    static = _find_static(args.static_dir or _spa_dir())
    if static is None:
        print(
            "no built SPA found — serving the API only (build it with: cd web && pnpm build)",
            file=sys.stderr,
        )
    if args.dev_login:
        print(
            "WARNING: --dev-login is on. Anyone who can reach this port can sign in as "
            "viewer or admin (/auth/dev-login). Never use this on a public host.",
            file=sys.stderr,
        )

    from contextlib import ExitStack

    from discord_scraper import locks

    with ExitStack() as stack:
        if args.with_worker:
            try:
                stack.enter_context(
                    locks.hold(database, kind="worker", holder="discord-stats serve worker")
                )
            except locks.Busy as exc:
                print(f"{exc} — serving the API without an ingest worker", file=sys.stderr)
            else:
                import threading

                from discord_scraper.db import connect_writable
                from discord_scraper.worker.loop import run_forever

                def run() -> None:
                    conn = connect_writable(database)
                    try:
                        run_forever(conn, cfg)
                    finally:
                        conn.close()

                threading.Thread(target=run, daemon=True, name="ingest-worker").start()

        uvicorn.run(
            create_app(cfg, database, static_dir=static, dev_login=args.dev_login),
            host=args.host,
            port=args.port,
            ssl_certfile=args.tls_cert,
            ssl_keyfile=args.tls_key,
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(sys.argv[1:] if argv is None else argv)
    if args.command == "serve":
        return _serve(args)
    return 2
