import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A fork's panel is injected through the two exports `panels/custom` owns, so
 * this test drives the real dashboard and the real registry — no second render
 * path. The factory imports React lazily: a module-scope JSX runtime would be
 * hoisted above the mock.
 */
vi.mock("./custom", async () => {
  const React = await import("react");
  const spec = (id: string, label: string) => ({
    id,
    label,
    honours: [],
    shapes: ["bar"],
    defaultShape: "bar",
  });
  return {
    customPanels: [spec("fork-recap", "Fork recap"), spec("fork-orphan", "Fork orphan")],
    customComponents: {
      "fork-recap": () =>
        React.createElement(
          "section",
          null,
          React.createElement("h2", null, "Fork recap"),
          React.createElement("p", null, "fork-panel-body"),
        ),
    },
  };
});

const server = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  health: vi.fn(),
  recent: vi.fn(),
  words: vi.fn(),
}));

vi.mock("../api/client", () => ({
  Unauthorized: class Unauthorized extends Error {},
  Forbidden: class Forbidden extends Error {},
  Offline: class Offline extends Error {},
  ServerError: class ServerError extends Error {},
  getBootstrap: server.bootstrap,
  getHealth: server.health,
  getRecent: server.recent,
  getWords: server.words,
}));

import App from "../App";
import type { Payload } from "../api/types";

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
    types: [[0, "Default", 2490]],
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
  types: [[0, "default", 2490]],
  tz: { name: "UTC", label: "UTC" },
  channel_hint: "c1",
} as unknown as Payload;

beforeEach(() => {
  localStorage.clear();
  server.bootstrap.mockReset().mockResolvedValue(payload);
  server.health.mockReset().mockResolvedValue({ ok: true, checked_at: "", banner: null });
  server.recent.mockReset().mockResolvedValue({ messages: [], truncated: false });
  server.words.mockReset().mockResolvedValue({ word: "", total: 0, authors: [] });
});

describe("a custom panel through the dashboard", () => {
  it("renders the fork's component in its own section", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("fork-panel-body")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fork recap" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Custom" })).toBeInTheDocument();
    // The built-in sections are unchanged beside it.
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("says so when a spec has no component rather than dropping the card", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("No component is registered for this panel."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fork orphan" })).toBeInTheDocument();
  });
});
