import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import type { Payload } from "./api/types";
import { CARD_COLUMNS } from "./components/Panel";
import { JumpNav } from "./components/JumpNav";
import { MediaTile } from "./panels/MediaTile";
import { initialFilters } from "./filters/reducer";
import { OverviewSection } from "./panels/OverviewSection";
import { TimeSection } from "./panels/TimeSection";
import { PeopleSection } from "./panels/PeopleSection";
import { WordsSection } from "./panels/WordsSection";
import { LinksSection } from "./panels/LinksSection";
import { RichMediaSection } from "./panels/RichMedia";
import { MediaSection } from "./panels/MediaSection";
import type { Action, Filters } from "./filters/reducer";
import type { MediaRow } from "./api/types";

/**
 * The layout class that no behavioural test could see: the owner found three
 * defects by eye that every gate had passed — a scoped sidebar full of dead
 * placeholders, GIF previews cropped by `object-cover`, and section headings
 * laid into the columns beside cards. jsdom has no layout, so the suite must
 * assert the structural facts a browser would otherwise be the only witness to.
 *
 * These are the assertions, not a substitute for looking: sections.test.tsx
 * still checks each heading is an `h2` under its section, and JumpNav.test.tsx
 * still checks the sticky wrapper's offset padding. This file closes the gaps
 * those two leave, and each test names the defect class it keeps out.
 */

/** Every non-test source, read the way Vite reads it — the same trick registry.test uses. */
const SOURCES = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const payload = {
  authors: [{ id: "u1", name: "A", msgs: 2 }],
  days: ["2023-01-01"],
  cells: [[0, 0, 2, 10, 1, 0, 0]],
  heat: [[0, 10, 0, 2023, 2]],
  edges: [[0, 0, 1]],
  response: [[0, 30, 1]],
  editSpeed: [[0, 12, 1]],
  starters: [[0, 1]],
  attachments: [["image/png", 1]],
  words: [["abc", 2]],
  wordAuthors: { abc: [[0, 2]] },
  authorWordTotals: [2],
  authorDistinct: [1],
  identities: [],
  linkDomains: ["x.com"],
  linkCells: [[0, 0, 0, 1]],
  topLinks: [["x.com/a", 1]],
  providers: [["YouTube", 1]],
  embedTypes: [["video", 1]],
  linkStats: { msgs: 1, domains: 1, both: 1 },
  emoji: [["😀", 1]],
  reactions: [["fire", 1]],
  types: [[0, "default", 2]],
  tz: { name: "UTC", label: "UTC" },
  channel_hint: "c1",
  meta: { types: [[0, "default", 2]], stale: false, can_admin: false, timezone: "UTC", total: 2 },
} as unknown as Payload;

type SectionProps = { payload: Payload; filters: Filters; dispatch: (action: Action) => void };

const SECTIONS: [string, ComponentType<SectionProps>][] = [
  ["sec-overview", OverviewSection],
  ["sec-time", TimeSection],
  ["sec-people", PeopleSection],
  ["sec-words", WordsSection],
  ["sec-links", LinksSection],
  ["sec-media-rich", RichMediaSection],
  ["sec-media", MediaSection],
];

const renderSection = (Component: ComponentType<SectionProps>) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Component payload={payload} filters={initialFilters(payload)} dispatch={() => {}} />
    </QueryClientProvider>,
  );

/** The one container each section lays its cards out in: columns or a grid. */
function cardsContainer(section: Element): Element | null {
  return (
    [...section.children].find(
      (child) =>
        typeof child.className === "string" && /(^|\s)(columns-[0-9]|grid-cols)/.test(child.className),
    ) ?? null
  );
}

describe("layout guards the browser used to be the only witness to", () => {
  it("never crops a media preview: no source uses object-cover", () => {
    // The defect: GIF previews were cropped by `object-cover`. A single
    // attribute on one preview is all it takes, so this scans every source
    // rather than rendering the one tile that exists today.
    const offenders = Object.entries(SOURCES)
      .filter(([file]) => !file.includes(".test."))
      .filter(([, text]) => /\bobject-cover\b/.test(text))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });

  it("fits every preview whole inside one shared frame height", () => {
    // The other half of the cropping defect: object-contain keeps the asset's
    // aspect, and one frame height keeps the ranking from looking ragged.
    const row: MediaRow = [
      "https://example.test/tall.gif",
      "Tenor",
      "gifv",
      "tall",
      "https://example.test/tall.png",
      "",
      3,
    ];
    const { container } = render(<MediaTile row={row} mode="proxy" rank={1} />);

    const preview = container.querySelector("img")!;
    expect(preview.className).toContain("object-contain");
    expect(preview.className).toContain("max-h-full");
    const frame = preview.parentElement!;
    expect(frame.className).toContain("h-24");
    expect(frame.className).toContain("overflow-hidden");
    cleanup();
  });

  it("caps the card columns at two and never three", () => {
    // A third column at 1440px squeezes a chart card to a phone's width. The
    // cap lives in one string; a typo there is invisible in every other test.
    expect(CARD_COLUMNS).toContain("columns-1");
    expect(CARD_COLUMNS).toContain("columns-2");
    expect(CARD_COLUMNS).not.toMatch(/columns-[3-9]/);
  });

  it("keeps every section heading out of the columns container", () => {
    // The defect: a heading inside the columns container is laid into the first
    // column and cards pack beside it. sections.test.tsx proves the parent is
    // the section; this proves the heading is not inside the container the
    // cards flow through, and comes before it in document order.
    for (const [id, Component] of SECTIONS) {
      const { container, unmount } = renderSection(Component);
      const section = container.querySelector(`section[aria-labelledby="${id}"]`)!;
      const heading = container.querySelector(`#${id}`)!;
      const flow = cardsContainer(section);

      expect(flow, `${id} has no cards container`).not.toBeNull();
      expect(flow!.contains(heading), `${id} heading is inside the columns container`).toBe(false);
      expect(heading.parentElement, `${id} heading parent`).toBe(section);
      expect(
        heading.compareDocumentPosition(flow!) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${id} heading must come before its cards`,
      ).toBeTruthy();
      unmount();
    }
  });

  it("keeps every card unbroken and spaced inside a column", () => {
    // `columns` sets the column gap but not the space *between* stacked cards:
    // that is each card's own `mb-4`. `break-inside-avoid` is what stops a card
    // being cut in half across two columns. Both are one attribute each.
    for (const [id, Component] of SECTIONS) {
      const { container, unmount } = renderSection(Component);
      const cards = [...container.querySelectorAll('section[id][tabindex="-1"]')];
      expect(cards.length, `${id} rendered no cards`).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.className, `${card.id} spacing`).toContain("mb-4");
        expect(card.className, `${card.id} break`).toContain("break-inside-avoid");
      }
      unmount();
    }
  });

  it("keeps the sticky jump bar pinned above the content it floats over", () => {
    // The bar must own the top of the stacking order and stick at 0; the
    // wrapper's padding (in JumpNav.test.tsx) is only visible because of this.
    render(<JumpNav />);
    const nav = document.querySelector('nav[aria-label="Sections"]')!;
    const wrapper = nav.parentElement!;
    expect(wrapper.className).toContain("top-0");
    expect(wrapper.className).toContain("z-20");
  });
});
