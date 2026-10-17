import type { EChartsOption } from "echarts";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import { swatch } from "../lib/palette";
import { AXIS_TEXT, RADAR_TRAITS, radarData, TOOLTIP } from "./people";
import { usePanelFilters } from "./panelScope";

/**
 * "Author profile" — six traits, each normalised to 100 against the busiest
 * author on that trait. Four of the six come from the filtered cells, so this
 * panel does respond to the time filter; "starts conv" and "vocabulary" are
 * global counts and are read whole.
 */
export function AuthorRadar({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("author-profile", fallbackFilters);
  const radar = radarData(payload, filters);

  if (!radar.top.length) {
    return (
      <Panel title="Author profile">
        <EmptyState>No messages match the active filters — widen the time range, or switch an author back on.</EmptyState>
      </Panel>
    );
  }

  const option: EChartsOption = {
    tooltip: { ...TOOLTIP },
    legend: {
      bottom: 3,
      left: "center",
      itemGap: 9,
      itemWidth: 9,
      itemHeight: 9,
      textStyle: { color: AXIS_TEXT, fontSize: 9.5 },
      data: radar.names,
    },
    radar: {
      center: ["50%", "40%"],
      radius: "56%",
      indicator: RADAR_TRAITS.map((name) => ({ name, max: 100 })),
      axisName: { color: AXIS_TEXT, fontSize: 9.5 },
      splitLine: { lineStyle: { color: "#252c3d" } },
      splitArea: { areaStyle: { color: ["rgba(255,255,255,.012)", "rgba(255,255,255,.03)"] } },
      axisLine: { lineStyle: { color: "#252c3d" } },
    },
    series: radar.top.map((index, position) => ({
      name: radar.names[position],
      type: "radar" as const,
      lineStyle: { width: 1.8, color: swatch(index) },
      itemStyle: { color: swatch(index) },
      areaStyle: { opacity: 0.1, color: swatch(index) },
      symbolSize: 3,
      data: [{ value: radar.values[index] ?? [] }],
    })),
  };

  return (
    <Panel
      title="Author profile"
      subtitle={`top ${radar.top.length} authors by volume · six traits, each normalised to the busiest author`}
    >
      <EChart option={option} height={330} />
    </Panel>
  );
}
