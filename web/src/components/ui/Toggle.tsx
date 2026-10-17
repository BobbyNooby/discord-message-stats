import type { ReactNode } from "react";

/**
 * A two-state control (bars / pie, newest / oldest). One button carrying
 * `aria-pressed`, so its state is readable by a screen reader rather than only
 * by which icon happens to be showing.
 *
 * `icons` and `labels` may hold one entry (the state is stated by the action)
 * or two, one per state.
 */
export function Toggle({
  pressed,
  onPressedChange,
  icons,
  labels,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  icons: ReactNode[];
  labels: string[];
}) {
  const index = pressed ? 1 : 0;
  const label = labels[index] ?? labels[0] ?? "Toggle";
  const icon = icons[index] ?? icons[0];
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={() => onPressedChange(!pressed)}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-text)] aria-pressed:border-[var(--color-accent)] aria-pressed:text-[var(--color-text)]"
    >
      {icon}
    </button>
  );
}
