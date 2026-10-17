import { useState } from "react";

import { useMedia } from "../api/queries";
import type { Payload } from "../api/types";
import { Chip, NARROW, useNarrow } from "../components/AppShell";
import { Dialog, Sheet } from "../components/ui";
import { kindLabel, providerLabel } from "../lib/mediaLabels";
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

/** Providers as the payload ranked them: the raw name is what the API filters
 *  on, the label is what a reader sees. Discord's sentinel never gets here. */
function providerChoices(payload: Payload): { value: string; label: string }[] {
  return (payload.providers ?? [])
    .filter(([, count]) => count > 0)
    .map(([name]) => ({ value: name, label: providerLabel(name, name) }));
}

export function MediaView({
  open,
  onOpenChange,
  payload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: Payload;
}) {
  const narrow = useNarrow(NARROW);
  const [provider, setProvider] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const query = useMedia(provider, open);
  const mode = payload.mediaThumbnails ?? "proxy";

  const items = query.data?.items ?? [];
  // Kinds come from the rows actually loaded, so no chip can filter the list to
  // nothing the server just sent.
  const kinds = [...new Set(items.map((row) => row[2]).filter(Boolean))];
  const shown = kind ? items.filter((row) => row[2] === kind) : items;
  const providers = providerChoices(payload);

  const body = (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by provider">
          <Chip active={provider === null} onClick={() => setProvider(null)}>
            All providers
          </Chip>
          {providers.map((choice) => (
            <Chip
              key={choice.value}
              active={provider === choice.value}
              onClick={() => setProvider(provider === choice.value ? null : choice.value)}
            >
              {choice.label}
            </Chip>
          ))}
        </div>
        {kinds.length > 1 ? (
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
        ) : null}
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
        <ol aria-label="Top media" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((row) => (
            <MediaTile key={row[0]} row={row} mode={mode} />
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
