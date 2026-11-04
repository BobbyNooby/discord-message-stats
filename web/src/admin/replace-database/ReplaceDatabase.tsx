/**
 * "Replace the database" (§10.6): what the database holds, the upload flow, and
 * the channel/timezone the rollups are keyed on.
 *
 * The upload itself is `UploadDatabase`, its own component so other screens can offer it.
 */

import { useEffect, useState } from "react";

import type { Payload } from "../../api/types";
import { StatCard } from "../../components/StatCard";
import type { AdminConfig, AdminStatus, ConfigPatch } from "../api";
import {
  Notice,
  SaveBar,
  Section,
  SubSection,
  formatBytes,
  formatDay,
  formatStamp,
  type SaveMode,
} from "../shared";
import { TimezonePicker } from "./TimezonePicker";
import { UploadDatabase } from "./UploadDatabase";
import { useAction } from "../useAction";

export function ReplaceDatabase({
  status,
  config,
  payload,
  onSave,
  onDirty,
}: {
  status: AdminStatus;
  config: AdminConfig | null;
  payload: Payload | null;
  onSave: (patch: ConfigPatch, mode: SaveMode) => Promise<AdminConfig>;
  onDirty: () => void;
}) {
  const [channel, setChannel] = useState(config?.effective.channel_id ?? "");
  const [timezone, setTimezone] = useState(config?.effective.timezone ?? "");
  const {
    busy: saving,
    notice: saveNotice,
    error: saveError,
    run: runSave,
    setNotice: setSaveNotice,
  } = useAction();

  useEffect(() => {
    if (!config) return;
    setChannel(config.effective.channel_id);
    setTimezone(config.effective.timezone);
  }, [config]);

  const save = (mode: SaveMode) =>
    runSave(async () => {
      await onSave({ channel_id: channel.trim(), timezone: timezone.trim() }, mode);
      setSaveNotice(
        mode === "recalculate"
          ? "Configuration saved and a rebuild queued."
          : "Configuration saved. The cache is stale until you run Recalculate all.",
      );
    });

  const rawAccounts = payload
    ? payload.authors.reduce((total, author) => total + (author.accounts?.length ?? 1), 0)
    : null;

  return (
    <Section id="replace-database" title="Replace the database">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Messages" value={payload ? payload.meta.total.toLocaleString() : "—"} />
        <StatCard label="Identities" value={payload ? String(payload.authors.length) : "—"} />
        <StatCard label="Raw accounts" value={rawAccounts === null ? "—" : String(rawAccounts)} />
        <StatCard label="Active days" value={payload ? String(payload.meta.active_days) : "—"} />
        <StatCard
          label="Range"
          value={payload ? formatDay(payload.meta.firstLocal) : "—"}
          sub={payload ? `→ ${formatDay(payload.meta.lastLocal)}` : undefined}
        />
        <StatCard
          label="DB size"
          value={formatBytes(status.database.size_bytes)}
          sub={status.database.path}
        />
      </div>

      <SubSection id="admin-upload" title="Upload a database">
        <p className="text-xs text-[var(--color-muted)]">
          A <code>messages.db</code> built elsewhere. It is integrity-checked and described before
          anything is swapped in; the current file survives as <code>.bak</code>.
        </p>
        <UploadDatabase onCommitted={onDirty} />
      </SubSection>

      <SubSection id="admin-scope" title="Channel and timezone">
        <p className="text-xs text-[var(--color-muted)]">
          Both are overrides; the effective values are what the rollups are keyed on. A timezone
          change moves messages between calendar days, so it needs a rebuild.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="admin-channel" className="block text-xs font-medium">
              Channel ID
            </label>
            <input
              id="admin-channel"
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
            />
          </div>
          <div>
            <TimezonePicker value={timezone} onChange={setTimezone} />
          </div>
        </div>
        <p className="text-[11px] text-[var(--color-muted)]">
          Server side now: channel <code>{status.channel_id}</code>, zone{" "}
          <code>{status.timezone}</code> · status as of {formatStamp(status.checked_at)}
        </p>
        <SaveBar onSave={save} busy={saving} disabled={!config} />
        {saveError ? <Notice tone="error">{saveError}</Notice> : null}
        {saveNotice ? <Notice tone="ok">{saveNotice}</Notice> : null}
      </SubSection>
    </Section>
  );
}
