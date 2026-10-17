import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { SidebarMode } from "../filters/reducer";
import { IconButton, Sheet } from "./ui";

/** The width at which the sidebar stops fitting beside the charts. */
export const NARROW = "(max-width: 860px)";

/** `matchMedia` in an effect, so a resize (or a rotation) swaps the drawer in. */
export function useNarrow(breakpoint: string): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(breakpoint).matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(breakpoint);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [breakpoint]);

  return narrow;
}

/** Keeping the page still behind the drawer: a scroll-locked body, restored on close. */
function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [locked]);
}

/**
 * A sticky left sidebar holding every filter, and a main column that scrolls
 * beside it (§11.0). Filters are never in a top bar: they stay visible while
 * reading charts, which is the whole point. Below 860px the same sidebar opens
 * as a sheet from a floating button, so the charts keep the full width.
 */
export function AppShell({
  sidebar,
  header,
  children,
  canAdmin = false,
  mode,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
  canAdmin?: boolean;
  /** Opening a card's scope has to open the drawer when the drawer is the sidebar. */
  mode?: SidebarMode;
}) {
  const narrow = useNarrow(NARROW);
  const [open, setOpen] = useState(false);

  // A card's "…" below 860px swaps the sidebar's contents, but the sidebar is
  // inside the drawer: without this the edit happens off-screen.
  useEffect(() => {
    if (narrow && mode?.kind === "scoped") setOpen(true);
  }, [narrow, mode]);

  useScrollLock(narrow && open);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-4 md:flex-row">
      {/* One control that never scrolls away: the way into the filters on a
          phone. It clears the notch and the home indicator via safe-area insets,
          and is 40px so a thumb can hit it. */}
      {narrow ? (
        <IconButton
          label="Filters"
          aria-expanded={open}
          aria-controls="filters"
          onClick={() => setOpen(true)}
          variant="solid"
          className="fixed z-30 h-10 w-10 shadow-lg"
          icon={<SlidersHorizontal size={18} aria-hidden />}
          style={{
            top: "max(0.75rem, env(safe-area-inset-top))",
            right: "max(0.75rem, env(safe-area-inset-right))",
          }}
        />
      ) : null}

      {narrow ? (
        <Sheet open={open} onOpenChange={setOpen} title="Filters">
          {sidebar}
        </Sheet>
      ) : (
        <nav
          id="filters"
          aria-label="Filters"
          className="hidden shrink-0 space-y-4 md:sticky md:top-4 md:block md:h-[calc(100vh-2rem)] md:w-64 md:overflow-y-auto"
        >
          {sidebar}
        </nav>
      )}

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
