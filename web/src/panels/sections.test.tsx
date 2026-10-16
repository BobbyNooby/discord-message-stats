import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import type { Action, Filters } from "../filters/reducer";

import type { Payload } from "../api/types";
import { initialFilters } from "../filters/reducer";
import { LinksSection } from "./LinksSection";
import { MediaSection } from "./MediaSection";
import { OverviewSection } from "./OverviewSection";
import { PeopleSection } from "./PeopleSection";
import { TimeSection } from "./TimeSection";
import { WordsSection } from "./WordsSection";

const payload = {
  authors: [{ id: "u1", name: "A", msgs: 2 }],
  days: ["2023-01-01"],
  cells: [[0, 0, 2, 10, 1, 0, 0]],
  heat: [[0, 10, 0, 2023, 2]],
  edges: [[0, 0, 1]],
  response: [[0, 30, 1]],
  editSpeed: [[0, 12, 1]],
  starters: [[0, 1]],
  attachments: [["image/png", 1]],
  words: [["abc", 2]],
  wordAuthors: { abc: [[0, 2]] },
  authorWordTotals: [2],
  authorDistinct: [1],
  identities: [],
  linkDomains: ["x.com"],
  linkCells: [[0, 0, 0, 1]],
  topLinks: [["x.com/a", 1]],
  providers: [["YouTube", 1]],
  embedTypes: [["video", 1]],
  linkStats: { msgs: 1, domains: 1, both: 1 },
  emoji: [["😀", 1]],
  reactions: [["fire", 1]],
  types: [[0, "default", 2]],
  tz: { name: "UTC", label: "UTC" },
  channel_hint: "c1",
  meta: { types: [[0, "default", 2]], stale: false, timezone: "UTC", total: 2 },
} as unknown as Payload;

/**
 * Every section is a landmark with a heading (§11.0, six sections). People was
 * the exception: its ten panels rendered with no section and no "People"
 * heading at all, which the panel tests could not see because they render each
 * panel, never the section.
 */
type SectionProps = { payload: Payload; filters: Filters; dispatch: (action: Action) => void };

// The word index queries the API on a miss, so the wrapper is the one the app
// itself uses.
const renderSection = (Component: ComponentType<SectionProps>) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Component payload={payload} filters={initialFilters(payload)} dispatch={noop} />
    </QueryClientProvider>,
  );

const noop = (_action: Action) => {};
const SECTIONS: [string, string, ComponentType<SectionProps>][] = [
  ["sec-overview", "Overview", OverviewSection],
  ["sec-time", "Time & rhythm", TimeSection],
  ["sec-people", "People", PeopleSection],
  ["sec-words", "Words", WordsSection],
  ["sec-links", "Links & embeds", LinksSection],
  ["sec-media", "Media & reactions", MediaSection],
];

describe("the six sections", () => {
  for (const [id, heading, Component] of SECTIONS) {
    it(`${heading} is a labelled section with its own heading`, () => {
      const { container } = renderSection(Component);
      const section = container.querySelector(`section[aria-labelledby="${id}"]`);
      expect(section, `no section[aria-labelledby=${id}]`).not.toBeNull();
      expect(container.querySelector(`#${id}`)?.textContent?.trim()).toBe(heading);
    });
  }

  it("renders every section's panels, not just its heading", () => {
    const { container } = renderSection(PeopleSection);
    expect(container.querySelectorAll("section").length).toBeGreaterThan(5);
  });
});
