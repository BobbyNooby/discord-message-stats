import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Payload } from "../../api/types";
import { initialFilters } from "../../app/reducer";
import { bucketSeries } from "../../selectors/time";
import { charts } from "../../test/echarts";
import { emptyFourDayPayload, fourDayPayload } from "../../test/payload";
import { Activity } from "./Activity";
import { Conversational } from "./Conversational";
import { Cumulative } from "./Cumulative";
import { Heat } from "./Heat";
import { Season } from "./Season";
import { PanelSection } from "../Sections";
import { Stream } from "./Stream";
import { TimeOfDay } from "./TimeOfDay";

/** The option the most recently mounted chart was last given. */
function lastOption(): any {
  const instance = charts.latest();
  if (!instance || !instance.options.length) throw new Error("no chart option was recorded");
  return instance.options[instance.options.length - 1];
}

const all = (payload: Payload) => initialFilters(payload);
const none = (payload: Payload) => ({ ...initialFilters(payload), active: payload.authors.map(() => false) });

describe("the bucket selector", () => {
  it("changes the x-axis cardinality, day to month to year", () => {
    const payload = fourDayPayload();

    // Four days, but two of them share a month, so the three charts differ.
    expect(bucketSeries(payload, { ...all(payload), bucket: "day" }).order).toEqual([
      "2023-01-01",
      "2023-01-15",
      "2023-06-01",
      "2024-01-01",
    ]);
    expect(bucketSeries(payload, { ...all(payload), bucket: "month" }).order).toEqual([
      "2023-01",
      "2023-06",
      "2024-01",
    ]);
    expect(bucketSeries(payload, { ...all(payload), bucket: "year" }).order).toEqual([
      "2023",
      "2024",
    ]);
  });

  it("reshapes the chart's x axis and says so in the subtitle", () => {
    const payload = fourDayPayload();
    const { rerender } = render(
      <Activity payload={payload} filters={{ ...all(payload), bucket: "day" }} />,
    );
    expect(lastOption().xAxis.data).toHaveLength(4);
    expect(screen.getByText(/6 messages across 4 days/)).toBeInTheDocument();

    rerender(<Activity payload={payload} filters={{ ...all(payload), bucket: "month" }} />);
    expect(lastOption().xAxis.data).toEqual(["2023-01", "2023-06", "2024-01"]);
    expect(screen.getByText(/6 messages across 3 months/)).toBeInTheDocument();

    rerender(<Activity payload={payload} filters={{ ...all(payload), bucket: "year" }} />);
    expect(lastOption().xAxis.data).toHaveLength(2);
    expect(screen.getByText(/6 messages across 2 years/)).toBeInTheDocument();
  });
});

describe("the author filter", () => {
  it("changes the number of series a trend panel draws", () => {
    const payload = fourDayPayload();
    const { rerender } = render(<Activity payload={payload} filters={all(payload)} />);
    expect(lastOption().series).toHaveLength(3); // Alice + Bob + TOTAL
    expect(lastOption().series.map((series: any) => series.name)).toEqual([
      "Alice",
      "Bob",
      "TOTAL",
    ]);

    rerender(
      <Activity payload={payload} filters={{ ...all(payload), active: [true, false] }} />,
    );
    expect(lastOption().series.map((series: any) => series.name)).toEqual(["Alice", "TOTAL"]);
  });
});

describe("messages over time", () => {
  it("toggles stacked area, multi-line and total-only", async () => {
    const payload = fourDayPayload();
    render(<Activity payload={payload} filters={all(payload)} />);

    expect(lastOption().series[0].stack).toBe("t");
    expect(lastOption().series[0].areaStyle.opacity).toBeCloseTo(0.62);

    await userEvent.click(screen.getByRole("button", { name: "Lines" }));
    expect(lastOption().series[0].stack).toBeUndefined();
    expect(lastOption().series[0].lineStyle.width).toBeCloseTo(1.8);

    await userEvent.click(screen.getByRole("button", { name: "Total" }));
    expect(lastOption().series).toHaveLength(1);
    expect(lastOption().series[0].name).toBe("TOTAL");
    expect(screen.getByRole("button", { name: "Total" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Stacked" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("cumulative growth", () => {
  it("stacks every author and draws the running total on top", () => {
    const payload = fourDayPayload();
    render(<Cumulative payload={payload} filters={{ ...all(payload), bucket: "month" }} />);

    const series = lastOption().series;
    expect(series.map((entry: any) => entry.name)).toEqual(["Alice", "Bob", "TOTAL"]);
    expect(series[0].data).toEqual([3, 3, 3]); // Alice's running totals, stacked
    expect(series[2].data).toEqual([3, 5, 6]); // the grand total only grows
    expect(series[2].data[series[2].data.length - 1]).toBe(6);
  });
});

describe("how conversational", () => {
  it("plots replies as a percentage of messages", () => {
    const payload = fourDayPayload();
    render(<Conversational payload={payload} filters={{ ...all(payload), bucket: "month" }} />);

    // 2023-01: 1 reply of 3 messages; 2023-06: 0 of 2; 2024-01: 1 of 1.
    expect(lastOption().series[0].data).toEqual([33.33, 0, 100]);
    expect(screen.getByText(/2 replies · 33.3% of 6 messages across 3 months/)).toBeInTheDocument();
  });
});

describe("when the chat comes alive", () => {
  it("reads rollup_heat and honours the year filter", () => {
    const payload = fourDayPayload();
    const { rerender } = render(<Heat payload={payload} filters={all(payload)} />);
    expect(screen.getByText(/^7 messages · Europe\/London \(UTC\+0\)/)).toBeInTheDocument();
    expect(lastOption().series[0].data).toHaveLength(7 * 24);

    rerender(<Heat payload={payload} filters={{ ...all(payload), years: [2023] }} />);
    expect(screen.getByText(/^5 messages · Europe\/London \(UTC\+0\)/)).toBeInTheDocument();
  });

  it("marks the busiest hour on the map", () => {
    const payload = fourDayPayload();
    render(<Heat payload={payload} filters={all(payload)} />);
    expect(screen.getByText(/busiest Sun 09:00/)).toBeInTheDocument();
  });

  it("lays its colour legend along the bottom instead of standing it over the map", () => {
    const payload = fourDayPayload();
    render(<Heat payload={payload} filters={all(payload)} />);
    const legend = lastOption().visualMap;
    expect(legend.orient).toBe("horizontal");
    // A continuous legend's itemHeight is its length whichever way it lies.
    expect(legend.itemHeight).toBeGreaterThan(legend.itemWidth);
  });
});

describe("what time of day", () => {
  it("toggles the bar chart and the polar rose", async () => {
    const payload = fourDayPayload();
    render(<TimeOfDay payload={payload} filters={all(payload)} />);

    expect(lastOption().series[0].coordinateSystem).toBeUndefined();
    expect(lastOption().xAxis.data).toHaveLength(24);

    await userEvent.click(screen.getByRole("button", { name: "Rose" }));
    expect(lastOption().series[0].coordinateSystem).toBe("polar");
    expect(lastOption().angleAxis.data).toHaveLength(24);
    expect(lastOption().angleAxis.startAngle).toBe(90);
    expect(screen.getByRole("button", { name: "Rose" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("which month of the year", () => {
  it("pools every year into twelve bars", () => {
    const payload = fourDayPayload();
    render(<Season payload={payload} filters={all(payload)} />);
    expect(lastOption().series[0].data).toHaveLength(12);
    expect(screen.getByText("6 messages pooled over 2 years · peak Jan")).toBeInTheDocument();
  });
});

describe("who was talking, when", () => {
  it("stacks the authors into a streamgraph", () => {
    const payload = fourDayPayload();
    render(<Stream payload={payload} filters={{ ...all(payload), bucket: "year" }} />);
    const series = lastOption().series;
    expect(series.map((entry: any) => entry.name)).toEqual(["Alice", "Bob"]);
    expect(series[0].stack).toBe("s");
    expect(series[0].smooth).toBe(true);
    expect(series[0].lineStyle.width).toBe(0);
  });
});

describe("the time and rhythm section", () => {
  it("renders all eight panels, the calendar among them", () => {
    const payload = fourDayPayload();
    render(<PanelSection section="time" payload={payload} filters={all(payload)} />);

    for (const title of [
      "Messages over time",
      "Cumulative growth",
      "How conversational",
      "Every day, six years",
      "When the chat comes alive",
      "What time of day",
      "Which month of the year",
      "Who was talking, when",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("renders an empty state in every panel for a payload with zero cells", () => {
    const payload = emptyFourDayPayload();
    render(<PanelSection section="time" payload={payload} filters={all(payload)} />);

    expect(screen.getAllByText("No messages yet — ingest, or upload a database from the Admin board.")).toHaveLength(7);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("renders an empty state in every panel when every author is switched off", () => {
    const payload = fourDayPayload();
    render(<PanelSection section="time" payload={payload} filters={none(payload)} />);

    expect(screen.getAllByText("No authors selected — switch one back on in the filters.")).toHaveLength(7);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});

describe("the clock the panels write", () => {
  it("follows ui.time_format, so the setting is not dead", () => {
    const payload = fourDayPayload();
    const { rerender } = render(<TimeOfDay payload={payload} filters={all(payload)} />);
    // The fixture's default is the 24-hour clock every panel drew before.
    expect(screen.getByText(/peak \d{2}:00/)).toBeInTheDocument();

    const twelve = { ...payload, meta: { ...payload.meta, time_format: "12h" } } as Payload;
    rerender(<TimeOfDay payload={twelve} filters={all(twelve)} />);
    expect(screen.getByText(/peak \d{1,2}(am|pm)/)).toBeInTheDocument();
    expect(screen.queryByText(/peak \d{2}:00/)).toBeNull();
  });
});
