/**
 * The one place a pie is built, so the honesty rule lives in a single function
 * rather than in each panel (§UI/UX rule 4, "Chart shapes").
 *
 * A pie makes one claim the bar does not: the slices are the whole. Two things
 * follow, and both are enforced here rather than left to a caller:
 *
 * - the tail folds into a single "Other" slice, so a long tail never becomes a
 *   ring of colours nobody can tell apart (§11.5);
 * - the denominator is stated in words (`pieNote`), because a full circle that
 *   quietly covers the payload's top 30 rows is a lie about the total.
 */
import type { EChartsOption } from "echarts";

import { tooltip } from "../lib/chartStyle";
import { fmt } from "../lib/format";
import { swatch, token } from "../lib/palette";

/** Eight named slices + "Other". A ninth colour is already indistinguishable. */
export const MAX_PIE_SLICES = 8;
export const OTHER_SLICE = "Other";
/** A slot past the first eight, so no slice repeats a colour. Read at draw
 * time, so a fork's `--chart-12` reaches the folded tail too. */
export const otherColor = () => swatch(11);

export type ShapeRow = { name: string; value: number };

/** One author's wedge; `index` is the author's palette slot, -1 for the folded tail. */
export type Slice = { name: string; value: number; index: number };

/**
 * §11.5: a doughnut is for a part-of-whole with few categories. Share of voice
 * is a part-of-whole, but a chat can have a dozen authors, so the tail folds
 * into one "Others" slice rather than growing a twelfth indistinguishable
 * wedge. Everything past the fold is still in the total and the tooltip.
 */
export function foldSlices(rows: Slice[], max = 6): Slice[] {
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max - 1);
  const tail = rows.slice(max - 1);
  return [
    ...head,
    { name: "Others", value: tail.reduce((sum, row) => sum + row.value, 0), index: -1 },
  ];
}

/**
 * Sorted desc, the top `max` named, the rest summed into one "Other" slice.
 * Rows with nothing in them are dropped first: a zero slice is a colour with no
 * wedge, and it would take a named slot from a category that has numbers.
 */
export function foldPie(rows: readonly ShapeRow[], max = MAX_PIE_SLICES): ShapeRow[] {
  const ranked = rows
    .filter((row) => row.value > 0)
    .slice()
    .sort((a, b) => b.value - a.value);
  if (ranked.length <= max) return ranked;
  const tail = ranked.slice(max).reduce((sum, row) => sum + row.value, 0);
  return [...ranked.slice(0, max), { name: OTHER_SLICE, value: tail }];
}

/** "top 8 of 12 types + Other" / "4 types" — what the pie's 100% actually is. */
export function pieNote(rows: readonly ShapeRow[], noun: string, max = MAX_PIE_SLICES): string {
  const ranked = rows.filter((row) => row.value > 0);
  if (!ranked.length) return `no ${noun}`;
  if (ranked.length <= max) return ranked.length === 1 ? `1 ${noun.replace(/s$/, "")}` : `${ranked.length} ${noun}`;
  return `top ${max} of ${ranked.length} ${noun} + ${OTHER_SLICE}`;
}

/** A doughnut with a percentage on every slice big enough to carry one. */
export function pieOption(slices: readonly ShapeRow[], unit: string): EChartsOption {
  return {
    tooltip: {
      ...tooltip(),
      formatter: (params: unknown) => {
        const point = params as { name?: string; value?: number; percent?: number };
        const percent = typeof point.percent === "number" ? ` (${point.percent.toFixed(1)}%)` : "";
        return `${point.name ?? ""}<br><b>${fmt(point.value ?? 0)}</b> ${unit}${percent}`;
      },
    },
    legend: {
      type: "scroll",
      bottom: 0,
      itemGap: 11,
      itemWidth: 10,
      itemHeight: 8,
      textStyle: { color: token("--color-muted"), fontSize: 10 },
    },
    series: [
      {
        type: "pie",
        radius: ["46%", "72%"],
        center: ["50%", "43%"],
        avoidLabelOverlap: true,
        padAngle: 1.5,
        itemStyle: { borderColor: token("--chart-heat-edge"), borderWidth: 2 },
        label: {
          color: token("--color-muted"),
          fontSize: 10,
          formatter: (params: unknown) => {
            const percent = (params as { percent?: number }).percent ?? 0;
            return percent >= 4 ? `${percent.toFixed(0)}%` : "";
          },
        },
        labelLine: { lineStyle: { color: token("--chart-guide") } },
        emphasis: { label: { color: token("--color-text"), fontSize: 12, fontWeight: 600 } },
        data: slices.map((slice, index) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: {
            color: slice.name === OTHER_SLICE ? otherColor() : swatch(index),
          },
        })),
      },
    ],
  };
}
