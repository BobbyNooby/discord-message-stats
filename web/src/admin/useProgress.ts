/**
 * The live poll behind "Refresh the cache".
 *
 * A rebuild of this database takes minutes, and the endpoint is built to be
 * asked often: one response carries the run state, every family and the newest
 * events at once. `since` is the id of the newest event already seen, so a poll
 * during a quiet stretch re-reads nothing — the panel appends the events that
 * are new and never refetches the history.
 *
 * Polling lives and dies with the task being open, because the hook only runs
 * while its component is mounted.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { getProgress, type Progress, type ProgressLogEntry } from "./api";

/** A run under way is worth a second's lag on the elapsed line. */
export const RUNNING_MS = 1000;
/** Idle: "is this the latest?" still moves, but slowly. */
export const IDLE_MS = 5000;
/**
 * The worker only picks a queued job up on its next 15 s pass. Polling fast for
 * a window after Recalculate is pressed is what makes a run appear as soon as
 * it starts instead of up to a slow interval later.
 */
export const EAGER_MS = 20000;
/** `rebuild_events` holds 200 rows per run; a longer panel is only noise. */
export const LOG_LIMIT = 200;

export type ProgressFeed = {
  /** The newest body: run state, families, totals and freshness in one. */
  data: Progress | null;
  /** Every event seen so far, newest first, capped at `LOG_LIMIT`. */
  log: ProgressLogEntry[];
  error: Error | null;
  loading: boolean;
  /** Ask now and keep the fast cadence until the run shows or the window ends. */
  kick: () => void;
};

export function useProgress(): ProgressFeed {
  const [data, setData] = useState<Progress | null>(null);
  const [log, setLog] = useState<ProgressLogEntry[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const sinceRef = useRef(0);
  const seenRef = useRef<Set<number>>(new Set());
  const eagerUntilRef = useRef(0);
  // Bumped by `kick()`: restarting the effect both fetches at once and retimes
  // the loop, which is how a click starts the feed without a stale flag.
  const [round, setRound] = useState(0);

  const kick = useCallback(() => {
    eagerUntilRef.current = Date.now() + EAGER_MS;
    setRound((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule(delay: number) {
      if (cancelled) return;
      const fast = Date.now() < eagerUntilRef.current;
      timer = setTimeout(poll, fast ? RUNNING_MS : delay);
    }

    async function poll() {
      try {
        const body = await getProgress(sinceRef.current);
        if (cancelled) return;
        sinceRef.current = Math.max(sinceRef.current, body.latest_id);
        // Ids, not positions: a kick can overlap the poll already in flight,
        // and the same event must never land in the panel twice.
        const arrived = body.log.filter((entry) => !seenRef.current.has(entry.id));
        for (const entry of arrived) seenRef.current.add(entry.id);
        setData(body);
        if (arrived.length > 0) {
          setLog((current) => [...arrived, ...current].slice(0, LOG_LIMIT));
        }
        setError(null);
        setLoading(false);
        schedule(body.running ? RUNNING_MS : IDLE_MS);
      } catch (failure) {
        if (cancelled) return;
        setError(failure as Error);
        setLoading(false);
        schedule(IDLE_MS);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [round]);

  return { data, log, error, loading, kick };
}
