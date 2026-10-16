import * as echarts from "echarts";
import { useEffect, useRef, useState } from "react";
import type { EChartsOption } from "echarts";

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
}: {
  option: EChartsOption;
  height?: number | string;
  onReady?: (chart: echarts.ECharts) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const [label, setLabel] = useState(ariaLabel ?? "chart");

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
    chart.current?.setOption(option, true);
  }, [option]);

  return (
    <div
      ref={container}
      className={className}
      style={{ width: "100%", height: height ?? 260 }}
      role="img"
      aria-label={label}
    />
  );
}
