/**
 * The admin board's API calls.
 *
 * `client.ts` keeps its `request` helper private, so this module has its own
 * with the same contract: a 401 becomes `Unauthorized` (the caller shows the
 * login wall), everything else is an `ApiError` carrying the server's `detail`.
 *
 * Response shapes are read from `src/discord_scraper/api/admin.py`, not guessed.
 * One rule holds here as everywhere: the bot token's value is never sent to the
 * browser, so nothing in this file accepts or returns one.
 */

import { Unauthorized } from "../api/client";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** 409 from an upload (or another admin mutation) because a job is running. */
export class JobRunning extends ApiError {}

export type ConfigPatch = Partial<{
  channel_id: string;
  timezone: string;
  ignore_words: string[];
  allowlist_policy: string;
  cron_enabled: boolean;
  cron_hours: number;
}>;

export type AdminConfig = {
  effective: {
    channel_id: string;
    timezone: string;
    ignore_words: string[];
    allowlist_policy: string;
    app_name: string;
    count_types: string[];
    exclude_bots: boolean;
    cron_enabled: boolean;
    cron_hours: number;
  };
  overridden: string[];
};

export type RollupFamily = {
  rows: number;
  stale: boolean;
  computed_at: string | null;
};

export type WorkerView = {
  token_status: string;
  checked_at: string | null;
  last_ok_at: string | null;
  last_ingest_at: string | null;
  last_ingest_added: string | null;
  last_seen_at: string | null;
  consecutive_failures: string | null;
  cron_enabled: string | null;
  cron_hours: string | null;
};

export type AdminStatus = {
  app: string;
  channel_id: string;
  timezone: string;
  cache_stale: boolean;
  database: { size_bytes: number; path: string };
  /** The id, never the token: the worker keeps the token in its environment. */
  admin: { discord_id: string };
  config_hash: string;
  rollups: Record<string, RollupFamily>;
  worker: WorkerView;
  jobs: Record<string, number>;
  sessions: { active: number };
  checked_at: string;
};

/** One merge as the API stores it: the canonical account is inside `accounts`. */
export type MergeEntry = { canonical: string; accounts: string[] };

/** Every write answers with the same two things (§11.6). */
export type MergeWrite = { merges: MergeEntry[]; cache_stale: boolean };

export type InclusionWrite = { included: Record<string, boolean>; cache_stale: boolean };

export type RevokeResult = { revoked: number };

export type JobKind = "catch_up" | "backfill" | "probe" | "rebuild_rollups";

export type Job = {
  id: number;
  channel_id: string;
  kind: string;
  status: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: string | null;
  error: string | null;
};

export type UploadSide = {
  rows: number;
  first: string | null;
  last: string | null;
  size_bytes: number;
};

export type UploadPreview = {
  upload_id: string;
  rows: number;
  first: string | null;
  last: string | null;
  size_bytes: number;
  replaces: UploadSide;
};

export type UploadCommit = {
  rows: number;
  first: string | null;
  last: string | null;
  backup: string;
  job: { id: number; channel_id: string; kind: string; status: string };
};

export type SearchResults = {
  total: number;
  limit: number;
  offset: number;
  rows: {
    id: string;
    author_id: string;
    created_at: string;
    content: string;
    author_name: string;
  }[];
};

function detailFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (response.status === 401) throw new Unauthorized("login required");
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      detail = detailFrom(await response.json(), detail);
    } catch {
      /* a non-JSON body keeps the status line */
    }
    if (response.status === 409) throw new JobRunning(detail, response.status);
    throw new ApiError(detail, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const getStatus = () => request<AdminStatus>("/api/admin/status");

export const getConfig = () => request<AdminConfig>("/api/admin/config");

export const putConfig = (patch: ConfigPatch) =>
  request<AdminConfig>("/api/admin/config", json("PUT", patch));

/**
 * Replaces the channel's merges outright: adding an alt and dropping one are
 * the same call, and `{ merges: [] }` unmerges everything. A duplicate account
 * inside one merge is a 400 from the server.
 */
export const putIdentity = (merges: MergeEntry[]) =>
  request<MergeWrite>("/api/admin/identity", json("PUT", { merges }));

/** Hide an identity, never delete it: the messages stay and a rebuild folds them out. */
export const putInclusions = (included: Record<string, boolean>) =>
  request<InclusionWrite>("/api/admin/inclusions", json("PUT", { included }));

/** Ends every session but the caller's own; the response says how many. */
export const revokeAllSessions = () =>
  request<RevokeResult>("/api/admin/sessions/revoke-all", { method: "POST" });

export const listJobs = (limit = 50) =>
  request<{ jobs: Job[] }>(`/api/admin/jobs?limit=${limit}`);

export const createJob = (kind: JobKind) =>
  request<{ id: number; channel_id: string; kind: string; status: string }>(
    "/api/admin/jobs",
    json("POST", { kind }),
  );

/** The 202 endpoint the two save buttons differ over (§11.6). */
export const recalculate = () =>
  request<{ id: number; channel_id: string; kind: string; status: string }>(
    "/api/admin/recalculate",
    { method: "POST" },
  );

export const searchMessages = (q: string, limit = 50) =>
  request<SearchResults>(
    `/api/admin/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );

/** Stage a database upload; nothing is replaced until `commitUpload` (§10.6). */
export function uploadDatabase(file: File): Promise<UploadPreview> {
  const body = new FormData();
  body.append("file", file);
  return request<UploadPreview>("/api/admin/upload", { method: "POST", body });
}

export const commitUpload = (uploadId: string) =>
  request<UploadCommit>(`/api/admin/upload/${encodeURIComponent(uploadId)}/commit`, {
    method: "POST",
  });

export const discardUpload = (uploadId: string) =>
  request<void>(`/api/admin/upload/${encodeURIComponent(uploadId)}`, {
    method: "DELETE",
  });
