/**
 * "Fix the data" (§11.6): the three things that change what the numbers *mean*
 * without changing a single message — merging two accounts into one person,
 * hiding someone from the rollups, and searching the message text to decide
 * whether a merge is right.
 *
 * Every one of those lands at rebuild time, never in the browser, so each card
 * writes through the API and marks the cache stale. `IdentityMerge` shows the
 * rebuild prompt next to the merge it applies.
 */

import type { Payload } from "../api/types";
import { IdentityMerge } from "./IdentityMerge";
import { MessageSearch } from "./MessageSearch";
import { WhoShows } from "./WhoShows";
import { Section } from "./shared";

export function FixData({
  payload,
  onDirty,
}: {
  payload: Payload | null;
  onDirty: () => void;
}) {
  return (
    <Section id="fix-data" title="Fix the data">
      <p className="text-xs text-[var(--color-muted)]">
        Merges and visibility are applied when the rollups are next built — a hidden account stays on
        disk, and a merge never deletes a message.
      </p>
      <IdentityMerge payload={payload} onDirty={onDirty} />
      <WhoShows payload={payload} onDirty={onDirty} />
      <MessageSearch />
    </Section>
  );
}
