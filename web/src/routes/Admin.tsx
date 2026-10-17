/**
 * The admin route (§11.6). Its own shell, its own **four tasks** — not six tabs
 * of fields — and its own sticky sub-nav. `/admin` is not a section of the stats
 * page.
 *
 * Two rules from the spec are enforced here rather than in a task:
 *
 * - saving always marks the cache stale, even when it does not rebuild, so the
 *   operator sees the consequence of the edit before pressing Recalculate;
 * - saving and recalculating are separate actions, which is why `saveConfig`
 *   only enqueues a rebuild for the `"recalculate"` mode.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { Unauthorized, getBootstrap } from "../api/client";
import { Access } from "../admin/Access";
import { FixData } from "../admin/FixData";
import { RefreshCache } from "../admin/RefreshCache";
import { ReplaceDatabase } from "../admin/ReplaceDatabase";
import { getConfig, getStatus, putConfig, recalculate, type ConfigPatch } from "../admin/api";
import { Notice, type SaveMode } from "../admin/shared";
import { Login } from "./Login";

/** The workflow, in the order an operator moves through it (§11.6). */
const TASKS = [
  {
    id: "fix-data",
    label: "Fix the data",
    hint: "Merge accounts, hide people, search messages",
  },
  {
    id: "refresh-cache",
    label: "Refresh the cache",
    hint: "What was built, what changed, recalculate",
  },
  {
    id: "replace-database",
    label: "Replace the database",
    hint: "Upload, validate, back up, commit",
  },
  { id: "access", label: "Access", hint: "Admin id, allowlist, sessions" },
] as const;

type TaskId = (typeof TASKS)[number]["id"];

function initialTask(): TaskId {
  const wanted = window.location.hash.replace(/^#/, "");
  return TASKS.some((task) => task.id === wanted) ? (wanted as TaskId) : "fix-data";
}

export function Admin() {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<TaskId>(initialTask);
  const [markedStale, setMarkedStale] = useState(false);

  const status = useQuery({ queryKey: ["admin", "status"], queryFn: getStatus });
  const ready = status.isSuccess;
  const config = useQuery({
    queryKey: ["admin", "config"],
    queryFn: getConfig,
    enabled: ready,
  });
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: getBootstrap,
    enabled: ready,
    retry: false,
    staleTime: Infinity,
  });

  const markStale = useCallback(() => setMarkedStale(true), []);

  const saveConfig = useCallback(
    async (patch: ConfigPatch, mode: SaveMode) => {
      const next = await putConfig(patch);
      queryClient.setQueryData(["admin", "config"], next);
      // Even "Save only": the numbers are wrong until a rebuild, and the
      // operator must see that before choosing when to run it (§11.6).
      setMarkedStale(true);
      if (mode === "recalculate") {
        await recalculate();
        await queryClient.invalidateQueries({ queryKey: ["admin", "status"] });
        await queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      }
      return next;
    },
    [queryClient],
  );

  const refresh = useCallback(() => {
    setMarkedStale(false);
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
    void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
  }, [queryClient]);

  if (status.isLoading) {
    return <main className="p-6 text-sm text-[var(--color-muted)]">Loading the admin board…</main>;
  }
  if (status.error instanceof Unauthorized) {
    return <Login />;
  }
  if (status.isError || !status.data) {
    return (
      <main className="p-6 text-sm text-red-300">
        Could not load the admin board: {(status.error as Error)?.message}
      </main>
    );
  }

  const data = status.data;
  const stale = markedStale || data.cache_stale;

  return (
    <main className="mx-auto flex min-h-screen max-w-[1200px] flex-col gap-4 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Admin</h1>
          <p className="text-xs text-[var(--color-muted)]">
            {data.app} · channel {data.channel_id} · {data.timezone}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <a className="underline" href="/">
            Back to the stats page
          </a>
          <button
            type="button"
            onClick={refresh}
            className="rounded border border-[var(--color-line)] px-2 py-1"
          >
            Refresh
          </button>
        </div>
      </header>

      {stale ? (
        <Notice tone="warn">
          Cache marked stale — the stats page keeps showing the last build until a rebuild finishes.
          Stage the rest of your edits, then press <strong>Recalculate all</strong>.
        </Notice>
      ) : null}

      <nav
        aria-label="Admin tasks"
        className="sticky top-0 z-10 -mx-4 flex flex-wrap gap-1 border-b border-[var(--color-line)] bg-[var(--color-ink)]/95 px-4 py-2 backdrop-blur"
      >
        {TASKS.map((task) => (
          <button
            key={task.id}
            type="button"
            title={task.hint}
            aria-current={active === task.id ? "true" : undefined}
            onClick={() => {
              setActive(task.id);
              window.history.replaceState(null, "", `#${task.id}`);
            }}
            className={`min-h-9 rounded px-3 py-2 text-xs ${
              active === task.id
                ? "bg-[var(--color-accent)]/20 font-medium text-[var(--color-text)]"
                : "text-[var(--color-muted)]"
            }`}
          >
            {task.label}
          </button>
        ))}
      </nav>

      {active === "fix-data" ? (
        <FixData payload={bootstrap.data ?? null} onDirty={markStale} />
      ) : null}
      {active === "refresh-cache" ? (
        <RefreshCache
          status={data}
          stale={stale}
          config={config.data ?? null}
          onDirty={markStale}
          onSave={saveConfig}
        />
      ) : null}
      {active === "replace-database" ? (
        <ReplaceDatabase
          status={data}
          config={config.data ?? null}
          payload={bootstrap.data ?? null}
          onSave={saveConfig}
          onDirty={markStale}
        />
      ) : null}
      {active === "access" ? (
        <Access status={data} config={config.data ?? null} onSave={saveConfig} />
      ) : null}
    </main>
  );
}
