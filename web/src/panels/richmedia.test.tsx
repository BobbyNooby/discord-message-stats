import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rich-media card and its "Show top 50" view.
 *
 * The card is the payload's own top ranking; the view asks the server, because
 * the payload only ships a dozen rows per provider (`/api/media` has the full
 * ranking). React Query is real in these tests and the HTTP call is mocked, so
 * the assertion is on the URL the view actually builds.
 */
const server = vi.hoisted(() => ({ getMedia: vi.fn() }));

vi.mock("../api/client", () => ({
  Unauthorized: class Unauthorized extends Error {},
  getBootstrap: vi.fn(),
  getHealth: vi.fn(),
  getRecent: vi.fn(),
  getWords: vi.fn(),
  getMedia: server.getMedia,
}));

import type { MediaRow, Payload } from "../api/types";
import { initialFilters, type Filters } from "../filters/reducer";
import { RichMedia } from "./RichMedia";

const cat: MediaRow = [
  "https://tenor.com/view/zesty-cat",
  "Tenor",
  "gifv",
  "Zesty Cat",
  "https://media.tenor.com/cat.png",
  "https://media.tenor.com/cat.mp4",
  63,
];

const base = {
  authors: [{ id: "u1", name: "A", msgs: 1 }],
  providers: [["Tenor", 5102], ["YouTube", 6821]] as [string, number][],
  topMedia: [
    cat,
    ["https://klipy.com/gifs/blm", "Klipy", "gifv", "", "https://static.klipy.com/blm.gif", "", 55],
    ["https://cdn.discordapp.com/attachments/1/2/cat.png", "unprovidenced", "image", "", "https://cdn.discordapp.com/attachments/1/2/cat.png", "", 35],
  ] as MediaRow[],
  meta: { stale: false, can_admin: false },
} as unknown as Payload;

/** The card as the app mounts it: a real query client over the mocked client. */
function renderCard(payload: Payload = base, filters?: Filters) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RichMedia payload={payload} filters={filters ?? initialFilters(payload)} />
    </QueryClientProvider>,
  );
}

function many(count: number): MediaRow[] {
  return Array.from({ length: count }, (_, index) => [
    `https://tenor.com/view/item-${index}`,
    "Tenor",
    "gifv",
    `Item ${index}`,
    "",
    "",
    100 - index,
  ]);
}

const openView = async () => userEvent.click(screen.getByRole("button", { name: /^Browse all/ }));

beforeEach(() => {
  server.getMedia.mockReset();
  server.getMedia.mockResolvedValue({ provider: null, items: many(3) });
  // The view mirrors itself into the query string, so each test starts clean.
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  // The narrow-screen test replaces it; leave jsdom as it found it.
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("<RichMedia>", () => {
  it("says the repost count in words, with the provider and the kind", () => {
    renderCard();
    // "63× Tenor gifv" is a convention, not a sentence (§UI/UX rule 1).
    expect(screen.getByText(/posted 63 times · Tenor GIF/)).toBeInTheDocument();
    expect(screen.getByText(/posted 55 times · Klipy GIF/)).toBeInTheDocument();
    expect(screen.queryByText("63×")).toBeNull();
    expect(screen.getByText("Zesty Cat")).toBeInTheDocument();
  });

  it("falls back to the URL when there is no title", () => {
    renderCard();
    expect(screen.getByText("blm")).toBeInTheDocument();
  });

  const thumbnails = (container: HTMLElement) =>
    [...container.querySelectorAll("img, video")].map((el) => el.getAttribute("src"));

  it("routes thumbnails through this server by default", () => {
    const { container } = renderCard();
    expect(thumbnails(container)[0]).toContain("/api/thumb?u=");   // the mp4, proxied
  });

  it("asks the CDN directly when configured to", () => {
    const { container } = renderCard({ ...base, mediaThumbnails: "direct" } as Payload);
    expect(thumbnails(container)[0]).toBe("https://media.tenor.com/cat.mp4");
  });

  it("plays an animated asset instead of a still poster", () => {
    const { container } = renderCard();
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toContain("cat.mp4");
    expect(video?.getAttribute("poster")).toContain("cat.png");
  });

  it("calls an unnamed Discord CDN item a direct upload, not 'unprovidenced'", () => {
    renderCard();
    expect(screen.getByText(/posted 35 times · Direct upload image/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("unprovidenced");
  });

  it("shows ten items in the card, with the way to the top 50", () => {
    const { container } = renderCard({ ...base, topMedia: many(14) } as Payload);
    expect(container.querySelectorAll("li")).toHaveLength(10);
    expect(screen.getByText(/top 10 of 14/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Browse all/ })).toBeInTheDocument();
  });

  it("ranks the card's ten items and carries the ranking on to the top 50", async () => {
    server.getMedia.mockResolvedValue({ provider: null, kinds: [], items: many(50) });
    renderCard({ ...base, topMedia: many(14) } as Payload);

    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#10")).toBeInTheDocument();
    expect(screen.queryByText("#11")).toBeNull();

    await openView();
    const dialog = await screen.findByRole("dialog", { name: /top 50/i });
    // The ranking is the list order, so it continues past the card's ten.
    expect(within(dialog).getByText("#50")).toBeInTheDocument();
  });

  it("draws the payload's one ranking, with no per-provider tabs", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: "Video links" })).toBeNull();
    expect(screen.queryByRole("button", { name: "GIFs" })).toBeNull();
    // `mediaByProvider` no longer ships: the top-50 view asks `/api/media` for
    // a provider's own ranking, so the card draws only `topMedia`.
    expect(screen.getByText("Zesty Cat")).toBeInTheDocument();
  });

  it("opens the server's top 50 in a labelled dialog", async () => {
    server.getMedia.mockResolvedValue({ provider: null, kinds: [], items: many(50) });
    renderCard();
    await openView();

    const dialog = await screen.findByRole("dialog", { name: /top 50/i });
    expect(server.getMedia).toHaveBeenCalledWith(undefined, undefined, 50);
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(50);
  });

  it("filters by provider through the api when a chip is chosen", async () => {
    renderCard();
    await openView();
    await screen.findByRole("dialog", { name: /top 50/i });

    server.getMedia.mockResolvedValue({ provider: "Tenor", kinds: [], items: [cat] });
    await userEvent.click(screen.getByRole("button", { name: "Tenor" }));

    await waitFor(() => expect(server.getMedia).toHaveBeenCalledWith("Tenor", undefined, 50));
    const dialog = await screen.findByRole("dialog", { name: /top 50/i });
    expect(within(dialog).getByText(/posted 63 times · Tenor GIF/)).toBeInTheDocument();
  });

  it("opens the full view already filtered from a card-level provider chip", async () => {
    server.getMedia.mockResolvedValue({ provider: "YouTube", kinds: [], items: many(2) });
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Browse YouTube" }));

    await waitFor(() => expect(server.getMedia).toHaveBeenCalledWith("YouTube", undefined, 50));
    const dialog = await screen.findByRole("dialog", { name: /top 50/i });
    // The view opens with that provider already selected, not decoration.
    expect(within(dialog).getByRole("button", { name: "YouTube" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows a scoped provider's own top rows instead of the payload's ranking", async () => {
    const video: MediaRow = ["https://youtu.be/abc", "YouTube", "video", "A video", "", "", 9];
    server.getMedia.mockResolvedValue({ provider: "YouTube", kind: null, kinds: [], items: [video] });
    renderCard(base, { ...initialFilters(base), provider: "YouTube" });

    // The card asks the server, not a client-side filter of its 24 payload rows.
    await waitFor(() => expect(server.getMedia).toHaveBeenCalledWith("YouTube", undefined, 10));
    expect(await screen.findByText("A video")).toBeInTheDocument();
    expect(screen.queryByText("Zesty Cat")).toBeNull();
    expect(screen.getByText(/top 1 for YouTube/)).toBeInTheDocument();
  });

  it("names the two chip groups so they do not read as decoration", async () => {
    server.getMedia.mockResolvedValue({ provider: null, kinds: ["gifv", "video"], items: [cat] });
    renderCard();
    await openView();
    const dialog = await screen.findByRole("dialog", { name: /top 50/i });

    expect(within(dialog).getByText("Provider")).toBeInTheDocument();
    expect(within(dialog).getByText("Kind")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "All providers" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("filters the whole set by kind through the api, not the page in hand", async () => {
    const video: MediaRow = ["https://youtu.be/abc", "YouTube", "video", "A video", "", "", 9];
    server.getMedia.mockResolvedValue({ provider: null, kinds: ["gifv", "video"], items: [cat, video] });
    renderCard();
    await openView();
    const dialog = await screen.findByRole("dialog", { name: /top 50/i });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);

    // The server is the one that can see past the fifty-row page, so choosing a
    // kind is another request — not a filter over what already arrived.
    server.getMedia.mockResolvedValue({ provider: null, kinds: ["gifv", "video"], items: [video] });
    await userEvent.click(screen.getByRole("button", { name: "video" }));

    await waitFor(() => expect(server.getMedia).toHaveBeenCalledWith(undefined, "video", 50));
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
  });

  it("caps the provider strip so the thumbnails stay above the fold on a phone", async () => {
    const manyProviders = Array.from(
      { length: 30 },
      (_, index) => [`Provider ${index}`, 100 - index] as [string, number],
    );
    renderCard({ ...base, providers: manyProviders } as Payload);
    await openView();
    await screen.findByRole("dialog", { name: /top 50/i });

    // Eight chips, not thirty: the rest are one control away.
    expect(screen.getByRole("button", { name: "Provider 7" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Provider 8" })).toBeNull();
    const more = screen.getByRole("button", { name: "More providers (22)" });
    expect(more).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(more);

    expect(screen.getByRole("button", { name: "Provider 29" })).toBeInTheDocument();
    // The expanded strip scrolls inside itself rather than growing the page.
    expect(screen.getByRole("group", { name: "Filter by provider" }).className).toContain(
      "overflow-y-auto",
    );
  });

  it("offers the opened ranking as a csv, from the rows on screen", async () => {
    renderCard();
    await openView();
    await screen.findByRole("dialog", { name: /top 50/i });

    expect(screen.getByRole("button", { name: /export csv/i })).toBeEnabled();
  });

  it("opens as a sheet on a narrow screen", async () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    renderCard();
    await openView();

    expect(await screen.findByRole("dialog", { name: /top 50/i })).toHaveClass("right-0");
  });

  it("puts ?media=1 in the url, and the Back button closes the view", async () => {
    renderCard();
    await openView();
    expect(window.location.search).toBe("?media=1");

    window.history.back();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.location.search).toBe("");
  });

  it("opens straight from a shared ?media=1 link", async () => {
    window.history.replaceState(null, "", "/?media=1&scope=nothing");
    renderCard();
    expect(await screen.findByRole("dialog", { name: /top 50/i })).toBeInTheDocument();
  });

  it("closes from its own Close button without leaving the page", async () => {
    renderCard();
    await openView();
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.location.search).toBe("");
  });

  it("shows no images at all when thumbnails are off", () => {
    const { container } = renderCard({ ...base, mediaThumbnails: "off" } as Payload);
    expect(thumbnails(container)).toHaveLength(0);
    expect(container.querySelectorAll("video")).toHaveLength(0);
    expect(screen.getByText(/posted 63 times/)).toBeInTheDocument();
  });
});
