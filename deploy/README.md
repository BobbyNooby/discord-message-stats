# Deploying the dashboard

What a deploy has to provide. This is the fork's deploy door — upstream ships
no hostnames, no TLS paths and no invented stack.

## Port

`serve` listens on **8000** by default (`--host`, `--port`). One process can
serve the API and the SPA (`discord-scraper serve --all`), or split them
(`--api` + `--worker`) so the Discord token lives on the machine that serves no
HTTP. For a public listener, pass `--tls-cert`/`--tls-key`; otherwise terminate
TLS in front. Publish exactly one port.

## Database volume

Mount one persistent volume and point the app at it:

- `DISCORD_SCRAPER_HOME` — the app's home (the container image uses `/data`).
  `config.toml` and `.env` are read from here.
- `DISCORD_SCRAPER_DB` — the database (default `<home>/output/messages.db`).

That volume holds `messages.db` (SQLite, WAL) and every setting. Back it up
with SQLite's `.backup`, never `cp`. The worker is the only writer; the API is
the only reader of message data.

## Environment

Secrets come from the environment or `.env`, never from `config.toml`:

- `DISCORD_TOKEN` — the account token that scrapes; not needed by the `--api`
  shape.
- `DISCORD_CLIENT_SECRET` — Discord OAuth login.
- `SESSION_SECRET` — signs the session cookie.
- `DISCORD_CLIENT_ID` and `ADMIN_DISCORD_ID` — OAuth client id (public; also
  settable in `config.toml`) and the first admin's Discord id.

Optional overrides: `DISCORD_SCRAPER_HOME`, `DISCORD_SCRAPER_DB`,
`DISCORD_SCRAPER_STATIC` (where the built SPA lives; the image serves it from
`/app/static` with no flag).

## OAuth redirect

Discord only accepts **https** redirect URIs — except for `localhost`/`127.0.0.1`
during development. Set `access.redirect_uri` in `config.toml` to the exact
https URL registered in the Discord developer portal; a mismatch is the usual
cause of a silent login failure. A local HTTPS listener or a tailnet TLS proxy
(both keep the `Secure` cookie working) is the normal answer.
