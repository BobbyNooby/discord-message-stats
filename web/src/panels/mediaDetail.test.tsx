import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaRow, Payload } from "../api/types";
import { MediaDetailBody } from "./MediaDetail";
import { MediaTile } from "./MediaTile";

const mocks = vi.hoisted(() => {
  const instance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn(), clear: vi.fn() };
  return { instance, init: vi.fn(() => instance), useMediaDetail: vi.fn() };
});

vi.mock("echarts", () => ({ init: mocks.init, use: vi.fn() }));
vi.mock("../api/queries", () => ({ useMediaDetail: mocks.useMediaDetail }));

const cat: MediaRow = ["https://tenor.com/view/cat", "Tenor", "gifv", "zesty cat", "", "", 3];

const payload = {
  authors: [
    { id: "u1", name: "Ada", msgs: 10 },
    { id: "u2", name: "Bo", msgs: 5, accounts: ["u2", "u2alt"] },
  ],
  tz: { name: "UTC", label: "UTC" },
} as unknown as Payload;

describe("media detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the detail view from a tile instead of leaving for Tenor", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<MediaTile row={cat} mode="off" rank={1} onOpen={onOpen} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // One control per tile, named by what it shows — the count included.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/#1.*zesty cat.*posted 3 times/i);
    await user.click(buttons[0]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("still links to the original when nobody offers a detail view", () => {
    render(<MediaTile row={cat} mode="off" rank={1} />);
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", cat[0]);
  });

  it("says who posted it, how often, and who was first", () => {
    mocks.useMediaDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        item: cat,
        first_seen: "2026-01-05T10:00:00+00:00",
        last_seen: "2026-02-06T10:00:00+00:00",
        people: [
          { id: "u1", name: "Ada", count: 2, first_seen: "2026-01-06T10:00:00+00:00" },
          { id: "u2alt", name: "Bo", count: 1, first_seen: "2026-01-05T10:00:00+00:00" },
        ],
        months: [
          { month: "2026-01", id: "u1", count: 1 },
          { month: "2026-01", id: "u2alt", count: 1 },
          { month: "2026-02", id: "u1", count: 1 },
        ],
        first_post: {
          id: "u2alt", name: "Bo", at: "2026-01-05T10:00:00+00:00", message_id: "m1",
          jump_url: "https://discord.com/channels/@me/c1/m1",
        },
      },
    });
    render(<MediaDetailBody row={cat} payload={payload} mode="off" />);
    expect(mocks.useMediaDetail).toHaveBeenCalledWith(cat[0]);
    expect(screen.getByText("2 times · 67%")).toBeInTheDocument();
    expect(screen.getByText("1 time · 33%")).toBeInTheDocument();
    expect(screen.getByText(/5 Jan 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open in discord/i })).toHaveAttribute(
      "href",
      "https://discord.com/channels/@me/c1/m1",
    );
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });

  it("asks for a rebuild when the per-person table is not built yet", () => {
    mocks.useMediaDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { item: cat, first_seen: null, last_seen: null, people: null, months: null, first_post: null },
    });
    render(<MediaDetailBody row={cat} payload={payload} mode="off" />);
    expect(screen.getByText(/needs one rebuild/)).toBeInTheDocument();
  });
});
