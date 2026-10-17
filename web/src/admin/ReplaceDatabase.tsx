/**
 * "Replace the database" (§10.6): what the database holds, the upload flow, and
 * the channel/timezone the rollups are keyed on.
 *
 * The upload is deliberately two steps — stage, then confirm — because the
 * operator has to see what they are replacing before anything is swapped. The
 * stage step is the dry run: row count, channel, zone, rows added, rows that
 * would be lost, and the free disk the swap needs.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";

import type { Payload } from "../api/types";
import { StatCard } from "../components/StatCard";
import {
  JobRunning,
  discardUpload as discardStaged,
  commitUpload,
  uploadDatabase,
  type AdminConfig,
  type AdminStatus,
  type ConfigPatch,
  type UploadPreview,
} from "./api";
import {
  Def,
  DefList,
  Notice,
  SaveBar,
  Section,
  SubSection,
  formatBytes,
  formatDay,
  formatStamp,
  type SaveMode,
} from "./shared";
import { TimezonePicker } from "./TimezonePicker";

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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [jobRunning, setJobRunning] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!config) return;
    setChannel(config.effective.channel_id);
    setTimezone(config.effective.timezone);
  }, [config]);

  async function save(mode: SaveMode) {
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      await onSave({ channel_id: channel.trim(), timezone: timezone.trim() }, mode);
      setSaveNotice(
        mode === "recalculate"
          ? "Configuration saved and a rebuild queued."
          : "Configuration saved. The cache is stale until you run Recalculate all.",
      );
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function stage(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setUploadError("Choose a database file first.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    setUploadNotice(null);
    setJobRunning(false);
    try {
      setPreview(await uploadDatabase(file));
    } catch (error) {
      if (error instanceof JobRunning) {
        // Not a failure: the operator just has to wait (§10.6 step 1).
        setJobRunning(true);
      } else {
        setUploadError((error as Error).message);
      }
    } finally {
      setUploading(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setUploading(true);
    setUploadError(null);
    try {
      const done = await commitUpload(preview.upload_id);
      onDirty();
      setPreview(null);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setUploadNotice(
        `Database replaced with ${done.rows} messages (${formatDay(done.first)} → ${formatDay(done.last)}). ` +
          (done.backup ? `The previous file is kept as ${done.backup}. ` : "") +
          `Rebuild queued as job #${done.job.id}.`,
      );
    } catch (error) {
      setUploadError((error as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function discard() {
    if (!preview) return;
    try {
      await discardStaged(preview.upload_id);
    } catch {
      /* the staged copy is disposable either way */
    }
    setPreview(null);
  }

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
        <form className="space-y-2" onSubmit={stage}>
          <label htmlFor="admin-upload-file" className="block text-xs font-medium">
            Database file
          </label>
          <input
            ref={fileInput}
            id="admin-upload-file"
            name="file"
            type="file"
            accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/x-sqlite3"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setUploadNotice(null);
              setUploadError(null);
            }}
            className="block w-full text-xs file:mr-3 file:rounded file:border file:border-[var(--color-line)] file:bg-[var(--color-surface-2)] file:px-2 file:py-1 file:text-xs file:text-[var(--color-text)]"
          />
          <button
            type="submit"
            disabled={uploading || !file}
            className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {uploading ? "Checking…" : "Upload and dry-run"}
          </button>
        </form>

        {jobRunning ? (
          <Notice tone="warn">
            A job is running — wait for the running job to finish, then upload again. An upload
            replaces a file the worker may be reading.
          </Notice>
        ) : null}
        {uploadError ? <Notice tone="error">{uploadError}</Notice> : null}

        {preview ? (
          <div className="space-y-3 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              Nothing has been replaced yet
            </h4>
            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <DefList>
                <Def label="Uploaded rows">{preview.rows.toLocaleString()}</Def>
                <Def label="Uploaded range">
                  {formatDay(preview.first)} → {formatDay(preview.last)}
                </Def>
                <Def label="Uploaded size">{formatBytes(preview.size_bytes)}</Def>
                <Def label="Channel">{preview.channel_id}</Def>
                <Def label="Timezone">
                  {preview.timezone}
                  {preview.timezone_source === "config" ? " (from the server)" : " (from the file)"}
                </Def>
              </DefList>
              <DefList>
                <Def label="Current rows">{preview.replaces.rows.toLocaleString()}</Def>
                <Def label="Current range">
                  {formatDay(preview.replaces.first)} → {formatDay(preview.replaces.last)}
                </Def>
                <Def label="Current size">{formatBytes(preview.replaces.size_bytes)}</Def>
                <Def label="Rows added">{preview.added === null ? "unknown" : preview.added.toLocaleString()}</Def>
                <Def label="Rows that would be lost">
                  {preview.lost === null ? "unknown" : preview.lost.toLocaleString()}
                </Def>
                <Def label="Free disk">
                  {formatBytes(preview.disk.free_bytes)} free · {formatBytes(preview.disk.required_bytes)}{" "}
                  needed
                </Def>
              </DefList>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={confirm}
                disabled={uploading}
                className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Confirm and replace the database
              </button>
              <button
                type="button"
                onClick={discard}
                disabled={uploading}
                className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-50"
              >
                Discard this upload
              </button>
            </div>
            <p className="text-[11px] text-[var(--color-muted)]">
              Confirming backs the current file up first, prepares the uploaded one, and swaps it in
              with a single rename. If any step fails, nothing is replaced.
            </p>
          </div>
        ) : null}
        {uploadNotice ? <Notice tone="ok">{uploadNotice}</Notice> : null}
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
