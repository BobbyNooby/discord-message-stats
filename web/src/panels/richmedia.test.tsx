import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Payload } from "../api/types";
import { initialFilters } from "../filters/reducer";
import { RichMedia } from "./RichMedia";

const base = {
  authors: [{ id: "u1", name: "A", msgs: 1 }],
  providers: [["Tenor", 5102], ["YouTube", 6821]] as [string, number][],
  topMedia: [
    ["https://tenor.com/view/zesty-cat", "Tenor", "gifv", "Zesty Cat", "https://media.tenor.com/cat.gif", 63],
    ["https://klipy.com/gifs/blm", "Klipy", "gifv", "", "https://static.klipy.com/blm.gif", 55],
  ] as [string, string, string, string, string, number][],
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
    [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));

  it("routes thumbnails through this server by default", () => {
    const { container } = render(<RichMedia payload={base} filters={initialFilters(base)} />);
    expect(thumbnails(container)[0]).toContain("/api/thumb?u=");
  });

  it("asks the CDN directly when configured to", () => {
    const { container } = render(
      <RichMedia payload={{ ...base, mediaThumbnails: "direct" } as Payload} filters={initialFilters(base)} />,
    );
    expect(thumbnails(container)[0]).toBe("https://media.tenor.com/cat.gif");
  });

  it("shows no images at all when thumbnails are off", () => {
    const { container } = render(
      <RichMedia payload={{ ...base, mediaThumbnails: "off" } as Payload} filters={initialFilters(base)} />,
    );
    expect(thumbnails(container)).toHaveLength(0);
    expect(screen.getByText("63×")).toBeInTheDocument();
  });
});
