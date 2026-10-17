/**
 * Bits shared by the admin tasks: the section frames, the two save buttons,
 * notices, and the small formatters.
 *
 * The two save buttons are deliberately one component. §11.6's rule is that
 * **saving always marks the cache stale, even when it does not rebuild** — a
 * single place to render the pair keeps a section from quietly offering only
 * one of them.
 */

import type { ReactNode } from "react";

export type SaveMode = "only" | "recalculate";

/** A task's own heading: the four things the board is for (§11.6). */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} className="text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A card inside a task: merge, search, worker health, and so on. */
export function SubSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h3 id={headingId} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error" | "ok";
  children: ReactNode;
}) {
  const styles: Record<string, string> = {
    info: "border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-muted)]",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    error: "border-red-500/40 bg-red-500/10 text-red-200",
    ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  };
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded border px-3 py-2 text-xs ${styles[tone]}`}
    >
      {children}
    </p>
  );
}

/**
 * Both save buttons, always together. `onSave` receives which one was pressed;
 * the caller writes the config, and only `recalculate` enqueues a rebuild.
 */
export function SaveBar({
  onSave,
  busy = false,
  disabled = false,
}: {
  onSave: (mode: SaveMode) => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => onSave("recalculate")}
        className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        Save &amp; recalculate
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => onSave("only")}
        className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-50"
      >
        Save only
      </button>
      <span className="text-[11px] text-[var(--color-muted)]">
        Saving marks the cache stale; only <em>Save &amp; recalculate</em> queues the rebuild.
      </span>
    </div>
  );
}

export function DefList({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">{children}</dl>;
}

export function Def({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 border-b border-[var(--color-line)]/50 py-1">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

export function formatStamp(stamp: string | null | undefined): string {
  if (!stamp) return "never";
  const parsed = Date.parse(stamp);
  if (Number.isNaN(parsed)) return stamp;
  return new Date(parsed).toISOString().slice(0, 16).replace("T", " ");
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

export function formatDay(day: string | null | undefined): string {
  return day && day.length ? day : "—";
}

/** The worker polls every 15 s; three missed polls means it is not running (§10.8). */
const POLL_SECONDS = 15;

export function workerOffline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return true;
  const seen = Date.parse(lastSeenAt);
  if (Number.isNaN(seen)) return true;
  return Date.now() - seen > 3 * POLL_SECONDS * 1000;
}
