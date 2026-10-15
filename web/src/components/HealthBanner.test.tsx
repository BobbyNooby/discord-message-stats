import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HealthBanner } from "./HealthBanner";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe("<HealthBanner>", () => {
  it("shows nothing when the worker is healthy", () => {
    const { container } = render(<HealthBanner banner={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the amber banner with the age in days", () => {
    render(<HealthBanner banner="stale" lastIngestAt={daysAgo(4)} />);
    expect(screen.getByRole("status")).toHaveTextContent(/4 days old/);
  });

  it("shows the red banner and links to the admin board for a dead token", () => {
    render(<HealthBanner banner="token_dead" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/token is dead/i);
    expect(screen.getByRole("link", { name: /admin board/i })).toHaveAttribute("href", "/admin");
  });

  it("marks pre-edit numbers as stale rather than current", () => {
    render(<HealthBanner banner={null} stale staleAt="2026-10-15T20:00:00Z" />);
    expect(screen.getByRole("status")).toHaveTextContent(/as of 2026-10-15T20:00:00Z/);
  });

  it("a dead token outranks stale data", () => {
    render(<HealthBanner banner="token_dead" stale lastIngestAt={daysAgo(30)} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
