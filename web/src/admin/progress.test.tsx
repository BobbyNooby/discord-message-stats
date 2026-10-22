/**
 * The live rebuild panel: the poll behind it, and the three answers it renders.
 *
 * The fake endpoint speaks the real shape from `progress.py` — one body with
 * the run state, the families, the log and the freshness facts — and honours
 * `since`, so a poll returns only what is new. Time is fake throughout, which
 * is the point: the cadence itself is under test.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FreshnessLine, LiveLog } from "./ProgressView";
import { RefreshCache } from "./RefreshCache";
import type { AdminConfig, AdminStatus, Progress, ProgressFamily, ProgressLogEntry } from "./api";
import type { ReactNode } from "react";

const FAMILIES = [
  "activity",
  "heat",
  "reply",
  "word",
  "link",
  "provider",
  "embed_type",
  "media",
  "emoji",
  "reaction",
  "attachment",
  "response",
  "starter",
  "edit_speed",
  "type",
];

const STATUS: AdminStatus = {
  app: "Discord Scraper",
  channel_id: "c1",
  timezone: "UTC",
  cache_stale: false,
  database: { size_bytes: 0, path: "/tmp/messages.db" },
  admin: { discord_id: "4242", known: true },
  config_hash: "abc123def4567890",
  rollups: {},
  worker: {
    token_status: "ok",
    checked_at: null,
    last_ok_at: null,
    last_ingest_at: null,
    last_ingest_added: null,
    last_seen_at: new Date().toISOString(),
    consecutive_failures: null,
    cron_enabled: "true",
    cron_hours: "6",
  },
  jobs: {},
  sessions: { active: 1 },
  checked_at: "2026-10-15T05:37:00+00:00",
};

function event(id: number, overrides: Partial<ProgressLogEntry> = {}): ProgressLogEntry {
  return {
    id,
    at: "2026-10-15T05:40:00+00:00",
    kind: "run",
    family: null,
    phase: "started",
    message: `event ${id}`,
    ...overrides,
  };
}

function family(name: string, overrides: Partial<ProgressFamily> = {}): ProgressFamily {
  return {
    family: name,
    state: "pending",
    rows: null,
    seconds: null,
    computed_at: null,
    added_since: null,
    stale: true,
    ...overrides,
  };
}

function body(overrides: Partial<Progress> = {}): Progress {
  return {
    running: false,
    abandoned: false,
    started_at: null,
    phase: null,
    families: FAMILIES.map((name) => family(name)),
    log: [],
    totals: { families: 0, rows: 0, seconds: null },
    latest_id: 0,
    last: null,
    freshness: { built_at: null, current: false, added_since: null, newest_message_id: null },
    ...overrides,
  };
}

const RUNNING: Partial<Progress> = {
  running: true,
  started_at: "2026-10-15T05:40:00+00:00",
  phase: "deriving",
};

const FINISHED_LAST = {
  status: "finished",
  finished_at: "2026-10-15T05:37:00+00:00",
  seconds: 164,
  rows: 1000,
  message: "1000 rows rebuilt in 164s",
};

let progressCalls: string[];
let jobsCalls: number;
let progressAnswer: () => Progress;

function response(status: number, payload?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: "OK",
    json: async () => payload,
  } as unknown as Response;
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderCache(status: AdminStatus = STATUS) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <RefreshCache
      status={status}
      stale={false}
      config={null}
      onDirty={() => {}}
      onSave={async () => ({}) as AdminConfig}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  progressCalls = [];
  jobsCalls = 0;
  progressAnswer = () => body();
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.startsWith("/api/admin/progress")) {
        progressCalls.push(url);
        return response(200, progressAnswer());
      }
      if (method === "GET" && url.startsWith("/api/admin/jobs")) {
        jobsCalls += 1;
        return response(200, { jobs: [] });
      }
      if (method === "POST" && url === "/api/admin/recalculate") {
        return response(202, { id: 7, channel_id: "c1", kind: "rebuild_rollups", status: "queued" });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the freshness line", () => {
  it("renders a running, a current and a behind-by-N build", () => {
    // While a run is in flight the endpoint's `last` is null: the build on
    // screen is named by the freshness timestamp instead.
    const running = render(
      <FreshnessLine
        running
        startedAt="2026-10-15T05:40:00+00:00"
        elapsedSeconds={42}
        last={null}
        freshness={{ built_at: "2026-10-15T05:37:00+00:00", current: false, added_since: 3 }}
      />,
    );
    expect(
      screen.getByText(
        "rebuilding now · started 05:40 · 42s elapsed · showing the build from 05:37",
      ),
    ).toBeInTheDocument();
    running.unmount();

    const current = render(
      <FreshnessLine
        running={false}
        startedAt={null}
        elapsedSeconds={null}
        last={FINISHED_LAST}
        freshness={{ built_at: "2026-10-15T05:37:00+00:00", current: true, added_since: 0 }}
      />,
    );
    expect(screen.getByText("built 05:37 · took 164s · current")).toBeInTheDocument();
    current.unmount();

    render(
      <FreshnessLine
        running={false}
        startedAt={null}
        elapsedSeconds={null}
        last={FINISHED_LAST}
        freshness={{ built_at: "2026-10-15T05:37:00+00:00", current: false, added_since: 3 }}
      />,
    );
    expect(
      screen.getByText("built 05:37 · took 164s · behind: 3 new messages"),
    ).toBeInTheDocument();
  });

  it("counts one new message in the singular", () => {
    render(
      <FreshnessLine
        running={false}
        startedAt={null}
        elapsedSeconds={null}
        last={FINISHED_LAST}
        freshness={{ built_at: "2026-10-15T05:37:00+00:00", current: false, added_since: 1 }}
      />,
    );
    expect(screen.getByText("built 05:37 · took 164s · behind: 1 new message")).toBeInTheDocument();
  });
});

describe("the fresh, empty database", () => {
  it("renders the empty shape without crashing and says nothing has run yet", async () => {
    renderCache();
    await flush();

    expect(screen.getByText("nothing has run yet")).toBeInTheDocument();
    expect(screen.getByText(/nothing has happened yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("No rebuild is running.")).toBeInTheDocument();
    expect(screen.getAllByText("pending")).toHaveLength(FAMILIES.length);
    expect(screen.getAllByRole("rowheader")).toHaveLength(FAMILIES.length);
  });
});

describe("a run whose worker died", () => {
  it("says it was abandoned rather than that nothing ran", async () => {
    // The endpoint reports `abandoned` when a process dies between `started`
    // and its finish row. Before this, the board fell through to the idle copy
    // and the operator saw "No rebuild is running." with the cache still stale.
    progressAnswer = () => body({ running: false, abandoned: true });
    renderCache();
    await flush();

    expect(screen.getByText(/stopped partway/i)).toBeInTheDocument();
    expect(screen.queryByText("No rebuild is running.")).toBeNull();
  });
});

describe("the family table", () => {
  it("shows the live state, the rebuilt rows and the time each family took", async () => {
    progressAnswer = () =>
      body({
        ...RUNNING,
        families: FAMILIES.map((name) =>
          name === "activity"
            ? family(name, {
                state: "done",
                rows: 120,
                seconds: 164.2,
                computed_at: "2026-10-15T05:39:00+00:00",
                added_since: 0,
                stale: false,
              })
            : name === "heat"
              ? family(name, { state: "running" })
              : family(name),
        ),
        totals: { families: 1, rows: 120, seconds: 42 },
        latest_id: 4,
      });

    renderCache();
    await flush();

    const activity = screen.getByRole("row", { name: /^activity/i });
    expect(within(activity).getByText("done")).toBeInTheDocument();
    expect(within(activity).getByText("120")).toBeInTheDocument();
    expect(within(activity).getByText("164.2s")).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /^heat/i })).getByText("running"),
    ).toBeInTheDocument();
    expect(screen.getByText(/rebuild in progress/i)).toBeInTheDocument();
    expect(screen.getByText("deriving")).toBeInTheDocument();
    expect(screen.getByText(/Deriving reads every message/i)).toBeInTheDocument();
  });
});

describe("the log", () => {
  it("appends only the events newer than the last id, without refetching the history", async () => {
    let answer = body({
      ...RUNNING,
      latest_id: 10,
      log: [event(10, { message: "rebuild started" }), event(9, { message: "older line" })],
    });
    progressAnswer = () => answer;

    renderCache();
    await flush();
    expect(progressCalls).toEqual(["/api/admin/progress?since=0"]);
    expect(screen.getByText("rebuild started")).toBeInTheDocument();

    answer = body({
      ...RUNNING,
      phase: "writing",
      latest_id: 12,
      log: [
        event(12, { family: "activity", phase: "finished", message: "activity 9681 rows rebuilt" }),
        event(11, { family: "activity", phase: "started", message: "activity writing" }),
      ],
    });
    await flush(1000);

    // The request carried the cursor, and the older lines are still on screen
    // exactly once — appended to, never refetched and duplicated.
    expect(progressCalls).toEqual([
      "/api/admin/progress?since=0",
      "/api/admin/progress?since=10",
    ]);
    expect(screen.getByText("activity 9681 rows rebuilt")).toBeInTheDocument();
    expect(screen.getByText("activity writing")).toBeInTheDocument();
    expect(screen.getAllByText("rebuild started")).toHaveLength(1);
    expect(screen.getByText("older line")).toBeInTheDocument();
  });

  it("keeps the newest line first and labels a run's own events as run", () => {
    render(
      <LiveLog
        entries={[
          event(12, { message: "137121 rows rebuilt in 164.2s" }),
          event(11, { family: "activity", phase: "started", message: "activity started" }),
        ]}
      />,
    );
    const lines = within(screen.getByRole("log")).getAllByRole("listitem");
    expect(lines[0]).toHaveTextContent("137121 rows rebuilt in 164.2s");
    expect(lines[0]).toHaveTextContent("run");
    expect(lines[1]).toHaveTextContent("activity");
  });

  it("shows a failed run as a failure, not as current data", async () => {
    progressAnswer = () =>
      body({
        families: FAMILIES.map((name) => family(name, { state: "failed" })),
        latest_id: 5,
        log: [event(5, { phase: "failed", message: "rebuild failed: discord said no" })],
        last: {
          status: "failed",
          finished_at: "2026-10-15T05:37:00+00:00",
          seconds: 12,
          rows: null,
          message: "rebuild failed: discord said no",
        },
        freshness: {
          built_at: "2026-10-14T20:00:00+00:00",
          current: false,
          added_since: null,
          newest_message_id: "903",
        },
      });

    renderCache();
    await flush();

    const alarm = screen.getByRole("alert");
    expect(alarm).toHaveTextContent("built 05:37 · took 12s · failed");
    expect(alarm).not.toHaveTextContent("current");
    expect(screen.getByText("rebuild failed: discord said no")).toBeInTheDocument();
  });
});

describe("the poll", () => {
  it("polls once a second while running and stops the fast poll when it goes false", async () => {
    let running = true;
    progressAnswer = () => body({ ...RUNNING, running });
    renderCache();
    await flush();
    expect(progressCalls).toHaveLength(1);

    await flush(1000);
    expect(progressCalls).toHaveLength(2);

    running = false;
    await flush(1000);
    expect(progressCalls).toHaveLength(3);
    expect(progressCalls[2]).toBe("/api/admin/progress?since=0");

    // The one-second cadence is gone: nothing arrives over the next four.
    await flush(4000);
    expect(progressCalls).toHaveLength(3);

    // The slow idle poll is what is left.
    await flush(1000);
    expect(progressCalls).toHaveLength(4);
  });

  it("polls immediately when Recalculate is clicked, without waiting for the idle interval", async () => {
    renderCache();
    await flush();
    expect(progressCalls).toHaveLength(1);

    // Four seconds in: the idle poll has not come round yet.
    await flush(4000);
    expect(progressCalls).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /recalculate all/i }));
    await flush();
    expect(progressCalls).toHaveLength(2);

    // Armed fast, so the run's own start is seen the moment it is written.
    await flush(1000);
    expect(progressCalls).toHaveLength(3);
  });

  it("stops polling when the task is closed", async () => {
    progressAnswer = () => body({ ...RUNNING });
    const view = renderCache();
    await flush();
    await flush(1000);
    const seen = progressCalls.length;
    expect(seen).toBeGreaterThanOrEqual(2);

    view.unmount();
    await flush(6000);
    expect(progressCalls).toHaveLength(seen);
  });

  it("refetches the job history once when the run finishes", async () => {
    let running = true;
    progressAnswer = () => body({ ...RUNNING, running });
    renderCache();
    await flush();
    expect(jobsCalls).toBe(1);

    // The job that was queued a moment ago is done now, so the history below
    // the log must not keep saying "queued".
    running = false;
    await flush(1000);
    await flush(100);
    expect(jobsCalls).toBeGreaterThan(1);
  });

  it("does not call the worker offline while a rebuild is running", async () => {
    // A rebuild blocks the worker's loop, so its heartbeat goes stale mid-run.
    vi.setSystemTime(new Date("2026-10-17T20:00:00Z"));
    const stale = {
      ...STATUS,
      worker: { ...STATUS.worker, last_seen_at: "2026-10-17T18:00:00+00:00" },
    };

    progressAnswer = () => body({ ...RUNNING });
    const running = renderCache(stale);
    await flush();
    expect(screen.getByText(/rebuild in progress/i)).toBeInTheDocument();
    expect(screen.queryByText(/worker offline/i)).not.toBeInTheDocument();
    running.unmount();

    progressAnswer = () => body();
    renderCache(stale);
    await flush();
    expect(screen.getByText(/worker offline/i)).toBeInTheDocument();
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  push(entry: ProgressLogEntry) {
    act(() => this.onmessage?.({ data: JSON.stringify(entry) }));
  }
}

describe("the live stream", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  it("opens after the first poll, from where the poll left off", async () => {
    progressAnswer = () => body({ log: [event(4)], latest_id: 4 });
    renderCache();
    await flush();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/admin/logs/stream?since=4");
  });

  it("shows a streamed line at once, says it is live, and never shows a line twice", async () => {
    renderCache();
    await flush();
    const stream = FakeEventSource.instances[0];
    act(() => stream.onopen?.());
    expect(screen.getByText(/live — lines appear as the worker writes them/)).toBeInTheDocument();

    stream.push(event(9, { message: "streamed line" }));
    expect(within(screen.getByRole("log")).getByText("streamed line")).toBeInTheDocument();

    // The next poll carries the same line; the panel still shows it once.
    progressAnswer = () => body({ log: [event(9, { message: "streamed line" })], latest_id: 9 });
    await flush(5000);
    expect(within(screen.getByRole("log")).getAllByText("streamed line")).toHaveLength(1);
  });

  it("closes the stream when the task is closed", async () => {
    const view = renderCache();
    await flush();
    view.unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});

describe("the queued confirmation", () => {
  it("names the job while it is still waiting to be picked up", async () => {
    progressAnswer = () => body();
    renderCache();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: /recalculate all/i }));
    await flush();

    expect(screen.getByText(/rebuild queued as job #7 \(queued\)/i)).toBeInTheDocument();
  });

  it("gives way to the live panel once the run is visible, and does not come back", async () => {
    progressAnswer = () => body();
    renderCache();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: /recalculate all/i }));
    await flush();
    expect(screen.getByText(/rebuild queued as job #7/i)).toBeInTheDocument();

    // The run appears: the panel's own line is the honest answer now, so the
    // click-time string must not sit beside it still claiming "queued".
    progressAnswer = () => body({ ...RUNNING, last: null });
    await flush(1000);
    expect(screen.getByText(/rebuild in progress/i)).toBeInTheDocument();
    expect(screen.queryByText(/rebuild queued as job #7/i)).not.toBeInTheDocument();

    // And once it is done, the finished line stands alone — the stale copy
    // does not reappear.
    progressAnswer = () =>
      body({
        last: FINISHED_LAST,
        freshness: {
          built_at: "2026-10-15T05:37:00+00:00",
          current: true,
          added_since: 0,
          newest_message_id: "903",
        },
      });
    await flush(1000);
    expect(screen.queryByText(/rebuild queued as job #7/i)).not.toBeInTheDocument();
    expect(screen.getByText("built 05:37 · took 164s · current")).toBeInTheDocument();
  });
});
