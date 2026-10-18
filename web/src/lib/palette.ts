/** One palette for swatches and series, so a colour means the same thing
 * everywhere (spec §11.0: charts are pure functions of data and filters —
 * including their colour).
 *
 * The values are the upstream defaults and double as the fallbacks for the CSS
 * variables in `web/src/styles.css`. A fork overrides `--chart-1`…`--chart-12`
 * (and the chart-only tokens below) in `theme/tokens.css`; reading happens at
 * draw time, so the override wins without any component edit. */
export const PALETTE = [
  "#5865f2",
  "#eb459e",
  "#57f287",
  "#fee75c",
  "#00b0f4",
  "#f57731",
  "#9b59b6",
  "#1abc9c",
  "#e91e63",
  "#8bc34a",
  "#ff9800",
  "#607d8b",
];

/** Chart-only colours that are not one of the twelve series slots. The values
 * mirror the declarations in `web/src/styles.css`. */
export const CHART_DEFAULTS = {
  peak: "#c9cdfc",
  heat: ["#141a2e", "#28386e", "#4155c9", "#7b86f5", "#c3c8fb"],
  heatEdge: "#11141c",
  tooltipBg: "#171b25",
  axisDim: "#5b6478",
} as const;

/** The chrome tokens a chart draws with, named as the variables they read. */
const CHROME_DEFAULTS = {
  "--color-muted": "#8a93a8",
  "--color-line": "#2b3244",
  "--color-surface": "#141822",
  "--color-surface-2": "#1b202c",
  "--color-text": "#e7eaf2",
} as const;

export type ChartChrome = keyof typeof CHROME_DEFAULTS;

/**
 * One CSS variable off the document root, with its upstream default when the
 * browser cannot answer. jsdom returns "" for every custom property, so a unit
 * test always sees the fallback; the real cascade is a browser proof.
 */
function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** A series colour by slot, wrapping like the old array index did. */
export function swatch(index: number): string {
  const slot = index % PALETTE.length;
  return cssVar(`--chart-${slot + 1}`, PALETTE[slot]);
}

/** The highlight used for a peak bar and for the word index's cursor row. */
export function chartPeak(): string {
  return cssVar("--chart-peak", CHART_DEFAULTS.peak);
}

/** The heat ramp, low to high, read as five variables. */
export function chartHeat(): string[] {
  return CHART_DEFAULTS.heat.map((fallback, index) =>
    cssVar(`--chart-heat-${index + 1}`, fallback),
  );
}

export function chartHeatEdge(): string {
  return cssVar("--chart-heat-edge", CHART_DEFAULTS.heatEdge);
}

export function chartTooltipBg(): string {
  return cssVar("--chart-tooltip-bg", CHART_DEFAULTS.tooltipBg);
}

export function chartAxisDim(): string {
  return cssVar("--chart-axis-dim", CHART_DEFAULTS.axisDim);
}

/** A theme chrome colour a chart draws with, e.g. `token("--color-muted")`. */
export function token(name: ChartChrome): string {
  return cssVar(name, CHROME_DEFAULTS[name]);
}
