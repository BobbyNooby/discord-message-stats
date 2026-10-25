import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useState } from "react";

import type { Payload } from "../../api/types";
import { EmptyState, Panel } from "../../components/Panel";
import type { Filters } from "../../app/reducer";
import { tooltip } from "../../charts/style";
import { EChart } from "../../charts/echart";
import { fmt } from "../../lib/format";
import { swatch, token } from "../../charts/palette";
import { periodNote, periodPrefix, useWordView } from "../../selectors/wordPeriod";
import { cloudRows } from "../../selectors/words";
import { usePanelFilters } from "../panelScope";

/**
 * "Word cloud" — the one `echarts-wordcloud` user (§11.1 calls it decorative).
 *
 * Three things keep it honest: it never holds the only copy of a number (the
 * subtitle carries the total), it has no vocabulary to draw when the payload has
 * no words, and the plugin is loaded lazily so a bundle or a browser without it
 * degrades to a sentence rather than a blank panel.
 */

/** Importing `echarts-wordcloud` is what registers the `wordCloud` series type. */
function importWordCloudPlugin(): Promise<unknown> {
  return import("echarts-wordcloud");
}

export function WordCloud({
  payload: full,
  filters: fallbackFilters,
  loadPlugin = importWordCloudPlugin,
}: { panelId?: string;
  payload: Payload;
  filters?: Filters;
  /** Test seam: the plugin cannot load in jsdom, and both paths must be covered. */
  loadPlugin?: () => Promise<unknown>;
}) {
  const filters = usePanelFilters("word-cloud", fallbackFilters);
  const view = useWordView(full, filters);
  const payload = view.payload;
  const note = periodNote(view);
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
          ...tooltip(),
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
            emphasis: { textStyle: { color: token("--color-text"), textShadowBlur: 9, textShadowColor: swatch(0) } },
            data: rows.map(([word, uses], index) => ({
              name: word,
              value: uses,
              textStyle: { color: swatch(index) },
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
      subtitle={`${periodPrefix(view)}top ${fmt(rows.length)} words by frequency · ${fmt(total)} uses shown`}
    >
      {note ? (
        <EmptyState>{note}</EmptyState>
      ) : !rows.length ? (
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
