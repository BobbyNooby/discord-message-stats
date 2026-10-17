import type { ECharts, EChartsOption } from "echarts";
import { useCallback, useMemo, useRef, useState } from "react";

import { useWords } from "../api/queries";
import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { usePanelFilters } from "./panelScope";

/**
 * "Word index" — the mockup's `drawWords` plus the search box.
 *
 * The 500-word slice in the payload is searchable in the browser, so typing
 * never touches the network (§9.1). The full server-side index is 54,570 words,
 * so a query the slice cannot answer falls back to `useWords` — and only then.
 * That endpoint answers for the exact word rather than a list of matches, so its
 * per-author breakdown is shown in place of the bars.
 */

/** How many bars the panel has room for, as in the mockup. */
const INDEX_ROWS = 22;

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(Math.round(n));
const kfmt = (n: number) => {
  const rounded = Math.round(n);
  if (rounded >= 1e6) return `${(rounded / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (rounded >= 1e3) return `${(rounded / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return String(rounded);
};

export type WordIndexProps = {
  /** The embedded slice, `payload.words`. */
  words: [string, number][];
  selected: string | null;
  onSelect: (word: string) => void;
};

export function WordIndex({ words, selected, onSelect }: WordIndexProps) {
  // The card declares `word` and `author` in the registry, so it reads the
  // filters it is actually under rather than assuming the global ones.
  const filters = usePanelFilters("word-index");
  const shownWord = filters.word ?? selected;
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const needle = query.trim().toLowerCase();

  const matches = useMemo(
    () => (needle ? words.filter(([word]) => word.includes(needle)) : words),
    [words, needle],
  );
  const shown = useMemo(() => matches.slice(0, INDEX_ROWS), [matches]);

  // The one place a word search may leave the browser: nothing in the slice matched.
  const needsServer = needle.length > 0 && matches.length === 0;
  const remote = useWords(query, needsServer);
  const found = needsServer ? remote.data : undefined;

  const cursor = Math.min(highlight, Math.max(shown.length - 1, 0));
  const tag = needle
    ? matches.length
      ? `${fmt(matches.length)} ${matches.length === 1 ? "match" : "matches"}`
      : remote.isFetching
        ? "searching the full index…"
        : found
          ? `${fmt(found.total)} uses in the full index`
          : "not in the full index"
    : `top ${fmt(shown.length)} of ${fmt(words.length)} indexed`;

  const option = useMemo<EChartsOption>(
    () => {
      const rows = shown.slice().reverse();
      return {
        tooltip: {
          backgroundColor: "#171b25",
          borderColor: "#2b3244",
          textStyle: { color: "#e7eaf2", fontSize: 12 },
          formatter: (p: any) => `“${p.name}”<br><b>${fmt(p.value)}</b> uses — click to see who`,
        },
        grid: { left: 6, right: 46, top: 4, bottom: 4, containLabel: true },
        xAxis: {
          type: "value",
          splitLine: { lineStyle: { color: "#1b202c" } },
          axisLabel: { color: "#8a93a8", fontSize: 10.5, formatter: (v: number) => kfmt(v) },
        },
        yAxis: {
          type: "category",
          data: rows.map(([word]) => word),
          // One label per bar, always: `interval: "auto"` hides every
          // other word, which reads as a broken axis.
          axisLabel: {
            color: "#8a93a8",
            fontSize: 10.5,
            interval: 0,
            width: 74,
            overflow: "truncate",
            // `triggerEvent` did not make axis labels clickable in ECharts 6
            // (verified: three label clicks, no event), so the bar is the target
            // and it fills the row.
            triggerEvent: true,
          },
          axisLine: { lineStyle: { color: "#2b3244" } },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            barWidth: "100%",   // a thumb needs the whole row, not 66% of it
            data: rows.map(([word, uses]) => ({
              value: uses,
              itemStyle: {
                color: word === shownWord ? "#eb459e" : word === shown[cursor]?.[0] ? "#c9cdfc" : "#5865f2",
                borderRadius: [0, 4, 4, 0] as [number, number, number, number],
              },
            })),
            label: {
              show: true,
              position: "right",
              color: "#8a93a8",
              fontSize: 10,
              formatter: (p: any) => kfmt(p.value as number),
            },
          },
        ],
      };
    },
    [shown, shownWord, cursor],
  );

  // ECharts is imperative: wire the click once, and always to the current
  // callback. The word is read from the same array that built the axis, by
  // index — `params.name` is not reliably populated for bar data passed as
  // objects, which is how clicking a bar silently did nothing.
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const axisWords = useRef<string[]>([]);
  axisWords.current = shown
    .slice()
    .reverse()
    .map(([word]) => word);
  const wired = useRef(false);
  const handleReady = useCallback((chart: ECharts) => {
    if (wired.current) return;
    wired.current = true;
    chart.on("click", (params: unknown) => {
      const { componentType, dataIndex, name, value } = params as {
        componentType?: string;
        dataIndex?: number;
        name?: string;
        value?: string | number;
      };
      if (componentType === "yAxis") {
        // The axis label itself was clicked, so the word is the label's value.
        if (typeof value === "string") pick.current(value);
        return;
      }
      const word = (dataIndex !== undefined ? axisWords.current[dataIndex] : undefined) ?? name;
      if (word) pick.current(word);
    });
  }, []);

  const selectHighlighted = () => {
    const local = shown[cursor];
    if (local) pick.current(local[0]);
  };

  return (
    <Panel
      title="Word index"
      subtitle="type to search the embedded index · press Enter or click a bar for who says it"
      badge={
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{tag}</span>
      }
    >
      <input
        type="search"
        aria-label="Search words"
        autoComplete="off"
        placeholder="search any word… try play, car, gpu, exam"
        className="mb-2 w-full rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-muted)]"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((h) => Math.min(h + 1, Math.max(shown.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            selectHighlighted();
          } else if (event.key === "Escape") {
            setQuery("");
            setHighlight(0);
          }
        }}
      />

      {shown.length ? (
        <EChart option={option} height={288} onReady={handleReady} className="cursor-pointer" />
      ) : !needle ? (
        <EmptyState>No indexed words in this payload.</EmptyState>
      ) : remote.isFetching ? (
        <EmptyState>Searching the full word index…</EmptyState>
      ) : found && found.total > 0 ? (
        // Outside the shipped 500: the server answers for the exact word, and the
        // breakdown is shown here because the embedded slice has no row for it.
        <div>
          <p className="mb-2 text-xs text-[var(--color-muted)]">
            “{found.word}” is outside the embedded slice · {fmt(found.total)} uses in the full index
          </p>
          <ul aria-label={`Who says “${found.word}”`} className="max-h-[248px] overflow-auto">
            {found.authors.map((author) => (
              <li
                key={author.id}
                className="flex items-baseline justify-between gap-2 border-b border-[var(--color-line)] px-2 py-1 text-xs last:border-b-0"
              >
                <span className="text-[var(--color-text)]">{author.name}</span>
                <span className="text-[var(--color-muted)]">{fmt(author.count)} uses</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState>Nothing in the full index matches “{query.trim()}”.</EmptyState>
      )}
    </Panel>
  );
}
