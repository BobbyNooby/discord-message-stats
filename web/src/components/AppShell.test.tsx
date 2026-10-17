import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// jsdom has no layout and no media queries. The shell asks `matchMedia` for the
// 860px breakpoint, so the test answers, and `innerWidth` backs it up.
beforeEach(() => {
  window.innerWidth = 1440;
  window.matchMedia = ((query: string) => ({
    matches: window.innerWidth <= 860,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  document.body.style.overflow = "";
});

const sidebarProps = {
  payload,
  filters: initialFilters(payload),
  scopes: {},
  mode: { kind: "global" } as const,
  dispatch: vi.fn(),
  years: [2023, 2024],
};

describe("<FilterSidebar>", () => {
  it("groups every filter and keeps them visible beside the charts", () => {
    render(<FilterSidebar {...sidebarProps} />);
    for (const label of ["Time range", "Authors (2/2)", "Bucket", "Rank by"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Reset all filters" })).toBeInTheDocument();
  });

  it("toggles one author without touching the others", async () => {
    const dispatch = vi.fn();
    render(<FilterSidebar {...sidebarProps} dispatch={dispatch} />);
    await userEvent.click(screen.getByRole("button", { name: /Bob/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: "toggleAuthor", index: 1 });
  });

  it("marks a switched-off author for screen readers, not only by colour", () => {
    render(
      <FilterSidebar
        {...sidebarProps}
        filters={{ ...initialFilters(payload), active: [true, false] }}
      />,
    );
    expect(screen.getByRole("button", { name: /Bob/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Alice/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("resets every filter", async () => {
    const dispatch = vi.fn();
    render(<FilterSidebar {...sidebarProps} dispatch={dispatch} />);
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
    window.innerWidth = 390;
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

  it("carries the same filter groups in the drawer as on the desktop", async () => {
    window.innerWidth = 390;
    render(
      <AppShell sidebar={<FilterSidebar {...sidebarProps} />} header={null}>
        <p>charts</p>
      </AppShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    const drawer = screen.getByRole("dialog", { name: "Filters" });
    for (const label of ["Time range", "Authors (2/2)", "Bucket", "Rank by"]) {
      expect(within(drawer).getByText(label)).toBeInTheDocument();
    }
  });

  it("opens the drawer when a card hands the shell a scope", () => {
    window.innerWidth = 390;
    const { rerender } = render(
      <AppShell sidebar={<FilterSidebar {...sidebarProps} />} header={null} mode={{ kind: "global" }}>
        <p>charts</p>
      </AppShell>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    // What the app hands the shell when a card's "…" is pressed: below 860px
    // the sidebar only exists inside the drawer, so the drawer must open too.
    rerender(
      <AppShell
        sidebar={
          <FilterSidebar
            {...sidebarProps}
            mode={{ kind: "scoped", panelId: "who-talks-the-most", draft: {} }}
          />
        }
        header={null}
        mode={{ kind: "scoped", panelId: "who-talks-the-most", draft: {} }}
      >
        <p>charts</p>
      </AppShell>,
    );
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByText("Filter for Who talks the most")).toBeInTheDocument();
  });

  it("sizes the floating trigger for a thumb and stays clear of the notch", () => {
    window.innerWidth = 390;
    render(
      <AppShell sidebar={<p>filter groups</p>} header={null}>
        <p>charts</p>
      </AppShell>,
    );
    const trigger = screen.getByRole("button", { name: "Filters" });
    expect(trigger.className).toContain("h-10");
    expect(trigger.className).toContain("w-10");
    expect(trigger.getAttribute("style")).toContain("safe-area-inset-top");
    expect(trigger.getAttribute("style")).toContain("safe-area-inset-right");
  });

  it("locks the page behind the drawer and gives it back on close", async () => {
    window.innerWidth = 390;
    render(
      <AppShell sidebar={<p>filter groups</p>} header={null}>
        <p>charts</p>
      </AppShell>,
    );
    expect(document.body.style.overflow).toBe("");

    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(document.body.style.overflow).toBe("hidden");

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the desktop sidebar in the page, with no drawer at 1440px", () => {
    window.innerWidth = 1440;
    render(
      <AppShell sidebar={<p>filter groups</p>} header={null}>
        <p>charts</p>
      </AppShell>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByText("filter groups")).toBeInTheDocument();
  });
});
