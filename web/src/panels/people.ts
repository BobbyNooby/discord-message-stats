/**
 * The People section's aggregation and option building, kept out of the
 * components so the numbers can be tested without a DOM (§11.2: every panel is
 * a pure function of `(payload, filters)`).
 *
 * Four of the rollups behind these panels — `rollup_reply`, `rollup_response`,
 * `rollup_starter`, `rollup_edit_speed` — have no date column. They are read
 * through `activeEdges`/`globalTotals`, which honour the author filter and
 * deliberately ignore the time filter, and the panels that use them wear a
 * `<GlobalOnlyBadge>` so a filtered page never shows an unfiltered number
 * without saying so.
 */
import type { EChartsOption } from "echarts";

import {
  C_AUTHOR,
  C_CHARS,
  C_DAY,
  C_EDITS,
  C_MEDIA,
  C_MSGS,
  C_REPLIES,
  type Cell,
  type Payload,
} from "../api/types";
import type { Filters } from "../filters/reducer";
import { bucketOf, selectAuthors, selectVisibleCells } from "../filters/selectors";
import { swatch } from "../lib/palette";

/* ---------- formatting: the mockup's `fmt`, `kfmt` and `dur` ---------- */

export function fmt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function kfmt(value: number): string {
  const n = Math.round(value);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function dur(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 90) return `${seconds.toFixed(0)}s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/* ---------- shared chart styling ---------- */

export const AXIS_TEXT = "#8a93a8";
export const AXIS_LINE = "#2b3244";
export const SPLIT_LINE = "#1b202c";
export const TOOLTIP = {
  backgroundColor: "#171b25",
  borderColor: "#2b3244",
  textStyle: { color: "#e7eaf2", fontSize: 12 },
};

export type Row = { index: number; name: string; value: number; n: number };

/** An author's display name, standing in for the index if a stale payload names one we do not have. */
export function authorName(payload: Payload, index: number): string {
  return payload.authors[index]?.name ?? `#${index}`;
}

/* ---------- the global-only reads ---------- */

/** Cells for the active authors, ignoring the time filter. */
export function selectGlobalCells(payload: Payload, filters: Filters): Cell[] {
  const active = filters.active;
  return payload.cells.filter((cell) => active[cell[C_AUTHOR]] !== false);
}

export type CellTotals = { msgs: number; chars: number; media: number; replies: number; edits: number };

const ZERO_TOTALS: CellTotals = { msgs: 0, chars: 0, media: 0, replies: 0, edits: 0 };

/** Per-author totals that do not move when the time filter does. */
export function globalTotals(payload: Payload, filters: Filters): CellTotals[] {
  const totals = payload.authors.map(() => ({ ...ZERO_TOTALS }));
  for (const cell of selectGlobalCells(payload, filters)) {
    const total = totals[cell[C_AUTHOR]];
    if (!total) continue;
    total.msgs += cell[C_MSGS];
    total.chars += cell[C_CHARS];
    total.media += cell[C_MEDIA];
    total.replies += cell[C_REPLIES];
    total.edits += cell[C_EDITS];
  }
  return totals;
}

/** `rollup_reply` rows with both ends still switched on. */
export function activeEdges(payload: Payload, filters: Filters): [number, number, number][] {
  const active = filters.active;
  return payload.edges.filter(
    (edge) => active[edge[0]] !== false && active[edge[1]] !== false,
  );
}

/* ---------- who talks the most ---------- */

/** Which of an author's totals a ranking card draws. The metric is a property
 *  of the card now, not a global switch: messages and characters are separate
 *  panels (§UI/UX — no invisible global reordering). */
export type LeaderMetric = "msgs" | "chars";

export function leaderLabel(metric: LeaderMetric): string {
  return metric === "chars" ? "characters" : "messages";
}

/** `rollup_activity` cells, so this one *does* honour the time filter (§11.1). */
export function leaderRows(payload: Payload, filters: Filters, metric: LeaderMetric = "msgs"): Row[] {
  const totals = selectAuthors(payload, filters);
  return totals
    .map((author, index) => ({
      index,
      name: author.name,
      value: metric === "chars" ? author.chars : author.msgs,
      n: author.msgs,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}

/* ---------- reply matrix ---------- */

export type Matrix = {
  /** Visible authors, in payload order, one axis entry each. */
  names: string[];
  /** `[column, row, replies]`, both axes positions within `names`. */
  data: [number, number, number][];
  k: number;
  total: number;
};

/**
 * Built from the *visible* authors, and heatmap x/y are positions within that
 * list rather than absolute author indices — otherwise switching one author off
 * would shift every cell.
 */
export function matrixData(payload: Payload, filters: Filters): Matrix {
  const visible: number[] = [];
  const position = new Map<number, number>();
  payload.authors.forEach((_author, index) => {
    if (filters.active[index] === false) return;
    position.set(index, visible.length);
    visible.push(index);
  });
  const k = visible.length;
  const grid = visible.map(() => new Array<number>(k).fill(0));
  let total = 0;
  for (const [from, to, msgs] of activeEdges(payload, filters)) {
    const row = position.get(from);
    const column = position.get(to);
    if (row === undefined || column === undefined) continue;
    grid[row][column] += msgs;
    total += msgs;
  }
  const data: [number, number, number][] = [];
  for (let row = 0; row < k; row++) {
    for (let column = 0; column < k; column++) data.push([column, row, grid[row][column]]);
  }
  return { names: visible.map((index) => authorName(payload, index)), data, k, total };
}

/* ---------- reply balance ---------- */

export type Balance = { sent: number[]; received: number[]; total: number };

export function sendRecv(payload: Payload, filters: Filters): Balance {
  const sent = payload.authors.map(() => 0);
  const received = payload.authors.map(() => 0);
  let total = 0;
  for (const [from, to, msgs] of activeEdges(payload, filters)) {
    if (sent[to] === undefined || received[from] === undefined) continue;
    sent[to] += msgs;
    received[from] += msgs;
    total += msgs;
  }
  return { sent, received, total };
}

/* ---------- how fast people reply / who starts ---------- */

export function responseRows(payload: Payload, filters: Filters): Row[] {
  return payload.response
    .filter(([index]) => filters.active[index] !== false)
    .map(([index, seconds, replies]) => ({
      index,
      name: authorName(payload, index),
      value: seconds,
      n: replies,
    }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value);
}

export function starterRows(payload: Payload, filters: Filters): Row[] {
  return payload.starters
    .filter(([index]) => filters.active[index] !== false)
    .map(([index, count]) => ({
      index,
      name: authorName(payload, index),
      value: count,
      n: count,
    }))
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value);
}

/** Weighted by the row's own count, and zero when nothing has been counted. */
export function weightedAverage(rows: Row[]): number {
  let weight = 0;
  let total = 0;
  for (const row of rows) {
    total += row.value * row.n;
    weight += row.n;
  }
  return weight ? total / weight : 0;
}

/* ---------- author radar ---------- */

export const RADAR_TRAITS = [
  "volume",
  "avg length",
  "reply rate",
  "media rate",
  "starts conv",
  "vocabulary",
] as const;

export type RadarData = {
  names: string[];
  /** Every author's trait value, indexed by author. */
  values: number[][];
  /** The top six by filtered volume, in descending order. */
  top: number[];
};

/**
 * Six traits, each normalised to 100 against the busiest author on that trait so
 * messages, characters and seconds can share one axis. Volume, length, reply rate
 * and media rate come from the filtered cells; "starts conv" and "vocabulary"
 * have no date dimension and are read whole.
 */
export function radarData(payload: Payload, filters: Filters): RadarData {
  const totals = selectAuthors(payload, filters);
  const starters = new Map(payload.starters.map(([index, count]) => [index, count]));
  const traits = [
    (index: number) => totals[index]?.msgs ?? 0,
    (index: number) => (totals[index]?.msgs ? totals[index].chars / totals[index].msgs : 0),
    (index: number) => (totals[index]?.msgs ? totals[index].replies / totals[index].msgs : 0),
    (index: number) => (totals[index]?.msgs ? totals[index].media / totals[index].msgs : 0),
    (index: number) => starters.get(index) ?? 0,
    (index: number) => payload.authorDistinct[index] ?? 0,
  ];
  const indexes = payload.authors.map((_author, index) => index);
  const maxes = traits.map(
    (trait) => Math.max(0, ...indexes.map((index) => trait(index))) || 1,
  );
  const values = indexes.map((index) =>
    traits.map((trait, dimension) =>
      Number(((100 * trait(index)) / maxes[dimension]).toFixed(1)),
    ),
  );
  const top = indexes
    .filter((index) => filters.active[index] !== false && (totals[index]?.msgs ?? 0) > 0)
    .sort((a, b) => (totals[b]?.msgs ?? 0) - (totals[a]?.msgs ?? 0))
    .slice(0, 6);
  return { names: top.map((index) => authorName(payload, index)), values, top };
}

/* ---------- volume by author and year ---------- */

export type TreemapNode = { index: number; name: string; total: number; years: [string, number][] };

export function treemapData(payload: Payload, filters: Filters): TreemapNode[] {
  const perAuthor = new Map<number, Map<string, number>>();
  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (!day) continue;
    const author = perAuthor.get(cell[C_AUTHOR]) ?? new Map<string, number>();
    const year = day.slice(0, 4);
    author.set(year, (author.get(year) ?? 0) + cell[C_MSGS]);
    perAuthor.set(cell[C_AUTHOR], author);
  }
  return [...perAuthor.entries()]
    .map(([index, years]) => ({
      index,
      name: authorName(payload, index),
      total: [...years.values()].reduce((sum, value) => sum + value, 0),
      years: [...years.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }))
    .filter((node) => node.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** Lighten a swatch for a nested treemap tile — the mockup's `tint`. */
export function tint(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

/* ---------- burstiness ---------- */

export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

export type Burst = { index: number; name: string; days: number[]; box: [number, number, number, number, number] };

export function burstiness(payload: Payload, filters: Filters): Burst[] {
  const perDay = payload.authors.map(() => [] as number[]);
  for (const cell of selectVisibleCells(payload, filters)) {
    const days = perDay[cell[C_AUTHOR]];
    if (!days) continue;
    if (cell[C_MSGS] > 0) days.push(cell[C_MSGS]);
  }
  return payload.authors
    .map((author, index) => {
      const days = perDay[index];
      if (!days.length) return null;
      const sorted = [...days].sort((a, b) => a - b);
      const box: [number, number, number, number, number] = [
        quantile(sorted, 0.05),
        quantile(sorted, 0.25),
        quantile(sorted, 0.5),
        quantile(sorted, 0.75),
        quantile(sorted, 0.95),
      ];
      return { index, name: author.name, days: sorted, box };
    })
    .filter((burst): burst is Burst => burst !== null);
}

/* ---------- who proofreads ---------- */

export type EditMetric = "rate" | "speed";

export function editRateRows(payload: Payload, filters: Filters, metric: EditMetric): Row[] {
  if (metric === "speed") {
    return payload.editSpeed
      .filter(([index]) => filters.active[index] !== false)
      .map(([index, seconds, edits]) => ({
        index,
        name: authorName(payload, index),
        value: seconds,
        n: edits,
      }))
      .filter((row) => Number.isFinite(row.value))
      .sort((a, b) => b.value - a.value);
  }
  return selectAuthors(payload, filters)
    .map((author, index) => ({
      index,
      name: author.name,
      value: author.msgs ? (100 * author.edits) / author.msgs : 0,
      n: author.edits,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}

export type EditTrend = { order: string[]; pct: number[]; overall: number; messages: number };

/** Edits as a share of messages per bucket — cells, so the time filter applies. */
export function editTrend(payload: Payload, filters: Filters): EditTrend {
  const order: string[] = [];
  const buckets = new Map<string, { msgs: number; edits: number }>();
  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (!day) continue;
    const key = bucketOf(day, filters.bucket);
    const bucket = buckets.get(key) ?? { msgs: 0, edits: 0 };
    if (!buckets.has(key)) order.push(key);
    bucket.msgs += cell[C_MSGS];
    bucket.edits += cell[C_EDITS];
    buckets.set(key, bucket);
  }
  order.sort();
  const pct = order.map((key) => {
    const bucket = buckets.get(key);
    return bucket && bucket.msgs ? Number(((100 * bucket.edits) / bucket.msgs).toFixed(2)) : 0;
  });
  const messages = order.reduce((sum, key) => sum + (buckets.get(key)?.msgs ?? 0), 0);
  const edits = order.reduce((sum, key) => sum + (buckets.get(key)?.edits ?? 0), 0);
  return {
    order,
    pct,
    overall: messages ? Number(((100 * edits) / messages).toFixed(2)) : 0,
    messages,
  };
}

/* ---------- the shared horizontal bar ---------- */

export type BarOptions = {
  axis?: (value: number) => string;
  label?: (row: Row) => string;
  tooltip?: (row: Row) => string;
};

/** The mockup's `hbar`: sorted shortest-first so the longest bar reads top. */
export function hbarOption(rows: Row[], options: BarOptions = {}): EChartsOption {
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  const axis = options.axis ?? kfmt;
  const label = options.label ?? ((row: Row) => axis(row.value));
  return {
    tooltip: {
      ...TOOLTIP,
      formatter: (params: any) => {
        const row = sorted[params.dataIndex];
        return options.tooltip ? options.tooltip(row) : `${row.name}<br><b>${axis(row.value)}</b>`;
      },
    },
    grid: { left: 6, right: 56, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { color: AXIS_TEXT, fontSize: 10.5, formatter: (value: number) => axis(value) },
      splitLine: { lineStyle: { color: SPLIT_LINE } },
    },
    yAxis: {
      type: "category",
      data: sorted.map((row) => row.name),
      axisLabel: { color: AXIS_TEXT, fontSize: 10.5 },
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: "62%",
        data: sorted.map((row) => ({
          value: row.value,
          itemStyle: { color: swatch(row.index), borderRadius: [0, 4, 4, 0] },
        })),
        label: {
          show: true,
          position: "right",
          color: AXIS_TEXT,
          fontSize: 10,
          formatter: (params: any) => label(sorted[params.dataIndex]),
        },
      },
    ],
  };
}
