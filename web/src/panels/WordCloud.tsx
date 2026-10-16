import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useState } from "react";

import type { Payload } from "../api/types";
import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { hasTimeFilter } from "../filters/selectors";
import { EChart } from "../lib/echart";
import { PALETTE } from "../lib/palette";

/**
 * "Word cloud" — the one `echarts-wordcloud` user (§11.1 calls it decorative).
 *
 * Three things keep it honest: it never holds the only copy of a number (the
 * subtitle carries the total), it has no vocabulary to draw when the payload has
 * no words, and the plugin is loaded lazily so a bundle or a browser without it
 * degrades to a sentence rather than a blank panel.
 */

const LIMIT = 120;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Importing `echarts-wordcloud` is what registers the `wordCloud` series type. */
function importWordCloudPlugin(): Promise<unknown> {
  return import("echarts-wordcloud");
}

/**
 * The words the cloud draws. `rollup_word` carries no date dimension, but it does
 * carry a per-author breakdown for 420 of the 500 shipped words, so a restricted
 * author selection is applied where the data allows it.
 */
export function cloudRows(payload: Payload, filters: Filters, limit = LIMIT): [string, number][] {
  const allOn = payload.authors.every((_, index) => filters.active[index] !== false);
  if (allOn) return payload.words.slice(0, limit);

  const rows: [string, number][] = [];
  for (const [word] of payload.words) {
    const byAuthor = payload.wordAuthors[word];
    if (!byAuthor) continue;
    let uses = 0;
    for (const [authorIndex, count] of byAuthor) {
      if (filters.active[authorIndex] !== false) uses += count;
    }
    if (uses > 0) rows.push([word, uses]);
  }
  return rows.sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function WordCloud({
  payload,
  filters,
  loadPlugin = importWordCloudPlugin,
}: {
  payload: Payload;
  filters: Filters;
  /** Test seam: the plugin cannot load in jsdom, and both paths must be covered. */
  loadPlugin?: () => Promise<unknown>;
}) {
  const rows = useMemo(() => cloudRows(payload, filters), [payload, filters]);
  const [plugin, setPlugin] = useState<"loading" | "ready" | "missing">("loading");
  const total = useMemo(() => rows.reduce((sum, [, uses]) => sum + uses, 0), [rows]);

  useEffect(() => {
    if (!rows.length) return;
    let live = true;
    loadPlugin().then(
      () => live && setPlugin("ready"),
      () => live && setPlugin("missing"),
    );
    return () => {
      live = false;
    };
  }, [loadPlugin, rows.length]);

  // `echarts-wordcloud` types itself against echarts 5's module path, so
  // `type: "wordCloud"` is not part of echarts 6's series union and the option is
  // built to the mockup's shape and cast. Everything the plugin registers at
  // runtime — extendSeriesModel, registerLayout — exists in echarts 6.
  const option = useMemo(
    () =>
      ({
        tooltip: {
          backgroundColor: "#171b25",
          borderColor: "#2b3244",
          textStyle: { color: "#e7eaf2", fontSize: 12 },
          formatter: (p: any) => `“${p.name}”<br><b>${fmt(p.value as number)}</b> uses`,
        },
        series: [
          {
            type: "wordCloud",
            shape: "circle",
            left: "center",
            top: "center",
            width: "96%",
            height: "94%",
            sizeRange: [11, 52],
            rotationRange: [-45, 45],
            rotationStep: 15,
            gridSize: 7,
            drawOutOfBound: false,
            textStyle: { fontFamily: "-apple-system, Segoe UI, Inter, sans-serif", fontWeight: 600 },
            emphasis: { textStyle: { color: "#e7eaf2", textShadowBlur: 9, textShadowColor: "#5865f2" } },
            data: rows.map(([word, uses], index) => ({
              name: word,
              value: uses,
              textStyle: { color: PALETTE[index % PALETTE.length] },
            })),
          },
        ],
      }) as unknown as EChartsOption,
    // `plugin` is a dependency on purpose: the option object must be new when the
    // series type finishes registering, or <EChart> never pushes it.
    [rows, plugin],
  );

  return (
    <Panel
      title="Word cloud"
      badge={hasTimeFilter(filters) ? <GlobalOnlyBadge what="The word rollup" /> : undefined}
      subtitle={`top ${fmt(rows.length)} words by frequency · ${fmt(total)} uses shown · no date dimension`}
    >
      {!rows.length ? (
        <EmptyState>No words to plot — the word index above has the same numbers.</EmptyState>
      ) : plugin === "missing" ? (
        <EmptyState>Word cloud unavailable — use the word index above; it has every one of these numbers.</EmptyState>
      ) : plugin === "loading" ? (
        <p className="flex h-[320px] items-center justify-center text-xs text-[var(--color-muted)]">
          Drawing {fmt(rows.length)} words…
        </p>
      ) : (
        <EChart option={option} height={320} />
      )}
    </Panel>
  );
}
