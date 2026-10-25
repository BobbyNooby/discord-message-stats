import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Action } from "../app/reducer";
import { initialFilters } from "../app/reducer";

import type { Payload } from "../api/types";
import { Leaderboard } from "./Leaderboard";
import { PanelScopeProvider } from "./panelScope";
import { ReplyMatrix } from "./ReplyMatrix";
import { SECTIONS as REGISTRY_SECTIONS, type SectionId } from "./registry";
import { PanelSection } from "./Sections";
import { oneOfEach } from "../test/payload";

const payload = oneOfEach;

/**
 * Every section is a landmark with a heading (§11.0, six sections). People was
 * the exception: its ten panels rendered with no section and no "People"
 * heading at all, which the panel tests could not see because they render each
 * panel, never the section.
 */
// The word index queries the API on a miss, so the wrapper is the one the app
// itself uses.
const renderSection = (section: SectionId) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PanelSection section={section} payload={payload} filters={initialFilters(payload)} dispatch={noop} />
    </QueryClientProvider>,
  );

const noop = (_action: Action) => {};
const SECTIONS: [string, string, SectionId][] = [
  ["sec-overview", "Overview", "overview"],
  ["sec-time", "Time & rhythm", "time"],
  ["sec-people", "People", "people"],
  ["sec-words", "Words", "words"],
  ["sec-links", "Links & embeds", "links"],
  ["sec-media-rich", "Rich media", "rich-media"],
  ["sec-media", "Media & reactions", "media"],
];

describe("the six sections", () => {
  for (const [id, heading, sectionId] of SECTIONS) {
    it(`${heading} is a labelled section with its own heading`, () => {
      const { container } = renderSection(sectionId);
      const section = container.querySelector(`section[aria-labelledby="${id}"]`);
      expect(section, `no section[aria-labelledby=${id}]`).not.toBeNull();
      expect(container.querySelector(`#${id}`)?.textContent?.trim()).toBe(heading);
    });
  }

  it("keeps every heading out of the column flow, with a rule under it", () => {
    // A heading inside the columns container is laid into the first column and
    // cards pack beside it. The heading is always a direct child of its section,
    // and it carries the border that separates one section from the next.
    for (const [id, , sectionId] of SECTIONS) {
      const { container, unmount } = renderSection(sectionId);
      const heading = container.querySelector(`#${id}`)!;
      expect(heading.tagName, `${id} heading`).toBe("H2");
      expect(heading.parentElement?.tagName, `${id} heading parent`).toBe("SECTION");
      expect(heading.className, `${id} separator`).toContain("border-b");
      expect(heading.nextElementSibling, `${id} has no cards container`).not.toBeNull();
      unmount();
    }
  });

  it("renders each card in the section its spec names, in registry order", () => {
    // The card table and the registry are separate lists keyed by the same id;
    // a card mounted under the wrong key would carry another card's title here.
    for (const section of REGISTRY_SECTIONS) {
      const { container, unmount } = renderSection(section.id);
      const cards = [...container.querySelectorAll('section[id][tabindex="-1"]')].map((card) => card.id);
      expect(cards, section.id).toEqual(section.panels);
      unmount();
    }
  });

  it("renders every section's panels, not just its heading", () => {
    const { container } = renderSection("people");
    expect(container.querySelectorAll("section").length).toBeGreaterThan(5);
  });

  it("offers each chart card an export built from the chart's own rows", () => {
    renderSection("time");

    // No panel passes a csv prop: the card reads the table back out of the
    // option its chart drew, so an export cannot drift from the picture.
    expect(screen.getByRole("button", { name: "Export Messages over time as CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Cumulative growth as CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export When the chat comes alive as CSV" })).toBeInTheDocument();
  });
});

describe("a card's own filters", () => {
  /** The two cards under test, one scoped and one not. */
  const people = {
    days: ["2024-01-01", "2024-01-02"],
    authors: [
      { id: "u1", name: "Alice", msgs: 20 },
      { id: "u2", name: "Bob", msgs: 12 },
    ],
    cells: [
      [0, 0, 10, 50, 2, 1, 1],
      [1, 0, 6, 30, 1, 0, 0],
      [0, 1, 8, 40, 3, 2, 0],
      [1, 1, 2, 10, 1, 1, 0],
    ],
    edges: [
      [0, 1, 5],
      [1, 0, 3],
    ],
    response: [
      [0, 120, 5],
      [1, 60, 3],
    ],
    starters: [
      [0, 4],
      [1, 2],
    ],
    editSpeed: [
      [0, 90, 2],
      [1, 45, 2],
    ],
    authorDistinct: [40, 25],
  } as unknown as Payload;

  function renderCards(scopes: Record<string, { active: boolean[] }>) {
    const base = initialFilters(people);
    render(
      <>
        <PanelScopeProvider filters={base} scopes={scopes}>
          <Leaderboard payload={people} filters={base} />
        </PanelScopeProvider>
        <PanelScopeProvider filters={base} scopes={scopes}>
          <ReplyMatrix payload={people} filters={base} />
        </PanelScopeProvider>
      </>,
    );
    return {
      leader: screen.getByText(/messages across/).textContent,
      neighbour: screen.getByText(/cells · .* replies/).textContent,
    };
  }

  it("moves the scoped card's numbers and leaves its neighbour's alone", () => {
    // Both cards honour the author selection, so only the scope separates them.
    const global = renderCards({});
    expect(global.leader).toContain("26 messages across 2 authors");

    cleanup();
    const scoped = renderCards({ "who-talks-the-most": { active: [true, false] } });

    // The scoped card now reads Alice alone…
    expect(scoped.leader).toContain("16 messages across 1 authors");
    // …and the card beside it never moved.
    expect(scoped.neighbour).toBe(global.neighbour);
    expect(scoped.neighbour).toContain("4 cells");
  });
});
