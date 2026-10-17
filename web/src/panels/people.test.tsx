import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Payload } from "../api/types";
import { EMPTY_FILTERS, initialFilters, type Filters } from "../filters/reducer";
import { EditRate } from "./EditRate";
import { Leaderboard } from "./Leaderboard";
import { PeopleSection } from "./PeopleSection";
import { ReplyMatrix } from "./ReplyMatrix";
import { ResponseTime } from "./ResponseTime";
import { matrixData } from "./people";

/**
 * jsdom has no canvas, so zrender cannot paint and a real chart instance throws
 * on `setOption`. The mock keeps <EChart>'s lifecycle honest and, better, lets
 * these tests read the option the panels actually build — which is where a NaN
 * or a `Math.max()` of an empty array would show up.
 */
const { options } = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock("echarts", () => ({
  init: () => ({
    setOption: (option: unknown) => {
      options.push(option);
    },
    resize: () => {},
    dispose: () => {},
  }),
}));

/** Only the keys the People panels read. */
const payload = {
  days: ["2024-01-01", "2024-01-02", "2025-03-01"],
  authors: [
    { id: "u1", name: "Alice", msgs: 20 },
    { id: "u2", name: "Bob", msgs: 12 },
  ],
  // day, author, msgs, chars, replies, media, edits
  cells: [
    [0, 0, 10, 50, 2, 1, 1],
    [1, 0, 6, 30, 1, 0, 0],
    [2, 0, 4, 20, 0, 0, 1],
    [0, 1, 8, 40, 3, 2, 0],
    [1, 1, 2, 10, 1, 1, 0],
    [2, 1, 2, 10, 1, 0, 2],
  ],
  // rollup_reply rows: [parent, child, messages]
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

const nothing = {
  days: [],
  authors: [],
  cells: [],
  edges: [],
  response: [],
  starters: [],
  editSpeed: [],
  authorDistinct: [],
} as unknown as Payload;

const singleDay = {
  ...payload,
  days: ["2025-01-01"],
  cells: [
    [0, 0, 5, 20, 2, 1, 1],
    [0, 1, 3, 10, 1, 0, 0],
  ],
  edges: [[0, 1, 2]],
} as unknown as Payload;

function withFilters(overrides: Partial<Filters> = {}): Filters {
  return { ...initialFilters(payload), ...overrides };
}

const TITLES = [
  "Who talks the most",
  "How fast people reply",
  "Who replies to whom",
  "Reply balance",
  "Who starts conversations",
  "Author profile",
  "Reply matrix",
  "Volume by author and year",
  "How bursty is everyone",
  "Who proofreads",
];

/** Every number a panel handed ECharts, checked for NaN/Infinity. */
function nonFinite(value: unknown, path = "$"): string[] {
  if (typeof value === "number") return Number.isFinite(value) ? [] : [`${path}=${value}`];
  if (Array.isArray(value)) return value.flatMap((item, index) => nonFinite(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => nonFinite(item, `${path}.${key}`));
  }
  return [];
}

beforeEach(() => {
  options.length = 0;
});

describe("global-only panels (§11.2)", () => {
  it("badges the reply matrix and holds its cell count still, while the leaderboard moves", () => {
    // The registry lists no time dimension for this card, so the badge is a
    // property of the card, not of whichever filter happens to be on.
    const matrix = render(<ReplyMatrix payload={payload} filters={withFilters()} />);
    const unfiltered = screen.getByText(/cells · .* replies/).textContent;
    expect(unfiltered).toContain("4 cells"); // 2 visible authors
    expect(screen.getByText("global only")).toBeInTheDocument();
    matrix.unmount();

    render(<ReplyMatrix payload={payload} filters={withFilters({ years: [2025] })} />);
    expect(screen.getByText("global only")).toBeInTheDocument();
    expect(screen.getByText(/cells · .* replies/).textContent).toBe(unfiltered);
  });

  it("leaves the leaderboard free to follow the time filter", () => {
    const leaderboard = render(<Leaderboard payload={payload} filters={withFilters()} />);
    expect(screen.getByText(/32 messages/)).toBeInTheDocument();
    leaderboard.unmount();

    render(<Leaderboard payload={payload} filters={withFilters({ years: [2025] })} />);
    expect(screen.getByText(/6 messages/)).toBeInTheDocument();
    expect(screen.queryByText("global only")).not.toBeInTheDocument();
  });

  it("badges the other rollups with no date column under a time filter", () => {
    const filters = withFilters({ years: [2024] });
    render(<PeopleSection payload={payload} filters={filters} />);
    // Reply pairs ×3 (network, matrix, balance), response, starter, edit speed.
    expect(screen.getAllByText("global only")).toHaveLength(5);
  });

  it("only badges the edit panel in the measure that has no date column", async () => {
    render(<EditRate payload={payload} filters={withFilters({ years: [2024] })} />);
    expect(screen.queryByText("global only")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "time to edit" }));
    expect(screen.getByText("global only")).toBeInTheDocument();
  });

  it("drops the matrix to 121 cells when the twelfth author is switched off", () => {
    const twelve = {
      ...payload,
      authors: Array.from({ length: 12 }, (_unused, index) => ({
        id: `u${index}`,
        name: `A${index}`,
        msgs: 1,
      })),
      cells: Array.from({ length: 12 }, (_unused, index) => [0, index, 1, 5, 0, 0, 0]),
      edges: [[0, 1, 1]],
    } as unknown as Payload;
    const all = { ...initialFilters(twelve) };
    expect(matrixData(twelve, all).k * matrixData(twelve, all).k).toBe(144);

    const dropped = { ...all, active: all.active.map((_on, index) => index !== 0) };
    const matrix = matrixData(twelve, dropped);
    expect(matrix.k).toBe(11);
    expect(matrix.k * matrix.k).toBe(121);
    expect(matrix.total).toBe(0); // the one edge lost its parent
  });
});

describe("filter semantics", () => {
  it("ignores the time filter only where the rollup has no date column", () => {
    const unfiltered = matrixData(payload, withFilters());
    const filtered = matrixData(payload, withFilters({ from: "2025-01-01", to: "2025-12-31" }));
    expect(filtered).toEqual(unfiltered);
    expect(unfiltered.k).toBe(2);
    expect(unfiltered.total).toBe(8);
  });

  it("ranks the leaderboard by whichever measure the filter names", () => {
    for (const [rankBy, leader] of [
      ["msgs", "Alice"],
      ["chars", "Alice"],
      ["media", "Bob"],
      ["replies", "Bob"],
    ] as const) {
      const view = render(<Leaderboard payload={payload} filters={withFilters({ rankBy })} />);
      const option = options.at(-1) as { yAxis: { data: string[] } };
      expect(option.yAxis.data.at(-1)).toBe(leader); // hbar sorts shortest first
      view.unmount();
    }
  });
});

describe("empty and degenerate payloads", () => {
  it("renders ten empty states and no NaN when there are no rows at all", () => {
    render(<PeopleSection payload={nothing} filters={EMPTY_FILTERS} />);
    for (const title of TITLES) expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getAllByText(/^No /)).toHaveLength(10);
    expect(document.body.textContent).not.toContain("NaN");
    expect(options.flatMap((option) => nonFinite(option))).toEqual([]);
  });

  it("does the same when every author is switched off", () => {
    const off = payload.authors.map(() => false);
    render(<PeopleSection payload={payload} filters={withFilters({ active: off })} />);
    expect(screen.getAllByText(/^No /)).toHaveLength(10);
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("renders a single day without dividing by zero", () => {
    render(<PeopleSection payload={singleDay} filters={initialFilters(singleDay)} />);
    expect(screen.getByText(/2 authors · 4 cells/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("NaN");
    expect(options.length).toBeGreaterThan(0); // the check below is not vacuous
    expect(options.flatMap((option) => nonFinite(option))).toEqual([]);
  });

  it("survives one author who never replied to anyone", () => {
    const lonely = { ...payload, edges: [], response: [], starters: [], editSpeed: [] } as unknown as Payload;
    render(<PeopleSection payload={lonely} filters={initialFilters(lonely)} />);
    expect(document.body.textContent).not.toContain("NaN");
    expect(options.length).toBeGreaterThan(0);
    expect(options.flatMap((option) => nonFinite(option))).toEqual([]);
  });

  it("explains what an average wait is, where the number is shown", () => {
    render(<ResponseTime payload={payload} filters={initialFilters(payload)} />);

    expect(screen.getByRole("note", { name: /average wait = the mean time/i })).toBeInTheDocument();
  });
});
