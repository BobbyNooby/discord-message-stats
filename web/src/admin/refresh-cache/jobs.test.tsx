import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobHistory } from "./Jobs";

const api = vi.hoisted(() => ({
  listJobs: vi.fn(),
  cancelJob: vi.fn(),
  createJob: vi.fn(),
}));

vi.mock("../api", () => api);

const job = (id: number, status: string) => ({
  id,
  channel_id: "c1",
  kind: "rebuild_rollups",
  status,
  requested_at: "2026-10-25T10:00:00+00:00",
  started_at: null,
  finished_at: null,
  result: null,
  error: null,
});

function renderHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JobHistory />
    </QueryClientProvider>,
  );
}

describe("<JobHistory>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listJobs.mockResolvedValue({ jobs: [job(3, "queued"), job(2, "running"), job(1, "done")] });
  });

  it("offers to cancel only the jobs still waiting in the queue", async () => {
    renderHistory();
    expect(await screen.findByRole("button", { name: "Cancel job 3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel job 2" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel job 1" })).toBeNull();
  });

  it("cancels a queued job and says so", async () => {
    const user = userEvent.setup();
    api.cancelJob.mockResolvedValue({
      id: 3, kind: "rebuild_rollups", status: "cancelled", previous_status: "queued", already: false,
    });
    renderHistory();
    await user.click(await screen.findByRole("button", { name: "Cancel job 3" }));
    expect(api.cancelJob).toHaveBeenCalledWith(3);
    expect(await screen.findByText(/Job #3 \(rebuild_rollups\) cancelled before it started/)).toBeInTheDocument();
  });

  it("shows the server's sentence when the job started in the meantime", async () => {
    const user = userEvent.setup();
    api.cancelJob.mockRejectedValue(new Error("job 3 (rebuild_rollups) is running — wait for it to finish"));
    renderHistory();
    await user.click(await screen.findByRole("button", { name: "Cancel job 3" }));
    expect(await screen.findByText(/is running — wait for it to finish/)).toBeInTheDocument();
  });
});
