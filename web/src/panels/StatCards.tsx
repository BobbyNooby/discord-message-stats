import { EmptyState, Panel } from "../components/Panel";
import { StatCard } from "../components/StatCard";
import { selectTotals, selectVisibleCells } from "../filters/selectors";
import { emptyLabel, fmt, kfmt, type PanelProps } from "./timeAggregates";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

const DASH = "—";

/**
 * The six headline figures. They are computed from the same `selectTotals` the
 * charts use, so a card can never disagree with the panel below it.
 *
 * An empty payload prints six dashes rather than zeroes: "no data" and "nothing
 * matched this filter" are different sentences, and a dash never lies (§5,
 * Review Focus 1). No card ever prints NaN.
 */
export function StatCards({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("stat-cards", fallbackFilters);
  const cells = selectVisibleCells(payload, filters);
  const totals = selectTotals(payload, filters);
  const nothing = cells.length === 0;
  const blank = payload.cells.length === 0;
  const all =
    !filters.from && !filters.to && !filters.years.length && filters.active.every(Boolean);

  const cards = [
    {
      label: "Messages",
      value: blank ? DASH : fmt(totals.msgs),
      sub: all
        ? `${payload.meta.firstLocal ?? DASH} → ${payload.meta.lastLocal ?? DASH}`
        : "filtered",
    },
    {
      label: "Authors",
      value: blank ? DASH : String(totals.authors),
      sub: all ? "who ever posted" : `of ${payload.authors.length} total`,
    },
    {
      label: "Active days",
      value: blank ? DASH : fmt(totals.days),
      sub: "days with ≥1 message",
    },
    {
      label: "Characters",
      value: blank ? DASH : kfmt(totals.chars),
      sub: "total text sent",
    },
    {
      label: "Avg length",
      value: blank || !totals.msgs ? DASH : `${(totals.chars / totals.msgs).toFixed(1)} ch`,
      sub: "per message",
    },
    {
      label: "Rollup size",
      value: blank ? DASH : fmt(payload.meta.cells),
      sub: `${fmt(payload.meta.heat_cells)} heat cells`,
    },
  ];

  return (
    <Panel
      title="Stat cards"
      subtitle={`${fmt(totals.msgs)} messages · ${totals.authors} authors · ${totals.days} active days`}
      className="xl:col-span-3"
      csv={{
        name: "Stat cards",
        rows: [["figure", "value", "note"], ...cards.map((card) => [card.label, card.value, card.sub])],
      }}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} sub={card.sub} />
        ))}
      </div>
      {nothing ? <EmptyState>{emptyLabel(payload, filters)}</EmptyState> : null}
    </Panel>
  );
}
