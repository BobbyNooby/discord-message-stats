import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoticeProvider } from "./Notice";
import { Panel } from "./Panel";
import { EChart } from "../lib/echart";

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
