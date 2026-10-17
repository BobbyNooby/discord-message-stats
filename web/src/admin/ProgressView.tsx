/**
 * What the rebuild is doing, and whether what the board shows is current.
 *
 * Three pieces, because they answer three different questions and belong in
 * three different places: the freshness line sits with the cache warning ("is
 * this the latest?"), the now line sits by the button ("is the long wait
 * working?"), and the log is the evidence underneath it.
 *
 * Nothing here invents per-family progress during the derive phase. All the
 * families' `started` events are written as one group when the write phase
 * opens, so during derive the honest answer is `phase:"deriving"` plus elapsed
 * time — a per-family bar would be a lie.
 */

import type { ProgressFamily, ProgressLast, ProgressLogEntry } from "./api";
import { Notice } from "./shared";

/** "05:37" — the clock half of a freshness answer, in the stamp's own wall time. */
export function formatClock(stamp: string | null | undefined): string {
  if (!stamp) return "—";
  const parsed = Date.parse(stamp);
  if (Number.isNaN(parsed)) return stamp;
  return new Date(parsed).toISOString().slice(11, 16);
}

/** "164.2s" / "42s" — seconds as the build reports them, not rounded away. */
export function formatSeconds(value: number | null | undefined): string {
  if (typeof value !== "number") return "—";
  return Number.isInteger(value) ? `${value}s` : `${value.toFixed(1)}s`;
}

export type FreshnessFacts = {
  running: boolean;
  startedAt: string | null;
  elapsedSeconds: number | null;
  last: ProgressLast | null;
  freshness: { built_at: string | null; current: boolean; added_since: number | null };
};

/**
 * The one line the owner asked for: "is this the latest?".
 *
 * While a run is going it must not read `current` — the rows on screen are the
 * previous build and are being replaced — so it says what is running and which
 * build is still on display.
 */
export function freshnessLine({
  running,
  startedAt,
  elapsedSeconds,
  last,
  freshness,
}: FreshnessFacts): string {
  if (running) {
    const parts = ["rebuilding now", `started ${formatClock(startedAt)}`];
    if (typeof elapsedSeconds === "number") parts.push(`${formatSeconds(elapsedSeconds)} elapsed`);
    // `last` is null while a run is in flight — the newest run event is
    // `started` — so the build actually on screen is named by the rollup
    // provenance timestamp, which is still the previous build until the write
    // transaction commits.
    const shown = last?.finished_at ?? freshness.built_at;
    if (shown) parts.push(`showing the build from ${formatClock(shown)}`);
    return parts.join(" · ");
  }
  const builtAt = last?.finished_at ?? freshness.built_at;
  if (!builtAt) return "nothing has run yet";
  const parts = [`built ${formatClock(builtAt)}`];
  if (last && typeof last.seconds === "number") parts.push(`took ${formatSeconds(last.seconds)}`);
  if (last?.status === "failed") {
    parts.push("failed");
  } else if (freshness.current) {
    parts.push("current");
  } else if (typeof freshness.added_since === "number" && freshness.added_since > 0) {
    const n = freshness.added_since;
    parts.push(`behind: ${n} new ${n === 1 ? "message" : "messages"}`);
  } else {
    parts.push("stale");
  }
  return parts.join(" · ");
}

/** The freshness answer, coloured: green current, amber behind, red failed. */
export function FreshnessLine(facts: FreshnessFacts) {
  const tone = facts.running
    ? "info"
    : facts.last?.status === "failed"
      ? "error"
      : !facts.last && !facts.freshness.built_at
        ? "info"
        : facts.freshness.current
          ? "ok"
          : "warn";
  return <Notice tone={tone}>{freshnessLine(facts)}</Notice>;
}

/** "deriving · 42s elapsed" — proof the wait is work, not a frozen button. */
export function NowLine({
  running,
  abandoned = false,
  phase,
  startedAt,
  elapsedSeconds,
  loading = false,
}: {
  running: boolean;
  /** A run whose worker died: not running, but not "nothing happened" either. */
  abandoned?: boolean;
  phase: string | null;
  startedAt: string | null;
  elapsedSeconds: number | null;
  loading?: boolean;
}) {
  if (!running) {
    if (abandoned) {
      return (
        <p role="status" className="text-xs text-amber-200">
          A rebuild stopped partway — the worker died before it finished, so the numbers are still
          the previous build. Queue another to finish it.
        </p>
      );
    }
    return (
      <p role="status" className="text-xs text-[var(--color-muted)]">
        {loading ? "Checking whether a rebuild is running…" : "No rebuild is running."}
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p role="status" className="flex flex-wrap items-baseline gap-2 text-xs">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400"
        />
        <span>Rebuild in progress</span>
        <span className="text-[var(--color-muted)]">
          phase <strong className="text-[var(--color-text)]">{phase ?? "starting"}</strong>
        </span>
        <span className="text-[var(--color-muted)]">
          <strong className="text-[var(--color-text)]">{formatSeconds(elapsedSeconds)}</strong>{" "}
          elapsed
        </span>
        <span className="text-[var(--color-muted)]">started {formatClock(startedAt)}</span>
      </p>
      {phase === "deriving" ? (
        <p className="text-[11px] text-[var(--color-muted)]">
          Deriving reads every message; the per-family rows appear together when writing starts.
        </p>
      ) : null}
    </div>
  );
}

/** The events, newest first, in a fixed-height scroller. */
export function LiveLog({ entries }: { entries: ProgressLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p
        role="status"
        className="rounded border border-dashed border-[var(--color-line)] px-3 py-4 text-xs text-[var(--color-muted)]"
      >
        Nothing has happened yet — a rebuild writes its first line here when it starts.
      </p>
    );
  }
  return (
    <ol
      role="log"
      aria-label="Rebuild log"
      aria-live="polite"
      className="max-h-64 overflow-y-auto rounded border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-xs"
    >
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex gap-2 border-b border-[var(--color-line)]/40 py-1 last:border-b-0"
        >
          <time className="shrink-0 tabular-nums text-[var(--color-muted)]">
            {formatClock(entry.at)}
          </time>
          <span className="w-24 shrink-0 truncate font-medium" title={entry.family ?? "run"}>
            {entry.family ?? "run"}
          </span>
          <span className="w-16 shrink-0 text-[var(--color-muted)]">{entry.phase ?? "—"}</span>
          <span className="min-w-0 flex-1">{entry.message ?? "—"}</span>
        </li>
      ))}
    </ol>
  );
}

/** One family's row: the live run's facts plus the provenance from `/status`. */
export type FamilyProgress = {
  family: string;
  /** Null only when the progress endpoint has not answered yet. */
  state: ProgressFamily["state"] | null;
  rows: number | null;
  seconds: number | null;
  computed_at: string | null;
  added_since: number | null;
  stale: boolean;
};

/**
 * The live family facts, joined to the provenance the status endpoint carries.
 * Progress wins where both answer — it is the run that is happening now — and
 * /status fills in what only the last build knows (what it was built from).
 */
export function mergeFamilies(
  families: ProgressFamily[] | null,
  rollups: Record<
    string,
    { rows: number; stale: boolean; computed_at: string | null; added_since: number | null }
  >,
): FamilyProgress[] {
  const names = families?.length ? families.map((entry) => entry.family) : Object.keys(rollups);
  return names.map((family) => {
    const live = families?.find((entry) => entry.family === family);
    const built = rollups[family];
    return {
      family,
      state: live?.state ?? null,
      rows: live?.rows ?? built?.rows ?? null,
      seconds: live?.seconds ?? null,
      computed_at: live?.computed_at ?? built?.computed_at ?? null,
      added_since: live?.added_since ?? built?.added_since ?? null,
      stale: live?.stale ?? built?.stale ?? true,
    };
  });
}
