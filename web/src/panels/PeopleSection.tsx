import { CARD_COLUMNS, SectionHeading } from "../components/Panel";
import type { Payload } from "../api/types";
import type { Filters } from "../filters/reducer";
import { AuthorRadar } from "./AuthorRadar";
import { Burstiness } from "./Burstiness";
import { EditRate } from "./EditRate";
import { Leaderboard } from "./Leaderboard";
import { ReplyBalance } from "./ReplyBalance";
import { ReplyMatrix } from "./ReplyMatrix";
import { ReplyNetwork } from "./ReplyNetwork";
import { ResponseTime } from "./ResponseTime";
import { Starters } from "./Starters";
import { Treemap } from "./Treemap";
import { WhoWrites } from "./WhoWrites";

/** The People section: eleven panels, packed in columns, every one a pure function of the payload and the filters. */
export function PeopleSection({ payload, filters }: { payload: Payload; filters: Filters }) {
  return (
    <section aria-labelledby="sec-people" className="space-y-4">
      <SectionHeading id="sec-people">People</SectionHeading>
      <div className={CARD_COLUMNS}>
        <Leaderboard payload={payload} filters={filters} />
        <WhoWrites payload={payload} filters={filters} />
        <ResponseTime payload={payload} filters={filters} />
        <ReplyNetwork payload={payload} filters={filters} />
        <ReplyBalance payload={payload} filters={filters} />
        <Starters payload={payload} filters={filters} />
        <AuthorRadar payload={payload} filters={filters} />
        <ReplyMatrix payload={payload} filters={filters} />
        <Treemap payload={payload} filters={filters} />
        <Burstiness payload={payload} filters={filters} />
        <EditRate payload={payload} filters={filters} />
      </div>
    </section>
  );
}
