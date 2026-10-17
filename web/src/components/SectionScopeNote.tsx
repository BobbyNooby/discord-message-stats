import { SECTIONS, panelsIgnoring, specFor, type SectionId } from "../panels/registry";

/** "A, B and C" — a comma list with a conjunction, not six clauses. */
function formatList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The one place a section says which of its cards a date filter cannot move.
 *
 * The cards read rollups with no day grain, so the time control is inert on
 * them — a rule about the data, stated once, rather than a badge repeated on
 * each card. The list comes from the registry, so a new card is covered here
 * without anyone remembering to add it.
 */
export function SectionScopeNote({ section }: { section: SectionId }) {
  const spec = SECTIONS.find((entry) => entry.id === section);
  if (!spec) return null;
  const ignoring = panelsIgnoring(section, "time");
  if (!ignoring.length) return null;

  const total = spec.panels.length;
  const which =
    ignoring.length === total ? `all ${total} cards here` : `${ignoring.length} of these ${total} cards`;
  const names = ignoring.map((id) => specFor(id).label);

  return (
    <p role="note" className="text-[11px] leading-snug text-[var(--color-muted)]">
      Date filters cannot move {which} — {formatList(names)} read rollups with no day grain (no date
      column). Where a card honours another dimension, its “…” still offers it.
    </p>
  );
}
