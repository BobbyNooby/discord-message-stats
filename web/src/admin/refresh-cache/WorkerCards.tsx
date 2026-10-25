import { useEffect, useState } from "react";

import type { AdminConfig, AdminStatus, ConfigPatch } from "../api";
import { scheduleLabel, tokenTone } from "./refreshLabels";
import { Def, DefList, Notice, SaveBar, formatStamp, type SaveMode } from "../shared";
import { TokenBox } from "./TokenBox";
import { useAction } from "../useAction";

type Worker = AdminStatus["worker"];

/** Whether the bot token still works, with the box that replaces it. */
export function TokenHealth({ worker }: { worker: Worker }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h4 className="text-xs font-semibold">Token health</h4>
      <div className="mt-2">
        <Notice tone={tokenTone(worker.token_status)}>
          Token status: <strong>{worker.token_status}</strong>
          {/* The count arrives as text, and "0" is truthy. */}
          {Number(worker.consecutive_failures) > 0 ? ` · ${worker.consecutive_failures} consecutive failures` : ""}
          {worker.token_status === "dead" ? " · scheduled scrapes are paused until a token works" : ""}
        </Notice>
      </div>
      <div className="mt-3">
        <DefList>
          <Def label="Last probe">{formatStamp(worker.checked_at)}</Def>
          <Def label="Last success">{formatStamp(worker.last_ok_at)}</Def>
        </DefList>
      </div>
      <TokenBox />
    </div>
  );
}

/** What the worker last fetched, and the schedule it fetches on. */
export function LastIngest({
  worker,
  config,
  onSave,
}: {
  worker: Worker;
  config: AdminConfig | null;
  onSave: (patch: ConfigPatch, mode: SaveMode) => Promise<AdminConfig>;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h4 className="text-xs font-semibold">Last ingest</h4>
      <div className="mt-3">
        <DefList>
          <Def label="Finished">{formatStamp(worker.last_ingest_at)}</Def>
          <Def label="Messages added">{worker.last_ingest_added ?? "—"}</Def>
          <Def label="Worker last seen">{formatStamp(worker.last_seen_at)}</Def>
          <Def label="Last backup">{formatStamp(worker.last_backup_at ?? null)}</Def>
          <Def label="Schedule">{scheduleLabel(worker, config)}</Def>
        </DefList>
      </div>
      <p className="mt-2 text-[11px] text-[var(--color-muted)]">
        The worker reads the schedule from <code>worker_state</code>; saving here writes it
        there, so a change takes effect without a restart.
      </p>
      <ScheduleForm config={config} onSave={onSave} />
    </div>
  );
}

/** The scheduled-ingest switch and its interval, saved like any other setting. */
function ScheduleForm({
  config,
  onSave,
}: {
  config: AdminConfig | null;
  onSave: (patch: ConfigPatch, mode: SaveMode) => Promise<AdminConfig>;
}) {
  const [cronEnabled, setCronEnabled] = useState(config?.effective.cron_enabled ?? true);
  const [cronHours, setCronHours] = useState(String(config?.effective.cron_hours ?? 6));
  const { busy, notice, error, run, setNotice, setError } = useAction();

  useEffect(() => {
    if (!config) return;
    setCronEnabled(config.effective.cron_enabled);
    setCronHours(String(config.effective.cron_hours));
  }, [config]);

  async function save(mode: SaveMode) {
    const hours = Number(cronHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
      // The server rejects this too; catching it here keeps the operator from
      // reading a 400 as "the whole config failed".
      setNotice(null);
      setError("The interval must be a whole number of hours from 1 to 24.");
      return;
    }
    await run(async () => {
      await onSave({ cron_enabled: cronEnabled, cron_hours: hours }, mode);
      setNotice(
        mode === "recalculate"
          ? "Schedule saved and a rebuild queued."
          : "Schedule saved. The cache is stale until you run Recalculate all.",
      );
    });
  }

  return (
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
        <SaveBar onSave={save} busy={busy} disabled={!config} />
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
    </div>
  );
}
