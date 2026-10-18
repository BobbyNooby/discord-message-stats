# syntax=docker/dockerfile:1
#
# One image, two services (compose: api + worker). Node builds the SPA and never
# reaches the runtime; the runtime installs the pinned tool from vendor/ plus
# the dashboard itself and serves /app/static from the same image.

FROM node:24-bookworm-slim AS web
WORKDIR /build
RUN corepack enable
# Lockfile first: the dependency layer is the slow one and it rarely changes.
COPY web/package.json web/pnpm-lock.yaml ./web/
RUN cd web && pnpm install --frozen-lockfile
# The SPA imports ../../theme/tokens.css, so the theme is part of the build
# context — the web/ directory alone does not compile.
COPY web/ ./web/
COPY theme/ ./theme/
RUN cd web && pnpm build

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

COPY pyproject.toml README.md config.example.toml ./
COPY src/ ./src/
# The tool arrives as a submodule, so the image installs it from vendor/.
# Order matters: both packages declare a `discord-stats` script, and the tool's
# copy points at a module it does not ship, so the dashboard goes on last.
COPY vendor/ ./vendor/
RUN pip install --no-cache-dir "./vendor/discord-message-scraper" ".[web]"

# The built SPA lands where `serve` looks for it without any flag.
COPY --from=web /build/web/dist ./static

# Seed an empty volume on first boot, then hand over to the command.
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh \
 && useradd --create-home --uid 10001 scraper \
 && mkdir -p /data \
 && chown -R scraper:scraper /data /app
USER scraper
VOLUME /data

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status==200 else 1)"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["discord-stats", "serve", "--api", "--host", "0.0.0.0", "--port", "8000"]
