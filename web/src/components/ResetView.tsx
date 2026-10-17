import { useState } from "react";

import type { Scopes } from "../filters/reducer";
import type { Charts } from "../filters/persist";

/** "2 cards have their own filters · 1 chart shape · 3 filters" — only what is stored. */
export function storedCounts(scopes: Scopes, charts: Charts): string[] {
  const parts: string[] = [];
  const scoped = Object.keys(scopes).length;
  if (scoped) parts.push(scoped === 1 ? "1 card has its own filters" : `${scoped} cards have their own filters`);

  const shaped = Object.keys(charts).length;
  if (shaped) parts.push(shaped === 1 ? "1 chart shape" : `${shaped} chart shapes`);

  const fields = Object.values(scopes).reduce((count, patch) => count + Object.keys(patch).length, 0);
  if (fields) parts.push(fields === 1 ? "1 filter" : `${fields} filters`);

  return parts;
}

/**
 * The way out of a bad saved view. It says how much is stored, and clears both
 * the card scopes and the chart shapes — a control that cleared half of what it
 * claimed would leave the reader with no way to tell what is still on.
 */
export function ResetView({
  scopes,
  charts,
  onReset,
}: {
  scopes: Scopes;
  charts: Charts;
  onReset: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const counts = storedCounts(scopes, charts);
  const nothing = counts.length === 0;

  if (!confirming) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          disabled={nothing}
          onClick={() => setConfirming(true)}
          className="w-full rounded border border-[var(--color-line)] px-3 py-2 text-xs disabled:cursor-not-allowed disabled:text-[var(--color-muted)]"
        >
          Reset view
        </button>
        <p className="px-1 text-[11px] text-[var(--color-muted)]">
          {nothing ? "Nothing saved yet." : `Saved: ${counts.join(" · ")}.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/60 bg-amber-500/10 p-2">
      <p className="text-[11px] text-amber-100">
        Clear {counts.join(" · ")}? This cannot be undone.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            onReset();
          }}
          className="rounded border border-amber-500/60 bg-amber-500/20 px-2 py-1 text-[11px]"
        >
          Clear saved view
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded border border-[var(--color-line)] px-2 py-1 text-[11px] text-[var(--color-muted)]"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
