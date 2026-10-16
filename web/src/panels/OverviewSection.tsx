import { MessagesPerYear } from "./MessagesPerYear";
import { ShareOfVoice } from "./ShareOfVoice";
import { ShareOfVoiceByYear } from "./ShareOfVoiceByYear";
import { StatCards } from "./StatCards";
import type { PanelProps } from "./timeAggregates";

/** The four Overview panels of §11.1, laid out on one responsive grid. */
export function OverviewSection({ payload, filters }: PanelProps) {
  return (
    <section aria-labelledby="sec-overview" className="space-y-4">
      <h2
        id="sec-overview"
        className="text-base font-semibold text-[var(--color-text)]"
      >
        Overview
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <StatCards payload={payload} filters={filters} />
        <ShareOfVoice payload={payload} filters={filters} />
        <MessagesPerYear payload={payload} filters={filters} />
        <ShareOfVoiceByYear payload={payload} filters={filters} />
      </div>
    </section>
  );
}
