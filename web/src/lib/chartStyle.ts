import { token } from "./palette";

/**
 * The chart chrome every card shares — tooltip, axes, gridlines, legend — ported
 * from the mockup so every panel looks like its neighbour.
 *
 * Each piece is a function, not a constant, on purpose: it reads the theme's
 * variables when a card builds its option, so a fork's `theme/tokens.css`
 * reaches every chart. A module-scope constant would freeze the defaults at
 * import time.
 */

/** The dark card a hovered value appears in. */
export function tooltip() {
  return {
    backgroundColor: token("--chart-tooltip-bg"),
    borderColor: token("--color-line"),
    textStyle: { color: token("--color-text"), fontSize: 12 },
  };
}

/** Tick labels, in the muted text colour at the size the card has room for. */
export function axisLabel(fontSize: number) {
  return { color: token("--color-muted"), fontSize };
}

/** The axis line itself. */
export function axisLine() {
  return { lineStyle: { color: token("--color-line") } };
}

/** The quiet gridlines behind a value axis. */
export function splitLine() {
  return { lineStyle: { color: token("--color-surface-2") } };
}

/** A whole axis as most trend cards draw it: muted labels, a line, gridlines, no ticks. */
export function axis() {
  return {
    axisLine: axisLine(),
    axisLabel: axisLabel(11),
    splitLine: splitLine(),
    axisTick: { show: false },
  };
}

/** The scrolling legend under a chart with one series per author. */
export function legend() {
  return {
    type: "scroll" as const,
    bottom: 1,
    itemGap: 11,
    textStyle: { color: token("--color-muted"), fontSize: 10.5 },
    inactiveColor: token("--chart-guide"),
    itemWidth: 10,
    itemHeight: 8,
  };
}
