import { Ellipsis } from "lucide-react";
import type { ReactNode } from "react";

import { usePanelScopeTarget } from "../panels/panelScope";
import { specFor, specForLabel, type PanelId } from "../panels/registry";
import { IconButton } from "./ui";

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
  panelId,
}: {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  /** When the title is dynamic ("Who says “cat”"), name the card explicitly. */
  panelId?: PanelId;
}) {
  const onOpenScope = usePanelScopeTarget();
  // The registry decides whether a card can be scoped, not a prop or a guess
  // from the title: "…" exists iff the card honours at least one dimension. A
  // dynamic title names its card explicitly; a static one is looked up by title.
  const spec = panelId ? specFor(panelId) : specForLabel(title);
  const target = spec && spec.honours.length > 0 ? spec : null;

  return (
    <section
      className={`mb-4 break-inside-avoid rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 ${className ?? ""}`}
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="min-w-0 text-sm font-semibold tracking-wide text-[var(--color-text)]">
          {title}
        </h2>
        {/* The actions wrap too: "Most reposted" is a tab strip plus a badge plus
            the "…" trigger, which is wider than a 390px card on its own. */}
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          {badge}
          {onOpenScope && target ? (
            <IconButton
              label={`Filter ${target.label}`}
              icon={<Ellipsis size={16} aria-hidden />}
              onClick={() => onOpenScope(target.id)}
            />
          ) : null}
        </span>
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
