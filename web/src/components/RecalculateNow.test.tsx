import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recalculate: vi.fn(), listJobs: vi.fn() }));
vi.mock("../admin/api", () => ({
  recalculate: mocks.recalculate,
  listJobs: mocks.listJobs,
}));

import { RecalculateNow } from "./RecalculateNow";

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidated = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <RecalculateNow />
    </QueryClientProvider>,
  );
  return invalidated;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("<RecalculateNow>", () => {
  it("queues a rebuild, polls it, and reloads the numbers", async () => {
    const user = userEvent.setup();
    mocks.recalculate.mockResolvedValue({
      id: 7, channel_id: "c1", kind: "rebuild_rollups", status: "queued",
    });
    mocks.listJobs.mockResolvedValue({ jobs: [{ id: 7, status: "done" }] });
    const invalidated = renderIt();

    await user.click(screen.getByRole("button", { name: /recalculate now/i }));

    expect(mocks.recalculate).toHaveBeenCalledTimes(1);
    expect(mocks.listJobs).toHaveBeenCalled();
    expect(await screen.findByText(/rebuild finished/i)).toBeInTheDocument();
    expect(invalidated).toHaveBeenCalled();
  });

  it("shows the API's 'already queued' answer instead of stacking", async () => {
    const user = userEvent.setup();
    mocks.recalculate.mockResolvedValue({
      id: 9, channel_id: "c1", kind: "rebuild_rollups", status: "running",
      already: true, message: "already running as job #9",
    });
    // Still in flight: the poll never resolves, so the queue answer stays put.
    mocks.listJobs.mockReturnValue(new Promise(() => {}));
    renderIt();

    await user.click(screen.getByRole("button", { name: /recalculate now/i }));

    expect(await screen.findByText(/already running as job #9/i)).toBeInTheDocument();
  });

  it("surfaces a refusal rather than pretending the rebuild started", async () => {
    const user = userEvent.setup();
    mocks.recalculate.mockRejectedValue(new Error("Only an admin can do that"));
    renderIt();

    await user.click(screen.getByRole("button", { name: /recalculate now/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Only an admin can do that");
  });
});
