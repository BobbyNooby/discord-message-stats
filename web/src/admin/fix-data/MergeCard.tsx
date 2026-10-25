import type { Ref } from "react";

import type { Absorb, Merge, MergeDirectory } from "./merges";

/** One merged person: its alts as removable chips, and a picker to add another. */
export function MergeCard({
  merge,
  people,
  saving,
  alt,
  onAltChange,
  onAddAlt,
  onRemoveAlt,
}: {
  merge: Merge;
  people: MergeDirectory;
  saving: boolean;
  /** The account chosen in this card's "add an alt" picker, or "". */
  alt: string;
  onAltChange: (account: string) => void;
  onAddAlt: () => void;
  onRemoveAlt: (account: string) => void;
}) {
  const { label, chipLabel, available, headsAnIdentity, altsOf } = people;
  return (
    <article className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h3 className="text-sm font-semibold">{label(merge.canonical)}</h3>
      <p className="text-[11px] text-[var(--color-muted)]">
        canonical {merge.canonical} · {merge.members.length + 1} accounts
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {merge.members.map((member) => (
          <li key={member}>
            <button
              type="button"
              onClick={() => onRemoveAlt(member)}
              disabled={saving}
              aria-label={`Remove alt ${label(member)} (${member})`}
              className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] disabled:opacity-50"
            >
              {chipLabel(member)} ×
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label
            htmlFor={`add-alt-${merge.canonical}`}
            className="block text-[11px] text-[var(--color-muted)]"
          >
            Add an alt account to {label(merge.canonical)}
          </label>
          <select
            id={`add-alt-${merge.canonical}`}
            value={alt}
            onChange={(event) => onAltChange(event.target.value)}
            className="mt-1 rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
          >
            <option value="">Choose an account…</option>
            {available
              .filter((account) => account !== merge.canonical)
              .filter((account) => !merge.members.includes(account))
              .map((account) => (
                <option key={account} value={account}>
                  {label(account)} ({account})
                  {headsAnIdentity(account)
                    ? ` — brings ${altsOf(account).length} ${
                        altsOf(account).length === 1 ? "alt" : "alts"
                      }`
                    : ""}
                </option>
              ))}
          </select>
        </div>
        <button
          type="button"
          onClick={onAddAlt}
          disabled={saving || !alt}
          className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-50"
        >
          + add alt
        </button>
      </div>
    </article>
  );
}

/**
 * Adding an account that heads an identity of its own drags its alts along, so
 * the operator says so first. Inline rather than a modal; the caller focuses the
 * confirm button so a screen reader hears it appear.
 */
export function AbsorbConfirm({
  absorbing,
  people,
  saving,
  confirmRef,
  onConfirm,
  onCancel,
}: {
  absorbing: Absorb;
  people: MergeDirectory;
  saving: boolean;
  confirmRef: Ref<HTMLButtonElement>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { label, chipLabel, altsOf } = people;
  return (
    <section
      role="alertdialog"
      aria-labelledby="absorb-heading"
      className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
    >
      <p id="absorb-heading">
        <strong>{label(absorbing.account)}</strong> will be merged into{" "}
        <strong>{label(absorbing.canonical)}</strong>, including its{" "}
        {altsOf(absorbing.account).length === 1 ? "alt" : "alts"}{" "}
        {altsOf(absorbing.account)
          .map((alt) => chipLabel(alt))
          .join(", ")}{" "}
        ({altsOf(absorbing.account).length}{" "}
        {altsOf(absorbing.account).length === 1 ? "account" : "accounts"}) —{" "}
        {altsOf(absorbing.account).length + 1} accounts move in all.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          ref={confirmRef}
          onClick={onConfirm}
          disabled={saving}
          className="rounded border border-amber-400/60 px-3 py-1.5 disabled:opacity-50"
        >
          Confirm merge
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded border border-[var(--color-line)] px-3 py-1.5 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
