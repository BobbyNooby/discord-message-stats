import { describe, expect, it } from "vitest";

import type { AdminSetup, SetupJob } from "../api/client";
import { setupProgress } from "./progress";

const job = (patch: Partial<SetupJob>): SetupJob => ({
  id: 1,
  kind: "catch_up",
  status: "queued",
  phase: null,
  requested_at: "2026-11-04T10:00:00+00:00",
  started_at: null,
  finished_at: null,
  result: null,
  error: null,
  ...patch,
});

const fresh: AdminSetup = {
  needed: true,
  can_admin: true,
  channel_id: "c1",
  messages: 0,
  rollups_built: false,
  worker_seen_at: null,
  job: null,
};

describe("the first-run progress line", () => {
  it("says nothing before anything has been started", () => {
    expect(setupProgress(fresh)).toBeNull();
  });

  it("says a queued scrape waits for the worker's next pass", () => {
    expect(setupProgress({ ...fresh, job: job({}) })?.text).toMatch(/waits for the worker/);
  });

  it("counts the messages a running scrape has stored so far", () => {
    const step = setupProgress({ ...fresh, messages: 12345, job: job({ status: "running" }) });
    expect(step?.tone).toBe("info");
    expect(step?.text).toContain("12,345 messages so far");
  });

  it("names the rebuild and its phase once the scrape hands over", () => {
    const step = setupProgress({
      ...fresh,
      messages: 500,
      job: job({ kind: "rebuild_rollups", status: "running", phase: "deriving" }),
    });
    expect(step?.text).toContain("Building the stats from 500 messages");
    expect(step?.text).toContain("deriving");
  });

  it("shows a failed scrape with the server's reason", () => {
    const step = setupProgress({
      ...fresh,
      job: job({ status: "failed", error: "AuthError: 403 Missing Access" }),
    });
    expect(step).toEqual({ tone: "error", text: "The scrape failed: AuthError: 403 Missing Access" });
  });

  it("tells a scrape that found nothing apart from one still to run", () => {
    const step = setupProgress({
      ...fresh,
      rollups_built: true,
      job: job({ kind: "rebuild_rollups", status: "done" }),
    });
    expect(step?.tone).toBe("warn");
    expect(step?.text).toMatch(/found no messages/);
  });

  it("offers the build when messages are in and nothing is running", () => {
    const step = setupProgress({ ...fresh, messages: 80 });
    expect(step?.action).toBe("build");
    expect(step?.text).toContain("80 messages are in");
  });

  it("treats a cancelled job as no job at all", () => {
    expect(setupProgress({ ...fresh, job: job({ status: "cancelled" }) })).toBeNull();
  });
});
