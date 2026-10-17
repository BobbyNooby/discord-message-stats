import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JumpNav, SECTIONS } from "./JumpNav";

/**
 * The page is seven sections long, so the nav has to reach all seven and get
 * back to the top — and it must scroll sideways inside itself, never widen the
 * document at 390px.
 */
describe("<JumpNav>", () => {
  afterEach(() => delete (window as { matchMedia?: unknown }).matchMedia);

  it("links to every section, with an icon each", () => {
    render(<JumpNav />);

    for (const section of SECTIONS) {
      const link = screen.getByRole("link", { name: section.label });
      expect(link).toHaveAttribute("href", `#${section.id}`);
      expect(link.querySelector("svg")).not.toBeNull();
    }
  });

  it("scrolls sideways inside the strip rather than widening the page", () => {
    render(<JumpNav />);

    expect(screen.getByRole("navigation", { name: "Sections" }).className).toContain("overflow-x-auto");
  });

  it("goes back to the top", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    render(<JumpNav />);

    fireEvent.click(screen.getByRole("button", { name: "Top" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    vi.unstubAllGlobals();
  });

  it("jumps instantly when the reader asked for less motion", () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    render(<JumpNav />);

    fireEvent.click(screen.getByRole("button", { name: "Top" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    vi.unstubAllGlobals();
  });
});
