import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Payload } from "../api/types";
import { EMPTY_FILTERS, initialFilters } from "../filters/reducer";
import { Calendar } from "./Calendar";
import { buildWeeks, calendarGeometry, clampStart, MIN_WEEKS } from "./calendarWeeks";

const payload = {
  days: ["2026-01-01", "2026-01-02", "2026-02-01"],
  authors: [{ id: "u1", name: "A", msgs: 3 }],
  cells: [
    [0, 0, 2, 10, 0, 0, 0],
    [1, 0, 1, 5, 0, 0, 0],
    [2, 0, 1, 5, 0, 0, 0],
  ],
} as unknown as Payload;

const filters = () => initialFilters(payload);

describe("calendar geometry", () => {
  it("keeps cells square at every zoom level", () => {
    for (const width of [1200, 900, 600]) {
      for (const weeks of [60, 104, 204]) {
        const geometry = calendarGeometry(width, weeks);
        expect(geometry.grid.width / weeks).toBeCloseTo(geometry.cell, 6);
        expect(geometry.grid.height / 7).toBeCloseTo(geometry.cell, 6);
      }
    }
  });

  it("never grows a cell past the cap, and shrinks the chart with the window", () => {
    expect(calendarGeometry(4000, 60).cell).toBe(26);
    expect(calendarGeometry(1200, 204).height).toBeLessThan(calendarGeometry(1200, 60).height);
  });

  it("refuses a window smaller than the minimum", () => {
    expect(calendarGeometry(1200, 1)).toEqual(calendarGeometry(1200, MIN_WEEKS));
  });

  it("clamps the pan range to the data", () => {
    expect(clampStart(-5, 60, 100)).toBe(0);
    expect(clampStart(999, 60, 100)).toBe(40);
  });
});

describe("calendar data", () => {
  it("groups filtered messages into weeks and weekdays", () => {
    const weeks = buildWeeks(payload, filters());
    expect(weeks.total).toBe(4);
    expect(weeks.weeks[0]).toBe("2025-12-28"); // the Sunday of 2026-01-01
  });

  it("drops the cells a filter removes", () => {
    expect(buildWeeks(payload, { ...filters(), active: [false] }).total).toBe(0);
  });

  it("renders a single day without dividing by zero", () => {
    const one = { ...payload, days: ["2026-01-01"], cells: [[0, 0, 1, 5, 0, 0, 0]] } as Payload;
    expect(buildWeeks(one, initialFilters(one)).weeks).toHaveLength(1);
    const { container } = render(<Calendar payload={one} filters={initialFilters(one)} />);
    expect(container).toBeTruthy();
  });
});

describe("<Calendar>", () => {
  it("does not attach a wheel listener", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    render(<Calendar payload={payload} filters={filters()} />);
    expect(addSpy).not.toHaveBeenCalledWith("wheel", expect.anything(), expect.anything());
    addSpy.mockRestore();
  });

  it("renders an empty state rather than throwing when nothing matches", () => {
    const { getByText } = render(
      <Calendar payload={payload} filters={{ ...EMPTY_FILTERS, active: [false] }} />,
    );
    expect(getByText(/no days match/i)).toBeInTheDocument();
  });
});
