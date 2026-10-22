import { describe, expect, it } from "vitest";

import type { AdminConfig } from "./api";
import { scheduleLabel } from "./RefreshCache";

const config = (cron_enabled: boolean, cron_hours: number) =>
  ({ effective: { cron_enabled, cron_hours } }) as unknown as AdminConfig;

describe("scheduleLabel", () => {
  it("falls back to config.toml when nothing was saved from the board", () => {
    // The worker runs on this fallback, so the board must not call it "off".
    expect(scheduleLabel({ cron_enabled: null, cron_hours: null }, config(true, 6))).toBe("every 6 h");
    expect(scheduleLabel({ cron_enabled: null, cron_hours: null }, config(false, 6))).toBe("off");
  });

  it("lets a value saved from the board win", () => {
    expect(scheduleLabel({ cron_enabled: "false", cron_hours: "3" }, config(true, 6))).toBe("off");
    expect(scheduleLabel({ cron_enabled: "True", cron_hours: "3" }, config(false, 6))).toBe("every 3 h");
  });

  it("assumes the worker's default while the config is still loading", () => {
    expect(scheduleLabel({ cron_enabled: null, cron_hours: null }, null)).toBe("every 6 h");
  });
});
