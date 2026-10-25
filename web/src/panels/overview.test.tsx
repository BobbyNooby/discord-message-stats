import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Cell } from "../api/types";
import { initialFilters } from "../filters/reducer";
import { emptyFourDayPayload, fourDayPayload } from "../test/payload";
import { MessagesPerYear } from "./MessagesPerYear";
import { PanelSection } from "./Sections";
import { ShareOfVoice } from "./ShareOfVoice";
import { StatCards } from "./StatCards";

/** The card a label sits in, so two cards with the same figure cannot be confused. */
function card(label: string): HTMLElement {
  const heading = screen.getByText(label);
  const wrapper = heading.parentElement;
  if (!wrapper) throw new Error(`no card wrapper for ${label}`);
  return wrapper;
}

describe("stat cards", () => {
  it("prints the six figures the filtered cells add up to", () => {
    const payload = fourDayPayload();
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
    const payload = fourDayPayload();
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
    const payload = emptyFourDayPayload();
    render(<StatCards payload={payload} filters={initialFilters(payload)} />);

    expect(screen.getAllByText("—")).toHaveLength(6);
    expect(document.body.textContent).not.toMatch(/NaN/);
    expect(screen.getByText("No messages yet — ingest, or upload a database from the Admin board.")).toBeInTheDocument();
  });

  it("never prints NaN when every author is switched off", () => {
    const payload = fourDayPayload();
    render(
      <StatCards
        payload={payload}
        filters={{ ...initialFilters(payload), active: [false, false] }}
      />,
    );

    expect(within(card("Messages")).getByText("0")).toBeInTheDocument();
    expect(within(card("Avg length")).getByText("—")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
    expect(screen.getByText("No authors selected — switch one back on in the filters.")).toBeInTheDocument();
  });
});

describe("share of voice", () => {
  it("states the filtered total and the author count it drew", () => {
    const payload = fourDayPayload();
    render(<ShareOfVoice payload={payload} filters={initialFilters(payload)} />);
    expect(screen.getByText("6 messages · 2 authors")).toBeInTheDocument();
  });

  it("folds an author tail into one Others wedge so the doughnut keeps few categories", () => {
    const payload = fourDayPayload({
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
    const payload = emptyFourDayPayload();
    render(<ShareOfVoice payload={payload} filters={initialFilters(payload)} />);
    expect(screen.getByText("No messages yet — ingest, or upload a database from the Admin board.")).toBeInTheDocument();
  });
});

describe("messages per year", () => {
  it("bars the same filtered cells the doughnuts read", () => {
    const payload = fourDayPayload();
    render(<MessagesPerYear payload={payload} filters={initialFilters(payload)} />);
    expect(screen.getByText("6 messages · 2 years · peak 2023")).toBeInTheDocument();
  });
});

describe("the overview section", () => {
  it("lays out all four panels and keeps them honest under a year filter", () => {
    const payload = fourDayPayload();
    render(<PanelSection section="overview" payload={payload} filters={{ ...initialFilters(payload), years: [2023] }} />);

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
    const payload = emptyFourDayPayload();
    render(<PanelSection section="overview" payload={payload} filters={initialFilters(payload)} />);

    expect(screen.getAllByText("No messages yet — ingest, or upload a database from the Admin board.")).toHaveLength(4);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("renders an empty state when every author is switched off", () => {
    const payload = fourDayPayload();
    render(
      <PanelSection section="overview"
        payload={payload}
        filters={{ ...initialFilters(payload), active: [false, false] }}
      />,
    );

    expect(screen.getAllByText("No authors selected — switch one back on in the filters.")).toHaveLength(4);
    expect(screen.getByText("0 messages · 0 authors")).toBeInTheDocument();
  });
});
