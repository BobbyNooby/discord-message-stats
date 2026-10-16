import { useState, type ReactNode } from "react";

/**
 * A sticky left sidebar holding every filter, and a main column that scrolls
 * beside it (§11.0). Filters are never in a top bar: they stay visible while
 * reading charts, which is the whole point. Under ~860px the sidebar becomes a
 * static block above the content, reachable through one toggle.
 */
export function AppShell({
  sidebar,
  header,
  children,
  canAdmin = false,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
  canAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-4 md:flex-row">
      {/* One bar that never scrolls away: the way into the filters on a phone,
          and the way into the admin board on both. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="filters"
        onClick={() => setOpen(true)}
        className="sticky top-0 z-30 rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-xs md:hidden"
      >
        Filters
      </button>

      {/* Mobile: a drawer over the page, with its own scroll and a way out. A
          block in the flow pushed the charts down and could not be dismissed
          without scrolling back to the top. */}
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          {/* The scrim dismisses, but it is not a second control called
              "Close filters": two elements with one name is a bug for anyone
              driving the page by name (and for a click aimed at the panel). */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/60"
          />
          <div className="absolute inset-y-0 left-0 w-[86%] max-w-sm overflow-y-auto bg-[var(--color-ink)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Filters</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-[var(--color-line)] px-2 py-1 text-xs"
              >
                Close
              </button>
            </div>
            {sidebar}
          </div>
        </div>
      ) : null}

      <nav
        id="filters"
        aria-label="Filters"
        className="hidden shrink-0 space-y-4 md:sticky md:top-4 md:block md:h-[calc(100vh-2rem)] md:w-64 md:overflow-y-auto"
      >
        {sidebar}
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        <header className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--color-muted)]">
          <div className="flex flex-wrap items-baseline gap-3">
            {header}
            {canAdmin ? (
              <a href="/admin" className="rounded border border-[var(--color-line)] px-2 py-0.5">
                Admin
              </a>
            ) : null}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        {label}
      </h2>
      {children}
    </section>
  );
}

export function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`rounded border px-2 py-0.5 text-[11px] ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-[var(--color-text)]"
          : "border-[var(--color-line)] text-[var(--color-muted)]"
      }`}
    >
      {children}
    </button>
  );
}
