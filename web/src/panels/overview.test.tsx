import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Cell, Payload } from "../api/types";
import { initialFilters } from "../filters/reducer";
import { MessagesPerYear } from "./MessagesPerYear";
import { OverviewSection } from "./OverviewSection";
import { ShareOfVoice } from "./ShareOfVoice";
import { StatCards } from "./StatCards";

/**
 * A four-day, two-author payload. Small on purpose: every expected number below
 * can be checked by hand from `cells`, so a regression is a wrong number rather
 * than a moved one.
 */
function makePayload(over: Partial<Payload> = {}): Payload {
  const base: Payload = {
    meta: {
      total: 6,
      source_count: 4,
      stale: false,
      timezone: "Asia/Kuala_Lumpur",
      computed_at: "2024-01-02T00:00:00Z",
      authors: 2,
      cells: 4,
      heat_cells: 3,
      active_days: 4,
      firstLocal: "2023-01-01",
      lastLocal: "2024-01-01",
      stopwords: 12,
      kept_words: 500,
      payload_kb: 12,
      payload_gzip_kb: 3,
      types: [],
    },
    authors: [
      { id: "u1", name: "Alice", msgs: 3 },
      { id: "u2", name: "Bob", msgs: 3 },
    ],
    days: ["2023-01-01", "2023-01-15", "2023-06-01", "2024-01-01"],
    cells: [
      [0, 0, 2, 10, 1, 0, 0],
      [1, 0, 1, 5, 0, 1, 0],
      [2, 1, 2, 8, 0, 0, 1],
      [3, 1, 1, 4, 1, 0, 0],
    ],
    heat: [
      [0, 9, 0, 2023, 4],
      [1, 10, 1, 2024, 2],
      [3, 20, 0, 2023, 1],
    ],
    edges: [],
    response: [],
    editSpeed: [],
    starters: [],
    attachments: [],
    words: [],
    wordAuthors: {},
    authorWordTotals: [],
    authorDistinct: [],
    identities: [],
    linkDomains: [],
    linkCells: [],
    topLinks: [],
    providers: [],
    embedTypes: [],
    linkStats: { msgs: 0, domains: 0, both: 0 },
    emoji: [],
    reactions: [],
    types: [],
    tz: { name: "Asia/Kuala_Lumpur", label: "Asia/Kuala_Lumpur (UTC+8)" },
    channel_hint: "#general",
  };
  return { ...base, ...over };
}

function emptyPayload(): Payload {
  return makePayload({
    days: [],
    cells: [],
    heat: [],
    meta: { ...makePayload().meta, cells: 0, heat_cells: 0, firstLocal: null, lastLocal: null },
  });
}

/** The card a label sits in, so two cards with the same figure cannot be confused. */
function card(label: string): HTMLElement {
  const heading = screen.getByText(label);
  const wrapper = heading.parentElement;
  if (!wrapper) throw new Error(`no card wrapper for ${label}`);
  return wrapper;
}

describe("stat cards", () => {
  it("prints the six figures the filtered cells add up to", () => {
    const payload = makePayload();
    render(<StatCards payload={payload} filters={initialFilters(payload)} />);

    expect(within(card("Messages")).getByText("6")).toBeInTheDocument();
    expect(within(card("Authors")).getByText("2")).toBeInTheDocument();
    expect(within(card("Active days")).getByText("4")).toBeInTheDocument();
    expect(within(card("Characters")).getByText("27")).toBeInTheDocument();
    expect(within(card("Avg length")).getByText("4.5 ch")).toBeInTheDocument();
    expect(within(card("Rollup size")).getByText("4")).toBeInTheDocument();
    // The subtitle carries the same headline numbers as text, not only as colour.
    expect(screen.getByText("6 messages · 2 authors · 4 active days")).toBeInTheDocument();
  });

  it("re-aggregates for the year filter without touching the network", () => {
    const payload = makePayload();
    const { rerender } = render(
      <StatCards payload={payload} filters={initialFilters(payload)} />,
    );
    expect(within(card("Messages")).getByText("6")).toBeInTheDocument();

    rerender(
      <StatCards payload={payload} filters={{ ...initialFilters(payload), years: [2023] }} />,
    );
    // 2 + 1 + 2 = 5 across three days of 2023.
    expect(within(card("Messages")).getByText("5")).toBeInTheDocument();
    expect(within(card("Active days")).getByText("3")).toBeInTheDocument();
    expect(within(card("Messages")).getByText("filtered")).toBeInTheDocument();
    expect(screen.getByText("5 messages · 2 authors · 3 active days")).toBeInTheDocument();
  });

  it("shows six dashes rather than six zeroes for an empty payload", () => {
    const payload = emptyPayload();
    render(<StatCards payload={payload} filters={initialFilters(payload)} />);

    expect(screen.getAllByText("—")).toHaveLength(6);
    expect(document.body.textContent).not.toMatch(/NaN/);
    expect(screen.getByText("No data for this filter")).toBeInTheDocument();
  });

  it("never prints NaN when every author is switched off", () => {
    const payload = makePayload();
    render(
      <StatCards
        payload={payload}
        filters={{ ...initialFilters(payload), active: [false, false] }}
      />,
    );

    expect(within(card("Messages")).getByText("0")).toBeInTheDocument();
    expect(within(card("Avg length")).getByText("—")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
    expect(screen.getByText("No authors selected")).toBeInTheDocument();
  });
});

describe("share of voice", () => {
  it("states the filtered total and the author count it drew", () => {
    const payload = makePayload();
    render(<ShareOfVoice payload={payload} filters={initialFilters(payload)} />);
    expect(screen.getByText("6 messages · 2 authors")).toBeInTheDocument();
  });

  it("folds an author tail into one Others wedge so the doughnut keeps few categories", () => {
    const payload = makePayload({
      authors: Array.from({ length: 8 }, (_, index) => ({
        id: `u${index}`,
        name: `A${index}`,
        msgs: 8 - index,
      })),
      days: Array.from({ length: 8 }, (_, index) => `2024-01-0${index + 1}`),
      cells: Array.from(
        { length: 8 },
        (_, index) => [index, index, 8 - index, 10, 0, 0, 0] as Cell,
      ),
    });
    render(<ShareOfVoice payload={payload} filters={initialFilters(payload)} />);
    expect(screen.getByText("36 messages · 8 authors · top 5, rest as Others")).toBeInTheDocument();
  });

  it("renders an empty state rather than a chart with no data", () => {
    const payload = emptyPayload();
    render(<ShareOfVoice payload={payload} filters={initialFilters(payload)} />);
    expect(screen.getByText("No data for this filter")).toBeInTheDocument();
  });
});

describe("messages per year", () => {
  it("bars the same filtered cells the doughnuts read", () => {
    const payload = makePayload();
    render(<MessagesPerYear payload={payload} filters={initialFilters(payload)} />);
    expect(screen.getByText("6 messages · 2 years · peak 2023")).toBeInTheDocument();
  });
});

describe("the overview section", () => {
  it("lays out all four panels and keeps them honest under a year filter", () => {
    const payload = makePayload();
    render(<OverviewSection payload={payload} filters={{ ...initialFilters(payload), years: [2023] }} />);

    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    for (const title of [
      "Stat cards",
      "Share of voice",
      "Share of voice, year by year",
      "Messages per year",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText("5 messages · 2 authors · 3 active days")).toBeInTheDocument();
    expect(screen.getByText("5 messages · 1 year · one doughnut per year")).toBeInTheDocument();
    expect(screen.getByText("5 messages · 1 year · peak 2023")).toBeInTheDocument();
  });

  it("renders an empty state for a payload with zero cells", () => {
    const payload = emptyPayload();
    render(<OverviewSection payload={payload} filters={initialFilters(payload)} />);

    expect(screen.getAllByText("No data for this filter")).toHaveLength(4);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("renders an empty state when every author is switched off", () => {
    const payload = makePayload();
    render(
      <OverviewSection
        payload={payload}
        filters={{ ...initialFilters(payload), active: [false, false] }}
      />,
    );

    expect(screen.getAllByText("No authors selected")).toHaveLength(4);
    expect(screen.getByText("0 messages · 0 authors")).toBeInTheDocument();
  });
});
