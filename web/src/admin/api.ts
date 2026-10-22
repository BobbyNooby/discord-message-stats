/**
 * The admin board's API calls.
 *
 * `client.ts` keeps its `request` helper private, so this module has its own
 * with the same contract: a 401 becomes `Unauthorized` (the caller shows the
 * login wall), everything else is an `ApiError` carrying the server's `detail`.
 *
 * Response shapes are read from `src/discord_stats/api/admin.py`, not guessed.
 * One rule holds here as everywhere: the bot token's value is never sent to the
 * browser, so nothing in this file returns one. `saveToken` is the one call
 * that sends a token up; the server checks it, stores it and never echoes it.
 */

import { Forbidden, Offline, Unauthorized } from "../api/client";

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
  /** What the build read, so "what changed since" is a subtraction, not a guess. */
  built_from_rows: number | null;
  built_from_newest: string | null;
  built_in_timezone: string | null;
  added_since: number | null;
  config_changed: boolean;
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
  admin: { discord_id: string; known: boolean | null };
  config_hash: string;
  rollups: Record<string, RollupFamily>;
  worker: WorkerView;
  jobs: Record<string, number>;
  sessions: { active: number };
  checked_at: string;
};

/** One merge as the API stores it: the canonical account is inside `accounts`. */
export type MergeEntry = { canonical: string; accounts: string[]; name?: string | null };

/** An admin whose id a merge absorbed, and the canonical that inherited it. */
export type AdminMove = { from: string; to: string; configured: boolean };

/**
 * Every write answers with the same two things (§11.6), and the identity write
 * additionally answers with the state it replaced — that is what Undo writes
 * back, since the endpoint replaces rather than patches. `admins_moved` names
 * any admin whose rights followed a person into a merge.
 */
export type MergeWrite = {
  merges: MergeEntry[];
  cache_stale: boolean;
  previous: MergeEntry[];
  admins_moved?: AdminMove[];
};

export type InclusionWrite = { included: Record<string, boolean>; cache_stale: boolean };

export type RevokeResult = { revoked: number };

/** One row of the admin list (§8.1): a database row, or the configured fallback. */
export type AdminRow = {
  discord_id: string;
  added_at: string | null;
  added_by: string | null;
  /** The `known` idea: has this id posted in the channel at all? */
  known: boolean;
  source: "table" | "config";
};

export type AdminRemoval = { removed: string; revoked: number };

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
  channel_id: string;
  timezone: string;
  timezone_source: "database" | "config";
  /** The dry run: rows the swap would bring, and rows it would take away. */
  added: number | null;
  lost: number | null;
  disk: { free_bytes: number; required_bytes: number };
  replaces: UploadSide;
};

export type UploadCommit = {
  rows: number;
  first: string | null;
  last: string | null;
  /** Null only when there was no database to replace; the API always keeps one. */
  backup: string | null;
  job: { id: number; channel_id: string; kind: string; status: string };
};

/** The zones the picker may offer, and the one in force right now. */
export type TimezoneList = {
  zones: string[];
  configured: string;
  effective: string;
  auto_zone: string;
};

/** One line of the rebuild log: a run or family event, already human-readable. */
export type ProgressLogEntry = {
  id: number;
  at: string | null;
  kind: string;
  family: string | null;
  phase: string | null;
  message: string | null;
};

/** `running` is a family whose write has begun and not yet finished. */
export type ProgressFamilyState = "pending" | "running" | "done" | "failed";

export type ProgressFamily = {
  family: string;
  state: ProgressFamilyState;
  rows: number | null;
  seconds: number | null;
  computed_at: string | null;
  added_since: number | null;
  stale: boolean;
};

export type ProgressLast = {
  status: string;
  finished_at: string | null;
  seconds: number | null;
  rows: number | null;
  message: string | null;
};

/**
 * One poll's answer (`src/discord_stats/api/progress.py`): the run state,
 * every family, and the events newer than the `since` that was asked for. The
 * run state, the totals and the freshness facts all arrive in this one body.
 */
export type Progress = {
  running: boolean;
  /** A run whose process died between `started` and its finish row. */
  abandoned: boolean;
  started_at: string | null;
  phase: string | null;
  families: ProgressFamily[];
  /** Newest first, only entries with an id greater than the requested `since`. */
  log: ProgressLogEntry[];
  totals: { families: number; rows: number; seconds: number | null };
  latest_id: number;
  last: ProgressLast | null;
  freshness: {
    built_at: string | null;
    current: boolean;
    added_since: number | null;
    newest_message_id: string | null;
  };
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
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new Offline("the admin board could not reach the server");
  }
  if (response.status === 401) throw new Unauthorized("login required");
  // A viewer who typed /admin: a boundary, not a failure they can retry away.
  if (response.status === 403) throw new Forbidden("admin only");
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

/** The real zones, and what "auto" resolves to on this host. */
export const getTimezones = () => request<TimezoneList>("/api/admin/timezones");

export const putConfig = (patch: ConfigPatch) =>
  request<AdminConfig>("/api/admin/config", json("PUT", patch));

/**
 * Replaces the channel's merges outright: adding an alt and dropping one are
 * the same call, and `{ merges: [] }` unmerges everything. A duplicate account
 * inside one merge is a 400 from the server. A merge's `name` pins the display
 * name that wins; the response's `previous` is what Undo writes back.
 *
 * `clearNames` drops a pin the undone merge introduced — an id that had no
 * merge of its own before, so `previous` has no entry to carry the name back.
 */
export const putIdentity = (merges: MergeEntry[], clearNames: string[] = []) =>
  request<MergeWrite>(
    "/api/admin/identity",
    json("PUT", clearNames.length > 0 ? { merges, clear_names: clearNames } : { merges }),
  );

/** Hide an identity, never delete it: the messages stay and a rebuild folds them out. */
export const putInclusions = (included: Record<string, boolean>) =>
  request<InclusionWrite>("/api/admin/inclusions", json("PUT", { included }));

/** Ends every session but the caller's own; the response says how many. */
export const revokeAllSessions = () =>
  request<RevokeResult>("/api/admin/sessions/revoke-all", { method: "POST" });

/** Who may run the board, each with whether they have posted. */
export const listAdmins = () => request<{ admins: AdminRow[] }>("/api/admin/admins");

/**
 * Grant admin to one id. An id that matches no message is a 409 from the
 * server; `force` is the operator saying they meant it.
 */
export const addAdmin = (discordId: string, force = false) =>
  request<AdminRow>("/api/admin/admins", json("POST", { discord_id: discordId, force }));

/** Remove an admin and revoke their sessions; the response says how many ended. */
export const removeAdmin = (discordId: string) =>
  request<AdminRemoval>(`/api/admin/admins/${encodeURIComponent(discordId)}`, {
    method: "DELETE",
  });

export const listJobs = (limit = 50) =>
  request<{ jobs: Job[] }>(`/api/admin/jobs?limit=${limit}`);

/** Where the token in use comes from: saved from this board, the environment, or nowhere. */
export type TokenSource = "saved" | "environment" | "none";

export type TokenCheck = {
  status: "ok" | "failed" | "unknown";
  checked_at: string | null;
  bot: { id: string; username: string | null; global_name: string | null } | null;
  error: string | null;
  channel: { ok: boolean; id: string; name: string | null; error: string | null } | null;
  source: TokenSource;
};

export const getTokenCheck = () => request<TokenCheck>("/api/admin/token");

/** Checked with Discord first; a token Discord refuses is a 400 and is not saved. */
export const saveToken = (token: string) =>
  request<{ ok: boolean; bot: TokenCheck["bot"]; channel: TokenCheck["channel"] }>(
    "/api/admin/token",
    json("PUT", { token }),
  );

export const forgetToken = () => request<void>("/api/admin/token", { method: "DELETE" });

export const createJob = (kind: JobKind) =>
  request<{ id: number; channel_id: string; kind: string; status: string }>(
    "/api/admin/jobs",
    json("POST", { kind }),
  );

/** The 202 endpoint the two save buttons differ over (§11.6). */
export const recalculate = () =>
  request<{
    id: number;
    channel_id: string;
    kind: string;
    status: string;
    /** True when this click landed on a rebuild already queued or running. */
    already?: boolean;
    message?: string;
  }>("/api/admin/recalculate", { method: "POST" });

/**
 * The live rebuild feed. `since` is the previous response's `latest_id`, so a
 * poll during a quiet stretch re-reads nothing: it answers with an empty `log`
 * and the same `latest_id`.
 */
export const getProgress = (since = 0) =>
  request<Progress>(`/api/admin/progress?since=${since}`);

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
