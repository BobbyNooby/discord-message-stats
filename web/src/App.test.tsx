import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shape switch through the real dashboard: the choice has to reach
 * localStorage, survive a remount, come back to the registry's default under
 * "Reset view", and — the point of deriving both options from rows already in
 * hand — never cause another fetch.
 */
const server = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  health: vi.fn(),
  recent: vi.fn(),
  words: vi.fn(),
}));

vi.mock("./api/client", () => ({
  Unauthorized: class Unauthorized extends Error {},
  Forbidden: class Forbidden extends Error {},
  Offline: class Offline extends Error {},
  ServerError: class ServerError extends Error {},
  getBootstrap: server.bootstrap,
  getHealth: server.health,
  getRecent: server.recent,
  getWords: server.words,
}));

import App from "./App";
import { Forbidden, Offline, ServerError } from "./api/client";
import { CHARTS_KEY } from "./filters/persist";
import type { Payload } from "./api/types";

const TYPES: [number, string, number][] = [
  [0, "Default", 1000],
  [1, "Reply", 500],
  [2, "Call", 300],
  [3, "Pin", 200],
  [4, "Join", 150],
  [5, "Boost", 100],
  [6, "Thread", 80],
  [7, "Poll", 60],
  [8, "Stage", 40],
  [9, "Guild", 30],
  [10, "Recruit", 20],
  [11, "Mystery", 10],
];

const payload = {
  meta: {
    total: 2490,
    source_count: 2490,
    stale: false,
    can_admin: false,
    timezone: "UTC",
    computed_at: "2026-10-17T00:00:00Z",
    authors: 1,
    cells: 1,
    heat_cells: 0,
    active_days: 1,
    firstLocal: "2024-01-01",
    lastLocal: "2024-01-01",
    stopwords: 0,
    kept_words: 0,
    payload_kb: 1,
    payload_gzip_kb: 1,
    types: TYPES,
  },
  authors: [{ id: "u1", name: "Ada", msgs: 2490 }],
  days: ["2024-01-01"],
  cells: [[0, 0, 2490, 100, 10, 5, 0]],
  heat: [],
  edges: [],
  response: [],
  editSpeed: [],
  starters: [],
  attachments: [["image/png", 40]],
  words: [],
  wordAuthors: {},
  authorWordTotals: [],
  authorDistinct: [],
  identities: [],
  linkDomains: [],
  linkCells: [],
  topLinks: [],
  providers: [],
  embedTypes: [["video", 10]],
  linkStats: { msgs: 0, domains: 0, both: 0 },
  emoji: [],
  reactions: [],
  types: TYPES,
  tz: { name: "UTC", label: "UTC" },
  channel_hint: "c1",
} as unknown as Payload;

function renderApp() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })}
    >
      <App />
    </QueryClientProvider>,
  );
}

const storedCharts = () => JSON.parse(localStorage.getItem(CHARTS_KEY) ?? "null")?.charts;

beforeEach(() => {
  localStorage.clear();
  server.bootstrap.mockReset().mockResolvedValue(payload);
  server.health.mockReset().mockResolvedValue({ ok: true, checked_at: "", banner: null });
  server.recent.mockReset().mockResolvedValue({ messages: [], truncated: false });
  server.words.mockReset().mockResolvedValue({ word: "", total: 0, authors: [] });
});

describe("a chart shape through the dashboard", () => {
  it("records the choice, and restores it on the next load", async () => {
    const first = renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Message types as bars" }));
    expect(screen.getByRole("button", { name: "Message types as pie" })).toBeInTheDocument();
    await waitFor(() => expect(storedCharts()).toEqual({ "message-types": "pie" }));

    first.unmount();
    renderApp();
    expect(await screen.findByRole("button", { name: "Message types as pie" })).toBeInTheDocument();
  });

  it("returns every card to the shape its spec declares under Reset view", async () => {
    localStorage.setItem(CHARTS_KEY, JSON.stringify({ version: 1, charts: { "message-types": "pie" } }));
    renderApp();

    // The saved shape is on screen before anything is cleared.
    expect(await screen.findByRole("button", { name: "Message types as pie" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reset view" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear saved view" }));

    expect(screen.getByRole("button", { name: "Message types as bars" })).toBeInTheDocument();
    await waitFor(() => expect(storedCharts()).toEqual({}));
  });

  it("acknowledges the reset instead of clearing the saved view silently", async () => {
    localStorage.setItem(CHARTS_KEY, JSON.stringify({ version: 1, charts: { "message-types": "pie" } }));
    renderApp();

    await userEvent.click(await screen.findByRole("button", { name: "Reset view" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear saved view" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/saved view cleared/i);
  });

  it("redraws from the rows already in hand, without asking the server again", async () => {
    renderApp();
    const toggle = await screen.findByRole("button", { name: "Message types as bars" });
    await waitFor(() => expect(server.bootstrap).toHaveBeenCalledTimes(1));

    await userEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Message types as pie" })).toBeInTheDocument();
    // A shape is a way of drawing one payload, not a new question for the API.
    expect(server.bootstrap).toHaveBeenCalledTimes(1);
    expect(server.recent).toHaveBeenCalledTimes(1);
    expect(server.health).toHaveBeenCalledTimes(1);
  });
});

describe("the states a failed load can leave the reader in", () => {
  it("draws a skeleton while the payload is still on its way", async () => {
    server.bootstrap.mockReset().mockReturnValue(new Promise(() => {}));
    renderApp();

    expect(await screen.findByText("Loading the dashboard…")).toBeInTheDocument();
    expect(document.querySelector("main")).toHaveAttribute("aria-busy", "true");
  });

  it("says a signed-in viewer cannot open the dashboard they were refused", async () => {
    server.bootstrap.mockReset().mockRejectedValue(new Forbidden("admin only"));
    renderApp();

    expect(await screen.findByRole("heading", { name: "Not allowed" })).toBeInTheDocument();
  });

  it("says the browser is offline rather than showing a slow-loading page", async () => {
    server.bootstrap.mockReset().mockRejectedValue(new Offline("no connection"));
    renderApp();

    expect(
      await screen.findByRole("heading", { name: "You are offline" }, { timeout: 6000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows the server's own message when it cannot build the payload", async () => {
    server.bootstrap.mockReset().mockRejectedValue(new ServerError("rollups are not built", 503));
    renderApp();

    expect(
      await screen.findByRole(
        "heading",
        { name: /could not build the dashboard/i },
        { timeout: 6000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("rollups are not built")).toBeInTheDocument();
  });
});

describe("the health payload through the dashboard", () => {
  it("shows the ingest age the health payload carries", async () => {
    // The bug this guards: /api/health learned to return last_ingest_at, but
    // App never handed it to HealthBanner, so the banner always said "unknown".
    server.health.mockReset().mockResolvedValue({
      ok: true,
      checked_at: "",
      banner: "stale",
      last_ingest_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    });
    renderApp();

    expect(await screen.findByText(/4 days old/)).toBeInTheDocument();
  });
});

describe("ui.time_format through the dashboard", () => {
  it("writes the header's 'as of' line on the configured clock", async () => {
    server.bootstrap.mockReset().mockResolvedValue({
      ...payload,
      meta: { ...payload.meta, time_format: "12h" },
    });
    renderApp();

    expect(await screen.findByText(/as of 2026-10-17 12:00 am/)).toBeInTheDocument();
  });

  it("keeps the 24-hour clock the panels drew before by default", async () => {
    renderApp();

    expect(await screen.findByText(/as of 2026-10-17 00:00/)).toBeInTheDocument();
  });
});
