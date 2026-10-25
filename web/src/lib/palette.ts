/** One palette for swatches and series, so a colour means the same thing
 * everywhere (spec §11.0: charts are pure functions of data and filters —
 * including their colour).
 *
 * The values are the upstream defaults and double as the fallbacks for the CSS
 * variables in `web/src/styles.css`. A fork overrides `--chart-1`…`--chart-12`
 * (and every other token below) in `theme/tokens.css`; reading happens at draw
 * time, so the override wins without any component edit. */
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

/**
 * Every other colour a chart draws with, named as the variable it reads. The
 * values mirror the declarations in `web/src/styles.css`, which is where a
 * chart colour is defined; nothing in a panel spells a colour out.
 */
export const THEME_DEFAULTS = {
  // The base colours the page itself uses.
  "--color-ink": "#0b0e14",
  "--color-surface": "#141822",
  "--color-surface-2": "#1b202c",
  "--color-line": "#2b3244",
  "--color-text": "#e7eaf2",
  "--color-muted": "#8a93a8",
  // Chart-only colours.
  "--chart-peak": "#c9cdfc",
  "--chart-heat-1": "#141a2e",
  "--chart-heat-2": "#28386e",
  "--chart-heat-3": "#4155c9",
  "--chart-heat-4": "#7b86f5",
  "--chart-heat-5": "#c3c8fb",
  "--chart-heat-edge": "#11141c",
  "--chart-tooltip-bg": "#171b25",
  "--chart-axis-dim": "#5b6478",
  "--chart-guide": "#3a4257",
  "--chart-radar-line": "#252c3d",
  "--chart-radar-band-1": "rgba(255,255,255,.012)",
  "--chart-radar-band-2": "rgba(255,255,255,.03)",
  "--chart-matrix-1": "#1c2542",
  "--chart-matrix-2": "#2a3a78",
  "--chart-matrix-3": "#3c56c4",
  "--chart-matrix-4": "#7180f0",
  "--chart-matrix-5": "#c3c8fb",
  "--chart-lift-1": "#161c2e",
  "--chart-lift-2": "#2a3a78",
  "--chart-lift-3": "#7180f0",
  "--chart-lift-4": "#c9cdfc",
  "--chart-lift-5": "#eb459e",
  "--chart-box-fill": "rgba(88,101,242,.22)",
  "--chart-box-line": "#7180f0",
  "--chart-box-emphasis": "#c3c8fb",
  "--chart-outlier": "rgba(235,69,158,.5)",
  "--chart-link": "#4a5570",
  "--chart-link-emphasis": "#8ea1ff",
  "--chart-provider": "#6c8cff",
  "--chart-remainder": "#2a3145",
  "--chart-gauge-track": "#1c2230",
} as const;

export type ThemeToken = keyof typeof THEME_DEFAULTS;

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

/** A theme colour a chart draws with, e.g. `token("--color-muted")`. */
export function token(name: ThemeToken): string {
  return cssVar(name, THEME_DEFAULTS[name]);
}

/** The numbered steps of one colour ramp, low to high: `ramp("--chart-heat")`. */
export function ramp(name: "--chart-heat" | "--chart-matrix" | "--chart-lift"): string[] {
  return [1, 2, 3, 4, 5].map((step) => token(`${name}-${step}` as ThemeToken));
}

/** Lighten a swatch for a nested treemap tile — the mockup's `tint`. */
export function tint(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}
