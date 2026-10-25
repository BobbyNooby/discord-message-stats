import { afterEach, describe, expect, it, vi } from "vitest";

import { formatClock, formatStamp } from "./shared";

describe("the admin board's clock", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows a stamp in the viewer's own time, not UTC with no label", () => {
    vi.stubEnv("TZ", "Asia/Kuala_Lumpur");
    // 14:19 UTC is 22:19 in Kuala Lumpur; the old board printed "14:19".
    expect(formatStamp("2026-10-22T14:19:23+00:00")).toBe("2026-10-22 22:19");
    expect(formatClock("2026-10-22T14:19:23+00:00")).toBe("22:19");
  });

  it("keeps its words for a missing or unreadable stamp", () => {
    expect(formatStamp(null)).toBe("never");
    expect(formatClock(undefined)).toBe("—");
    expect(formatStamp("not a time")).toBe("not a time");
  });
});
