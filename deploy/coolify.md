# Deploying on Coolify

One image, two services, one volume. `api` serves HTTP; `worker` ingests and
rebuilds and publishes no port. The split is what lets `DISCORD_TOKEN` live on
the worker alone.

Point Coolify at this repo and use `docker-compose.yml` (or the root
`Dockerfile` alone if you only want the API). Nothing is built on the host
except by Coolify: the image's Node stage runs `pnpm build`, so `web/dist` is
baked into the image.

| | |
|---|---|
| Port | **8000**, internal. Publish exactly one — Coolify's domain/port mapping should target it. The worker publishes nothing. |
| Volume | One persistent volume, **`discord-data` → `/data`**. It holds `messages.db`, `config.toml` and `.env`. **Keep it across rebuilds.** |
| Healthcheck | `GET http://127.0.0.1:8000/api/health` (already in the image and in compose). Coolify gates the rollout on it — a failing check must not replace a running deploy. |
| Command (api) | `discord-stats serve --api --host 0.0.0.0 --port 8000` |
| Command (worker) | `discord-scraper serve --worker` |

## Environment

Set these in Coolify's env UI (they are the names in `.env.example`):

| Variable | Needed by | Notes |
|---|---|---|
| `DISCORD_TOKEN` | worker | a **bot** token that can read the channel. The API runs without it. |
| `DISCORD_CLIENT_ID` | api | public; may also live in `config.toml` as `[access].client_id` |
| `DISCORD_CLIENT_SECRET` | api | secret |
| `SESSION_SECRET` | api | signs the session cookie; any long random string |
| `ADMIN_DISCORD_ID` | api | the first admin's Discord id |
| `DISCORD_SCRAPER_HOME` | both | `/data` (the image sets it; set it again in Coolify if you override the volume path) |
| `DISCORD_SCRAPER_DB` | both | `/data/messages.db` |
| `DISCORD_SCRAPER_STATIC` | api | `/app/static` (the built SPA) |
| `CHANNEL_ID` | api, worker | optional. On first boot the entrypoint fills an **empty** `source.channel_id` with it, so a deploy needs no shell access to the volume. An already-configured channel is never overwritten. |

## First boot

A fresh volume is empty, so the entrypoint seeds it before the command runs:

- `/data/config.toml` from `config.example.toml`, if absent.
- `messages.db` with the control schema, if absent, so `/api/health` answers
  `200` with `banner: "stale"` instead of crash-looping.
- `source.channel_id`, if `CHANNEL_ID` is set and the file's value is empty.

The API boots even with **no channel configured** — it reports
`"channel_configured": false` and a `channel_message` in `/api/health` and
`/api/bootstrap`, rather than exiting. That matters because the admin board,
which can set the channel, is served by that same API. Set `CHANNEL_ID` at
deploy time, or edit `/data/config.toml`, or set it in the admin board.

Every step is idempotent: an existing file or channel is never overwritten.

## TLS and login

Discord requires **https** for any redirect URI that is not `localhost` /
`127.0.0.1`. Give this deployment a domain, terminate TLS at Coolify (its own
Let's Encrypt, or a proxy in front), and register the redirect URI in the
Discord Developer Portal **exactly** as configured:

```
https://<your-domain>/auth/callback
```

Set the same value in `config.toml` (`access.redirect_uri`). A mismatch is the
usual cause of a silent login failure.

## Rebuilds

A redeploy replaces the image but must reuse the same `discord-data` volume.
Verify after a redeploy that `DISCORD_SCRAPER_HOME` is still `/data`: the
database must never be written into the image layer, or the next deploy loses
it. `docker compose down` without `-v` keeps the volume; `down -v` deletes it.

Back the database up with SQLite's own API, never `cp`:

```sh
sqlite3 /path/to/messages.db ".backup '/backup/messages.db'"
```
