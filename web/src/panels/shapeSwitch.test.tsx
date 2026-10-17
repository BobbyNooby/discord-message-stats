import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shape switch: where it appears, what it does to the series, and what it
 * says the pie's 100% covers.
 *
 * Each panel is rendered inside the same scope context the shell provides, and
 * the context's chart map is real state — the switch has to change what the
 * panel draws, not just its own `aria-pressed`.
 */
const mocks = vi.hoisted(() => {
  const instance = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getOption: vi.fn(() => ({})),
  };
  return { instance, init: vi.fn(() => instance) };
});

vi.mock("echarts", () => ({ init: mocks.init, use: vi.fn(), default: { init: mocks.init, use: vi.fn() } }));

import type { Payload } from "../api/types";
import { initialFilters } from "../filters/reducer";
import type { Charts } from "../filters/persist";
import type { ChartKind } from "./registry";
import type { PanelId } from "./registry";
import { MessageTypes } from "./MessageTypes";
import { TextVsMedia } from "./TextVsMedia";
import { PanelScopeProvider } from "./panelScope";

/** Twelve message types, so the pie has a tail to fold. */
const TYPES: [number, string, number][] = [
  [0, "Default", 1000],
  [1, "Reply", 500],
  [2, "Call", 300],
  [3, "Pin", 200],
  [4, "Join", 150],
  [5, "Boost", 100],
  [6, "Thread", 80],
  [7, "Poll", 60],
  [8, "Stage", 40],
  [9, "Guild", 30],
  [10, "Recruit", 20],
  [11, "Mystery", 10],
];

function fixture(): Payload {
  return {
    meta: {
      total: 2490,
      source_count: 0,
      stale: false,
      can_admin: false,
      timezone: "UTC",
      computed_at: null,
      authors: 1,
      cells: 1,
      heat_cells: 0,
      active_days: 1,
      firstLocal: "2024-01-01",
      lastLocal: "2024-01-01",
      stopwords: 0,
      kept_words: 0,
      payload_kb: 1,
      payload_gzip_kb: 1,
      types: TYPES,
    },
    authors: [{ id: "u1", name: "Ada", msgs: 2490 }],
    days: ["2024-01-01"],
    cells: [[0, 0, 2490, 100, 10, 5, 0]],
    heat: [],
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
    types: TYPES,
    tz: { name: "UTC", label: "UTC" },
    channel_hint: "c1",
  } as unknown as Payload;
}

type Option = { series: { type: string; data: (number | { name?: string; value?: number })[] }[] };
const lastOption = () => mocks.instance.setOption.mock.calls.at(-1)?.[0] as unknown as Option;

/** The shell's chart map, as real state, so the switch changes the drawing. */
function Shell({ children }: { children: ReactNode }) {
  const payload = fixture();
  const [charts, setCharts] = useState<Charts>({});
  const setShape = useCallback(
    (panelId: PanelId, shape: ChartKind) => setCharts((previous) => ({ ...previous, [panelId]: shape })),
    [],
  );
  return (
    <PanelScopeProvider
      filters={initialFilters(payload)}
      scopes={{}}
      charts={charts}
      onShapeChange={setShape}
    >
      {children}
    </PanelScopeProvider>
  );
}

/** The one switch on screen, named after the shape it is currently showing. */
const switchShownAs = (label: string, shape: "bars" | "pie") =>
  screen.getByRole("button", { name: `${label} as ${shape}`, pressed: shape === "pie" });

const noSwitch = () => screen.queryByRole("button", { name: /as (bars|pie)$/i });

beforeEach(() => {
  mocks.instance.setOption.mockClear();
});

describe("the chart-shape switch", () => {
  it("appears on a card that can be both, and not on a card that cannot", () => {
    const payload = fixture();
    const { unmount } = render(
      <Shell>
        <MessageTypes payload={payload} filters={initialFilters(payload)} />
      </Shell>,
    );
    expect(switchShownAs("Message types", "bars")).toBeInTheDocument();
    unmount();

    render(
      <Shell>
        <TextVsMedia payload={payload} filters={initialFilters(payload)} />
      </Shell>,
    );
    expect(noSwitch()).not.toBeInTheDocument();
  });

  it("draws a pie of at most eight named slices once asked, folding the tail into Other", async () => {
    const payload = fixture();
    render(
      <Shell>
        <MessageTypes payload={payload} filters={initialFilters(payload)} />
      </Shell>,
    );
    // The bar keeps every row: twelve types with numbers, not a folded eight.
    expect(lastOption().series[0].type).toBe("bar");
    expect(lastOption().series[0].data).toHaveLength(12);

    await userEvent.click(switchShownAs("Message types", "bars"));
    expect(switchShownAs("Message types", "pie")).toBeInTheDocument();

    const series = lastOption().series[0];
    expect(series.type).toBe("pie");
    expect(series.data).toHaveLength(9);
    expect(series.data[8]).toMatchObject({ name: "Other", value: 40 + 30 + 20 + 10 });
  });

  it("states the denominator the pie's 100% actually covers", async () => {
    const payload = fixture();
    render(
      <Shell>
        <MessageTypes payload={payload} filters={initialFilters(payload)} />
      </Shell>,
    );
    expect(screen.getByText(/2,490 messages across 12 types/)).toBeInTheDocument();

    await userEvent.click(switchShownAs("Message types", "bars"));
    expect(screen.getByText(/top 8 of 12 types \+ Other/)).toBeInTheDocument();
    expect(screen.getByText(/2,490 messages/)).toBeInTheDocument();
  });

  it("switches back to the bar the reader started from", async () => {
    const payload = fixture();
    render(
      <Shell>
        <MessageTypes payload={payload} filters={initialFilters(payload)} />
      </Shell>,
    );
    await userEvent.click(switchShownAs("Message types", "bars"));
    await userEvent.click(switchShownAs("Message types", "pie"));

    expect(switchShownAs("Message types", "bars")).toBeInTheDocument();
    expect(lastOption().series[0].type).toBe("bar");
    cleanup();
  });
});
