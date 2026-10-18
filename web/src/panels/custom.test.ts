import { describe, expect, it, vi } from "vitest";

/**
 * The fork's panel is injected through the same seam the registry imports, so
 * this test reads `SPECS` exactly as the app does — no second registry.
 */
const FORK_PANEL = {
  id: "fork-recap",
  label: "Fork recap",
  honours: ["time", "author"] as const,
  shapes: ["bar"] as const,
  defaultShape: "bar" as const,
};

vi.mock("./custom", () => ({ customPanels: [FORK_PANEL] }));

describe("the custom-panel seam", () => {
  it("spreads a fork's panels into the registry after the built-ins", async () => {
    const { SPECS } = await import("./registry");
    const custom = await import("./custom");

    const index = SPECS.findIndex((spec) => spec.id === FORK_PANEL.id);
    expect(index, "the fork panel never reached SPECS").toBeGreaterThan(0);
    expect(index).toBe(SPECS.length - custom.customPanels.length);
    expect(SPECS[0].id).toBe("stat-cards");
    expect(SPECS.length).toBe(40 + custom.customPanels.length);
  });

  it("carries the fork panel's declared honours and shapes", async () => {
    const { SPECS, PANELS, isPanelId, specForLabel } = await import("./registry");

    const spec = SPECS.find((entry) => entry.id === FORK_PANEL.id);
    expect(spec?.honours).toEqual(["time", "author"]);
    expect(spec?.shapes).toEqual(["bar"]);
    expect(spec?.defaultShape).toBe("bar");

    expect(isPanelId(FORK_PANEL.id)).toBe(true);
    expect(specForLabel(FORK_PANEL.label)?.id).toBe(FORK_PANEL.id);
    expect(PANELS[FORK_PANEL.id as never]?.honours).toEqual(["time", "author"]);
  });
});
