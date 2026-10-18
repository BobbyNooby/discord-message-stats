#!/usr/bin/env node
// One command, everything: the pinned tool, the python side, and the web deps.
//
//   pnpm install
//
// Idempotent. Set DSH_SKIP_PY_SETUP=1 to manage python yourself.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const has = (p) => existsSync(join(root, p));
const run = (cmd, args) => {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
};

// 1. the tool is a pinned submodule; the dashboard cannot import without it
if (has(".git")) run("git", ["submodule", "update", "--init", "--recursive"]);
if (!has("vendor/discord-message-scraper/src/discord_scraper")) {
  console.error("  the scraper submodule is missing — run: git submodule update --init --recursive");
  process.exit(1);
}

// 2. secrets live in .env; settings live in config.toml
if (!has(".env") && has(".env.example")) {
  copyFileSync(join(root, ".env.example"), join(root, ".env"));
  console.log("  wrote .env from .env.example — fill in DISCORD_TOKEN and your channel id");
}

// 3. the web deps
run("pnpm", ["-C", "web", "install"]);

// 4. the python side: one venv holds the tool and the dashboard
if (process.env.DSH_SKIP_PY_SETUP === "1") {
  console.log("  DSH_SKIP_PY_SETUP=1 — skipping the python install");
} else {
  const python = join(root, ".venv", "bin", "python");
  if (!existsSync(python)) run("python3", ["-m", "venv", join(root, ".venv")]);
  run(python, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);
  run(python, ["-m", "pip", "install", "--quiet", "-e", "vendor/discord-message-scraper", "-e", "."]);
}

console.log(`
  ready — two processes, one database:
    .venv/bin/discord-stats serve --api          the dashboard   (http://127.0.0.1:8000)
    .venv/bin/discord-scraper serve --worker      ingests and rebuilds
`);
