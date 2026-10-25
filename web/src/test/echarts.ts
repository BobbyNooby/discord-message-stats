import { vi } from "vitest";

/**
 * The chart every component test draws into. jsdom has no canvas, so a real
 * ECharts instance cannot paint; this one records what it was asked to draw.
 *
 * Every chart shares one set of spies, so a test can count `setOption` across
 * the whole page, and each chart also keeps its own options and the node it was
 * mounted on, so a test can read one chart's last option. `test-setup.ts` mocks
 * `echarts` with this module for every test file; `lib/echart.test.tsx`
 * replaces it with its own mock to assert the lifecycle itself.
 */
export type RecordedChart = {
  /** The node `<EChart>` handed to `init`, so a test can tell which card drew. */
  container: HTMLElement | undefined;
  /** Every option this chart was given, oldest first. */
  options: unknown[];
  setOption: (option: unknown, notMerge?: boolean) => void;
  resize: () => void;
  dispose: () => void;
  on: (...args: unknown[]) => void;
  off: (...args: unknown[]) => void;
  clear: () => void;
  getOption: () => Record<string, never>;
};

const setOption = vi.fn();
const resize = vi.fn();
const dispose = vi.fn();
const on = vi.fn();
const off = vi.fn();
const clear = vi.fn();
const getOption = vi.fn(() => ({}));

const instances: RecordedChart[] = [];

const init = vi.fn((container?: HTMLElement): RecordedChart => {
  const options: unknown[] = [];
  const chart: RecordedChart = {
    container,
    options,
    setOption(option, notMerge) {
      options.push(option);
      setOption(option, notMerge);
    },
    resize,
    dispose,
    on,
    off,
    clear,
    getOption,
  };
  instances.push(chart);
  return chart;
});

export const charts = {
  init,
  /** Every `setOption` call, from any chart on the page. */
  setOption,
  resize,
  dispose,
  on,
  off,
  /** Every chart `init` created since the last reset, oldest first. */
  instances,
  /** Every option any chart was given, oldest first. */
  options(): unknown[] {
    return setOption.mock.calls.map(([option]) => option);
  },
  /** The last option any chart was given. */
  lastOption(): unknown {
    return setOption.mock.calls.at(-1)?.[0];
  },
  /** The chart mounted most recently. */
  latest(): RecordedChart | undefined {
    return instances.at(-1);
  },
  /** Forgets every chart and call; run before each test by `test-setup.ts`. */
  reset() {
    instances.length = 0;
    for (const spy of [init, setOption, resize, dispose, on, off, clear, getOption]) spy.mockClear();
  },
};

/** What `vi.mock("echarts", ...)` returns: the namespace and the default export. */
export const echartsModule = {
  init,
  use: vi.fn(),
  default: { init, use: vi.fn() },
};
