import { useEffect, useMemo, useRef, useState } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import {
  DEFAULT_WEEKS,
  MIN_WEEKS,
  WEEKDAY_LABELS,
  buildWeeks,
  calendarGeometry,
  clampStart,
} from "./calendarWeeks";
import { usePanelFilters } from "./panelScope";

/**
 * Every day, six years — square cells in a window the component owns (§11.3).
 *
 * Deliberately *not* ECharts `dataZoom`: measured, ECharts lays out every
 * category across the fixed grid width and the zoom window then covers only some
 * of them, bunching the cells into a fraction of the panel. Owning the window
 * means `xAxis.data` is only what is visible, so the cells stay square. And no
 * wheel listener: it hijacks page scrolling, which is worse than the
 * inconvenience it saves.
 */
export function Calendar({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("every-day-six-years", fallbackFilters);
  // The window is the component's own (§11.3), and on a phone 60 weeks would be
  // ~5px cells: a grey smear rather than a calendar. The default fits the space
  // until the reader chooses a size themselves.
  const [calSize, setCalSize] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const [calStart, setCalStart] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const weeks = useMemo(() => buildWeeks(payload, filters), [payload, filters]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const columns = calSize ?? Math.max(MIN_WEEKS, Math.min(DEFAULT_WEEKS, Math.floor((width || 900) / 14)));
  const newest = clampStart(weeks.weeks.length - columns, columns, weeks.weeks.length);
  const start = clampStart(calStart || newest, columns, weeks.weeks.length);
  const visible = weeks.weeks.slice(start, start + columns);
  const geometry = calendarGeometry(width || 600, Math.max(MIN_WEEKS, visible.length || columns));

  const data = useMemo(() => {
    const points: [number, number, number][] = [];
    visible.forEach((week, column) => {
      WEEKDAY_LABELS.forEach((_label, dow) => {
        points.push([column, dow, weeks.values.get(`${week}|${dow}`) ?? 0]);
      });
    });
    return points;
  }, [visible, weeks]);

  if (!weeks.weeks.length) {
    return (
      <Panel title="Every day, six years">
        <EmptyState>No days match the current filters.</EmptyState>
      </Panel>
    );
  }

  const peak = Math.max(1, ...data.map((point) => point[2]));
  const option = {
    grid: {
      left: 46,

      right: 12,
      top: 8,
      bottom: 24,
      width: geometry.grid.width,
      height: geometry.grid.height,
    },
    xAxis: { type: "category" as const, data: visible },
    yAxis: {
      type: "category" as const,
      data: WEEKDAY_LABELS,
      // All seven labels, at a size that fits the row height: a narrow window
      // makes the cells small, and 12px text in a 7px row is illegible.
      axisLabel: {
        interval: 0,
        fontSize: Math.max(8, Math.min(12, Math.round(geometry.cell * 0.7))),
      },
    },
    visualMap: {
      min: 0,
      max: peak,
      show: false,
      inRange: { color: ["#141822", "#5865f2"] },
    },
    series: [{ type: "heatmap" as const, data, itemStyle: { borderWidth: 0 } }],
  };

  return (
    <Panel
      title="Every day, six years"
      subtitle={`${visible.length} weeks · ${weeks.total.toLocaleString()} messages visible`}
      badge={
        <div className="flex items-center gap-2 text-xs">
          <button type="button" onClick={() => setCalSize(Math.max(MIN_WEEKS, columns - 20))}>
            −
          </button>
          <span className="tabular-nums">{columns}w</span>
          <button type="button" onClick={() => setCalSize(columns + 20)}>
            +
          </button>
        </div>
      }
    >
      <input
        type="range"
        aria-label="First visible week"
        min={0}
        max={Math.max(0, weeks.weeks.length - columns)}
        value={start}
        onChange={(event) => setCalStart(Number(event.target.value))}
        className="mb-2 w-full"
      />
      <div ref={container} className="w-full">
        <EChart option={option} height={geometry.height} />
      </div>
    </Panel>
  );
}
