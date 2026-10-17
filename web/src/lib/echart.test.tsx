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
});
