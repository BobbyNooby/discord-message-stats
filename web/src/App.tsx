import { useCallback, useEffect, useReducer, useState } from "react";

import {
  Forbidden as ForbiddenError,
  Offline as OfflineError,
  ServerError as ServerErrorResponse,
  Unauthorized,
} from "./api/client";
import { useBootstrap, useHealth, useRecent } from "./api/queries";
import { AppShell } from "./components/AppShell";
import { FilterSidebar } from "./components/FilterSidebar";
import { HealthBanner } from "./components/HealthBanner";
import { JumpNav } from "./components/JumpNav";
import { NoticeProvider, useNotice } from "./components/Notice";
import { RecentStrip } from "./components/RecentStrip";
import {
  DashboardSkeleton,
  Forbidden as ForbiddenScreen,
  Offline as OfflineScreen,
  ServerError as ServerErrorScreen,
} from "./components/States";
import { dashboardReducer, initialDashboardState } from "./filters/reducer";
import {
  describeDropped,
  loadCharts,
  loadScopes,
  readUrlState,
  saveCharts,
  saveScopes,
  writeUrlState,
  type Charts,
} from "./filters/persist";
import { PanelScopeProvider } from "./panels/panelScope";
import { PANELS, specFor, type ChartKind, type PanelId } from "./panels/registry";
import { useKeyboardShortcuts } from "./lib/shortcuts";
import { stampLabel, timeFormatOf } from "./lib/timeFormat";
import { Calendar } from "./panels/Calendar";
import { LinksSection } from "./panels/LinksSection";
import { MediaSection } from "./panels/MediaSection";
import { RichMediaSection } from "./panels/RichMedia";
import { OverviewSection } from "./panels/OverviewSection";
import { PeopleSection } from "./panels/PeopleSection";
import { TimeSection } from "./panels/TimeSection";
import { WordsSection } from "./panels/WordsSection";
import { Admin } from "./routes/Admin";
import { Login } from "./routes/Login";

export default function App() {
  // The admin board is its own route with its own shell (§11.6), and there is no
  // router library by design. The path never changes without a reload, so this
  // stays a render-time branch and the dashboard keeps its hooks unconditional.
  // The notice region is the one thing both routes share: it is how a save, a
  // copy or a failure is acknowledged wherever it happened.
  return (
    <NoticeProvider>
      {window.location.pathname.startsWith("/admin") ? <Admin /> : <Dashboard />}
    </NoticeProvider>
  );
}

function Dashboard() {
  const bootstrap = useBootstrap();
  const health = useHealth();
  const recent = useRecent(bootstrap.isSuccess);

  const payload = bootstrap.data;

  if (bootstrap.isLoading) {
    return <DashboardSkeleton />;
  }
  if (bootstrap.error instanceof Unauthorized) {
    return <Login />;
  }
  if (bootstrap.error instanceof ForbiddenError) {
    return <ForbiddenScreen what="the dashboard" />;
  }
  if (bootstrap.error instanceof OfflineError) {
    return <OfflineScreen onRetry={() => void bootstrap.refetch()} />;
  }
  if (bootstrap.isError || !payload) {
    const detail =
      bootstrap.error instanceof ServerErrorResponse
        ? bootstrap.error.message
        : (bootstrap.error as Error)?.message;
    return <ServerErrorScreen detail={detail} onRetry={() => void bootstrap.refetch()} />;
  }

  // Mounted only once the payload exists: the reducer seeds `active` from the
  // author list, and seeding it from a placeholder left every chip reading
  // "off" while the charts still drew everybody.
  return (
    <DashboardBody payload={payload} banner={health.data?.banner ?? null}
                   lastIngestAt={health.data?.last_ingest_at ?? null}
                   recent={recent.data} />
  );
}

function DashboardBody({
  payload,
  banner,
  lastIngestAt,
  recent,
}: {
  payload: NonNullable<ReturnType<typeof useBootstrap>["data"]>;
  banner: "stale" | "token_dead" | null;
  /** The worker's own stamp; null means it has never ingested anything. */
  lastIngestAt?: string | null;
  recent?: { messages: { author: string; created_at: string; body: string }[]; truncated?: boolean };
}) {
  const [{ filters, scopes, mode }, dispatch] = useReducer(
    dashboardReducer,
    payload,
    initialDashboardState,
  );
  const years = [...new Set(payload.days.map((day) => Number(day.slice(0, 4))))].sort();
  const notify = useNotice();
  // `/` and `f`: the two things a reader reaches for on a page this long.
  useKeyboardShortcuts();
  // Stable, so a card's "…" does not re-render every panel through the context.
  const openScope = useCallback(
    (panelId: PanelId) => dispatch({ type: "openScope", panelId }),
    [dispatch],
  );

  // Saved scopes are read from the URL first (one entry per dimension, names
  // not indices) and the storage key second, then pruned against the payload
  // that is actually loaded.
  const [saved, setSaved] = useState(() => {
    const fromUrl = readUrlState(payload);
    const loaded = loadScopes(payload);
    return {
      scopes: { ...loaded.scopes, ...fromUrl.scopes },
      dropped: loaded.dropped,
    };
  });
  const [charts, setCharts] = useState<Charts>(() => loadCharts());

  // One card's shape, recorded beside the others. Choosing the shape the spec
  // already defaults to stores nothing, so "Reset view" reports only the cards
  // the reader has really changed.
  const setShape = useCallback((panelId: PanelId, shape: ChartKind) => {
    setCharts((previous) => {
      const next = { ...previous };
      if (shape === specFor(panelId).defaultShape) delete next[panelId];
      else next[panelId] = shape;
      return next;
    });
  }, []);

  useEffect(() => {
    for (const [panelId, patch] of Object.entries(saved.scopes)) {
      dispatch({ type: "replaceScope", panelId: panelId as PanelId, patch });
    }
  }, [dispatch, saved.scopes]);

  // Scopes are the one piece of state worth surviving a reload, and the URL is
  // what makes that work on a phone: it is the same view, not a re-typed one.
  useEffect(() => {
    saveScopes(scopes, payload.authors.map((author) => author.name));
    writeUrlState({ scopes, authors: payload.authors.map((author) => author.name) });
  }, [payload, scopes]);

  useEffect(() => {
    saveCharts(charts);
  }, [charts]);

  const pruned = describeDropped(saved.dropped, (panelId) =>
    panelId in PANELS ? PANELS[panelId as PanelId].label : panelId,
  );

  return (
    <AppShell
      canAdmin={payload.meta.can_admin}
      mode={mode}
      sidebar={
        <FilterSidebar
          payload={payload}
          filters={filters}
          scopes={scopes}
          mode={mode}
          dispatch={dispatch}
          years={years}
          pruned={pruned}
          onDismissPruned={() => setSaved((previous) => ({ ...previous, dropped: [] }))}
          charts={charts}
          onExitScope={() => dispatch({ type: "closeScope" })}
          onResetView={() => {
            dispatch({ type: "clearScopes" });
            setCharts({});
            notify({ tone: "success", message: "Saved view cleared — every card is back to the global filters." });
          }}
        />
      }
      header={
        <>
          <span>
            {payload.meta.firstLocal} → {payload.meta.lastLocal} ·{" "}
            {filters.active.filter(Boolean).length} of {payload.authors.length} authors
          </span>
          <span>
            {payload.tz.label} · as of {stampLabel(payload.meta.computed_at, timeFormatOf(payload.meta))}
          </span>
        </>
      }
    >
      <HealthBanner
        banner={banner}
        lastIngestAt={lastIngestAt}
        stale={payload.meta.stale}
        staleAt={payload.meta.computed_at}
        timeFormat={timeFormatOf(payload.meta)}
      />
      <JumpNav />
      <RecentStrip messages={recent?.messages ?? []} truncated={recent?.truncated} />
      {/* Six sections in the spec's order; the calendar sits inside Time &
          rhythm where §11.1 puts it. Every card inside can hand its id to the
          sidebar, which is how a card's "…" swaps what the sidebar edits. */}
      <PanelScopeProvider
        filters={filters}
        scopes={scopes}
        onOpenScope={openScope}
        charts={charts}
        onShapeChange={setShape}
      >
        <OverviewSection payload={payload} filters={filters} />
        <TimeSection payload={payload} filters={filters} calendar={<Calendar payload={payload} filters={filters} />} />
        <PeopleSection payload={payload} filters={filters} />
        <WordsSection payload={payload} filters={filters} dispatch={dispatch} />
        <LinksSection payload={payload} filters={filters} />
        <RichMediaSection payload={payload} filters={filters} />
        <MediaSection payload={payload} filters={filters} />
      </PanelScopeProvider>
      <footer className="pb-8 text-[11px] text-[var(--color-muted)]">
        {payload.meta.payload_kb} KB payload ({payload.meta.payload_gzip_kb} KB gzipped) ·{" "}
        {payload.meta.cells.toLocaleString()} rollup cells instead of{" "}
        {payload.meta.source_count.toLocaleString()} message rows · {payload.meta.stopwords}{" "}
        stopwords
      </footer>
    </AppShell>
  );
}
