import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Payload } from "../api/types";
import { GlobalSearch, searchPayload } from "./GlobalSearch";

const payload = {
  authors: [
    { id: "u1", name: "Alice", msgs: 10 },
    { id: "u2", name: "bob", msgs: 4 },
  ],
  words: [
    ["cat", 50],
    ["catalog", 5],
    ["dog", 9],
  ],
  linkDomains: ["youtube.com", "github.com"],
  topMedia: [["https://example.test/cat.gif", "Tenor", "gifv", "Cat GIF", "", 1, 63]],
} as unknown as Payload;

beforeEach(() => {
  // jsdom has no layout, so scrolling is a no-op we can still observe.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("searchPayload", () => {
  it("finds an author, a word, a domain and a media item from the payload indexes", () => {
    expect(searchPayload(payload, "bob").map((hit) => hit.kind)).toContain("author");
    expect(searchPayload(payload, "cat").map((hit) => hit.kind)).toContain("word");
    expect(searchPayload(payload, "youtube").map((hit) => hit.kind)).toContain("domain");
    expect(searchPayload(payload, "gif").map((hit) => hit.kind)).toContain("media");
  });

  it("returns nothing for an empty query and ranks prefixes first", () => {
    expect(searchPayload(payload, "  ")).toEqual([]);
    const cat = searchPayload(payload, "cat");
    expect(cat[0].label.toLowerCase().startsWith("cat")).toBe(true);
  });
});

describe("<GlobalSearch>", () => {
  it("is one combobox whose results are reachable and selectable by keyboard", async () => {
    const dispatch = vi.fn();
    render(
      <>
        <GlobalSearch payload={payload} dispatch={dispatch} />
        <section id="who-talks-the-most" tabIndex={-1}>
          leaderboard
        </section>
      </>,
    );

    const input = screen.getByRole("combobox", { name: "Search the dashboard" });
    expect(input).toHaveAttribute("aria-expanded", "false");

    await userEvent.type(input, "bob");
    expect(input).toHaveAttribute("aria-expanded", "true");
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);

    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");

    expect(dispatch).toHaveBeenCalledWith({ type: "onlyAuthor", index: 1 });
    expect(document.getElementById("who-talks-the-most")).toHaveFocus();
  });

  it("applies the word scope and jumps to the word card", async () => {
    const dispatch = vi.fn();
    render(
      <>
        <GlobalSearch payload={payload} dispatch={dispatch} />
        <section id="word-index" tabIndex={-1}>
          words
        </section>
      </>,
    );
    await userEvent.type(screen.getByRole("combobox"), "catalog");
    await userEvent.keyboard("{Enter}");

    expect(dispatch).toHaveBeenCalledWith({ type: "setWord", word: "catalog" });
    expect(document.getElementById("word-index")).toHaveFocus();
  });

  it("jumps to the domain card without touching the filters", async () => {
    const dispatch = vi.fn();
    render(
      <>
        <GlobalSearch payload={payload} dispatch={dispatch} />
        <section id="where-the-chat-lives" tabIndex={-1}>
          domains
        </section>
      </>,
    );
    await userEvent.type(screen.getByRole("combobox"), "youtube");
    await userEvent.keyboard("{Enter}");

    expect(dispatch).not.toHaveBeenCalled();
    expect(document.getElementById("where-the-chat-lives")).toHaveFocus();
  });

  it("jumps to the reposted card for a media item", async () => {
    const dispatch = vi.fn();
    render(
      <>
        <GlobalSearch payload={payload} dispatch={dispatch} />
        <section id="most-reposted" tabIndex={-1}>
          media
        </section>
      </>,
    );
    await userEvent.type(screen.getByRole("combobox"), "cat gif");
    await userEvent.keyboard("{Enter}");

    expect(document.getElementById("most-reposted")).toHaveFocus();
  });

  it("closes its results on Escape", async () => {
    render(<GlobalSearch payload={payload} dispatch={vi.fn()} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "bob");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveFocus();
  });

  it("says when nothing matches", async () => {
    render(<GlobalSearch payload={payload} dispatch={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "zzzz");
    expect(screen.getByRole("status")).toHaveTextContent(/nothing matches/i);
  });
});
