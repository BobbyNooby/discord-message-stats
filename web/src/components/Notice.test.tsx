import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { NoticeProvider, useNotice } from "./Notice";

/** A control that fires one notice, so the region is exercised the way panels use it. */
function Trigger({ tone }: { tone?: "danger" }) {
  const notify = useNotice();
  return (
    <button
      type="button"
      onClick={() => notify({ tone, message: "Link copied. Paste it anywhere." })}
    >
      Go
    </button>
  );
}

/** Fires on mount, so the auto-dismiss timer needs no interaction to start. */
function AutoFire() {
  const notify = useNotice();
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    notify({ message: "Link copied. Paste it anywhere." });
  }, [notify]);
  return null;
}

const clickGo = () => fireEvent.click(screen.getByRole("button", { name: "Go" }));

describe("notices", () => {
  it("says what happened, and what to do next", () => {
    render(
      <NoticeProvider>
        <Trigger />
      </NoticeProvider>,
    );

    clickGo();

    expect(screen.getByRole("status")).toHaveTextContent("Link copied. Paste it anywhere.");
  });

  it("announces a failure as an alert rather than a status", () => {
    render(
      <NoticeProvider>
        <Trigger tone="danger" />
      </NoticeProvider>,
    );

    clickGo();

    expect(screen.getByRole("alert")).toHaveTextContent(/link copied/i);
  });

  it("draws nothing until there is something to say", () => {
    render(
      <NoticeProvider>
        <Trigger />
      </NoticeProvider>,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByLabelText("Notifications")).toBeNull();
  });

  it("lets the reader dismiss a failure that will not fade on its own", () => {
    render(
      <NoticeProvider>
        <Trigger tone="danger" />
      </NoticeProvider>,
    );
    clickGo();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fades a success without being asked", () => {
    vi.useFakeTimers();
    try {
      render(
        <NoticeProvider>
          <AutoFire />
        </NoticeProvider>,
      );
      expect(screen.getByRole("status")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(9000));

      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a no-op outside a provider, so a panel test needs no harness", () => {
    render(<Trigger />);

    clickGo();

    expect(screen.queryByRole("status")).toBeNull();
  });
});
