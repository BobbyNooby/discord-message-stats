import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardSkeleton, Forbidden, Offline, ServerError } from "./States";

/**
 * Four states that used to look identical: a spinner that never resolves. Each
 * one has to name itself and say what to do next.
 */
describe("fetch states", () => {
  it("shows a skeleton that announces the wait and reserves the space", () => {
    render(<DashboardSkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading the dashboard…");
    expect(document.querySelector("main")).toHaveAttribute("aria-busy", "true");
  });

  it("names the admin boundary for a viewer who asked for /admin", () => {
    render(<Forbidden />);

    expect(screen.getByRole("heading", { name: "Not allowed" })).toBeInTheDocument();
    expect(screen.getByText(/only the configured admin id/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to the stats page/i })).toBeInTheDocument();
  });

  it("shows the server's own message and offers a retry", () => {
    const retry = vi.fn();
    render(<ServerError detail="rollups are not built — run: discord-scraper rollups rebuild" onRetry={retry} />);

    expect(screen.getByRole("heading", { name: /could not build the dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/rollups are not built/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });

  it("says the browser never reached the server, and offers a retry", () => {
    const retry = vi.fn();
    render(<Offline onRetry={retry} />);

    expect(screen.getByRole("heading", { name: "You are offline" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });
});
