import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Payload } from "../api/types";
import { AppShell } from "./AppShell";
import { FilterSidebar } from "./FilterSidebar";
import { initialFilters } from "../filters/reducer";

const payload = {
  meta: { lastLocal: "2024-01-01", firstLocal: "2023-01-01" },
  authors: [
    { id: "u1", name: "Alice", msgs: 10 },
    { id: "u2", name: "Bob", msgs: 4 },
  ],
  days: ["2023-01-01", "2024-01-01"],
} as unknown as Payload;

describe("<FilterSidebar>", () => {
  it("groups every filter and keeps them visible beside the charts", () => {
    render(
      <FilterSidebar
        payload={payload}
        filters={initialFilters(payload)}
        scopes={{}}
        mode={{ kind: "global" }}
        dispatch={vi.fn()}
        years={[2023, 2024]}
      />,
    );
    for (const label of ["Time range", "Authors (2/2)", "Bucket", "Rank by"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Reset all filters" })).toBeInTheDocument();
  });

  it("toggles one author without touching the others", async () => {
    const dispatch = vi.fn();
    render(
      <FilterSidebar
        payload={payload}
        filters={initialFilters(payload)}
        scopes={{}}
        mode={{ kind: "global" }}
        dispatch={dispatch}
        years={[]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Bob/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: "toggleAuthor", index: 1 });
  });

  it("marks a switched-off author for screen readers, not only by colour", () => {
    render(
      <FilterSidebar
        payload={payload}
        filters={{ ...initialFilters(payload), active: [true, false] }}
        scopes={{}}
        mode={{ kind: "global" }}
        dispatch={vi.fn()}
        years={[]}
      />,
    );
    expect(screen.getByRole("button", { name: /Bob/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Alice/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("resets every filter", async () => {
    const dispatch = vi.fn();
    render(
      <FilterSidebar
        payload={payload}
        filters={initialFilters(payload)}
        scopes={{}}
        mode={{ kind: "global" }}
        dispatch={dispatch}
        years={[]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Reset all filters" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "reset" });
  });
});

describe("<AppShell>", () => {
  it("offers a way into the admin board, but only to an admin", () => {
    const { rerender, getByRole, queryByRole } = render(
      <AppShell sidebar={<p>filters</p>} header={<span>range</span>} canAdmin>
        <p>charts</p>
      </AppShell>,
    );
    expect(getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    rerender(
      <AppShell sidebar={<p>filters</p>} header={<span>range</span>}>
        <p>charts</p>
      </AppShell>,
    );
    expect(queryByRole("link", { name: "Admin" })).toBeNull();
  });

  it("opens the filters as a dismissable drawer on a phone", async () => {
    const { getByRole, queryByRole } = render(
      <AppShell sidebar={<p>filter groups</p>} header={null}>
        <p>charts</p>
      </AppShell>,
    );
    expect(queryByRole("dialog")).toBeNull();
    await userEvent.click(getByRole("button", { name: "Filters" }));
    expect(getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
    await userEvent.click(getByRole("button", { name: "Close" }));
    expect(queryByRole("dialog")).toBeNull();
  });
});
