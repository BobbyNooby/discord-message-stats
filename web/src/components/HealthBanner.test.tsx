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
    expect(screen.getByRole("status")).toHaveTextContent(/as of 2026-10-15 20:00/);
  });

  it("writes the stale stamp on the clock the operator asked for", () => {
    render(<HealthBanner banner={null} stale staleAt="2026-10-15T20:00:00Z" timeFormat="12h" />);
    expect(screen.getByRole("status")).toHaveTextContent(/as of 2026-10-15 8:00 pm/);
  });

  it("still says something when there is no stamp to print", () => {
    render(<HealthBanner banner={null} stale staleAt={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(/as of the last rebuild/);
  });

  it("says the data was never ingested rather than an unknown age", () => {
    render(<HealthBanner banner="stale" lastIngestAt={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(/never been ingested/i);
  });

  it("keeps unknown age for a stamp it cannot read", () => {
    render(<HealthBanner banner="stale" lastIngestAt="not-a-date" />);
    expect(screen.getByRole("status")).toHaveTextContent(/unknown age/i);
  });

  it("states the ingest age and the rebuild when both are true", () => {
    // The two facts have different fixes, so neither may hide the other.
    render(
      <HealthBanner banner="stale" lastIngestAt={daysAgo(5)} stale staleAt="2026-10-15T20:00:00Z" />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/5 days old/);
    expect(banner).toHaveTextContent(/configuration changed since the last rebuild/);
    // The fix is a control on the page, not a shell command to copy.
    expect(banner).not.toHaveTextContent(/discord-scraper/);
  });

  it("names both zones and shows the rebuild control on a timezone mismatch", () => {
    render(
      <HealthBanner
        banner={null}
        timezoneMismatch
        timezoneMessage="These numbers were built in UTC; the configured timezone is Europe/London. Recalculate to rebuild them."
        action={<button type="button">Recalculate now</button>}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/built in UTC/);
    expect(banner).toHaveTextContent(/configured timezone is Europe\/London/);
    expect(screen.getByRole("button", { name: /recalculate now/i })).toBeInTheDocument();
  });

  it("says nothing when the zones agree and the data is current", () => {
    const { container } = render(<HealthBanner banner={null} timezoneMismatch={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a dead token outranks stale data", () => {
    render(<HealthBanner banner="token_dead" stale lastIngestAt={daysAgo(30)} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
