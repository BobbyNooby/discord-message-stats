/**
 * Ingest (§11.6): token health, the last probe, the last ingest, the schedule
 * switch, the three manual job buttons, and the job history including failures.
 *
 * The token's *value* is never here and never can be: the worker keeps it in its
 * own environment and it is not in any response this page calls. What is shown
 * is `token_status`, a word.
 *
 * The cron switch writes through the same `PUT /api/admin/config` and the same
 * two save buttons as every other settings section — a schedule edit is a config
 * edit, not a fourth kind of save.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  createJob,
  listJobs,
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

export function Ingest({
  status,
  config,
  onDirty,
  onSave,
}: {
  status: AdminStatus;
  config: AdminConfig | null;
  onDirty: () => void;
  onSave: (patch: ConfigPatch, mode: SaveMode) => Promise<AdminConfig>;
}) {
  const queryClient = useQueryClient();
  const jobs = useQuery({ queryKey: ["admin", "jobs"], queryFn: () => listJobs(50) });
  const [queued, setQueued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cronEnabled, setCronEnabled] = useState(config?.effective.cron_enabled ?? true);
  const [cronHours, setCronHours] = useState(String(config?.effective.cron_hours ?? 6));
  const [cronSaving, setCronSaving] = useState(false);
  const [cronNotice, setCronNotice] = useState<string | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);
  const worker = status.worker;
  const offline = workerOffline(worker.last_seen_at);

  useEffect(() => {
    if (!config) return;
    setCronEnabled(config.effective.cron_enabled);
    setCronHours(String(config.effective.cron_hours));
  }, [config]);

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
    setError(null);
    try {
      const job = await createJob(kind);
      if (changesData) onDirty();
      setQueued(`${label} queued as job #${job.id} (${job.status}).`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "status"] });
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <Section id="ingest" title="Ingest">
      {offline ? (
        <Notice tone="error">
          Worker offline: nothing has polled since {formatStamp(worker.last_seen_at)}. Jobs queued
          here will not run until the worker restarts.
        </Notice>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-semibold">Token health</h3>
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
          <h3 className="text-sm font-semibold">Last ingest</h3>
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
            {cronError ? (
              <div className="mt-2">
                <Notice tone="error">{cronError}</Notice>
              </div>
            ) : null}
            {cronNotice ? (
              <div className="mt-2">
                <Notice tone="ok">{cronNotice}</Notice>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <h3 className="text-sm font-semibold">Run a job</h3>
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
        {queued ? (
          <div className="mt-3">
            <Notice tone="ok">{queued}</Notice>
          </div>
        ) : null}
        {error ? (
          <div className="mt-3">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <h3 className="text-sm font-semibold">Job history</h3>
        {jobs.isError ? (
          <div className="mt-3">
            <Notice tone="error">{(jobs.error as Error).message}</Notice>
          </div>
        ) : null}
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
    </Section>
  );
}
