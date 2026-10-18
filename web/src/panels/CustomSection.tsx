import { CARD_COLUMNS, EmptyState, Panel, SectionHeading } from "../components/Panel";
import { customComponents } from "./custom";
import { SPECS, sectionOf } from "./registry";
import type { PanelProps } from "./timeAggregates";

/**
 * The fork's cards. A spec no built-in section claims lands here, so a fork
 * registers a panel by adding its spec and its component to `panels/custom` and
 * never edits an upstream render site. Upstream ships both empty, so this
 * renders nothing and the built-in sections are untouched.
 */
export function CustomSection({ payload, filters }: PanelProps) {
  const unclaimed = SPECS.filter((spec) => sectionOf(spec.id) === undefined);
  if (!unclaimed.length) return null;

  return (
    <section aria-labelledby="sec-custom" className="space-y-4">
      <SectionHeading id="sec-custom">Custom</SectionHeading>
      <div className={CARD_COLUMNS}>
        {unclaimed.map((spec) => {
          const Component = customComponents[spec.id];
          return Component ? (
            <Component key={spec.id} payload={payload} filters={filters} />
          ) : (
            // A spec with no component is honest about it rather than vanishing:
            // the sidebar can see the card, so the page must too.
            <Panel key={spec.id} title={spec.label} panelId={spec.id}>
              <EmptyState>No component is registered for this panel.</EmptyState>
            </Panel>
          );
        })}
      </div>
    </section>
  );
}
