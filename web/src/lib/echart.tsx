import * as echarts from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EChartsOption } from "echarts";

import { usePanelCsv } from "../components/panelCsv";
import { csvFromOption } from "./csvFromOption";
import { useReducedMotion } from "./motion";

/**
 * The one component here that wraps a library rather than encoding an idea.
 *
 * ECharts is imperative and React is not, so the three rules this enforces are
 * the three that bite: initialise exactly once per container, push option
 * changes through `setOption` with `notMerge` so a dropped series really
 * disappears, and dispose on unmount or the instance leaks its canvas and its
 * resize listener. A ResizeObserver keeps it sized when the sidebar collapses
 * or the window changes.
 *
 * The canvas is a picture of the panel it sits in, so `role="img"` gets a name
 * from that panel's heading — a chart a screen reader can only announce as
 * "image" is a chart nobody can tell apart from its neighbours.
 */
export function EChart({
  option,
  height,
  onReady,
  className,
  "aria-label": ariaLabel,
  exportsCsv = true,
}: {
  option: EChartsOption;
  height?: number | string;
  onReady?: (chart: echarts.ECharts) => void;
  className?: string;
  "aria-label"?: string;
  /**
   * False for a secondary chart in a card that already has one: the card's
   * export takes the last chart to register, so a second chart would silently
   * replace the numbers the card is named after.
   */
  exportsCsv?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const [label, setLabel] = useState(ariaLabel ?? "chart");
  // A reader who asked for less motion gets the finished picture, not the
  // animation that draws it. ECharts animates by default, so this has to be
  // said explicitly rather than left to the browser's CSS.
  const reduced = useReducedMotion();
  const drawn = useMemo(
    () => (reduced ? { ...option, animation: false } : option),
    [option, reduced],
  );
  // The card around this chart offers "Export as CSV" from the same numbers the
  // picture was made of, so a panel cannot export something it is not drawing.
  const register = usePanelCsv();
  const rows = useMemo(() => csvFromOption(option), [option]);
  useEffect(() => {
    if (exportsCsv) register(rows);
  }, [register, rows, exportsCsv]);
  // A chart that unmounts (an empty filter) must take its rows with it, or the
  // card would offer to export numbers it is no longer showing. Depends only on
  // the stable `register`, so this cleanup runs on unmount and not before every
  // option change.
  useEffect(() => () => {
    if (exportsCsv) register([]);
  }, [register, exportsCsv]);

  useEffect(() => {
    // The heading is only reachable once the node is in the document, so this
    // runs on mount rather than during render.
    const heading = container.current?.closest("section")?.querySelector("h2")?.textContent;
    setLabel(heading?.trim() || ariaLabel || "chart");
  }, [ariaLabel]);

  useEffect(() => {
    if (!container.current) return;
    const instance = echarts.init(container.current, "dark", { renderer: "canvas" });
    chart.current = instance;
    ready.current?.(instance);

    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(drawn, true);
  }, [drawn]);

  return (
    <div
      ref={container}
      className={className}
      style={{ width: "100%", height: height ?? 260 }}
      role="img"
      aria-label={label}
      // How many points were actually drawn. A canvas cannot be read back, and
      // a pie's honesty rule is a statement about that count (eight slices plus
      // "Other"), so it sits on the element a browser test can see.
      data-points={pointCount(option)}
    />
  );
}

/** The drawn length of the first series, which is the one every panel fills. */
function pointCount(option: EChartsOption): number | undefined {
  const series = Array.isArray(option.series) ? option.series[0] : option.series;
  const data = series && "data" in series ? series.data : undefined;
  return Array.isArray(data) ? data.length : undefined;
}
