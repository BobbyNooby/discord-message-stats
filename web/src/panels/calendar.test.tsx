import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Payload } from "../api/types";
import { EMPTY_FILTERS, initialFilters } from "../filters/reducer";
import { Calendar } from "./Calendar";
import { buildWeeks, calendarGeometry, clampStart, MIN_WEEKS, weekdayLabels } from "./calendarWeeks";

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
    // The config's default is a Monday week, so 2026-01-01 (a Thursday) belongs
    // to the week that opened on 2025-12-29.
    expect(weeks.weeks[0]).toBe("2025-12-29");
  });

  it("starts the week on the day `ui.week_start` names", () => {
    // 2026-01-01 is a Thursday, so it is row 3 of a Monday week and row 4 of a
    // Sunday one — the value moves with its label, not away from it.
    const monday = buildWeeks(payload, filters(), "monday");
    const sunday = buildWeeks(payload, filters(), "sunday");

    expect(monday.weeks[0]).toBe("2025-12-29");
    expect(sunday.weeks[0]).toBe("2025-12-28");
    expect(monday.values.get("2025-12-29|3")).toBe(2); // Thursday
    expect(sunday.values.get("2025-12-28|4")).toBe(2); // the same Thursday
    expect(monday.total).toBe(sunday.total);
    expect(weekdayLabels("monday")[0]).toBe("Mon");
    expect(weekdayLabels("sunday")[0]).toBe("Sun");
  });

  it("reads the week start off the payload, so a config edit is visible", () => {
    const { getByRole } = render(
      <Calendar
        payload={{ ...payload, meta: { ...(payload.meta ?? {}), week_start: "sunday" } } as Payload}
        filters={filters()}
      />,
    );
    // The panel exists and drew; the rotation itself is pinned above, because
    // ECharts draws axis labels onto a canvas no test can read back.
    expect(getByRole("heading", { name: "Every day, six years" })).toBeInTheDocument();
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
