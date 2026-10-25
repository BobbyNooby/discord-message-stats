import type { RollupFamily } from "../api";
import { formatSeconds, type FamilyProgress } from "./ProgressView";
import { provenance, stateTone } from "./refreshLabels";
import { formatStamp } from "../shared";

/**
 * One row per rollup family: what the running rebuild is doing to it, and what
 * the last build was made from — the provenance row turned into the question
 * the operator actually has, "how much has arrived since this was built?"
 */
export function FamiliesTable({
  rows,
  rollups,
}: {
  rows: FamilyProgress[];
  rollups: Record<string, RollupFamily>;
}) {
  return (
    <div className="overflow-x-auto rounded border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">
          Every rollup family with what the running rebuild is doing to it, its row count, when
          it was computed, what it was built from, and whether it is current or stale
        </caption>
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
            <th scope="col" className="py-1 pr-3">
              Family
            </th>
            <th scope="col" className="py-1 pr-3">
              State
            </th>
            <th scope="col" className="py-1 pr-3">
              Rows
            </th>
            <th scope="col" className="py-1 pr-3">
              Took
            </th>
            <th scope="col" className="py-1 pr-3">
              Built
            </th>
            <th scope="col" className="py-1 pr-3">
              What changed since
            </th>
            <th scope="col" className="py-1">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.family} className="border-t border-[var(--color-line)]/50">
              <th scope="row" className="py-1 pr-3 text-left font-medium">
                {row.family}
              </th>
              <td className={`py-1 pr-3 ${stateTone(row.state)}`}>{row.state ?? "—"}</td>
              <td className="py-1 pr-3 tabular-nums">
                {row.rows === null ? "—" : row.rows.toLocaleString()}
              </td>
              <td className="py-1 pr-3 tabular-nums text-[var(--color-muted)]">
                {row.seconds === null ? "—" : formatSeconds(row.seconds)}
              </td>
              <td className="py-1 pr-3 whitespace-nowrap text-[var(--color-muted)]">
                {formatStamp(row.computed_at)}
              </td>
              <td className="py-1 pr-3 text-[var(--color-muted)]">
                {provenance(row, rollups[row.family])}
              </td>
              <td className={`py-1 ${row.stale ? "text-amber-300" : "text-emerald-300"}`}>
                {row.stale ? "stale" : "current"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
