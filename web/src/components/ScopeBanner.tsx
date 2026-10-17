import { Banner } from "./ui";

/**
 * The one place the sidebar says which card it is filtering. It stays put for
 * as long as the scope is open, so a scoped sidebar can never be mistaken for
 * the global one, and it carries the two actions that leave the scope: commit
 * the draft, or go back to global.
 */
export function ScopeBanner({
  panelLabel,
  onApply,
  onBack,
  dirty,
  pruned,
}: {
  panelLabel: string;
  onApply: () => void;
  onBack: () => void;
  dirty: boolean;
  /** What storage held that the payload no longer has, dropped on load. */
  pruned?: string;
}) {
  return (
    <div className="space-y-2">
      <Banner
        tone="info"
        action={
          <>
            <button
              type="button"
              onClick={onApply}
              disabled={!dirty}
              className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)]/25 px-2 py-1 text-[11px] text-[var(--color-text)] disabled:cursor-not-allowed disabled:border-[var(--color-line)] disabled:bg-transparent disabled:text-[var(--color-muted)]"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded border border-[var(--color-line)] px-2 py-1 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            >
              Back to global
            </button>
          </>
        }
      >
        <span className="font-semibold">Filter for {panelLabel}</span>
        {dirty ? (
          <span className="ml-2 text-[10px] uppercase tracking-wider">unapplied changes</span>
        ) : null}
      </Banner>
      {pruned ? (
        <Banner tone="warn">
          Pruned from saved filters: {pruned}. The rebuilt data no longer has those, so they
          were dropped rather than filtering this card to nothing.
        </Banner>
      ) : null}
    </div>
  );
}
