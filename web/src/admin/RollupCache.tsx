/**
 * Rollup cache (§11.6, §10.5): the per-family table and **Recalculate all**.
 *
 * The API never computes an aggregate on read, so this is the only place a
 * rebuild is started by hand — and it is a 202, not an inline rebuild.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { recalculate, type AdminStatus } from "./api";
import { Def, DefList, Notice, Section, formatStamp } from "./shared";

export function RollupCache({
  status,
  stale,
  onDirty,
}: {
  status: AdminStatus;
  stale: boolean;
  onDirty: () => void;
}) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const families = Object.entries(status.rollups);
  const totalRows = families.reduce((total, [, family]) => total + family.rows, 0);
  const staleFamilies = families.filter(([, family]) => family.stale).length;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const job = await recalculate();
      onDirty();
      setNotice(`Rebuild queued as job #${job.id} (${job.status}). The cache stays stale until it finishes.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "status"] });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section id="rollup-cache" title="Rollup cache">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-semibold">Cache stats</h3>
          <div className="mt-2">
            <Notice tone={stale ? "warn" : "ok"}>
              Cache is <strong>{stale ? "stale" : "current"}</strong>
              {stale
                ? ` — ${staleFamilies} of ${families.length} families need a rebuild`
                : " — every family matches the current configuration"}
            </Notice>
          </div>
          <div className="mt-3">
            <DefList>
              <Def label="Configuration hash">{status.config_hash.slice(0, 12)}</Def>
              <Def label="Status as of">{formatStamp(status.checked_at)}</Def>
              <Def label="Families">{families.length}</Def>
              <Def label="Total rollup rows">{totalRows.toLocaleString()}</Def>
              <Def label="Jobs queued">{status.jobs.queued ?? 0}</Def>
              <Def label="Jobs running">{status.jobs.running ?? 0}</Def>
            </DefList>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-semibold">Recalculate all</h3>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            A full rebuild measures a few seconds on the reference database and runs as a background
            job. Needed after a timezone, merge, who-shows or ignore-list change.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy ? "Queueing…" : "Recalculate all"}
            </button>
          </div>
          {notice ? (
            <div className="mt-3">
              <Notice tone="ok">{notice}</Notice>
            </div>
          ) : null}
          {error ? (
            <div className="mt-3">
              <Notice tone="error">{error}</Notice>
            </div>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <h3 className="text-sm font-semibold">Rollup families</h3>
        <table className="mt-3 w-full text-left text-xs">
          <caption className="sr-only">
            Every rollup family with its row count, when it was computed, and whether it is current
            or stale
          </caption>
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
              <th scope="col" className="py-1 pr-3">
                Family
              </th>
              <th scope="col" className="py-1 pr-3">
                Rows
              </th>
              <th scope="col" className="py-1 pr-3">
                Computed
              </th>
              <th scope="col" className="py-1">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {families.map(([family, row]) => (
              <tr key={family} className="border-t border-[var(--color-line)]/50">
                <th scope="row" className="py-1 pr-3 text-left font-medium">
                  {family}
                </th>
                <td className="py-1 pr-3 tabular-nums">{row.rows.toLocaleString()}</td>
                <td className="py-1 pr-3 whitespace-nowrap text-[var(--color-muted)]">
                  {formatStamp(row.computed_at)}
                </td>
                <td className={`py-1 ${row.stale ? "text-amber-300" : "text-emerald-300"}`}>
                  {row.stale ? "stale" : "current"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
