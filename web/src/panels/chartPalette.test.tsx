import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The option the panel hands its chart — the closest a unit test can get to a
 * drawn colour without a canvas. */
const captured = vi.hoisted(() => ({ option: null as unknown }));

vi.mock("../lib/echart", () => ({
  EChart: ({ option }: { option: unknown }) => {
    captured.option = option;
    return null;
  },
}));

import type { Payload } from "../api/types";
import { initialFilters } from "../filters/reducer";
import { Attachments } from "./Attachments";
import { ChatHealth } from "./ChatHealth";
import { Conversational } from "./Conversational";
import { EditRate } from "./EditRate";
import { foldPie, pieOption } from "./chartShape";
import { EmbedTypes } from "./EmbedTypes";
import { Emoji } from "./Emoji";
import { LinkDomains } from "./LinkDomains";
import { MessageTypes } from "./MessageTypes";
import { MessagesPerYear } from "./MessagesPerYear";
import { Providers } from "./Providers";
import { Reactions } from "./Reactions";
import { RepliesVsStandalone } from "./RepliesVsStandalone";
import { Season } from "./Season";
import { TextVsMedia } from "./TextVsMedia";
import { TopLinks } from "./TopLinks";
import { WordCloud } from "./WordCloud";

const payload = {
  authors: [{ id: "u1", name: "A", msgs: 5 }],
  days: ["2023-01-01", "2024-01-01"],
  cells: [
    [0, 0, 2, 10, 1, 0, 1],
    [1, 0, 3, 20, 1, 0, 1],
  ],
  meta: { types: [[0, "default", 5]], stale: false, can_admin: false, timezone: "UTC", total: 5 },
  types: [
    [0, "Default", 3],
    [1, "Reply", 2],
  ],
  emoji: [["😂", 7]],
  attachments: [["image/png", 4]],
  reactions: [["👍", 3]],
  providers: [["Tenor", 6]],
  embedTypes: [["gifv", 3]],
  words: [
    ["hello", 9],
    ["world", 5],
  ],
  wordAuthors: {},
  linkDomains: ["example.com"],
  linkCells: [[0, 0, 0, 5]],
  linkStats: { msgs: 5, domains: 1, both: 0 },
  topLinks: [["https://example.com", 4]],
} as unknown as Payload;

const filters = initialFilters(payload);

/** jsdom cannot resolve CSS custom properties; stand in for the browser. */
function cssValues(variables: Record<string, string>): void {
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: (name: string) => variables[name] ?? "",
      }) as unknown as CSSStyleDeclaration,
  );
}

type Slice = { name?: string; itemStyle?: { color?: string } };
type Gauge = { progress: { itemStyle: { color: string } } };

function firstSeries(option: unknown): { itemStyle?: { color?: string }; data?: Slice[] } {
  return (option as { series: { itemStyle?: { color?: string }; data?: Slice[] }[] }).series[0];
}

function barColor(option: unknown): string | undefined {
  return firstSeries(option).itemStyle?.color;
}

function sliceColors(option: unknown): (string | undefined)[] {
  return firstSeries(option).data?.map((slice) => slice.itemStyle?.color) ?? [];
}

function gaugeColors(option: unknown): string[] {
  const series = (option as { series: Gauge[] }).series;
  return series.map((gauge) => gauge.progress.itemStyle.color);
}

beforeEach(() => {
  captured.option = null;
});
afterEach(() => vi.restoreAllMocks());

describe("a chart's series colour follows the theme", () => {
  it("draws the overridden --chart-1 and --chart-peak once the variables resolve", () => {
    cssValues({ "--chart-1": "#ff00ff", "--chart-peak": "#00ff00" });
    render(<MessagesPerYear payload={payload} filters={filters} />);

    const series = (captured.option as { series: { data: { itemStyle: { color: string } }[] }[] })
      .series[0];
    // Ascending years: 2023 is the plain bar, 2024 the peak.
    expect(series.data.map((row) => row.itemStyle.color)).toEqual(["#ff00ff", "#00ff00"]);
  });

  it("draws the upstream colours when nothing overrides them", () => {
    render(<MessagesPerYear payload={payload} filters={filters} />);

    const series = (captured.option as { series: { data: { itemStyle: { color: string } }[] }[] })
      .series[0];
    expect(series.data.map((row) => row.itemStyle.color)).toEqual(["#5865f2", "#c9cdfc"]);
  });
});

describe("the indexed bar cards read their slot variable", () => {
  it("draws the overridden --chart-2 in Message types", () => {
    cssValues({ "--chart-2": "#ff00ff" });
    render(<MessageTypes payload={payload} filters={filters} />);
    expect(barColor(captured.option)).toBe("#ff00ff");
  });

  it("draws the overridden --chart-6 in Embed types", () => {
    cssValues({ "--chart-6": "#ff00ff" });
    render(<EmbedTypes payload={payload} />);
    expect(barColor(captured.option)).toBe("#ff00ff");
  });

  it("draws the overridden --chart-1 in Embed providers", () => {
    cssValues({ "--chart-1": "#ff00ff" });
    render(<Providers payload={payload} filters={filters} />);
    expect(barColor(captured.option)).toBe("#ff00ff");
  });

  it("keeps the upstream colours when nothing overrides them", () => {
    render(<MessageTypes payload={payload} filters={filters} />);
    render(<Providers payload={payload} filters={filters} />);
    expect(barColor(captured.option)).toBe("#5865f2");
    render(<EmbedTypes payload={payload} />);
    expect(barColor(captured.option)).toBe("#f57731");
  });
});

describe("the pie reads its slot variables", () => {
  it("colours a named slice from --chart-2 and the folded tail from --chart-12", () => {
    cssValues({ "--chart-2": "#ff00ff", "--chart-12": "#00ff00" });
    const rows = Array.from({ length: 10 }, (_, index) => ({
      name: `n${index}`,
      value: 10 - index,
    }));
    const slices = firstSeries(pieOption(foldPie(rows), "types")).data ?? [];

    expect(slices[0]?.itemStyle?.color).toBe("#5865f2");
    expect(slices[1]?.itemStyle?.color).toBe("#ff00ff");
    expect(slices[8]?.name).toBe("Other");
    expect(slices[8]?.itemStyle?.color).toBe("#00ff00");
  });
});

describe("the media bar cards read their slot variable", () => {
  it("Emoji in text draws the overridden --chart-2", () => {
    cssValues({ "--chart-2": "#ff00ff" });
    render(<Emoji payload={payload} filters={filters} />);
    expect(barColor(captured.option)).toBe("#ff00ff");
  });

  it("What gets attached draws the overridden --chart-6", () => {
    cssValues({ "--chart-6": "#ff00ff" });
    render(<Attachments payload={payload} filters={filters} />);
    expect(barColor(captured.option)).toBe("#ff00ff");
  });

  it("Reactions draws the overridden --chart-3", () => {
    cssValues({ "--chart-3": "#ff00ff" });
    render(<Reactions payload={payload} filters={filters} />);
    expect(barColor(captured.option)).toBe("#ff00ff");
  });

  it("keeps the upstream colours when nothing overrides them", () => {
    render(<Emoji payload={payload} filters={filters} />);
    expect(barColor(captured.option)).toBe("#eb459e");
    render(<Attachments payload={payload} filters={filters} />);
    expect(barColor(captured.option)).toBe("#f57731");
    render(<Reactions payload={payload} filters={filters} />);
    expect(barColor(captured.option)).toBe("#57f287");
  });
});

describe("the two-part doughnuts read their slot variable", () => {
  it("Text vs media draws the overridden --chart-2 for its media slice", () => {
    cssValues({ "--chart-2": "#ff00ff" });
    render(<TextVsMedia payload={payload} filters={filters} />);
    expect(sliceColors(captured.option)[0]).toBe("#ff00ff");
  });

  it("Replies vs standalone draws the overridden --chart-5 for its replies slice", () => {
    cssValues({ "--chart-5": "#ff00ff" });
    render(<RepliesVsStandalone payload={payload} filters={filters} />);
    expect(sliceColors(captured.option)[0]).toBe("#ff00ff");
  });

  it("keeps the upstream colours when nothing overrides them", () => {
    render(<TextVsMedia payload={payload} filters={filters} />);
    expect(sliceColors(captured.option)[0]).toBe("#eb459e");
    render(<RepliesVsStandalone payload={payload} filters={filters} />);
    expect(sliceColors(captured.option)[0]).toBe("#00b0f4");
  });
});

describe("the health gauges read their slot variables", () => {
  it("reads --chart-5, --chart-2 and --chart-3 for the three gauges", () => {
    cssValues({ "--chart-5": "#111111", "--chart-2": "#222222", "--chart-3": "#333333" });
    render(<ChatHealth payload={payload} filters={filters} />);
    expect(gaugeColors(captured.option)).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("keeps the upstream colours when nothing overrides them", () => {
    render(<ChatHealth payload={payload} filters={filters} />);
    expect(gaugeColors(captured.option)).toEqual(["#00b0f4", "#eb459e", "#57f287"]);
  });
});

describe("the word cloud reads its slot variables", () => {
  it("colours the words from --chart-1 onwards", async () => {
    cssValues({ "--chart-1": "#ff00ff" });
    // A word card can ask for a period's words, so it sits under the query
    // client the app always provides.
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WordCloud payload={payload} filters={filters} loadPlugin={() => Promise.resolve()} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(captured.option).not.toBeNull());
    const words = (captured.option as { series: { data: { textStyle: { color: string } }[] }[] })
      .series[0].data;
    expect(words.map((word) => word.textStyle.color)).toEqual(["#ff00ff", "#eb459e"]);
  });
});

describe("the remaining palette literals read the theme", () => {
  type LineSeries = {
    lineStyle: { color: string };
    markLine: { lineStyle: { color: string } };
  };

  it("How conversational draws its line from --chart-5 and its average from --chart-2", () => {
    cssValues({ "--chart-5": "#111111", "--chart-2": "#222222" });
    render(<Conversational payload={payload} filters={filters} />);

    const series = (captured.option as { series: LineSeries[] }).series[0];
    expect(series.lineStyle.color).toBe("#111111");
    expect(series.markLine.lineStyle.color).toBe("#222222");
  });

  it("Who proofreads draws its trend from --chart-4 and its average from --chart-2", () => {
    cssValues({ "--chart-4": "#111111", "--chart-2": "#222222" });
    render(<EditRate payload={payload} filters={filters} />);

    const series = (captured.option as { series: LineSeries[] }).series[0];
    expect(series.lineStyle.color).toBe("#111111");
    expect(series.markLine.lineStyle.color).toBe("#222222");
  });

  it("Which month of the year draws its peak from --chart-3 and the rest from --chart-8", () => {
    cssValues({ "--chart-3": "#111111", "--chart-8": "#222222" });
    render(<Season payload={payload} filters={filters} />);

    const data = (captured.option as { series: { data: { itemStyle: { color: string } }[] }[] })
      .series[0].data;
    // January holds every message in the fixture, so it is the peak.
    expect(data[0].itemStyle.color).toBe("#111111");
    expect(data[1].itemStyle.color).toBe("#222222");
  });

  it("Where the chat lives draws its bars from --chart-5", () => {
    cssValues({ "--chart-5": "#111111" });
    render(<LinkDomains payload={payload} filters={filters} />);
    expect(barColor(captured.option)).toBe("#111111");
  });

  it("Most reposted links draws its bars from --chart-8", () => {
    cssValues({ "--chart-8": "#111111" });
    render(<TopLinks payload={payload} />);
    expect(barColor(captured.option)).toBe("#111111");
  });
});
