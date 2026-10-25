import { useQuery, useQueryClient } from "@tanstack/react-query";

import { cancelJob, createJob, listJobs, type JobKind } from "../api";
import { Notice, formatStamp } from "../shared";
import { useAction } from "../useAction";

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
  {
    kind: "backup",
    label: "Back up now",
    hint: "copy the database into backups/ beside it; the worker also does this daily",
    changesData: false,
  },
];

/** The jobs an operator can queue by hand; the ones that fetch messages mark the cache stale. */
export function JobRunner({ onDirty }: { onDirty: () => void }) {
  const queryClient = useQueryClient();
  const { notice: queued, error, run, setNotice: setQueued } = useAction();

  // The last "queued" line stays up until the next one replaces it.
  const enqueue = (kind: JobKind, label: string, changesData: boolean) =>
    run(
      async () => {
        const job = await createJob(kind);
        if (changesData) onDirty();
        setQueued(`${label} queued as job #${job.id} (${job.status}).`);
        await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
        await queryClient.invalidateQueries({ queryKey: ["admin", "status"] });
      },
      { keepNotice: true },
    );

  return (
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
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

/** The last fifty jobs, newest first, failures included; a queued one can be cancelled. */
export function JobHistory() {
  const queryClient = useQueryClient();
  const jobs = useQuery({ queryKey: ["admin", "jobs"], queryFn: () => listJobs(50) });
  const { busy, notice, error, run, setNotice } = useAction();

  // Only a queued job: a running rebuild is mid-write, and the server refuses
  // it with a sentence that says to wait, which is what the board then shows.
  const cancel = (id: number, kind: string) =>
    run(async () => {
      const result = await cancelJob(id);
      setNotice(
        result.already ? `Job #${id} was already cancelled.` : `Job #${id} (${kind}) cancelled before it started.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "status"] });
    });

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h4 className="text-xs font-semibold">Job history</h4>
      {jobs.isError ? <Notice tone="error">{(jobs.error as Error).message}</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
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
              <th scope="col" className="py-1 pr-3">
                Outcome
              </th>
              <th scope="col" className="py-1">
                <span className="sr-only">Actions</span>
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
                <td className="py-1 pr-3">
                  {job.error ? (
                    <span className="text-red-300">{job.error}</span>
                  ) : (
                    <span className="text-[var(--color-muted)]">{job.result ?? "—"}</span>
                  )}
                </td>
                <td className="py-1 text-right">
                  {job.status === "queued" ? (
                    <button
                      type="button"
                      onClick={() => void cancel(job.id, job.kind)}
                      disabled={busy}
                      aria-label={`Cancel job ${job.id}`}
                      className="rounded border border-[var(--color-line)] px-2 py-0.5 text-[11px] disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {(jobs.data?.jobs ?? []).length === 0 ? (
              <tr>
                <td colSpan={7} className="py-2 text-[var(--color-muted)]">
                  No jobs yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
