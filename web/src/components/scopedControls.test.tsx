import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useEffect, useReducer } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The structural rule the dead "…" taught us: every dimension a panel's spec
 * declares must render a real control in that panel's scoped sidebar, or the
 * panel must not declare it. This walks the whole registry, so a new dimension
 * that nobody wired (or a control someone deleted) fails here rather than
 * opening a sidebar full of explanations.
 */
const server = vi.hoisted(() => ({ getMedia: vi.fn() }));

vi.mock("../api/client", () => ({
  Unauthorized: class Unauthorized extends Error {},
  Forbidden: class Forbidden extends Error {},
  getBootstrap: vi.fn(),
  getHealth: vi.fn(),
  getRecent: vi.fn(),
  getWords: vi.fn(),
  getMedia: server.getMedia,
}));

import type { Payload } from "../api/types";
import { dashboardReducer, initialDashboardState } from "../filters/reducer";
import { PANELS, type Dimension, type PanelId } from "../panels/registry";
import { PanelScopeProvider } from "../panels/panelScope";
import { FilterSidebar } from "./FilterSidebar";
import { Panel } from "./Panel";

const payload = {
  meta: { lastLocal: "2024-06-30", firstLocal: "2023-01-01" },
  authors: [{ id: "u1", name: "Alice", msgs: 10 }],
  days: ["2023-01-01", "2024-06-30"],
  providers: [
    ["Tenor", 7],
    ["YouTube", 3],
  ],
} as unknown as Payload;

/** A probe that only the real control renders — the placeholder never does. */
const PROBES: Record<Dimension, () => HTMLElement> = {
  time: () => screen.getByText(/Time range/),
  author: () => screen.getByText(/Authors \(/),
  word: () => screen.getByRole("textbox", { name: "Word" }),
  provider: () => screen.getByText("Any provider"),
  kind: () => screen.getByText("Any kind"),
};

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Harness({ ids, open }: { ids: PanelId[]; open?: PanelId }) {
  const [state, dispatch] = useReducer(dashboardReducer, payload, initialDashboardState);
  const openScope = useCallback((panelId: PanelId) => dispatch({ type: "openScope", panelId }), []);
  // Opening through the reducer keeps the structural pass to one card per
  // render, instead of clicking through forty cards that are all re-rendered.
  useEffect(() => {
    if (open) dispatch({ type: "openScope", panelId: open });
  }, [open]);

  return (
    <QueryClientProvider client={client}>
      <PanelScopeProvider filters={state.filters} scopes={state.scopes} onOpenScope={openScope}>
        {ids.map((id) => (
          <Panel key={id} panelId={id} title={PANELS[id].label}>
            <p>card body</p>
          </Panel>
        ))}
      </PanelScopeProvider>
      <FilterSidebar
        payload={payload}
        years={[2023, 2024]}
        filters={state.filters}
        scopes={state.scopes}
        mode={state.mode}
        dispatch={dispatch}
        onExitScope={() => dispatch({ type: "closeScope" })}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  server.getMedia.mockReset();
  server.getMedia.mockResolvedValue({ provider: null, kind: null, kinds: ["gifv", "video"], items: [] });
});

describe("the scoped sidebar", () => {
  it("renders a real control for every dimension a panel declares", () => {
    const declared = Object.values(PANELS).filter((spec) => spec.honours.length > 0);
    expect(declared.length).toBeGreaterThan(0);

    for (const spec of declared) {
      const id = spec.id as PanelId;
      const { unmount } = render(<Harness ids={[id]} open={id} />);

      for (const dimension of spec.honours) {
        const where = `${spec.id} declares ${dimension}`;
        // The old fallback was an explanation, not a control: its absence is the
        // assertion the dead "…" would have failed.
        expect(
          screen.queryByText(new RegExp(`No ${dimension} filter exists yet`)),
          `${where} still falls back to an explanation`,
        ).toBeNull();
        expect(PROBES[dimension](), `${where} has no control`).toBeInTheDocument();
      }

      unmount();
    }
  });

  it("applies a provider scope to a card as a chip, and back to global clears it", () => {
    render(<Harness ids={["most-reposted"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter Most reposted" }));
    fireEvent.click(screen.getByRole("button", { name: "Tenor" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByRole("button", { name: "Remove provider Tenor" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to global" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove provider Tenor" })).toBeNull();
  });

  it("applies a kind scope once the server's kinds arrive", async () => {
    render(<Harness ids={["most-reposted"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter Most reposted" }));
    fireEvent.click(await screen.findByRole("button", { name: "GIF" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByRole("button", { name: "Remove kind GIF" })).toBeInTheDocument();
  });
});
