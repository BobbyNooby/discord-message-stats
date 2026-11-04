/** One fetch wrapper, so every query — the dashboard's and the admin board's — fails the same way. */

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

/** The server's own words for a failure, or `fallback` when it sent none. */
function detailFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
    if (Array.isArray(detail)) {
      // Pydantic's validation errors are a list of objects.
      const messages = detail
        .map((item) =>
          item && typeof item === "object" && "msg" in item
            ? String((item as { msg: unknown }).msg)
            : JSON.stringify(item),
        )
        .join("; ");
      if (messages) return messages;
    }
  }
  return fallback;
}

export type RequestFailures = {
  /** What `Offline` says when the browser never reached the server. */
  offline: string;
  /** The error a non-2xx status becomes, given the server's `detail`. */
  fail: (status: number, detail: string) => Error;
};

/**
 * Same-origin cookies, a rejected fetch as `Offline`, the server's `detail` on
 * a failure and no body on a 204. Which error a status becomes is the caller's
 * to say: the admin board names a 409 that the dashboard never sees.
 */
export async function requestJson<T>(
  path: string,
  init: RequestInit | undefined,
  failures: RequestFailures,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    // A rejected fetch is the browser saying it never reached the server.
    throw new Offline(failures.offline);
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      detail = detailFrom(await response.json(), detail);
    } catch {
      /* a non-JSON body keeps the status line */
    }
    throw failures.fail(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const DASHBOARD: RequestFailures = {
  offline: "the dashboard could not reach the server",
  fail(status, detail) {
    if (status === 401) return new Unauthorized(detail);
    if (status === 403) return new Forbidden(detail);
    if (status >= 500) return new ServerError(detail, status);
    return new Error(detail);
  },
};

const request = <T>(path: string, init?: RequestInit) => requestJson<T>(path, init, DASHBOARD);

export const getBootstrap = () => request<import("./types").Payload>("/api/bootstrap");

export const getHealth = () =>
  request<{
    ok: boolean;
    checked_at: string;
    banner: "stale" | "token_dead" | null;
    /** Null means the worker has never recorded an ingest — not a missing field. */
    last_ingest_at: string | null;
  }>("/api/health");

/** The newest scrape or rebuild, as `/api/setup` reports it to an admin. */
export type SetupJob = {
  id: number;
  kind: string;
  status: string;
  phase: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: string | null;
  error: string | null;
};

/**
 * Whether there is anything to show yet (`/api/setup`). A viewer gets the two
 * flags only; an admin also gets what the first-run screen draws.
 */
export type Setup = {
  needed: boolean;
  can_admin: boolean;
  channel_id?: string;
  /** Rows stored for the channel so far: the live figure during a first scrape. */
  messages?: number;
  rollups_built?: boolean;
  worker_seen_at?: string | null;
  job?: SetupJob | null;
};

export type AdminSetup = Required<Setup>;

export const getSetup = () => request<Setup>("/api/setup");

export const getRecent = () =>
  request<{
    messages: { author: string; author_id: string; created_at: string; body: string }[];
    truncated: boolean;
  }>("/api/recent");

export type WordMonth = { month: string; id: string; count: number };

export const getWords = (query: string, limit = 50) =>
  request<{
    word: string;
    total: number;
    authors: { id: string; name: string; count: number }[];
    /** Uses per local month; null until a rebuild has written the month table. */
    months?: WordMonth[] | null;
  }>(`/api/words?q=${encodeURIComponent(query)}&limit=${limit}`);

/** A stretch of local months and/or some years, as `/api/words/period` takes it. */
export type Period = { from: string | null; to: string | null; years: number[] };

/** The payload's four word fields for one period (`built` is false before a rebuild). */
export type WordPeriod = Pick<
  import("./types").Payload,
  "words" | "wordAuthors" | "authorWordTotals" | "authorDistinct"
> & { built: boolean; kept_words: number };

export const getWordPeriod = (period: Period) => {
  const params = new URLSearchParams();
  if (period.from) params.set("from", period.from);
  if (period.to) params.set("to", period.to);
  if (period.years.length) params.set("years", period.years.join(","));
  return request<WordPeriod>(`/api/words/period?${params.toString()}`);
};

/** Words in the full index starting with what was typed, most used first. */
export const getWordSuggestions = (prefix: string) =>
  request<{ words: [string, number][] }>(`/api/words/suggest?q=${encodeURIComponent(prefix)}`);

export type MediaDetail = {
  item: import("./types").MediaRow;
  first_seen: string | null;
  last_seen: string | null;
  /** Null (not empty) until a rebuild has written the per-person table. */
  people: { id: string; name: string; count: number; first_seen: string }[] | null;
  months: { month: string; id: string; count: number }[] | null;
  first_post: { id: string; name: string; at: string; message_id: string; jump_url: string } | null;
};

export const getMediaDetail = (url: string) =>
  request<MediaDetail>(`/api/media/detail?url=${encodeURIComponent(url)}`);

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
