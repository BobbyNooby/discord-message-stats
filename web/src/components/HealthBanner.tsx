import { stampLabel, type TimeFormat } from "../lib/timeFormat";

function daysSince(stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const then = Date.parse(stamp);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/**
 * The three states of §11.7, and the rule that matters more than the styling:
 * a viewer must never see stale numbers presented as current.
 */
export function HealthBanner({
  banner,
  lastIngestAt,
  stale,
  staleAt,
  timeFormat,
}: {
  banner: "stale" | "token_dead" | null;
  lastIngestAt?: string | null;
  stale?: boolean;
  staleAt?: string | null;
  /** `ui.time_format`, for the "as of" stamp. */
  timeFormat?: TimeFormat;
}) {
  if (banner === "token_dead") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-200"
      >
        The Discord token is dead, figures are frozen.{" "}
        <a className="underline" href="/admin">
          Fix it in the admin board
        </a>
        .
      </div>
    );
  }
  if (banner === "stale") {
    const days = daysSince(lastIngestAt);
    return (
      <div
        role="status"
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200"
      >
        Data is {days === null ? "of unknown age" : `${days} days old`}.
      </div>
    );
  }
  if (stale) {
    return (
      <div
        role="status"
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200"
      >
        The configuration changed since the last rebuild: these numbers are as of{" "}
        {staleAt ? stampLabel(staleAt, timeFormat) : "the last rebuild"}. Run{" "}
        <code>discord-scraper rollups rebuild</code>.
      </div>
    );
  }
  return null;
}
