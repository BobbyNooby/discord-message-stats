import type { ReactNode } from "react";

/**
 * Sections lay their cards out in columns, not grid rows.
 *
 * A grid row makes every card as tall as the tallest in it, so a two-series bar
 * chart sat in a box sized for a calendar — dead space under one card, a clipped
 * chart in another. Columns let each card be exactly as tall as its own content.
 */
export const CARD_COLUMNS = "columns-1 gap-4 lg:columns-2 xl:columns-3";

/** The card + header + subtitle + badge wrapper every chart sits in (§11.0). */
export function Panel({
  title,
  subtitle,
  badge,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`mb-4 break-inside-avoid rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 ${className ?? ""}`}
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-[var(--color-text)]">{title}</h2>
        {badge}
      </header>
      {subtitle ? (
        <p className="mb-3 text-xs text-[var(--color-muted)]">{subtitle}</p>
      ) : null}
      {children}
    </section>
  );
}

/** A panel whose dimension cannot honour one of the active filters says so. */
export function GlobalOnlyBadge({ what }: { what: string }) {
  return (
    <span
      className="rounded border border-[var(--color-line)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]"
      title={`${what} has no date dimension, so the time filter does not apply`}
    >
      global only
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="flex h-[120px] items-center justify-center text-xs text-[var(--color-muted)]">
      {children}
    </p>
  );
}
