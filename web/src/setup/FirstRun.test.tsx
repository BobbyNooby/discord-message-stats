/**
 * The admin's first-run screen: two ways in, and what each one is waiting on.
 * The fetch stub answers with the shapes in `src/discord_stats/api/`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminSetup } from "../api/client";
import type { TokenCheck } from "../admin/api";
import { FirstRun } from "./FirstRun";

const FRESH: AdminSetup = {
  needed: true,
  can_admin: true,
  channel_id: "1200000000000000001",
  messages: 0,
  rollups_built: false,
  worker_seen_at: new Date().toISOString(),
  job: null,
};

const TOKEN: TokenCheck = {
  status: "unknown",
  checked_at: null,
  bot: null,
  error: null,
  channel: null,
  source: "environment",
};

type Call = { url: string; method: string; body?: unknown };
let calls: Call[];
let token: TokenCheck;

function response(status: number, body?: unknown): Response {
  return { status, ok: status >= 200 && status < 300, statusText: "OK", json: async () => body } as unknown as Response;
}

beforeEach(() => {
  calls = [];
  token = TOKEN;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).split("?")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (method === "GET" && url === "/api/admin/token") return response(200, token);
      if (method === "POST" && url === "/api/admin/jobs")
        return response(201, { id: 3, channel_id: "c1", kind: body.kind, status: "queued" });
      if (method === "PUT" && url === "/api/admin/config")
        return response(200, { effective: { channel_id: body.channel_id }, overridden: ["channel_id"] });
      if (method === "POST" && url === "/api/admin/recalculate")
        return response(202, { id: 4, channel_id: "c1", kind: "rebuild_rollups", status: "queued" });
      if (method === "GET" && url === "/api/admin/jobs") return response(200, { jobs: [] });
      if (method === "GET" && url === "/api/setup") return response(200, FRESH);
      throw new Error(`unexpected request: ${method} ${url}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderFirstRun(setup: AdminSetup = FRESH) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FirstRun setup={setup} />
    </QueryClientProvider>,
  );
}

const sent = (method: string, url: string) => calls.filter((call) => call.method === method && call.url === url);

describe("the first-run screen", () => {
  it("offers both ways in, and says how to copy a database safely", async () => {
    renderFirstRun();
    expect(screen.getByRole("heading", { name: "Upload a database you already have" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scrape from scratch" })).toBeInTheDocument();
    expect(screen.getByText('sqlite3 messages.db ".backup copy.db"')).toBeInTheDocument();
    // The same upload the admin board's "Replace the database" runs.
    expect(screen.getByLabelText("Database file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload and dry-run/i })).toBeInTheDocument();
  });

  it("starts the first scrape as a catch-up job", async () => {
    renderFirstRun();
    const start = await screen.findByRole("button", { name: "Start scraping" });
    await waitFor(() => expect(start).toBeEnabled());
    await userEvent.click(start);
    await waitFor(() => expect(sent("POST", "/api/admin/jobs")).toHaveLength(1));
    expect(sent("POST", "/api/admin/jobs")[0].body).toEqual({ kind: "catch_up" });
  });

  it("will not start without a channel, and says why", async () => {
    renderFirstRun({ ...FRESH, channel_id: "" });
    expect(await screen.findByText("Save a channel id first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start scraping" })).toBeDisabled();
  });

  it("will not start without a token, and says why", async () => {
    token = { ...TOKEN, source: "none" };
    renderFirstRun();
    expect(await screen.findByText(/Give the worker a token first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start scraping" })).toBeDisabled();
  });

  it("saves the channel the scrape will read", async () => {
    renderFirstRun({ ...FRESH, channel_id: "" });
    await userEvent.type(screen.getByLabelText("Channel ID"), "1200000000000000002");
    await userEvent.click(screen.getByRole("button", { name: "Save channel" }));
    await waitFor(() => expect(sent("PUT", "/api/admin/config")).toHaveLength(1));
    expect(sent("PUT", "/api/admin/config")[0].body).toEqual({ channel_id: "1200000000000000002" });
  });

  it("shows a running scrape instead of offering a second one", async () => {
    renderFirstRun({
      ...FRESH,
      messages: 4200,
      job: {
        id: 3, kind: "catch_up", status: "running", phase: null,
        requested_at: "2026-11-04T10:00:00+00:00", started_at: "2026-11-04T10:00:05+00:00",
        finished_at: null, result: null, error: null,
      },
    });
    expect(screen.getByText(/4,200 messages so far/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start scraping" })).toBeDisabled();
  });

  it("says plainly when no worker has checked in", () => {
    renderFirstRun({ ...FRESH, worker_seen_at: null });
    expect(screen.getByText(/No worker has checked in/)).toBeInTheDocument();
  });

  it("offers the build once messages are in and nothing is building them", async () => {
    renderFirstRun({ ...FRESH, messages: 80 });
    await userEvent.click(screen.getByRole("button", { name: "Build the stats" }));
    await waitFor(() => expect(sent("POST", "/api/admin/recalculate")).toHaveLength(1));
  });
});
