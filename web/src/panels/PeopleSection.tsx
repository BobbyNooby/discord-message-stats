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

/** The People section: ten panels, one grid, every one a pure function of the payload and the filters. */
export function PeopleSection({ payload, filters }: { payload: Payload; filters: Filters }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Leaderboard payload={payload} filters={filters} />
      <ResponseTime payload={payload} filters={filters} />
      <ReplyNetwork payload={payload} filters={filters} />
      <ReplyBalance payload={payload} filters={filters} />
      <Starters payload={payload} filters={filters} />
      <AuthorRadar payload={payload} filters={filters} />
      <ReplyMatrix payload={payload} filters={filters} className="xl:col-span-2" />
      <Treemap payload={payload} filters={filters} />
      <Burstiness payload={payload} filters={filters} />
      <EditRate payload={payload} filters={filters} />
    </div>
  );
}
