/**
 * "A rebuild is required to apply this", with the button adjacent.
 *
 * Merges, visibility and timezone edits change what the rollups *should*
 * contain without changing a single cached row, so the board never lets the
 * operator read one of those notices without the action that resolves it in
 * the same breath (§11.6). The button queues the same 202 as everywhere else.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { recalculate } from "./api";
import { Notice } from "./shared";

export function RebuildRequired({
  what,
  onDirty,
}: {
  /** What needs rebuilding, as a sentence the operator can read on its own. */
  what: string;
  onDirty?: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const job = await recalculate();
      onDirty?.();
      setNotice(`Rebuild queued as job #${job.id} (${job.status}).`);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded border border-amber-500/40 bg-amber-500/10 p-3">
      <p role="status" className="text-xs text-amber-200">
        {what} The stats page keeps showing the last build until a rebuild finishes.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? "Queueing…" : "Recalculate all"}
      </button>
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
