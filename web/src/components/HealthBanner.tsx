import { stampLabel, type TimeFormat } from "../lib/timeFormat";

function daysSince(stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const then = Date.parse(stamp);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/**
 * The §11.7 states, and the rule that matters more than the styling: a viewer
 * must never see stale numbers presented as current.
 *
 * Precedence, decided here:
 *
 * 1. `token_dead` wins alone. It is the cause and the stale data is the
 *    symptom, so a second sentence would only dilute it.
 * 2. Otherwise both remaining facts may show together, because they are
 *    independent and have different fixes: *never ingested* means the scraper
 *    has not run, while *the configuration changed since the last rebuild* means
 *    the scraper is fine and `discord-scraper rollups rebuild` is owed. One
 *    banner element carries both rather than either hiding the other.
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
  // A null stamp is the worker saying "never", not the API failing to answer.
  const age =
    banner === "stale"
      ? !lastIngestAt
        ? "Data has never been ingested."
        : daysSince(lastIngestAt) === null
          ? "Data is of unknown age."
          : `Data is ${daysSince(lastIngestAt)} days old.`
      : null;
  if (!age && !stale) return null;
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200"
    >
      {age ? <p>{age}</p> : null}
      {stale ? (
        <p>
          The configuration changed since the last rebuild: these numbers are as of{" "}
          {staleAt ? stampLabel(staleAt, timeFormat) : "the last rebuild"}. Run{" "}
          <code>discord-scraper rollups rebuild</code>.
        </p>
      ) : null}
    </div>
  );
}
