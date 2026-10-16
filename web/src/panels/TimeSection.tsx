import type { ReactNode } from "react";

import { Activity } from "./Activity";
import { Conversational } from "./Conversational";
import { Cumulative } from "./Cumulative";
import { Heat } from "./Heat";
import { Season } from "./Season";
import { Stream } from "./Stream";
import { TimeOfDay } from "./TimeOfDay";
import type { PanelProps } from "./timeAggregates";

/**
 * The Time & rhythm panels of §11.1.
 *
 * "Every day, six years" (the calendar) is its own component with its own
 * window arithmetic (§11.3), so it arrives as a slot and takes §11.1's place
 * between "How conversational" and "When the chat comes alive".
 */
export function TimeSection({
  payload,
  filters,
  calendar,
}: PanelProps & { calendar?: ReactNode }) {
  return (
    <section aria-labelledby="sec-time" className="space-y-4">
      <h2
        id="sec-time"
        className="text-base font-semibold text-[var(--color-text)]"
      >
        Time &amp; rhythm
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Activity payload={payload} filters={filters} />
        <Cumulative payload={payload} filters={filters} />
        <Conversational payload={payload} filters={filters} />
        <div className="lg:col-span-2 xl:col-span-3">{calendar}</div>
        <Heat payload={payload} filters={filters} />
        <TimeOfDay payload={payload} filters={filters} />
        <Season payload={payload} filters={filters} />
        <Stream payload={payload} filters={filters} />
      </div>
    </section>
  );
}
