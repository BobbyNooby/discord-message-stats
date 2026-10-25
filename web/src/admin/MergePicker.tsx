import type { Author } from "../api/types";
import { normalise, type MergeDirectory } from "./merges";
import { Notice } from "./shared";

export type NameChoice = "a" | "b" | "custom";

/** What the picker shows: the two picks, who they belong to, and whose name wins. */
export type Picks = {
  pickA: string;
  pickB: string;
  identityA: string;
  identityB: string;
  alreadyOne: boolean;
  /** The radio that is on: the operator's, or the busier identity by default. */
  choice: NameChoice;
  /** The operator's own choice, or null before they make one. */
  nameChoice: NameChoice | null;
  customName: string;
  winnerName: string;
};

/**
 * "Merge two accounts": pick any two, choose which display name wins or type
 * one, and see what the merge will move before it is written.
 */
export function MergePicker({
  people,
  identities,
  picks,
  saving,
  canUndo,
  onPickA,
  onPickB,
  onNameChoice,
  onCustomName,
  onMerge,
  onUndo,
}: {
  people: MergeDirectory;
  identities: Author[];
  picks: Picks;
  saving: boolean;
  canUndo: boolean;
  onPickA: (account: string) => void;
  onPickB: (account: string) => void;
  onNameChoice: (choice: NameChoice) => void;
  onCustomName: (name: string) => void;
  onMerge: () => void;
  onUndo: () => void;
}) {
  const { label, chipLabel, membersOf, messagesOf, headsAnIdentity, everyAccount } = people;
  const { pickA, pickB, identityA, identityB, alreadyOne, choice, nameChoice, customName, winnerName } =
    picks;

  return (
    <section
      aria-labelledby="admin-pick-heading"
      className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
    >
      <h4 id="admin-pick-heading" className="text-xs font-semibold">
        Merge two accounts
      </h4>
      <p className="mt-1 text-xs text-[var(--color-muted)]">
        Pick any two accounts — the suggestions below are only suggestions. The name you choose is
        pinned to the merged person, so a later Discord rename or rebuild will not change it.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="admin-merge-a" className="block text-[11px] text-[var(--color-muted)]">
            First account
          </label>
          <select
            id="admin-merge-a"
            value={pickA}
            onChange={(event) => onPickA(event.target.value)}
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
          >
            <option value="">Choose an account…</option>
            {everyAccount.map((account) => (
              <option key={account} value={account}>
                {chipLabel(account)} ({account})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="admin-merge-b" className="block text-[11px] text-[var(--color-muted)]">
            Second account
          </label>
          <select
            id="admin-merge-b"
            value={pickB}
            onChange={(event) => onPickB(event.target.value)}
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
          >
            <option value="">Choose an account…</option>
            {everyAccount
              .filter((account) => account !== pickA)
              .map((account) => (
                <option key={account} value={account}>
                  {chipLabel(account)} ({account})
                </option>
              ))}
          </select>
        </div>
      </div>

      {pickA && pickB ? (
        alreadyOne ? (
          <div className="mt-3">
            <Notice tone="warn">
              {chipLabel(pickA)} and {chipLabel(pickB)} are already the same person.
            </Notice>
          </div>
        ) : (
          <fieldset className="mt-3">
            <legend className="text-[11px] text-[var(--color-muted)]">
              Which display name wins?
            </legend>
            <p className="mt-1 text-xs">
              This merges{" "}
              <strong>
                {new Set([...membersOf(identityA), ...membersOf(identityB)]).size} accounts
              </strong>{" "}
              into <strong>{winnerName || "the name you type"}</strong>.
              {[identityA, identityB].some(headsAnIdentity)
                ? " It drags in every alt of both identities too — check the accounts beside each name."
                : ""}
            </p>
            <div className="mt-2 space-y-2">
              {(
                [
                  ["a", identityA],
                  ["b", identityB],
                ] as const
              ).map(([key, canonical]) => (
                <div key={key} className="flex items-center gap-2">
                  <input
                    id={`admin-merge-name-${key}`}
                    type="radio"
                    name="admin-merge-name"
                    checked={choice === key}
                    onChange={() => onNameChoice(key)}
                    className="h-4 w-4"
                  />
                  <label htmlFor={`admin-merge-name-${key}`} className="text-xs">
                    Keep the name <strong>{label(canonical)}</strong>{" "}
                    <span className="text-[var(--color-muted)]">
                      ({canonical} · {messagesOf(canonical).toLocaleString()} messages ·{" "}
                      {membersOf(canonical).length}{" "}
                      {membersOf(canonical).length === 1 ? "account" : "accounts"})
                    </span>
                  </label>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <input
                  id="admin-merge-name-custom"
                  type="radio"
                  name="admin-merge-name"
                  checked={nameChoice === "custom"}
                  onChange={() => onNameChoice("custom")}
                  className="h-4 w-4"
                />
                <label htmlFor="admin-merge-name-custom" className="text-xs">
                  Type a name
                </label>
              </div>
              <input
                id="admin-merge-name"
                aria-label="Or type a name"
                value={customName}
                onChange={(event) => onCustomName(event.target.value)}
                placeholder="A name for the merged person"
                className="ml-6 w-full max-w-xs rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
              />
              {winnerName.trim() &&
              identities.some(
                (author) =>
                  author.id !== identityA &&
                  author.id !== identityB &&
                  normalise(author.name) === normalise(winnerName),
              ) ? (
                <Notice tone="warn">
                  Another person already goes by {winnerName}. The picker shows account ids
                  beside every name, so the merge is still safe — but the two will look alike in
                  the list and on the dashboard.
                </Notice>
              ) : null}
            </div>
          </fieldset>
        )
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onMerge}
          disabled={saving || !pickA || !pickB || pickA === pickB || alreadyOne}
          className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Merge these accounts
        </button>
        {canUndo ? (
          <button
            type="button"
            onClick={onUndo}
            disabled={saving}
            className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Undo the last change
          </button>
        ) : null}
      </div>
    </section>
  );
}
