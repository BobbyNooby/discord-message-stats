import { CARD_COLUMNS, SectionHeading } from "../components/Panel";
import { SectionScopeNote } from "../components/SectionScopeNote";
import type { Payload } from "../api/types";
import type { Filters } from "../filters/reducer";
import { EmbedTypes } from "./EmbedTypes";
import { LinkDomains } from "./LinkDomains";
import { Providers } from "./Providers";
import { TopLinks } from "./TopLinks";

/** The Links & embeds section (§11.1). The heading spans the width, outside the column flow. */
export function LinksSection({ payload, filters }: { payload: Payload; filters: Filters }) {
  return (
    <section aria-labelledby="sec-links" className="space-y-4">
      <SectionHeading id="sec-links">Links &amp; embeds</SectionHeading>
      <SectionScopeNote section="links" />
      <div className={CARD_COLUMNS}>
        <LinkDomains payload={payload} filters={filters} />
        <Providers payload={payload} filters={filters} />
        <TopLinks payload={payload} filters={filters} />
        <EmbedTypes payload={payload} filters={filters} />
      </div>
    </section>
  );
}
