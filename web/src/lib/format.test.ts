import { describe, expect, it } from "vitest";

import { dur, fmt, kfmt, pctOf } from "./format";

describe("the number formats", () => {
  it("rounds and groups a whole number", () => {
    expect(fmt(17135)).toBe("17,135");
    expect(fmt(2.6)).toBe("3");
    expect(fmt(0)).toBe("0");
  });

  it("shortens to k and M, dropping a trailing .0", () => {
    expect(kfmt(950)).toBe("950");
    expect(kfmt(1000)).toBe("1k");
    expect(kfmt(12_340)).toBe("12.3k");
    expect(kfmt(1_200_000)).toBe("1.2M");
  });

  it("keeps a negative's suffix, choosing it by size rather than sign", () => {
    expect(kfmt(-1500)).toBe("-1.5k");
    expect(kfmt(-2_000_000)).toBe("-2M");
    expect(kfmt(-12)).toBe("-12");
  });

  it("writes a wait in seconds, minutes or hours", () => {
    expect(dur(45)).toBe("45s");
    expect(dur(210)).toBe("3.5m");
    expect(dur(7560)).toBe("2.1h");
    expect(dur(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("prints a share with one decimal and never NaN", () => {
    expect(pctOf(1, 3)).toBe("33.3");
    expect(pctOf(5, 0)).toBe("0.0");
  });
});
