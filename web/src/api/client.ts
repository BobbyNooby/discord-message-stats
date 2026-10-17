/** One fetch wrapper, so every query fails the same way. */

/**
 * The four ways a fetch can fail, told apart so the screen can say something
 * useful: "sign in" is not "you are not allowed", which is not "the server is
 * broken", which is not "you are offline". Today a failed fetch was
 * indistinguishable from a slow one, which is exactly what this fixes.
 */
export class Unauthorized extends Error {}
export class Forbidden extends Error {}
export class Offline extends Error {}
export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    // A rejected fetch is the browser saying it never reached the server.
    throw new Offline("the dashboard could not reach the server");
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* a non-JSON body keeps the status line */
    }
    if (response.status === 401) throw new Unauthorized(detail);
    if (response.status === 403) throw new Forbidden(detail);
    if (response.status >= 500) throw new ServerError(detail, response.status);
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export const getBootstrap = () => request<import("./types").Payload>("/api/bootstrap");

export const getHealth = () =>
  request<{ ok: boolean; checked_at: string; banner: "stale" | "token_dead" | null }>("/api/health");

export const getRecent = () =>
  request<{
    messages: { author: string; author_id: string; created_at: string; body: string }[];
    truncated: boolean;
  }>("/api/recent");

export const getWords = (query: string, limit = 50) =>
  request<{
    word: string;
    total: number;
    authors: { id: string; name: string; count: number }[];
  }>(`/api/words?q=${encodeURIComponent(query)}&limit=${limit}`);

/**
 * The full media ranking, optionally for one provider and one kind
 * (`/api/media`). Both are query parameters, so a kind chip narrows the whole
 * rollup rather than the page of rows already fetched.
 */
export const getMedia = (provider?: string, kind?: string, limit = 50) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (provider) params.set("provider", provider);
  if (kind) params.set("kind", kind);
  return request<{
    provider: string | null;
    kind: string | null;
    /** Every kind present for this provider, so the chips cover the whole set. */
    kinds: string[];
    items: import("./types").MediaRow[];
  }>(`/api/media?${params.toString()}`);
};
