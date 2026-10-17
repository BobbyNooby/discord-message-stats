import type { Dispatch, ReactNode } from "react";

import type { Payload } from "../api/types";
import type { Charts } from "../filters/persist";
import type { DashboardAction, FilterPatch, Filters, Scopes, SidebarMode } from "../filters/reducer";
import { effective } from "../filters/selectors";
import { specFor, type Dimension, type PanelId } from "../panels/registry";
import { AuthorFilterList } from "./AuthorFilterList";
import { Chip, FilterGroup } from "./AppShell";
import { PrunedNotice, ResetView } from "./ResetView";
import { ScopeBanner } from "./ScopeBanner";
import { ScopeChips } from "./ScopeChips";
import { TimeRangePicker } from "./TimeRangePicker";

const BUCKETS: Filters["bucket"][] = ["day", "month", "year"];
const RANKS: Filters["rankBy"][] = ["msgs", "chars", "media", "replies"];

const DIMENSION_LABELS: Record<Dimension, string> = {
  time: "Time range",
  author: "Authors",
  word: "Word",
  provider: "Provider",
  kind: "Kind",
  media: "Media",
};

/** The keys a dimension owns, so a chip can retire exactly those. */
const DIMENSION_KEYS: Record<Dimension, (keyof Filters)[]> = {
  time: ["from", "to", "years"],
  author: ["active"],
  word: ["word"],
  provider: [],
  kind: [],
  media: [],
};

/**
 * Every filter lives here, grouped and labelled exactly as §11.0 lists them.
 *
 * The sidebar has two modes and stays the same sidebar in the same place: with
 * a card's scope open it shows only the dimensions that card declared, edits a
 * draft, and says so in a banner until you apply or go back to global.
 */
export function FilterSidebar({
  payload,
  filters,
  scopes,
  mode,
  dispatch,
  years,
  onExitScope,
  pruned,
  charts = {},
  onResetView = () => {},
  onDismissPruned,
}: {
  payload: Payload;
  filters: Filters;
  /** What each card has applied. A card's patch composes over `filters`. */
  scopes: Scopes;
  mode: SidebarMode;
  dispatch: Dispatch<DashboardAction>;
  years: number[];
  onExitScope?: () => void;
  /** What was dropped from saved filters because the payload no longer has it. */
  pruned?: string;
  onDismissPruned?: () => void;
  /** Chart shapes are stored beside the scopes, so the reset control owns both. */
  charts?: Charts;
  onResetView?: () => void;
}) {
  const scoped = mode.kind === "scoped" ? mode : null;
  const spec = scoped ? specFor(scoped.panelId) : null;
  // Inside a scope you edit the draft; the card keeps reading what was applied
  // until Apply says otherwise.
  const shown = scoped ? effective(filters, scoped.draft) : filters;
  const applied: FilterPatch = scoped ? scopes[scoped.panelId] ?? {} : {};
  const panelId: PanelId | null = scoped?.panelId ?? null;

  const patch = (next: FilterPatch) => {
    if (panelId) dispatch({ type: "patchScope", panelId, patch: next });
  };

  const setPreset = (days: number | null) => {
    const range =
      days === null
        ? { from: null, to: null }
        : (() => {
            const newest = payload.meta.lastLocal ?? payload.days[payload.days.length - 1];
            if (!newest) return null;
            const start = new Date(`${newest}T00:00:00Z`);
            start.setUTCDate(start.getUTCDate() - days);
            return { from: start.toISOString().slice(0, 10), to: newest };
          })();
    if (!range) return;
    if (panelId) patch(range);
    else dispatch({ type: "setRange", ...range });
  };

  const toggleYear = (year: number) => {
    if (!panelId) {
      dispatch({ type: "toggleYear", year });
      return;
    }
    const next = shown.years.includes(year)
      ? shown.years.filter((entry) => entry !== year)
      : [...shown.years, year].sort();
    patch({ years: next });
  };

  const removeDimension = (dimension: Dimension) => {
    if (!panelId) return;
    const next = { ...applied };
    for (const key of DIMENSION_KEYS[dimension]) delete next[key];
    dispatch({ type: "replaceScope", panelId, patch: next });
  };

  /** A scope offers only the dimensions the card declared it can honour. */
  const groups: Partial<Record<Dimension, ReactNode>> = {
    time: (
      <TimeRangePicker
        years={years}
        selectedYears={shown.years}
        from={shown.from}
        to={shown.to}
        onPreset={setPreset}
        onToggleYear={toggleYear}
        onClearYears={() => (panelId ? patch({ years: [] }) : dispatch({ type: "clearYears" }))}
      />
    ),
    author: (
      <FilterGroup
        label={`Authors (${shown.active.filter(Boolean).length}/${payload.authors.length})`}
      >
        <AuthorFilterList
          authors={payload.authors}
          active={shown.active}
          onToggle={(index) =>
            panelId
              ? patch({ active: shown.active.map((on, at) => (at === index ? !on : on)) })
              : dispatch({ type: "toggleAuthor", index })
          }
          onAll={() =>
            panelId
              ? patch({ active: shown.active.map(() => true) })
              : dispatch({ type: "allAuthors" })
          }
          onNone={() =>
            panelId
              ? patch({ active: shown.active.map(() => false) })
              : dispatch({ type: "noAuthors" })
          }
        />
      </FilterGroup>
    ),
    word: (
      <FilterGroup label="Word">
        <input
          type="text"
          aria-label="Word"
          placeholder="any word"
          value={shown.word ?? ""}
          onChange={(event) => patch({ word: event.target.value || null })}
          className="w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-text)]"
        />
      </FilterGroup>
    ),
  };

  // A declared dimension with no control yet is stated, not silently dropped.
  const unavailable = (dimension: Dimension) => (
    <FilterGroup label={DIMENSION_LABELS[dimension]}>
      <p className="text-[11px] text-[var(--color-muted)]">
        No {dimension} filter exists yet, so this card cannot be narrowed by it.
      </p>
    </FilterGroup>
  );

  return (
    <div className="space-y-4">
      {!scoped && pruned ? <PrunedNotice pruned={pruned} onDismiss={onDismissPruned ?? (() => {})} /> : null}
      {scoped && spec ? (
        <div className="sticky top-0 z-10">
          <ScopeBanner
            panelLabel={spec.label}
            dirty={JSON.stringify(scoped.draft) !== JSON.stringify(applied)}
            onApply={() => dispatch({ type: "applyScope", panelId: scoped.panelId })}
            onBack={() => onExitScope?.()}
            pruned={pruned}
          />
        </div>
      ) : null}

      {scoped && spec ? (
        <>
          {spec.honours.map((dimension) => (
            <div key={dimension}>{groups[dimension] ?? unavailable(dimension)}</div>
          ))}
          <ScopeChips patch={applied} onRemove={removeDimension} />
          <p className="px-1 text-[11px] text-[var(--color-muted)]">
            {Object.keys(applied).length
              ? "Chips are what this card applies. Apply commits the rest."
              : "Nothing is applied to this card yet."}
          </p>
        </>
      ) : (
        <>
          {groups.time}
          {groups.author}
          <FilterGroup label="Bucket">
            <div className="flex flex-wrap gap-2">
              {BUCKETS.map((bucket) => (
                <Chip
                  key={bucket}
                  active={filters.bucket === bucket}
                  onClick={() => dispatch({ type: "setBucket", bucket })}
                >
                  {bucket}
                </Chip>
              ))}
            </div>
          </FilterGroup>
          <FilterGroup label="Rank by">
            <div className="flex flex-wrap gap-2">
              {RANKS.map((rankBy) => (
                <Chip
                  key={rankBy}
                  active={filters.rankBy === rankBy}
                  onClick={() => dispatch({ type: "setRankBy", rankBy })}
                >
                  {rankBy}
                </Chip>
              ))}
            </div>
          </FilterGroup>
          <button
            type="button"
            onClick={() => dispatch({ type: "reset" })}
            className="w-full rounded border border-[var(--color-line)] px-3 py-2 text-xs"
          >
            Reset all filters
          </button>
          <ResetView scopes={scopes} charts={charts} onReset={onResetView} />
        </>
      )}
    </div>
  );
}
