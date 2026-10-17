/**
 * The timezone picker (§11.6).
 *
 * A free-text field that accepted `GMT+8` and only complained afterwards is
 * replaced by the real vocabulary: every zone comes from
 * `GET /api/admin/timezones`, which reads the same `zoneinfo` set the loader
 * validates against, so the board cannot offer a name the server would reject.
 *
 * The consequence is stated **before** anything is pressed: a timezone change
 * moves messages between calendar days, so every date bucket is recomputed and
 * a rebuild is required to apply it. The effective zone is named too, because
 * "auto" is a legitimate setting whose meaning the operator cannot guess.
 */

import { useQuery } from "@tanstack/react-query";

import { getTimezones } from "./api";
import { Notice } from "./shared";

export function TimezonePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const zones = useQuery({ queryKey: ["admin", "timezones"], queryFn: getTimezones });
  const configured = zones.data?.configured;
  const changed = configured !== undefined && value !== configured;

  return (
    <div className="space-y-2">
      <label htmlFor="admin-timezone" className="block text-xs font-medium">
        Timezone
      </label>
      <select
        id="admin-timezone"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-2 py-1.5 text-xs"
      >
        {/* "auto" is a documented setting in config.toml, so the board offers it
            rather than rejecting a value the file already allows. */}
        <option value="auto">
          {zones.data
            ? `Automatic (this host: ${zones.data.auto_zone})`
            : "Automatic (this host's zone)"}
        </option>
        {(zones.data?.zones ?? (value && value !== "auto" ? [value] : [])).map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>

      {zones.isError ? (
        <Notice tone="error">
          Could not load the zone list ({(zones.error as Error).message}); only the current value is
          offered, so a change here might not be saveable.
        </Notice>
      ) : null}

      {zones.data ? (
        <p className="text-[11px] text-[var(--color-muted)]">
          Effective zone now: <code>{zones.data.effective}</code>
          {zones.data.configured === "auto"
            ? ` — "auto" resolves to ${zones.data.auto_zone} on this host`
            : ""}
        </p>
      ) : null}

      <Notice tone={changed ? "warn" : "info"}>
        {changed ? (
          <>
            You changed the timezone. Messages move between calendar days and every date bucket is
            recomputed, so <strong>a rebuild is required to apply it</strong> — save and rebuild when
            ready.
          </>
        ) : (
          <>
            A timezone change moves messages between calendar days, so every date bucket is
            recomputed and <strong>a rebuild is required to apply it</strong>.
          </>
        )}
      </Notice>
    </div>
  );
}
