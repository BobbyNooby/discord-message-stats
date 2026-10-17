import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaRow } from "../api/types";
import { MediaTile } from "./MediaTile";

/**
 * `prefers-reduced-motion` and the offscreen pause: both are the same decision
 * — an animation nobody asked for should not run, and should certainly not keep
 * running after it has scrolled away.
 */

const cat: MediaRow = [
  "https://tenor.com/view/zesty-cat",
  "Tenor",
  "gifv",
  "Zesty Cat",
  "https://media.tenor.com/cat.png",
  "https://media.tenor.com/cat.mp4",
  63,
];

/** A `matchMedia` that answers the reduced-motion query, and can change its mind. */
function stubMotion(reduced: boolean) {
  const listeners = new Set<() => void>();
  let matches = reduced;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches && query.includes("reduced-motion");
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  return (next: boolean) => {
    matches = next;
    for (const listener of listeners) listener();
  };
}

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  vi.restoreAllMocks();
});

describe("<MediaTile> reduced motion", () => {
  it("autoplays an animated asset when the reader has not asked for less motion", () => {
    const { container } = render(<MediaTile row={cat} mode="proxy" />);

    expect(container.querySelector("video")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /play/i })).toBeNull();
  });

  it("shows the poster with a play control under prefers-reduced-motion", () => {
    stubMotion(true);
    const { container } = render(<MediaTile row={cat} mode="proxy" />);

    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", expect.stringContaining("cat.png"));
    expect(screen.getByRole("button", { name: "Play Tenor animation" })).toBeInTheDocument();
  });

  it("plays only when the reader presses the control", async () => {
    stubMotion(true);
    const { container } = render(<MediaTile row={cat} mode="proxy" />);

    await userEvent.click(screen.getByRole("button", { name: "Play Tenor animation" }));

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toContain("cat.mp4");
  });

  it("reacts when the setting changes mid-session", () => {
    const setReduced = stubMotion(false);
    const { container } = render(<MediaTile row={cat} mode="proxy" />);
    expect(container.querySelector("video")).not.toBeNull();

    act(() => setReduced(true));

    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
  });
});

describe("<MediaTile> preview fit", () => {
  it("fits the asset whole in a fixed box rather than cropping it", () => {
    const { container } = render(<MediaTile row={cat} mode="proxy" />);

    const video = container.querySelector("video")!;
    expect(video.className).toContain("object-contain");
    expect(video.className).not.toContain("object-cover");
    expect(video.parentElement?.className).toContain("h-24");
  });

  it("keeps a failed thumbnail in the same fixed box, so nothing shifts", () => {
    const broken: MediaRow = [
      "https://tenor.com/view/gone",
      "Tenor",
      "gifv",
      "",
      "https://media.tenor.com/gone.png",
      "",
      2,
    ];
    const { container } = render(<MediaTile row={broken} mode="proxy" />);

    const image = container.querySelector("img")!;
    expect(image.className).toContain("object-contain");
    fireEvent.error(image);

    expect(container.querySelector("img")).toBeNull();
    const frame = container.querySelector("a > div")!;
    expect(frame.className).toContain("h-24");
    expect(frame.textContent).toContain("Tenor");
  });
});

describe("<MediaTile> offscreen videos", () => {
  it("pauses an autoplaying tile that scrolls out of view", () => {
    let callback: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
    class Observer {
      constructor(next: (entries: { isIntersecting: boolean }[]) => void) {
        callback = next;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = Observer;
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(<MediaTile row={cat} mode="proxy" />);
    expect(callback).not.toBeNull();

    callback!([{ isIntersecting: false }]);
    expect(pause).toHaveBeenCalled();

    callback!([{ isIntersecting: true }]);
    expect(play).toHaveBeenCalled();
  });
});
