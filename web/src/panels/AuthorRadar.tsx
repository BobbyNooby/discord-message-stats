import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../app/reducer";
import { tooltip } from "../charts/style";
import { EChart } from "../charts/echart";
import { EMPTY_FILTER } from "../lib/empty";
import { swatch, token } from "../charts/palette";
import { RADAR_TRAITS, radarData, type RadarData } from "../selectors/people";
import { usePanelFilters } from "./panelScope";

function radarOption(radar: RadarData): EChartsOption {
  return {
    tooltip: tooltip(),
    legend: {
      bottom: 3,
      left: "center",
      itemGap: 9,
      itemWidth: 9,
      itemHeight: 9,
      textStyle: { color: token("--color-muted"), fontSize: 9.5 },
      data: radar.names,
    },
    radar: {
      center: ["50%", "40%"],
      radius: "56%",
      indicator: RADAR_TRAITS.map((name) => ({ name, max: 100 })),
      axisName: { color: token("--color-muted"), fontSize: 9.5 },
      splitLine: { lineStyle: { color: token("--chart-radar-line") } },
      splitArea: { areaStyle: { color: [token("--chart-radar-band-1"), token("--chart-radar-band-2")] } },
      axisLine: { lineStyle: { color: token("--chart-radar-line") } },
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
}

/**
 * "Author profile" — six traits, each normalised to 100 against the busiest
 * author on that trait. Four of the six come from the filtered cells, so this
 * panel does respond to the time filter; "starts conv" and "vocabulary" are
 * global counts and are read whole.
 */
export function AuthorRadar({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("author-profile", fallbackFilters);
  const radar = useMemo(() => radarData(payload, filters), [payload, filters]);
  const option = useMemo(() => radarOption(radar), [radar]);

  if (!radar.top.length) {
    return (
      <Panel title="Author profile">
        <EmptyState>{EMPTY_FILTER}</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title="Author profile"
      subtitle={`top ${radar.top.length} authors by volume · six traits, each normalised to the busiest author`}
    >
      <EChart option={option} height={330} />
    </Panel>
  );
}
