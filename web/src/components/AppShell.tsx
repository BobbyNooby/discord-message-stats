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
}: {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-4 md:flex-row">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="filters"
        onClick={() => setOpen((value) => !value)}
        className="rounded border border-[var(--color-line)] px-3 py-2 text-xs md:hidden"
      >
        {open ? "Hide filters" : "Filters"}
      </button>
      <nav
        id="filters"
        aria-label="Filters"
        className={`${open ? "block" : "hidden"} shrink-0 space-y-4 md:sticky md:top-4 md:block md:h-[calc(100vh-2rem)] md:w-64 md:overflow-y-auto`}
      >
        {sidebar}
      </nav>
      <div className="min-w-0 flex-1 space-y-4">
        <header className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--color-muted)]">
          {header}
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
