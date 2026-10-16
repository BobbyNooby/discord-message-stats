# syntax=docker/dockerfile:1
#
# Two stages, so Node never reaches the runtime image (spec §4.8). Tier 3 only:
# the CLI is `pipx install discord-scraper` and the local dev loop needs no
# container at all.

FROM node:24-alpine AS web
WORKDIR /web
RUN corepack enable
# Lockfile first: the dependency layer is the slow one and it rarely changes.
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM python:3.12-slim AS runtime
# The volume is the app's home, not just its database: config.toml, .env and
# messages.db all live there, so a container needs no config baked into the
# image and a rebuild never loses a setting.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DISCORD_SCRAPER_HOME=/data \
    DISCORD_SCRAPER_DB=/data/messages.db \
    DISCORD_SCRAPER_STATIC=/app/static
WORKDIR /app

COPY pyproject.toml README.md ./
COPY src/ ./src/
RUN pip install --no-cache-dir ".[web]"

# The built SPA lands where `serve` looks for it without any flag.
COPY --from=web /web/dist ./static

# Drop privileges, but leave the volume ownable by the runtime user.
RUN useradd --create-home --uid 10001 scraper \
 && mkdir -p /data \
 && chown -R scraper:scraper /data /app
USER scraper
VOLUME /data

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status==200 else 1)"

CMD ["discord-scraper", "serve", "--all", "--host", "0.0.0.0", "--port", "8000"]
