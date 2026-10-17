import { describe, expect, it } from "vitest";

import { hourLabel, stampLabel, timeFormatOf } from "./timeFormat";

/**
 * `ui.time_format` is a display setting: the same instant, written the way the
 * operator asked. The default is 24-hour, which is what every panel drew before
 * the setting was wired.
 */
describe("time_format", () => {
  it("writes an hour either way", () => {
    expect(hourLabel(13, "24h")).toBe("13:00");
    expect(hourLabel(13, "12h")).toBe("1pm");
    expect(hourLabel(0, "12h")).toBe("12am");
    expect(hourLabel(12, "12h")).toBe("12pm");
    expect(hourLabel(23, "12h")).toBe("11pm");
  });

  it("writes a timestamp either way, without moving it between zones", () => {
    expect(stampLabel("2026-10-17T20:05:00+08:00", "24h")).toBe("2026-10-17 20:05");
    expect(stampLabel("2026-10-17T20:05:00+08:00", "12h")).toBe("2026-10-17 8:05 pm");
    expect(stampLabel("2026-10-17T00:05:00Z", "12h")).toBe("2026-10-17 12:05 am");
  });

  it("leaves a stamp it cannot read alone, and says 'never' for nothing", () => {
    expect(stampLabel(null)).toBe("never");
    expect(stampLabel("not a date")).toBe("not a date");
  });

  it("reads the format from the payload, defaulting to the config's default", () => {
    expect(timeFormatOf({ time_format: "12h" })).toBe("12h");
    expect(timeFormatOf({ time_format: "24h" })).toBe("24h");
    expect(timeFormatOf(undefined)).toBe("24h");
  });
});
