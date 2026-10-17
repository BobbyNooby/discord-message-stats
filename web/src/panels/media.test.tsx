import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no canvas, so the chart library is replaced with a recorder: the
// tests assert on the option each panel hands to ECharts.
const mocks = vi.hoisted(() => ({
  instance: { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() },
}));

vi.mock("echarts", () => ({
  init: vi.fn(() => mocks.instance),
  use: vi.fn(),
}));

import type { Payload } from "../api/types";
import { initialFilters } from "../filters/reducer";
import { selectTotals, selectVisibleCells } from "../filters/selectors";
import { Attachments } from "./Attachments";
import { ChatHealth } from "./ChatHealth";
import { Emoji } from "./Emoji";
import { MediaSection } from "./MediaSection";
import { MessageTypes } from "./MessageTypes";
import { Reactions } from "./Reactions";
import { RepliesVsStandalone } from "./RepliesVsStandalone";
import { TextVsMedia } from "./TextVsMedia";
import { healthGauges, mediaShare, replyShare, type MediaPanelProps } from "./mediaData";

type DoughnutOption = { series: { data: { value: number; name?: string }[] }[] };

/**
 * Five cells over four days and two authors. 2023 holds 180 messages (8 with
 * media, 18 replies); 2024 holds 30 (21 with media, 3 replies).
 */
function fixture(overrides: Partial<Payload> = {}): Payload {
  const base: Payload = {
    meta: {
      total: 210,
      source_count: 0,
      stale: false, can_admin: false,
      timezone: "UTC",
      week_start: "monday",
      time_format: "24h",
      computed_at: null,
      authors: 2,
      cells: 5,
      heat_cells: 0,
      active_days: 4,
      firstLocal: "2023-01-01",
      lastLocal: "2024-07-01",
      stopwords: 0,
      kept_words: 0,
      payload_kb: 1,
      payload_gzip_kb: 1,
      types: [
        [0, "Default", 206],
        [1, "Reply", 5],
        [2, "Call", 1],
        [3, "Pin", 0],
      ],
    },
    authors: [
      { id: "u1", name: "Alice", msgs: 140 },
      { id: "u2", name: "Bob", msgs: 70 },
    ],
    days: ["2023-01-01", "2023-06-01", "2024-03-01", "2024-07-01"],
    cells: [
      [0, 0, 100, 500, 10, 5, 2],
      [0, 1, 50, 200, 5, 0, 0],
      [1, 0, 30, 100, 3, 3, 1],
      [2, 1, 20, 80, 2, 20, 0],
      [3, 0, 10, 40, 1, 1, 0],
    ],
    heat: [],
    edges: [],
    response: [],
    editSpeed: [],
    starters: [],
    attachments: [
      ["image/png", 40],
      ["video/mp4", 9],
      ["application/pdf", 0],
    ],
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
    emoji: [
      ["😂", 30],
      ["❤️", 12],
    ],
    reactions: [
      ["👍", 22],
      ["🔥", 7],
    ],
    types: [
      [0, "Default", 206],
      [1, "Reply", 5],
      [2, "Call", 1],
      [3, "Pin", 0],
    ],
    tz: { name: "UTC", label: "UTC" },
    channel_hint: "general",
  };
  return { ...base, ...overrides };
}

function lastOption(): DoughnutOption {
  const calls = mocks.instance.setOption.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as DoughnutOption;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

describe("Media & reactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sums the four doughnut slices to the filtered total, with no double counting", () => {
    const payload = fixture();
    const filters = { ...initialFilters(payload), years: [2023] };
    const cells = selectVisibleCells(payload, filters);
    const total = selectTotals(payload, filters).msgs;

    const media = mediaShare(cells);
    const replies = replyShare(cells);
    expect(media.total).toBe(total);
    expect(replies.total).toBe(total);
    expect(media.media + media.textOnly).toBe(total);
    expect(replies.replies + replies.standalone).toBe(total);
    expect(total).toBe(180);
    expect(media.media).toBe(8);
    expect(replies.replies).toBe(18);

    render(<TextVsMedia payload={payload} filters={filters} />);
    expect(sum(lastOption().series[0].data.map((slice) => slice.value))).toBe(total);
    expect(screen.getByText(/8 of 180 messages \(4\.4%\)/)).toBeInTheDocument();
    cleanup();

    render(<RepliesVsStandalone payload={payload} filters={filters} />);
    expect(sum(lastOption().series[0].data.map((slice) => slice.value))).toBe(total);
    expect(screen.getByText(/18 of 180 messages \(10\.0%\)/)).toBeInTheDocument();
  });

  it("re-aggregates when the author switch changes, still summing to the filtered total", () => {
    const payload = fixture();
    const filters = { ...initialFilters(payload), active: [true, false] };
    const total = selectTotals(payload, filters).msgs;

    render(<TextVsMedia payload={payload} filters={filters} />);
    const slices = lastOption().series[0].data;
    expect(sum(slices.map((slice) => slice.value))).toBe(total);
    expect(total).toBe(140);
    expect(slices.map((slice) => slice.name)).toEqual(["with media", "text only"]);
  });

  it("holds Message types' numbers under a time filter, without badging the card", () => {
    const payload = fixture();
    const base = initialFilters(payload);
    // The explanation lives once in the Media section note, so the card itself
    // carries no badge; the number is still fixed under a time filter.
    const { unmount } = render(<MessageTypes payload={payload} filters={base} />);
    expect(screen.queryByText(/global only/i)).not.toBeInTheDocument();
    const unfiltered = screen.getByText(/212 messages across 3 types/).textContent;
    unmount();

    render(<MessageTypes payload={payload} filters={{ ...base, years: [2024] }} />);
    expect(screen.queryByText(/global only/i)).not.toBeInTheDocument();
    expect(screen.getByText(/212 messages across 3 types/).textContent).toBe(unfiltered);
  });

  it("keeps the other three date-less panels' numbers fixed under a time filter", () => {
    const payload = fixture();
    const base = initialFilters(payload);
    const timeFiltered = { ...base, years: [2024] };
    const cases: [ComponentType<MediaPanelProps>, RegExp][] = [
      [Attachments, /49 attachments across 2 mime types/],
      [Emoji, /42 uses across 2 emoji/],
      [Reactions, /29 reactions across 2 emoji/],
    ];

    for (const [PanelComponent, figure] of cases) {
      const { unmount } = render(<PanelComponent payload={payload} filters={base} />);
      const before = screen.getByText(figure).textContent;
      expect(screen.queryByText(/global only/i)).not.toBeInTheDocument();
      unmount();

      render(<PanelComponent payload={payload} filters={timeFiltered} />);
      expect(screen.queryByText(/global only/i)).not.toBeInTheDocument();
      expect(screen.getByText(figure).textContent).toBe(before);
      cleanup();
    }
  });

  it("explains the date-less cards once, at the section, naming all four", () => {
    const payload = fixture();
    render(<MediaSection payload={payload} filters={initialFilters(payload)} />);
    const note = screen.getByText(/4 of these 7 cards/);
    expect(note).toHaveTextContent("Message types");
    expect(note).toHaveTextContent("What gets attached");
    expect(note).toHaveTextContent("Emoji in text");
    expect(note).toHaveTextContent("Reactions");
  });

  it("reads message types from payload.types, falling back to meta.types", () => {
    const payload = fixture({ types: [] });
    render(<MessageTypes payload={payload} filters={initialFilters(payload)} />);
    expect(screen.getByText(/212 messages across 3 types/)).toBeInTheDocument();
  });

  it("reads the gauges off the filtered cells", () => {
    const payload = fixture();
    const filters = { ...initialFilters(payload), years: [2024] };
    const gauges = healthGauges(selectVisibleCells(payload, filters));

    expect(gauges.map((gauge) => gauge.name)).toEqual(["Replies", "With media", "Active days"]);
    expect(gauges[0].value).toBeCloseTo(10); // 3 replies of 30 messages
    expect(gauges[1].value).toBeCloseTo(70); // 21 with media of 30
    expect(gauges[2].value).toBeCloseTo(100); // 2 active days in a 2-day window

    render(<ChatHealth payload={payload} filters={filters} />);
    expect(
      screen.getByText(/replies 10\.0% · with media 70\.0% · active days 100\.0%/),
    ).toBeInTheDocument();
    expect(lastOption().series).toHaveLength(3);
  });

  it("renders an empty state for every panel when the database has no cells", () => {
    const payload = fixture({ cells: [] });
    render(<MediaSection payload={payload} filters={initialFilters(payload)} />);

    expect(screen.getAllByText("No messages yet — ingest, or upload a database from the Admin board.")).toHaveLength(7);
    expect(mocks.instance.setOption).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it("says no authors are selected for every panel when every author is switched off", () => {
    const payload = fixture();
    const filters = { ...initialFilters(payload), active: [false, false] };
    render(<MediaSection payload={payload} filters={filters} />);

    expect(screen.getAllByText("No authors selected — switch one back on in the filters.")).toHaveLength(7);
    expect(mocks.instance.setOption).not.toHaveBeenCalled();
  });

  it("treats a filtered total of zero as an empty state rather than dividing by zero", () => {
    const payload = fixture({ cells: [[0, 0, 0, 0, 0, 0, 0]] });
    const filters = initialFilters(payload);

    render(<TextVsMedia payload={payload} filters={filters} />);
    render(<RepliesVsStandalone payload={payload} filters={filters} />);
    render(<ChatHealth payload={payload} filters={filters} />);

    expect(screen.getAllByText("No messages match the active filters — widen the time range, or switch an author back on.")).toHaveLength(3);
    expect(mocks.instance.setOption).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it("renders an empty state when a global array is empty", () => {
    const payload = fixture({ attachments: [], emoji: [], reactions: [] });
    const filters = initialFilters(payload);
    render(<MessageTypes payload={fixture()} filters={filters} />);
    render(<Attachments payload={payload} filters={filters} />);
    render(<Emoji payload={payload} filters={filters} />);
    render(<Reactions payload={payload} filters={filters} />);

    expect(screen.getByText("No attachments yet — ingest, or upload a database from the Admin board.")).toBeInTheDocument();
    expect(screen.getByText("No emoji yet — ingest, or upload a database from the Admin board.")).toBeInTheDocument();
    expect(screen.getByText("No reactions yet — ingest, or upload a database from the Admin board.")).toBeInTheDocument();
  });

  it("gives every panel in the section a heading", () => {
    const payload = fixture();
    render(<MediaSection payload={payload} filters={initialFilters(payload)} />);
    expect(screen.getByRole("heading", { name: "Media & reactions" })).toBeInTheDocument();
    for (const title of [
      "Text vs media",
      "Replies vs standalone",
      "Message types",
      "What gets attached",
      "Emoji in text",
      "Reactions",
      "Chat health",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });
});
