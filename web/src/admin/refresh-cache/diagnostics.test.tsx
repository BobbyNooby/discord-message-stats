import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Diagnostics } from "../api";
import { DiagnosticsView } from "./Diagnostics";

const data: Diagnostics = {
  checked_at: "2026-10-25T10:00:00+00:00",
  version: "0.4.0",
  commit: "abc123def456",
  config: {
    digest: "d", channel_id: "c1", timezone: "Asia/Kuala_Lumpur",
    timezone_source: "override", channel_id_source: "file", app_name: "Stats",
  },
  database: { path: "/data/messages.db", size_bytes: 2048 },
  counts: { messages: 10, media_messages: 2, media_urls: 1, link_messages: 3, authors: 2 },
  families: { stale: true, stale_count: 2, items: [] },
  worker: {
    last_seen_at: null,
    running_job: { id: 7, kind: "rebuild_rollups", started_at: null, phase: "writing" },
    consecutive_failures: "0",
    last_error: "URLError: no route to host",
  },
  disk: { path: "/data", free_bytes: 1024, total_bytes: 4096, used_bytes: 3072 },
  orphans: { count: 0, bytes: 0 },
  failures: [{ source: "job", id: 5, kind: "catch_up", at: "2026-10-24T09:00:00+00:00", error: "HTTP 401" }],
};

describe("<DiagnosticsView>", () => {
  it("says which build this is and where the zone and channel came from", () => {
    render(<DiagnosticsView data={data} />);
    expect(screen.getByText("0.4.0 · abc123def456")).toBeInTheDocument();
    expect(screen.getByText("Asia/Kuala_Lumpur (saved on this board)")).toBeInTheDocument();
    expect(screen.getByText("c1 (config.toml)")).toBeInTheDocument();
    expect(screen.getByText("#7 rebuild_rollups · writing")).toBeInTheDocument();
  });

  it("warns about the worker's last error while it keeps failing", () => {
    render(<DiagnosticsView data={{ ...data, worker: { ...data.worker, consecutive_failures: "2" } }} />);
    expect(screen.getByText(/Worker's last error: .*no route to host/)).toBeInTheDocument();
  });

  it("drops the warning once a job has worked, and keeps the failure in the list", () => {
    render(<DiagnosticsView data={data} />);
    expect(screen.queryByText(/Worker's last error/)).toBeNull();
    expect(screen.getByText("job #5 · catch_up")).toBeInTheDocument();
    expect(screen.getByText("HTTP 401")).toBeInTheDocument();
  });

  it("says so when nothing has failed", () => {
    render(<DiagnosticsView data={{ ...data, failures: [], worker: { ...data.worker, last_error: null } }} />);
    expect(screen.getByText("None recorded.")).toBeInTheDocument();
  });
});
