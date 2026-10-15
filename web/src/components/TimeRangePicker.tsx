import { Chip, FilterGroup } from "./AppShell";

const PRESETS: { label: string; days: number | null }[] = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
  { label: "all", days: null },
];

/** Presets plus year chips — the single source of truth for [from, to] (§11.0). */
export function TimeRangePicker({
  years,
  selectedYears,
  from,
  to,
  onPreset,
  onToggleYear,
  onClearYears,
}: {
  years: number[];
  selectedYears: number[];
  from: string | null;
  to: string | null;
  onPreset: (days: number | null) => void;
  onToggleYear: (year: number) => void;
  onClearYears: () => void;
}) {
  return (
    <FilterGroup label="Time range">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Chip
            key={preset.label}
            active={
              preset.days === null ? from === null && to === null : from !== null || to !== null
            }
            onClick={() => onPreset(preset.days)}
          >
            {preset.label}
          </Chip>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[var(--color-muted)]">
        {from ?? "earliest"} → {to ?? "latest"}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {years.map((year) => (
          <Chip
            key={year}
            active={selectedYears.includes(year)}
            onClick={() => onToggleYear(year)}
            title={`Only ${year}`}
          >
            {year}
          </Chip>
        ))}
        {selectedYears.length ? (
          <button type="button" onClick={onClearYears} className="text-[11px] underline">
            clear
          </button>
        ) : null}
      </div>
    </FilterGroup>
  );
}
