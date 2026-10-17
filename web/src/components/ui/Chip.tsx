import { X } from "lucide-react";

/**
 * A removable label: what a scope is currently doing, stated in words. The
 * remove control owns a name of its own ("Remove 1 of 2 authors"), not "×".
 */
export function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-[11px] text-[var(--color-text)]">
      {label}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          <X size={12} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
