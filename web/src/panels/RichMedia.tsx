import { useState } from "react";

import type { EChartsOption } from "echarts";

import type { MediaRow, Payload } from "../api/types";
import { EmptyState, GlobalOnlyBadge, Panel, CARD_COLUMNS } from "../components/Panel";
import { EChart } from "../lib/echart";
import { providerLabel } from "../lib/mediaLabels";
import type { Filters } from "../filters/reducer";
import { MediaTile } from "./MediaTile";
import { MediaView } from "./MediaView";

/**
 * "Most reposted" (§11.1, the rich-media idea).
 *
 * The same GIF gets posted over and over — one Tenor cat 63 times on the
 * reference data — and counting it per author hides that. `payload.topMedia` is
 * one row per URL, so this panel shows the thing itself.
 *
 * Ten items in the card, with "Show top 50" opening the full ranking
 * (§UI/UX rule 5): the card is a taste, the view is the answer, and the view's
 * provider filter asks the server rather than filtering a dozen payload rows.
 * The payload still ships `mediaByProvider`, which nothing reads any more — it
 * is a Python-side key and removing it is a later pass.
 *
 * Thumbnails respect `media.thumbnails`: "proxy" (this server fetches and caches
 * them, so Tenor and Klipy never learn who is reading the chat), "direct" (the
 * browser asks them), or "off" (numbers and providers only).
 */

/** The card's taste of the ranking; the whole thing is one click away. */
const IN_CARD = 10;

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(Math.round(n));

export function RichMedia({ payload }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const items: MediaRow[] = payload.topMedia ?? [];
  const shown = items.slice(0, IN_CARD);
  const mode = payload.mediaThumbnails ?? "proxy";
  const [viewOpen, setViewOpen] = useState(false);
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
    <div className={CARD_COLUMNS}>
      <div>
        <Panel
          title="Most reposted"
          subtitle={
            items.length > IN_CARD
              ? `the same link posted again and again · top ${IN_CARD} of ${fmt(items.length)}`
              : `the same link posted again and again · ${fmt(items.length)} links`
          }
          badge={
            <span className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setViewOpen(true)}
                className="rounded border border-[var(--color-line)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                Show top 50
              </button>
              <GlobalOnlyBadge what="Most reposted" />
            </span>
          }
        >
          {shown.length === 0 ? (
            <EmptyState>No embeds in the rollups yet.</EmptyState>
          ) : (
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {shown.map((row) => (
                <MediaTile key={row[0]} row={row} mode={mode} />
              ))}
            </ol>
          )}
        </Panel>
        {viewOpen ? (
          <MediaView open={viewOpen} onOpenChange={setViewOpen} payload={payload} />
        ) : null}
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
