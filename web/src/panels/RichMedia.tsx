import { useState } from "react";

import type { EChartsOption } from "echarts";

import type { Payload } from "../api/types";
import { EmptyState, GlobalOnlyBadge, Panel, CARD_COLUMNS } from "../components/Panel";
import { EChart } from "../lib/echart";
import { providerLabel, kindLabel, postedLabel } from "../lib/mediaLabels";
import type { Filters } from "../filters/reducer";

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

type MediaRow = [string, string, string, string, string, string, number];

const TABS: { id: string; label: string; match?: (row: MediaRow) => boolean }[] = [
  { id: "all", label: "All" },
  { id: "video", label: "Video links", match: ([, , kind]) => kind === "video" || kind === "rich" || kind === "article" },
  { id: "gif", label: "GIFs", match: ([, provider]) => /tenor|klipy/i.test(provider) },
  { id: "twitter", label: "Twitter", match: ([, provider]) => /twitter|fixupx|fixtweet/i.test(provider) },
];

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

/** A playable file, not a page about one: YouTube's `video.url` is its player. */
function isPlayable(url: string): boolean {
  return /\.(mp4|webm|gif)(\?|$)/i.test(url);
}

function thumbnailSrc(url: string, mode: string): string | null {
  if (mode === "off" || !url) return null;
  if (mode === "direct") return url;
  return `/api/thumb?u=${encodeURIComponent(url)}`;
}

/** A thumbnail that fails (too large, or the CDN said no) falls back to the
 *  provider label instead of a broken-image icon. */
function Thumbnail({ src, animated, provider }: {
  src: string | null;
  animated: string | null;
  provider: string;
}) {
  const [failed, setFailed] = useState(false);
  if (animated && isPlayable(animated) && !failed) {
    // A gifv's playable asset is an mp4: it animates (the thumbnail is often a
    // static poster) and it is usually much smaller than the GIF.
    return (
      <video
        src={animated}
        poster={src ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        onError={() => setFailed(true)}
        className="h-24 w-full bg-[var(--color-surface)] object-cover"
      />
    );
  }
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

export function RichMedia({ payload, }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const everything: MediaRow[] = payload.topMedia ?? [];
  const byProvider = payload.mediaByProvider ?? {};
  const mode = payload.mediaThumbnails ?? "proxy";
  const [tab, setTab] = useState("all");
  const active = TABS.find((entry) => entry.id === tab);
  // The payload's ranking is dominated by GIFs, so a tab switches to a ranking
  // that was computed for its own slice rather than filtering twelve rows.
  const perProvider: MediaRow[] = Object.entries(byProvider)
    .filter(([, rows]) => rows.length > 0 && active?.match?.([...rows[0]] as MediaRow))
    .flatMap(([, rows]) => rows as MediaRow[])
    .sort((a, b) => b[6] - a[6])
    .slice(0, 12);
  const rows: MediaRow[] = !active?.match
    ? everything
    : [...perProvider, ...everything.filter(active.match)]
        .filter((row, index, all) => all.findIndex((other) => other[0] === row[0]) === index)
        .sort((a, b) => b[6] - a[6])
        .slice(0, 12);
  // Raw provider totals, with Discord's unnamed bucket split by host: an
  // `cdn.discordapp.com` attachment is somebody's own upload, not a mystery.
  const providers: [string, number][] = Object.values(
    (payload.providers ?? []).reduce<Record<string, [string, number]>>((acc, [name, count]) => {
      const key = providerLabel(name, name);
      acc[key] = [key, (acc[key]?.[1] ?? 0) + count];
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const option: EChartsOption = {
    // (the provider bar chart follows)
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
      // The chart reads raw provider names, which is where the internal
      // 'unprovidenced' sentinel kept leaking to the screen.
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
    <div className={CARD_COLUMNS}>
      <div>
        <Panel
          title="Most reposted"
          subtitle={`the same link posted again and again · ${fmt(rows.length)} shown`}
          badge={
            <span className="flex flex-wrap items-center gap-1">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={tab === entry.id}
                  onClick={() => setTab(entry.id)}
                  className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                    tab === entry.id
                      ? "border-[var(--color-accent)] text-[var(--color-text)]"
                      : "border-[var(--color-line)] text-[var(--color-muted)]"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
              <GlobalOnlyBadge what="Most reposted" />
            </span>
          }
        >
          {rows.length === 0 ? (
            <EmptyState>No embeds in the rollups yet.</EmptyState>
          ) : (
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {rows.slice(0, 12).map(([url, provider, kind, title, thumbnail, animated, uses]) => {
                const src = thumbnailSrc(thumbnail || url, mode);
                const animatedSrc = thumbnailSrc(animated || "", mode);
                const name = providerLabel(provider, url);
                return (
                  <li key={url} className="overflow-hidden rounded border border-[var(--color-line)]">
                    <a href={url} target="_blank" rel="noreferrer noopener" className="block">
                      <Thumbnail src={src} animated={animatedSrc} provider={name} />
                      <div className="space-y-1 p-2">
                        <p className="truncate text-xs text-[var(--color-text)]" title={label(url, title)}>
                          {label(url, title)}
                        </p>
                        <p
                          className="truncate text-[10px] uppercase tracking-wide text-[var(--color-muted)]"
                          title={`${postedLabel(uses)} · ${name} ${kindLabel(kind)}`}
                        >
                          {`${postedLabel(uses)} · ${name} ${kindLabel(kind)}`}
                        </p>
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

export function RichMediaSection({ payload }: { payload: Payload }) {
  return (
    <section aria-labelledby="sec-media-rich" className="space-y-4">
      <h2 id="sec-media-rich" className="text-base font-semibold text-[var(--color-text)]">
        Rich media
      </h2>
      <RichMedia payload={payload} />
    </section>
  );
}
