import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Payload } from "../api/types";
import { EMPTY_FILTERS, type Filters } from "../filters/reducer";
import { PanelScopeProvider } from "./panelScope";
import { WhoSaysIt } from "./WhoSaysIt";
import { WordCloud } from "./WordCloud";
import { WordIndex } from "./WordIndex";
import { WordLift, liftGrid } from "./WordLift";

/**
 * The Words section's two hard rules: the embedded slice answers typing on its
 * own (no network until it cannot), and a word with no per-author breakdown says
 * so instead of drawing an empty chart.
 */

const mocks = vi.hoisted(() => {
  const instance = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    clear: vi.fn(),
  };
  return {
    instance,
    init: vi.fn(() => instance),
    useWords: vi.fn(),
    useWordSuggestions: vi.fn(),
    useWordPeriod: vi.fn(),
  };
});

vi.mock("echarts", () => ({ init: mocks.init, use: vi.fn() }));
vi.mock("../api/queries", () => ({
  useWords: mocks.useWords,
  useWordSuggestions: mocks.useWordSuggestions,
  useWordPeriod: mocks.useWordPeriod,
}));

type LastOption = { yAxis: { data: string[] }; series: { data: { name?: string; value?: number }[] }[] };
const lastOption = () => mocks.instance.setOption.mock.calls.at(-1)?.[0] as unknown as LastOption;

const meta: Payload["meta"] = {
  total: 400,
  source_count: 400,
  stale: false, can_admin: false,
  timezone: "Europe/London",
  timezone_mismatch: false,
  configured_timezone: "Europe/London",
  timezone_message: null,
  schema_version: null,
  schema_expected: 1,
  schema_message: null,
  week_start: "monday",
  time_format: "24h",
  computed_at: "2026-10-15T20:00:00Z",
  authors: 2,
  cells: 6,
  heat_cells: 0,
  active_days: 3,
  firstLocal: "2024-01-01",
  lastLocal: "2024-01-03",
  stopwords: 0,
  kept_words: 3,
  payload_kb: 1,
  payload_gzip_kb: 1,
  types: [],
};

/**
 * Two authors, three days, three words — and only two of the three words carry a
 * per-author breakdown, which is the shape the real 420-of-500 slice has.
 */
function makePayload(overrides: Partial<Payload> = {}): Payload {
  return {
    meta,
    authors: [
      { id: "u1", name: "Ada", msgs: 300 },
      { id: "u2", name: "Bo", msgs: 100 },
    ],
    days: ["2024-01-01", "2024-01-02", "2024-01-03"],
    cells: [
      [0, 0, 100, 500, 10, 2, 1],
      [0, 1, 40, 120, 3, 0, 0],
      [1, 0, 120, 600, 12, 3, 2],
      [1, 1, 30, 90, 2, 0, 0],
      [2, 0, 80, 400, 8, 1, 0],
      [2, 1, 30, 100, 2, 0, 0],
    ],
    heat: [],
    edges: [],
    response: [],
    editSpeed: [],
    starters: [],
    attachments: [],
    words: [
      ["car", 42],
      ["care", 12],
      ["gpu", 9],
    ],
    wordAuthors: { car: [[0, 40], [1, 2]], care: [[0, 12]] },
    authorWordTotals: [200, 100],
    authorDistinct: [2, 1],
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
    tz: { name: "Europe/London", label: "Europe/London (UTC+0)" },
    channel_hint: "#general",
    ...overrides,
  };
}

const allOn: Filters = { ...EMPTY_FILTERS, active: [true, true] };

describe("Words section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWords.mockReturnValue({ data: undefined, isFetching: false });
    mocks.useWordSuggestions.mockReturnValue({ data: undefined });
    mocks.useWordPeriod.mockReturnValue({ data: undefined, isFetching: false });
  });

  it("never asks for a period while no time filter is on", () => {
    render(<WordIndex payload={makePayload()} selected={null} onSelect={vi.fn()} />);
    expect(mocks.useWordPeriod).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("top 3 of 3 indexed")).toBeInTheDocument();
  });

  it("ranks the words of the years picked, and says which years", () => {
    mocks.useWordPeriod.mockReturnValue({
      data: {
        built: true,
        words: [["zebra", 5]],
        wordAuthors: { zebra: [[1, 5]] },
        authorWordTotals: [0, 5],
        authorDistinct: [0, 1],
        kept_words: 1,
      },
      isFetching: false,
    });
    render(
      <PanelScopeProvider filters={{ ...allOn, years: [2023] }} scopes={{}}>
        <WordIndex payload={makePayload()} selected={null} onSelect={vi.fn()} />
      </PanelScopeProvider>,
    );
    expect(mocks.useWordPeriod).toHaveBeenLastCalledWith({ from: null, to: null, years: [2023] });
    expect(lastOption().yAxis.data).toEqual(["zebra"]);
    expect(screen.getByText("top 1 of 1 · 2023")).toBeInTheDocument();
  });

  it("says it is counting rather than showing all-time words under a year", () => {
    mocks.useWordPeriod.mockReturnValue({ data: undefined, isFetching: true });
    render(<WordLift payload={makePayload()} filters={{ ...allOn, years: [2023] }} />);
    expect(screen.getByText("Counting words for 2023…")).toBeInTheDocument();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it("asks for a rebuild when the month table is not there yet", () => {
    mocks.useWordPeriod.mockReturnValue({
      data: { built: false, words: [], wordAuthors: {}, authorWordTotals: [0, 0], authorDistinct: [0, 0], kept_words: 0 },
      isFetching: false,
    });
    render(<WordLift payload={makePayload()} filters={{ ...allOn, years: [2023] }} />);
    expect(screen.getByText(/need one rebuild/)).toBeInTheDocument();
  });

  it("counts who says a word only in the period, bars and timeline alike", () => {
    mocks.useWords.mockReturnValue({
      data: {
        word: "car",
        total: 42,
        authors: [
          { id: "u1", name: "Ada", count: 40 },
          { id: "u2", name: "Bo", count: 2 },
        ],
        months: [
          { month: "2023-05", id: "u1", count: 38 },
          { month: "2024-02", id: "u1", count: 2 },
          { month: "2024-02", id: "u2", count: 2 },
        ],
      },
      isFetching: false,
    });
    render(<WhoSaysIt payload={makePayload()} filters={{ ...allOn, years: [2024] }} word="car" />);
    // All time would be 42 from the payload slice; 2024 alone is 4.
    expect(screen.getByText("4 uses in 2024")).toBeInTheDocument();
    const timeline = lastOption() as unknown as { xAxis: { data: string[] } };
    expect(timeline.xAxis.data).toEqual(["2024-02"]);
  });

  it("draws who says it and when for a word only the full index knows", () => {
    mocks.useWords.mockReturnValue({
      data: {
        word: "gpu",
        total: 9,
        authors: [
          { id: "u1", name: "Ada", count: 6 },
          { id: "u2", name: "Bo", count: 3 },
        ],
        months: [
          { month: "2024-01", id: "u1", count: 4 },
          { month: "2024-03", id: "u1", count: 2 },
          { month: "2024-03", id: "u2", count: 3 },
        ],
      },
      isFetching: false,
    });
    render(<WhoSaysIt payload={makePayload()} filters={allOn} word="gpu" />);

    expect(mocks.useWords).toHaveBeenLastCalledWith("gpu", true);
    expect(screen.queryByText(/outside the indexed slice/i)).not.toBeInTheDocument();
    expect(screen.getByText("9 uses total")).toBeInTheDocument();
    // The bars and the timeline are two charts.
    expect(mocks.init).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/first seen Jan 2024 · busiest Mar 2024 \(5 uses\)/)).toBeInTheDocument();
    const timeline = lastOption() as unknown as { xAxis: { data: string[] }; series: { name: string }[] };
    // February is drawn even though nobody said it: a quiet month is still a month.
    expect(timeline.xAxis.data).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(timeline.series.map((s) => s.name)).toEqual(["Ada", "Bo"]);
  });

  it("asks for a rebuild instead of drawing an empty timeline", () => {
    mocks.useWords.mockReturnValue({
      data: { word: "car", total: 42, authors: [], months: null },
      isFetching: false,
    });
    render(<WhoSaysIt payload={makePayload()} filters={allOn} word="car" />);
    expect(screen.getByText(/needs one rebuild/)).toBeInTheDocument();
  });

  it("offers full-index words that start with the search and picks one on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    mocks.useWordSuggestions.mockReturnValue({ data: [["zebra", 12], ["zebras", 3]] });
    render(<WordIndex payload={makePayload()} selected={null} onSelect={onSelect} />);

    await user.type(screen.getByRole("searchbox", { name: "Search words" }), "zeb");
    expect(mocks.useWordSuggestions).toHaveBeenLastCalledWith("zeb", true);
    await user.click(screen.getByRole("button", { name: /zebras/ }));
    expect(onSelect).toHaveBeenCalledWith("zebras");
  });

  it("never asks for suggestions while the slice is answering", async () => {
    const user = userEvent.setup();
    render(<WordIndex payload={makePayload()} selected={null} onSelect={vi.fn()} />);
    await user.type(screen.getByRole("searchbox", { name: "Search words" }), "car");
    expect(mocks.useWordSuggestions.mock.calls.every(([, enabled]) => enabled === false)).toBe(true);
  });

  it("says a word with no uses is not in the full index, in the badge too", async () => {
    const user = userEvent.setup();
    mocks.useWords.mockReturnValue({ data: { word: "qqq", total: 0, authors: [] }, isFetching: false });
    render(<WordIndex payload={makePayload()} selected={null} onSelect={vi.fn()} />);
    await user.type(screen.getByRole("searchbox", { name: "Search words" }), "qqq");
    expect(screen.getByText("not in the full index")).toBeInTheDocument();
    expect(screen.queryByText("0 uses in the full index")).not.toBeInTheDocument();
  });

  it("explains a word with no per-author breakdown instead of drawing a chart", () => {
    render(<WhoSaysIt payload={makePayload()} filters={allOn} word="gpu" />);

    expect(screen.getByText(/outside the indexed slice/i)).toBeInTheDocument();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it("draws who says it for a word inside the breakdown slice", () => {
    const payload = makePayload();
    const { rerender } = render(<WhoSaysIt payload={payload} filters={allOn} word="car" />);

    expect(screen.queryByText(/outside the indexed slice/i)).not.toBeInTheDocument();
    expect(screen.getByText("42 uses total")).toBeInTheDocument();
    expect(mocks.init).toHaveBeenCalledTimes(1);
    // Horizontal bars are sorted by value, so the smallest sits at the bottom.
    expect(lastOption().yAxis.data).toEqual(["Bo", "Ada"]);

    // The total follows the bars: switching Bo off cannot leave 42 uses above 40.
    rerender(<WhoSaysIt payload={payload} filters={{ ...allOn, active: [true, false] }} word="car" />);
    expect(screen.getByText("40 uses total")).toBeInTheDocument();
    expect(lastOption().yAxis.data).toEqual(["Ada"]);
  });

  it("filters the embedded slice while typing, without a network call", async () => {
    const user = userEvent.setup();
    render(<WordIndex payload={makePayload()} selected={null} onSelect={vi.fn()} />);

    await user.type(screen.getByRole("searchbox", { name: "Search words" }), "car");

    // Every keystroke was answered by the slice; the server was never asked.
    expect(mocks.useWords.mock.calls.length).toBeGreaterThan(0);
    expect(mocks.useWords.mock.calls.every(([, enabled]) => enabled === false)).toBe(true);
    expect(mocks.useWords).toHaveBeenLastCalledWith("car", false);
    expect(lastOption().yAxis.data).toEqual(["care", "car"]);
    expect(screen.getByText("2 matches")).toBeInTheDocument();
  });

  it("asks the server only when the slice has no answer", async () => {
    const user = userEvent.setup();
    mocks.useWords.mockReturnValue({
      data: {
        word: "gpuclan",
        total: 7,
        authors: [
          { id: "u1", name: "Ada", count: 5 },
          { id: "u2", name: "Bo", count: 2 },
        ],
      },
      isFetching: false,
    });
    render(<WordIndex payload={makePayload()} selected={null} onSelect={vi.fn()} />);

    await user.type(screen.getByRole("searchbox", { name: "Search words" }), "gpuclan");

    expect(mocks.useWords).toHaveBeenLastCalledWith("gpuclan", true);
    // The endpoint answers for the exact word, so its breakdown is shown here.
    expect(await screen.findByLabelText("Who says “gpuclan”")).toBeInTheDocument();
    expect(screen.getByText(/outside the embedded slice/)).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("5 uses")).toBeInTheDocument();
    expect(screen.getByText("7 uses in the full index")).toBeInTheDocument();
  });

  it("opens a full-index word in Who says it from the button or Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    mocks.useWords.mockReturnValue({
      data: { word: "gpuclan", total: 7, authors: [{ id: "u1", name: "Ada", count: 7 }] },
      isFetching: false,
    });
    render(<WordIndex payload={makePayload()} selected={null} onSelect={onSelect} />);

    await user.type(screen.getByRole("searchbox", { name: "Search words" }), "gpuclan");
    await user.click(screen.getByRole("button", { name: /who says it & when/i }));
    expect(onSelect).toHaveBeenLastCalledWith("gpuclan");
    onSelect.mockClear();
    await user.click(screen.getByRole("searchbox", { name: "Search words" }));
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("gpuclan");
  });

  it("selects the highlighted word on Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<WordIndex payload={makePayload()} selected="car" onSelect={onSelect} />);

    await user.type(screen.getByRole("searchbox", { name: "Search words" }), "care");
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("care");
  });

  it("computes lift against each author's own word total, not the grand total", () => {
    const grid = liftGrid(makePayload(), allOn);

    expect(grid.names).toEqual(["Ada", "Bo"]);
    expect(grid.words[0]).toBe("car");
    // Ada: (40/200) / (42/300) = 1.43×; Bo: (2/100) / (42/300) = 0.14×
    expect(grid.cells[0][2]).toBeCloseTo(1.4286, 3);
    expect(grid.cells[1][2]).toBeCloseTo(0.1429, 3);
  });

  it("renders the lift heatmap's empty states rather than an axis nobody can read", () => {
    const payload = makePayload();
    const { rerender } = render(<WordLift payload={makePayload({ words: [] })} filters={allOn} />);
    expect(screen.getByText("No words yet — ingest, or upload a database from the Admin board.")).toBeInTheDocument();
    // "lift" is jargon, so the card carries its definition rather than assuming it.
    expect(screen.getByRole("note", { name: /lift = how much more often/i })).toBeInTheDocument();

    rerender(<WordLift payload={payload} filters={{ ...allOn, active: [false, false] }} />);
    expect(screen.getByText("No authors selected — switch one back on in the filters.")).toBeInTheDocument();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it("renders the cloud's empty state without loading the plugin", () => {
    const loadPlugin = vi.fn();
    render(<WordCloud payload={makePayload({ words: [], wordAuthors: {} })} filters={allOn} loadPlugin={loadPlugin} />);

    expect(screen.getByText(/no words to plot/i)).toBeInTheDocument();
    expect(loadPlugin).not.toHaveBeenCalled();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it("degrades to a sentence when the word cloud plugin is unavailable", async () => {
    render(
      <WordCloud payload={makePayload()} filters={allOn} loadPlugin={() => Promise.reject(new Error("no plugin"))} />,
    );

    expect(await screen.findByText(/word cloud unavailable/i)).toBeInTheDocument();
  });

  it("keeps the numbers in the cloud's subtitle, not only in the chart", async () => {
    render(<WordCloud payload={makePayload()} filters={allOn} loadPlugin={() => Promise.resolve()} />);

    expect(screen.getByText(/63 uses shown/)).toBeInTheDocument();
    expect(await screen.findByRole("img")).toBeInTheDocument();
  });
});
