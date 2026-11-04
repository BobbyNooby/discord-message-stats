/**
 * The upload itself (§10.6): stage, read the dry run, then confirm or discard.
 *
 * Deliberately two steps, because the operator has to see what they are
 * replacing before anything is swapped. The stage step is the dry run: row
 * count, channel, zone, rows added, rows that would be lost, and the free disk
 * the swap needs. "Replace the database" and the first-run screen both offer
 * it, so a new install brings its data in through the same checks.
 */

import { useRef, useState, type FormEvent } from "react";

import {
  JobRunning,
  discardUpload as discardStaged,
  commitUpload,
  uploadDatabase,
  type UploadCommit,
  type UploadPreview,
} from "../api";
import { Def, DefList, Notice, formatBytes, formatDay } from "../shared";
import { useAction } from "../useAction";

export function UploadDatabase({ onCommitted }: { onCommitted?: (done: UploadCommit) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [jobRunning, setJobRunning] = useState(false);
  const { busy, notice, error, run, setNotice, setError } = useAction();
  const fileInput = useRef<HTMLInputElement>(null);

  async function stage(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a database file first.");
      return;
    }
    setJobRunning(false);
    await run(async () => {
      try {
        setPreview(await uploadDatabase(file));
      } catch (failure) {
        // Not a failure: the operator just has to wait (§10.6 step 1).
        if (failure instanceof JobRunning) setJobRunning(true);
        else throw failure;
      }
    });
  }

  async function confirm() {
    if (!preview) return;
    const staged = preview;
    await run(
      async () => {
        const done = await commitUpload(staged.upload_id);
        setPreview(null);
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        setNotice(
          `Database replaced with ${done.rows} messages (${formatDay(done.first)} → ${formatDay(done.last)}). ` +
            (done.backup ? `The previous file is kept as ${done.backup}. ` : "") +
            `Rebuild queued as job #${done.job.id}.`,
        );
        onCommitted?.(done);
      },
      { keepNotice: true },
    );
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

  return (
    <>
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
            setNotice(null);
            setError(null);
          }}
          className="block w-full text-xs file:mr-3 file:rounded file:border file:border-[var(--color-line)] file:bg-[var(--color-surface-2)] file:px-2 file:py-1 file:text-xs file:text-[var(--color-text)]"
        />
        <button
          type="submit"
          disabled={busy || !file}
          className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {busy ? "Checking…" : "Upload and dry-run"}
        </button>
      </form>

      {jobRunning ? (
        <Notice tone="warn">
          A job is running — wait for the running job to finish, then upload again. An upload
          replaces a file the worker may be reading.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {preview ? (
        // A container, so the dry run lays out by its own width: two-up in the
        // admin board, stacked in a first-run card half that size.
        <div className="@container space-y-3 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Nothing has been replaced yet
          </h4>
          <div className="grid gap-3 text-xs @2xl:grid-cols-2">
            <DefList columns="@md:grid-cols-2">
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
            <DefList columns="@md:grid-cols-2">
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
              disabled={busy}
              className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Confirm and replace the database
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={busy}
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
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
    </>
  );
}
