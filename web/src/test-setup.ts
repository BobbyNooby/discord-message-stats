import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver, and <EChart> depends on one to stay sized.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never);
