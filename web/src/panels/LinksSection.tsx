import { CARD_COLUMNS } from "../components/Panel";
import type { Payload } from "../api/types";
import type { Filters } from "../filters/reducer";
import { EmbedTypes } from "./EmbedTypes";
import { LinkDomains } from "./LinkDomains";
import { Providers } from "./Providers";
import { TopLinks } from "./TopLinks";

/** The Links & embeds section (§11.1) in the mockup's order: w2, 1, w2, 1. */
export function LinksSection({ payload, filters }: { payload: Payload; filters: Filters }) {
  return (
    <section aria-labelledby="sec-links" className={CARD_COLUMNS}>
      <h2 id="sec-links" className="text-base font-semibold text-[var(--color-text)] lg:col-span-2 xl:col-span-3">
        Links &amp; embeds
      </h2>
      <div className="lg:col-span-1 xl:col-span-2">
        <LinkDomains payload={payload} filters={filters} />
      </div>
      <div>
        <Providers payload={payload} />
      </div>
      <div className="lg:col-span-1 xl:col-span-2">
        <TopLinks payload={payload} />
      </div>
      <div>
        <EmbedTypes payload={payload} />
      </div>
    </section>
  );
}
