import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import type { Action, Filters } from "../filters/reducer";
import { initialFilters } from "../filters/reducer";

import type { Payload } from "../api/types";
import { Leaderboard } from "./Leaderboard";
import { PanelScopeProvider } from "./panelScope";
import { ReplyMatrix } from "./ReplyMatrix";
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
  meta: { types: [[0, "default", 2]], stale: false, can_admin: false, timezone: "UTC", total: 2 },
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

  it("offers each chart card an export built from the chart's own rows", () => {
    renderSection(TimeSection);

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
