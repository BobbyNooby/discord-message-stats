import { useReducer } from "react";

import { Unauthorized } from "./api/client";
import { useBootstrap, useHealth, useRecent } from "./api/queries";
import { AppShell } from "./components/AppShell";
import { FilterSidebar } from "./components/FilterSidebar";
import { HealthBanner } from "./components/HealthBanner";
import { RecentStrip } from "./components/RecentStrip";
import { initialFilters, filtersReducer } from "./filters/reducer";
import { Login } from "./routes/Login";

export default function App() {
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
    </AppShell>
  );
}
