import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Payload } from "../api/types";
import { initialFilters } from "../filters/reducer";
import { Activity } from "./Activity";
import { Cumulative } from "./Cumulative";
import { Conversational } from "./Conversational";
import { Heat } from "./Heat";
import { Season } from "./Season";
import { Stream } from "./Stream";
import { TimeOfDay } from "./TimeOfDay";
import { TimeSection } from "./TimeSection";
import { bucketSeries } from "./timeAggregates";

/**
 * jsdom cannot paint a canvas and the shared setup already stubs ECharts, so
 * this file swaps in a recording instance: the assertion then reads the option
 * the panel actually asked for — the x axis, the series — rather than a proxy.
 */
const charts = vi.hoisted(() => {
  type Recorded = {
    options: any[];
    setOption: (option: any) => void;
    resize: () => void;
    dispose: () => void;
    on: () => void;
    off: () => void;
    getOption: () => Record<string, never>;
  };
  const instances: Recorded[] = [];
  return {
    instances,
    create(): Recorded {
      const options: any[] = [];
      const instance: Recorded = {
        options,
        setOption(option: any) {
          options.push(option);
        },
        resize() {},
        dispose() {},
        on() {},
        off() {},
        getOption: () => ({}),
      };
      instances.push(instance);
      return instance;
    },
  };
});

vi.mock("echarts", () => ({
  init: () => charts.create(),
  use: () => {},
  default: { init: () => charts.create(), use: () => {} },
}));

/** The option the most recently mounted chart was last given. */
function lastOption(): any {
  const instance = charts.instances[charts.instances.length - 1];
  if (!instance || !instance.options.length) throw new Error("no chart option was recorded");
  return instance.options[instance.options.length - 1];
}

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

const all = (payload: Payload) => initialFilters(payload);
const none = (payload: Payload) => ({ ...initialFilters(payload), active: payload.authors.map(() => false) });

beforeEach(() => {
  charts.instances.length = 0;
});

describe("the bucket selector", () => {
  it("changes the x-axis cardinality, day to month to year", () => {
    const payload = makePayload();

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
    const payload = makePayload();
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
    const payload = makePayload();
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
    const payload = makePayload();
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
    const payload = makePayload();
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
    const payload = makePayload();
    render(<Conversational payload={payload} filters={{ ...all(payload), bucket: "month" }} />);

    // 2023-01: 1 reply of 3 messages; 2023-06: 0 of 2; 2024-01: 1 of 1.
    expect(lastOption().series[0].data).toEqual([33.33, 0, 100]);
    expect(screen.getByText(/2 replies · 33.3% of 6 messages across 3 months/)).toBeInTheDocument();
  });
});

describe("when the chat comes alive", () => {
  it("reads rollup_heat and honours the year filter", () => {
    const payload = makePayload();
    const { rerender } = render(<Heat payload={payload} filters={all(payload)} />);
    expect(screen.getByText(/^7 messages · Asia\/Kuala_Lumpur \(UTC\+8\)/)).toBeInTheDocument();
    expect(lastOption().series[0].data).toHaveLength(7 * 24);

    rerender(<Heat payload={payload} filters={{ ...all(payload), years: [2023] }} />);
    expect(screen.getByText(/^5 messages · Asia\/Kuala_Lumpur \(UTC\+8\)/)).toBeInTheDocument();
  });

  it("marks the busiest hour on the map", () => {
    const payload = makePayload();
    render(<Heat payload={payload} filters={all(payload)} />);
    expect(screen.getByText(/busiest Sun 09:00/)).toBeInTheDocument();
  });
});

describe("what time of day", () => {
  it("toggles the bar chart and the polar rose", async () => {
    const payload = makePayload();
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
    const payload = makePayload();
    render(<Season payload={payload} filters={all(payload)} />);
    expect(lastOption().series[0].data).toHaveLength(12);
    expect(screen.getByText("6 messages pooled over 2 years · peak Jan")).toBeInTheDocument();
  });
});

describe("who was talking, when", () => {
  it("stacks the authors into a streamgraph", () => {
    const payload = makePayload();
    render(<Stream payload={payload} filters={{ ...all(payload), bucket: "year" }} />);
    const series = lastOption().series;
    expect(series.map((entry: any) => entry.name)).toEqual(["Alice", "Bob"]);
    expect(series[0].stack).toBe("s");
    expect(series[0].smooth).toBe(true);
    expect(series[0].lineStyle.width).toBe(0);
  });
});

describe("the time and rhythm section", () => {
  it("renders all seven panels", () => {
    const payload = makePayload();
    render(<TimeSection payload={payload} filters={all(payload)} />);

    for (const title of [
      "Messages over time",
      "Cumulative growth",
      "How conversational",
      "When the chat comes alive",
      "What time of day",
      "Which month of the year",
      "Who was talking, when",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("renders an empty state in every panel for a payload with zero cells", () => {
    const payload = emptyPayload();
    render(<TimeSection payload={payload} filters={all(payload)} />);

    expect(screen.getAllByText("No data for this filter")).toHaveLength(7);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("renders an empty state in every panel when every author is switched off", () => {
    const payload = makePayload();
    render(<TimeSection payload={payload} filters={none(payload)} />);

    expect(screen.getAllByText("No authors selected")).toHaveLength(7);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
