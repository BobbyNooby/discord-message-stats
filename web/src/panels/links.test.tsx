import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Payload } from "../api/types";
import { EMPTY_FILTERS, type Filters } from "../filters/reducer";
import { EmbedTypes } from "./EmbedTypes";
import { LinkDomains } from "./LinkDomains";
import { LinksSection } from "./LinksSection";
import { Providers } from "./Providers";
import { TopLinks } from "./TopLinks";

/**
 * Links & embeds: the header has to print the payload's three link totals
 * verbatim, the domain bars have to re-aggregate in the browser, and a panel
 * that cannot honour a filter has to say so.
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
  return { instance, init: vi.fn(() => instance) };
});

vi.mock("echarts", () => ({ init: mocks.init, use: vi.fn() }));

type LastOption = {
  yAxis: { data: string[] };
  series: { type?: string; data: (number | { name?: string; value?: number })[] }[];
};
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
  cells: 3,
  heat_cells: 0,
  active_days: 2,
  firstLocal: "2024-01-01",
  lastLocal: "2024-01-02",
  stopwords: 0,
  kept_words: 0,
  payload_kb: 1,
  payload_gzip_kb: 1,
  types: [],
};

function makePayload(overrides: Partial<Payload> = {}): Payload {
  return {
    meta,
    authors: [
      { id: "u1", name: "Ada", msgs: 300 },
      { id: "u2", name: "Bo", msgs: 100 },
    ],
    days: ["2024-01-01", "2024-01-02"],
    cells: [],
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
    linkDomains: ["youtube.com", "tenor.com", "twitch.tv"],
    linkCells: [
      [0, 0, 0, 5],
      [0, 1, 1, 3],
      [1, 0, 2, 9],
    ],
    topLinks: [["youtube.com/watch", 4]],
    providers: [],
    embedTypes: [],
    linkStats: { msgs: 17135, domains: 539, both: 16569 },
    emoji: [],
    reactions: [],
    types: [],
    tz: { name: "Europe/London", label: "Europe/London (UTC+0)" },
    channel_hint: "#general",
    ...overrides,
  };
}

const allOn: Filters = { ...EMPTY_FILTERS, active: [true, true] };
const statsLine = "17,135 msgs · 539 domains · 16,569 unfurled";

describe("Links & embeds section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prints the payload's three link totals verbatim in the subtitle", () => {
    render(<LinkDomains payload={makePayload()} filters={allOn} />);

    expect(screen.getByText(statsLine)).toBeInTheDocument();
    expect(screen.getByText(/extracted from message text/)).toBeInTheDocument();
  });

  it("re-aggregates the domain bars when the author selection changes", () => {
    const payload = makePayload();
    const { rerender } = render(<LinkDomains payload={payload} filters={allOn} />);
    // Ascending, because the y axis grows upwards.
    expect(lastOption().yAxis.data).toEqual(["tenor.com", "youtube.com", "twitch.tv"]);

    rerender(<LinkDomains payload={payload} filters={{ ...allOn, active: [true, false] }} />);
    // Bo's tenor.com is gone; Ada's youtube.com (5) and twitch.tv (9) remain.
    expect(lastOption().yAxis.data).toEqual(["youtube.com", "twitch.tv"]);
  });

  it("re-aggregates the domain bars when the time range changes", () => {
    const payload = makePayload();
    const { rerender } = render(<LinkDomains payload={payload} filters={allOn} />);

    rerender(<LinkDomains payload={payload} filters={{ ...allOn, from: "2024-01-02" }} />);
    expect(lastOption().yAxis.data).toEqual(["twitch.tv"]);
  });

  it("shows an empty state, not a broken chart, when nothing is left", () => {
    const { rerender } = render(<LinkDomains payload={makePayload({ linkCells: [] })} filters={allOn} />);
    expect(screen.getByText("No links match the active filters — widen the time range, or switch an author back on.")).toBeInTheDocument();
    expect(screen.getByText(statsLine)).toBeInTheDocument(); // the totals survive an empty filter
    expect(mocks.init).not.toHaveBeenCalled();

    rerender(<LinkDomains payload={makePayload()} filters={{ ...allOn, active: [false, false] }} />);
    expect(screen.getByText("No authors selected — switch one back on in the filters.")).toBeInTheDocument();
  });

  it("leaves the normalised link list unbadged, filters or not", () => {
    // The Links section note names the date-less cards once; the card itself
    // carries no badge under any filter.
    const payload = makePayload();
    const { rerender } = render(<TopLinks payload={payload} filters={allOn} />);
    expect(screen.queryByText(/global only/i)).not.toBeInTheDocument();

    rerender(<TopLinks payload={payload} filters={{ ...allOn, years: [2024] }} />);
    expect(screen.queryByText(/global only/i)).not.toBeInTheDocument();

    rerender(<TopLinks payload={payload} filters={{ ...allOn, active: [true, false] }} />);
    expect(screen.queryByText(/global only/i)).not.toBeInTheDocument();
  });

  it("ranks the providers as a bar, saying which slice of the ranking it draws", () => {
    const payload = makePayload({
      providers: [
        ["YouTube", 6821],
        ["Tenor", 5102],
        ["unprovidenced", 2132],
        ["Klipy", 712],
        ["FxTwitter", 201],
        ["Twitch", 120],
        ["Spotify", 114],
        ["Streamable", 94],
      ],
    });
    render(<Providers payload={payload} filters={allOn} />);

    const option = lastOption();
    // Largest at the top: a category axis draws its first entry at the bottom.
    expect(option.series[0].type).toBe("bar");
    expect(option.yAxis.data).toEqual([
      "Streamable",
      "Spotify",
      "Twitch",
      "FxTwitter",
      "Klipy",
      "No provider",
      "Tenor",
      "YouTube",
    ]);
    expect(option.series[0].data).toEqual([94, 114, 120, 201, 712, 2132, 5102, 6821]);
    // No text card and no chart may print the sentinel: it is Discord's word
    // for "I could not name this", not a provider name.
    expect(document.body.textContent).not.toContain("unprovidenced");
    expect(JSON.stringify(option)).not.toContain("unprovidenced");
    // A bar claims no total, and the subtitle says these are all the payload sent.
    expect(screen.getByText(/15,296 embeds from every provider the payload carries/)).toBeInTheDocument();
  });

  it("narrows the bar to one provider when the card is scoped to it", () => {
    const payload = makePayload({
      providers: [
        ["YouTube", 6821],
        ["Tenor", 5102],
      ],
    });
    render(<Providers payload={payload} filters={{ ...allOn, provider: "YouTube" }} />);

    expect(lastOption().yAxis.data).toEqual(["YouTube"]);
    expect(screen.getByText(/6,821 embeds from only YouTube/)).toBeInTheDocument();
  });

  it("says so in words when it is drawing a cut of a longer provider list", () => {
    const providers: [string, number][] = Array.from({ length: 30 }, (_, index) => [
      `provider-${index}`,
      (30 - index) * 2,
    ]);
    render(<Providers payload={makePayload({ providers })} filters={allOn} />);

    expect(lastOption().series[0].data).toHaveLength(12);
    expect(screen.getByText(/the 12 biggest providers/)).toBeInTheDocument();
  });

  it("renders an empty embed-types panel without a chart", () => {
    render(<EmbedTypes payload={makePayload({ embedTypes: [] })} filters={allOn} />);

    expect(screen.getByText(/no embeds yet/i)).toBeInTheDocument();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it("leaves the embed-type doughnut unbadged under a filter", () => {
    const payload = makePayload({
      embedTypes: [
        ["video", 7506],
        ["gifv", 5816],
        ["link", 1087],
        ["rich", 1046],
        ["article", 849],
        ["image", 361],
      ],
    });
    const { rerender } = render(<EmbedTypes payload={payload} filters={allOn} />);
    expect(screen.queryByText(/global only/i)).not.toBeInTheDocument();

    rerender(<EmbedTypes payload={payload} filters={{ ...allOn, years: [2024] }} />);
    expect(screen.queryByText(/global only/i)).not.toBeInTheDocument();
  });

  it("explains the date-less Links cards once, at the section", () => {
    render(<LinksSection payload={makePayload()} filters={allOn} />);
    const note = screen.getByText(/3 of these 4 cards/);
    // The domains card filters its daily cells by date, so the note must not list it.
    expect(note).not.toHaveTextContent("Where the chat lives");
    expect(note).toHaveTextContent("Embed providers");
    expect(note).toHaveTextContent("Most reposted links");
    expect(note).toHaveTextContent("Embed types");
  });
});
