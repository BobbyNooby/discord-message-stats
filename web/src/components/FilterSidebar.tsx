import type { Dispatch } from "react";

import type { Payload } from "../api/types";
import type { Action, Filters } from "../filters/reducer";
import { AuthorFilterList } from "./AuthorFilterList";
import { Chip, FilterGroup } from "./AppShell";
import { TimeRangePicker } from "./TimeRangePicker";

const BUCKETS: Filters["bucket"][] = ["day", "month", "year"];
const RANKS: Filters["rankBy"][] = ["msgs", "chars", "media", "replies"];

/** Every filter lives here, grouped and labelled exactly as §11.0 lists them. */
export function FilterSidebar({
  payload,
  filters,
  dispatch,
  years,
}: {
  payload: Payload;
  filters: Filters;
  dispatch: Dispatch<Action>;
  years: number[];
}) {
  const setPreset = (days: number | null) => {
    if (days === null) {
      dispatch({ type: "setRange", from: null, to: null });
      return;
    }
    const newest = payload.meta.lastLocal ?? payload.days[payload.days.length - 1];
    if (!newest) return;
    const start = new Date(`${newest}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - days);
    dispatch({ type: "setRange", from: start.toISOString().slice(0, 10), to: newest });
  };

  return (
    <div className="space-y-4">
      <TimeRangePicker
        years={years}
        selectedYears={filters.years}
        from={filters.from}
        to={filters.to}
        onPreset={setPreset}
        onToggleYear={(year) => dispatch({ type: "toggleYear", year })}
        onClearYears={() => dispatch({ type: "clearYears" })}
      />
      <FilterGroup label={`Authors (${filters.active.filter(Boolean).length}/${payload.authors.length})`}>
        <AuthorFilterList
          authors={payload.authors}
          active={filters.active}
          onToggle={(index) => dispatch({ type: "toggleAuthor", index })}
          onAll={() => dispatch({ type: "allAuthors" })}
          onNone={() => dispatch({ type: "noAuthors" })}
        />
      </FilterGroup>
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
    </div>
  );
}
