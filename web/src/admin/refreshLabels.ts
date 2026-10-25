/**
 * The words and colours the Refresh task puts on its numbers, kept apart from
 * the screen so each rule can be tested on its own.
 */
import type { AdminConfig, AdminStatus, RollupFamily } from "./api";
import type { FamilyProgress } from "./ProgressView";

export function tokenTone(status: string): "ok" | "warn" | "error" {
  const value = status.toLowerCase();
  if (value === "ok") return "ok";
  if (value === "dead") return "error";
  return "warn";
}

/**
 * What the worker will actually do. A value saved from this board wins; until
 * one is saved the worker falls back to config.toml, so "nothing stored" is
 * not "off" — reading it that way showed "off" over a schedule that was running.
 */
export function scheduleLabel(
  worker: Pick<AdminStatus["worker"], "cron_enabled" | "cron_hours">,
  config: AdminConfig | null,
): string {
  const stored = worker.cron_enabled?.trim().toLowerCase();
  const enabled = stored == null ? (config?.effective.cron_enabled ?? true) : !["0", "false", "no", "off"].includes(stored);
  if (!enabled) return "off";
  return `every ${worker.cron_hours ?? config?.effective.cron_hours ?? 6} h`;
}

export function stateTone(state: FamilyProgress["state"]): string {
  if (state === "done") return "text-emerald-300";
  if (state === "running") return "text-amber-300";
  if (state === "failed") return "text-red-300";
  return "text-[var(--color-muted)]";
}

/** One sentence for what the provenance row says about a family. */
export function changeSummary(family: {
  built_from_rows: number | null;
  added_since: number | null;
  config_changed: boolean;
  computed_at: string | null;
}): string {
  if (!family.computed_at || family.built_from_rows === null) {
    return "never built";
  }
  const parts = [`built from ${family.built_from_rows.toLocaleString()} messages`];
  if (family.added_since) {
    parts.push(`${family.added_since.toLocaleString()} added since`);
  } else {
    parts.push("nothing added since");
  }
  if (family.config_changed) parts.push("settings changed since");
  return parts.join(" · ");
}

/** What the provenance row says about a family, from whichever source has it. */
export function provenance(row: FamilyProgress, rollup: RollupFamily | undefined): string {
  if (rollup) return changeSummary(rollup);
  if (row.computed_at === null) return "never built";
  if (row.added_since) return `${row.added_since.toLocaleString()} added since`;
  return "nothing added since";
}
