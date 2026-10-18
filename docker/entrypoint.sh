#!/bin/sh
# Runs before either service's command, so a deploy with an empty volume still
# starts. Seeds the two things a first boot needs — the settings file the app
# reads and a database to answer /api/health from — then hands over.
#
# Idempotent: existing files and an already-set channel are never touched.
set -eu

app_dir="${DISCORD_APP_DIR:-/app}"
home="${DISCORD_SCRAPER_HOME:-/data}"
db="${DISCORD_SCRAPER_DB:-$home/messages.db}"

mkdir -p "$home" "$(dirname "$db")"

if [ ! -f "$home/config.toml" ] && [ -f "$app_dir/config.example.toml" ]; then
  cp "$app_dir/config.example.toml" "$home/config.toml"
  echo "entrypoint: seeded $home/config.toml"
fi

# A channel id from the environment fills an empty source.channel_id, so a
# Coolify deploy can be finished from env vars instead of the volume. Only an
# empty value is replaced; a channel already configured in the file wins.
if [ -n "${CHANNEL_ID:-}" ] && [ -f "$home/config.toml" ]; then
  python - "$home/config.toml" "$CHANNEL_ID" <<'PY'
import pathlib
import re
import sys

path, channel = pathlib.Path(sys.argv[1]), sys.argv[2]
text = path.read_text(encoding="utf-8")
updated, replaced = re.subn(
    r'(?m)^(\s*channel_id\s*=\s*)""\s*$',
    lambda match: f'{match.group(1)}"{channel}"',
    text,
    count=1,
)
if replaced:
    path.write_text(updated, encoding="utf-8")
    print("entrypoint: set source.channel_id from CHANNEL_ID")
else:
    print("entrypoint: source.channel_id already set; CHANNEL_ID ignored")
PY
fi

# Both serve commands exit 2 when the database file is missing, which in a
# container is a crash loop behind a healthcheck that can never pass. Create the
# control schema instead, so the API boots and reports the honest "stale"
# banner; the worker fills the message tables once a channel is configured.
if [ ! -f "$db" ]; then
  python - "$db" <<'PY'
import sys

from discord_scraper.db import connect_writable
from discord_scraper.rollups.schema import create_control_tables

conn = connect_writable(sys.argv[1])
try:
    create_control_tables(conn)
    conn.commit()
finally:
    conn.close()
PY
  echo "entrypoint: initialised $db with the control tables (no messages yet)"
fi

exec "$@"
