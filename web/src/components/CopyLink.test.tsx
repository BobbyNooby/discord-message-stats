import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoticeProvider } from "./Notice";
import { CopyViewLink } from "./CopyLink";

/**
 * "Copy view link" is only as good as what it copies: the URL *is* the view
 * (scopes and `?media=1` are mirrored into it), so the control copies
 * `location.href` and says so. A refused copy has to say what to do instead.
 */
describe("<CopyViewLink>", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("copies the whole current URL, scopes and all", async () => {
    window.history.replaceState(null, "", "/?scope=words:author=Ada&media=1");
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(
      <NoticeProvider>
        <CopyViewLink />
      </NoticeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /copy view link/i }));

    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByRole("status")).toHaveTextContent(/view link copied/i);
  });

  it("says what to do when the browser refuses the copy", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(
      <NoticeProvider>
        <CopyViewLink />
      </NoticeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /copy view link/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/select the address bar/i);
  });
});
