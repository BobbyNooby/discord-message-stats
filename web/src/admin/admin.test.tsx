/**
 * The behaviours §11.6 turns on, driven through the real route:
 *
 * 1. "Save only" and "Save & recalculate" are different actions — the fake
 *    fetch records which endpoint each one hits;
 * 2. a 409 from the upload is "wait for the running job", not a failure;
 * 3. a rollup family that is stale is shown as stale;
 * 4. every write an admin makes — an include toggle, a merge, revoke-all, the
 *    cron switch — really goes to the API and marks the cache stale.
 *
 * The fetch stub returns the exact shapes from `src/discord_scraper/api/admin.py`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Payload } from "../api/types";
import { Admin } from "../routes/Admin";
import type { AdminConfig, AdminStatus } from "./api";

const STATUS: AdminStatus = {
  app: "Discord Scraper",
  channel_id: "c1",
  timezone: "Asia/Kuala_Lumpur",
  cache_stale: false,
  database: { size_bytes: 5242880, path: "/data/messages.db" },
  admin: { discord_id: "4242" },
  config_hash: "abc123def4567890",
  rollups: {
    activity: { rows: 120, stale: true, computed_at: "2026-10-14T20:00:00+00:00" },
    heat: { rows: 30, stale: false, computed_at: "2026-10-15T20:00:00+00:00" },
  },
  worker: {
    token_status: "ok",
    checked_at: "2026-10-15T19:00:00+00:00",
    last_ok_at: "2026-10-15T19:00:00+00:00",
    last_ingest_at: "2026-10-15T18:00:00+00:00",
    last_ingest_added: "12",
    last_seen_at: new Date().toISOString(),
    consecutive_failures: null,
    cron_enabled: "true",
    cron_hours: "6",
  },
  jobs: { queued: 0, running: 0, done: 3, failed: 1 },
  sessions: { active: 2 },
  checked_at: "2026-10-15T20:00:00+00:00",
};

const CONFIG: AdminConfig = {
  effective: {
    channel_id: "c1",
    timezone: "Asia/Kuala_Lumpur",
    ignore_words: ["bro"],
    allowlist_policy: "posted",
    app_name: "Discord Scraper",
    count_types: ["default"],
    exclude_bots: true,
    cron_enabled: true,
    cron_hours: 6,
  },
  overridden: ["timezone"],
};

const PAYLOAD = {
  meta: { total: 492625, active_days: 1200, firstLocal: "2019-01-01", lastLocal: "2026-10-15" },
  authors: [
    {
      id: "1",
      name: "joyt",
      msgs: 400,
      accounts: ["1", "2"],
    },
    { id: "3", name: "vei", msgs: 120, accounts: ["3"] },
  ],
  identities: [{ canonical: "1", members: ["1", "2"] }],
} as unknown as Payload;

type Call = { url: string; method: string; body?: unknown };

let calls: Call[];
let handlers: Record<string, (init?: RequestInit) => Response>;

function response(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 409 ? "Conflict" : "OK",
    json: async () => body,
  } as unknown as Response;
}

function bodyOf(init?: RequestInit): Record<string, unknown> | undefined {
  if (typeof init?.body !== "string") return undefined;
  return JSON.parse(init.body) as Record<string, unknown>;
}

function key(method: string, url: string): string {
  return `${method} ${url.split("?")[0]}`;
}

beforeEach(() => {
  calls = [];
  handlers = {
    "GET /api/admin/status": () => response(200, STATUS),
    "GET /api/admin/config": () => response(200, CONFIG),
    "GET /api/bootstrap": () => response(200, PAYLOAD),
    "PUT /api/admin/config": () => response(200, CONFIG),
    "PUT /api/admin/inclusions": (init) =>
      response(200, { included: bodyOf(init)?.included ?? {}, cache_stale: true }),
    "PUT /api/admin/identity": () =>
      response(200, { merges: [{ canonical: "1", accounts: ["1", "2", "3"] }], cache_stale: true }),
    "POST /api/admin/sessions/revoke-all": () => response(200, { revoked: 3 }),
    "POST /api/admin/recalculate": () =>
      response(202, { id: 7, channel_id: "c1", kind: "rebuild_rollups", status: "queued" }),
    "GET /api/admin/jobs": () => response(200, { jobs: [] }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: bodyOf(init) });
      const handler = handlers[key(method, url)];
      if (!handler) throw new Error(`unexpected request: ${method} ${url}`);
      return handler(init);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAdmin() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Admin />
    </QueryClientProvider>,
  );
}

const recorded = (method: string, url: string) =>
  calls.some((call) => call.method === method && call.url === url);

const recordedCall = (method: string, url: string) =>
  calls.find((call) => call.method === method && call.url === url);

describe("<Admin>", () => {
  it("Save only writes the config without enqueueing a rebuild, and still marks the cache stale", async () => {
    const user = userEvent.setup();
    renderAdmin();

    const saveOnly = await screen.findByRole("button", { name: "Save only" });
    await waitFor(() => expect(saveOnly).toBeEnabled());

    await user.click(saveOnly);

    await waitFor(() => expect(recorded("PUT", "/api/admin/config")).toBe(true));
    expect(recorded("POST", "/api/admin/recalculate")).toBe(false);
    expect(await screen.findByText(/cache marked stale/i)).toBeInTheDocument();
  });

  it("Save & recalculate writes the config and enqueues the rebuild", async () => {
    const user = userEvent.setup();
    renderAdmin();

    const saveAndRebuild = await screen.findByRole("button", { name: /save & recalculate/i });
    await waitFor(() => expect(saveAndRebuild).toBeEnabled());

    await user.click(saveAndRebuild);

    await waitFor(() => expect(recorded("PUT", "/api/admin/config")).toBe(true));
    expect(recorded("POST", "/api/admin/recalculate")).toBe(true);
  });

  it("shows a 409 from the upload as waiting for the running job, not as a failure", async () => {
    handlers["POST /api/admin/upload"] = () =>
      response(409, { detail: "1 job(s) are running — wait for them to finish before uploading" });

    const user = userEvent.setup();
    renderAdmin();

    const input = await screen.findByLabelText("Database file");
    const file = new File([new Uint8Array([1, 2, 3])], "messages.db", {
      type: "application/vnd.sqlite3",
    });
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: /upload and preview/i }));

    expect(await screen.findByText(/wait for the running job/i)).toBeInTheDocument();
    expect(screen.queryByText(/^conflict$/i)).not.toBeInTheDocument();
  });

  it("marks a stale rollup family stale in the per-family table", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByRole("button", { name: "Rollup cache" }));

    const staleRow = await screen.findByRole("row", { name: /activity/i });
    expect(within(staleRow).getByText("stale")).toBeInTheDocument();

    const currentRow = screen.getByRole("row", { name: /heat/i });
    expect(within(currentRow).getByText("current")).toBeInTheDocument();
  });

  it("labels a merged identity with its account count in Who shows", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByRole("button", { name: "Who shows" }));

    expect(await screen.findByText("2 accounts")).toBeInTheDocument();
    expect(screen.getByText(/applied at build time/i)).toBeInTheDocument();
  });

  it("writes an include toggle through the API and marks the cache stale", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByRole("button", { name: "Who shows" }));
    await user.click(await screen.findByRole("checkbox", { name: /joyt/ }));

    await waitFor(() => expect(recorded("PUT", "/api/admin/inclusions")).toBe(true));
    expect(recordedCall("PUT", "/api/admin/inclusions")?.body).toEqual({
      included: { "1": false },
    });
    expect(await screen.findByText(/cache marked stale/i)).toBeInTheDocument();
    expect(await screen.findByText(/include setting saved/i)).toBeInTheDocument();
    expect(screen.queryByText(/^not saved:/i)).not.toBeInTheDocument();
  });

  it("says so and keeps the warning when the include write fails", async () => {
    handlers["PUT /api/admin/inclusions"] = () =>
      response(400, { detail: "no such identity" });

    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByRole("button", { name: "Who shows" }));
    await user.click(await screen.findByRole("checkbox", { name: /joyt/ }));

    const alarm = await screen.findByRole("alert");
    expect(alarm).toHaveTextContent(/not saved: no such identity/i);
    expect(screen.queryByText(/include setting saved/i)).not.toBeInTheDocument();
  });

  it("sends the whole merge set when an alt is added", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByRole("button", { name: "Identity merge" }));
    await user.selectOptions(await screen.findByLabelText(/add an alt account to joyt/i), "3");
    await user.click(screen.getByRole("button", { name: /add alt/i }));

    await waitFor(() => expect(recorded("PUT", "/api/admin/identity")).toBe(true));
    expect(recordedCall("PUT", "/api/admin/identity")?.body).toEqual({
      merges: [{ canonical: "1", accounts: ["1", "2", "3"] }],
    });
    expect(await screen.findByText(/cache marked stale/i)).toBeInTheDocument();
  });

  it("surfaces a failed merge instead of quietly swallowing it", async () => {
    handlers["PUT /api/admin/identity"] = () =>
      response(400, { detail: "duplicate account in 1" });

    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByRole("button", { name: "Identity merge" }));
    await user.selectOptions(await screen.findByLabelText(/add an alt account to joyt/i), "3");
    await user.click(screen.getByRole("button", { name: /add alt/i }));

    const alarm = await screen.findByRole("alert");
    expect(alarm).toHaveTextContent(/not saved: duplicate account in 1/i);
  });

  it("revokes every other session and reports how many ended", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByRole("button", { name: "Access" }));
    await user.click(await screen.findByRole("button", { name: /revoke all sessions/i }));

    await waitFor(() => expect(recorded("POST", "/api/admin/sessions/revoke-all")).toBe(true));
    expect(await screen.findByText(/3 sessions revoked/i)).toBeInTheDocument();
    expect(screen.getByText(/you stay signed in/i)).toBeInTheDocument();
  });

  it("writes the cron switch through the config Save path", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByRole("button", { name: "Ingest" }));
    const hours = await screen.findByLabelText(/interval in hours/i);
    await user.clear(hours);
    await user.type(hours, "12");
    await user.click(screen.getByLabelText(/scheduled ingest/i));
    await user.click(screen.getByRole("button", { name: "Save only" }));

    await waitFor(() => expect(recorded("PUT", "/api/admin/config")).toBe(true));
    expect(recordedCall("PUT", "/api/admin/config")?.body).toEqual({
      cron_enabled: false,
      cron_hours: 12,
    });
    expect(recorded("POST", "/api/admin/recalculate")).toBe(false);
    expect(await screen.findByText(/cache marked stale/i)).toBeInTheDocument();
  });
});
