import type { Author } from "../api/types";
import { swatch } from "../lib/palette";

/** Swatch, name, count, multi-select, all/none (§11.0). */
export function AuthorFilterList({
  authors,
  active,
  onToggle,
  onAll,
  onNone,
}: {
  authors: Author[];
  active: boolean[];
  onToggle: (index: number) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <div className="space-y-1">
      {authors.map((author, index) => (
        <button
          key={author.id}
          type="button"
          aria-pressed={active[index] !== false}
          onClick={() => onToggle(index)}
          className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-[var(--color-surface-2)]"
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ background: swatch(index), opacity: active[index] === false ? 0.25 : 1 }}
          />
          {/* A long nickname is clipped by the column, so the full one stays
              reachable on hover rather than being lost to the layout. */}
          <span className="truncate" title={author.name}>
            {author.name}
          </span>
          <span className="ml-auto tabular-nums text-[var(--color-muted)]">{author.msgs}</span>
        </button>
      ))}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onAll} className="text-[11px] underline">
          all
        </button>
        <button type="button" onClick={onNone} className="text-[11px] underline">
          none
        </button>
      </div>
    </div>
  );
}
