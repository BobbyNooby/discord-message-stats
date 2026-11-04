/**
 * What a signed-in admin sees while there is nothing to show: the two ways to
 * bring the messages in, and what the one under way is waiting on.
 *
 * Both ways reuse what the admin board already has: the upload is the board's
 * "Replace the database" flow, and the token box is the one from "Refresh the
 * cache". The page above this polls `/api/setup` and swaps in the dashboard
 * by itself once the stats are built.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, DownloadCloud, LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import type { AdminSetup } from "../api/client";
import { createJob, getTokenCheck, putConfig } from "../admin/api";
import { TokenBox } from "../admin/refresh-cache/TokenBox";
import { UploadDatabase } from "../admin/replace-database/UploadDatabase";
import { ActionNotices, Notice, workerOffline } from "../admin/shared";
import { useAction } from "../admin/useAction";
import { RecalculateNow } from "../components/RecalculateNow";
import { setupProgress } from "./progress";

const inFlight = (status: string | undefined) => status === "queued" || status === "running";

export function FirstRun({ setup }: { setup: AdminSetup }) {
  const queryClient = useQueryClient();
  const token = useQuery({ queryKey: ["admin", "token"], queryFn: getTokenCheck });
  const [channel, setChannel] = useState(setup.channel_id);
  const channelSave = useAction();
  const start = useAction();

  // Only when the saved value moves, so a poll never clobbers what is typed.
  useEffect(() => setChannel(setup.channel_id), [setup.channel_id]);

  const refreshSetup = () => queryClient.invalidateQueries({ queryKey: ["setup"] });
  const step = setupProgress(setup);
  const working = inFlight(setup.job?.status);
  const scraping = working && setup.job?.kind !== "rebuild_rollups";

  const blocker = !setup.channel_id
    ? "Save a channel id first."
    : token.data?.source === "none"
      ? "Give the worker a token first: paste one above, or set DISCORD_TOKEN on the worker and restart it."
      : null;

  const saveChannel = (event: FormEvent) => {
    event.preventDefault();
    void channelSave.run(async () => {
      await putConfig({ channel_id: channel.trim() });
      channelSave.setNotice("Channel saved.");
      await Promise.all([refreshSetup(), queryClient.invalidateQueries({ queryKey: ["admin", "token"] })]);
    });
  };

  const beginScrape = () =>
    start.run(async () => {
      await createJob("catch_up");
      await refreshSetup();
    });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1040px] flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-accent)]">
            First run
          </p>
          <h1 className="text-xl font-semibold">Bring your messages in</h1>
          <p className="max-w-prose text-sm text-[var(--color-muted)]">
            There is nothing to show yet. Pick one of the two ways below; this page turns into the
            dashboard by itself once the stats are built.
          </p>
        </div>
        <nav aria-label="Elsewhere" className="flex items-center gap-4 text-xs">
          <a className="inline-flex min-h-9 items-center underline" href="/admin">
            Admin board
          </a>
          <a className="inline-flex min-h-9 items-center underline" href="/auth/logout">
            Sign out
          </a>
        </nav>
      </header>

      {workerOffline(setup.worker_seen_at) ? (
        <Notice tone="warn">
          No worker has checked in recently. Scraping and building the stats both run in the
          worker, so nothing below moves until one is running: <code className="whitespace-nowrap">discord-scraper serve --worker</code>,
          or the worker service in <code>docker-compose.yml</code>.
        </Notice>
      ) : null}

      {step ? (
        <section aria-label="What is happening now" className="space-y-2">
          {step.tone === "info" ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-xs text-[var(--color-text)]"
            >
              {working ? (
                <LoaderCircle size={14} aria-hidden className="mt-0.5 shrink-0 animate-spin" />
              ) : null}
              <span>{step.text}</span>
            </p>
          ) : (
            <Notice tone={step.tone}>{step.text}</Notice>
          )}
          {step.action === "build" ? <RecalculateNow label="Build the stats" /> : null}
        </section>
      ) : null}

      <div className="grid items-start gap-4 md:grid-cols-2">
        <Way id="first-run-upload" number={1} icon={<DatabaseBackup size={16} />} title="Upload a database you already have">
          <p>
            Scraped it on another machine, or kept a backup? Upload that <code>messages.db</code>. It
            is integrity-checked and described before anything is swapped in.
          </p>
          <p>
            Take a consistent copy first. It is safe while the scraper is running, and it includes
            writes still waiting in the WAL file, which a plain file copy can miss:
          </p>
          <pre className="overflow-x-auto rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-[11px] text-[var(--color-text)]">
            <code>sqlite3 messages.db ".backup copy.db"</code>
          </pre>
          <div className="space-y-2 text-[var(--color-text)]">
            <UploadDatabase onCommitted={() => void refreshSetup()} />
          </div>
          <p className="text-[11px]">
            Swapping the file in usually signs you out: sign-ins are kept in the database, so the
            uploaded file brings its own. Sign in again and the stats will be building. The same
            upload stays in the admin board under Replace the database.
          </p>
        </Way>

        <Way id="first-run-scrape" number={2} icon={<DownloadCloud size={16} />} title="Scrape from scratch">
          <p>
            The worker reads the channel through Discord with a bot token, newest message first,
            then builds the stats. A big channel takes a while, and you can close this page
            meanwhile.
          </p>

          <form className="space-y-1" onSubmit={saveChannel}>
            <label htmlFor="first-run-channel" className="block text-xs font-medium text-[var(--color-text)]">
              Channel ID
            </label>
            <div className="flex gap-2">
              <input
                id="first-run-channel"
                inputMode="numeric"
                autoComplete="off"
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                className="min-h-9 min-w-0 flex-1 rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 text-xs text-[var(--color-text)]"
              />
              <button
                type="submit"
                disabled={channelSave.busy || !channel.trim() || channel.trim() === setup.channel_id}
                className="min-h-9 shrink-0 rounded border border-[var(--color-line)] px-3 text-xs disabled:opacity-50"
              >
                Save channel
              </button>
            </div>
            <p className="text-[11px]">{channelLine(setup.channel_id, token.data?.channel ?? null)}</p>
            <ActionNotices notice={channelSave.notice} error={channelSave.error} />
          </form>

          <TokenBox />

          <div className="space-y-2 border-t border-[var(--color-line)] pt-3">
            <button
              type="button"
              onClick={() => void beginScrape()}
              disabled={start.busy || scraping || blocker !== null}
              className="min-h-9 rounded bg-[var(--color-accent)] px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              Start scraping
            </button>
            {blocker ? <p className="text-[11px]">{blocker}</p> : null}
            <p className="text-[11px]">
              With the schedule on, the worker also starts by itself once a channel and a token are
              both set.
            </p>
            <ActionNotices notice={start.notice} error={start.error} />
          </div>
        </Way>
      </div>
    </main>
  );
}

/** What is known about the channel: unset, readable, or refused at the last check. */
function channelLine(
  channelId: string,
  checked: { ok: boolean; id: string; name: string | null; error: string | null } | null,
): string {
  if (!channelId) {
    return "Not set yet. In Discord, turn on Developer Mode, then right-click the channel and choose Copy Channel ID.";
  }
  if (checked?.id === channelId) {
    return checked.ok
      ? `The token can read ${checked.name ? `#${checked.name}` : "this channel"}.`
      : `The token cannot read this channel: ${checked.error ?? "no reason given"}.`;
  }
  return "Press Check now below to see whether the token can read it.";
}

function Way({
  id,
  number,
  icon,
  title,
  children,
}: {
  id: string;
  number: number;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-5"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
        >
          {icon}
        </span>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">Option {number}</p>
          <h2 id={`${id}-heading`} className="text-sm font-semibold">
            {title}
          </h2>
        </div>
      </div>
      <div className="space-y-3 text-xs text-[var(--color-muted)]">{children}</div>
    </section>
  );
}
