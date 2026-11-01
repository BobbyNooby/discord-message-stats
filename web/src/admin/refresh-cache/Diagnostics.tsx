/**
 * What an admin opens when something looks wrong: which build this is, where
 * the zone and channel came from, how much disk is left, and the last few
 * failures. Aggregates only — a count, an id, a time — never message text.
 */

import { useQuery } from "@tanstack/react-query";

import { getDiagnostics, type Diagnostics as DiagnosticsData } from "../api";
import { Def, DefList, Notice, formatBytes, formatStamp } from "../shared";

const SOURCE: Record<"override" | "file", string> = {
  override: "saved on this board",
  file: "config.toml",
};

export function Diagnostics() {
  const diagnostics = useQuery({ queryKey: ["admin", "diagnostics"], queryFn: getDiagnostics });

  if (diagnostics.isError) {
    return <Notice tone="error">{(diagnostics.error as Error).message}</Notice>;
  }
  if (!diagnostics.data) {
    return <Notice tone="info">Reading the diagnostics…</Notice>;
  }
  return <DiagnosticsView data={diagnostics.data} />;
}

export function DiagnosticsView({ data }: { data: DiagnosticsData }) {
  const running = data.worker.running_job;
  return (
    <div className="space-y-3">
      <DefList>
        <Def label="Version">
          {data.version}
          {data.commit ? ` · ${data.commit}` : ""}
        </Def>
        <Def label="Timezone">
          {data.config.timezone} ({SOURCE[data.config.timezone_source]})
        </Def>
        <Def label="Channel">
          {data.config.channel_id} ({SOURCE[data.config.channel_id_source]})
        </Def>
        <Def label="Database">{formatBytes(data.database.size_bytes)}</Def>
        <Def label="Disk free">
          {data.disk ? `${formatBytes(data.disk.free_bytes)} of ${formatBytes(data.disk.total_bytes)}` : "unknown"}
        </Def>
        <Def label="Staged uploads">
          {data.orphans.count ? `${data.orphans.count} (${formatBytes(data.orphans.bytes)})` : "none"}
        </Def>
        <Def label="Running job">{running ? `#${running.id} ${running.kind}${running.phase ? ` · ${running.phase}` : ""}` : "none"}</Def>
        <Def label="Stale families">{data.families.stale_count}</Def>
      </DefList>
      {/* The worker keeps its last error after it recovers, so this warns only
          while it is still failing; the count arrives as text, and "0" is truthy.
          An older failure stays in the list below with its date. */}
      {Number(data.worker.consecutive_failures) > 0 && data.worker.last_error ? (
        <Notice tone="warn">Worker's last error: {data.worker.last_error}</Notice>
      ) : null}
      <div>
        <h4 className="text-xs font-semibold">Recent failures</h4>
        {data.failures.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--color-muted)]">None recorded.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {data.failures.map((failure) => (
              <li key={`${failure.source}-${failure.id}`} className="border-b border-[var(--color-line)]/50 pb-1">
                <span className="text-[var(--color-muted)]">{formatStamp(failure.at)}</span>{" "}
                <span>
                  {failure.source === "job" ? `job #${failure.id}` : "rebuild"} · {failure.kind}
                </span>
                {failure.error ? <span className="block text-red-300">{failure.error}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
