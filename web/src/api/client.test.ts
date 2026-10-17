import { afterEach, describe, expect, it, vi } from "vitest";

import { Forbidden, getBootstrap, Offline, ServerError, Unauthorized } from "./client";

/**
 * Every failure is classified once, here. The screens depend on the difference:
 * "sign in" is not "you are not allowed", which is not "the server broke",
 * which is not "the browser never reached it".
 */

function respond(status: number, detail?: string) {
  return vi.fn().mockResolvedValue(
    new Response(detail ? JSON.stringify({ detail }) : null, {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("the fetch wrapper", () => {
  it("tells a 401 apart so the caller can show the sign-in wall", async () => {
    vi.stubGlobal("fetch", respond(401, "login required"));
    await expect(getBootstrap()).rejects.toBeInstanceOf(Unauthorized);
  });

  it("tells a 403 apart so a viewer reaching /admin gets a boundary, not an error", async () => {
    vi.stubGlobal("fetch", respond(403, "admin only"));
    await expect(getBootstrap()).rejects.toBeInstanceOf(Forbidden);
  });

  it("keeps the server's own message on a 5xx", async () => {
    vi.stubGlobal("fetch", respond(503, "rollups are not built"));
    await expect(getBootstrap()).rejects.toMatchObject({
      message: "rollups are not built",
      status: 503,
    });
    vi.stubGlobal("fetch", respond(500, "boom"));
    await expect(getBootstrap()).rejects.toBeInstanceOf(ServerError);
  });

  it("calls a rejected fetch offline, not a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(getBootstrap()).rejects.toBeInstanceOf(Offline);
  });

  it("leaves any other status as a plain error", async () => {
    vi.stubGlobal("fetch", respond(404, "no such route"));
    await expect(getBootstrap()).rejects.toThrow("no such route");
  });
});
