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
import { initialFilters } from "../filters/reducer";
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
  mediaByProvider: {
    YouTube: [["https://www.youtube.com/watch?v=abc", "YouTube", "video", "A video", "https://i.ytimg.com/vi/abc/hq.jpg", "", 9]],
  },
  meta: { stale: false, can_admin: false },
} as unknown as Payload;

/** The card as the app mounts it: a real query client over the mocked client. */
function renderCard(payload: Payload = base) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RichMedia payload={payload} filters={initialFilters(payload)} />
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

const openView = async () => userEvent.click(screen.getByRole("button", { name: "Show top 50" }));

beforeEach(() => {
  server.getMedia.mockReset();
  server.getMedia.mockResolvedValue({ provider: null, items: many(3) });
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
    expect(screen.getByRole("button", { name: "Show top 50" })).toBeInTheDocument();
  });

  it("drops the tabs and ignores the payload's old per-provider rankings", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: "Video links" })).toBeNull();
    expect(screen.queryByRole("button", { name: "GIFs" })).toBeNull();
    // `mediaByProvider` ships YouTube's own ranking; the view asks the server
    // now, so nothing may draw it.
    expect(screen.queryByText("A video")).toBeNull();
  });

  it("opens the server's top 50 in a labelled dialog", async () => {
    server.getMedia.mockResolvedValue({ provider: null, items: many(50) });
    renderCard();
    await openView();

    const dialog = await screen.findByRole("dialog", { name: /top 50/i });
    expect(server.getMedia).toHaveBeenCalledWith(undefined, 50);
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(50);
  });

  it("filters by provider through the api when a chip is chosen", async () => {
    renderCard();
    await openView();
    await screen.findByRole("dialog", { name: /top 50/i });

    server.getMedia.mockResolvedValue({ provider: "Tenor", items: [cat] });
    await userEvent.click(screen.getByRole("button", { name: "Tenor" }));

    await waitFor(() => expect(server.getMedia).toHaveBeenCalledWith("Tenor", 50));
    const dialog = await screen.findByRole("dialog", { name: /top 50/i });
    expect(within(dialog).getByText(/posted 63 times · Tenor GIF/)).toBeInTheDocument();
  });

  it("filters the opened list by kind without asking the server again", async () => {
    const video: MediaRow = ["https://youtu.be/abc", "YouTube", "video", "A video", "", "", 9];
    server.getMedia.mockResolvedValue({ provider: null, items: [cat, video] });
    renderCard();
    await openView();
    const dialog = await screen.findByRole("dialog", { name: /top 50/i });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "video" }));

    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
    expect(server.getMedia).toHaveBeenCalledTimes(1);
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

  it("shows no images at all when thumbnails are off", () => {
    const { container } = renderCard({ ...base, mediaThumbnails: "off" } as Payload);
    expect(thumbnails(container)).toHaveLength(0);
    expect(container.querySelectorAll("video")).toHaveLength(0);
    expect(screen.getByText(/posted 63 times/)).toBeInTheDocument();
  });
});
