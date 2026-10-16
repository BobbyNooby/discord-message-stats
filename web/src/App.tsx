import { useReducer } from "react";

import { Unauthorized } from "./api/client";
import { useBootstrap, useHealth, useRecent } from "./api/queries";
import { AppShell } from "./components/AppShell";
import { FilterSidebar } from "./components/FilterSidebar";
import { HealthBanner } from "./components/HealthBanner";
import { RecentStrip } from "./components/RecentStrip";
import { initialFilters, filtersReducer } from "./filters/reducer";
import { Calendar } from "./panels/Calendar";
import { LinksSection } from "./panels/LinksSection";
import { MediaSection } from "./panels/MediaSection";
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
  return window.location.pathname.startsWith("/admin") ? <Admin /> : <Dashboard />;
}

function Dashboard() {
  const bootstrap = useBootstrap();
  const health = useHealth();
  const recent = useRecent(bootstrap.isSuccess);

  const payload = bootstrap.data;
  const [filters, dispatch] = useReducer(
    filtersReducer,
    payload ?? ({ authors: [] } as never),
    (seed) => initialFilters(seed),
  );

  if (bootstrap.isLoading) {
    return <main className="p-6 text-sm text-[var(--color-muted)]">Loading…</main>;
  }
  if (bootstrap.error instanceof Unauthorized) {
    return <Login />;
  }
  if (bootstrap.isError || !payload) {
    return (
      <main className="p-6 text-sm text-red-300">
        Could not load the dashboard: {(bootstrap.error as Error)?.message}
      </main>
    );
  }

  const years = [...new Set(payload.days.map((day) => Number(day.slice(0, 4))))].sort();

  return (
    <AppShell
      sidebar={
        <FilterSidebar payload={payload} filters={filters} dispatch={dispatch} years={years} />
      }
      header={
        <>
          <span>
            {payload.meta.firstLocal} → {payload.meta.lastLocal} ·{" "}
            {filters.active.filter(Boolean).length} of {payload.authors.length} authors
          </span>
          <span>
            {payload.tz.label} · as of {payload.meta.computed_at?.slice(0, 16).replace("T", " ") ??
              "never"}
          </span>
        </>
      }
    >
      <HealthBanner
        banner={health.data?.banner ?? null}
        stale={payload.meta.stale}
        staleAt={payload.meta.computed_at}
      />
      <RecentStrip messages={recent.data?.messages ?? []} truncated={recent.data?.truncated} />
      {/* Six sections in the spec's order; the calendar sits inside Time &
          rhythm where §11.1 puts it. */}
      <OverviewSection payload={payload} filters={filters} />
      <TimeSection payload={payload} filters={filters} calendar={<Calendar payload={payload} filters={filters} />} />
      <PeopleSection payload={payload} filters={filters} />
      <WordsSection payload={payload} filters={filters} dispatch={dispatch} />
      <LinksSection payload={payload} filters={filters} />
      <MediaSection payload={payload} filters={filters} />
      <footer className="pb-8 text-[11px] text-[var(--color-muted)]">
        {payload.meta.payload_kb} KB payload ({payload.meta.payload_gzip_kb} KB gzipped) ·{" "}
        {payload.meta.cells.toLocaleString()} rollup cells instead of{" "}
        {payload.meta.source_count.toLocaleString()} message rows · {payload.meta.stopwords}{" "}
        stopwords
      </footer>
    </AppShell>
  );
}
