import { useCallback, useEffect, useRef, useState } from "react";

import type { EChartsOption } from "echarts";

import type { MediaRow, Payload } from "../api/types";
import { useMedia } from "../api/queries";
import { EmptyState, Panel, CARD_COLUMNS, SectionHeading } from "../components/Panel";
import { SectionScopeNote } from "../components/SectionScopeNote";
import { EChart } from "../lib/echart";
import { kindLabel, providerChoices, providerLabel } from "../lib/mediaLabels";
import type { Filters } from "../filters/reducer";
import { readMediaOpen, writeMediaState } from "../filters/persist";
import { usePanelFilters } from "./panelScope";
import { MediaDetailDialog } from "./MediaDetail";
import { MediaTile } from "./MediaTile";
import { MediaView } from "./MediaView";

/**
 * "Most reposted" (§11.1, the rich-media idea).
 *
 * The same GIF gets posted over and over — one Tenor cat 63 times on the
 * reference data — and counting it per author hides that. `payload.topMedia` is
 * one row per URL, so this panel shows the thing itself.
 *
 * Ten items in the card, with "Browse all <total>" opening the full ranking
 * (§UI/UX rule 5): the card is a taste, the view is the answer, and the view's
 * provider filter asks the server rather than filtering a dozen payload rows.
 * The payload still ships `mediaByProvider`, which nothing reads any more — it
 * is a Python-side key and removing it is a later pass.
 *
 * Thumbnails respect `media.thumbnails`: "proxy" (this server fetches and caches
 * them, so Tenor and Klipy never learn who is reading the chat), "direct" (the
 * browser asks them), or "off" (numbers and providers only).
 */

/** The card's taste of the ranking; the whole thing is one click away. */
const IN_CARD = 10;

/** How many provider shortcuts the card offers before "More". Five fits one
 *  wrapped row at 390px, where the owner was looking for the switch. */
const CARD_PROVIDERS = 5;

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(Math.round(n));

/**
 * Whether the top-50 view is open is a URL state, not local state: that is what
 * makes Back close it and the link shareable. Opening pushes an entry, so the
 * very next Back returns here and the popstate handler closes the view; closing
 * by a button replays that Back rather than stacking a second entry. A view
 * opened from a shared link has no pushed entry to pop, so it is cleared in
 * place — a browser Back from there leaves the page, as it should.
 */
function useMediaViewState(): { viewOpen: boolean; onViewOpenChange: (open: boolean) => void } {
  const [viewOpen, setViewOpen] = useState(() => readMediaOpen());
  const pushed = useRef(false);

  useEffect(() => {
    const sync = () => setViewOpen(readMediaOpen());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const onViewOpenChange = useCallback((open: boolean) => {
    if (open) {
      window.history.pushState(null, "", writeMediaState(true));
      pushed.current = true;
    } else if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", writeMediaState(false));
    }
    setViewOpen(open);
  }, []);

  return { viewOpen, onViewOpenChange };
}

export function RichMedia({ payload, filters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  // The card's own scope, composed over the global filters. With a provider or
  // kind scope it asks the server for that slice's top rows — the payload only
  // ships the twenty-four biggest overall, where GIFs win every slot.
  const scoped = usePanelFilters("most-reposted", filters);
  const scopeProvider = scoped.provider ?? null;
  const scopeKind = scoped.kind ?? null;
  const hasScope = Boolean(scopeProvider || scopeKind);
  const scopedQuery = useMedia(scopeProvider, scopeKind, hasScope, IN_CARD);
  const items: MediaRow[] = hasScope ? scopedQuery.data?.items ?? [] : payload.topMedia ?? [];
  const shown = items.slice(0, IN_CARD);
  const mode = payload.mediaThumbnails ?? "proxy";
  const { viewOpen, onViewOpenChange } = useMediaViewState();
  // The provider options the card's chip row, the full view and the scoped
  // sidebar all share: one source, so they can never offer different providers.
  const choices = providerChoices(payload.providers ?? []);
  const topProviders = choices.slice(0, CARD_PROVIDERS);
  const totalEmbeds = choices.reduce((sum, choice) => sum + choice.count, 0);
  // Which provider the full view opens on. A chip hands it one; "Browse all"
  // and "More" clear it, so a plain open is never silently filtered.
  const [viewProvider, setViewProvider] = useState<string | null>(null);
  const [detail, setDetail] = useState<MediaRow | null>(null);

  const openView = (provider: string | null) => {
    setViewProvider(provider);
    onViewOpenChange(true);
  };

  const scopeName = [
    scopeProvider ? providerLabel(scopeProvider, scopeProvider) : null,
    scopeKind ? kindLabel(scopeKind) : null,
  ]
    .filter(Boolean)
    .join(" ");

  // Raw provider totals, with Discord's unnamed bucket split by host: an
  // `cdn.discordapp.com` attachment is somebody's own upload, not a mystery.
  const providers: [string, number][] = Object.values(
    (payload.providers ?? []).reduce<Record<string, [string, number]>>((acc, [name, count]) => {
      const key = providerLabel(name, name);
      acc[key] = [key, (acc[key]?.[1] ?? 0) + count];
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      backgroundColor: "#171b25",
      borderColor: "#2b3244",
      textStyle: { color: "#e7eaf2", fontSize: 12 },
    },
    grid: { left: 6, right: 46, top: 4, bottom: 4, containLabel: true },
    xAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1b202c" } },
      axisLabel: { color: "#8a93a8", fontSize: 10.5 },
    },
    yAxis: {
      type: "category",
      data: providers.slice(0, 12).map(([name]) => name).reverse(),
      axisLabel: { color: "#8a93a8", fontSize: 10.5, interval: 0, width: 96, overflow: "truncate" },
      axisLine: { lineStyle: { color: "#2b3244" } },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: "100%",
        data: providers.slice(0, 12).map(([, count]) => count).reverse(),
        itemStyle: { color: "#6c8cff" },
      },
    ],
  };

  return (
    <div className={CARD_COLUMNS}>
      <div>
        <Panel
          title="Most reposted"
          subtitle={
            hasScope
              ? `the same link posted again and again · top ${fmt(shown.length)} for ${scopeName}`
              : items.length > IN_CARD
                ? `the same link posted again and again · top ${IN_CARD} of ${fmt(items.length)}`
                : `the same link posted again and again · ${fmt(items.length)} links`
          }
          badge={
            <button
              type="button"
              onClick={() => openView(null)}
              className="rounded border border-[var(--color-line)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)] hover:text-[var(--color-text)]"
            >
              {totalEmbeds ? `Browse all ${fmt(totalEmbeds)}` : "Browse all"}
            </button>
          }
          csv={{
            name: "Most reposted",
            rows: [
              ["url", "provider", "kind", "title", "uses"],
              ...items.map((row) => [row[0], row[1], row[2], row[3], row[6]]),
            ],
          }}
        >
          {/* The switch the owner could not find: one chip per top provider,
              opening the full ranking already narrowed to it. The options come
              from the same helper the sidebar uses. */}
          {topProviders.length ? (
            <div
              role="group"
              aria-label="Browse the ranking by provider"
              className="mb-3 flex flex-wrap gap-1"
            >
              {topProviders.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  aria-label={`Browse ${choice.label}`}
                  onClick={() => openView(choice.value)}
                  className="rounded border border-[var(--color-line)] px-2 py-0.5 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                >
                  {choice.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => openView(null)}
                className="rounded border border-[var(--color-line)] px-2 py-0.5 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                More
              </button>
            </div>
          ) : null}
          {hasScope && scopedQuery.isError ? (
            <p className="text-xs text-red-300">
              Could not load this scope: {(scopedQuery.error as Error).message}
            </p>
          ) : hasScope && scopedQuery.isLoading ? (
            <p className="text-xs text-[var(--color-muted)]">Loading…</p>
          ) : shown.length === 0 ? (
            <EmptyState>
              {hasScope
                ? "No embeds in this filter — widen it, or browse them all."
                : "No embeds yet — ingest, or upload a database from the Admin board."}
            </EmptyState>
          ) : (
            <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {shown.map((row, index) => (
                <MediaTile key={row[0]} row={row} mode={mode} rank={index + 1} onOpen={() => setDetail(row)} />
              ))}
            </ol>
          )}
          <MediaDetailDialog row={detail} payload={payload} mode={mode} onClose={() => setDetail(null)} />
        </Panel>
        {viewOpen ? (
          <MediaView
            open={viewOpen}
            onOpenChange={onViewOpenChange}
            payload={payload}
            initialProvider={viewProvider}
          />
        ) : null}
      </div>
      <Panel
        title="Embeds by provider"
        subtitle="Klipy and Tenor both appear because Discord switched"
      >
        {providers.length === 0 ? (
          <EmptyState>No embeds yet — ingest, or upload a database from the Admin board.</EmptyState>
        ) : (
          <EChart option={option} height={260} />
        )}
      </Panel>
    </div>
  );
}

export function RichMediaSection({ payload, filters }: { payload: Payload; filters?: Filters }) {
  return (
    <section aria-labelledby="sec-media-rich" className="space-y-4">
      <SectionHeading id="sec-media-rich">Rich media</SectionHeading>
      <SectionScopeNote section="rich-media" />
      <RichMedia payload={payload} filters={filters} />
    </section>
  );
}
