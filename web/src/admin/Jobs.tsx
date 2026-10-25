import { useQuery, useQueryClient } from "@tanstack/react-query";

import { createJob, listJobs, type JobKind } from "./api";
import { Notice, formatStamp } from "./shared";
import { useAction } from "./useAction";

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

/** The last fifty jobs, newest first, failures included. */
export function JobHistory() {
  const jobs = useQuery({ queryKey: ["admin", "jobs"], queryFn: () => listJobs(50) });

  return (
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
  );
}
