import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { listJobs, recalculate } from "../admin/api";
import { Notice } from "../admin/shared";

/**
 * The one control an end-user screen offers for a stale build: queue the
 * rebuild, then watch it so the numbers on the page actually refresh. The old
 * copy said "run: discord-scraper rollups rebuild", which is a shell command,
 * not something anyone reading the dashboard can do.
 */

export const REBUILD_POLL_MS = 5000;
// A full rebuild has taken over three minutes; ~20 minutes of polling is a
// generous ceiling that still ends rather than looping forever on a stuck job.
const MAX_POLLS = 240;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const inFlight = (status: string) => status === "queued" || status === "running";

export function RecalculateNow({ label = "Recalculate now" }: { label?: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const job = await recalculate();
      // The API answers with `already` when this click landed on a rebuild that
      // was queued or running, so the operator is told what really happened.
      setNotice(job.message ?? `Rebuild queued as job #${job.id}.`);
      let status = job.status;
      for (let poll = 0; poll < MAX_POLLS && inFlight(status); poll++) {
        // Check immediately, then wait between polls: the common case (a rebuild
        // that was already nearly done) does not need a five-second delay first.
        if (poll > 0) await sleep(REBUILD_POLL_MS);
        const { jobs } = await listJobs(50);
        status = jobs.find((row) => row.id === job.id)?.status ?? status;
      }
      if (status === "done") {
        setNotice("Rebuild finished — reloading the numbers.");
        await queryClient.invalidateQueries();
      } else if (status === "failed") {
        setError("The rebuild failed. Check the rebuild log in the admin board.");
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? "Rebuilding…" : label}
      </button>
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
