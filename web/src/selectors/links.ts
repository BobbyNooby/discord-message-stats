/**
 * The numbers the Links & embeds and Rich media cards draw. Only the domain
 * cells carry a day and an author; every other list here is one flat rollup.
 */
import type { Payload } from "../api/types";
import type { Filters } from "../filters/reducer";
import { providerLabel } from "../lib/mediaLabels";
import { inRange } from "./cells";
import { allPairRows, type Row } from "./media";

/** The top cut §5.11 documents; the long tail is already dropped from the payload. */
const TOP_DOMAINS = 15;

const TOP_LINKS = 13;

/** Links per domain under the time and author filters, busiest first. */
export function domainRows(
  payload: Payload,
  filters: Filters,
  top = TOP_DOMAINS,
): [string, number][] {
  const totals = new Map<number, number>();
  for (const [dayIndex, authorIndex, domainIndex, uses] of payload.linkCells ?? []) {
    if (filters.active[authorIndex] === false) continue;
    if (!inRange(payload, filters, dayIndex)) continue;
    totals.set(domainIndex, (totals.get(domainIndex) ?? 0) + uses);
  }
  return [...totals.entries()]
    .map(([index, uses]): [string, number] => [payload.linkDomains[index] ?? `#${index}`, uses])
    .sort((a, b) => b[1] - a[1])
    .slice(0, top);
}

/** The most reposted links, as normalised by the payload, most posted first. */
export function topLinkRows(payload: Payload): [string, number][] {
  return (payload.topLinks ?? []).slice(0, TOP_LINKS).sort((a, b) => b[1] - a[1]);
}

/** Every provider the payload carries, or only the one a scope names, in payload order. */
export function providerRows(payload: Payload, provider: string | null): Row[] {
  const source = provider
    ? (payload.providers ?? []).filter(([name]) => name === provider)
    : payload.providers;
  return allPairRows(source).map((row) => ({
    ...row,
    // Discord's `unprovidenced` is a bucket, not a provider name (§UI/UX rule 1).
    // This list has no URL to split CDN uploads from unnamed links, so both read
    // "No provider".
    name: providerLabel(row.name, row.name),
  }));
}

/**
 * Raw provider totals, with Discord's unnamed bucket split by host: an
 * `cdn.discordapp.com` attachment is somebody's own upload, not a mystery.
 */
export function providerTotals(payload: Payload): [string, number][] {
  return Object.values(
    (payload.providers ?? []).reduce<Record<string, [string, number]>>((acc, [name, count]) => {
      const key = providerLabel(name, name);
      acc[key] = [key, (acc[key]?.[1] ?? 0) + count];
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
}
