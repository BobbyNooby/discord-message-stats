import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom has no canvas and no layout, so a real ECharts instance cannot paint.
// Every component test gets a chart that records what it was asked to draw;
// `src/lib/echart.test.tsx` overrides this with its own mock to assert the
// lifecycle itself.
const instance = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  getOption: vi.fn(() => ({})),
};

vi.mock("echarts", () => ({
  init: vi.fn(() => instance),
  use: vi.fn(),
  default: { init: vi.fn(() => instance), use: vi.fn() },
}));

vi.mock("echarts-wordcloud", () => ({ default: {} }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);
