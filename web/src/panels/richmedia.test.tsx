import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Payload } from "../api/types";
import { initialFilters } from "../filters/reducer";
import { RichMedia } from "./RichMedia";

const base = {
  authors: [{ id: "u1", name: "A", msgs: 1 }],
  providers: [["Tenor", 5102], ["YouTube", 6821]] as [string, number][],
  topMedia: [
    ["https://tenor.com/view/zesty-cat", "Tenor", "gifv", "Zesty Cat", "https://media.tenor.com/cat.png", "https://media.tenor.com/cat.mp4", 63],
    ["https://klipy.com/gifs/blm", "Klipy", "gifv", "", "https://static.klipy.com/blm.gif", "", 55],
    ["https://cdn.discordapp.com/attachments/1/2/cat.png", "unprovidenced", "image", "", "https://cdn.discordapp.com/attachments/1/2/cat.png", "", 35],
  ] as [string, string, string, string, string, string, number][],
  mediaByProvider: {
    YouTube: [["https://www.youtube.com/watch?v=abc", "YouTube", "video", "A video", "https://i.ytimg.com/vi/abc/hq.jpg", "", 9]],
  },
  meta: { stale: false, can_admin: false },
} as unknown as Payload;

describe("<RichMedia>", () => {
  it("shows the repost count and the provider for each item", () => {
    render(<RichMedia payload={base} filters={initialFilters(base)} />);
    expect(screen.getByText("63×")).toBeInTheDocument();
    expect(screen.getByText("55×")).toBeInTheDocument();
    expect(screen.getByText("Zesty Cat")).toBeInTheDocument();
  });

  it("falls back to the URL when there is no title", () => {
    render(<RichMedia payload={base} filters={initialFilters(base)} />);
    expect(screen.getByText("blm")).toBeInTheDocument();
  });

  const thumbnails = (container: HTMLElement) =>
    [...container.querySelectorAll("img, video")].map((el) => el.getAttribute("src"));

  it("routes thumbnails through this server by default", () => {
    const { container } = render(<RichMedia payload={base} filters={initialFilters(base)} />);
    expect(thumbnails(container)[0]).toContain("/api/thumb?u=");   // the mp4, proxied
  });

  it("asks the CDN directly when configured to", () => {
    const { container } = render(
      <RichMedia payload={{ ...base, mediaThumbnails: "direct" } as Payload} filters={initialFilters(base)} />,
    );
    expect(thumbnails(container)[0]).toBe("https://media.tenor.com/cat.mp4");
  });

  it("plays an animated asset instead of a still poster", () => {
    const { container } = render(<RichMedia payload={base} filters={initialFilters(base)} />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toContain("cat.mp4");
    expect(video?.getAttribute("poster")).toContain("cat.png");
  });

  it("calls an unnamed Discord CDN item a direct upload, not 'unprovidenced'", () => {
    render(<RichMedia payload={base} filters={initialFilters(base)} />);
    expect(screen.getByText("Direct upload")).toBeInTheDocument();
    expect(screen.queryByText("unprovidenced")).toBeNull();
  });

  it("has a tab whose ranking is computed for its own slice", () => {
    render(<RichMedia payload={base} filters={initialFilters(base)} />);
    // YouTube's own top is in the payload because ranking everything together
    // would never show it
    expect(screen.getByRole("button", { name: "Video links" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GIFs" })).toBeInTheDocument();
  });

  it("shows no images at all when thumbnails are off", () => {
    const { container } = render(
      <RichMedia payload={{ ...base, mediaThumbnails: "off" } as Payload} filters={initialFilters(base)} />,
    );
    expect(thumbnails(container)).toHaveLength(0);
    expect(container.querySelectorAll("video")).toHaveLength(0);
    expect(screen.getByText("63×")).toBeInTheDocument();
  });
});
