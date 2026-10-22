import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const instance = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock("echarts", () => ({
  init: vi.fn(() => instance),
  use: vi.fn(),
}));

import * as echarts from "echarts";

import { PanelCsvContext } from "../components/panelCsv";
import { EChart } from "./echart";

describe("<EChart>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initialises once, updates options, and disposes on unmount", () => {
    const { rerender, unmount } = render(<EChart option={{ series: [] }} />);
    expect(echarts.init).toHaveBeenCalledTimes(1);

    rerender(<EChart option={{ series: [{ type: "bar", data: [1] }] }} />);
    expect(echarts.init).toHaveBeenCalledTimes(1); // never re-init on a prop change
    expect(instance.setOption).toHaveBeenCalled();

    unmount();
    expect(instance.dispose).toHaveBeenCalledTimes(1);
  });

  it("leaves the card's export to the main chart when told it is a second one", () => {
    const register = vi.fn();
    const bars = { xAxis: { type: "category" as const, data: ["Ada"] }, series: [{ type: "bar" as const, data: [3] }] };
    const months = { xAxis: { type: "category" as const, data: ["2026-01"] }, series: [{ type: "bar" as const, data: [9] }] };
    const { unmount } = render(
      <PanelCsvContext.Provider value={register}>
        <EChart option={bars} />
        <EChart option={months} exportsCsv={false} />
      </PanelCsvContext.Provider>,
    );
    const published = register.mock.calls.map(([rows]) => JSON.stringify(rows));
    expect(published.some((rows) => rows.includes("Ada"))).toBe(true);
    expect(published.some((rows) => rows.includes("2026-01"))).toBe(false);
    register.mockClear();
    unmount();
    // Only the chart that published clears its rows on the way out.
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("passes notMerge so a removed series really disappears", () => {
    const { rerender } = render(<EChart option={{ series: [{ type: "bar" }] }} />);
    instance.setOption.mockClear();
    rerender(<EChart option={{ series: [] }} />);
    expect(instance.setOption).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("names the chart after the heading of the panel it sits in", () => {
    render(
      <section>
        <h2>Share of voice</h2>
        <EChart option={{ series: [] }} />
      </section>,
    );

    expect(screen.getByRole("img", { name: "Share of voice" })).toBeInTheDocument();
  });

  it("falls back to a name when there is no heading to borrow", () => {
    render(<EChart option={{ series: [] }} />);

    expect(screen.getByRole("img", { name: "chart" })).toBeInTheDocument();
  });

  it("states how many points it drew, so the pie's eight-slice rule is checkable", () => {
    const { rerender } = render(<EChart option={{ series: [{ type: "bar", data: [1, 2, 3] }] }} />);
    expect(screen.getByRole("img", { name: "chart" })).toHaveAttribute("data-points", "3");

    rerender(<EChart option={{ series: [{ type: "pie", data: [1, 2] }] }} />);
    expect(screen.getByRole("img", { name: "chart" })).toHaveAttribute("data-points", "2");
  });

  it("draws without animation when the reader asked for less motion", () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;

    render(<EChart option={{ series: [{ type: "bar", data: [1] }] }} />);

    expect(instance.setOption).toHaveBeenCalledWith(
      expect.objectContaining({ animation: false }),
      true,
    );
    delete (window as { matchMedia?: unknown }).matchMedia;
  });
});
