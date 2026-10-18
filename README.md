# discord-message-stats

Serve [discord-message-scraper](https://github.com/BobbyNooby/discord-message-scraper)
as a stats dashboard: the API, the React SPA and the OAuth login. The scraper is
pinned as a submodule under `vendor/`, so this repo owns everything web-shaped
while the tool stays dependency-free.

**Install one of two ways:**

| | Install | What you get |
|---|---|---|
| Local | `pnpm install` | one venv with the tool *and* this dashboard; the API and the worker run as two processes |
| Container | `docker compose up` | the same pair from one image and one named volume, with neither Python nor Node on the host |

The container's home is the volume (`DISCORD_SCRAPER_HOME=/data`), so
`config.toml` and `messages.db` live there and a rebuild never loses them.
[deploy/coolify.md](deploy/coolify.md) is the deploy contract.

The CLI is still a first-class interface, not a leftover: `discord-scraper`
scrapes and rebuilds with no web code at all, and that is how the tool is useful
with zero infrastructure. The web is additive.

> **ToS caveat, read it:** scraping uses a **user-account token** against
> Discord's private REST API, which violates Discord's Terms of Service
> ("self-botting") and can get the account actioned. Use a dedicated alt
> account, throttle conservatively, and accept that risk knowingly. The
> compliant alternative is Discord's own data export
> (Settings → Privacy & Safety → Request Data), which the tool can also import.

**Jump to:** [quickstart](#quickstart) · [the stats site](#the-stats-site) ·
[deploying](deploy/coolify.md) · [operations](OPERATIONS.md) · [schema](#schema)
· [analysis CLI](#analysis)

## Quickstart

```bash
git clone --recurse-submodules https://github.com/BobbyNooby/discord-message-stats
cd discord-message-stats

pnpm install                         # submodule, .venv, both packages, web deps, .env

cp config.example.toml config.toml   # then set source.channel_id
# .env was created for you — put DISCORD_TOKEN in it
```

That is the whole setup. `pnpm install` is idempotent, so re-run it any time.
`DSH_SKIP_PY_SETUP=1` leaves the Python environment alone (for anyone managing
their own interpreter), `DSH_SKIP_JS_SETUP=1` leaves the web dependencies alone.

```bash
.venv/bin/discord-scraper scrape        # needs the real token; resumes if interrupted
.venv/bin/discord-stats serve --api     # http://127.0.0.1:8000
```

Run the worker as a second process — same venv, same database:

```bash
.venv/bin/discord-scraper serve --worker
```

(On Windows the scripts are under `.venv\Scripts\`.) Only the scrape and the
worker need `DISCORD_TOKEN`; the dashboard reads the local database and serves
without it. The named analyses (`stats`, `top-authors`, …) are in
[Analysis](#analysis).

## Layout

```
vendor/discord-message-scraper/   the pinned tool (submodule)
  src/discord_scraper/            `discord-scraper` — scrape/analyze/rollups/serve --worker
src/discord_stats/                the dashboard
  cli.py                          `discord-stats` — serve --api (HTTP only)
  api/                            the FastAPI app: viewer payload, admin, upload, logs
  auth/                           Discord OAuth, sessions, the allowlist
web/                              the React frontend (pnpm); builds to web/dist
theme/tokens.css                  the one file a fork overrides (CSS variables only)
docker/entrypoint.sh              seeds an empty /data volume before either service
config.example.toml               copy to config.toml (settings; gitignored)
.env.example                      copy to .env (secrets only; gitignored)
output/messages.db                the database (created on first run; gitignored)
tests/                            the pytest suite
```

## Setup

`pnpm install` creates `.env` from `.env.example` if it is missing, and never
overwrites one you already have. `.env` holds secrets:

- `DISCORD_TOKEN` — the token that scrapes. A **bot** token can read a server
  channel it has been invited to; a user token also works but see the ToS
  caveat above.
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`,
  `ADMIN_DISCORD_ID` — only needed to sign in to the site

`config.toml` holds every setting. The ones a first run needs are:

- `source.channel_id` — the channel ID (the number in the client URL
  `/channels/@me/<id>` for a DM, or right-click a channel → Copy Channel ID)
- `source.batch_size` — messages per request (1–100; default 50)

The rest — timezone, counted message types, the bot rule, stopword packs,
identity merges, OAuth client id and redirect URI — have neutral defaults and
are documented inline in `config.example.toml`.

The channel can be changed without editing the file: saving it in the admin
board (`/admin`) stores an override next to the database, and the scrape, the
worker and `rollups rebuild` all resolve through that override. The CLI reads a
different `config.toml` with `--config`, and ignores stored overrides entirely
with `--ignore-overrides`:

```sh
.venv/bin/discord-scraper scrape --config /path/to/config.toml
.venv/bin/discord-scraper scrape --ignore-overrides
```

## Run

```sh
.venv/bin/discord-scraper scrape                 # full scrape
.venv/bin/discord-scraper scrape --max-batches 3 # quick test run (3 batches of 50)
.venv/bin/discord-scraper scrape --batch-size 25 # gentler on the API (1-100; default 50)
```

`scrape` is a subcommand: bare `discord-scraper` prints the available commands.

Safe to interrupt (Ctrl-C) and re-run at any time:

- `INSERT OR IGNORE` on message ID — no duplicate rows
- resume points persisted in a `meta` table: `oldest_id` for the older end,
  and `catchup_cursor` for the bottom of a hole left by a catch-up pass that
  was killed part-way. The cursor is what makes an interrupted *update*
  recoverable: the next run skips down past the stripe it already wrote and
  keeps going into the hole, instead of stopping at the first batch it
  recognises and leaving the hole behind.
- newest-first "catch-up" pass grabs messages newer than the DB, then a
  "backfill" pass continues older history from the resume point
- 50 messages per request by default — tune with `--batch-size` or
  `source.batch_size` in `config.toml` (the flag wins; 1–100, and 100 is
  Discord's hard maximum, so the default 50 keeps you conservative), ~0.8s
  between requests; honors `retry_after` on HTTP 429

Live progress per batch shows cumulative count, elapsed time, current rate,
and DB size:

```
  backfill: 100 fetched, oldest now 15417... | 2s elapsed | 57.6 msg/s | db: 1,300 | ███████░░░░░░░░░░░░░░░░░ ~32% span
```

There is deliberately no message-count "% complete / ETA": Discord's API does
not expose a channel's total message count. The backfill bar instead shows how
much of the channel's **time span** your history covers, from channel creation
(decoded from the channel-id snowflake) to the newest message. It is only a
rough proxy for message progress — quiet months move the bar quickly, busy
months slowly — and it hovers below 100% until the first message is reached.

## Tests

```sh
# the dashboard suite imports the tool from the submodule
PYTHONPATH=vendor/discord-message-scraper/src .venv/bin/python -m pytest -q

cd web && pnpm test && pnpm typecheck && pnpm build
```

`pnpm install` already provides everything these need: the `[web,dev]` extras in
`pyproject.toml` are FastAPI/uvicorn/authlib plus pytest.

No network: the catch-up tests run against a temp SQLite file with only the
HTTP call faked, and the rollup tests run against an in-memory database with
the real schema. The resume paths get their own tests — a pass killed
mid-update, a re-run that is already current, a `--max-batches` stop, and new
messages arriving while a hole is still open.

`python3 -m unittest discover -s tests -t .` also works, but it only finds the
few `unittest.TestCase` classes, not the pytest-style functions.

## Schema

```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,           -- Discord snowflake as TEXT (64-bit)
    channel_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_username TEXT,
    content TEXT,
    created_at TEXT NOT NULL,      -- ISO8601
    edited_at TEXT,
    reply_to_id TEXT,
    has_attachments INTEGER DEFAULT 0,
    raw TEXT                       -- full original message JSON
);
CREATE INDEX idx_created ON messages (created_at);
CREATE INDEX idx_author ON messages (author_id);
```

The `raw` column keeps the untouched API payload, so reactions/embeds/mentions
can be extracted later without re-scraping.

## Analysis

Two layers: a no-coding CLI and a Python wrapper for developing your own analysis.

### CLI

Once installed (`pip install -e .`) the analysis commands are subcommands of
`discord-scraper`:

```sh
discord-scraper analyze                                                # default report: charts + text dump
discord-scraper analyze stats
discord-scraper analyze report --bucket auto # auto bucket from the data span
discord-scraper analyze activity --by month # or day / hour
discord-scraper analyze top-authors --limit 10
discord-scraper analyze reactions           # emoji leaderboard (raw JSON)
discord-scraper analyze attachments         # file-type breakdown (raw JSON)
discord-scraper analyze mentions            # most-@'d people (raw JSON)
discord-scraper analyze most-replied
discord-scraper analyze search "some text"
discord-scraper analyze top-words --author exampleuser  # word frequency
discord-scraper analyze emoji               # emoji used in message text
```

The analysis code lives in the tool, so it imports from the submodule. From a
bare checkout, run it with the submodule on the path:

```sh
PYTHONPATH=vendor/discord-message-scraper/src .venv/bin/python -m discord_scraper.analysis stats
```

`discord-scraper analyze` (or `discord-scraper analyze report`) with no other
arguments generates `output/report/` in both **words** and **messages** modes:

- `words_pie.png` / `messages_pie.png` — share per user
- `words_over_time.png` / `messages_over_time.png` — per day/month/year,
  bold TOTAL line + one colored line per user
- `report.txt` — the raw numbers behind all four charts

Charts need matplotlib (`python3 -m pip install --user matplotlib`); the text
report works without it.

Ready-made SQL also lives in the tool's repo:

```sh
sqlite3 output/messages.db < vendor/discord-message-scraper/sql/analysis.sql
```

### As a library

`MessageDB` wraps the DB so you write plain Python, not SQL + `json.loads`
(this needs the package installed: `pip install -e .`):

```python
from discord_scraper.analysis import MessageDB

db = MessageDB()

db.messages()                       # all messages as parsed dicts (raw JSON parsed for you)
db.messages(where="author_username = ?", params=("exampleuser",))
db.query("SELECT ... FROM messages ...")
db.scalar("SELECT COUNT(*) FROM messages")
db.top_authors(10)                  # ready-made analyses are methods too
db.reactions()

df = db.frame()                     # pandas DataFrame (pip install pandas)
```

Every function returns `sqlite3.Row` rows (or plain dicts for `.messages()`),
so results feed straight into `pandas.DataFrame(...)`, `collections.Counter`, etc.


### Querying `raw` (nested JSON)

`raw` holds the original API message object as `json.dumps` output — nested
objects and arrays included. Query it with SQLite's JSON functions:

```sql
-- reaction leaderboard
SELECT json_extract(r.value, '$.emoji.name') AS emoji,
       SUM(json_extract(r.value, '$.count')) AS uses
FROM messages, json_each(messages.raw, '$.reactions') r
GROUP BY emoji ORDER BY uses DESC;

-- attachment types
SELECT json_extract(j.value, '$.content_type') AS type, COUNT(*) AS n
FROM messages, json_each(messages.raw, '$.attachments') j
GROUP BY type ORDER BY n DESC;
```

The shape is Discord's [message object](https://discord.com/developers/docs/resources/message#message-object):

```jsonc
{
  "id": "123456789012345678",           // snowflake, always a string
  "type": 0,                             // 0 default, 19 reply, 3 call, 7 join, ...
  "channel_id": "234567890123456789",
  "author": { "id": "...", "username": "...", "global_name": "..." },
  "content": "message text",             // "" on calls/system/attachment-only
  "timestamp": "2026-09-01T14:46:48.691000+00:00",
  "edited_timestamp": null,              // ISO string once edited
  "pinned": false,
  "mentions": [],                        // arrays live only in raw
  "attachments": [ { "content_type": "image/png", "url": "..." } ],
  "embeds": [],
  "reactions": [ { "emoji": { "name": "🔥" }, "count": 2 } ],
  "message_reference": { "message_id": "..." },      // present on replies
  "referenced_message": { "...full parent message..." } // absent if parent deleted
}
```

If a JSON field becomes central to your analysis, promote it to a real indexed
column — one pass, no re-scrape:

```sql
ALTER TABLE messages ADD COLUMN sticker_count INTEGER;
UPDATE messages
SET sticker_count = json_array_length(raw, '$.sticker_items')
WHERE json_extract(raw, '$.sticker_items') IS NOT NULL;
```

## The stats site

The site is a second, optional layer over the same database: precomputed rollup
tables plus a read-only, authenticated API and a React frontend that the API
serves from the same port.

```bash
discord-scraper rollups rebuild --db output/messages.db  # required before the site has anything to show
discord-scraper rollups status --db output/messages.db   # row counts + current/stale per family
discord-stats serve                                    # the dashboard API and SPA, :8000
```

`rollups` reads a database you name with `--db`, so it works against a copy
without touching the live one. `serve` defaults to `output/messages.db`.

**The API never aggregates on request.** It reads fifteen rollup tables and
reports when they were built; a request never scans `messages` and never touches
the 483 MB of raw JSON. That is why the rebuild is a separate step, and why
`rollups status` matters: after a timezone change, an identity merge or a
stopword edit, the tables are **stale** until you rebuild.

### Routes

| Route | Who | What |
|---|---|---|
| `/` | signed-in viewer | the dashboard: 40 cards over seven sections |
| `/login` | anyone | Discord OAuth, scope `identify` only |
| `/admin` | admin | data source, who shows, identity merge, ingest, rollup cache, access |
| `/api/health` | anyone | liveness plus the banner state |
| `/api/bootstrap` | viewer | the whole dashboard payload in one request |
| `/api/recent` | viewer | the last N messages — see the privacy note below |
| `/api/words` | viewer | search the full word index beyond the shipped 500 |
| `/api/admin/*` | admin | status, config, jobs, recalculate, upload, search |

Two endpoints deliberately break the "aggregates only" rule, and both are
viewer-gated: `/api/recent` (truncated to ~120 characters, no attachments,
embeds or raw JSON; `ui.show_recent = 0` removes it entirely) and the admin
search. Everything else returns numbers.

### Access

- Secrets, environment only: `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET`,
  `SESSION_SECRET`, `ADMIN_DISCORD_ID`.
- Settings, `config.toml`: channel, timezone, counted message types, bot rule,
  stopword packs, identity merges, OAuth client id and redirect URI. The admin
  board can override the channel, the timezone, extra stopwords, the allowlist
  policy and the schedule; `--ignore-overrides` bypasses those stored values.
- A viewer is the admin id, anyone with an explicit `allow` row, or anybody who
  has posted. An admin is `ADMIN_DISCORD_ID`. Sessions are rows in SQLite,
  stored hashed, so they are revocable.
- For a quick look on a phone there is `discord-stats serve --dev-login`,
  which enables `/auth/dev-login` and signs anyone who can reach the port in as
  viewer or admin. **Development only** — it prints a warning, and it must never
  be used on a public host.

### Deploying

`Dockerfile` is a two-stage build: Node builds `web/dist`, then Python installs
the tool from `vendor/` plus this dashboard and serves the SPA. One **image**,
two services: `docker-compose.yml` runs the API on port 8000 and the worker with
no port at all, sharing one named volume at `/data`, so the Discord token can
live on the worker. The Coolify contract — port, volume, healthcheck, env vars
and the https redirect rule — is in [deploy/coolify.md](deploy/coolify.md).
Backup, restore, the serve shapes and the tunnel are in
[OPERATIONS.md](OPERATIONS.md).

## Development

```bash
# backend — the dashboard tests import the tool from the submodule
PYTHONPATH=vendor/discord-message-scraper/src .venv/bin/python -m pytest -q

# frontend (Vite dev server proxies /api to :8000)
pnpm dev
pnpm test
pnpm typecheck
```

The design spec and the implementation plans live in `docs/superpowers/`, which
is **gitignored** — they describe one specific chat and are not part of the
shipped tool.

## Credits

English stopwords come from [stopwords-iso](https://github.com/stopwords-iso/stopwords-iso)
(MIT, © 2020 Gene Diaz); the licence ships beside the data in
`vendor/discord-message-scraper/src/discord_scraper/data/LICENSE-stopwords.txt`,
along with an opt-in Malay pack. Charting is [ECharts](https://echarts.apache.org/) (Apache-2.0) and its
word-cloud extension. UI chrome follows [shadcn/ui](https://ui.shadcn.com/)
conventions over Radix primitives.
