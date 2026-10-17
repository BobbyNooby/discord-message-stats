/**
 * Who shows (§11.6, §5.6): every identity, its message count, and an include
 * toggle. A merge is labelled "N accounts" because that is what the operator is
 * deciding about.
 *
 * Each toggle writes through `PUT /api/admin/inclusions` straight away — the
 * server hides, never deletes — and the write marks the cache stale so the
 * consequence is visible before anyone presses Recalculate. Exclusion still
 * happens at rollup build time, never in the browser: a toggle that only *looked*
 * like it filtered the page would be the quiet-wrong-numbers failure §11.6
 * exists to prevent.
 */

import { useMemo, useState } from "react";

import type { Payload } from "../api/types";
import { EmptyState } from "../components/Panel";
import { putInclusions } from "./api";
import { Notice, SubSection } from "./shared";

export function WhoShows({ payload, onDirty }: { payload: Payload | null; onDirty: () => void }) {
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const identities = useMemo(() => {
    if (!payload) return [];
    return [...payload.authors].sort((a, b) => b.msgs - a.msgs);
  }, [payload]);

  if (!payload) {
    return (
      <SubSection id="who-shows" title="Who shows">
        <EmptyState>
          The identity list needs the viewer payload, which is unavailable right now.
        </EmptyState>
      </SubSection>
    );
  }

  const hidden = identities.filter((author) => excluded[author.id]).length;

  /**
   * `shown` is the value the operator just chose. There is no batch save here:
   * one toggle, one write, so the cached numbers are never a lie for longer than
   * the request takes.
   */
  async function toggle(authorId: string, shown: boolean) {
    setExcluded((current) => ({ ...current, [authorId]: !shown }));
    setError(null);
    setBusy(authorId);
    // Conservative and immediate: a write is going out, so the rollups may no
    // longer match the configuration (§11.6). A failure keeps it stale rather
    // than pretending the numbers are current.
    onDirty();
    try {
      const written = await putInclusions({ [authorId]: shown });
      // The response says it too; the server's word is the one that counts.
      if (written.cache_stale) onDirty();
      setSaved(true);
    } catch (failure) {
      // The toggle stays as the operator set it, but the page says plainly that
      // the server does not have it, so a rebuild will not apply it.
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <SubSection id="who-shows" title="Who shows">
      {error ? (
        <Notice tone="error">
          Not saved: {error}. This toggle is staged on this page only, so a rebuild will not apply
          it — switch it again once the API is reachable.
        </Notice>
      ) : null}
      {saved && !error ? (
        <Notice tone="ok">
          Include setting saved. The cache is stale until you run Recalculate all.
        </Notice>
      ) : null}

      <p className="text-xs text-[var(--color-muted)]">
        Exclusion is applied at build time: a hidden identity is removed from every rollup on the
        next rebuild, not in the browser. {hidden} of {identities.length} hidden here; the rebuild
        leaves them out without deleting a single message.
      </p>

      <ul className="divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
        {identities.map((author) => {
          const accounts = author.accounts?.length ?? 1;
          const included = !excluded[author.id];
          return (
            <li key={author.id} className="flex items-center gap-3 p-3">
              <input
                id={`who-${author.id}`}
                type="checkbox"
                checked={included}
                disabled={busy === author.id}
                onChange={(event) => void toggle(author.id, event.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor={`who-${author.id}`} className="flex-1 text-xs">
                <span className="font-medium">{author.name}</span>{" "}
                <span className="text-[var(--color-muted)]">{author.id}</span>
              </label>
              {accounts > 1 ? (
                <span
                  className="rounded border border-[var(--color-line)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]"
                  title={`${accounts} raw accounts merged into this identity`}
                >
                  {accounts} accounts
                </span>
              ) : null}
              <span className="w-20 text-right text-xs tabular-nums text-[var(--color-muted)]">
                {author.msgs.toLocaleString()} msgs
              </span>
            </li>
          );
        })}
      </ul>
    </SubSection>
  );
}
