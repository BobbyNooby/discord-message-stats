import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAction } from "./useAction";

describe("useAction", () => {
  it("is busy while the write runs and shows what it confirmed", async () => {
    const { result } = renderHook(() => useAction());
    let finish = () => {};
    let running: Promise<void> = Promise.resolve();

    act(() => {
      running = result.current.run(
        () =>
          new Promise<void>((resolve) => {
            finish = () => {
              result.current.setNotice("Saved.");
              resolve();
            };
          }),
      );
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      finish();
      await running;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.notice).toBe("Saved.");
    expect(result.current.error).toBeNull();
  });

  it("turns a throw into the error and clears the last confirmation", async () => {
    const { result } = renderHook(() => useAction());
    act(() => result.current.setNotice("Saved earlier."));

    await act(() =>
      result.current.run(async () => {
        throw new Error("the server said no");
      }),
    );

    expect(result.current.error).toBe("the server said no");
    expect(result.current.notice).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("keeps the last confirmation up when the screen asks it to", async () => {
    const { result } = renderHook(() => useAction());
    act(() => result.current.setNotice("Rebuild queued as job #1."));
    act(() => result.current.setError("an older failure"));

    await act(() => result.current.run(async () => {}, { keepNotice: true }));

    expect(result.current.notice).toBe("Rebuild queued as job #1.");
    expect(result.current.error).toBeNull();
  });
});
