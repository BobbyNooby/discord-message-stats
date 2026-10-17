/**
 * "Refresh the cache" (§11.6, §10.5): when each family was built, what has
 * changed since, **Recalculate all**, and the controls that fetch new messages.
 *
 * The API never computes an aggregate on read, so a rebuild is the only way the
 * numbers move — and it is a 202 job, never an inline rebuild. The per-family
 * table turns the provenance row into the question the operator actually has:
 * "how much has arrived since this was built?"
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  createJob,
  listJobs,
  recalculate,
  type AdminConfig,
  type AdminStatus,
  type ConfigPatch,
  type JobKind,
} from "./api";
import {
  Def,
  DefList,
  Notice,
  SaveBar,
  Section,
  SubSection,
  formatStamp,
  workerOffline,
  type SaveMode,
} from "./shared";

const BUTTONS: { kind: JobKind; label: string; hint: string; changesData: boolean }[] = [
  {
    kind: "catch_up",
    label: "Catch-up",
    hint: "fetch messages newer than the last ingest",
    changesData: true,
  },
  {
    kind: "backfill",
    label: "Backfill",
    hint: "walk history backwards from the oldest message",
    changesData: true,
  },
  { kind: "probe", label: "Probe token", hint: "ask Discord if the token still works", changesData: false },
];

function tokenTone(status: string): "ok" | "warn" | "error" {
  const value = status.toLowerCase();
  if (value === "ok") return "ok";
  if (value === "dead") return "error";
  return "warn";
}

/** One sentence for what the provenance row says about a family. */
export function changeSummary(family: {
  built_from_rows: number | null;
  added_since: number | null;
  config_changed: boolean;
  computed_at: string | null;
}): string {
  if (!family.computed_at || family.built_from_rows === null) {
    return "never built";
  }
  const parts = [`built from ${family.built_from_rows.toLocaleString()} messages`];
  if (family.added_since) {
    parts.push(`${family.added_since.toLocaleString()} added since`);
  } else {
    parts.push("nothing added since");
  }
  if (family.config_changed) parts.push("settings changed since");
  return parts.join(" · ");
}

export function RefreshCache({
  status,
  stale,
  config,
  onDirty,
  onSave,
}: {
  status: AdminStatus;
  stale: boolean;
  config: AdminConfig | null;
  onDirty: () => void;
  onSave: (patch: ConfigPatch, mode: SaveMode) => Promise<AdminConfig>;
}) {
  const queryClient = useQueryClient();
  const jobs = useQuery({ queryKey: ["admin", "jobs"], queryFn: () => listJobs(50) });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [cronEnabled, setCronEnabled] = useState(config?.effective.cron_enabled ?? true);
  const [cronHours, setCronHours] = useState(String(config?.effective.cron_hours ?? 6));
  const [cronSaving, setCronSaving] = useState(false);
  const [cronNotice, setCronNotice] = useState<string | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);

  const families = Object.entries(status.rollups);
  const totalRows = families.reduce((total, [, family]) => total + family.rows, 0);
  const staleFamilies = families.filter(([, family]) => family.stale).length;
  const worker = status.worker;
  const offline = workerOffline(worker.last_seen_at);

  useEffect(() => {
    if (!config) return;
    setCronEnabled(config.effective.cron_enabled);
    setCronHours(String(config.effective.cron_hours));
  }, [config]);

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

  async function saveCron(mode: SaveMode) {
    const hours = Number(cronHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
      // The server rejects this too; catching it here keeps the operator from
      // reading a 400 as "the whole config failed".
      setCronNotice(null);
      setCronError("The interval must be a whole number of hours from 1 to 24.");
      return;
    }
    setCronSaving(true);
    setCronNotice(null);
    setCronError(null);
    try {
      await onSave({ cron_enabled: cronEnabled, cron_hours: hours }, mode);
      setCronNotice(
        mode === "recalculate"
          ? "Schedule saved and a rebuild queued."
          : "Schedule saved. The cache is stale until you run Recalculate all.",
      );
    } catch (failure) {
      setCronError((failure as Error).message);
    } finally {
      setCronSaving(false);
    }
  }

  async function enqueue(kind: JobKind, label: string, changesData: boolean) {
    setJobError(null);
    try {
      const job = await createJob(kind);
      if (changesData) onDirty();
      setQueued(`${label} queued as job #${job.id} (${job.status}).`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "status"] });
    } catch (failure) {
      setJobError((failure as Error).message);
    }
  }

  return (
    <Section id="refresh-cache" title="Refresh the cache">
      {offline ? (
        <Notice tone="error">
          Worker offline: nothing has polled since {formatStamp(worker.last_seen_at)}. Jobs queued
          here will not run until the worker restarts.
        </Notice>
      ) : null}

      <SubSection id="cache-families" title="What each family was built from">
        <Notice tone={stale ? "warn" : "ok"}>
          Cache is <strong>{stale ? "stale" : "current"}</strong>
          {stale
            ? ` — ${staleFamilies} of ${families.length} families need a rebuild`
            : " — every family matches the current configuration"}
        </Notice>
        <DefList>
          <Def label="Configuration hash">{status.config_hash.slice(0, 12)}</Def>
          <Def label="Status as of">{formatStamp(status.checked_at)}</Def>
          <Def label="Families">{families.length}</Def>
          <Def label="Total rollup rows">{totalRows.toLocaleString()}</Def>
          <Def label="Jobs queued">{status.jobs.queued ?? 0}</Def>
          <Def label="Jobs running">{status.jobs.running ?? 0}</Def>
        </DefList>

        <div className="overflow-x-auto rounded border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              Every rollup family with its row count, when it was computed, what it was built from,
              and whether it is current or stale
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
                  Built
                </th>
                <th scope="col" className="py-1 pr-3">
                  What changed since
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
                  <td className="py-1 pr-3 text-[var(--color-muted)]">{changeSummary(row)}</td>
                  <td className={`py-1 ${row.stale ? "text-amber-300" : "text-emerald-300"}`}>
                    {row.stale ? "stale" : "current"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <p className="text-xs text-[var(--color-muted)]">
            A full rebuild measures a few seconds on the reference database and runs as a background
            job. Needed after a timezone, merge, who-shows or ignore-list change.
          </p>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="mt-2 rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? "Queueing…" : "Recalculate all"}
          </button>
        </div>
        {notice ? <Notice tone="ok">{notice}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
      </SubSection>

      <SubSection id="refresh-ingest" title="Fetch new messages">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <h4 className="text-xs font-semibold">Token health</h4>
            <div className="mt-2">
              <Notice tone={tokenTone(worker.token_status)}>
                Token status: <strong>{worker.token_status}</strong>
                {worker.consecutive_failures ? ` · ${worker.consecutive_failures} consecutive failures` : ""}
              </Notice>
            </div>
            <div className="mt-3">
              <DefList>
                <Def label="Last probe">{formatStamp(worker.checked_at)}</Def>
                <Def label="Last success">{formatStamp(worker.last_ok_at)}</Def>
              </DefList>
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">
              The token itself is never sent to this page — it lives in the worker&rsquo;s environment.
              Replace it there, then probe again.
            </p>
          </div>

          <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <h4 className="text-xs font-semibold">Last ingest</h4>
            <div className="mt-3">
              <DefList>
                <Def label="Finished">{formatStamp(worker.last_ingest_at)}</Def>
                <Def label="Messages added">{worker.last_ingest_added ?? "—"}</Def>
                <Def label="Worker last seen">{formatStamp(worker.last_seen_at)}</Def>
                <Def label="Schedule">
                  {worker.cron_enabled === "true" || worker.cron_enabled === "1"
                    ? `every ${worker.cron_hours ?? "?"} h`
                    : "off"}
                </Def>
              </DefList>
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">
              The worker reads the schedule from <code>worker_state</code>; saving here writes it
              there, so a change takes effect without a restart.
            </p>

            <div className="mt-3 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="admin-cron-enabled"
                  type="checkbox"
                  checked={cronEnabled}
                  onChange={(event) => setCronEnabled(event.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="admin-cron-enabled" className="text-xs font-medium">
                  Scheduled ingest
                </label>
              </div>
              <div className="mt-2">
                <label htmlFor="admin-cron-hours" className="block text-[11px] text-[var(--color-muted)]">
                  Interval in hours (1–24)
                </label>
                <input
                  id="admin-cron-hours"
                  type="number"
                  min={1}
                  max={24}
                  step={1}
                  value={cronHours}
                  onChange={(event) => setCronHours(event.target.value)}
                  className="mt-1 w-24 rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs tabular-nums"
                />
              </div>
              <div className="mt-3">
                <SaveBar onSave={saveCron} busy={cronSaving} disabled={!config} />
              </div>
              {cronError ? <Notice tone="error">{cronError}</Notice> : null}
              {cronNotice ? <Notice tone="ok">{cronNotice}</Notice> : null}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h4 className="text-xs font-semibold">Run a job</h4>
          <div className="mt-3 flex flex-wrap gap-2">
            {BUTTONS.map((button) => (
              <button
                key={button.kind}
                type="button"
                title={button.hint}
                onClick={() => enqueue(button.kind, button.label, button.changesData)}
                className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs"
              >
                {button.label}
              </button>
            ))}
          </div>
          {queued ? <Notice tone="ok">{queued}</Notice> : null}
          {jobError ? <Notice tone="error">{jobError}</Notice> : null}
        </div>

        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h4 className="text-xs font-semibold">Job history</h4>
          {jobs.isError ? <Notice tone="error">{(jobs.error as Error).message}</Notice> : null}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Recent jobs, newest first, including failures</caption>
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                  <th scope="col" className="py-1 pr-3">
                    Job
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    Kind
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    Status
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    Requested
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    Finished
                  </th>
                  <th scope="col" className="py-1">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {(jobs.data?.jobs ?? []).map((job) => (
                  <tr key={job.id} className="border-t border-[var(--color-line)]/50 align-top">
                    <td className="py-1 pr-3 tabular-nums">{job.id}</td>
                    <td className="py-1 pr-3">{job.kind}</td>
                    <td
                      className={`py-1 pr-3 ${
                        job.status === "failed"
                          ? "text-red-300"
                          : job.status === "done"
                            ? "text-emerald-300"
                            : ""
                      }`}
                    >
                      {job.status}
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap text-[var(--color-muted)]">
                      {formatStamp(job.requested_at)}
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap text-[var(--color-muted)]">
                      {formatStamp(job.finished_at)}
                    </td>
                    <td className="py-1">
                      {job.error ? (
                        <span className="text-red-300">{job.error}</span>
                      ) : (
                        <span className="text-[var(--color-muted)]">{job.result ?? "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {(jobs.data?.jobs ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-2 text-[var(--color-muted)]">
                      No jobs yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </SubSection>
    </Section>
  );
}
