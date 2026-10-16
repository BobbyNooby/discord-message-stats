import { useState } from "react";

import type { EChartsOption } from "echarts";

import type { Payload } from "../api/types";
import type { Filters } from "../filters/reducer";
import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import { hasTimeFilter } from "../filters/selectors";
import { EChart } from "../lib/echart";

/**
 * "Most reposted" (§11.1, the rich-media idea).
 *
 * The same GIF gets posted over and over — one Tenor cat 63 times on the
 * reference data — and counting it per author hides that. `payload.topMedia` is
 * one row per URL, so this panel shows the thing itself.
 *
 * Thumbnails respect `media.thumbnails`: "proxy" (this server fetches and caches
 * them, so Tenor and Klipy never learn who is reading the chat), "direct" (the
 * browser asks them), or "off" (numbers and providers only).
 */

type MediaRow = [string, string, string, string, string, number];

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(Math.round(n));

/** A readable name for a media item we have no title for. */
function label(url: string, title: string): string {
  if (title) return title;
  try {
    const parsed = new URL(url);
    const tail = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || url);
    return tail.replace(/[-_]+/g, " ").slice(0, 60);
  } catch {
    return url.slice(0, 60);
  }
}

function thumbnailSrc(url: string, mode: string): string | null {
  if (mode === "off" || !url) return null;
  if (mode === "direct") return url;
  return `/api/thumb?u=${encodeURIComponent(url)}`;
}

/** A thumbnail that fails (too large, or the CDN said no) falls back to the
 *  provider label instead of a broken-image icon. */
function Thumbnail({ src, provider }: { src: string | null; provider: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-24 w-full items-center justify-center bg-[var(--color-surface)] text-xs text-[var(--color-muted)]">
        {provider}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-24 w-full bg-[var(--color-surface)] object-cover"
    />
  );
}

export function RichMedia({ payload, filters }: { payload: Payload; filters: Filters }) {
  const rows: MediaRow[] = payload.topMedia ?? [];
  const mode = payload.mediaThumbnails ?? "proxy";
  const providers = payload.providers ?? [];

  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      backgroundColor: "#171b25",
      borderColor: "#2b3244",
      textStyle: { color: "#e7eaf2", fontSize: 12 },
    },
    grid: { left: 6, right: 46, top: 4, bottom: 4, containLabel: true },
    xAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1b202c" } },
      axisLabel: { color: "#8a93a8", fontSize: 10.5 },
    },
    yAxis: {
      type: "category",
      data: providers.slice(0, 12).map(([name]) => name).reverse(),
      axisLabel: { color: "#8a93a8", fontSize: 10.5, interval: 0, width: 96, overflow: "truncate" },
      axisLine: { lineStyle: { color: "#2b3244" } },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: "100%",
        data: providers.slice(0, 12).map(([, count]) => count).reverse(),
        itemStyle: { color: "#6c8cff" },
      },
    ],
  };

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Panel
          title="Most reposted"
          subtitle={`the same link posted again and again · top ${fmt(rows.length)} by reposts`}
          badge={hasTimeFilter(filters) ? <GlobalOnlyBadge what="Most reposted" /> : null}
        >
          {rows.length === 0 ? (
            <EmptyState>No embeds in the rollups yet.</EmptyState>
          ) : (
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {rows.slice(0, 12).map(([url, provider, kind, title, thumbnail, uses]) => {
                const src = thumbnailSrc(thumbnail || url, mode);
                return (
                  <li key={url} className="overflow-hidden rounded border border-[var(--color-line)]">
                    <a href={url} target="_blank" rel="noreferrer noopener" className="block">
                      <Thumbnail src={src} provider={provider} />
                      <div className="space-y-1 p-2">
                        <p className="truncate text-xs text-[var(--color-text)]" title={label(url, title)}>
                          {label(url, title)}
                        </p>
                        <p className="flex items-baseline justify-between gap-2 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                          <span className="truncate">{provider}</span>
                          <span className="tabular-nums">{fmt(uses)}×</span>
                        </p>
                        <p className="text-[10px] text-[var(--color-muted)]">{kind}</p>
                      </div>
                    </a>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>
      <Panel
        title="Embeds by provider"
        subtitle="Klipy and Tenor both appear because Discord switched"
      >
        {providers.length === 0 ? (
          <EmptyState>No embeds yet.</EmptyState>
        ) : (
          <EChart option={option} height={260} />
        )}
      </Panel>
    </div>
  );
}

export function RichMediaSection({ payload, filters }: { payload: Payload; filters: Filters }) {
  return (
    <section aria-labelledby="sec-media-rich" className="space-y-4">
      <h2 id="sec-media-rich" className="text-base font-semibold text-[var(--color-text)]">
        Rich media
      </h2>
      <RichMedia payload={payload} filters={filters} />
    </section>
  );
}
