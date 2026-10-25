import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

import { charts } from "./echarts";

// jsdom has no canvas and no layout, so a real ECharts instance cannot paint.
// Every component test gets a chart that records what it was asked to draw
// (`src/test/echarts.ts`); `src/charts/echart.test.tsx` overrides this with its
// own mock to assert the lifecycle itself.
vi.mock("echarts", async () => (await import("./echarts")).echartsModule);

vi.mock("echarts-wordcloud", () => ({ default: {} }));

// One test's charts must not leak into the next one's counts.
beforeEach(() => charts.reset());

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);
