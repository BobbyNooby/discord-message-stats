import type { ReactNode } from "react";

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
 *    the scraper is fine and a rebuild is owed. One banner element carries both
 *    rather than either hiding the other. The same rule covers a schema-version
 *    mismatch: it is a third independent fact, so it gets its own sentence and
 *    never replaces the timezone one.
 *
 * The rebuild is offered as a control (`action`), never as the shell command an
 * operator would type — the person reading this page is not running a terminal.
 */
export function HealthBanner({
  banner,
  lastIngestAt,
  stale,
  staleAt,
  timeFormat,
  timezoneMismatch,
  timezoneMessage,
  schemaMessage,
  action,
}: {
  banner: "stale" | "token_dead" | null;
  lastIngestAt?: string | null;
  stale?: boolean;
  staleAt?: string | null;
  /** `ui.time_format`, for the "as of" stamp. */
  timeFormat?: TimeFormat;
  /** The rollups were built in a different zone than the one configured now. */
  timezoneMismatch?: boolean;
  /** Both zones, in a sentence the API already phrased. */
  timezoneMessage?: string | null;
  /** The installed library and the database disagree on the schema, in the
   *  API's own sentence; null when they agree. */
  schemaMessage?: string | null;
  /** "Recalculate now", when the caller may queue one. */
  action?: ReactNode;
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
  if (!age && !stale && !timezoneMismatch && !schemaMessage) return null;
  return (
    <div
      role="status"
      className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200"
    >
      {age ? <p>{age}</p> : null}
      {stale ? (
        <p>
          The configuration changed since the last rebuild: these numbers are as of{" "}
          {staleAt ? stampLabel(staleAt, timeFormat) : "the last rebuild"}.
        </p>
      ) : null}
      {timezoneMismatch ? (
        <p>
          {timezoneMessage ??
            "These numbers were built in a different timezone than the one configured now."}
        </p>
      ) : null}
      {schemaMessage ? <p>{schemaMessage}</p> : null}
      {action}
    </div>
  );
}
