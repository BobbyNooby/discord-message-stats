#!/usr/bin/env node
// One command, everything: the pinned tool, one venv holding both packages,
// the web dependencies and .env.
//
//   pnpm install
//
// Idempotent — a second run rebuilds nothing and never overwrites `.env`.
// DSH_SKIP_PY_SETUP=1 leaves Python alone; DSH_SKIP_JS_SETUP=1 leaves the web
// dependencies alone.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const has = (...parts) => existsSync(join(root, ...parts));
const run = (cmd, args) => {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
};
const set = (name) => process.env[name] === "1";
const isWindows = process.platform === "win32";
const venv = (name) =>
  join(root, ".venv", isWindows ? "Scripts" : "bin", isWindows ? `${name}.exe` : name);

// 1. The tool is a pinned submodule; there is no discord_scraper without it.
if (has(".git")) run("git", ["submodule", "update", "--init", "--recursive"]);

// 2. Web dependencies, so `pnpm test` and `pnpm build` work straight after the
//    one command. `-C web` is a separate project, so this cannot re-enter the
//    root postinstall.
if (set("DSH_SKIP_JS_SETUP")) {
  console.log("  DSH_SKIP_JS_SETUP=1 — skipping the web dependencies");
} else {
  run("pnpm", ["-C", "web", "install", "--frozen-lockfile"]);
}

// 3. Secrets live in .env; settings live in config.toml.
if (!has(".env") && has(".env.example")) {
  copyFileSync(join(root, ".env.example"), join(root, ".env"));
  console.log("  wrote .env from .env.example");
}

// 4. One venv holds the tool (stdlib only) and the dashboard, whose fastapi /
//    uvicorn / authlib are the `[web]` extra and whose pytest is `[dev]`.
const missingPython =
  "  no Python 3 found — skipped the python install.\n" +
  "  install Python 3.11+ and run `pnpm install` again, or set DSH_SKIP_PY_SETUP=1";
let python = venv("python");

if (set("DSH_SKIP_PY_SETUP")) {
  console.log("  DSH_SKIP_PY_SETUP=1 — skipping the python install");
} else if (!has("vendor", "discord-message-scraper", "src", "discord_scraper")) {
  console.error("  the scraper submodule is missing — run: git submodule update --init --recursive");
  process.exit(1);
} else if (!existsSync(python)) {
  // Newest first: the packages need 3.11+, and a bare `python` is still 2.x on
  // some hosts. Each candidate is tried as `<cmd> -m venv .venv`.
  const candidates =
    process.platform === "win32"
      ? [["py", ["-3"]], ["python", []]]
      : [["python3", []], ["python3.13", []], ["python3.12", []], ["python3.11", []], ["python", []]];
  let created = false;
  for (const [cmd, pre] of candidates) {
    try {
      run(cmd, [...pre, "-m", "venv", join(root, ".venv")]);
      created = true;
      break;
    } catch {
      // No such interpreter, or too old — try the next one.
    }
  }
  if (!created) {
    console.log(missingPython);
    process.exit(0);
  }
  python = venv("python");
}

if (!set("DSH_SKIP_PY_SETUP") && existsSync(python)) {
  run(python, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);
  run(python, [
    "-m",
    "pip",
    "install",
    "--quiet",
    "-e",
    "vendor/discord-message-scraper",
    "-e",
    ".[web,dev]",
  ]);
}

const discordScraper = relative(root, venv("discord-scraper"));
const discordStats = relative(root, venv("discord-stats"));
console.log(`
  Setup complete. Two things only you can supply:
    1. a bot token for a bot that can read the channel — DISCORD_TOKEN in .env
    2. the channel id — source.channel_id in config.toml

    cp config.example.toml config.toml        # then set source.channel_id
    ${discordScraper} scrape                  # fill the database
    ${discordStats} serve --api               # dashboard on http://127.0.0.1:8000
`);
