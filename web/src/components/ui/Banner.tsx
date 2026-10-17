import type { ReactNode } from "react";

const TONES = {
  info: "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/15 text-[var(--color-text)]",
  warn: "border-amber-500/60 bg-amber-500/15 text-amber-100",
  danger: "border-red-500/60 bg-red-500/15 text-red-100",
} as const;

/**
 * One line of state the reader must not miss — which card a filter belongs to,
 * what was pruned from storage, that a save failed. `role="status"` so it is
 * announced rather than only drawn.
 */
export function Banner({
  tone,
  children,
  action,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      data-tone={tone}
      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${TONES[tone]}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
