import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoticeProvider } from "./Notice";
import { CARD_COLUMNS, GlobalOnlyBadge, Panel } from "./Panel";
import { EChart } from "../lib/echart";
import { TERMS } from "../lib/glossary";

/**
 * A card exports the aggregate it is already drawing, and says what it wrote.
 * There is no endpoint behind this: the rows are the ones in hand.
 */
describe("<Panel> csv export", () => {
  afterEach(() => vi.unstubAllGlobals());

  const rows: (string | number)[][] = [
    ["word", "count"],
    ["cat", 63],
  ];

  function renderPanel() {
    return render(
      <NoticeProvider>
        <Panel title="Words that lift" csv={{ name: "Words that lift", rows }}>
          <p>chart</p>
        </Panel>
      </NoticeProvider>,
    );
  }

  it("offers one export control, named for its card", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Export Words that lift as CSV" })).toBeInTheDocument();
  });

  it("downloads the rows it already has and acknowledges the file", () => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Export Words that lift as CSV" }));

    expect(click).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/words-that-lift\.csv — 1 rows/);
    click.mockRestore();
  });

  it("says so when the browser refuses the download", () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        throw new Error("blocked");
      }),
      revokeObjectURL: vi.fn(),
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Export Words that lift as CSV" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/could not export/i);
  });

  it("offers nothing to export when a card has no rows behind it", () => {
    render(
      <Panel title="Chat health">
        <p>gauges</p>
      </Panel>,
    );

    expect(screen.queryByRole("button", { name: /as CSV/ })).toBeNull();
  });

  it("takes its rows from the chart inside it, with no prop to forget", async () => {
    render(
      <NoticeProvider>
        <Panel title="Cumulative growth">
          <EChart
            option={{
              xAxis: { type: "category", data: ["Jan", "Feb"] },
              series: [{ name: "TOTAL", type: "line", data: [5, 9] }],
            }}
          />
        </Panel>
      </NoticeProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "Export Cumulative growth as CSV" }),
    ).toBeInTheDocument();
  });
});

/**
 * The owner's layout rule: cards are wide, so they never pack into three
 * columns. One column below the shell's 860px breakpoint, exactly two above it.
 */
describe("CARD_COLUMNS", () => {
  it("is one column on a phone and never a three-column step", () => {
    const classes = CARD_COLUMNS.split(" ");
    expect(classes).toContain("columns-1");
    expect(classes).toContain("md:columns-2");
    expect(classes.filter((name) => name.includes("columns-3"))).toEqual([]);
    expect(classes.filter((name) => name.startsWith("xl:"))).toEqual([]);
  });
});

describe("<Panel> definitions", () => {
  it("says what the card shows, from the one glossary", () => {
    render(
      <Panel title="Cumulative growth">
        <p>chart</p>
      </Panel>,
    );

    expect(screen.getByText(/every author's running total/i)).toBeInTheDocument();
  });

  it("carries a term's definition beside the title, without renaming the heading", () => {
    render(
      <Panel title="Whose word is it" help={TERMS.lift}>
        <p>chart</p>
      </Panel>,
    );

    expect(screen.getByRole("heading", { name: "Whose word is it" })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: TERMS.lift })).toBeInTheDocument();
  });

  it("says why a card cannot honour the time filter", () => {
    render(
      <Panel title="Message types" badge={<GlobalOnlyBadge what="Message types" />}>
        <p>chart</p>
      </Panel>,
    );

    expect(screen.getByText("global only")).toHaveAttribute(
      "title",
      expect.stringContaining("no date column"),
    );
  });
});
