import {
  ArrowUp,
  CalendarClock,
  Image,
  LayoutDashboard,
  Link2,
  Smile,
  Type,
  Users,
} from "lucide-react";

import { useReducedMotion } from "../lib/motion";

/**
 * The seven sections, and a way back to the top.
 *
 * The page is long enough that scrolling from "Overview" to "Media" is a chore,
 * and the six section headings are the only landmarks. The strip scrolls
 * sideways inside itself on a phone rather than widening the page: at 390px it
 * is the nav that moves, not the document.
 */
export const SECTIONS = [
  { id: "sec-overview", label: "Overview", icon: LayoutDashboard },
  { id: "sec-time", label: "Time", icon: CalendarClock },
  { id: "sec-people", label: "People", icon: Users },
  { id: "sec-words", label: "Words", icon: Type },
  { id: "sec-links", label: "Links", icon: Link2 },
  { id: "sec-media-rich", label: "Rich media", icon: Image },
  { id: "sec-media", label: "Media", icon: Smile },
] as const;

export function JumpNav() {
  const reduced = useReducedMotion();

  return (
    // The bar floats clear of the very top of the viewport: the wrapper is
    // sticky, and its padding-top is the offset. The wrapper wears the page
    // background, so the gap is page surface, not content scrolling through.
    // `top: 0` (not `top: offset`) is what puts the background above the bar
    // rather than letting content show in the gap.
    // The wrapper's trailing padding is the phone's clearance for the floating
    // Filters button, kept outside the strip: padding inside a strip that
    // scrolls sideways scrolls away with it, so the button sat on top of
    // "Links". The breakpoint is AppShell's NARROW, where the button appears.
    <div
      className="sticky top-0 z-20 bg-[var(--color-ink)] pr-12 min-[861px]:pr-0"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      {/* No inline padding of its own: the column the headings and cards sit in
          has none, so a left inset would start the bar's content inside that
          column while the cards start on its edge. */}
      <nav
        aria-label="Sections"
        className="flex items-center gap-1 overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)]/95 py-1 text-xs backdrop-blur"
      >
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[var(--color-muted)] hover:text-[var(--color-text)]"
            >
              <Icon size={14} aria-hidden />
              {section.label}
            </a>
          );
        })}
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })}
          className="ml-auto flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          <ArrowUp size={14} aria-hidden />
          Top
        </button>
      </nav>
    </div>
  );
}
