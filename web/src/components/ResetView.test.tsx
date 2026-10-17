import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PrunedNotice, ResetView, storedCounts } from "./ResetView";

describe("storedCounts", () => {
  it("says how much is stored, in words", () => {
    expect(storedCounts({}, {})).toEqual([]);
    expect(
      storedCounts(
        { "who-talks-the-most": { word: "cat" }, "word-cloud": { active: [true, false] } },
        { "message-types": "pie" },
      ),
    ).toEqual(["2 cards have their own filters", "1 chart shape", "2 filters"]);
    expect(storedCounts({ "word-cloud": { word: "cat" } }, {})).toEqual([
      "1 card has its own filters",
      "1 filter",
    ]);
  });
});

describe("<ResetView>", () => {
  it("states what is stored before anything is pressed", () => {
    render(
      <ResetView
        scopes={{ "who-talks-the-most": { word: "cat" }, "word-cloud": { active: [true, false] } }}
        charts={{ "message-types": "pie" }}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Reset view" })).toBeInTheDocument();
    expect(screen.getByText(/2 cards have their own filters/)).toBeInTheDocument();
    expect(screen.getByText(/1 chart shape/)).toBeInTheDocument();
  });

  it("asks before clearing, and does nothing until confirmed", async () => {
    const onReset = vi.fn();
    render(<ResetView scopes={{ "word-cloud": { word: "cat" } }} charts={{}} onReset={onReset} />);

    await userEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reset view" })).toBeInTheDocument();
  });

  it("clears both scopes and chart shapes when confirmed", async () => {
    const onReset = vi.fn();
    render(
      <ResetView
        scopes={{ "word-cloud": { word: "cat" } }}
        charts={{ "message-types": "pie" }}
        onReset={onReset}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Reset view" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear saved view" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("is disabled when there is nothing saved", () => {
    render(<ResetView scopes={{}} charts={{}} onReset={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Reset view" })).toBeDisabled();
    expect(screen.getByText("Nothing saved yet.")).toBeInTheDocument();
  });
});

describe("<PrunedNotice>", () => {
  it("says what was dropped from saved filters, and dismisses", async () => {
    const onDismiss = vi.fn();
    render(<PrunedNotice pruned={'author \u201cBob\u201d from Who talks the most'} onDismiss={onDismiss} />);

    expect(screen.getByText(/Saved filters changed/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
