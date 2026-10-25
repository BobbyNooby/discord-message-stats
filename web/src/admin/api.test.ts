import { afterEach, describe, expect, it, vi } from "vitest";

import { Forbidden, Offline, Unauthorized } from "../api/client";
import { ApiError, JobRunning, forgetToken, getStatus, putConfig } from "./api";

/**
 * The admin board shares the dashboard's fetch, but names its own failures: a
 * 409 is a job already running, and anything else it cannot place is an
 * `ApiError` that keeps the status for the screen to read.
 */

function respond(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** The error a call rejected with, so its class and its words can both be checked. */
const failureOf = (call: Promise<unknown>) => call.then(() => null, (error: unknown) => error);

afterEach(() => vi.unstubAllGlobals());

describe("the admin board's failures", () => {
  it("sends a 401 to the login wall and a 403 to the boundary", async () => {
    vi.stubGlobal("fetch", respond(401, { detail: "no session" }));
    await expect(getStatus()).rejects.toBeInstanceOf(Unauthorized);
    vi.stubGlobal("fetch", respond(403, { detail: "nope" }));
    const refused = await failureOf(getStatus());
    expect(refused).toBeInstanceOf(Forbidden);
    expect(refused).toMatchObject({ message: "admin only" });
  });

  it("calls a 409 a running job and keeps the server's words", async () => {
    vi.stubGlobal("fetch", respond(409, { detail: "a rebuild is running" }));
    const failure = await failureOf(putConfig({ cron_hours: 6 }));
    expect(failure).toBeInstanceOf(JobRunning);
    expect(failure).toMatchObject({ message: "a rebuild is running", status: 409 });
  });

  it("joins a validation error's messages rather than printing objects", async () => {
    vi.stubGlobal("fetch", respond(422, { detail: [{ msg: "too big" }, { msg: "not a zone" }] }));
    const failure = await failureOf(putConfig({ timezone: "Mars/Base" }));
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ message: "too big; not a zone", status: 422 });
  });

  it("answers a 204 with no body", async () => {
    vi.stubGlobal("fetch", respond(204));
    await expect(forgetToken()).resolves.toBeUndefined();
  });

  it("says the board, not the dashboard, could not reach the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const failure = await failureOf(getStatus());
    expect(failure).toBeInstanceOf(Offline);
    expect(failure).toMatchObject({ message: "the admin board could not reach the server" });
  });
});
