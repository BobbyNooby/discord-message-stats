import type { ReactNode } from "react";

import { CARD_COLUMNS, SectionHeading } from "../components/Panel";

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
      <SectionHeading id="sec-time">Time &amp; rhythm</SectionHeading>
      <div className={CARD_COLUMNS}>
        <Activity payload={payload} filters={filters} />
        <Cumulative payload={payload} filters={filters} />
        <Conversational payload={payload} filters={filters} />
        <div>{calendar}</div>
        <Heat payload={payload} filters={filters} />
        <TimeOfDay payload={payload} filters={filters} />
        <Season payload={payload} filters={filters} />
        <Stream payload={payload} filters={filters} />
      </div>
    </section>
  );
}
