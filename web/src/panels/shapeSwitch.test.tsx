import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

/**
 * The shape switch: where it appears, what it does to the series, and what it
 * says the pie's 100% covers.
 *
 * Each panel is rendered inside the same scope context the shell provides, and
 * the context's chart map is real state — the switch has to change what the
 * panel draws, not just its own `aria-pressed`.
 */
import type { Payload } from "../api/types";
import { initialFilters } from "../app/reducer";
import type { Charts } from "../app/persist";
import type { ChartKind } from "./registry";
import type { PanelId } from "./registry";
import { Attachments } from "./media/Attachments";
import { MessageTypes } from "./media/MessageTypes";
import { RepliesVsStandalone } from "./media/RepliesVsStandalone";
import { ShareOfVoice } from "./overview/ShareOfVoice";
import { TextVsMedia } from "./media/TextVsMedia";
import { PanelScopeProvider } from "./panelScope";
import { charts as chartMock } from "../test/echarts";
import { testMeta, testPayload } from "../test/payload";

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
  return testPayload({
    meta: testMeta({ types: TYPES }),
    authors: [{ id: "u1", name: "Ada", msgs: 2490 }],
    days: ["2024-01-01"],
    cells: [[0, 0, 2490, 100, 10, 5, 0]],
    types: TYPES,
  });
}

type Option = { series: { type: string; data: (number | { name?: string; value?: number })[] }[] };
const lastOption = () => chartMock.lastOption() as Option;

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
        <Attachments payload={payload} filters={initialFilters(payload)} />
      </Shell>,
    );
    expect(noSwitch()).not.toBeInTheDocument();
  });

  it("offers bars on the cards whose spec declares a pie, keeping the pie as the default", async () => {
    const payload = fixture();
    // Each of these draws a pie today; the switch is what lets a reader ask for
    // the bar, and the default has to stay the shape they already had.
    const panels = [
      { label: "Text vs media", renderPanel: () => <TextVsMedia payload={payload} filters={initialFilters(payload)} /> },
      {
        label: "Replies vs standalone",
        renderPanel: () => <RepliesVsStandalone payload={payload} filters={initialFilters(payload)} />,
      },
      { label: "Share of voice", renderPanel: () => <ShareOfVoice payload={payload} filters={initialFilters(payload)} /> },
    ];

    for (const panel of panels) {
      const { unmount } = render(<Shell>{panel.renderPanel()}</Shell>);
      expect(switchShownAs(panel.label, "pie")).toBeInTheDocument();
      await userEvent.click(switchShownAs(panel.label, "pie"));
      expect(lastOption().series[0].type).toBe("bar");
      unmount();
    }
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
