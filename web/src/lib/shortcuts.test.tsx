import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "../components/ui";
import { OPEN_FILTERS_EVENT, WORD_SEARCH_ID, useKeyboardShortcuts } from "./shortcuts";

/**
 * `/` and `f` must not fight the reader: they do nothing while a field has
 * focus, nothing when a browser or OS modifier is held, and nothing while a
 * modal is open.
 */
function Harness({ modal = false }: { modal?: boolean }) {
  useKeyboardShortcuts();
  return (
    <>
      <input id={WORD_SEARCH_ID} aria-label="Search words" defaultValue="cat" />
      <input aria-label="Some other field" />
      {modal ? (
        <Dialog open onOpenChange={() => {}} title="Show top 50">
          <p>media</p>
        </Dialog>
      ) : null}
    </>
  );
}

function watchFilters() {
  const listener = vi.fn();
  window.addEventListener(OPEN_FILTERS_EVENT, listener);
  return { listener, stop: () => window.removeEventListener(OPEN_FILTERS_EVENT, listener) };
}

describe("keyboard shortcuts", () => {
  it("focuses and selects the word search on /", () => {
    render(<Harness />);

    fireEvent.keyDown(document.body, { key: "/" });

    const search = screen.getByLabelText("Search words") as HTMLInputElement;
    expect(search).toHaveFocus();
    expect(search.selectionStart).toBe(0);
    expect(search.selectionEnd).toBe(3);
  });

  it("asks for the filters on f", () => {
    const { listener, stop } = watchFilters();
    render(<Harness />);

    fireEvent.keyDown(document.body, { key: "f" });

    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("leaves a field alone while it has focus", () => {
    const { listener, stop } = watchFilters();
    render(<Harness />);
    const other = screen.getByLabelText("Some other field");
    other.focus();

    fireEvent.keyDown(other, { key: "f" });
    fireEvent.keyDown(other, { key: "/" });

    expect(listener).not.toHaveBeenCalled();
    expect(other).toHaveFocus();
    stop();
  });

  it("leaves modified keys to the browser", () => {
    const { listener, stop } = watchFilters();
    render(<Harness />);

    fireEvent.keyDown(document.body, { key: "f", metaKey: true });
    fireEvent.keyDown(document.body, { key: "f", ctrlKey: true });

    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it("does not reach past an open modal", () => {
    // "Show top 50" is a Radix dialog on a phone and a dialog on the desktop.
    // `f` there opened the filter sheet behind it, and on a wide screen moved
    // the caret into the sidebar behind the scrim.
    const { listener, stop } = watchFilters();
    render(<Harness modal />);
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "f" });
    fireEvent.keyDown(dialog, { key: "/" });

    expect(listener).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Search words")).not.toHaveFocus();
    stop();
  });
});
