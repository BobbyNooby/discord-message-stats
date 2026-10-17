import { Download } from "lucide-react";
import { useState } from "react";

import { useMedia } from "../api/queries";
import type { Payload } from "../api/types";
import { Chip, NARROW, useNarrow } from "../components/AppShell";
import { useNotice } from "../components/Notice";
import { Dialog, Sheet } from "../components/ui";
import { csvFilename, downloadCsv } from "../lib/csv";
import { kindLabel, providerChoices } from "../lib/mediaLabels";
import { MediaTile } from "./MediaTile";

/**
 * "Show top 50": the card's ten items, opened up (§UI/UX rule 5).
 *
 * The ranking comes from `/api/media`, not from the payload: the payload ships
 * a dozen rows per provider, and this view is where "top YouTube links" becomes
 * visible. Provider filtering is a query parameter, so the server does the
 * work; the endpoint has no `kind` parameter, so a kind chip filters the rows
 * already in hand rather than costing another round trip.
 *
 * Desktop gets the `Dialog`, a phone gets the `Sheet` — the same body, the same
 * single labelled Close, and Radix's focus trap either way. Whether the view is
 * open lives with the caller (and, one step later, in the URL).
 */

const LIMIT = 50;

/**
 * How many provider chips show before the rest fold away. Thirty chips wrap to
 * six or seven rows on a phone, which pushes the first thumbnail below the fold;
 * eight keeps the ranking visible and still offers every provider behind one
 * control.
 */
const PROVIDER_CAP = 8;

/** Providers as the payload ranked them: the raw name is what the API filters
 *  on, the label is what a reader sees. Discord's sentinel never gets here. */
function providerChoicesFor(payload: Payload): { value: string; label: string }[] {
  return providerChoices(payload.providers ?? []);
}

export function MediaView({
  open,
  onOpenChange,
  payload,
  initialProvider = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: Payload;
  /** Open already narrowed to this provider, when a card chip asked for it. */
  initialProvider?: string | null;
}) {
  const narrow = useNarrow(NARROW);
  const notify = useNotice();
  const [provider, setProvider] = useState<string | null>(initialProvider);
  const [kind, setKind] = useState<string | null>(null);
  const [allProviders, setAllProviders] = useState(false);
  const query = useMedia(provider, kind, open);
  const mode = payload.mediaThumbnails ?? "proxy";

  const shown = query.data?.items ?? [];
  // The kinds come from the server, which counts them across the whole rollup:
  // deriving them from the fifty rows in hand hid every kind below the limit.
  const kinds = query.data?.kinds ?? [];
  const providers = providerChoicesFor(payload);
  const visibleProviders = allProviders ? providers : providers.slice(0, PROVIDER_CAP);
  const hiddenProviders = providers.length - visibleProviders.length;

  const body = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            {/* Named, not decoration: two chip rows read as one mystery strip
                until each says what it filters. */}
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              Provider
            </p>
            <div
              role="group"
              aria-label="Filter by provider"
              // Wrapping keeps the strip inside a 390px card; the cap keeps it
              // from eating the screen, and the expanded state gets its own
              // scroll region rather than growing the page.
              className={`flex flex-wrap gap-1 ${allProviders ? "max-h-28 overflow-y-auto" : ""}`}
            >
              <Chip
                active={provider === null}
                onClick={() => {
                  setProvider(null);
                  setKind(null);
                }}
              >
                All providers
              </Chip>
              {visibleProviders.map((choice) => (
                <Chip
                  key={choice.value}
                  active={provider === choice.value}
                  // A kind that exists for Tenor need not exist for YouTube, so
                  // changing provider clears the kind rather than leaving an
                  // invisible filter switched on.
                  onClick={() => {
                    setProvider(provider === choice.value ? null : choice.value);
                    setKind(null);
                  }}
                >
                  {choice.label}
                </Chip>
              ))}
              {providers.length > PROVIDER_CAP ? (
                <button
                  type="button"
                  aria-expanded={allProviders}
                  onClick={() => setAllProviders((open) => !open)}
                  className="rounded border border-[var(--color-line)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]"
                >
                  {allProviders ? "Fewer providers" : `More providers (${hiddenProviders})`}
                </button>
              ) : null}
            </div>
          </div>
          {kinds.length > 1 ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                Kind
              </p>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by kind">
                <Chip active={kind === null} onClick={() => setKind(null)}>
                  All kinds
                </Chip>
                {kinds.map((value) => (
                  <Chip
                    key={value}
                    active={kind === value}
                    onClick={() => setKind(kind === value ? null : value)}
                  >
                    {kindLabel(value)}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        {/* The list is the aggregate here, so the export is the list. */}
        <button
          type="button"
          disabled={shown.length === 0}
          onClick={() => {
            const file = "top-media";
            try {
              const written = downloadCsv(file, [
                ["url", "provider", "kind", "title", "uses"],
                ...shown.map((row) => [row[0], row[1], row[2], row[3], row[6]]),
              ]);
              notify({
                tone: "success",
                message: `Exported ${csvFilename(file)} — ${written} rows of the ranking on screen.`,
              });
            } catch (failure) {
              notify({
                tone: "danger",
                message: `Could not export ${csvFilename(file)} (${(failure as Error).message}). Try again, or copy the links by hand.`,
              });
            }
          }}
          className="flex shrink-0 items-center gap-1 rounded border border-[var(--color-line)] px-2 py-0.5 text-[11px] text-[var(--color-muted)] disabled:opacity-50"
        >
          <Download size={12} aria-hidden />
          Export CSV
        </button>
      </div>

      {query.isError ? (
        <p className="text-xs text-red-300">
          Could not load the ranking: {(query.error as Error).message}
        </p>
      ) : query.isLoading ? (
        <p className="text-xs text-[var(--color-muted)]">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)]">No media in this filter.</p>
      ) : (
        <ol aria-label="Top media" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {shown.map((row, index) => (
            <MediaTile key={row[0]} row={row} mode={mode} rank={index + 1} />
          ))}
        </ol>
      )}
    </div>
  );

  const title = `Top ${LIMIT} posted`;
  return narrow ? (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} side="right">
      {body}
    </Sheet>
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      {body}
    </Dialog>
  );
}
