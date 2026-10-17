import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useReducer } from "react";
import { describe, expect, it } from "vitest";

import type { Payload } from "../api/types";
import { dashboardReducer, initialDashboardState } from "../filters/reducer";
import { effective } from "../filters/selectors";
import type { PanelId } from "../panels/registry";
import { PANELS, panelsHonouring } from "../panels/registry";
import { FilterSidebar } from "./FilterSidebar";
import { PanelScopeProvider } from "../panels/panelScope";
import { Panel } from "./Panel";

const payload = {
  meta: { lastLocal: "2024-06-30", firstLocal: "2023-01-01" },
  authors: [
    { id: "u1", name: "Alice", msgs: 10 },
    { id: "u2", name: "Bob", msgs: 4 },
  ],
  days: ["2023-01-01", "2024-06-30"],
} as unknown as Payload;

/**
 * The real reducer, a real card and the real sidebar: the point of the scope is
 * what the card's own filters resolve to, not what one dispatch call carried.
 */
function Harness() {
  const [state, dispatch] = useReducer(dashboardReducer, payload, initialDashboardState);
  const openScope = useCallback(
    (panelId: PanelId) => dispatch({ type: "openScope", panelId }),
    [],
  );
  const authors = effective(state.filters, state.scopes["who-talks-the-most"]);
  const word = effective(state.filters, state.scopes["who-says-it"]);
  const wordAuthors = effective(state.filters, state.scopes["who-says-it"]);

  return (
    <>
      <PanelScopeProvider filters={state.filters} scopes={state.scopes} onOpenScope={openScope}>
        <Panel title="Who talks the most">
          <p>leaderboard</p>
        </Panel>
        <Panel title="Who says it">
          <p>who says it</p>
        </Panel>
        <Panel title="Message types">
          <p>types</p>
        </Panel>
      </PanelScopeProvider>
      <span data-testid="authors">{authors.active.filter(Boolean).length}</span>
      <span data-testid="word-authors">{wordAuthors.active.filter(Boolean).length}</span>
      <span data-testid="years">{authors.years.join(",") || "none"}</span>
      <span data-testid="word">{word.word ?? "none"}</span>
      <FilterSidebar
        payload={payload}
        years={[2023, 2024]}
        filters={state.filters}
        scopes={state.scopes}
        mode={state.mode}
        dispatch={dispatch}
        onExitScope={() => dispatch({ type: "closeScope" })}
      />
    </>
  );
}

const openScope = (label: string) => userEvent.click(screen.getByRole("button", { name: `Filter ${label}` }));

describe("<FilterSidebar> in a card's scope", () => {
  it("states each control's reach from the registry, so the number cannot drift", () => {
    render(<Harness />);
    const total = Object.keys(PANELS).length;
    expect(
      screen.getByText(`Time range · ${panelsHonouring("time").length} of ${total} cards`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Authors \\(2/2\\) · ${panelsHonouring("author").length} of ${total} cards`)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Bucket · ${panelsHonouring("time").length} of ${total} cards`),
    ).toBeInTheDocument();
    // A dimension no card honours gets no control. Each of these has at least
    // one, so all of them are on offer.
    for (const dimension of ["time", "author", "word", "provider", "kind"] as const) {
      expect(panelsHonouring(dimension).length).toBeGreaterThan(0);
    }
  });

  it("offers no global sort: ranking lives on the individual cards", () => {
    render(<Harness />);
    // The sidebar is the global filter surface. The old "Rank by" control lived
    // here; messages and characters are separate cards now, each naming itself.
    expect(screen.queryByText(/rank by/i)).toBeNull();
    expect(screen.queryByText(/sort by/i)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /rank|sort|metric/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /rank by/i })).toBeNull();
  });

  it("swaps the sidebar to the card's own scope and names the card", async () => {
    render(<Harness />);
    expect(screen.getByText(/Bucket ·/)).toBeInTheDocument();

    await openScope("Who talks the most");

    expect(screen.getByRole("status")).toHaveTextContent("Filter for Who talks the most");
    expect(screen.getByText(/Authors \(2\/2\)/)).toBeInTheDocument();
    // The global-only controls are not part of a card's scope.
    expect(screen.queryByText(/Bucket ·/)).toBeNull();
    // No global metric switch exists any more: messages and characters are
    // separate cards, each saying what it ranks.
    expect(screen.queryByText("Rank by")).toBeNull();
  });

  it("offers only the dimensions the card honours", async () => {
    render(<Harness />);
    await openScope("Who says it");

    expect(screen.getByRole("textbox", { name: "Word" })).toBeInTheDocument();
    expect(screen.getByText(/Authors \(2\/2\)/)).toBeInTheDocument();
    expect(screen.queryByText("Time range")).toBeNull();
  });

  it("does not offer a scope on a card that honours nothing", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "Filter Message types" })).toBeNull();
  });

  it("keeps a draft out of the card until Apply", async () => {
    render(<Harness />);
    await openScope("Who talks the most");

    await userEvent.click(screen.getByRole("button", { name: /Bob/ }));
    expect(screen.getByTestId("authors")).toHaveTextContent("2");
    expect(screen.getByRole("status")).toHaveTextContent(/unapplied/i);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByTestId("authors")).toHaveTextContent("1");
  });

  it("drops the draft and returns to the global groups on back to global", async () => {
    render(<Harness />);
    await openScope("Who talks the most");
    await userEvent.click(screen.getByRole("button", { name: /Bob/ }));
    await userEvent.click(screen.getByRole("button", { name: "Back to global" }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/Bucket ·/)).toBeInTheDocument();
    expect(screen.getByTestId("authors")).toHaveTextContent("2");
    // The draft is gone, not merely hidden: reopening starts from what applies.
    await openScope("Who talks the most");
    expect(screen.getByRole("button", { name: /Bob/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows one chip per applied dimension, and removing one leaves the draft alone", async () => {
    render(<Harness />);
    await openScope("Who says it");
    await userEvent.type(screen.getByRole("textbox", { name: "Word" }), "cat");
    await userEvent.click(screen.getByRole("button", { name: /Bob/ }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByRole("button", { name: "Remove word “cat”" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove 1 of 2 authors" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove word “cat”" }));
    expect(screen.getByTestId("word")).toHaveTextContent("none");
    expect(screen.queryByRole("button", { name: "Remove word “cat”" })).toBeNull();
    // Only the removed dimension went: the author scope is still applied.
    expect(screen.getByRole("button", { name: "Remove 1 of 2 authors" })).toBeInTheDocument();
    expect(screen.getByTestId("word-authors")).toHaveTextContent("1");
  });

  it("states a time scope in words and clears it from its chip", async () => {
    render(<Harness />);
    await openScope("Who talks the most");
    await userEvent.click(screen.getByRole("button", { name: "2023" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByTestId("years")).toHaveTextContent("2023");
    await userEvent.click(screen.getByRole("button", { name: "Remove year 2023" }));
    expect(screen.getByTestId("years")).toHaveTextContent("none");
    expect(screen.getByRole("button", { name: "2023" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the sidebar in the scope after applying, and shows no scope at all when there is none", async () => {
    render(<Harness />);
    await openScope("Who talks the most");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Bob/ }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByRole("status")).toHaveTextContent("Filter for Who talks the most");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.queryByText("Rank by")).toBeNull();
  });
});
