# Operations

One machine, two services, one SQLite file. This is the short version of
everything that bites in production.

## Two shapes of deployment

| Shape | Command | Why |
|---|---|---|
| One process | `discord-stats serve` | the default on a home box: API, worker and SPA together |
| Split | `discord-stats serve --api` **and** `discord-scraper serve --worker` | the Discord token lives on the machine that serves no HTTP |

`docker-compose.yml` runs the split shape with a shared `./data` volume. The
worker is the only writer; the API is the only reader of message data.

## The database

- **WAL mode is a prerequisite, not a nicety.** One writer, many readers, and a
  reader is never blocked by an in-flight commit. It is set on first open.
- **Backups: use SQLite's own API, never `cp`.**

  ```bash
  sqlite3 /data/messages.db ".backup '/backups/messages-$(date +%F).db'"
  ```

  `.backup` is transactional and WAL-aware, so `-wal` and `-shm` do **not** need
  to be copied. `cp messages.db` can miss committed writes still sitting in the
  WAL, which is the difference between a backup and a belief.
- **Restore, once, deliberately, before you trust any of this.** An untested
  backup is not a backup. Stop the services, move the current file aside, put the
  backup in place, start again, and open the site:

  ```bash
  docker compose down
  mv data/messages.db data/messages.db.old
  cp /backups/messages-2026-10-16.db data/messages.db
  docker compose up -d
  curl -s localhost:8000/api/health
  ```

- **Restoring a database also invalidates the rollups** unless the backup was
  taken after a rebuild; the site will say `stale` rather than serve last week's
  numbers, which is the intended behaviour.

## Rebuilding rollups

```bash
discord-scraper rollups rebuild     # every family, inside one transaction
discord-scraper rollups status      # per-family rows + current/stale
```

A rebuild is required after anything that changes an aggregate: a timezone
change, an identity merge, hiding somebody, or editing the stopword list. The
admin board's **Save only** marks the cache stale and lets you stage several
edits; **Save & recalculate** writes and enqueues the rebuild. `status` is how
you check rather than guess — a cache with no invalidation check serves wrong
numbers, and wrong numbers still look fine.

On the reference dataset (492,625 messages, a 756 MB database) a full rebuild
takes **~44 s** and holds the write lock for about a second of it. That is a
background job, once per ingest.

## Token health

Discord user tokens carry no expiry, so the only detector is
`GET /api/v9/users/@me`:

| Code | Meaning | Action |
|---|---|---|
| 200 | alive | nothing |
| 401 | the token is dead | rotate it |
| 403 | the token is fine, the channel is unreachable | fix the config |
| 429 | rate limited | handled automatically |

`/api/health` reports `banner`: `null` when healthy, `stale` when the last
ingest is ≥ 3 days old (or has never happened), `token_dead` when the probe
says so. The banner is red for a dead token because that is the cause, and the
state lives in SQLite rather than process memory, so a restart cannot reset it
to healthy.

## Serving it to your phone

```bash
tailscale serve --bg http://localhost:8000     # https://<machine>.<tailnet>.ts.net
tailscale serve status                          # is it on?
tailscale serve reset                           # off — clears every serve on the machine
```

Tailnet-only and real TLS, which means the `Secure` session cookie works. Never
use `tailscale funnel` for this: it is public internet access, and this app
holds other people's message data.

## Configuration changes over time

- `config.toml` is the operator's file; the admin board writes overrides into
  the `config` table (timezone, ignore list, allowlist policy, cron).
- The database is the contract. `messages` is the source of truth; every rollup
  is derived and rebuildable, so a bad rollup is never data loss.
- Secrets never enter the database or a response. `/api/admin/status` reports
  whether the token is alive, never the token.
