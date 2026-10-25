/**
 * "Refresh the cache" (§11.6, §10.5): when each family was built, what has
 * changed since, **Recalculate all**, and the controls that fetch new messages.
 *
 * The API never computes an aggregate on read, so a rebuild is the only way the
 * numbers move — and it is a 202 job, never an inline rebuild. The per-family
 * table turns the provenance row into the question the operator actually has:
 * "how much has arrived since this was built?"
 *
 * This file keeps the rebuild and its live feed; the families table, the worker
 * cards and the jobs are pieces of their own.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { recalculate, type AdminConfig, type AdminStatus, type ConfigPatch } from "../api";
import { FamiliesTable } from "./FamiliesTable";
import { JobHistory, JobRunner } from "./Jobs";
import { FreshnessLine, LiveLog, NowLine, mergeFamilies } from "./ProgressView";
import {
  ActionNotices,
  Def,
  DefList,
  Notice,
  Section,
  SubSection,
  formatStamp,
  workerOffline,
  type SaveMode,
} from "../shared";
import { useAction } from "../useAction";
import { useProgress } from "./useProgress";
import { LastIngest, TokenHealth } from "./WorkerCards";

export function RefreshCache({
  status,
  stale,
  config,
  onDirty,
  onRebuilt,
  onSave,
}: {
  status: AdminStatus;
  stale: boolean;
  config: AdminConfig | null;
  onDirty: () => void;
  /** The run finished clean, so any locally-marked staleness is settled. */
  onRebuilt?: () => void;
  onSave: (patch: ConfigPatch, mode: SaveMode) => Promise<AdminConfig>;
}) {
  const queryClient = useQueryClient();
  const feed = useProgress();
  const { busy, notice, error, run: runRebuild, setNotice } = useAction();

  const families = Object.entries(status.rollups);
  const totalRows = families.reduce((total, [, family]) => total + family.rows, 0);
  const staleFamilies = families.filter(([, family]) => family.stale).length;
  const worker = status.worker;
  // A rebuild blocks the worker's own loop, so its heartbeat goes stale while it
  // is demonstrably alive. A live run is the freshest proof the worker exists.
  const offline = workerOffline(worker.last_seen_at) && !feed.data?.running;
  // One row per family: the live run's state and the last build's provenance.
  const familyRows = mergeFamilies(feed.data?.families ?? null, status.rollups);
  const runningSeconds = feed.data?.running ? (feed.data.totals.seconds ?? null) : null;

  // One refetch when a run ends: /status carries the new rollup rows and the
  // worker heartbeat written as the job finished, and the job that was just
  // "queued" in the history below is now done. A clean finish is also the only
  // evidence that the cache is no longer stale, so it clears the local marking
  // too; a failed run leaves it up.
  const wasRunning = useRef(false);
  useEffect(() => {
    const running = feed.data?.running ?? false;
    if (wasRunning.current && !running) {
      void queryClient.invalidateQueries({ queryKey: ["admin", "status"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      if (feed.data?.last?.status === "finished") onRebuilt?.();
    }
    wasRunning.current = running;
  }, [feed.data?.running, feed.data?.last?.status, onRebuilt, queryClient]);

  // The click-time confirmation names a job the worker has not picked up yet.
  // Once the run is visible the live panel below is the honest answer, so the
  // "queued" copy gives way to it and never comes back.
  useEffect(() => {
    if (feed.data?.running) setNotice(null);
  }, [feed.data?.running]);

  // The last "queued" line stays up until the next one replaces it.
  const run = () =>
    runRebuild(
      async () => {
        // The worker only picks a queued job up on its next pass, so poll from
        // the click: waiting for the stale flag would only start the feed once
        // the rebuild is already over.
        feed.kick();
        const job = await recalculate();
        onDirty();
        setNotice(`Rebuild queued as job #${job.id} (${job.status}). The cache stays stale until it finishes.`);
        await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
        await queryClient.invalidateQueries({ queryKey: ["admin", "status"] });
      },
      { keepNotice: true },
    );

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
        {feed.data ? (
          <FreshnessLine
            running={feed.data.running}
            startedAt={feed.data.started_at}
            elapsedSeconds={runningSeconds}
            last={feed.data.last}
            freshness={feed.data.freshness}
          />
        ) : (
          <Notice tone="info">Checking whether the cache is current…</Notice>
        )}
        <DefList>
          <Def label="Configuration hash">{status.config_hash.slice(0, 12)}</Def>
          <Def label="Status as of">{formatStamp(status.checked_at)}</Def>
          <Def label="Families">{families.length}</Def>
          <Def label="Total rollup rows">{totalRows.toLocaleString()}</Def>
          <Def label="Jobs queued">{status.jobs.queued ?? 0}</Def>
          <Def label="Jobs running">{status.jobs.running ?? 0}</Def>
        </DefList>

        <FamiliesTable rows={familyRows} rollups={status.rollups} />

        <div>
          <p className="text-xs text-[var(--color-muted)]">
            A rebuild runs as a background job and takes as long as the message table is big — minutes
            on a large database. Needed after a timezone, merge, who-shows or ignore-list change.
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
        <ActionNotices notice={notice} error={error} />
      </SubSection>

      <SubSection id="refresh-progress" title="Rebuild progress">
        <NowLine
          running={feed.data?.running ?? false}
          abandoned={feed.data?.abandoned ?? false}
          phase={feed.data?.phase ?? null}
          startedAt={feed.data?.started_at ?? null}
          elapsedSeconds={runningSeconds}
          loading={feed.loading}
        />
        {feed.error ? (
          <Notice tone="warn">Live progress unavailable: {feed.error.message}</Notice>
        ) : null}
        <p className="mb-1 text-[11px] text-[var(--color-muted)]">
          {feed.live ? (
            <>
              <span aria-hidden className="text-emerald-300">●</span> live — lines appear as the worker writes them
            </>
          ) : (
            "checking every few seconds"
          )}
        </p>
        <LiveLog entries={feed.log} />
      </SubSection>

      <SubSection id="refresh-ingest" title="Fetch new messages">
        <div className="grid gap-3 md:grid-cols-2">
          <TokenHealth worker={worker} />
          <LastIngest worker={worker} config={config} onSave={onSave} />
        </div>

        <JobRunner onDirty={onDirty} />

        <JobHistory />
      </SubSection>
    </Section>
  );
}
