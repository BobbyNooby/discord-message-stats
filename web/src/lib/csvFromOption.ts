import type { EChartsOption } from "echarts";

import type { CsvRow } from "./csv";

/**
 * The rows behind a chart, read back out of the option that drew it.
 *
 * Every panel here is already a pure function of an aggregate array, and that
 * array is what it hands to ECharts. Reading the table back out of the option
 * means the export is the same numbers as the picture by construction — a panel
 * cannot export something it is not drawing — and no panel has to grow a
 * parallel "and also the csv rows" code path.
 */

type Record_ = Record<string, unknown>;

function asRecord(value: unknown): Record_ | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record_) : null;
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function text(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

/** One cell: a plain number/string, an object's `value`, or an array joined. */
function scalar(value: unknown): string | number {
  if (typeof value === "number" || typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => scalar(item)).join(" | ");
  const record = asRecord(value);
  if (record) {
    if (record.value !== undefined) return scalar(record.value);
    if (record.name !== undefined) return scalar(record.name);
  }
  return "";
}

/** A point's own name: `{name}`, `{name, value}`, or the raw value. */
function pointName(value: unknown, index: number): string {
  const record = asRecord(value);
  if (record?.name !== undefined) return text(record.name, String(index));
  if (record?.value !== undefined && !Array.isArray(record.value)) {
    return text(record.value, String(index));
  }
  return text(value, String(index));
}

function dataOf(series: Record_): unknown[] {
  return asList(series.data);
}

function firstRecord(value: unknown): Record_ | null {
  return asRecord(value) ?? asRecord(asList(value)[0]);
}

function axisData(option: Record_, key: string): unknown[] | null {
  const axis = firstRecord(option[key]);
  return axis && Array.isArray(axis.data) ? axis.data : null;
}

/** The category axis a chart is laid out on, whichever way round it is. */
function categoryAxis(option: Record_): { data: unknown[]; horizontal: boolean } | null {
  for (const [key, horizontal] of [
    ["xAxis", false],
    ["yAxis", true],
    ["angleAxis", false],
  ] as const) {
    const axis = firstRecord(option[key]);
    if (axis?.type === "category" && Array.isArray(axis.data)) {
      return { data: axis.data, horizontal };
    }
  }
  return null;
}

export function csvFromOption(option: EChartsOption): CsvRow[] {
  const record = option as Record_;
  const series = asList(record.series)
    .map(asRecord)
    .filter((entry): entry is Record_ => entry !== null);
  if (series.length === 0) return [];
  const first = series[0];

  // A gauge draws one series per metric, each with a single named point.
  if (first.type === "gauge") {
    return [
      ["metric", "value"],
      ...series.flatMap((entry) =>
        dataOf(entry).map((point) => [pointName(point, 0), scalar(point)]),
      ),
    ];
  }

  // A radar draws one polygon per author across the same traits.
  if (first.type === "radar") {
    const radar = asRecord(record.radar);
    const traits = asList(radar?.indicator).map((indicator) =>
      text(asRecord(indicator)?.name, ""),
    );
    const rows: CsvRow[] = [["author", ...traits]];
    for (const entry of series) {
      const values = asList(asRecord(dataOf(entry)[0])?.value);
      rows.push([text(entry.name, "author"), ...values.map((value) => scalar(value))]);
    }
    return rows;
  }

  // A heatmap is [x index, y index, value] against two category axes.
  if (first.type === "heatmap") {
    const xs = axisData(record, "xAxis");
    const ys = axisData(record, "yAxis");
    const rows: CsvRow[] = [["x", "y", "value"]];
    for (const point of dataOf(first)) {
      const [x, y, value] = asList(point);
      rows.push([
        text(xs?.[Number(x)], String(x)),
        text(ys?.[Number(y)], String(y)),
        scalar(value),
      ]);
    }
    return rows;
  }

  // A scatter of named [x, y] points (Reply balance).
  if (first.type === "scatter") {
    const width = dataOf(first).reduce<number>(
      (widest, point) => Math.max(widest, asList(asRecord(point)?.value).length),
      0,
    );
    const rows: CsvRow[] = [
      ["name", ...Array.from({ length: width }, (_, index) => `value ${index + 1}`)],
    ];
    for (const point of dataOf(first)) {
      rows.push([
        pointName(point, rows.length - 1),
        ...asList(asRecord(point)?.value).map((value) => scalar(value)),
      ]);
    }
    return rows;
  }

  // Named points: a pie, a treemap, a word cloud.
  if (dataOf(first).some((point) => asRecord(point)?.name !== undefined)) {
    const rows: CsvRow[] = [["name", text(first.name, "value")]];
    for (const entry of series) {
      for (const point of dataOf(entry)) {
        rows.push([pointName(point, rows.length - 1), scalar(point)]);
      }
    }
    return rows;
  }

  // Everything else is a category axis with one column per series.
  const axis = categoryAxis(record);
  if (!axis) return [];
  const rows: CsvRow[] = [
    [axis.horizontal ? "name" : "category", ...series.map((entry, index) => text(entry.name, `value ${index + 1}`))],
  ];
  axis.data.forEach((entry, index) => {
    rows.push([text(entry, String(index)), ...series.map((line) => scalar(dataOf(line)[index]))]);
  });
  return rows;
}
