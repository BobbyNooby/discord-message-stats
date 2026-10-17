/**
 * The behaviours §11.6 turns on, driven through the real route:
 *
 * 1. the board is four tasks, not six tabs, and each one is reachable;
 * 2. "Save only" and "Save & recalculate" are different actions — the fake
 *    fetch records which endpoint each one hits;
 * 3. a 409 from the upload is "wait for the running job", not a failure;
 * 4. a rollup family that is stale is shown as stale, with what changed since;
 * 5. every write an admin makes — an include toggle, a merge, revoke-all, the
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
import type { AdminConfig, AdminStatus, MergeEntry } from "./api";

const STATUS: AdminStatus = {
  app: "Discord Scraper",
  channel_id: "c1",
  timezone: "Asia/Kuala_Lumpur",
  cache_stale: false,
  database: { size_bytes: 5242880, path: "/data/messages.db" },
  admin: { discord_id: "4242", known: true },
  config_hash: "abc123def4567890",
  rollups: {
    activity: {
      rows: 120,
      stale: true,
      computed_at: "2026-10-14T20:00:00+00:00",
      built_from_rows: 480,
      built_from_newest: "900",
      built_in_timezone: "Asia/Kuala_Lumpur",
      added_since: 3,
      config_changed: false,
    },
    heat: {
      rows: 30,
      stale: false,
      computed_at: "2026-10-15T20:00:00+00:00",
      built_from_rows: 483,
      built_from_newest: "903",
      built_in_timezone: "Asia/Kuala_Lumpur",
      added_since: 0,
      config_changed: false,
    },
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

const TIMEZONES = {
  zones: ["UTC", "Asia/Kuala_Lumpur", "Europe/London", "America/New_York"],
  configured: "Asia/Kuala_Lumpur",
  effective: "Asia/Kuala_Lumpur",
  auto_zone: "Asia/Kuala_Lumpur",
};

const PAYLOAD = {
  meta: { total: 492625, active_days: 1200, firstLocal: "2019-01-01", lastLocal: "2026-10-15" },
  authors: [
    {
      id: "1",
      name: "alice",
      msgs: 400,
      accounts: ["1", "2"],
    },
    { id: "3", name: "vei", msgs: 120, accounts: ["3"] },
    { id: "4", name: "Kenon", msgs: 50, accounts: ["4"] },
    { id: "5", name: "Jetkenon", msgs: 10, accounts: ["5"] },
    { id: "6", name: "angelina", msgs: 40, accounts: ["6"] },
    { id: "7", name: "angelica", msgs: 30, accounts: ["7"] },
  ],
  identities: [{ canonical: "1", members: ["1", "2"] }],
} as unknown as Payload;

type Call = { url: string; method: string; body?: unknown };

let calls: Call[];
let handlers: Record<string, (init?: RequestInit) => Response>;
/** What the server currently has, so `previous` is the real prior state. */
let identityState: MergeEntry[];

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
  identityState = [{ canonical: "1", accounts: ["1", "2"] }];
  handlers = {
    "GET /api/admin/status": () => response(200, STATUS),
    "GET /api/admin/config": () => response(200, CONFIG),
    "GET /api/admin/timezones": () => response(200, TIMEZONES),
    "GET /api/bootstrap": () => response(200, PAYLOAD),
    "PUT /api/admin/config": () => response(200, CONFIG),
    "PUT /api/admin/inclusions": (init) =>
      response(200, { included: bodyOf(init)?.included ?? {}, cache_stale: true }),
    "PUT /api/admin/identity": (init) => {
      const body = bodyOf(init) as { merges?: MergeEntry[] } | undefined;
      const previous = identityState;
      identityState = body?.merges ?? [];
      return response(200, { merges: identityState, cache_stale: true, previous });
    },
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

/** The nav is the four tasks; open one before touching its controls. */
async function openTask(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole("button", { name: label }));
}

describe("<Admin>", () => {
  it("offers the four tasks and opens each one", async () => {
    const user = userEvent.setup();
    renderAdmin();

    const nav = await screen.findByRole("navigation", { name: /admin tasks/i });
    for (const label of [
      "Fix the data",
      "Refresh the cache",
      "Replace the database",
      "Access",
    ]) {
      expect(within(nav).getByRole("button", { name: label })).toBeInTheDocument();
    }

    await openTask(user, "Fix the data");
    expect(await screen.findByRole("heading", { name: "Fix the data" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /merge accounts/i })).toBeInTheDocument();

    await openTask(user, "Refresh the cache");
    expect(await screen.findByRole("heading", { name: "Refresh the cache" })).toBeInTheDocument();

    await openTask(user, "Replace the database");
    expect(await screen.findByRole("heading", { name: "Replace the database" })).toBeInTheDocument();

    await openTask(user, "Access");
    expect(await screen.findByRole("heading", { name: "Access" })).toBeInTheDocument();
  });

  it("Save only writes the config without enqueueing a rebuild, and still marks the cache stale", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Replace the database");
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

    await openTask(user, "Replace the database");
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

    await openTask(user, "Replace the database");
    const input = await screen.findByLabelText("Database file");
    const file = new File([new Uint8Array([1, 2, 3])], "messages.db", {
      type: "application/vnd.sqlite3",
    });
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: /upload and dry-run/i }));

    expect(await screen.findByText(/wait for the running job/i)).toBeInTheDocument();
    expect(screen.queryByText(/^conflict$/i)).not.toBeInTheDocument();
  });

  it("marks a stale rollup family stale and says what changed since it was built", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Refresh the cache");

    const staleRow = await screen.findByRole("row", { name: /activity/i });
    expect(within(staleRow).getByText("stale")).toBeInTheDocument();
    expect(within(staleRow).getByText(/built from 480 messages/i)).toBeInTheDocument();
    expect(within(staleRow).getByText(/3 added since/i)).toBeInTheDocument();

    const currentRow = screen.getByRole("row", { name: /heat/i });
    expect(within(currentRow).getByText("current")).toBeInTheDocument();
  });

  it("labels a merged identity with its account count in Who shows", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Fix the data");

    expect(await screen.findByText("2 accounts")).toBeInTheDocument();
    expect(screen.getByText(/applied at build time/i)).toBeInTheDocument();
  });

  it("writes an include toggle through the API and marks the cache stale", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Fix the data");
    await user.click(await screen.findByRole("checkbox", { name: /alice/ }));

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

    await openTask(user, "Fix the data");
    await user.click(await screen.findByRole("checkbox", { name: /alice/ }));

    const alarm = await screen.findByRole("alert");
    expect(alarm).toHaveTextContent(/not saved: no such identity/i);
    expect(screen.queryByText(/include setting saved/i)).not.toBeInTheDocument();
  });

  it("sends the whole merge set when an alt is added", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Fix the data");
    await user.selectOptions(await screen.findByLabelText(/add an alt account to alice/i), "3");
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

    await openTask(user, "Fix the data");
    await user.selectOptions(await screen.findByLabelText(/add an alt account to alice/i), "3");
    await user.click(screen.getByRole("button", { name: /add alt/i }));

    const alarm = await screen.findByRole("alert");
    expect(alarm).toHaveTextContent(/not saved: duplicate account in 1/i);
  });

  it("merges any two accounts picked from the pickers and sends the winning name", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Fix the data");
    await user.selectOptions(await screen.findByLabelText("First account"), "3");
    await user.selectOptions(screen.getByLabelText("Second account"), "2");
    // The busier identity (alice, 400 msgs) keeps its name by default.
    expect(screen.getByRole("radio", { name: /keep the name alice/i })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /merge these accounts/i }));

    await waitFor(() => expect(recorded("PUT", "/api/admin/identity")).toBe(true));
    expect(recordedCall("PUT", "/api/admin/identity")?.body).toEqual({
      merges: [{ canonical: "1", accounts: ["1", "2", "3"], name: "alice" }],
    });
    expect(await screen.findByText(/merged 3 accounts into alice/i)).toBeInTheDocument();
  });

  it("lets the operator type the name that wins", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Fix the data");
    await user.selectOptions(await screen.findByLabelText("First account"), "3");
    await user.selectOptions(screen.getByLabelText("Second account"), "2");
    await user.type(screen.getByLabelText(/or type a name/i), "Veibot");
    await user.click(screen.getByRole("button", { name: /merge these accounts/i }));

    await waitFor(() => expect(recorded("PUT", "/api/admin/identity")).toBe(true));
    expect(recordedCall("PUT", "/api/admin/identity")?.body).toEqual({
      merges: [{ canonical: "1", accounts: ["1", "2", "3"], name: "Veibot" }],
    });
  });

  it("offers undo of the last merge and writes the state it replaced back", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Fix the data");
    await user.selectOptions(await screen.findByLabelText("First account"), "3");
    await user.selectOptions(screen.getByLabelText("Second account"), "2");
    await user.click(screen.getByRole("button", { name: /merge these accounts/i }));

    const undo = await screen.findByRole("button", { name: /undo the last change/i });
    await user.click(undo);

    const writes = calls.filter(
      (call) => call.method === "PUT" && call.url === "/api/admin/identity",
    );
    expect(writes).toHaveLength(2);
    expect(writes[1].body).toEqual({ merges: [{ canonical: "1", accounts: ["1", "2"] }] });
    expect(await screen.findByText(/undone/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /undo the last change/i })).not.toBeInTheDocument();
  });

  it("says a rebuild is required after a merge and puts the button beside it", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Fix the data");
    await user.selectOptions(await screen.findByLabelText("First account"), "3");
    await user.selectOptions(screen.getByLabelText("Second account"), "2");
    await user.click(screen.getByRole("button", { name: /merge these accounts/i }));

    const prompt = await screen.findByText(/a rebuild is required to apply the merge/i);
    const card = prompt.closest("div") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: /recalculate all/i }));
    await waitFor(() => expect(recorded("POST", "/api/admin/recalculate")).toBe(true));
  });

  it("scores the name suggestions and sorts them strongest first", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Fix the data");

    const scores = await screen.findAllByText(/match \d+%/);
    expect(scores.map((node) => node.textContent)).toEqual(["match 91%", "match 75%"]);
    expect(scores[0].closest("li")).toHaveTextContent(/Jetkenon.*Kenon/i);
    expect(scores[1].closest("li")).toHaveTextContent(/angelina.*angelica/i);
  });

  it("offers the real zones, an automatic option, and names the effective zone", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Replace the database");
    const select = await screen.findByLabelText("Timezone");
    const values = within(select)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    expect(values).toContain("auto");
    expect(values).toContain("Europe/London");
    expect(values).not.toContain("GMT+8"); // the free-text mistake this replaces
    expect(screen.queryByRole("textbox", { name: /timezone/i })).not.toBeInTheDocument();
    expect(await screen.findByText(/effective zone now/i)).toHaveTextContent("Asia/Kuala_Lumpur");
  });

  it("states the rebuild consequence when the zone changes, before anything is saved", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Replace the database");
    const select = await screen.findByLabelText("Timezone");
    expect(screen.queryByText(/you changed the timezone/i)).not.toBeInTheDocument();

    await user.selectOptions(select, "Europe/London");
    expect(await screen.findByText(/you changed the timezone/i)).toBeInTheDocument();
    expect(screen.getByText(/a rebuild is required to apply it/i)).toBeInTheDocument();
    expect(recorded("PUT", "/api/admin/config")).toBe(false); // not committed yet

    await user.click(screen.getByRole("button", { name: /save & recalculate/i }));
    await waitFor(() => expect(recorded("PUT", "/api/admin/config")).toBe(true));
    expect(recordedCall("PUT", "/api/admin/config")?.body).toMatchObject({
      timezone: "Europe/London",
    });
    expect(recorded("POST", "/api/admin/recalculate")).toBe(true);
  });

  it("shows the upload dry run — channel, zone, rows added, rows lost, disk — before a replace", async () => {
    handlers["POST /api/admin/upload"] = () =>
      response(200, {
        upload_id: "u1",
        rows: 12,
        first: "2026-01-01",
        last: "2026-02-01",
        size_bytes: 1048576,
        channel_id: "c9",
        timezone: "Europe/Berlin",
        timezone_source: "database",
        added: 4,
        lost: 2,
        disk: { free_bytes: 10 * 1048576, required_bytes: 2 * 1048576 },
        replaces: { rows: 10, first: "2025-01-01", last: "2025-12-31", size_bytes: 524288 },
      });

    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Replace the database");
    const input = await screen.findByLabelText("Database file");
    await user.upload(input, new File([new Uint8Array([1, 2, 3])], "messages.db"));
    await user.click(screen.getByRole("button", { name: /upload and dry-run/i }));

    expect(await screen.findByText(/nothing has been replaced yet/i)).toBeInTheDocument();
    expect(
      within(screen.getByText("Channel").closest("div") as HTMLElement).getByText("c9"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Europe\/Berlin \(from the file\)/)).toBeInTheDocument();
    expect(
      within(screen.getByText("Rows added").closest("div") as HTMLElement).getByText("4"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Rows that would be lost").closest("div") as HTMLElement).getByText("2"),
    ).toBeInTheDocument();
    expect(screen.getByText(/10\.0 MiB free · 2\.0 MiB needed/)).toBeInTheDocument();
    expect(recorded("POST", "/api/admin/upload")).toBe(true);
  });

  it("surfaces a refused upload with the server's reason and offers nothing to confirm", async () => {
    handlers["POST /api/admin/upload"] = () =>
      response(400, {
        detail:
          "not enough free disk space: 2097152 bytes are needed for the swap and its backup, and 1024 are free",
      });

    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Replace the database");
    const input = await screen.findByLabelText("Database file");
    await user.upload(input, new File([new Uint8Array([1, 2, 3])], "messages.db"));
    await user.click(screen.getByRole("button", { name: /upload and dry-run/i }));

    expect(await screen.findByText(/not enough free disk space/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing has been replaced yet/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /confirm and replace/i }),
    ).not.toBeInTheDocument();
  });

  it("says so when the configured admin id matches no message", async () => {
    handlers["GET /api/admin/status"] = () =>
      response(200, { ...STATUS, admin: { discord_id: "999999999999999999", known: false } });

    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Access");

    const warning = (await screen.findByText(/no message in this channel/i)).closest(
      "p",
    ) as HTMLElement;
    expect(warning).toHaveTextContent("999999999999999999");
    expect(warning).toHaveTextContent("ADMIN_DISCORD_ID");
    expect(
      within(screen.getByText(/seen posting/i).closest("div") as HTMLElement).getByText("no"),
    ).toBeInTheDocument();
  });

  it("stays quiet about the admin id when it has posted", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Access");

    expect(await screen.findByText(/seen posting/i)).toBeInTheDocument();
    expect(screen.queryByText(/no message in this channel/i)).not.toBeInTheDocument();
  });

  it("revokes every other session and reports how many ended", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Access");
    await user.click(await screen.findByRole("button", { name: /revoke all sessions/i }));

    await waitFor(() => expect(recorded("POST", "/api/admin/sessions/revoke-all")).toBe(true));
    expect(await screen.findByText(/3 sessions revoked/i)).toBeInTheDocument();
    expect(screen.getByText(/you stay signed in/i)).toBeInTheDocument();
  });

  it("writes the cron switch through the config Save path", async () => {
    const user = userEvent.setup();
    renderAdmin();

    await openTask(user, "Refresh the cache");
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
