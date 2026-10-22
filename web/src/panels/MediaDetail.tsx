import { ExternalLink } from "lucide-react";
import { useMemo } from "react";

import { useMediaDetail } from "../api/queries";
import type { MediaRow, Payload } from "../api/types";
import { NARROW, useNarrow } from "../components/AppShell";
import { Dialog, Sheet } from "../components/ui";
import { kindLabel, postedLabel, providerLabel } from "../lib/mediaLabels";
import { swatch } from "../lib/palette";
import { mediaName, thumbnailSrc } from "./MediaTile";
import { authorIndexById, MonthlyBars, monthlyStacks } from "./MonthlyBars";

/**
 * One reposted GIF or link, opened up: who posted it and how often, who posted
 * it first, and when the reposts happened.
 *
 * The tile already holds everything the ranking knows, so the dialog opens on
 * that at once and fills in the people and the timeline from
 * `/api/media/detail` — one request, and only for the item someone tapped.
 */

const nf = new Intl.NumberFormat("en-US");

function dayLabel(iso: string | null | undefined, zone: string): string {
  if (!iso) return "—";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  try {
    return when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: zone });
  } catch {
    // An unknown zone name must not blank the dialog.
    return when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
}

function Preview({ row, mode }: { row: MediaRow; mode: string }) {
  const [url, , , , thumbnail, animated] = row;
  const still = thumbnailSrc(thumbnail || url, mode);
  const moving = thumbnailSrc(animated || "", mode);
  const frame = "flex h-48 w-full items-center justify-center overflow-hidden rounded bg-[var(--color-surface)]";
  if (moving && /\.(mp4|webm)(\?|$)/i.test(animated)) {
    return (
      <div className={frame}>
        <video src={moving} poster={still ?? undefined} autoPlay muted loop playsInline className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  return (
    <div className={frame}>
      {still ? <img src={still} alt="" className="max-h-full max-w-full object-contain" /> : null}
    </div>
  );
}

export function MediaDetailBody({ row, payload, mode }: { row: MediaRow; payload: Payload; mode: string }) {
  const [url, provider, kind, , , , uses] = row;
  const detail = useMediaDetail(url);
  const data = detail.data;
  const zone = payload.tz?.name ?? "UTC";
  const byId = useMemo(() => authorIndexById(payload.authors), [payload.authors]);
  const stacks = useMemo(
    () => (data?.months ? monthlyStacks(data.months, payload.authors, []) : null),
    [data, payload.authors],
  );
  const top = data?.people?.[0]?.count ?? 0;

  return (
    <div className="space-y-4">
      <Preview row={row} mode={mode} />
      {/* The dialog's title already names the item, so the body starts at the count. */}
      <div className="space-y-1">
        <p className="text-xs text-[var(--color-muted)]">
          {postedLabel(uses)} · {providerLabel(provider, url)} {kindLabel(kind)}
        </p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-9 items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
        >
          Open the original <ExternalLink size={12} aria-hidden />
        </a>
      </div>

      {detail.isError ? (
        <p className="text-xs text-red-300">Could not load the details: {(detail.error as Error).message}</p>
      ) : detail.isLoading ? (
        <p className="text-xs text-[var(--color-muted)]">Loading who posted it…</p>
      ) : !data?.people ? (
        <p className="text-xs text-[var(--color-muted)]">
          Who posted it needs one rebuild — Recalculate on the Admin board.
        </p>
      ) : (
        <>
          {data.first_post ? (
            <p className="text-xs text-[var(--color-muted)]">
              First posted by <span className="text-[var(--color-text)]">{data.first_post.name}</span> on{" "}
              {dayLabel(data.first_post.at, zone)}
              {" · "}
              <a
                href={data.first_post.jump_url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex min-h-9 items-center gap-1 text-[var(--color-accent)] hover:underline"
              >
                open in Discord <ExternalLink size={12} aria-hidden />
              </a>
              <br />
              Last posted {dayLabel(data.last_seen, zone)}
            </p>
          ) : null}

          <section aria-label="Who posted it">
            <h3 className="mb-2 text-xs font-medium text-[var(--color-text)]">Who posted it</h3>
            <ul className="space-y-1.5">
              {data.people.map((person) => {
                const index = byId.get(person.id) ?? 0;
                const share = uses ? Math.round((person.count / uses) * 100) : 0;
                return (
                  <li key={person.id} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[var(--color-text)]">{person.name}</span>
                      <span className="tabular-nums text-[var(--color-muted)]">
                        {nf.format(person.count)} {person.count === 1 ? "time" : "times"} · {share}%
                      </span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded bg-[var(--color-surface-2)]" aria-hidden>
                      <div
                        className="h-full rounded"
                        style={{ width: `${top ? (person.count / top) * 100 : 0}%`, background: swatch(index) }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {stacks && stacks.series.length ? (
            <section aria-label="When it was posted">
              <h3 className="mb-1 text-xs font-medium text-[var(--color-text)]">When it was posted</h3>
              <MonthlyBars stacks={stacks} unit="posts" height={180} aria-label="Posts per month" />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Desktop gets the dialog, a phone gets a sheet — the same split the top-50 view uses. */
export function MediaDetailDialog({
  row,
  payload,
  mode,
  onClose,
}: {
  row: MediaRow | null;
  payload: Payload;
  mode: string;
  onClose: () => void;
}) {
  const narrow = useNarrow(NARROW);
  if (!row) return null;
  const title = mediaName(row[0], row[3]);
  const body = <MediaDetailBody row={row} payload={payload} mode={mode} />;
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };
  return narrow ? (
    <Sheet open onOpenChange={onOpenChange} title={title} side="right">
      {body}
    </Sheet>
  ) : (
    <Dialog open onOpenChange={onOpenChange} title={title}>
      {body}
    </Dialog>
  );
}
