import { ChartColumn, ChartPie, Download, Ellipsis } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { csvFilename, downloadCsv, type CsvRow } from "../lib/csv";
import { TERMS, panelAbout } from "../lib/glossary";
import { useChartShape, usePanelScopeTarget, useShapeChange } from "../panels/panelScope";
import { specFor, specForLabel, type PanelId } from "../panels/registry";
import { useNotice } from "./Notice";
import { PanelCsvContext } from "./panelCsv";
import { IconButton, Toggle } from "./ui";

/**
 * Sections lay their cards out in columns, not grid rows.
 *
 * A grid row makes every card as tall as the tallest in it, so a two-series bar
 * chart sat in a box sized for a calendar — dead space under one card, a clipped
 * chart in another. Columns let each card be exactly as tall as its own content.
 */
export const CARD_COLUMNS = "columns-1 gap-4 md:columns-2";

/**
 * One heading for every section (§UI/UX rule 6). It is bigger than a card title
 * and carries a rule underneath, so where a section starts is unmistakable; it
 * lives *outside* the columns container, or multi-column would lay it into the
 * first column and pack cards beside it.
 */
export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="border-b border-[var(--color-line)] pb-2 text-xl font-bold tracking-tight text-[var(--color-text)]"
    >
      {children}
    </h2>
  );
}

/** The card + header + subtitle + badge wrapper every chart sits in (§11.0). */
export function Panel({
  title,
  subtitle,
  badge,
  children,
  className,
  panelId,
  csv,
  help,
}: {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  /** When the title is dynamic ("Who says “cat”"), name the card explicitly. */
  panelId?: PanelId;
  /**
   * The rows this card is drawn from. Present iff the panel has an aggregate to
   * export — a card that shows a count with no rows behind it offers nothing,
   * rather than an empty file.
   */
  csv?: { name: string; rows: CsvRow[] };
  /** One line of jargon this card leans on, shown on a "?" beside the title. */
  help?: string;
}) {
  const onOpenScope = usePanelScopeTarget();
  const notify = useNotice();
  // The registry decides whether a card can be scoped, not a prop or a guess
  // from the title: "…" exists iff the card honours at least one dimension. A
  // dynamic title names its card explicitly; a static one is looked up by title.
  const spec = panelId ? specFor(panelId) : specForLabel(title);
  const target = spec && spec.honours.length > 0 ? spec : null;
  // The switch exists iff the card declares both shapes (§UI/UX rule 4): the
  // registry, not the panel, is where "a pie is honest here" is decided.
  const switchable = spec && spec.shapes.length > 1 ? spec : null;
  const shape = useChartShape(switchable?.id ?? "");
  const onShapeChange = useShapeChange();

  // A chart inside this card hands back the table it drew; the card then offers
  // the export with its own title as the filename. Equal rows are kept as-is, or
  // an inline chart option would re-render this card forever.
  const [drawn, setDrawn] = useState<CsvRow[]>([]);
  const register = useCallback((rows: CsvRow[]) => {
    setDrawn((current) => (sameRows(current, rows) ? current : rows));
  }, []);
  const exported = csv ?? (drawn.length > 0 ? { name: title, rows: drawn } : null);
  // "What this shows", from the one glossary: a card that is in the registry
  // cannot be silent about its own meaning.
  const about = panelAbout(spec?.id);

  return (
    <PanelCsvContext.Provider value={register}>
      <section
        className={`mb-4 break-inside-avoid rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 ${className ?? ""}`}
      >
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1">
            <h2 className="min-w-0 text-sm font-semibold tracking-wide text-[var(--color-text)]">
              {title}
            </h2>
            {/* Beside the heading, not inside it: a "?" in the heading would
                change the accessible name every test and screen reader uses. */}
            {help ? (
              <span
                role="note"
                tabIndex={0}
                aria-label={help}
                title={help}
                className="cursor-help rounded-full border border-[var(--color-line)] px-1 text-[10px] text-[var(--color-muted)]"
              >
                ?
              </span>
            ) : null}
          </div>
          {/* The actions wrap too: "Most reposted" is a tab strip plus a badge plus
              the "…" trigger, which is wider than a 390px card on its own. */}
          <span className="flex min-w-0 flex-wrap items-center justify-end gap-1">
            {badge}
            {exported ? (
              <IconButton
                label={`Export ${title} as CSV`}
                icon={<Download size={16} aria-hidden />}
                onClick={() => exportRows(exported, notify)}
              />
            ) : null}
            {switchable && onShapeChange ? (
              <Toggle
                pressed={shape === "pie"}
                onPressedChange={(pie) => onShapeChange(switchable.id, pie ? "pie" : "bar")}
                icons={[
                  <ChartColumn key="bar" size={16} aria-hidden />,
                  <ChartPie key="pie" size={16} aria-hidden />,
                ]}
                // Naming the state, not the action, is this primitive's rule: the
                // card's own label is in the name so 39 cards' switches differ.
                labels={[`${switchable.label} as bars`, `${switchable.label} as pie`]}
              />
            ) : null}
            {onOpenScope && target ? (
              <IconButton
                label={`Filter ${target.label}`}
                icon={<Ellipsis size={16} aria-hidden />}
                onClick={() => onOpenScope(target.id)}
              />
            ) : null}
          </span>
        </header>
        {about ? (
          <p className="mb-1 text-[11px] leading-snug text-[var(--color-muted)]">{about}</p>
        ) : null}
        {subtitle ? (
          <p className="mb-3 text-xs text-[var(--color-muted)]">{subtitle}</p>
        ) : null}
        {children}
      </section>
    </PanelCsvContext.Provider>
  );
}

/** Cheap equality: the rows are small, and identity is not preserved. */
function sameRows(a: CsvRow[], b: CsvRow[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The export, and the acknowledgement either way. A download that silently does
 * nothing (a blocked blob, a full disk) is worse than no button at all.
 */
function exportRows(csv: { name: string; rows: CsvRow[] }, notify: ReturnType<typeof useNotice>): void {
  const file = csvFilename(csv.name);
  try {
    const written = downloadCsv(csv.name, csv.rows);
    notify({
      tone: "success",
      message: `Exported ${file} — ${written} rows, from the numbers already on this card.`,
    });
  } catch (failure) {
    notify({
      tone: "danger",
      message: `Could not export ${file} (${(failure as Error).message}). Try again, or copy the numbers by hand.`,
    });
  }
}

/** A panel whose dimension cannot honour one of the active filters says so. */
export function GlobalOnlyBadge({ what }: { what: string }) {
  return (
    <span
      className="rounded border border-[var(--color-line)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]"
      title={`${what}: ${TERMS.globalOnly}`}
    >
      global only
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="flex h-[120px] items-center justify-center text-xs text-[var(--color-muted)]">
      {children}
    </p>
  );
}
