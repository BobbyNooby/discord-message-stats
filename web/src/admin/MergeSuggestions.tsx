import type { Author } from "../api/types";
import type { Suggestion } from "./merges";

/**
 * The name heuristic's pairs, each with its score and a one-click merge. Never
 * merged automatically: short and common handles produce false positives.
 */
export function MergeSuggestions({
  suggestions,
  saving,
  onMerge,
}: {
  suggestions: Suggestion[];
  saving: boolean;
  onMerge: (a: Author, b: Author) => void;
}) {
  return (
    <section
      aria-labelledby="admin-suggestions-heading"
      className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
    >
      <h4 id="admin-suggestions-heading" className="text-xs font-semibold">
        Suggestions from the name heuristic
      </h4>
      <p className="mt-1 text-xs text-[var(--color-muted)]">
        Name containment (4+ characters) or a shared run of 5+ covering most of the shorter name
        (§5.5), scored and sorted strongest first. Never merged automatically — short and common
        handles produce false positives, which is why the score is shown rather than a verdict.
      </p>
      <ul className="mt-3 space-y-2">
        {suggestions.length === 0 ? (
          <li className="text-xs text-[var(--color-muted)]">No suggestions left.</li>
        ) : null}
        {suggestions.map(({ a, b, score }) => {
          const keep = a.msgs >= b.msgs ? a : b;
          const fold = keep === a ? b : a;
          return (
            <li
              key={`${a.id}-${b.id}`}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)]/50 pb-2 text-xs"
            >
              <span>
                {a.name} <span className="text-[var(--color-muted)]">↔</span> {b.name}{" "}
                <span className="text-[var(--color-muted)]">
                  match {Math.round(score * 100)}%
                </span>
              </span>
              <button
                type="button"
                onClick={() => onMerge(a, b)}
                disabled={saving}
                className="rounded border border-[var(--color-line)] px-2 py-1 text-[11px] disabled:opacity-50"
              >
                Merge {fold.name} into {keep.name}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
