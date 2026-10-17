import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthorFilterList } from "./AuthorFilterList";
import { RecentStrip } from "./RecentStrip";
import { MediaTile } from "../panels/MediaTile";

/**
 * Anything the layout clips has to keep its whole value somewhere: a truncated
 * nickname or message with no way to read the rest is data the page is hiding.
 */
describe("truncated values", () => {
  it("keeps a clipped author name on the element", () => {
    const name = "Bobbynooby (the very long display name)";
    render(
      <AuthorFilterList
        authors={[{ id: "u1", name, msgs: 3 }]}
        active={[true]}
        onToggle={() => {}}
        onAll={() => {}}
        onNone={() => {}}
      />,
    );

    const label = screen.getByText(name);
    expect(label).toHaveClass("truncate");
    expect(label).toHaveAttribute("title", name);
  });

  it("keeps a clipped message body on the element", () => {
    const body = "a message long enough that the strip has to cut it somewhere";
    render(<RecentStrip messages={[{ author: "Ada", created_at: "2026-10-17T10:00:00Z", body }]} />);

    const text = screen.getByText(body);
    expect(text).toHaveClass("truncate");
    expect(text).toHaveAttribute("title", body);
  });

  it("keeps a media item's full name and caption on the tile", () => {
    const title = "A GIF with a very long title that the tile has to clip";
    render(
      <MediaTile
        row={[
          "https://tenor.com/view/long",
          "Tenor",
          "gifv",
          title,
          "https://media.tenor.com/long.png",
          "",
          63,
        ]}
        mode="proxy"
      />,
    );

    const name = screen.getByText(title);
    expect(name).toHaveClass("truncate");
    expect(name).toHaveAttribute("title", title);
    expect(screen.getByText(/posted 63 times · Tenor GIF/)).toHaveAttribute(
      "title",
      "posted 63 times · Tenor GIF",
    );
  });
});
