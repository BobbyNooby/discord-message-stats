/**
 * The one line the first-run screen shows about what is happening now.
 *
 * Read from `/api/setup` only: the newest scrape or rebuild job, and how many
 * messages have arrived. The worker writes no per-batch progress for a scrape,
 * so the stored count is the honest figure while one runs.
 */

import type { AdminSetup } from "../api/client";

export type SetupStep = {
  tone: "info" | "warn" | "error";
  text: string;
  /** "build": messages are in and nothing is building them — offer the rebuild. */
  action?: "build";
};

const inFlight = (status: string) => status === "queued" || status === "running";

export function setupProgress(setup: AdminSetup): SetupStep | null {
  const count = setup.messages.toLocaleString();
  const job = setup.job && setup.job.status !== "cancelled" ? setup.job : null;
  const rebuild = job?.kind === "rebuild_rollups";

  if (job && inFlight(job.status)) {
    if (rebuild) {
      return job.status === "queued"
        ? { tone: "info", text: `Building the stats from ${count} messages — queued; it waits for the worker's next pass.` }
        : { tone: "info", text: `Building the stats from ${count} messages${job.phase ? ` — ${job.phase}` : ""}…` };
    }
    return job.status === "queued"
      ? { tone: "info", text: "Scrape queued — it waits for the worker's next pass, about 15 seconds." }
      : {
          tone: "info",
          text: `Scraping… ${count} messages so far. It reads newest first, and the stats build once it reaches the start of the channel.`,
        };
  }
  if (job?.status === "failed") {
    return {
      tone: "error",
      text: `${rebuild ? "Building the stats failed" : "The scrape failed"}: ${job.error ?? "no reason given"}`,
    };
  }
  if (setup.messages > 0) {
    return { tone: "info", text: `${count} messages are in, but the stats have not been built from them yet.`, action: "build" };
  }
  if (job?.status === "done") {
    return {
      tone: "warn",
      text: "The scrape finished but found no messages. Check the channel id, and that the token can read that channel.",
    };
  }
  return null;
}
